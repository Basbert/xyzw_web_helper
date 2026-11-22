import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import vm from "node:vm";
import * as vueUseCore from "@vueuse/core";
import { createPinia, defineStore, setActivePinia } from "pinia";
import ts from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import * as accountData from "../src/utils/accountGameData.js";
import * as accountIdentity from "../src/utils/accountIdentity.js";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";
import {
  createServerTimeSample,
  getEstimatedServerNowSec,
  sampleFromWebSocketClient,
  updateServerTimeSample,
} from "../src/utils/serverClock.js";
import {
  buildTokenEditCommitPayload,
  extractAuthenticatedRoleId,
  formatUpsertImportMessage,
  pruneSucceededImportRoles,
  upsertImportedRoleTokens,
} from "../src/utils/tokenImportUpsert.js";
import { loadModule } from "./helpers/loadModule.js";

describe("in-place role re-login upsert", () => {
  test("updates existing account by roleId in place, migrates BIN data, and preserves custom name", async () => {
    const db = new Map([
      ["temp-new-id", new Uint8Array([1, 2, 3, 4]).buffer],
      ["orig-id", new Uint8Array([9, 9]).buffer],
    ]);
    const closed = [];
    const tokens = [
      {
        id: "orig-id",
        name: "我的大号",
        roleId: "123456",
        server: "10服",
        token: "old-expired-token",
        importMethod: "wxQrcode",
        combUser: { stale: true },
        remark: "每日主号",
      },
    ];
    const tokenStore = {
      gameTokens: tokens,
      selectedTokenId: "orig-id",
      getWebSocketStatus: (id) => (id === "orig-id" ? "error" : "disconnected"),
      closeWebSocketConnection: (id) => closed.push(id),
      updateToken: (id, updates) => {
        const idx = tokens.findIndex((t) => t.id === id);
        tokens[idx] = { ...tokens[idx], ...updates };
        return true;
      },
      addToken: (role) => {
        tokens.push(role);
        return role;
      },
    };

    const result = await upsertImportedRoleTokens({
      roles: [
        {
          id: "temp-new-id",
          name: "角色名-0-123456",
          roleId: 123456,
          server: "10服",
          token: "fresh-valid-token",
          importMethod: "wxQrcode",
          serverId: 37,
          roleIndex: 0,
          wsUrl: "",
        },
      ],
      tokenStore,
      getArrayBuffer: async (key) => db.get(key) ?? null,
      storeArrayBuffer: async (key, buf) => {
        db.set(key, buf);
        return true;
      },
      deleteArrayBuffer: async (key) => db.delete(key),
    });

    assert.equal(result.addedCount, 0);
    assert.equal(result.updatedCount, 1);
    assert.deepEqual(result.tokenIds, ["orig-id"]);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].id, "orig-id");
    assert.equal(tokens[0].name, "我的大号");
    assert.equal(tokens[0].remark, "每日主号");
    assert.equal(tokens[0].token, "fresh-valid-token");
    assert.equal(tokens[0].combUser, null);
    assert.equal(db.has("temp-new-id"), false);
    assert.deepEqual(
      Array.from(new Uint8Array(db.get("orig-id"))),
      [1, 2, 3, 4],
    );
    assert.deepEqual(closed, ["orig-id"]);
    assert.match(formatUpsertImportMessage(result), /原地更新 1 个/);
  });
});

describe("useIndexedDB cold-start readiness", () => {
  test("getArrayBuffer awaits pending openDB initialization instead of failing early", async () => {
    let resolveDb;
    const fakeStore = new Map([
      ["k1", { id: "k1", data: new Uint8Array([7, 8]).buffer }],
    ]);
    const { default: useIndexedDB } = await loadModule(
      new URL("../src/hooks/useIndexedDB.ts", import.meta.url),
      {
        vue,
        idb: {
          openDB: () =>
            new Promise((resolve) => {
              resolveDb = () =>
                resolve({
                  get: async (_store, key) => fakeStore.get(key),
                  put: async (_store, item) => fakeStore.set(item.id, item),
                  delete: async (_store, key) => fakeStore.delete(key),
                  clear: async () => fakeStore.clear(),
                  getAllKeys: async () => Array.from(fakeStore.keys()),
                  getAll: async () => Array.from(fakeStore.values()),
                });
            }),
        },
      },
    );

    const idb = useIndexedDB();
    const pendingRead = idb.getArrayBuffer("k1");
    resolveDb();
    const buf = await pendingRead;
    assert.ok(buf instanceof ArrayBuffer);
    assert.deepEqual(Array.from(new Uint8Array(buf)), [7, 8]);
  });
});

