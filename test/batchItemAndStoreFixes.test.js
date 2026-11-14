import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
import * as blackMarketConfig from "../src/utils/batch/blackMarketConfig.js";
import * as connectionManager from "../src/utils/batch/connectionManager.js";
import { createTasksArena } from "../src/utils/batch/tasksArena.js";
import { createTasksCampChallenge } from "../src/utils/batch/tasksCampChallenge.js";
import * as connectionRecovery from "../src/utils/connectionRecovery.js";
import { loadModule } from "./helpers/loadModule.js";

const immediateSetTimeout = (callback) => {
  callback();
  return 1;
};

const { createTasksItem } = await loadModule(
  new URL("../src/utils/batch/tasksItem.js", import.meta.url),
  {
    "@/utils/HeroList": { HERO_DICT: { 101: "吕布" } },
    "@/utils/PeachTaskIds": { PEACH_TASKS: [] },
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

const { createTasksTower } = await loadModule(
  new URL("../src/utils/batch/tasksTower.js", import.meta.url),
  {
    "@/utils/gameValue.js": { isSameGameValue: (a, b) => a === b },
    "../towerActId.js": { getTowerActId: () => 99 },
    "../towerClimbLimit.js": { normalizeWeirdTowerMaxClimb: (value) => value },
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

const { createTasksStore } = await loadModule(
  new URL("../src/utils/batch/tasksStore.js", import.meta.url),
  {
    "./blackMarketConfig": blackMarketConfig,
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

function createBatchDeps(overrides = {}) {
  const calls = [];
  const events = [];
  const closed = [];
  let releases = 0;
  const statuses = { value: {} };
  const tokens = overrides.tokens || [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
  ];
  const clients = Object.fromEntries(
    tokens.map(({ id }) => [id, { socket: {} }]),
  );

  const tokenStore = {
    wsConnections: Object.fromEntries(
      tokens.map(({ id }) => [id, { client: clients[id] }]),
    ),
    gameData: { roleInfo: { role: {} } },
    getWebSocketStatus: () => "connected",
    async sendGetRoleInfo(id) {
      events.push({ type: "send", id, cmd: "role_getroleinfo" });
      if (overrides.onSend) {
        return overrides.onSend(id, "role_getroleinfo", {});
      }
      return { role: { items: {} } };
    },
    async sendMessage(id, cmd, params) {
      calls.push({ id, cmd, params, mode: "sendMessage" });
      events.push({ type: "sendMessage", id, cmd, params });
      return {};
    },
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ id, cmd, params, mode: "promise" });
      events.push({ type: "send", id, cmd, params });
      if (overrides.onSend) {
        return overrides.onSend(id, cmd, params);
      }
      return {};
    },
    closeWebSocketConnection(id) {
      closed.push(id);
      events.push({ type: "close", id });
    },
  };

  const deps = {
    selectedTokens: { value: overrides.selected || ["alpha"] },
    tokens: { value: tokens },
    tokenStatus: statuses,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async (
      id,
      _retries,
      onSlotChange,
      onClientCreated,
      onReady,
    ) => {
      onSlotChange?.(true);
      onClientCreated?.(clients[id], clients[id]?.socket);
      onReady?.();
      return true;
    },
    releaseConnectionSlot() {
      releases++;
    },
    connectionQueue: { active: 0 },
    batchSettings: {
      maxActive: 2,
      boxType: 2001,
      boxCount: 1,
      purchaseItems: [],
      blackMarketEnabled: false,
      ...(overrides.batchSettings || {}),
    },
    helperSettings: {
      heroId: 101,
      count: 2,
      fishType: 1,
      boxType: 2001,
      ...(overrides.helperSettings || {}),
    },
    heroIds: [101],
    tokenStore,
    addLog() {},
    message: { success() {}, warning() {}, error() {} },
    currentRunningTokenId: { value: null },
    delayConfig: { battle: 0, action: 0, command: 0, refresh: 0 },
    loadSettings: () => ({
      arenaFormation: 1,
      towerFormation: 1,
      weirdTowerFormation: 1,
      weirdTowerMaxClimb: 2,
      ...(overrides.settings || {}),
    }),
    currentSettings: {
      arenaFormation: 1,
      towerFormation: 1,
      weirdTowerFormation: 1,
      weirdTowerMaxClimb: 2,
    },
    calculateMonthProgress: () => 1,
    isTodayAvailable: () => true,
    pickArenaTargetId: (targets) => targets?.roleList?.[0]?.roleId,
  };

  return {
    deps,
    calls,
    events,
    closed,
    statuses,
    getReleases: () => releases,
  };
}

test("Item 1 & 5: batchHeroUpgrade, batchBookUpgrade, and batchClaimStarRewards treat inner rawData as success and tasksItem awaits role_getroleinfo before close", async () => {
  let heroTry = 0;
  let bookTry = 0;
  let starTry = 0;
  const f = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "hero_heroupgradestar") {
        // Resolve twice with inner rawData object (no .code === 0), then fail on 3rd
        if (++heroTry <= 2) return { role: {} };
        return { code: 1 };
      }
      if (cmd === "book_upgrade") {
        if (++bookTry <= 2) return { book: {} };
        return { success: false };
      }
      if (cmd === "book_claimpointreward") {
        if (++starTry <= 2) return { reward: [] };
        return { result: 1 };
      }
      return { role: { items: {} } };
    },
  });
  const tasks = createTasksItem(f.deps);

  await tasks.batchHeroUpgrade();
  assert.equal(f.statuses.value.alpha, "completed");
  assert.equal(
    f.calls.filter((c) => c.cmd === "hero_heroupgradestar").length,
    3,
  );

  f.calls.length = 0;
  await tasks.batchBookUpgrade();
  assert.equal(f.statuses.value.alpha, "completed");
  assert.equal(f.calls.filter((c) => c.cmd === "book_upgrade").length, 3);

  f.calls.length = 0;
  await tasks.batchClaimStarRewards();
  assert.equal(f.statuses.value.alpha, "completed");
  assert.equal(
    f.calls.filter((c) => c.cmd === "book_claimpointreward").length,
    3,
  );

  // Item 5: batchOpenBox awaits role_getroleinfo via sendMessageWithPromise before closing connection
  f.events.length = 0;
  f.calls.length = 0;
  await tasks.batchOpenBox();
  const closeIdx = f.events.findIndex((e) => e.type === "close");
  const lastRoleIdx = f.events.findLastIndex(
    (e) => e.type === "send" && e.cmd === "role_getroleinfo",
  );
  assert.ok(lastRoleIdx !== -1 && lastRoleIdx < closeIdx);
  assert.equal(f.calls.filter((c) => c.mode === "sendMessage").length, 0);
});

