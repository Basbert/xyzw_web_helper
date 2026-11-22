import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
import * as accountIdentity from "../src/utils/accountIdentity.js";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";
import {
  formatUpsertImportMessage,
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