describe("BatchScheduleModals and BatchDailyTasks reactivity", () => {
  test("BatchScheduleModals forwards the cron string value to parseCronExpression", async () => {
    const modalSource = await readFile(
      new URL(
        "../src/components/BatchDaily/BatchScheduleModals.vue",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(modalSource, /emit\(['"]parseCronExpression['"],\s*val\)/);
  });

  test("BatchDailyTasks passes shanghaiNow to all activity open computeds", async () => {
    const batchSource = await readFile(
      new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
      "utf8",
    );
    assert.match(batchSource, /isBaokuActivityOpen\(shanghaiNow\.value\)/);
    assert.match(batchSource, /isArenaActivityOpen\(shanghaiNow\.value\)/);
    assert.match(
      batchSource,
      /checkWeirdTowerActivityOpen\(shanghaiNow\.value\)/,
    );
    assert.match(
      batchSource,
      /checkWarGuessActivityOpen\(shanghaiNow\.value\)/,
    );
    assert.match(batchSource, /getWarGuessActivityTip\(shanghaiNow\.value\)/);
  });
});

describe("tokenStore clearAllTokens and background monitoring", () => {
  test("initConnectionCoordination starts monitoring without purging manual tokens, and clearAllTokens cleans groups and leases", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const values = new Map();
    const intervals = new Map();
    const timers = new Map();
    const logger = new Proxy({}, { get: () => () => {} });
    let nextInterval = 0;
    let nextTimer = 0;
    let clearedDb = false;

    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, val) => values.set(key, val),
      removeItem: (key) => values.delete(key),
    };

    const module = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": { useLocalStorage: (_k, val) => vue.ref(val) },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async () => null,
            storeArrayBuffer: async () => true,
            deleteArrayBuffer: async () => true,
            clearAll: async () => {
              clearedDb = true;
              return true;
            },
          }),
        },
        "@/router": {
          default: {
            currentRoute: { value: { path: "/admin/game-features" } },
          },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (options) =>
            createConnectionRecovery({
              ...options,
              setTimer: (fn, delay) => {
                const id = ++nextTimer;
                timers.set(id, { fn, delay });
                return id;
              },
              clearTimer: (id) => timers.delete(id),
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (cb) => cb(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () => "",
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser() {},
          roleIndexFromServerId() {},
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {
            setMessageListener() {}
            init() {
              this.onConnect();
            }
            disconnect() {}
            send() {}
            sendHeartbeat() {}
          },
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: storage,
        navigator: { onLine: true },
        setTimeout,
        clearTimeout,
        setInterval: (fn, delay) => {
          const id = ++nextInterval;
          intervals.set(id, { fn, delay });
          return id;
        },
        clearInterval: (id) => intervals.delete(id),
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );

    module.gameTokens.value = [
      {
        id: "old-manual",
        name: "Manual",
        token: "manual-token-long-enough",
        importMethod: "manual",
        createdAt: "2020-01-01T00:00:00.000Z",
        lastUsed: "2020-01-01T00:00:00.000Z",
      },
    ];
    module.selectedTokenId.value = "old-manual";
    const store = module.useTokenStore();

    store.initConnectionCoordination();
    assert.equal(intervals.size, 1);
    assert.equal(module.gameTokens.value.length, 1);

    const group = store.createTokenGroup("测试分组");
    store.addTokenToGroup(group.id, "old-manual");
    await store.createWebSocketConnection(
      "old-manual",
      "manual-token-long-enough",
    );
    assert.ok(values.has("ws_connection_old-manual"));

    await store.clearAllTokens();
    assert.equal(module.gameTokens.value.length, 0);
    assert.equal(module.selectedTokenId.value, "");
    assert.equal(store.tokenGroups.length, 0);
    assert.equal(values.has("ws_connection_old-manual"), false);
    assert.equal(timers.size, 0);
    assert.equal(clearedDb, true);

    pinia._e.stop();
  });
});

describe("Commit 2 daily player UX checks", () => {
  test("BatchHelperModals and BatchTemplateModals stay aligned with daily settings", async () => {
    const helperModal = await readFile(
      new URL(
        "../src/components/BatchDaily/BatchHelperModals.vue",
        import.meta.url,
      ),
      "utf8",
    );
    const templateModal = await readFile(
      new URL(
        "../src/components/BatchDaily/BatchTemplateModals.vue",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(helperModal, /settingsDraft\.claimLegacy/);
    assert.match(templateModal, /templateDraft\.claimLegacy/);
    assert.match(templateModal, /templateDraft\.weeklyQuizEnabled/);
    assert.match(templateModal, /templateDraft\.dreamShopPurchase/);
  });

  test("DailyTaskRunner skips bottlehelper_stop when bottle is already stopped and keeps box/blackmarket intact", async () => {
    const { DailyTaskRunner } = await loadModule(
      new URL("../src/utils/dailyTaskRunner.js", import.meta.url),
      {
        "@/utils/dailyTaskState":
          await import("../src/utils/dailyTaskState.js"),
        "@/utils/dailyTaskSettings":
          await import("../src/utils/dailyTaskSettings.js"),
        "./accountConnection.js":
          await import("../src/utils/accountConnection.js"),
        "./accountIdentity.js": accountIdentity,
        "./daily/arena.js": await import("../src/utils/daily/arena.js"),
        "./daily/dream.js": await import("../src/utils/daily/dream.js"),
        "./weeklyQuiz.js": await import("../src/utils/weeklyQuiz.js"),
      },
    );

    const calls = [];
    const role = {
      dailyTask: {
        dailyTime: 1700000000,
        complete: {
          1: -1,
          2: -1,
          3: -1,
          4: -1,
          5: -1,
          6: -1,
          7: 0,
          12: 0,
          13: -1,
          14: 0,
        },
        dailyPoint: 0,
        dailyReward: {},
        weekPoint: 0,
        weekReward: {},
      },
      bottleHelpers: { helperStopTime: 1699999000 },
      statistics: {
        "artifact:normal:lottery:time": 1700000010,
        "genie:sweep:buy": 3,
      },
      statisticsTime: {
        "genie:sweep:buy": 1700000010,
        "legion:sign:in": 1700000010,
        "genie:daily:free:1": 1700000010,
        "genie:daily:free:2": 1700000010,
        "genie:daily:free:3": 1700000010,
        "genie:daily:free:4": 1700000010,
      },
    };
    const store = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => ({ role: structuredClone(role) }),
      sendMessageWithPromise: async (_id, cmd, params) => {
        calls.push({ cmd, params });
        if (cmd === "presetteam_getinfo")
          return { presetTeamInfo: { useTeamId: 1 } };
        return {};
      },
    };
    const runner = new DailyTaskRunner(
      store,
      { commandDelay: 0, taskDelay: 0 },
      {
        loadConfig: async () => ({
          tasks: [
            [1, 1, 1],
            [2, 2, 1],
            [3, 3, 3],
            [4, 4, 2],
            [5, 5, 5],
            [6, 6, 3],
            [7, 7, 3],
            [8, 13, 1],
            [9, 12, 1],
            [10, 14, 1],
          ].map(([id, completeCondition, completeValue]) => ({
            id,
            completeCondition,
            completeValue,
          })),
          dailyRewards: [],
          weeklyRewards: [],
        }),
        sleep: async () => {},
        getCurrentHour: () => 10,
      },
    );

    await runner.run(
      "acc1",
      {},
      {
        arenaFormation: 1,
        bossFormation: 1,
        bossTimes: 0,
        claimBottle: true,
        payRecruit: false,
        openBox: true,
        arenaEnable: false,
        claimHangUp: false,
        claimLegacy: false,
        claimEmail: false,
        weeklyQuizEnabled: false,
        blackMarketPurchase: true,
        dreamShopPurchase: false,
        freeGachaEnable: false,
      },
    );

    assert.equal(
      calls.some((c) => c.cmd === "bottlehelper_stop"),
      false,
    );
    assert.equal(
      calls.some((c) => c.cmd === "bottlehelper_start"),
      true,
    );
    const boxCall = calls.find((c) => c.cmd === "item_openbox");
    const storeCall = calls.find((c) => c.cmd === "store_purchase");
    assert.equal(boxCall?.params?.itemId, 2001);
    assert.equal(boxCall?.params?.number, 10);
    assert.equal(storeCall?.params?.goodsId, 1);
  });
});

describe("Commit 3 performance and batch helper consolidation", () => {
  test("GameStatus lazy-loads ClubInfo", async () => {
    const src = await readFile(
      new URL("../src/components/GameStatus.vue", import.meta.url),
      "utf8",
    );
    assert.match(
      src,
      /const ClubInfo = lazySection\(\(\) => import\("\.\/Club\/ClubInfo\.vue"\)\)/,
    );
  });

  test("runBatchForAccounts snapshots selections, cleans up isRunning on throw, and warns on failure", async () => {
    const { runBatchForAccounts } =
      await import("../src/utils/batch/connectionManager.js");
    const notices = [];
    const selectedTokens = { value: ["a", "b"] };
    const tokenStatus = { value: {} };
    const isRunning = { value: false };
    const shouldStop = { value: false };
    const currentRunningTokenId = { value: "a" };

    const result = await runBatchForAccounts(
      {
        selectedTokens,
        tokens: {
          value: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
        },
        tokenStatus,
        isRunning,
        shouldStop,
        currentRunningTokenId,
        addLog() {},
        message: {
          success: (t) => notices.push(["success", t]),
          warning: (t) => notices.push(["warning", t]),
        },
        label: "测试任务",
        notifyOnFinish: true,
      },
      async ({ tokenId }) => {
        selectedTokens.value = [];
        tokenStatus.value[tokenId] = tokenId === "a" ? "completed" : "failed";
      },
    );

    assert.equal(isRunning.value, false);
    assert.equal(currentRunningTokenId.value, null);
    assert.deepEqual(result.tokenIds, ["a", "b"]);
    assert.equal(result.hasIncomplete, true);
    assert.equal(notices[0][0], "warning");
  });
});

describe("Commit 4 review regression fixes (P1 & P2)", () => {
  test("P1-1: BIN migration failure or updateToken=false keeps existing combUser, account record, and active socket intact", async () => {
    const db = new Map([
      ["temp-new-id", new Uint8Array([7, 8, 9]).buffer],
      ["orig-id", new Uint8Array([1, 2]).buffer],
    ]);
    const closed = [];
    const tokens = [
      {
        id: "orig-id",
        name: "主号",
        roleId: "123456",
        server: "10服",
        token: "old-token",
        importMethod: "wxQrcode",
        combUser: { keepMe: true },
      },
    ];
    const tokenStore = {
      gameTokens: tokens,
      selectedTokenId: "orig-id",
      getWebSocketStatus: () => "connected",
      closeWebSocketConnection: (id) => closed.push(id),
      updateToken: (id, updates) => {
        const idx = tokens.findIndex((t) => t.id === id);
        tokens[idx] = { ...tokens[idx], ...updates };
        return true;
      },
      addToken: (role) => role,
    };

    // Case A: storeArrayBuffer returns false -> reject without clearing combUser or closing connection
    await assert.rejects(
      upsertImportedRoleTokens({
        roles: [
          {
            id: "temp-new-id",
            name: "新名字",
            roleId: 123456,
            server: "10服",
            token: "new-token",
            importMethod: "wxQrcode",
          },
        ],
        tokenStore,
        getArrayBuffer: async (key) => db.get(key) ?? null,
        storeArrayBuffer: async () => false,
        deleteArrayBuffer: async (key) => db.delete(key),
      }),
      /写入账号 BIN 凭据失败/,
    );
    assert.deepEqual(tokens[0].combUser, { keepMe: true });
    assert.equal(tokens[0].token, "old-token");
    assert.deepEqual(closed, []);
    assert.equal(db.has("temp-new-id"), true);

    // Case B: missing staged BIN -> reject without touching account
    await assert.rejects(
      upsertImportedRoleTokens({
        roles: [
          {
            id: "missing-temp-id",
            name: "新名字",
            roleId: 123456,
            server: "10服",
            token: "new-token",
            importMethod: "bin",
          },
        ],
        tokenStore,
        getArrayBuffer: async (key) => db.get(key) ?? null,
        storeArrayBuffer: async (key, buf) => {
          db.set(key, buf);
          return true;
        },
        deleteArrayBuffer: async (key) => db.delete(key),
      }),
      /未找到新的 BIN 凭据数据/,
    );
    assert.deepEqual(tokens[0].combUser, { keepMe: true });
    assert.deepEqual(closed, []);

    // Case C: updateToken returns false -> roll back BIN on orig-id and keep temp BIN & socket
    tokenStore.updateToken = () => false;
    await assert.rejects(
      upsertImportedRoleTokens({
        roles: [
          {
            id: "temp-new-id",
            name: "新名字",
            roleId: 123456,
            server: "10服",
            token: "new-token",
            importMethod: "wxQrcode",
          },
        ],
        tokenStore,
        getArrayBuffer: async (key) => db.get(key) ?? null,
        storeArrayBuffer: async (key, buf) => {
          db.set(key, buf);
          return true;
        },
        deleteArrayBuffer: async (key) => db.delete(key),
      }),
      /更新已有账号记录失败/,
    );
    assert.deepEqual(Array.from(new Uint8Array(db.get("orig-id"))), [1, 2]);
    assert.equal(db.has("temp-new-id"), true);
    assert.deepEqual(closed, []);
  });

  test("P1-2: stale async combUser refresh cannot overwrite freshly re-logged-in credentials or stamp stale errors", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const logger = new Proxy({}, { get: () => () => {} });
    const storageMap = new Map();
    const clients = [];
    const recoveryTimers = new Map();
    let nextRecoveryTimer = 0;
    let resolveCombRefresh;
    let rejectCombRefresh;
    let combAttempts = 0;
    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": { useLocalStorage: (_k, v) => vue.ref(v) },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async () => null,
            storeArrayBuffer: async () => true,
            deleteArrayBuffer: async () => true,
            clearAll: async () => true,
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/dashboard" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: (fn, delay) => {
                const id = ++nextRecoveryTimer;
                recoveryTimers.set(id, { fn, delay });
                return id;
              },
              clearTimer: (id) => recoveryTimers.delete(id),
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () => "",
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: () => {
            combAttempts++;
            return new Promise((resolve, reject) => {
              resolveCombRefresh = resolve;
              rejectCombRefresh = reject;
            });
          },
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {
            constructor() {
              this.socket = { readyState: 1 };
              clients.push(this);
            }
            setMessageListener(fn) {
              this.listener = fn;
            }
            init() {
              this.onConnect();
            }
            disconnect() {
              if (this.socket) this.socket.readyState = 3;
              this.socket = null;
            }
            send() {}
            sendHeartbeat() {}
          },
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: {
          getItem: (k) => storageMap.get(k) ?? null,
          setItem: (k, v) => storageMap.set(k, String(v)),
          removeItem: (k) => storageMap.delete(k),
        },
        navigator: { onLine: true },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );

    const store = mod.useTokenStore();
    try {
      mod.gameTokens.value = [
        {
          id: "acc1",
          name: "主号",
          roleId: "1001",
          token: "old-expired-token-long",
          importMethod: "wxForceLogout",
          combUser: { oldComb: true },
          serverId: 37,
          roleIndex: 0,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ];
      mod.selectedTokenId.value = "acc1";
      await store.createWebSocketConnection("acc1", "old-expired-token-long");
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(store.getWebSocketStatus("acc1"), "connected");

      // Trigger background combUser refresh via token expired message
      clients[0].listener({ error: "token expired" });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(combAttempts, 1);
      assert.equal(typeof resolveCombRefresh, "function");

      // Meanwhile user completes fresh QR login in place on the same tokenId
      store.updateToken("acc1", {
        token: "fresh-qr-token-long",
        importMethod: "wxQrcode",
        combUser: null,
        lastRefreshed: Date.now(),
      });

      // Late old combUser refresh finally resolves -> must NOT overwrite fresh credentials
      resolveCombRefresh({
        token: "stale-comb-refreshed-token",
        role: { serverId: 37, roleId: "1001" },
      });
      await new Promise((r) => setTimeout(r, 10));

      const latest = mod.gameTokens.value[0];
      assert.equal(latest.token, "fresh-qr-token-long");
      assert.equal(latest.importMethod, "wxQrcode");
      assert.equal(latest.combUser, null);
      assert.equal(typeof rejectCombRefresh, "function");
    } finally {
      pinia._e.stop();
    }
  });

  test("P1-3: ensureBattleVersion deduplicates per socket, ignores replaced sockets, and DailyTaskRunner defers combat when version is unconfirmed", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const logger = new Proxy({}, { get: () => () => {} });
    const storageMap = new Map();
    const clients = [];
    const fightCalls = [];
    const resolvers = [];
    const recoveryTimers = new Map();
    let nextRecoveryTimer = 0;
    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": { useLocalStorage: (_k, v) => vue.ref(v) },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async () => null,
            storeArrayBuffer: async () => true,
            deleteArrayBuffer: async () => true,
            clearAll: async () => true,
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/dashboard" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: (fn, delay) => {
                const id = ++nextRecoveryTimer;
                recoveryTimers.set(id, { fn, delay });
                return id;
              },
              clearTimer: (id) => recoveryTimers.delete(id),
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () => "",
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: async () => ({}),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {
            constructor() {
              this.socket = { readyState: 1, tag: clients.length + 1 };
              clients.push(this);
            }
            setMessageListener(fn) {
              this.listener = fn;
            }
            init() {
              this.onConnect();
            }
            disconnect() {
              if (this.socket) this.socket.readyState = 3;
              this.socket = null;
            }
            send() {}
            sendWithPromise(cmd) {
              fightCalls.push(cmd);
              return new Promise((resolve) => resolvers.push(resolve));
            }
            sendHeartbeat() {}
          },
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: {
          getItem: (k) => storageMap.get(k) ?? null,
          setItem: (k, v) => storageMap.set(k, String(v)),
          removeItem: (k) => storageMap.delete(k),
        },
        navigator: { onLine: true },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );

    const store = mod.useTokenStore();
    try {
      mod.gameTokens.value = [
        { id: "acc1", name: "主号", token: "valid-token-long-1" },
      ];
      mod.selectedTokenId.value = "acc1";
      await store.createWebSocketConnection("acc1", "valid-token-long-1");
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(store.getWebSocketStatus("acc1"), "connected");

      // Concurrent calls from Dashboard + GameFeatures share one fight_startlevel request
      const p1 = store.ensureBattleVersion("acc1");
      const p2 = store.ensureBattleVersion("acc1");
      assert.equal(fightCalls.length, 1);
      resolvers.shift()({ battleData: { version: 777 } });
      assert.deepEqual(await Promise.all([p1, p2]), [777, 777]);

      // Subsequent page navigation reuses cached version without sending fight_startlevel again
      assert.equal(await store.ensureBattleVersion("acc1"), 777);
      assert.equal(fightCalls.length, 1);

      // If socket is replaced while fight_startlevel is in flight, stale response is ignored
      store.setBattleVersion(null, "acc1");
      const staleReq = store.ensureBattleVersion("acc1");
      assert.equal(fightCalls.length, 2);
      clients[0].socket = { readyState: 1, tag: "replacement-socket" };
      resolvers.shift()({ battleData: { version: 999 } });
      assert.equal(await staleReq, null);
      assert.equal(store.getAccountGameData("acc1").value.battleVersion, null);

      // Restored connection with null battleVersion skips fight_startlevel and DailyTaskRunner defers combat steps
      store.connectionRecoveryStatus.acc1 = "restored";
      assert.equal(await store.ensureBattleVersion("acc1"), null);
      assert.equal(fightCalls.length, 2);

      const { DailyTaskRunner } = await loadModule(
        new URL("../src/utils/dailyTaskRunner.js", import.meta.url),
        {
          "@/utils/dailyTaskState":
            await import("../src/utils/dailyTaskState.js"),
          "@/utils/dailyTaskSettings":
            await import("../src/utils/dailyTaskSettings.js"),
          "./accountConnection.js":
            await import("../src/utils/accountConnection.js"),
          "./accountIdentity.js": accountIdentity,
          "./daily/arena.js": await import("../src/utils/daily/arena.js"),
          "./daily/dream.js": await import("../src/utils/daily/dream.js"),
          "./weeklyQuiz.js": await import("../src/utils/weeklyQuiz.js"),
        },
      );
      const runnerCalls = [];
      const role = {
        dailyTask: {
          dailyTime: 1700000000,
          complete: {
            1: -1,
            2: -1,
            3: -1,
            4: -1,
            5: -1,
            6: -1,
            7: -1,
            12: -1,
            13: 0,
            14: -1,
          },
          dailyPoint: 0,
          dailyReward: {},
          weekPoint: 0,
          weekReward: {},
        },
        statistics: {
          "artifact:normal:lottery:time": 1700000010,
          "genie:sweep:buy": 3,
        },
        statisticsTime: {
          "genie:sweep:buy": 1700000010,
          "legion:sign:in": 1700000010,
          "genie:daily:free:1": 1700000010,
          "genie:daily:free:2": 1700000010,
          "genie:daily:free:3": 1700000010,
          "genie:daily:free:4": 1700000010,
        },
      };
      const runnerStore = {
        gameTokens: [{ id: "acc1", name: "主号" }],
        selectedToken: { id: "acc1" },
        wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
        getWebSocketStatus: () => "connected",
        getAccountGameData: () => vue.ref({ battleVersion: null }),
        ensureBattleVersion: async () => null,
        sendGetRoleInfo: async () => ({ role: structuredClone(role) }),
        sendMessageWithPromise: async (_id, cmd, params) => {
          runnerCalls.push({ cmd, params });
          return {};
        },
      };
      const runner = new DailyTaskRunner(
        runnerStore,
        { commandDelay: 0, taskDelay: 0 },
        {
          loadConfig: async () => ({
            tasks: [
              [1, 1, 1],
              [2, 2, 1],
              [3, 3, 3],
              [4, 4, 2],
              [5, 5, 5],
              [6, 6, 3],
              [7, 7, 3],
              [8, 13, 1],
              [9, 12, 1],
              [10, 14, 1],
            ].map(([id, completeCondition, completeValue]) => ({
              id,
              completeCondition,
              completeValue,
            })),
            dailyRewards: [],
            weeklyRewards: [],
          }),
          sleep: async () => {},
          getCurrentHour: () => 10,
        },
      );
      const summary = await runner.run(
        "acc1",
        {},
        {
          arenaFormation: 1,
          bossFormation: 1,
          bossTimes: 2,
          claimBottle: false,
          payRecruit: false,
          openBox: false,
          arenaEnable: true,
          claimHangUp: false,
          claimLegacy: false,
          claimEmail: false,
          weeklyQuizEnabled: false,
          blackMarketPurchase: false,
          dreamShopPurchase: false,
          freeGachaEnable: false,
        },
      );
      assert.equal(
        runnerCalls.some((c) =>
          [
            "fight_startareaarena",
            "fight_startlegionboss",
            "fight_startboss",
          ].includes(c.cmd),
        ),
        false,
      );
      assert.ok(summary.deferred > 0);
      assert.ok(summary.incomplete > 0);
    } finally {
      pinia._e.stop();
    }
  });

  test("P1-4: renaming and saving an old template without dreamShopPurchase preserves account's disabled setting", async () => {
    const src = await readFile(
      new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
      "utf8",
    );
    const { descriptor } = parse(src);
    const script = compileScript(descriptor, { id: "batch-template-inherit" });
    const { outputText } = ts.transpileModule(script.content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: "BatchDailyTasks.vue",
    });

    const settingsMod = await import("../src/utils/dailyTaskSettings.js");
    const storageMap = new Map();
    const storage = {
      getItem: (k) => storageMap.get(k) ?? null,
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
    };
    const token = { id: "acc1", roleId: "1001", name: "主号" };
    // Existing account explicitly turned OFF dreamShopPurchase
    settingsMod.writeDailyTaskSettings(
      token,
      { dreamShopPurchase: false, weeklyQuizEnabled: false },
      storage,
    );
    // Legacy template missing dreamShopPurchase / weeklyQuizEnabled / claimLegacy
    storage.setItem(
      "task-templates",
      JSON.stringify([
        {
          id: "tpl-old",
          name: "旧日常模板",
          settings: {
            arenaFormation: 2,
            towerFormation: 1,
            bossFormation: 2,
            bossTimes: 2,
            claimBottle: true,
            payRecruit: true,
            openBox: true,
            arenaEnable: true,
            claimHangUp: true,
            claimEmail: true,
            blackMarketPurchase: true,
          },
        },
      ]),
    );

    const factoryProxy = new Proxy({}, { get: () => () => ({}) });
    const deps = {
      "@vicons/ionicons5": { Settings: {} },
      "naive-ui": {
        useMessage: () => new Proxy({}, { get: () => () => {} }),
      },
      "@/components/BatchDaily/BatchApplyLegionModal.vue": { default: {} },
      "@/components/BatchDaily/BatchBlackMarketModal.vue": { default: {} },
      "@/components/BatchDaily/BatchDreamBuyModal.vue": { default: {} },
      "@/components/BatchDaily/BatchGlobalSettingsModal.vue": { default: {} },
      "@/components/BatchDaily/BatchGroupManageModal.vue": { default: {} },
      "@/components/BatchDaily/BatchHelperModals.vue": { default: {} },
      "@/components/BatchDaily/BatchLogPanel.vue": { default: {} },
      "@/components/BatchDaily/BatchScheduleModals.vue": { default: {} },
      "@/components/BatchDaily/BatchTemplateModals.vue": { default: {} },
      "@/components/BatchDaily/BatchWarGuessModal.vue": { default: {} },
      "@/composables/batch/useBatchLegionModals": {
        useBatchLegionModals: () => ({}),
      },
      "@/composables/batch/useBatchTokenGroups": {
        useBatchTokenGroups: () => ({}),
      },
      "@/hooks/useShanghaiClock": { useShanghaiClock: () => vue.ref(0) },
      "@/stores/events/index.ts": {
        $emit: { on() {}, off() {}, emit() {} },
      },
      "@/stores/tokenStore": {
        gameTokens: vue.ref([token]),
        tokenGroups: vue.ref([]),
        useTokenStore: () => ({
          gameTokens: [token],
          tokenGroups: [],
          wsConnections: {},
          getWebSocketStatus: () => "disconnected",
          initConnectionCoordination() {},
        }),
      },
      "@/utils/batch": new Proxy(
        {
          availableTasks: [],
          bossTimesOptions: [],
          boxTypeOptions: [],
          fishTypeOptions: [],
          formationOptions: [],
        },
        {
          get(target, prop) {
            return Object.hasOwn(target, prop) ? target[prop] : () => ({});
          },
        },
      ),
      "@/utils/batch/blackMarketConfig": {
        blackMarketItemCatalog: [],
        createBlackMarketPurchaseEntry: () => ({}),
        defaultBlackMarketPurchaseList: [],
        normalizeBlackMarketPurchaseList: () => [],
      },
      "@/utils/batch/configBackup": factoryProxy,
      "@/utils/batch/connectionManager": {
        createConnectionManager: () => ({}),
        withManagedConnection: async () => {},
      },
      "@/utils/batch/scheduledClock": factoryProxy,
      "@/utils/batch/scheduledRuns": {
        createScheduledRunQueue: () => ({
          close() {},
          cancelPending() {},
          enqueue: () => Promise.resolve(),
        }),
        summarizeScheduledRun: () => ({}),
      },
      "@/utils/daily/runDailyTasks.js": factoryProxy,
      "@/utils/dailyTaskSettings": {
        ...settingsMod,
        readDailyTaskSettings: (t, ts) =>
          settingsMod.readDailyTaskSettings(t, ts, storage),
        readDailyTaskSettingsForExecution: (t, ts) =>
          settingsMod.readDailyTaskSettingsForExecution(t, ts, storage),
        writeDailyTaskSettings: (t, v) =>
          settingsMod.writeDailyTaskSettings(t, v, storage),
        resetDailyTaskSettings: (t) =>
          settingsMod.resetDailyTaskSettings(t, storage),
      },
      "@/utils/dreamConstants": {
        goldItemsConfig: [],
        isDungeonOpen: () => false,
      },
      "@/utils/batch/viewHelpers": factoryProxy,
      "@/utils/dailyTaskState": factoryProxy,
      "@/utils/dailyTaskRunner": factoryProxy,
      "@/utils/accountIdentity.js": accountIdentity,
      vue: { ...vue, onMounted() {}, onUnmounted() {} },
    };

    const exports = {};
    vm.runInNewContext(outputText, {
      exports,
      console,
      localStorage: storage,
      window: { addEventListener() {}, removeEventListener() {} },
      document: { visibilityState: "visible" },
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      clearInterval() {},
      require(name) {
        if (Object.hasOwn(deps, name)) return deps[name];
        return factoryProxy;
      },
    });

    const scope = vue.effectScope(true);
    let bindings;
    scope.run(() => {
      bindings = exports.default.setup({}, { expose() {} });
    });

    try {
      const [oldTpl] = bindings.loadTaskTemplates();
      bindings.openEditTemplateModal(oldTpl);
      assert.equal(bindings.currentTemplate.dreamShopPurchase, "inherit");
      assert.equal(bindings.currentTemplate.weeklyQuizEnabled, "inherit");

      // Rename only and save
      bindings.saveTaskTemplateFromModal({
        name: "旧日常模板-改名",
        settings: { ...bindings.currentTemplate },
      });

      const [savedTpl] = JSON.parse(storage.getItem("task-templates"));
      assert.equal(savedTpl.name, "旧日常模板-改名");
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          savedTpl.settings,
          "dreamShopPurchase",
        ),
        false,
      );

      // Re-apply renamed template -> account's dreamShopPurchase stays false!
      bindings.selectedTemplateId.value = savedTpl.id;
      bindings.selectedTokensForApply.value = ["acc1"];
      bindings.applyTemplate();

      const afterApply = settingsMod.readDailyTaskSettings(
        token,
        [token],
        storage,
      );
      assert.equal(afterApply.dreamShopPurchase, false);
      assert.equal(afterApply.weeklyQuizEnabled, false);
      assert.equal(afterApply.arenaFormation, 2);

      // Explicit opt-in to dreamShopPurchase=true writes boolean and applies it
      bindings.openEditTemplateModal(savedTpl);
      bindings.saveTaskTemplateFromModal({
        name: "显式开启梦境模板",
        settings: { ...bindings.currentTemplate, dreamShopPurchase: true },
      });
      bindings.selectedTemplateId.value = savedTpl.id;
      bindings.selectedTokensForApply.value = ["acc1"];
      bindings.applyTemplate();
      assert.equal(
        settingsMod.readDailyTaskSettings(token, [token], storage)
          .dreamShopPurchase,
        true,
      );
    } finally {
      scope.stop();
    }
  });

  test("P2-1: salt bottle restarts on intact connection if stopped right after bottlehelper_stop, and does not skip stop when serverTime is missing", async () => {
    const { DailyTaskRunner } = await loadModule(
      new URL("../src/utils/dailyTaskRunner.js", import.meta.url),
      {
        "@/utils/dailyTaskState":
          await import("../src/utils/dailyTaskState.js"),
        "@/utils/dailyTaskSettings":
          await import("../src/utils/dailyTaskSettings.js"),
        "./accountConnection.js":
          await import("../src/utils/accountConnection.js"),
        "./accountIdentity.js": accountIdentity,
        "./daily/arena.js": await import("../src/utils/daily/arena.js"),
        "./daily/dream.js": await import("../src/utils/daily/dream.js"),
        "./weeklyQuiz.js": await import("../src/utils/weeklyQuiz.js"),
      },
    );

    const makeRole = (helperStopTime) => ({
      dailyTask: {
        dailyTime: 1700000000,
        complete: {
          1: -1,
          2: -1,
          3: -1,
          4: -1,
          5: -1,
          6: -1,
          7: -1,
          12: -1,
          13: -1,
          14: 0,
        },
        dailyPoint: 0,
        dailyReward: {},
        weekPoint: 0,
        weekReward: {},
      },
      bottleHelpers: { helperStopTime },
      statistics: {
        "artifact:normal:lottery:time": 1700000010,
        "genie:sweep:buy": 3,
      },
      statisticsTime: {
        "genie:sweep:buy": 1700000010,
        "legion:sign:in": 1700000010,
        "genie:daily:free:1": 1700000010,
        "genie:daily:free:2": 1700000010,
        "genie:daily:free:3": 1700000010,
        "genie:daily:free:4": 1700000010,
      },
    });
    const config = {
      tasks: [
        [1, 1, 1],
        [2, 2, 1],
        [3, 3, 3],
        [4, 4, 2],
        [5, 5, 5],
        [6, 6, 3],
        [7, 7, 3],
        [8, 13, 1],
        [9, 12, 1],
        [10, 14, 1],
      ].map(([id, completeCondition, completeValue]) => ({
        id,
        completeCondition,
        completeValue,
      })),
      dailyRewards: [],
      weeklyRewards: [],
    };
    const bottleOnlySettings = {
      arenaFormation: 1,
      bossFormation: 1,
      bossTimes: 0,
      claimBottle: true,
      payRecruit: false,
      openBox: false,
      arenaEnable: false,
      claimHangUp: false,
      claimLegacy: false,
      claimEmail: false,
      weeklyQuizEnabled: false,
      blackMarketPurchase: false,
      dreamShopPurchase: false,
      freeGachaEnable: false,
    };

    // Subcase A: user requests stop right as bottlehelper_stop resolves -> must still send bottlehelper_start, skip claim
    const callsA = [];
    let stopRequested = false;
    const storeA = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => ({ role: makeRole(1700009000) }),
      sendMessageWithPromise: async (_id, cmd) => {
        callsA.push(cmd);
        if (cmd === "bottlehelper_stop") stopRequested = true;
        return {};
      },
    };
    const runnerA = new DailyTaskRunner(
      storeA,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerA.run(
        "acc1",
        { shouldStop: () => stopRequested },
        bottleOnlySettings,
      ),
      /任务已停止/,
    );
    assert.deepEqual(callsA, ["bottlehelper_stop", "bottlehelper_start"]);

    // Subcase B: serverTime is missing and helperStopTime is behind Date.now() -> must NOT skip bottlehelper_stop
    const callsB = [];
    const storeB = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: null } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => ({ role: makeRole(1700000500) }),
      sendMessageWithPromise: async (_id, cmd) => {
        callsB.push(cmd);
        if (cmd === "presetteam_getinfo")
          return { presetTeamInfo: { useTeamId: 1 } };
        return {};
      },
    };
    const runnerB = new DailyTaskRunner(
      storeB,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await runnerB.run("acc1", {}, bottleOnlySettings);
    assert.ok(callsB.includes("bottlehelper_stop"));
    assert.ok(callsB.includes("bottlehelper_start"));
    assert.ok(callsB.includes("bottlehelper_claim"));

    // Subcase C: connection drops right after bottlehelper_stop -> never send start on broken connection and emit explicit warning/error
    const callsC = [];
    const logsC = [];
    let connectedC = true;
    const storeC = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => (connectedC ? "connected" : "disconnected"),
      sendGetRoleInfo: async () => ({ role: makeRole(1700009000) }),
      sendMessageWithPromise: async (_id, cmd) => {
        callsC.push(cmd);
        if (cmd === "bottlehelper_stop") connectedC = false;
        return {};
      },
    };
    const runnerC = new DailyTaskRunner(
      storeC,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerC.run(
        "acc1",
        { onLog: (entry) => logsC.push(entry) },
        bottleOnlySettings,
      ),
      /WebSocket 已断开/,
    );
    assert.deepEqual(callsC, ["bottlehelper_stop"]);
    assert.ok(logsC.some((entry) => /盐罐已停止/.test(entry.message)));
  });

  test("P2-2: useIndexedDB retries after initial open failure and does not hang when blocked", async () => {
    let attempts = 0;
    const fakeStore = new Map([
      ["k1", { id: "k1", data: new Uint8Array([4, 5]).buffer }],
    ]);
    const { default: useIndexedDB } = await loadModule(
      new URL("../src/hooks/useIndexedDB.ts", import.meta.url),
      {
        idb: {
          openDB: async (_name, _ver, handlers) => {
            attempts++;
            if (attempts === 1) throw new Error("transient failure");
            if (attempts === 2) {
              // Simulate another tab blocking openDB forever
              handlers?.blocked?.();
              return new Promise(() => {});
            }
            return {
              get: async (_s, key) => fakeStore.get(key) ?? null,
              put: async () => {},
              getAllKeys: async () => Array.from(fakeStore.keys()),
              delete: async () => {},
              clear: async () => {},
              getAll: async () => Array.from(fakeStore.values()),
            };
          },
        },
        vue,
      },
      { setTimeout, clearTimeout },
    );

    const idb = useIndexedDB({ openTimeoutMs: 50 });
    // Attempt 1 fails -> returns null
    assert.equal(await idb.getArrayBuffer("k1"), null);
    // Attempt 2 triggers blocked() -> resolves cleanly to null without hanging
    assert.equal(await idb.getArrayBuffer("k1"), null);
    assert.match(idb.error.value || "", /阻塞/);
    // Attempt 3 succeeds on the same hook instance!
    const buf = await idb.getArrayBuffer("k1");
    assert.deepEqual(Array.from(new Uint8Array(buf)), [4, 5]);
    assert.equal(attempts, 3);
  });

  test("P2-3: serverClock advances monotonically between heartbeats and cards clear stale state when switching accounts", async () => {
    const sample = createServerTimeSample(1700000000000, 1000);
    // Re-sampling unchanged serverTime preserves original monotonic anchor
    const unchanged = updateServerTimeSample(sample, 1700000000000, 6000);
    assert.equal(unchanged.sampledAtMs, 1000);
    // Advancing monotonic clock by 10s advances estimated server time by 10s
    assert.equal(getEstimatedServerNowSec(unchanged, 0, 11000), 1700000010);

    // Verify BottleHelperCard clears stale state when switching to account without bottle data
    const bottleSrc = await readFile(
      new URL("../src/components/cards/BottleHelperCard.vue", import.meta.url),
      "utf8",
    );
    const { descriptor: bottleDesc } = parse(bottleSrc);
    const bottleScript = compileScript(bottleDesc, { id: "bottle-card-test" });
    const { outputText: bottleCode } = ts.transpileModule(
      bottleScript.content,
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    );
    const serverClockMod = await import("../src/utils/serverClock.js");
    const store = vue.reactive({
      selectedToken: { id: "a" },
      wsConnections: { a: { client: { serverTime: 1700000000000 } } },
      gameData: {
        roleInfo: { role: { bottleHelpers: { helperStopTime: 1700003600 } } },
      },
      getWebSocketStatus: () => "connected",
    });
    const bottleExports = {};
    vm.runInNewContext(bottleCode, {
      exports: bottleExports,
      console,
      document: {
        visibilityState: "visible",
        addEventListener() {},
        removeEventListener() {},
      },
      setInterval: () => 1,
      clearInterval() {},
      require(name) {
        if (name === "vue") return { ...vue, onMounted() {}, onUnmounted() {} };
        if (name === "naive-ui")
          return { useMessage: () => new Proxy({}, { get: () => () => {} }) };
        if (name === "@/stores/tokenStore")
          return { useTokenStore: () => store };
        if (name === "@/utils/serverClock") return serverClockMod;
        if (name === "@/utils/standaloneDailyActions")
          return { runStandaloneDailyAction: async () => ({}) };
        if (name === "../Common/MyCard.vue") return { default: {} };
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    const scope = vue.effectScope(true);
    let bottleBindings;
    scope.run(() => {
      bottleBindings = bottleExports.default.setup(
        { disabled: false },
        { expose() {} },
      );
    });
    assert.equal(bottleBindings.state.value.isRunning, true);
    assert.ok(bottleBindings.state.value.remainingTime > 0);
    // Switch to account B which has no bottleHelpers data yet
    store.selectedToken = { id: "b" };
    store.gameData.roleInfo = { role: {} };
    await vue.nextTick();
    assert.equal(bottleBindings.state.value.isRunning, false);
    assert.equal(bottleBindings.state.value.remainingTime, 0);
    assert.equal(bottleBindings.state.value.stopTime, 0);
    scope.stop();

    // Verify HangUpStatusCard clears stale state when switching to account without hangUp data
    const hangUpSrc = await readFile(
      new URL("../src/components/cards/HangUpStatusCard.vue", import.meta.url),
      "utf8",
    );
    const { descriptor: hangUpDesc } = parse(hangUpSrc);
    const hangUpScript = compileScript(hangUpDesc, { id: "hangup-card-test" });
    const { outputText: hangUpCode } = ts.transpileModule(
      hangUpScript.content,
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    );
    const hangUpStore = vue.reactive({
      selectedToken: { id: "a" },
      wsConnections: { a: { client: { serverTime: 1700000000000 } } },
      gameData: {
        roleInfo: {
          role: { hangUp: { lastTime: 1699999000, hangUpTime: 28800 } },
        },
      },
      getWebSocketStatus: () => "connected",
    });
    const hangUpExports = {};
    vm.runInNewContext(hangUpCode, {
      exports: hangUpExports,
      console,
      document: {
        visibilityState: "visible",
        addEventListener() {},
        removeEventListener() {},
      },
      setInterval: () => 1,
      clearInterval() {},
      require(name) {
        if (name === "vue") return { ...vue, onMounted() {}, onUnmounted() {} };
        if (name === "naive-ui")
          return { useMessage: () => new Proxy({}, { get: () => () => {} }) };
        if (name === "@/stores/tokenStore")
          return { useTokenStore: () => hangUpStore };
        if (name === "@/utils/serverClock") return serverClockMod;
        if (name === "@/utils/standaloneDailyActions")
          return { runStandaloneDailyAction: async () => ({}) };
        if (name === "../Common/MyCard.vue") return { default: {} };
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    const hangUpScope = vue.effectScope(true);
    let hangUpBindings;
    hangUpScope.run(() => {
      hangUpBindings = hangUpExports.default.setup(
        { disabled: false },
        { expose() {} },
      );
    });
    assert.equal(hangUpBindings.hangUp.value.isActive, true);
    assert.ok(hangUpBindings.hangUp.value.remainingTime > 0);
    hangUpStore.selectedToken = { id: "b" };
    hangUpStore.gameData.roleInfo = { role: {} };
    await vue.nextTick();
    assert.equal(hangUpBindings.hangUp.value.isActive, false);
    assert.equal(hangUpBindings.hangUp.value.remainingTime, 0);
    assert.equal(hangUpBindings.hangUp.value.elapsedTime, 0);
    hangUpScope.stop();
  });

  test("P1-3 & P2-2 source guards: pages defer auto-connect while recovery is waiting and SingleBinTokenForm catches reader errors", async () => {
    const dashboardSrc = await readFile(
      new URL("../src/views/Dashboard.vue", import.meta.url),
      "utf8",
    );
    const gameFeaturesSrc = await readFile(
      new URL("../src/views/GameFeatures.vue", import.meta.url),
      "utf8",
    );
    const singleBinSrc = await readFile(
      new URL(
        "../src/views/TokenImport/SingleBinTokenForm.vue",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      dashboardSrc,
      /connectionRecoveryStatus\?\.\[selected\.id\] !== "waiting"/,
    );
    assert.match(
      gameFeaturesSrc,
      /connectionRecoveryStatus\?\.\[tokenId\] !== "waiting"/,
    );
    assert.match(
      singleBinSrc,
      /tQueue\.add\(async \(\) => \{\s*try \{[\s\S]*?reader\.onerror = \(\) => reject/,
    );
    assert.match(singleBinSrc, /upsertImportedRoleTokens/);
  });

  test("P2-5: runBatchForAccounts waits for slow accounts before unlocking isRunning when a fast account throws", async () => {
    const { runBatchForAccounts } =
      await import("../src/utils/batch/connectionManager.js");
    const selectedTokens = { value: ["fast", "slow"] };
    const tokenStatus = { value: {} };
    const isRunning = { value: false };
    const shouldStop = { value: false };
    const currentRunningTokenId = { value: null };
    const logs = [];
    let finishSlow;

    const batchPromise = runBatchForAccounts(
      {
        selectedTokens,
        tokens: {
          value: [
            { id: "fast", name: "快号" },
            { id: "slow", name: "慢号" },
          ],
        },
        tokenStatus,
        isRunning,
        shouldStop,
        currentRunningTokenId,
        addLog: (entry) => logs.push(entry),
        label: "并发测试",
      },
      async ({ tokenId }) => {
        if (tokenId === "fast") {
          throw new Error("fast boom");
        }
        await new Promise((resolve) => {
          finishSlow = resolve;
        });
        tokenStatus.value[tokenId] = "completed";
      },
    );

    // Allow fast account to throw and settle
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(tokenStatus.value.fast, "failed");
    assert.equal(isRunning.value, true);

    // Concurrent re-entry must be blocked while slow account is still running
    const blocked = await runBatchForAccounts(
      {
        selectedTokens,
        tokens: { value: [] },
        tokenStatus,
        isRunning,
        shouldStop,
        currentRunningTokenId,
        addLog() {},
        label: "并发测试",
      },
      async () => {},
    );
    assert.equal(blocked, null);

    finishSlow();
    const summary = await batchPromise;
    assert.equal(isRunning.value, false);
    assert.equal(tokenStatus.value.slow, "completed");
    assert.equal(summary.hasIncomplete, true);
    assert.ok(logs.some((entry) => /fast boom/.test(entry.message)));
  });
});

describe("Commit 5 review round-2 regression fixes (4 P1 + 3 P2)", () => {
  test("Round2 P1-1: extractAuthenticatedRoleId ignores untrusted filenames and SingleBinTokenForm never matches by filename roleId", async () => {
    // Authenticated response carries role B (222222) even if file is named for role A (111111)
    assert.equal(
      extractAuthenticatedRoleId(
        JSON.stringify({ roleId: 222222, roleToken: "tok-b" }),
      ),
      "222222",
    );
    // When token JSON lacks roleId, unambiguous serverId match from authenticated serverRoles resolves it
    assert.equal(
      extractAuthenticatedRoleId(JSON.stringify({ roleToken: "tok-b" }), {
        binData: { serverId: 10037 },
        serverRoles: {
          10037: { serverId: 10037, roleId: 222222 },
          10038: { serverId: 10038, roleId: 111111 },
        },
      }),
      "222222",
    );
    // When neither auth token nor serverRoles confirms identity, return null (never fall back to filename)
    assert.equal(
      extractAuthenticatedRoleId(JSON.stringify({ roleToken: "tok-unknown" })),
      null,
    );

    const singleBinSrc = await readFile(
      new URL(
        "../src/views/TokenImport/SingleBinTokenForm.vue",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(singleBinSrc, /extractAuthenticatedRoleId/);
    assert.doesNotMatch(singleBinSrc, /roleMeta\.roleId\s*\?\s*\{\s*roleId:/);
  });

  test("Round2 P1-2: late old-name BIN migration and late manual refresh cannot overwrite freshly QR-imported BIN or Token", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const logger = new Proxy({}, { get: () => () => {} });
    const storageMap = new Map();
    const idbMap = new Map([
      ["主号", new Uint8Array([1, 1, 1]).buffer], // legacy name-keyed BIN
      ["temp-qr-id", new Uint8Array([9, 9, 9]).buffer], // fresh QR BIN
    ]);
    const clients = [];
    const recoveryTimers = new Map();
    let nextRecoveryTimer = 0;
    let resolveBinTransform;
    let resolveManualCombRefresh;

    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": { useLocalStorage: (_k, v) => vue.ref(v) },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async (k) => idbMap.get(k) ?? null,
            storeArrayBuffer: async (k, buf) => {
              idbMap.set(k, buf);
              return true;
            },
            deleteArrayBuffer: async (k) => idbMap.delete(k),
            clearAll: async () => idbMap.clear(),
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/dashboard" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: (fn, delay) => {
                const id = ++nextRecoveryTimer;
                recoveryTimers.set(id, { fn, delay });
                return id;
              },
              clearTimer: (id) => recoveryTimers.delete(id),
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: () =>
            new Promise((resolve) => {
              resolveBinTransform = resolve;
            }),
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: () =>
            new Promise((resolve) => {
              resolveManualCombRefresh = resolve;
            }),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {
            constructor() {
              this.socket = { readyState: 1 };
              clients.push(this);
            }
            setMessageListener(fn) {
              this.listener = fn;
            }
            init() {
              this.onConnect();
            }
            disconnect() {
              if (this.socket) this.socket.readyState = 3;
              this.socket = null;
            }
            send() {}
            sendHeartbeat() {}
          },
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: {
          getItem: (k) => storageMap.get(k) ?? null,
          setItem: (k, v) => storageMap.set(k, String(v)),
          removeItem: (k) => storageMap.delete(k),
        },
        navigator: { onLine: true },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );

    const store = mod.useTokenStore();
    try {
      // Case A: old-name BIN auto-refresh loses to concurrent QR upsert; fresh BIN under acc1 must NOT be overwritten
      mod.gameTokens.value = [
        {
          id: "acc1",
          name: "主号",
          roleId: "1001",
          token: "old-bin-token-long",
          importMethod: "bin",
          combUser: null,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ];
      mod.selectedTokenId.value = "acc1";
      await store.createWebSocketConnection("acc1", "old-bin-token-long");
      await new Promise((r) => setTimeout(r, 10));

      clients[0].listener({ error: "token expired" });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(typeof resolveBinTransform, "function");

      // User completes QR login in place on acc1 while old BIN refresh is in flight
      await upsertImportedRoleTokens({
        roles: [
          {
            id: "temp-qr-id",
            roleId: "1001",
            name: "主号",
            token: "fresh-qr-token-long",
            importMethod: "wxQrcode",
          },
        ],
        tokenStore: store,
        getArrayBuffer: async (k) => idbMap.get(k) ?? null,
        storeArrayBuffer: async (k, buf) => {
          idbMap.set(k, buf);
          return true;
        },
        deleteArrayBuffer: async (k) => idbMap.delete(k),
      });

      // Late old-name BIN refresh resolves (with matching roleId) -> still blocked by credential version, so neither acc1 token nor acc1 BIN is overwritten!
      resolveBinTransform(
        JSON.stringify({ roleId: "1001", roleToken: "stale-old-bin-token" }),
      );
      await new Promise((r) => setTimeout(r, 10));

      assert.equal(mod.gameTokens.value[0].token, "fresh-qr-token-long");
      assert.deepEqual(
        Array.from(new Uint8Array(idbMap.get("acc1"))),
        [9, 9, 9],
      );

      // Case B: manual refresh from TokenImport.vue is also guarded by credential version
      mod.gameTokens.value.push({
        id: "acc2",
        name: "小号",
        roleId: "2002",
        token: "old-comb-token-long",
        importMethod: "wxForceLogout",
        combUser: { old: true },
        serverId: 37,
        roleIndex: 0,
        createdAt: "2026-11-01T00:00:00.000Z",
      });
      const manualPromise = store.refreshTokenManually("acc2");
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(typeof resolveManualCombRefresh, "function");

      // Concurrent QR update on acc2
      store.updateToken("acc2", {
        token: "fresh-acc2-qr-token",
        importMethod: "wxQrcode",
        combUser: null,
      });

      resolveManualCombRefresh({
        token: "stale-manual-comb-token",
        role: { serverId: 37, roleId: "2002" },
      });
      const manualOutcome = await manualPromise;
      assert.equal(manualOutcome.status, "stale");
      assert.equal(mod.gameTokens.value[1].token, "fresh-acc2-qr-token");
      assert.equal(mod.gameTokens.value[1].importMethod, "wxQrcode");
    } finally {
      pinia._e.stop();
    }
  });

  test("Round2 P1-3: salt bottle recovery does not duplicate bottlehelper_start on in-flight stop or timeout", async () => {
    const { DailyTaskRunner } = await loadModule(
      new URL("../src/utils/dailyTaskRunner.js", import.meta.url),
      {
        "@/utils/dailyTaskState":
          await import("../src/utils/dailyTaskState.js"),
        "@/utils/dailyTaskSettings":
          await import("../src/utils/dailyTaskSettings.js"),
        "./accountConnection.js":
          await import("../src/utils/accountConnection.js"),
        "./accountIdentity.js": accountIdentity,
        "./daily/arena.js": await import("../src/utils/daily/arena.js"),
        "./daily/dream.js": await import("../src/utils/daily/dream.js"),
        "./weeklyQuiz.js": await import("../src/utils/weeklyQuiz.js"),
      },
    );

    const makeRole = (helperStopTime) => ({
      dailyTask: {
        dailyTime: 1700000000,
        complete: {
          1: -1,
          2: -1,
          3: -1,
          4: -1,
          5: -1,
          6: -1,
          7: -1,
          12: -1,
          13: -1,
          14: 0,
        },
        dailyPoint: 0,
        dailyReward: {},
        weekPoint: 0,
        weekReward: {},
      },
      bottleHelpers: { helperStopTime },
      statistics: {
        "artifact:normal:lottery:time": 1700000010,
        "genie:sweep:buy": 3,
      },
      statisticsTime: {
        "genie:sweep:buy": 1700000010,
        "legion:sign:in": 1700000010,
        "genie:daily:free:1": 1700000010,
        "genie:daily:free:2": 1700000010,
        "genie:daily:free:3": 1700000010,
        "genie:daily:free:4": 1700000010,
      },
    });
    const config = {
      tasks: [
        [1, 1, 1],
        [2, 2, 1],
        [3, 3, 3],
        [4, 4, 2],
        [5, 5, 5],
        [6, 6, 3],
        [7, 7, 3],
        [8, 13, 1],
        [9, 12, 1],
        [10, 14, 1],
      ].map(([id, completeCondition, completeValue]) => ({
        id,
        completeCondition,
        completeValue,
      })),
      dailyRewards: [],
      weeklyRewards: [],
    };
    const bottleOnlySettings = {
      arenaFormation: 1,
      bossFormation: 1,
      bossTimes: 0,
      claimBottle: true,
      payRecruit: false,
      openBox: false,
      arenaEnable: false,
      claimHangUp: false,
      claimLegacy: false,
      claimEmail: false,
      weeklyQuizEnabled: false,
      blackMarketPurchase: false,
      dreamShopPurchase: false,
      freeGachaEnable: false,
    };

    // Subcase A: user requests stop WHILE bottlehelper_start is in flight -> ack resolves -> only 1 start sent!
    const callsA = [];
    let stopA = false;
    const storeA = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => ({ role: makeRole(1700009000) }),
      sendMessageWithPromise: async (_id, cmd) => {
        callsA.push(cmd);
        if (cmd === "bottlehelper_start") {
          stopA = true; // requested while waiting for bottlehelper_start response
        }
        return {};
      },
    };
    const runnerA = new DailyTaskRunner(
      storeA,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerA.run("acc1", { shouldStop: () => stopA }, bottleOnlySettings),
      /任务已停止/,
    );
    assert.deepEqual(callsA, ["bottlehelper_stop", "bottlehelper_start"]);

    // Subcase B: bottlehelper_start times out, server query confirms bottle is ALREADY running -> NO 2nd start!
    const callsB = [];
    let roleQueriesB = 0;
    const storeB = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => {
        roleQueriesB++;
        return { role: makeRole(1700009000) }; // running!
      },
      sendMessageWithPromise: async (_id, cmd) => {
        callsB.push(cmd);
        if (cmd === "bottlehelper_start") throw new Error("请求超时");
        return {};
      },
    };
    const runnerB = new DailyTaskRunner(
      storeB,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerB.run("acc1", {}, bottleOnlySettings),
      /请求超时/,
    );
    assert.deepEqual(callsB, ["bottlehelper_stop", "bottlehelper_start"]);
    assert.ok(roleQueriesB >= 3);

    // Subcase C: bottlehelper_start times out, server query confirms bottle is STILL stopped -> sends 1 recovery start!
    const callsC = [];
    let roleQueriesC = 0;
    let startCountC = 0;
    const storeC = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => {
        roleQueriesC++;
        // Initial snapshots say running; post-timeout verification confirms still stopped!
        return {
          role: makeRole(roleQueriesC >= 3 ? 1699999000 : 1700009000),
        };
      },
      sendMessageWithPromise: async (_id, cmd) => {
        callsC.push(cmd);
        if (cmd === "bottlehelper_start" && ++startCountC === 1) {
          throw new Error("请求超时");
        }
        return {};
      },
    };
    const runnerC = new DailyTaskRunner(
      storeC,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerC.run("acc1", {}, bottleOnlySettings),
      /请求超时/,
    );
    assert.deepEqual(callsC, [
      "bottlehelper_stop",
      "bottlehelper_start",
      "bottlehelper_start",
    ]);
  });

  test("Round2 P1-4: BOSS group never fights without confirmed formation even if battleVersion succeeds on a later call", async () => {
    const { DailyTaskRunner } = await loadModule(
      new URL("../src/utils/dailyTaskRunner.js", import.meta.url),
      {
        "@/utils/dailyTaskState":
          await import("../src/utils/dailyTaskState.js"),
        "@/utils/dailyTaskSettings":
          await import("../src/utils/dailyTaskSettings.js"),
        "./accountConnection.js":
          await import("../src/utils/accountConnection.js"),
        "./accountIdentity.js": accountIdentity,
        "./daily/arena.js": await import("../src/utils/daily/arena.js"),
        "./daily/dream.js": await import("../src/utils/daily/dream.js"),
        "./weeklyQuiz.js": await import("../src/utils/weeklyQuiz.js"),
      },
    );

    const calls = [];
    let versionCalls = 0;
    const accountDataRef = vue.ref({ battleVersion: null });
    const role = {
      dailyTask: {
        dailyTime: 1700000000,
        complete: {
          1: -1,
          2: -1,
          3: -1,
          4: -1,
          5: -1,
          6: -1,
          7: -1,
          12: -1,
          13: -1,
          14: -1,
        },
        dailyPoint: 0,
        dailyReward: {},
        weekPoint: 0,
        weekReward: {},
      },
      statistics: {
        "artifact:normal:lottery:time": 1700000010,
        "genie:sweep:buy": 3,
      },
      statisticsTime: {
        "genie:sweep:buy": 1700000010,
        "legion:sign:in": 1700000010,
        "genie:daily:free:1": 1700000010,
        "genie:daily:free:2": 1700000010,
        "genie:daily:free:3": 1700000010,
        "genie:daily:free:4": 1700000010,
      },
    };
    const store = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      getAccountGameData: () => accountDataRef,
      ensureBattleVersion: async () => {
        versionCalls++;
        // First call fails, subsequent calls would succeed
        if (versionCalls === 1) return null;
        accountDataRef.value.battleVersion = 888;
        return 888;
      },
      sendGetRoleInfo: async () => ({ role: structuredClone(role) }),
      sendMessageWithPromise: async (_id, cmd) => {
        calls.push(cmd);
        return {};
      },
    };
    const runner = new DailyTaskRunner(
      store,
      { commandDelay: 0, taskDelay: 0 },
      {
        loadConfig: async () => ({
          tasks: [
            [1, 1, 1],
            [2, 2, 1],
            [3, 3, 3],
            [4, 4, 2],
            [5, 5, 5],
            [6, 6, 3],
            [7, 7, 3],
            [8, 13, 1],
            [9, 12, 1],
            [10, 14, 1],
          ].map(([id, completeCondition, completeValue]) => ({
            id,
            completeCondition,
            completeValue,
          })),
          dailyRewards: [],
          weeklyRewards: [],
        }),
        sleep: async () => {},
        getCurrentHour: () => 10,
      },
    );

    const summary = await runner.run(
      "acc1",
      {},
      {
        arenaFormation: 1,
        bossFormation: 2,
        bossTimes: 0,
        claimBottle: false,
        payRecruit: false,
        openBox: false,
        arenaEnable: false,
        claimHangUp: false,
        claimLegacy: false,
        claimEmail: false,
        weeklyQuizEnabled: false,
        blackMarketPurchase: false,
        dreamShopPurchase: false,
        freeGachaEnable: false,
      },
    );

    assert.equal(calls.includes("fight_startboss"), false);
    assert.equal(calls.includes("presetteam_getinfo"), false);
    assert.ok(summary.deferred >= 3);
    assert.ok(summary.incomplete >= 3);
  });

  test("Round2 P2-2: allowPartial returns per-role results so retrying only processes failed roles", async () => {
    const db = new Map([
      ["temp-a", new Uint8Array([1, 2]).buffer],
      ["temp-b", new Uint8Array([3, 4]).buffer],
    ]);
    const tokens = [
      {
        id: "orig-a",
        roleId: "1",
        name: "A",
        token: "old-a",
        importMethod: "wxQrcode",
      },
      {
        id: "orig-b",
        roleId: "2",
        name: "B",
        token: "old-b",
        importMethod: "wxQrcode",
      },
    ];
    let failB = true;
    const tokenStore = {
      gameTokens: tokens,
      selectedTokenId: "orig-a",
      getWebSocketStatus: () => "disconnected",
      updateToken: (id, updates) => {
        const idx = tokens.findIndex((t) => t.id === id);
        if (idx === -1) return false;
        tokens[idx] = { ...tokens[idx], ...updates };
        return true;
      },
      addToken: (r) => r,
    };

    const roles = [
      {
        id: "temp-a",
        roleId: "1",
        name: "A",
        token: "new-a",
        importMethod: "wxQrcode",
      },
      {
        id: "temp-b",
        roleId: "2",
        name: "B",
        token: "new-b",
        importMethod: "wxQrcode",
      },
    ];

    const firstPass = await upsertImportedRoleTokens({
      roles,
      tokenStore,
      getArrayBuffer: async (k) => db.get(k) ?? null,
      storeArrayBuffer: async (k, buf) => {
        if (k === "orig-b" && failB) return false;
        db.set(k, buf);
        return true;
      },
      deleteArrayBuffer: async (k) => db.delete(k),
      allowPartial: true,
    });

    assert.equal(firstPass.updatedCount, 1);
    assert.equal(firstPass.failedRoles.length, 1);
    assert.equal(firstPass.failedRoles[0].role.id, "temp-b");
    assert.equal(db.has("temp-a"), false); // A's temp BIN was cleaned up
    assert.equal(db.has("temp-b"), true); // B's temp BIN still available

    // Storage recovers -> retry ONLY failedRoles
    failB = false;
    const retryPass = await upsertImportedRoleTokens({
      roles: firstPass.failedRoles.map((item) => item.role),
      tokenStore,
      getArrayBuffer: async (k) => db.get(k) ?? null,
      storeArrayBuffer: async (k, buf) => {
        db.set(k, buf);
        return true;
      },
      deleteArrayBuffer: async (k) => db.delete(k),
      allowPartial: true,
    });
    assert.equal(retryPass.updatedCount, 1);
    assert.equal(retryPass.failedRoles.length, 0);
    assert.equal(tokens[1].token, "new-b");
  });

  test("Round2 P2-3: sampleFromWebSocketClient reuses client.serverTimeSampledAt across remounts without rolling back 90s", () => {
    const client = {
      serverTime: 1700000000000,
      serverTimeSampledAt: 1000,
    };
    // Newly mounted component 90 seconds later (monotonic = 91000)
    const sample = sampleFromWebSocketClient(client, null, 91000);
    assert.equal(sample.serverTimeMs, 1700000000000);
    assert.equal(sample.sampledAtMs, 1000);
    assert.equal(getEstimatedServerNowSec(sample, 0, 91000), 1700000090);
  });
});

describe("Commit 6 review round-3 regression fixes (3 P1 + 1 P2)", () => {
  test("Round3 P1-1: same-tab edit during BIN write rolls back stale BIN, and cross-tab refresh cannot overwrite another tab's QR re-login", async () => {
    const sharedStorage = new Map();
    const sharedIdb = new Map([
      ["acc1", new Uint8Array([5, 5]).buffer],
      ["主号", new Uint8Array([1, 1]).buffer],
      ["temp-tab2-qr", new Uint8Array([9, 9, 9]).buffer],
    ]);
    let lockTail = Promise.resolve();
    const sharedLocks = {
      request(_name, _opts, cb) {
        const res = lockTail.then(() => cb({}));
        lockTail = res.then(
          () => {},
          () => {},
        );
        return res;
      },
    };

    const createTabFixture = async ({
      transformTokenImpl,
      storeArrayBufferImpl,
    } = {}) => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const logger = new Proxy({}, { get: () => () => {} });
      const recoveryTimers = new Map();
      let nextTimer = 0;

      const makeSyncedStorageRef = (key, initial) => {
        const existingRaw = sharedStorage.get(key);
        const r = vue.ref(existingRaw ? JSON.parse(existingRaw) : initial);
        vue.watch(
          r,
          (val) => {
            sharedStorage.set(key, JSON.stringify(val));
          },
          { deep: true, flush: "sync" },
        );
        return r;
      };

      const mod = await loadModule(
        new URL("../src/stores/tokenStore.ts", import.meta.url),
        {
          "@/utils/accountIdentity.js": accountIdentity,
          "@vueuse/core": { useLocalStorage: makeSyncedStorageRef },
          pinia: { defineStore },
          vue,
          "@/hooks/useIndexedDB": {
            default: () => ({
              getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
              storeArrayBuffer:
                storeArrayBufferImpl ||
                (async (k, buf) => {
                  sharedIdb.set(k, buf);
                  return true;
                }),
              deleteArrayBuffer: async (k) => sharedIdb.delete(k),
              clearAll: async () => sharedIdb.clear(),
            }),
          },
          "@/router": {
            default: { currentRoute: { value: { path: "/tokens" } } },
          },
          "@/utils/accountGameData": accountData,
          "@/utils/bonProtocol": { g_utils: {} },
          "@/utils/connectionRecovery": {
            createConnectionRecovery: (opts) =>
              createConnectionRecovery({
                ...opts,
                setTimer: (fn, delay) => {
                  const id = ++nextTimer;
                  recoveryTimers.set(id, { fn, delay });
                  return id;
                },
                clearTimer: (id) => recoveryTimers.delete(id),
              }),
          },
          "@/utils/logger": {
            gameLogger: logger,
            tokenLogger: logger,
            wsLogger: logger,
          },
          "@/utils/randomSeed": { generateRandomSeed: () => 1 },
          "@/utils/token": {
            fetchTokenPayloadFromUrl: async () => ({}),
            scheduleAuthUserRequest: (fn) => fn(),
            setAuthUserRateLimiterCallback() {},
            transformToken:
              transformTokenImpl ||
              (async () =>
                JSON.stringify({ roleId: "1001", roleToken: "default-tok" })),
          },
          "@/utils/wechatForceLogout": {
            refreshTokenFromCombUser: async () => ({}),
            roleIndexFromServerId: () => 0,
          },
          "@/utils/xyzwWebSocket": {
            XyzwWebSocketClient: class {
              constructor() {
                this.socket = { readyState: 1 };
              }
              setMessageListener() {}
              init() {
                this.onConnect();
              }
              disconnect() {
                if (this.socket) this.socket.readyState = 3;
                this.socket = null;
              }
              send() {}
              sendHeartbeat() {}
            },
          },
          "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
        },
        {
          AbortController,
          WebSocket: { CLOSED: 3 },
          localStorage: {
            getItem: (k) => sharedStorage.get(k) ?? null,
            setItem: (k, v) => sharedStorage.set(k, String(v)),
            removeItem: (k) => sharedStorage.delete(k),
          },
          navigator: { onLine: true, locks: sharedLocks },
          setTimeout,
          clearTimeout,
          setInterval: () => 1,
          clearInterval() {},
          window: {
            location: { href: "http://127.0.0.1/" },
            addEventListener() {},
            removeEventListener() {},
          },
          document: {
            visibilityState: "visible",
            addEventListener() {},
            removeEventListener() {},
          },
        },
      );
      return { pinia, mod, store: mod.useTokenStore() };
    };

    // Subcase A: Same-tab direct token update while commitCredentialUpdate is paused in storeArrayBuffer -> rolls back stale BIN!
    let releaseStoreBin;
    let enteredStoreBin;
    const storeEntered = new Promise((r) => {
      enteredStoreBin = r;
    });
    const tabSingle = await createTabFixture({
      storeArrayBufferImpl: async (k, buf) => {
        if (k === "acc1" && !releaseStoreBin) {
          enteredStoreBin();
          await new Promise((r) => {
            releaseStoreBin = r;
          });
        }
        sharedIdb.set(k, buf);
        return true;
      },
    });
    try {
      tabSingle.mod.gameTokens.value = [
        {
          id: "acc1",
          name: "主号",
          roleId: "1001",
          token: "initial-token",
          importMethod: "bin",
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ];
      const staleCommit = tabSingle.store.commitCredentialUpdate("acc1", {
        expectedVersion: 0,
        expectedToken: "initial-token",
        expectedCreatedAt: "2026-11-01T00:00:00.000Z",
        updates: { token: "stale-migrated-token" },
        binData: new Uint8Array([1, 1]).buffer,
        deleteOldBinKey: "主号",
      });
      await storeEntered;
      // Concurrent direct updateToken happens while storeArrayBuffer is awaiting
      tabSingle.store.updateToken("acc1", { token: "fresh-edited-token" });
      releaseStoreBin();
      const outcome = await staleCommit;
      assert.equal(outcome.committed, false);
      assert.equal(outcome.stale, true);
      assert.equal(
        tabSingle.mod.gameTokens.value[0].token,
        "fresh-edited-token",
      );
      // Rolled back to previous BIN [5, 5] instead of leaving stale [1, 1]
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("acc1"))),
        [5, 5],
      );
      assert.equal(sharedIdb.has("主号"), true);
    } finally {
      tabSingle.pinia._e.stop();
    }

    // Subcase B: Cross-tab race — Tab 1 refreshes while Tab 2 scans QR and persists new Token + BIN
    sharedStorage.clear();
    sharedIdb.set("acc1", new Uint8Array([5, 5]).buffer);
    sharedIdb.set("temp-tab2-qr", new Uint8Array([9, 9, 9]).buffer);
    sharedStorage.set(
      "gameTokens",
      JSON.stringify([
        {
          id: "acc1",
          name: "主号",
          roleId: "1001",
          token: "old-cross-tab-token",
          importMethod: "bin",
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ]),
    );
    let resolveTab1Transform;
    const tab1 = await createTabFixture({
      transformTokenImpl: () =>
        new Promise((resolve) => {
          resolveTab1Transform = resolve;
        }),
    });
    const tab2 = await createTabFixture();
    try {
      // Tab 1 starts manual refresh (awaiting slow authuser)
      const tab1Refresh = tab1.store.refreshTokenManually("acc1");
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(typeof resolveTab1Transform, "function");

      // Tab 2 completes QR login in place on acc1 -> persists new Token + BIN + bumped version
      await upsertImportedRoleTokens({
        roles: [
          {
            id: "temp-tab2-qr",
            roleId: "1001",
            name: "主号",
            token: "tab2-fresh-qr-token",
            importMethod: "wxQrcode",
          },
        ],
        tokenStore: tab2.store,
        getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
        storeArrayBuffer: async (k, buf) => {
          sharedIdb.set(k, buf);
          return true;
        },
        deleteArrayBuffer: async (k) => sharedIdb.delete(k),
      });

      // Tab 1's old refresh now resolves -> MUST detect cross-tab update and NOT overwrite Tab 2!
      resolveTab1Transform(
        JSON.stringify({ roleId: "1001", roleToken: "tab1-stale-token" }),
      );
      const tab1Result = await tab1Refresh;
      assert.equal(tab1Result.status, "stale");
      const persistedAfter = JSON.parse(sharedStorage.get("gameTokens"));
      assert.equal(persistedAfter[0].token, "tab2-fresh-qr-token");
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("acc1"))),
        [9, 9, 9],
      );
    } finally {
      tab1.pinia._e.stop();
      tab2.pinia._e.stop();
    }

    // Verify TokenImport.vue saveEdit routes through commitCredentialUpdate
    const tokenImportSrc = await readFile(
      new URL("../src/views/TokenImport/TokenImport.vue", import.meta.url),
      "utf8",
    );
    assert.match(
      tokenImportSrc,
      /saveEdit[\s\S]*?commitCredentialUpdate\(tokenId/,
    );
  });

  test("Round3 P1-2: legacy name-keyed BIN migration verifies authenticated roleId and refuses mismatched or unverifiable roles", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const logger = new Proxy({}, { get: () => () => {} });
    const idbMap = new Map([["主号", new Uint8Array([2, 2, 2]).buffer]]);
    let transformResponse = "";

    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": { useLocalStorage: (_k, v) => vue.ref(v) },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async (k) => idbMap.get(k) ?? null,
            storeArrayBuffer: async (k, buf) => {
              idbMap.set(k, buf);
              return true;
            },
            deleteArrayBuffer: async (k) => idbMap.delete(k),
            clearAll: async () => idbMap.clear(),
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/tokens" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: () => 1,
              clearTimer() {},
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () => transformResponse,
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: async () => ({}),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": { XyzwWebSocketClient: class {} },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: {
          getItem: () => null,
          setItem() {},
          removeItem() {},
        },
        navigator: { onLine: true },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );

    const store = mod.useTokenStore();
    try {
      mod.gameTokens.value = [
        {
          id: "accA",
          name: "主号",
          roleId: "1001",
          token: "original-a-token",
          importMethod: "bin",
        },
      ];

      // Case A: name-keyed BIN authenticates as role B (2002) -> MUST fail and preserve A + old key
      transformResponse = JSON.stringify({
        roleId: "2002",
        roleToken: "role-b-token",
      });
      const mismatch = await store.refreshTokenManually("accA");
      assert.equal(mismatch.status, "failed");
      assert.equal(mod.gameTokens.value[0].token, "original-a-token");
      assert.equal(idbMap.has("accA"), false);
      assert.equal(idbMap.has("主号"), true);

      // Case B: name-keyed BIN response omits roleId -> MUST fail and preserve A + old key
      transformResponse = JSON.stringify({ roleToken: "no-role-id-token" });
      const unverifiable = await store.refreshTokenManually("accA");
      assert.equal(unverifiable.status, "failed");
      assert.equal(mod.gameTokens.value[0].token, "original-a-token");
      assert.equal(idbMap.has("accA"), false);
      assert.equal(idbMap.has("主号"), true);

      // Case C: name-keyed BIN authenticates as matching role A (1001) -> migrates cleanly!
      transformResponse = JSON.stringify({
        roleId: "1001",
        roleToken: "fresh-a-token",
      });
      const matched = await store.refreshTokenManually("accA");
      assert.equal(matched.status, "refreshed");
      assert.equal(mod.gameTokens.value[0].token, transformResponse);
      assert.equal(idbMap.has("accA"), true);
      assert.equal(idbMap.has("主号"), false);
    } finally {
      pinia._e.stop();
    }
  });

  test("Round3 P1-3: bottlehelper_stop timeout probes server state on intact connection and restarts only if confirmed stopped", async () => {
    const { DailyTaskRunner } = await loadModule(
      new URL("../src/utils/dailyTaskRunner.js", import.meta.url),
      {
        "@/utils/dailyTaskState":
          await import("../src/utils/dailyTaskState.js"),
        "@/utils/dailyTaskSettings":
          await import("../src/utils/dailyTaskSettings.js"),
        "./accountConnection.js":
          await import("../src/utils/accountConnection.js"),
        "./accountIdentity.js": accountIdentity,
        "./daily/arena.js": await import("../src/utils/daily/arena.js"),
        "./daily/dream.js": await import("../src/utils/daily/dream.js"),
        "./weeklyQuiz.js": await import("../src/utils/weeklyQuiz.js"),
      },
    );

    const makeRole = (helperStopTime) => ({
      dailyTask: {
        dailyTime: 1700000000,
        complete: {
          1: -1,
          2: -1,
          3: -1,
          4: -1,
          5: -1,
          6: -1,
          7: -1,
          12: -1,
          13: -1,
          14: 0,
        },
        dailyPoint: 0,
        dailyReward: {},
        weekPoint: 0,
        weekReward: {},
      },
      bottleHelpers: { helperStopTime },
      statistics: {
        "artifact:normal:lottery:time": 1700000010,
        "genie:sweep:buy": 3,
      },
      statisticsTime: {
        "genie:sweep:buy": 1700000010,
        "legion:sign:in": 1700000010,
        "genie:daily:free:1": 1700000010,
        "genie:daily:free:2": 1700000010,
        "genie:daily:free:3": 1700000010,
        "genie:daily:free:4": 1700000010,
      },
    });
    const config = {
      tasks: [
        [1, 1, 1],
        [2, 2, 1],
        [3, 3, 3],
        [4, 4, 2],
        [5, 5, 5],
        [6, 6, 3],
        [7, 7, 3],
        [8, 13, 1],
        [9, 12, 1],
        [10, 14, 1],
      ].map(([id, completeCondition, completeValue]) => ({
        id,
        completeCondition,
        completeValue,
      })),
      dailyRewards: [],
      weeklyRewards: [],
    };
    const bottleOnlySettings = {
      arenaFormation: 1,
      bossFormation: 1,
      bossTimes: 0,
      claimBottle: true,
      payRecruit: false,
      openBox: false,
      arenaEnable: false,
      claimHangUp: false,
      claimLegacy: false,
      claimEmail: false,
      weeklyQuizEnabled: false,
      blackMarketPurchase: false,
      dreamShopPurchase: false,
      freeGachaEnable: false,
    };

    // Subcase A: bottlehelper_stop took effect on server but response timed out -> probe sees stopped -> sends 1 bottlehelper_start
    const callsA = [];
    let roleQueriesA = 0;
    const storeA = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => {
        roleQueriesA++;
        // Initial snapshots: running; post-timeout probe: stopped!
        return {
          role: makeRole(roleQueriesA >= 3 ? 1699999000 : 1700009000),
        };
      },
      sendMessageWithPromise: async (_id, cmd) => {
        callsA.push(cmd);
        if (cmd === "bottlehelper_stop") throw new Error("请求超时");
        return {};
      },
    };
    const runnerA = new DailyTaskRunner(
      storeA,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerA.run("acc1", {}, bottleOnlySettings),
      /请求超时/,
    );
    assert.deepEqual(callsA, ["bottlehelper_stop", "bottlehelper_start"]);
    assert.ok(roleQueriesA >= 3);

    // Subcase B: bottlehelper_stop timed out and server probe shows bottle is STILL running -> sends ZERO bottlehelper_start
    const callsB = [];
    const storeB = {
      gameTokens: [{ id: "acc1", name: "主号" }],
      selectedToken: { id: "acc1" },
      wsConnections: { acc1: { client: { serverTime: 1700000100 * 1000 } } },
      getWebSocketStatus: () => "connected",
      sendGetRoleInfo: async () => ({ role: makeRole(1700009000) }),
      sendMessageWithPromise: async (_id, cmd) => {
        callsB.push(cmd);
        if (cmd === "bottlehelper_stop") throw new Error("请求超时");
        return {};
      },
    };
    const runnerB = new DailyTaskRunner(
      storeB,
      { commandDelay: 0, taskDelay: 0 },
      { loadConfig: async () => config, sleep: async () => {} },
    );
    await assert.rejects(
      runnerB.run("acc1", {}, bottleOnlySettings),
      /请求超时/,
    );
    assert.deepEqual(callsB, ["bottlehelper_stop"]);
  });

  test("Round3 P2-1: mutating caller roles array mid-import never skips subsequent roles", async () => {
    const db = new Map([
      ["temp-a", new Uint8Array([1]).buffer],
      ["temp-b", new Uint8Array([2]).buffer],
      ["temp-c", new Uint8Array([3]).buffer],
    ]);
    const tokens = [];
    const tokenStore = {
      gameTokens: tokens,
      selectedTokenId: "",
      getWebSocketStatus: () => "disconnected",
      updateToken: () => true,
      addToken: (role) => {
        tokens.push(role);
        return role;
      },
    };
    const liveRoles = [
      {
        id: "temp-a",
        roleId: "1",
        name: "A",
        token: "tok-a",
        importMethod: "bin",
      },
      {
        id: "temp-b",
        roleId: "2",
        name: "B",
        token: "tok-b",
        importMethod: "bin",
      },
      {
        id: "temp-c",
        roleId: "3",
        name: "C",
        token: "tok-c",
        importMethod: "bin",
      },
    ];
    let removedOnce = false;
    const result = await upsertImportedRoleTokens({
      roles: liveRoles,
      tokenStore,
      getArrayBuffer: async (key) => {
        if (key === "temp-a" && !removedOnce) {
          removedOnce = true;
          liveRoles.splice(0, 1); // simulate user deleting A mid-import
        }
        return db.get(key) ?? null;
      },
      storeArrayBuffer: async (k, buf) => {
        db.set(k, buf);
        return true;
      },
      deleteArrayBuffer: async (k) => db.delete(k),
      allowPartial: true,
    });

    assert.equal(result.addedCount, 3);
    assert.equal(result.failedRoles.length, 0);
    assert.deepEqual(
      tokens.map((t) => t.name),
      ["A", "B", "C"],
    );
  });
});