test("Item 2: batchFish and batchTopUpFish pass newFree: false when consuming fishing rods", async () => {
  const f = createBatchDeps({
    helperSettings: { fishType: 1, count: 12 },
    onSend: async (_id, cmd) => {
      if (cmd === "role_getroleinfo") {
        return { role: { items: { 1011: { quantity: 12 } } } };
      }
      if (cmd === "activity_get") {
        return {
          activity: {
            myMonthInfo: { 2: { num: 0 } },
          },
        };
      }
      return {};
    },
  });

  await createTasksItem(f.deps).batchFish();
  const itemFishCalls = f.calls.filter((c) => c.cmd === "artifact_lottery");
  assert.equal(itemFishCalls.length, 2);
  assert.ok(itemFishCalls.every((c) => c.params.newFree === false));

  f.calls.length = 0;
  f.deps.isTodayAvailable = () => false;
  await createTasksArena(f.deps).batchTopUpFish();
  const arenaFishCalls = f.calls.filter((c) => c.cmd === "artifact_lottery");
  assert.ok(arenaFishCalls.length > 0);
  assert.ok(arenaFishCalls.every((c) => c.params.newFree === false));
});

test("Item 3: batchGenieSweep does not throw TypeError when res.role is undefined", async () => {
  const f = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "role_getroleinfo") {
        return { role: { items: { 1021: { quantity: 2 } }, genie: { 1: 1 } } };
      }
      if (cmd === "genie_sweep") {
        return { items: { 1001: 1 } }; // no .role property
      }
      return {};
    },
  });

  await createTasksItem(f.deps).batchGenieSweep();
  assert.equal(f.calls.filter((call) => call.cmd === "genie_sweep").length, 1);
  assert.equal(f.statuses.value.alpha, "completed");
});