describe("Commit 7 review round-4 regression fixes (2 P1 + 3 P2)", () => {
  const createSharedLockManager = (recordedNames = []) => {
    const tails = new Map();
    return {
      request(name, optionsOrCb, maybeCb) {
        recordedNames.push(name);
        const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
        const opts = typeof optionsOrCb === "function" ? {} : optionsOrCb;
        const signal = opts?.signal;
        const prev = tails.get(name) || Promise.resolve();
        let releaseCurrent;
        const currentHeld = new Promise((resolve) => {
          releaseCurrent = resolve;
        });
        const nextTail = prev.then(() => currentHeld);
        tails.set(name, nextTail);

        return new Promise((resolve, reject) => {
          let started = false;
          let aborted = false;
          const onAbort = () => {
            if (started || aborted) return;
            aborted = true;
            releaseCurrent();
            reject(new Error("AbortError"));
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener?.("abort", onAbort, { once: true });
          prev.then(async () => {
            if (aborted) return;
            started = true;
            signal?.removeEventListener?.("abort", onAbort);
            try {
              resolve(await cb({ name }));
            } catch (err) {
              reject(err);
            } finally {
              releaseCurrent();
            }
          });
        });
      },
    };
  };

  const loadVueUseTokenTab = async ({
    sharedStorage,
    sharedIdb,
    sharedLocks,
    storeArrayBufferImpl = null,
    deleteArrayBufferImpl = null,
    transformTokenImpl = null,
  }) => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      verbose() {},
      gameMessage() {},
    };
    const recoveryTimers = new Map();
    let nextTimer = 0;

    const storageAdapter = {
      getItem: (k) => (sharedStorage.has(k) ? sharedStorage.get(k) : null),
      setItem: (k, v) => sharedStorage.set(k, String(v)),
      removeItem: (k) => sharedStorage.delete(k),
    };

    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": {
          useLocalStorage: (key, initial, opts) =>
            vueUseCore.useStorage(key, initial, storageAdapter, {
              ...opts,
              listenToStorageChanges: false,
            }),
        },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
            storeArrayBuffer:
              storeArrayBufferImpl ||
              (async (k, buf) => {
                sharedIdb.set(k, buf);
                return true;
              }),
            deleteArrayBuffer:
              deleteArrayBufferImpl ||
              (async (k) => {
                sharedIdb.delete(k);
                return true;
              }),
            clearAll: async () => {
              sharedIdb.clear();
              return true;
            },
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/tokens" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: (fn, delay) => {
                const id = ++nextTimer;
                recoveryTimers.set(id, { fn, delay });
                return id;
              },
              clearTimer: (id) => recoveryTimers.delete(id),
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken:
            transformTokenImpl ||
            (async () =>
              JSON.stringify({ roleId: "1001", roleToken: "default-tok" })),
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: async () => ({}),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {
            constructor() {
              this.socket = { readyState: 1 };
            }
            setMessageListener() {}
            init() {
              this.onConnect();
            }
            disconnect() {
              if (this.socket) this.socket.readyState = 3;
              this.socket = null;
            }
            send() {}
            sendHeartbeat() {}
          },
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: storageAdapter,
        navigator: { onLine: true, locks: sharedLocks },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );
    return { pinia, mod, store: mod.useTokenStore() };
  };

  test("Round4 P1-1: stale edit modal changing only remark preserves re-logged-in Token, while explicit Token edit rejects stale version", async () => {
    const sharedStorage = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "acc1",
            name: "主号",
            roleId: "1001",
            token: "old-token-before-relogin",
            server: "10服",
            wsUrl: "",
            remark: "旧备注",
            importMethod: "wxQrcode",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdb = new Map([
      ["acc1", new Uint8Array([1, 2]).buffer],
      ["temp-qr-new", new Uint8Array([9, 8, 7]).buffer],
    ]);
    const sharedLocks = createSharedLockManager();
    const tab = await loadVueUseTokenTab({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });

    try {
      // Step 1: Open edit modal snapshot BEFORE QR re-login
      const openedToken = tab.store.gameTokens[0];
      const snapshot = {
        id: openedToken.id,
        name: openedToken.name || "",
        token: openedToken.token || "",
        server: openedToken.server || "",
        wsUrl: openedToken.wsUrl || "",
        remark: openedToken.remark || "",
        credentialVersion: tab.store.getCredentialVersion(openedToken.id),
        createdAt: openedToken.createdAt,
      };

      // Step 2: QR re-login updates acc1 Token + BIN in place
      await upsertImportedRoleTokens({
        roles: [
          {
            id: "temp-qr-new",
            roleId: "1001",
            name: "主号",
            token: "fresh-qr-relogin-token",
            importMethod: "wxQrcode",
          },
        ],
        tokenStore: tab.store,
        getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
        storeArrayBuffer: async (k, buf) => {
          sharedIdb.set(k, buf);
          return true;
        },
        deleteArrayBuffer: async (k) => sharedIdb.delete(k),
      });
      assert.equal(tab.store.gameTokens[0].token, "fresh-qr-relogin-token");

      // Step 3A: Return to stale edit modal and edit ONLY remark -> preserves fresh QR Token & BIN!
      const remarkOnlyPayload = buildTokenEditCommitPayload(snapshot, {
        name: snapshot.name,
        token: snapshot.token, // untouched in stale modal!
        server: snapshot.server,
        wsUrl: snapshot.wsUrl,
        remark: "新备注-不覆盖Token",
      });
      assert.equal(remarkOnlyPayload.hasChanges, true);
      assert.equal(remarkOnlyPayload.editsCredential, false);
      assert.deepEqual(remarkOnlyPayload.updates, {
        remark: "新备注-不覆盖Token",
      });

      const remarkCommit = await tab.store.commitCredentialUpdate("acc1", {
        updates: remarkOnlyPayload.updates,
      });
      assert.equal(remarkCommit.committed, true);
      assert.equal(tab.store.gameTokens[0].remark, "新备注-不覆盖Token");
      assert.equal(tab.store.gameTokens[0].token, "fresh-qr-relogin-token");
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("acc1"))),
        [9, 8, 7],
      );

      // Step 3B: Explicit Token edit from stale modal carries expectedVersion -> rejected as stale!
      const staleTokenPayload = buildTokenEditCommitPayload(snapshot, {
        name: snapshot.name,
        token: "stale-manual-override-token",
        server: snapshot.server,
        wsUrl: snapshot.wsUrl,
        remark: "新备注2",
      });
      assert.equal(staleTokenPayload.editsCredential, true);
      assert.equal(staleTokenPayload.expectedVersion, 0);
      assert.equal(staleTokenPayload.expectedToken, "old-token-before-relogin");

      const staleTokenCommit = await tab.store.commitCredentialUpdate("acc1", {
        updates: staleTokenPayload.updates,
        expectedVersion: staleTokenPayload.expectedVersion,
        expectedToken: staleTokenPayload.expectedToken,
        expectedCreatedAt: staleTokenPayload.expectedCreatedAt,
      });
      assert.equal(staleTokenCommit.committed, false);
      assert.equal(staleTokenCommit.stale, true);
      assert.equal(tab.store.gameTokens[0].token, "fresh-qr-relogin-token");
      assert.equal(tab.store.gameTokens[0].remark, "新备注-不覆盖Token");

      // Step 3C: Freshly reopened modal explicitly editing Token succeeds
      const freshSnapshot = {
        id: "acc1",
        name: tab.store.gameTokens[0].name,
        token: tab.store.gameTokens[0].token,
        server: tab.store.gameTokens[0].server,
        wsUrl: tab.store.gameTokens[0].wsUrl || "",
        remark: tab.store.gameTokens[0].remark || "",
        credentialVersion: tab.store.getCredentialVersion("acc1"),
        createdAt: tab.store.gameTokens[0].createdAt,
      };
      const validTokenPayload = buildTokenEditCommitPayload(freshSnapshot, {
        ...freshSnapshot,
        token: "explicit-new-manual-token",
      });
      const validCommit = await tab.store.commitCredentialUpdate("acc1", {
        updates: validTokenPayload.updates,
        expectedVersion: validTokenPayload.expectedVersion,
        expectedToken: validTokenPayload.expectedToken,
        expectedCreatedAt: validTokenPayload.expectedCreatedAt,
      });
      assert.equal(validCommit.committed, true);
      assert.equal(tab.store.gameTokens[0].token, "explicit-new-manual-token");
    } finally {
      tab.pinia._e.stop();
    }

    // Verify TokenImport.vue wires snapshot + buildTokenEditCommitPayload + stale warning
    const tokenImportSrc = await readFile(
      new URL("../src/views/TokenImport/TokenImport.vue", import.meta.url),
      "utf8",
    );
    assert.match(tokenImportSrc, /editingSnapshot/);
    assert.match(tokenImportSrc, /getCredentialVersion/);
    assert.match(tokenImportSrc, /buildTokenEditCommitPayload/);
    assert.match(tokenImportSrc, /if \(commit\?\.stale\)/);
  });

  test("Round4 P1-2: two tabs using real VueUse persistence updating different accounts without storage events preserve both updates under one store-wide lock", async () => {
    const sharedStorage = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "accA",
            name: "账号A",
            roleId: "101",
            token: "old-token-A",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "accB",
            name: "账号B",
            roleId: "102",
            token: "old-token-B",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdb = new Map();
    const lockNames = [];
    const sharedLocks = createSharedLockManager(lockNames);

    const tabA = await loadVueUseTokenTab({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });
    const tabB = await loadVueUseTokenTab({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });

    try {
      // Tab A updates accA while Tab B concurrently updates accB, with ZERO storage events delivered between them!
      const [resA, resB] = await Promise.all([
        tabA.store.commitCredentialUpdate("accA", {
          updates: { token: "fresh-token-A" },
          binData: new Uint8Array([10, 10]).buffer,
        }),
        tabB.store.commitCredentialUpdate("accB", {
          updates: { token: "fresh-token-B" },
          binData: new Uint8Array([20, 20]).buffer,
        }),
      ]);
      assert.equal(resA.committed, true);
      assert.equal(resB.committed, true);

      // Wait a tick to ensure no deferred async VueUse watcher flushes stale data after lock release!
      await new Promise((r) => setTimeout(r, 15));

      // All commits must share the single whole-list lock "xyzw-gameTokens"
      assert.ok(lockNames.length >= 2);
      assert.ok(
        lockNames.every((name) => name === "xyzw-gameTokens"),
        `expected only xyzw-gameTokens locks, got ${JSON.stringify(lockNames)}`,
      );

      const persisted = JSON.parse(sharedStorage.get("gameTokens"));
      const savedA = persisted.find((t) => t.id === "accA");
      const savedB = persisted.find((t) => t.id === "accB");
      assert.equal(savedA?.token, "fresh-token-A");
      assert.equal(savedB?.token, "fresh-token-B");

      // Tab A adding a new account C without receiving Tab B's storage event also preserves B's fresh token
      await tabA.store.commitNewToken({
        id: "accC",
        name: "账号C",
        token: "fresh-token-C",
      });
      await new Promise((r) => setTimeout(r, 10));
      const persistedAfterAdd = JSON.parse(sharedStorage.get("gameTokens"));
      assert.equal(persistedAfterAdd.length, 3);
      assert.equal(
        persistedAfterAdd.find((t) => t.id === "accA")?.token,
        "fresh-token-A",
      );
      assert.equal(
        persistedAfterAdd.find((t) => t.id === "accB")?.token,
        "fresh-token-B",
      );
      assert.equal(
        persistedAfterAdd.find((t) => t.id === "accC")?.token,
        "fresh-token-C",
      );
    } finally {
      tabA.pinia._e.stop();
      tabB.pinia._e.stop();
    }
  });

  test("Round4 P2-1: deleting an account serializes with credential commits and rollback never resurrects deleted BIN", async () => {
    // Subcase A: Even if account is deleted while storeArrayBuffer is in flight, rollback deletes BIN instead of restoring old BIN!
    const sharedStorageA = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "acc1",
            name: "主号",
            roleId: "1001",
            token: "old-token",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdbA = new Map([["acc1", new Uint8Array([5, 5]).buffer]]);
    const sharedLocksA = createSharedLockManager();
    let enteredStore;
    const storeStarted = new Promise((r) => {
      enteredStore = r;
    });
    let releaseStore;
    const tabA = await loadVueUseTokenTab({
      sharedStorage: sharedStorageA,
      sharedIdb: sharedIdbA,
      sharedLocks: sharedLocksA,
      storeArrayBufferImpl: async (k, buf) => {
        if (k === "acc1" && !releaseStore) {
          enteredStore();
          await new Promise((r) => {
            releaseStore = r;
          });
        }
        sharedIdbA.set(k, buf);
        return true;
      },
    });
    try {
      const pendingCommit = tabA.store.commitCredentialUpdate("acc1", {
        expectedVersion: 0,
        expectedToken: "old-token",
        updates: { token: "new-token" },
        binData: new Uint8Array([9, 9]).buffer,
      });
      await storeStarted;
      // Simulate external deletion of acc1 from storage & IDB while commit is mid-write
      sharedStorageA.set("gameTokens", JSON.stringify([]));
      sharedIdbA.delete("acc1");
      releaseStore();

      const commitOutcome = await pendingCommit;
      assert.equal(commitOutcome.committed, false);
      assert.equal(commitOutcome.reason, "token_missing");
      assert.equal(
        sharedIdbA.has("acc1"),
        false,
        "rollback must delete BIN instead of resurrecting deleted account BIN",
      );
    } finally {
      tabA.pinia._e.stop();
    }

    // Subcase B: Concurrent commitCredentialUpdate + removeToken serialize cleanly and leave zero BIN in IndexedDB
    const sharedStorageB = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "acc1",
            name: "主号",
            roleId: "1001",
            token: "old-token",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdbB = new Map([["acc1", new Uint8Array([5, 5]).buffer]]);
    const sharedLocksB = createSharedLockManager();
    const tabB = await loadVueUseTokenTab({
      sharedStorage: sharedStorageB,
      sharedIdb: sharedIdbB,
      sharedLocks: sharedLocksB,
      storeArrayBufferImpl: async (k, buf) => {
        await new Promise((r) => setTimeout(r, 20));
        sharedIdbB.set(k, buf);
        return true;
      },
    });
    try {
      const [commitRes] = await Promise.all([
        tabB.store.commitCredentialUpdate("acc1", {
          expectedVersion: 0,
          expectedToken: "old-token",
          updates: { token: "new-token" },
          binData: new Uint8Array([7, 7]).buffer,
        }),
        tabB.store.removeToken("acc1"),
      ]);
      assert.equal(commitRes.committed, false);
      assert.equal(JSON.parse(sharedStorageB.get("gameTokens")).length, 0);
      assert.equal(sharedIdbB.has("acc1"), false);
    } finally {
      tabB.pinia._e.stop();
    }
  });

  test("Round4 P2-2: lock-wait timeout stops once Web Lock is granted so slow post-commit BIN cleanup never reports false timeout", async () => {
    const sharedStorage = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "acc1",
            name: "主号",
            roleId: "1001",
            token: "old-token",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdb = new Map([["主号", new Uint8Array([3, 3]).buffer]]);
    const sharedLocks = createSharedLockManager();
    const tab = await loadVueUseTokenTab({
      sharedStorage,
      sharedIdb,
      sharedLocks,
      deleteArrayBufferImpl: async (k) => {
        // Deliberately exceed lockWaitTimeoutMs (30ms) AFTER lock grant & commit
        await new Promise((r) => setTimeout(r, 80));
        sharedIdb.delete(k);
        return true;
      },
    });

    try {
      const outcome = await tab.store.commitCredentialUpdate("acc1", {
        expectedVersion: 0,
        expectedToken: "old-token",
        updates: { token: "committed-token" },
        binData: new Uint8Array([8, 8]).buffer,
        deleteOldBinKey: "主号",
        lockWaitTimeoutMs: 30,
      });
      assert.equal(outcome.committed, true);
      assert.equal(tab.store.gameTokens[0].token, "committed-token");
      assert.equal(sharedIdb.has("主号"), false);
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("acc1"))),
        [8, 8],
      );

      // Subcase B: Waiting BEFORE lock acquisition still times out properly
      let releaseBlocker;
      const blockerHeld = sharedLocks.request(
        "xyzw-gameTokens",
        () =>
          new Promise((resolve) => {
            releaseBlocker = resolve;
          }),
      );
      await assert.rejects(
        tab.store.commitCredentialUpdate("acc1", {
          updates: { token: "blocked-token" },
          lockWaitTimeoutMs: 25,
        }),
        /等待跨标签页凭据提交锁超时/,
      );
      releaseBlocker();
      await blockerHeld;
      assert.equal(tab.store.gameTokens[0].token, "committed-token");
    } finally {
      tab.pinia._e.stop();
    }
  });

  test("Round4 P2-3: forms disable submit while roles are authenticating and preserve out-of-batch roles appended during import", async () => {
    const roleA = { id: "a", name: "角色A" };
    const roleB = { id: "b", name: "角色B" };
    const roleC = { id: "c", name: "角色C" };

    // Case 1: B finishes auth and joins roleList while batch [A] is importing -> A succeeds, B is preserved!
    const afterBatchA = pruneSucceededImportRoles([roleA, roleB], [roleA], [0]);
    assert.deepEqual(afterBatchA, [roleB]);

    // Case 2: Batch [A, C] where A succeeds, C fails, and B joins mid-import -> both failed C and new B remain!
    const afterPartial = pruneSucceededImportRoles(
      [roleA, roleC, roleB],
      [roleA, roleC],
      [0],
    );
    assert.deepEqual(afterPartial, [roleC, roleB]);

    // Verify all 4 role-list import forms implement BOTH guards (pendingAddCount + pruneSucceededImportRoles)
    for (const file of [
      "../src/views/TokenImport/MobileTokenForm.vue",
      "../src/views/TokenImport/WxQrcodeForm.vue",
      "../src/views/TokenImport/BinTokenForm.vue",
      "../src/views/TokenImport/SingleBinTokenForm.vue",
    ]) {
      const src = await readFile(new URL(file, import.meta.url), "utf8");
      assert.match(src, /const pendingAddCount = ref\(0\)/, file);
      assert.match(
        src,
        /:disabled="isImporting \|\| pendingAddCount > 0"/,
        file,
      );
      assert.match(src, /if \(pendingAddCount\.value > 0\)/, file);
      assert.match(src, /pruneSucceededImportRoles\(/, file);
      assert.match(src, /if \(roleList\.value\.length > 0\)/, file);
    }
  });
});