test("Item 6: ActivityPlugin is registered, tower delayed sends respect disconnect, and XyzwWebSocketClient blocks send after manualDisconnect", async () => {
  const registered = [];
  const mockLogger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    verbose() {},
  };
  const activityMod = await loadModule(
    new URL("../src/stores/events/activity.ts", import.meta.url),
    {
      "@/utils/logger": { gameLogger: mockLogger },
    },
  );
  assert.equal(typeof activityMod.ActivityPlugin, "function");
  assert.equal(activityMod.AckPlugin, activityMod.ActivityPlugin);

  await loadModule(new URL("../src/stores/events/index.ts", import.meta.url), {
    "event-emitter3": {
      EventEmitter: class {
        on() {
          registered.push("on");
        }
        emit() {}
      },
    },
    "@/utils/logger": {
      gameLogger: mockLogger,
    },
    "./ack.ts": { AckPlugin: () => registered.push("ack") },
    "./activity.ts": { ActivityPlugin: () => registered.push("activity") },
    "./chat.ts": { ChatPlugin: () => registered.push("chat") },
    "./hangup.ts": { HangupPlugin: () => registered.push("hangup") },
    "./legion.ts": { LegionPlugin: () => registered.push("legion") },
    "./role.ts": { RolePlugin: () => registered.push("role") },
    "./study.ts": { StudyPlugin: () => registered.push("study") },
    "./team.ts": { TeamPlugin: () => registered.push("team") },
    "./tower.ts": { TowerPlugin: () => registered.push("tower") },
  });
  assert.ok(registered.includes("activity"));

  // Verify tower.ts guards delayed client.send calls when disconnected or manualDisconnect
  const towerHandlers = {};
  const scheduledCallbacks = [];
  const towerMod = await loadModule(
    new URL("../src/stores/events/tower.ts", import.meta.url),
    {
      "@/utils/gameValue.js": { isSameGameValue: (a, b) => a === b },
      "@/utils/logger": { gameLogger: mockLogger },
    },
    {
      setTimeout: (fn) => {
        scheduledCallbacks.push(fn);
        return 1;
      },
    },
  );
  towerMod.TowerPlugin({
    onSome(events, handler) {
      for (const event of events) {
        towerHandlers[event] = handler;
      }
    },
  });
  let sentCount = 0;
  const manualDisconnectedClient = {
    connected: true,
    manualDisconnect: true,
    send() {
      sentCount++;
    },
  };
  await towerHandlers.fight_starttowerresp({
    body: {
      battleData: {
        options: { towerId: 10 },
        result: { sponsor: { ext: { curHP: 10 } } },
      },
    },
    client: manualDisconnectedClient,
    gameData: {
      value: {
        roleInfo: {
          role: { tower: { id: 10, energy: 5, reward: { 1: false } } },
        },
        towerResult: {},
      },
    },
  });
  await towerHandlers.tower_claimrewardresp({
    body: {},
    client: {
      connected: false,
      manualDisconnect: false,
      send() {
        sentCount++;
      },
    },
  });
  assert.equal(scheduledCallbacks.length, 2);
  scheduledCallbacks.forEach((cb) => cb());
  assert.equal(sentCount, 0);

  scheduledCallbacks.length = 0;
  const reconnectedClient = {
    connected: true,
    manualDisconnect: false,
    socket: {},
    send() {
      sentCount++;
    },
  };
  await towerHandlers.fight_starttowerresp({
    body: {
      battleData: {
        options: { towerId: 10 },
        result: { sponsor: { ext: { curHP: 10 } } },
      },
    },
    client: reconnectedClient,
    gameData: {
      value: {
        roleInfo: { role: { tower: { reward: { 1: false } } } },
        towerResult: {},
      },
    },
  });
  reconnectedClient.socket = {};
  scheduledCallbacks.forEach((cb) => cb());
  assert.equal(
    sentCount,
    0,
    "a delayed reward must not run on a replacement socket",
  );

  // Verify XyzwWebSocketClient.send does not reconnect after manualDisconnect
  const wsMod = await loadModule(
    new URL("../src/utils/xyzwWebSocket.js", import.meta.url),
    {
      "@/stores/cache": {
        $CacheManager: {
          getCache: () => ({ get: async (_k, fn) => fn(_k) }),
          delCache() {},
        },
      },
      "./bonProtocol.js": { g_utils: { bon: {}, getEnc: () => ({}) } },
      "./helperTaskRunner.js": { sleep: async () => {} },
      "./logger.js": {
        gameLogger: mockLogger,
        wsLogger: mockLogger,
      },
    },
    {
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
    },
  );
  const wsClient = new wsMod.XyzwWebSocketClient({
    url: "ws://127.0.0.1",
    utils: { bon: {}, getEnc: () => ({}) },
  });
  let reconnected = false;
  wsClient.reconnect = () => {
    reconnected = true;
  };
  wsClient.disconnect();
  assert.equal(wsClient.manualDisconnect, true);
  assert.equal(wsClient.send("heart_beat"), false);
  assert.equal(reconnected, false);
});