describe("Commit 8 review round-5 regression fixes (2 P1 + 1 P2)", () => {
  let prevStorageDescriptor;
  let prevStorageEventDescriptor;
  let installedStorageShim = false;
  let installedStorageEventShim = false;

  before(() => {
    if (typeof globalThis.Storage === "undefined") {
      prevStorageDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "Storage",
      );
      globalThis.Storage = class MockStorage {};
      installedStorageShim = true;
    }
    if (typeof globalThis.StorageEvent === "undefined") {
      prevStorageEventDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "StorageEvent",
      );
      globalThis.StorageEvent = class MockStorageEvent extends Event {
        constructor(type, init = {}) {
          super(type);
          this.key = init.key ?? null;
          this.oldValue = init.oldValue ?? null;
          this.newValue = init.newValue ?? null;
          this.storageArea = init.storageArea ?? null;
        }
      };
      installedStorageEventShim = true;
    }
  });

  after(() => {
    if (installedStorageShim) {
      if (prevStorageDescriptor) {
        Object.defineProperty(globalThis, "Storage", prevStorageDescriptor);
      } else {
        delete globalThis.Storage;
      }
    }
    if (installedStorageEventShim) {
      if (prevStorageEventDescriptor) {
        Object.defineProperty(
          globalThis,
          "StorageEvent",
          prevStorageEventDescriptor,
        );
      } else {
        delete globalThis.StorageEvent;
      }
    }
  });

  const createLockManager = () => {
    const tails = new Map();
    return {
      request(name, optionsOrCb, maybeCb) {
        const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
        const prev = tails.get(name) || Promise.resolve();
        let releaseCurrent;
        const held = new Promise((resolve) => {
          releaseCurrent = resolve;
        });
        tails.set(
          name,
          prev.then(() => held),
        );
        return prev.then(async () => {
          try {
            return await cb({ name });
          } finally {
            releaseCurrent();
          }
        });
      },
    };
  };

  const loadVueUseTabWithWindow = async ({
    sharedStorage,
    sharedIdb,
    sharedLocks,
    shouldFailSetItem = () => false,
    getArrayBufferImpl = null,
    storeArrayBufferImpl = null,
    deleteArrayBufferImpl = null,
  }) => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      verbose() {},
      gameMessage() {},
    };
    const windowListeners = new Map();
    const mockWindow = {
      location: { href: "http://127.0.0.1/" },
      addEventListener(type, fn) {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        windowListeners.get(type)?.delete(fn);
      },
      dispatchEvent(ev) {
        for (const fn of windowListeners.get(ev.type) || []) {
          fn(ev);
        }
      },
    };
    const storageAdapter = {
      getItem: (k) => (sharedStorage.has(k) ? sharedStorage.get(k) : null),
      setItem: (k, v) => {
        if (shouldFailSetItem(k, String(v))) {
          const err = new Error("QuotaExceededError");
          err.name = "QuotaExceededError";
          throw err;
        }
        sharedStorage.set(k, String(v));
      },
      removeItem: (k) => sharedStorage.delete(k),
    };
    const recoveryTimers = new Map();
    let nextTimer = 0;

    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": {
          useLocalStorage: (key, initial, opts) =>
            vueUseCore.useStorage(key, initial, storageAdapter, {
              ...opts,
              window: mockWindow,
            }),
        },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer:
              getArrayBufferImpl || (async (k) => sharedIdb.get(k) ?? null),
            storeArrayBuffer:
              storeArrayBufferImpl ||
              (async (k, buf) => {
                sharedIdb.set(k, buf);
                return true;
              }),
            deleteArrayBuffer:
              deleteArrayBufferImpl ||
              (async (k) => {
                sharedIdb.delete(k);
                return true;
              }),
            clearAll: async () => {
              sharedIdb.clear();
              return true;
            },
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/tokens" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: (fn, delay) => {
                const id = ++nextTimer;
                recoveryTimers.set(id, { fn, delay });
                return id;
              },
              clearTimer: (id) => recoveryTimers.delete(id),
            }),
        },
        "@/utils/logger": {
          gameLogger: logger,
          tokenLogger: logger,
          wsLogger: logger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () =>
            JSON.stringify({ roleId: "1001", roleToken: "refreshed-tok" }),
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: async () => ({}),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {
            constructor() {
              this.socket = { readyState: 1 };
            }
            setMessageListener() {}
            init() {
              this.onConnect();
            }
            disconnect() {
              if (this.socket) this.socket.readyState = 3;
              this.socket = null;
            }
            send() {}
            sendHeartbeat() {}
          },
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: storageAdapter,
        navigator: { onLine: true, locks: sharedLocks },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: mockWindow,
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );
    return {
      pinia,
      mod,
      store: mod.useTokenStore(),
      mockWindow,
      storageAdapter,
    };
  };

  test("Round5 P1-1: late storage event never reverts memory to stale tokens and locked writes always reconcile memory against live disk", async () => {
    const sharedStorage = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "accA",
            name: "账号A",
            roleId: "101",
            token: "old-token-A",
            remark: "",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "accB",
            name: "账号B",
            roleId: "102",
            token: "old-token-B",
            remark: "",
            importMethod: "bin",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdb = new Map();
    const sharedLocks = createLockManager();

    const tabA = await loadVueUseTabWithWindow({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });
    const tabB = await loadVueUseTabWithWindow({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });

    try {
      // Step 1: Tab A updates accA -> capture the earlier storage payload that would be queued as a storage event
      await tabA.store.commitCredentialUpdate("accA", {
        updates: { token: "fresh-token-A" },
      });
      const earlierEventNewValue = sharedStorage.get("gameTokens");

      // Step 2: Tab B updates accB before receiving Tab A's storage event -> disk now has BOTH fresh tokens
      await tabB.store.commitCredentialUpdate("accB", {
        updates: { token: "fresh-token-B" },
      });
      const diskBeforeLateEvent = JSON.parse(sharedStorage.get("gameTokens"));
      assert.equal(
        diskBeforeLateEvent.find((t) => t.id === "accA")?.token,
        "fresh-token-A",
      );
      assert.equal(
        diskBeforeLateEvent.find((t) => t.id === "accB")?.token,
        "fresh-token-B",
      );

      // Step 3A: Deliver the stale queued storage event to Tab B -> our listener reads live disk instead of event.newValue!
      tabB.mockWindow.dispatchEvent({
        type: "storage",
        key: "gameTokens",
        newValue: earlierEventNewValue,
        storageArea: tabB.storageAdapter,
      });
      assert.equal(
        tabB.store.gameTokens.find((t) => t.id === "accB")?.token,
        "fresh-token-B",
      );

      // Step 3B: Even if memory somehow still reverted to the stale snapshot while disk stays fresh (raw === lastKnown),
      // the next locked remark-only edit MUST reconcile memory against live disk instead of writing old Token back!
      const diskJsonBeforeRevert = sharedStorage.get("gameTokens");
      tabB.mod.gameTokens.value = JSON.parse(earlierEventNewValue);
      // Restore disk back to [fresh-A, fresh-B] to simulate VueUse reverting memory without writing disk
      sharedStorage.set("gameTokens", diskJsonBeforeRevert);
      assert.equal(
        tabB.store.gameTokens.find((t) => t.id === "accB")?.token,
        "old-token-B",
      );

      const remarkRes = await tabB.store.commitCredentialUpdate("accA", {
        updates: { remark: "仅修改备注" },
      });
      assert.equal(remarkRes.committed, true);

      const diskAfterRemark = JSON.parse(sharedStorage.get("gameTokens"));
      assert.equal(
        diskAfterRemark.find((t) => t.id === "accA")?.token,
        "fresh-token-A",
      );
      assert.equal(
        diskAfterRemark.find((t) => t.id === "accA")?.remark,
        "仅修改备注",
      );
      assert.equal(
        diskAfterRemark.find((t) => t.id === "accB")?.token,
        "fresh-token-B",
      );
    } finally {
      tabA.pinia._e.stop();
      tabB.pinia._e.stop();
    }
  });

  test("Round5 P1-2: localStorage write failure fails commit explicitly, rolls back memory/BIN/version, and preserves temp BIN and connection", async () => {
    const sharedStorage = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "acc1",
            name: "主号",
            roleId: "1001",
            token: "old-persisted-token",
            importMethod: "wxQrcode",
            combUser: { legacy: true },
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdb = new Map([
      ["acc1", new Uint8Array([1, 2]).buffer],
      ["temp-relogin-bin", new Uint8Array([9, 8, 7]).buffer],
      ["temp-first-bin", new Uint8Array([4, 4]).buffer],
    ]);
    const sharedLocks = createLockManager();
    let rejectGameTokensWrite = false;

    const tab = await loadVueUseTabWithWindow({
      sharedStorage,
      sharedIdb,
      sharedLocks,
      shouldFailSetItem: (key) => rejectGameTokensWrite && key === "gameTokens",
    });

    try {
      // Simulate an active WebSocket connection on acc1
      tab.store.wsConnections.acc1 = {
        status: "connected",
        client: { disconnect() {} },
        tokenId: "acc1",
      };

      // Turn on quota error for localStorage["gameTokens"]
      rejectGameTokensWrite = true;

      // Subcase A: Re-login updating existing acc1 fails cleanly, rolls back BIN & memory & version, keeps temp BIN & connection
      await assert.rejects(
        upsertImportedRoleTokens({
          roles: [
            {
              id: "temp-relogin-bin",
              roleId: "1001",
              name: "主号",
              token: "new-relogin-token",
              importMethod: "wxQrcode",
            },
          ],
          tokenStore: tab.store,
          getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
          storeArrayBuffer: async (k, buf) => {
            sharedIdb.set(k, buf);
            return true;
          },
          deleteArrayBuffer: async (k) => sharedIdb.delete(k),
        }),
        /保存账号列表到本地存储失败/,
      );

      // Disk AND memory both retain old Token and old combUser
      const diskAfterFail = JSON.parse(sharedStorage.get("gameTokens"));
      assert.equal(diskAfterFail[0].token, "old-persisted-token");
      assert.deepEqual(diskAfterFail[0].combUser, { legacy: true });
      assert.equal(tab.store.gameTokens[0].token, "old-persisted-token");
      assert.deepEqual(
        JSON.parse(JSON.stringify(tab.store.gameTokens[0].combUser)),
        { legacy: true },
      );
      assert.equal(tab.store.getCredentialVersion("acc1"), 0);
      // Old BIN restored at acc1, temp BIN preserved, active connection untouched
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("acc1"))),
        [1, 2],
      );
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("temp-relogin-bin"))),
        [9, 8, 7],
      );
      assert.equal(tab.store.wsConnections.acc1.status, "connected");

      // Subcase B: First-time import of a brand-new role also fails cleanly without polluting memory or deleting temp BIN
      await assert.rejects(
        upsertImportedRoleTokens({
          roles: [
            {
              id: "temp-first-bin",
              roleId: "2002",
              name: "新小号",
              token: "new-role-token",
              importMethod: "bin",
            },
          ],
          tokenStore: tab.store,
          getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
          storeArrayBuffer: async (k, buf) => {
            sharedIdb.set(k, buf);
            return true;
          },
          deleteArrayBuffer: async (k) => sharedIdb.delete(k),
        }),
        /保存账号列表到本地存储失败/,
      );
      assert.equal(tab.store.gameTokens.length, 1);
      assert.equal(JSON.parse(sharedStorage.get("gameTokens")).length, 1);
      assert.equal(sharedIdb.has("temp-first-bin"), true);

      // Subcase C: Remark-only edit under quota failure returns storage_write_failed and restores memory
      const editOutcome = await tab.store.commitCredentialUpdate("acc1", {
        updates: { remark: "配额不足备注" },
      });
      assert.equal(editOutcome.committed, false);
      assert.equal(editOutcome.reason, "storage_write_failed");
      assert.equal(tab.store.gameTokens[0].remark ?? "", "");
    } finally {
      tab.pinia._e.stop();
    }
  });

  test("Round5 P2-1: two tabs concurrently importing the same BIN for the first time perform matching and upsert inside one lock without duplicates", async () => {
    const sharedStorage = new Map([["gameTokens", JSON.stringify([])]]);
    const sharedIdb = new Map([
      ["bin-hash-same", new Uint8Array([7, 7, 7]).buffer],
      ["bin-role2-a", new Uint8Array([2, 1]).buffer],
      ["bin-role2-b", new Uint8Array([2, 2]).buffer],
    ]);
    const sharedLocks = createLockManager();

    const tabA = await loadVueUseTabWithWindow({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });
    const tabB = await loadVueUseTabWithWindow({
      sharedStorage,
      sharedIdb,
      sharedLocks,
    });

    try {
      const sameBinRole = {
        id: "bin-hash-same",
        roleId: "1001",
        name: "同BIN角色",
        token: "same-bin-token",
        importMethod: "bin",
      };
      const slowGet = async (k) => {
        await new Promise((r) => setTimeout(r, 10));
        return sharedIdb.get(k) ?? null;
      };
      const storeBin = async (k, buf) => {
        sharedIdb.set(k, buf);
        return true;
      };
      const deleteBin = async (k) => sharedIdb.delete(k);

      // Subcase A: Two tabs concurrently import the exact same BIN for the first time
      const [resA, resB] = await Promise.all([
        upsertImportedRoleTokens({
          roles: [{ ...sameBinRole }],
          tokenStore: tabA.store,
          getArrayBuffer: slowGet,
          storeArrayBuffer: storeBin,
          deleteArrayBuffer: deleteBin,
        }),
        upsertImportedRoleTokens({
          roles: [{ ...sameBinRole }],
          tokenStore: tabB.store,
          getArrayBuffer: slowGet,
          storeArrayBuffer: storeBin,
          deleteArrayBuffer: deleteBin,
        }),
      ]);
      assert.equal(resA.addedCount + resB.addedCount, 1);
      assert.equal(resA.updatedCount + resB.updatedCount, 1);

      const persistedAfterSame = JSON.parse(sharedStorage.get("gameTokens"));
      assert.equal(persistedAfterSame.length, 1);
      assert.equal(persistedAfterSame[0].id, "bin-hash-same");
      assert.equal(sharedIdb.has("bin-hash-same"), true);

      // Subcase B: Two tabs concurrently import two different BINs for the same roleId for the first time
      await Promise.all([
        upsertImportedRoleTokens({
          roles: [
            {
              id: "bin-role2-a",
              roleId: "2002",
              name: "角色二",
              token: "tok-2a",
              importMethod: "wxQrcode",
            },
          ],
          tokenStore: tabA.store,
          getArrayBuffer: slowGet,
          storeArrayBuffer: storeBin,
          deleteArrayBuffer: deleteBin,
        }),
        upsertImportedRoleTokens({
          roles: [
            {
              id: "bin-role2-b",
              roleId: "2002",
              name: "角色二",
              token: "tok-2b",
              importMethod: "wxQrcode",
            },
          ],
          tokenStore: tabB.store,
          getArrayBuffer: slowGet,
          storeArrayBuffer: storeBin,
          deleteArrayBuffer: deleteBin,
        }),
      ]);

      const persistedAfterRole2 = JSON.parse(sharedStorage.get("gameTokens"));
      const role2Entries = persistedAfterRole2.filter(
        (t) => String(t.roleId) === "2002",
      );
      assert.equal(role2Entries.length, 1);
    } finally {
      tabA.pinia._e.stop();
      tabB.pinia._e.stop();
    }
  });

  test("Round6 P1-2: first-time import fails explicitly when gameTokens key does not exist yet and localStorage rejects writes", async () => {
    // Subcase A: localStorage.setItem throws QuotaExceededError on brand-new storage (no "gameTokens" key yet)
    const emptyStorageA = new Map();
    const idbA = new Map([["temp-brand-new", new Uint8Array([3, 4]).buffer]]);
    const locksA = createLockManager();
    const tabA = await loadVueUseTabWithWindow({
      sharedStorage: emptyStorageA,
      sharedIdb: idbA,
      sharedLocks: locksA,
      shouldFailSetItem: (key) => key === "gameTokens",
    });

    try {
      assert.equal(emptyStorageA.has("gameTokens"), false);
      await assert.rejects(
        upsertImportedRoleTokens({
          roles: [
            {
              id: "temp-brand-new",
              roleId: "3001",
              name: "首导角色",
              token: "first-import-token",
              importMethod: "bin",
            },
          ],
          tokenStore: tabA.store,
          getArrayBuffer: async (k) => idbA.get(k) ?? null,
          storeArrayBuffer: async (k, buf) => {
            idbA.set(k, buf);
            return true;
          },
          deleteArrayBuffer: async (k) => idbA.delete(k),
        }),
        /保存账号列表到本地存储失败/,
      );
      assert.equal(tabA.store.gameTokens.length, 0);
      assert.equal(emptyStorageA.has("gameTokens"), false);
      assert.equal(idbA.has("temp-brand-new"), true);

      // Direct commitNewToken must also fail explicitly instead of silently keeping in-memory state
      await assert.rejects(
        tabA.store.commitNewToken({
          id: "manual-1",
          name: "手动号",
          token: "manual-token-long",
        }),
        /保存账号列表到本地存储失败/,
      );
      assert.equal(tabA.store.gameTokens.length, 0);
    } finally {
      tabA.pinia._e.stop();
    }

    // Subcase B: silent read-only localStorage (setItem drops writes without throwing)
    const droppedStorage = new Map();
    const idbB = new Map([["temp-silent", new Uint8Array([5, 6]).buffer]]);
    const locksB = createLockManager();
    const piniaB = createPinia();
    setActivePinia(piniaB);
    const noopLogger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      verbose() {},
      gameMessage() {},
    };
    const silentReadOnlyStorage = {
      getItem: (k) => (droppedStorage.has(k) ? droppedStorage.get(k) : null),
      setItem: () => {
        // Silently ignore write
      },
      removeItem: (k) => droppedStorage.delete(k),
    };
    const modB = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": {
          useLocalStorage: (key, initial, opts) =>
            vueUseCore.useStorage(key, initial, silentReadOnlyStorage, opts),
        },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async (k) => idbB.get(k) ?? null,
            storeArrayBuffer: async (k, buf) => {
              idbB.set(k, buf);
              return true;
            },
            deleteArrayBuffer: async (k) => {
              idbB.delete(k);
              return true;
            },
            clearAll: async () => {
              idbB.clear();
              return true;
            },
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/tokens" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: () => 1,
              clearTimer: () => {},
            }),
        },
        "@/utils/logger": {
          gameLogger: noopLogger,
          tokenLogger: noopLogger,
          wsLogger: noopLogger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () => "{}",
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: async () => ({}),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": {
          XyzwWebSocketClient: class {},
        },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: silentReadOnlyStorage,
        navigator: { onLine: true, locks: locksB },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );
    const storeB = modB.useTokenStore();
    try {
      await assert.rejects(
        upsertImportedRoleTokens({
          roles: [
            {
              id: "temp-silent",
              roleId: "3002",
              name: "静默只读角色",
              token: "silent-token",
              importMethod: "bin",
            },
          ],
          tokenStore: storeB,
          getArrayBuffer: async (k) => idbB.get(k) ?? null,
          storeArrayBuffer: async (k, buf) => {
            idbB.set(k, buf);
            return true;
          },
          deleteArrayBuffer: async (k) => idbB.delete(k),
        }),
        /保存账号列表到本地存储失败/,
      );
      assert.equal(storeB.gameTokens.length, 0);
      assert.equal(idbB.has("temp-silent"), true);
    } finally {
      piniaB._e.stop();
    }
  });

  test("Round6 P1-3: removeToken and clearAllTokens verify both localStorage and IndexedDB, preserve BIN on list failure, and return retryable failure state", async () => {
    const initialTokens = [
      {
        id: "acc1",
        name: "主号",
        roleId: "1001",
        token: "tok-1",
        importMethod: "bin",
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ];
    const sharedStorage = new Map([
      ["gameTokens", JSON.stringify(initialTokens)],
      ["selectedTokenId", "acc1"],
    ]);
    const sharedIdb = new Map([["acc1", new Uint8Array([8, 9]).buffer]]);
    const sharedLocks = createLockManager();
    let failGameTokensWrite = false;
    let failIdbDelete = false;
    let clearAllCalled = 0;

    const pinia = createPinia();
    setActivePinia(pinia);
    const noopLogger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      verbose() {},
      gameMessage() {},
    };
    const storageAdapter = {
      getItem: (k) => (sharedStorage.has(k) ? sharedStorage.get(k) : null),
      setItem: (k, v) => {
        if (failGameTokensWrite && k === "gameTokens") {
          throw new Error("QuotaExceededError");
        }
        sharedStorage.set(k, String(v));
      },
      removeItem: (k) => sharedStorage.delete(k),
    };

    const mod = await loadModule(
      new URL("../src/stores/tokenStore.ts", import.meta.url),
      {
        "@/utils/accountIdentity.js": accountIdentity,
        "@vueuse/core": {
          useLocalStorage: (key, initial, opts) =>
            vueUseCore.useStorage(key, initial, storageAdapter, opts),
        },
        pinia: { defineStore },
        vue,
        "@/hooks/useIndexedDB": {
          default: () => ({
            getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
            storeArrayBuffer: async (k, buf) => {
              sharedIdb.set(k, buf);
              return true;
            },
            deleteArrayBuffer: async (k) => {
              if (failIdbDelete) return false;
              sharedIdb.delete(k);
              return true;
            },
            clearAll: async () => {
              clearAllCalled += 1;
              if (failIdbDelete) return false;
              sharedIdb.clear();
              return true;
            },
          }),
        },
        "@/router": {
          default: { currentRoute: { value: { path: "/tokens" } } },
        },
        "@/utils/accountGameData": accountData,
        "@/utils/bonProtocol": { g_utils: {} },
        "@/utils/connectionRecovery": {
          createConnectionRecovery: (opts) =>
            createConnectionRecovery({
              ...opts,
              setTimer: () => 1,
              clearTimer: () => {},
            }),
        },
        "@/utils/logger": {
          gameLogger: noopLogger,
          tokenLogger: noopLogger,
          wsLogger: noopLogger,
        },
        "@/utils/randomSeed": { generateRandomSeed: () => 1 },
        "@/utils/token": {
          fetchTokenPayloadFromUrl: async () => ({}),
          scheduleAuthUserRequest: (fn) => fn(),
          setAuthUserRateLimiterCallback() {},
          transformToken: async () => "{}",
        },
        "@/utils/wechatForceLogout": {
          refreshTokenFromCombUser: async () => ({}),
          roleIndexFromServerId: () => 0,
        },
        "@/utils/xyzwWebSocket": { XyzwWebSocketClient: class {} },
        "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
      },
      {
        AbortController,
        WebSocket: { CLOSED: 3 },
        localStorage: storageAdapter,
        navigator: { onLine: true, locks: sharedLocks },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        window: {
          location: { href: "http://127.0.0.1/" },
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {},
        },
        document: {
          visibilityState: "visible",
          addEventListener() {},
          removeEventListener() {},
        },
      },
    );
    const store = mod.useTokenStore();

    try {
      // Case A: clearAllTokens fails when localStorage rejects write -> MUST NOT call clearAll() and MUST keep BIN & account
      failGameTokensWrite = true;
      const clearStorageFail = await store.clearAllTokens();
      assert.equal(clearStorageFail.ok, false);
      assert.equal(clearStorageFail.retryable, true);
      assert.equal(clearStorageFail.reason, "storage_write_failed");
      assert.equal(clearAllCalled, 0);
      assert.equal(sharedIdb.has("acc1"), true);
      assert.equal(store.gameTokens.length, 1);
      assert.equal(JSON.parse(sharedStorage.get("gameTokens")).length, 1);

      // Case B: removeToken fails when localStorage rejects write -> keeps account & BIN intact
      const removeStorageFail = await store.removeToken("acc1");
      assert.equal(removeStorageFail.ok, false);
      assert.equal(removeStorageFail.retryable, true);
      assert.equal(removeStorageFail.reason, "storage_write_failed");
      assert.equal(sharedIdb.has("acc1"), true);
      assert.equal(store.gameTokens.length, 1);

      // Case C: clearAllTokens fails when IndexedDB clearAll() returns false -> rolls back list and returns retryable error
      failGameTokensWrite = false;
      failIdbDelete = true;
      const clearIdbFail = await store.clearAllTokens();
      assert.equal(clearIdbFail.ok, false);
      assert.equal(clearIdbFail.binCleared, false);
      assert.equal(clearIdbFail.retryable, true);
      assert.equal(clearIdbFail.reason, "bin_delete_failed");
      assert.equal(sharedIdb.has("acc1"), true);
      assert.equal(store.gameTokens.length, 1);
      assert.equal(JSON.parse(sharedStorage.get("gameTokens")).length, 1);

      // Case D: removeToken fails when IndexedDB deleteArrayBuffer() returns false -> rolls back list and returns retryable error
      const removeIdbFail = await store.removeToken("acc1");
      assert.equal(removeIdbFail.ok, false);
      assert.equal(removeIdbFail.binCleared, false);
      assert.equal(removeIdbFail.retryable, true);
      assert.equal(removeIdbFail.reason, "bin_delete_failed");
      assert.equal(sharedIdb.has("acc1"), true);
      assert.equal(store.gameTokens.length, 1);

      // Case E: Retry after IndexedDB recovers succeeds cleanly across both layers
      failIdbDelete = false;
      const clearRetryOk = await store.clearAllTokens();
      assert.equal(clearRetryOk.ok, true);
      assert.equal(clearRetryOk.listCleared, true);
      assert.equal(clearRetryOk.binCleared, true);
      assert.equal(store.gameTokens.length, 0);
      assert.equal(JSON.parse(sharedStorage.get("gameTokens")).length, 0);
      assert.equal(sharedIdb.has("acc1"), false);
    } finally {
      pinia._e.stop();
    }

    // Verify TokenImport.vue and DefaultLayout.vue inspect deletion outcomes and prevent false success toasts
    const tokenImportSrc = await readFile(
      new URL("../src/views/TokenImport/TokenImport.vue", import.meta.url),
      "utf8",
    );
    assert.match(
      tokenImportSrc,
      /const result = await tokenStore\.removeToken\(token\.id\);\s*if \(result === false \|\| \(result && result\.ok === false\)\)/,
    );
    assert.match(
      tokenImportSrc,
      /const result = await tokenStore\.clearAllTokens\(\);\s*if \(result === false \|\| \(result && result\.ok === false\)\)/,
    );
    const defaultLayoutSrc = await readFile(
      new URL("../src/layout/DefaultLayout.vue", import.meta.url),
      "utf8",
    );
    assert.match(
      defaultLayoutSrc,
      /const result = await tokenStore\.clearAllTokens\(\);\s*if \(result === false \|\| \(result && result\.ok === false\)\)/,
    );
  });

  test("Round6 P2-1: when BIN rollback fails after localStorage write failure, commit reports rollback failure explicitly instead of claiming original data was preserved", async () => {
    const sharedStorage = new Map([
      [
        "gameTokens",
        JSON.stringify([
          {
            id: "acc1",
            name: "主号",
            roleId: "1001",
            token: "old-token",
            importMethod: "wxQrcode",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ]),
      ],
    ]);
    const sharedIdb = new Map([
      ["acc1", new Uint8Array([1, 1]).buffer],
      ["temp-new-bin", new Uint8Array([9, 9]).buffer],
    ]);
    const sharedLocks = createLockManager();
    let storeCallCount = 0;

    const tab = await loadVueUseTabWithWindow({
      sharedStorage,
      sharedIdb,
      sharedLocks,
      shouldFailSetItem: (key) => key === "gameTokens",
    });

    try {
      let caughtError = null;
      try {
        await upsertImportedRoleTokens({
          roles: [
            {
              id: "temp-new-bin",
              roleId: "1001",
              name: "主号",
              token: "new-token",
              importMethod: "wxQrcode",
            },
          ],
          tokenStore: tab.store,
          getArrayBuffer: async (k) => sharedIdb.get(k) ?? null,
          storeArrayBuffer: async (k, buf) => {
            storeCallCount += 1;
            if (storeCallCount === 1) {
              // First write (new BIN to acc1) succeeds
              sharedIdb.set(k, buf);
              return true;
            }
            // Second write (rollback restoring old BIN to acc1) fails!
            return false;
          },
          deleteArrayBuffer: async (k) => sharedIdb.delete(k),
        });
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError instanceof Error);
      assert.match(caughtError.message, /恢复原账号 BIN 凭据失败/);
      assert.match(caughtError.message, /已保留暂存凭据/);
      assert.doesNotMatch(caughtError.message, /已保留原有账号/);
      // Temp BIN MUST remain preserved for retry
      assert.deepEqual(
        Array.from(new Uint8Array(sharedIdb.get("temp-new-bin"))),
        [9, 9],
      );
      // Disk and memory still have old token
      assert.equal(tab.store.gameTokens[0].token, "old-token");
      assert.equal(
        JSON.parse(sharedStorage.get("gameTokens"))[0].token,
        "old-token",
      );
    } finally {
      tab.pinia._e.stop();
    }
  });
});