test("Item 6: tokenStore only clears xyzw_chat_msg_list when connecting or switching the selected account", async () => {
  setActivePinia(createPinia());
  const logger = new Proxy({}, { get: () => () => {} });
  const storage = new Map();
  const removedKeys = [];
  const module = await loadModule(
    new URL("../src/stores/tokenStore.ts", import.meta.url),
    {
      "@vueuse/core": { useLocalStorage: (_key, value) => vue.ref(value) },
      pinia: { defineStore },
      vue,
      "@/hooks/useIndexedDB": {
        default: () => ({
          getArrayBuffer() {},
          storeArrayBuffer() {},
          deleteArrayBuffer() {},
          clearAll() {},
        }),
      },
      "@/router": { default: {} },
      "@/utils/accountGameData": accountData,
      "@/utils/bonProtocol": { g_utils: {} },
      "@/utils/connectionRecovery": {
        createConnectionRecovery: (options) =>
          connectionRecovery.createConnectionRecovery({
            ...options,
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
        scheduleAuthUserRequest() {},
        setAuthUserRateLimiterCallback() {},
        transformToken() {},
      },
      "@/utils/wechatForceLogout": {
        refreshTokenFromCombUser() {},
        roleIndexFromServerId() {},
      },
      "@/utils/xyzwWebSocket": {
        XyzwWebSocketClient: class {
          setMessageListener(listener) {
            this.listener = listener;
          }
          init() {}
          send() {}
          disconnect() {}
        },
      },
      "./events/index.js": {
        $emit: { emit() {} },
        emitPlus() {},
      },
    },
    {
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
      window: { location: { href: "http://127.0.0.1/" } },
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, val) => storage.set(key, String(val)),
        removeItem: (key) => {
          storage.delete(key);
          removedKeys.push(key);
        },
      },
    },
  );
  module.gameTokens.value = [
    { id: "alpha", roleId: "alpha", token: "tok-alpha-123456" },
    { id: "beta", roleId: "beta", token: "tok-beta-123456" },
  ];
  module.selectedTokenId.value = "alpha";
  const store = module.useTokenStore();

  const betaClient = await store.createWebSocketConnection(
    "beta",
    "tok-beta-123456",
  );
  betaClient.onConnect();
  assert.equal(removedKeys.filter((k) => k === "xyzw_chat_msg_list").length, 0);

  const alphaClient = await store.createWebSocketConnection(
    "alpha",
    "tok-alpha-123456",
  );
  alphaClient.onConnect();
  assert.equal(removedKeys.filter((k) => k === "xyzw_chat_msg_list").length, 1);
});

test("Item 9: batchTopUpArena, climbTower, and climbWeirdTower restore original preset team in finally before connection close", async () => {
  // 1. batchTopUpArena interrupted mid-run
  const arenaFix = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "activity_get") {
        return {
          activity: {
            myArenaInfo: { num: 0 },
          },
        };
      }
      if (cmd === "role_getroleinfo") {
        return { role: { items: { 1007: { quantity: 5 } } } };
      }
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: 3 } };
      }
      if (cmd === "arena_getareatarget") {
        arenaFix.deps.shouldStop.value = true;
        return { roleList: [{ roleId: 123 }] };
      }
      return {};
    },
  });
  await createTasksArena(arenaFix.deps).batchTopUpArena();
  const arenaTeamSaves = arenaFix.events.filter(
    (e) => e.type === "send" && e.cmd === "presetteam_saveteam",
  );
  assert.deepEqual(
    arenaTeamSaves.map((e) => e.params.teamId),
    [1, 3],
  );
  assert.ok(
    arenaFix.events.findLastIndex(
      (e) => e.type === "send" && e.cmd === "presetteam_saveteam",
    ) < arenaFix.events.findIndex((e) => e.type === "close"),
  );

  // 2. climbTower interrupted mid-run
  const towerFix = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "role_getroleinfo") {
        return { role: { tower: { energy: 2, id: 10 } } };
      }
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: 2 } };
      }
      if (cmd === "fight_starttower") {
        towerFix.deps.shouldStop.value = true;
        return {};
      }
      return {};
    },
  });
  await createTasksTower(towerFix.deps).climbTower();
  const towerTeamSaves = towerFix.events.filter(
    (e) => e.type === "send" && e.cmd === "presetteam_saveteam",
  );
  assert.deepEqual(
    towerTeamSaves.map((e) => e.params.teamId),
    [1, 2],
  );
  assert.ok(
    towerFix.events.findLastIndex(
      (e) => e.type === "send" && e.cmd === "presetteam_saveteam",
    ) < towerFix.events.findIndex((e) => e.type === "close"),
  );

  // 3. climbWeirdTower interrupted mid-run
  const weirdFix = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "activity_get") {
        return {
          activity: {
            towerActivity: { 99: { towerId: 1, energy: 2 } },
          },
        };
      }
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: 4 } };
      }
      if (cmd === "activity_starttower") {
        throw new Error("weird tower error");
      }
      return {};
    },
  });
  await createTasksTower(weirdFix.deps).climbWeirdTower();
  const weirdTeamSaves = weirdFix.events.filter(
    (e) => e.type === "send" && e.cmd === "presetteam_saveteam",
  );
  assert.deepEqual(
    weirdTeamSaves.map((e) => e.params.teamId),
    [1, 4],
  );
  assert.ok(
    weirdFix.events.findLastIndex(
      (e) => e.type === "send" && e.cmd === "presetteam_saveteam",
    ) < weirdFix.events.findIndex((e) => e.type === "close"),
  );
});

test("Item 11: tasksStore preserves shouldStop after stopping and blocks re-entrant runs when isRunning is true", async () => {
  const f = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "store_purchase") {
        f.deps.shouldStop.value = true;
      }
      return {};
    },
  });
  const storeTasks = createTasksStore(f.deps);
  await storeTasks.store_purchase();
  assert.equal(f.deps.shouldStop.value, true);

  // Re-entrancy guard prevents starting while isRunning is true
  f.deps.isRunning.value = true;
  f.calls.length = 0;
  await storeTasks.store_purchase();
  assert.equal(f.calls.length, 0);
});

test("Item 11: batchCampChallenge does not call batchCampClaimTasks when stopped, and single-account pet timeout does not set global shouldStop", async () => {
  const f = createBatchDeps({
    onSend: async (_id, cmd) => {
      if (cmd === "club_getinfo") {
        f.deps.shouldStop.value = true;
        return {};
      }
      return {};
    },
  });
  const campTasks = createTasksCampChallenge(f.deps);
  await campTasks.batchCampChallenge();
  assert.equal(f.deps.shouldStop.value, true);
  assert.equal(f.calls.filter((c) => c.cmd === "club_claimtask").length, 0);

  // Verify single-account pet timeout only stops that account and allows beta to complete
  const petFix = createBatchDeps({
    selected: ["alpha", "beta"],
    onSend: async (id, cmd) => {
      if (cmd === "presetteam_getinfo") {
        return {
          presetTeamInfo: { 1: { teamInfo: { 1: { heroId: 101 } } } },
        };
      }
      if (cmd === "role_getroleinfo") {
        return {
          role: {
            lordWeaponId: 1,
            battleTeam: { 1: 101 },
            petBag: {},
          },
        };
      }
      if (cmd === "club_attackmonster") {
        if (id === "alpha") throw new Error("timeout");
        return { battleData: { result: { isWin: true } }, reward: [] };
      }
      return {};
    },
  });
  await createTasksCampChallenge(petFix.deps).batchCampChallengePet();
  assert.equal(petFix.deps.shouldStop.value, false);
  assert.equal(petFix.statuses.value.alpha, "failed");
  assert.equal(petFix.statuses.value.beta, "completed");
  assert.equal(
    petFix.calls.filter(
      (c) => c.id === "alpha" && c.cmd === "club_attackmonster",
    ).length,
    1,
  );
  assert.equal(
    petFix.calls.filter(
      (c) => c.id === "beta" && c.cmd === "club_attackmonster",
    ).length,
    3,
  );
});

test("batch fish never spends rods after an uncertain free draw or missing progress", async () => {
  for (const scenario of [
    "free-timeout",
    "missing-refresh",
    "missing-initial",
  ]) {
    let reads = 0;
    const f = createBatchDeps({
      onSend: async (_id, cmd, params) => {
        if (cmd === "role_getroleinfo") {
          return { role: { items: { 1011: { quantity: 25 } } } };
        }
        if (cmd === "activity_get") {
          reads++;
          if (
            scenario === "missing-initial" ||
            (reads > 1 && scenario === "missing-refresh")
          )
            return {};
          return { activity: { myMonthInfo: { 2: { num: 63 } } } };
        }
        if (
          cmd === "artifact_lottery" &&
          params.newFree &&
          scenario === "free-timeout"
        ) {
          throw new Error("timeout");
        }
        return {};
      },
    });
    f.deps.calculateMonthProgress = () => 0.2;
    f.deps.isTodayAvailable = () => true;
    await createTasksArena(f.deps).batchTopUpFish();
    assert.equal(
      f.calls.some(
        (call) => call.cmd === "artifact_lottery" && !call.params.newFree,
      ),
      false,
      scenario,
    );
    assert.equal(f.statuses.value.alpha, "pending", scenario);
  }
});

test("genie sweep stops and reports pending on failure or unchanged ticket count", async () => {
  for (const scenario of ["timeout", "failure", "unchanged"]) {
    const f = createBatchDeps({
      onSend: async (_id, cmd) => {
        if (cmd === "role_getroleinfo") {
          return {
            role: { items: { 1021: { quantity: 45 } }, genie: { 1: 10 } },
          };
        }
        if (cmd === "genie_sweep") {
          if (scenario === "timeout") throw new Error("timeout");
          if (scenario === "failure") return { success: false };
          return { items: { 1021: { quantity: 45 } } };
        }
        return {};
      },
    });
    await createTasksItem(f.deps).batchGenieSweep();
    assert.equal(
      f.calls.filter((call) => call.cmd === "genie_sweep").length,
      1,
      scenario,
    );
    assert.equal(f.statuses.value.alpha, "pending", scenario);
  }
});

test("arena top-up stops after an unconfirmed fight or unavailable target", async () => {
  for (const scenario of ["fight-timeout", "no-target", "missing-progress"]) {
    let targetReads = 0;
    const f = createBatchDeps({
      onSend: async (_id, cmd) => {
        if (cmd === "presetteam_getinfo")
          return { presetTeamInfo: { useTeamId: 1 } };
        if (cmd === "activity_get") {
          return scenario === "missing-progress"
            ? {}
            : { activity: { myArenaInfo: { num: 0 } } };
        }
        if (cmd === "role_getroleinfo")
          return { role: { items: { 1007: { quantity: 5 } } } };
        if (cmd === "arena_getareatarget") {
          targetReads++;
          if (targetReads > 1) f.deps.shouldStop.value = true;
          return scenario === "no-target"
            ? {}
            : { roleList: [{ roleId: 123 }] };
        }
        if (cmd === "fight_startareaarena") throw new Error("timeout");
        return {};
      },
    });
    f.deps.calculateMonthProgress = () => 0.2;
    await createTasksArena(f.deps).batchTopUpArena();
    assert.equal(
      f.calls.filter((call) => call.cmd === "fight_startareaarena").length,
      scenario === "fight-timeout" ? 1 : 0,
      scenario,
    );
    assert.ok(targetReads <= 1, scenario);
    assert.equal(f.statuses.value.alpha, "pending", scenario);
  }
});
