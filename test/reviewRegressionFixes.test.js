import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import * as vueUseCore from "@vueuse/core";
import eventEmitterPkg from "event-emitter3";
import { createPinia, defineStore, setActivePinia } from "pinia";
import ts from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import * as accountData from "../src/utils/accountGameData.js";
import * as connectionRecovery from "../src/utils/connectionRecovery.js";
import { loadModule } from "./helpers/loadModule.js";

const { EventEmitter } = eventEmitterPkg;

function noopLogger() {
  return new Proxy({}, { get: () => () => {} });
}

function createMessageMock() {
  const calls = [];
  const fn = (type) => (text) => calls.push({ type, text });
  const msg = {
    calls,
    info: fn("info"),
    loading: fn("loading"),
    success: fn("success"),
    warning: fn("warning"),
    error: fn("error"),
  };
  return msg;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFixedDate(isoString = "2026-11-14T04:00:00.000Z") {
  const fixedMs = new Date(isoString).getTime();
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixedMs]));
    }

    static now() {
      return fixedMs;
    }
  };
}

async function loadSfcSetup(url, dependencies = {}, globals = {}) {
  const source = await readFile(url, "utf8");
  const { descriptor } = parse(source);
  const compiled = compileScript(descriptor, {
    id: url.pathname,
    isProd: false,
  });
  const { outputText } = ts.transpileModule(compiled.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  });
  const exports = {};
  const mountedHooks = [];
  const unmountedHooks = [];
  const vueMock = {
    ...vue,
    onMounted(fn) {
      mountedHooks.push(fn);
    },
    onUnmounted(fn) {
      unmountedHooks.push(fn);
    },
    onBeforeUnmount(fn) {
      unmountedHooks.push(fn);
    },
  };
  const resolvedDeps = {
    vue: vueMock,
    ...dependencies,
  };
  vm.runInNewContext(
    outputText,
    {
      exports,
      require(name) {
        if (Object.hasOwn(resolvedDeps, name)) {
          return resolvedDeps[name];
        }
        throw new Error(`Unexpected SFC dependency: ${name}`);
      },
      console,
      URL,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      ...globals,
    },
    { filename: url.pathname },
  );
  const comp = exports.default;
  const scope = vue.effectScope(true);
  let bindings;
  scope.run(() => {
    bindings = comp.setup({}, { expose() {} });
  });
  return {
    bindings,
    mount: () => mountedHooks.forEach((fn) => fn()),
    cleanup: () => {
      unmountedHooks.forEach((fn) => fn());
      scope.stop();
    },
  };
}

function createMemoryStorage() {
  const map = new Map();
  const storage = {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
  return { map, storage };
}

test("Fix #1: MonthlyTasksCard refreshes progress and skips paid fishing when free fishing times out", async () => {
  const sent = [];
  const msg = createMessageMock();
  const tokenStore = vue.reactive({
    selectedToken: { id: "A", name: "A" },
    wsConnections: { A: { status: "connected", client: { id: "cA" } } },
    gameData: {
      roleInfo: {
        role: {
          statisticsTime: { "artifact:normal:lottery:time": 0 },
        },
      },
    },
    getWebSocketStatus: (id) => (id === "A" ? "connected" : "disconnected"),
    async sendMessageWithPromise(_tokenId, cmd, params) {
      sent.push({ cmd, params });
      if (cmd === "artifact_lottery" && params.newFree) {
        throw new Error("请求超时");
      }
      if (cmd === "activity_get") {
        return {
          activity: {
            myMonthInfo: { 2: { num: 3 } },
            myArenaInfo: { num: 0 },
          },
        };
      }
      return {};
    },
  });

  const { bindings, cleanup } = await loadSfcSetup(
    new URL("../src/components/cards/MonthlyTasksCard.vue", import.meta.url),
    {
      "naive-ui": { useMessage: () => msg },
      "@/stores/tokenStore": { useTokenStore: () => tokenStore },
      "../Common/MyCard.vue": { default: {} },
    },
  );

  try {
    bindings.monthActivity.value = { myMonthInfo: { 2: { num: 3 } } };
    await bindings.autoTopUpFish(10, 50, 100);
    assert.ok(
      sent.some((item) => item.cmd === "activity_get"),
      "free timeout must still refresh monthly activity",
    );
    assert.equal(
      sent.some(
        (item) => item.cmd === "artifact_lottery" && !item.params.newFree,
      ),
      false,
      "must not spend paid fishing rods when free result is unknown",
    );
  } finally {
    cleanup();
  }
});

test("Fix #9: MonthlyTasksCard detects A -> B -> A synchronous switch in fish and arena top-up", async () => {
  const sentFish = [];
  const fishGate = createDeferred();
  const nowSec = Math.floor(Date.now() / 1000);
  const msg = createMessageMock();
  const tokenStore = vue.reactive({
    selectedToken: { id: "A", name: "A" },
    wsConnections: {
      A: { status: "connected", client: { id: "cA" } },
      B: { status: "connected", client: { id: "cB" } },
    },
    gameData: {
      roleInfo: {
        role: {
          statisticsTime: { "artifact:normal:lottery:time": nowSec },
        },
      },
    },
    getWebSocketStatus: (id) =>
      tokenStore.wsConnections[id]?.status || "disconnected",
    async sendMessageWithPromise(tokenId, cmd, params) {
      sentFish.push({ tokenId, cmd, params });
      if (cmd === "artifact_lottery" && sentFish.length === 1) {
        await fishGate.promise;
      }
      return { myMonthInfo: { 2: { num: 0 } }, myArenaInfo: { num: 0 } };
    },
  });

  const { bindings, cleanup } = await loadSfcSetup(
    new URL("../src/components/cards/MonthlyTasksCard.vue", import.meta.url),
    {
      "naive-ui": { useMessage: () => msg },
      "@/stores/tokenStore": { useTokenStore: () => tokenStore },
      "../Common/MyCard.vue": { default: {} },
    },
  );

  try {
    bindings.monthActivity.value = { myMonthInfo: { 2: { num: 0 } } };
    const run = bindings.autoTopUpFish(20, 50, 100);
    await Promise.resolve();
    tokenStore.selectedToken = { id: "B", name: "B" };
    tokenStore.selectedToken = { id: "A", name: "A" };
    fishGate.resolve();
    await run;

    assert.equal(
      sentFish.filter((entry) => entry.cmd === "artifact_lottery").length,
      1,
      "A -> B -> A switch must abort remaining paid fishing batches",
    );
    assert.equal(
      sentFish.filter(
        (entry) => entry.tokenId === "A" && entry.cmd === "artifact_lottery",
      ).length,
      1,
    );
  } finally {
    cleanup();
  }

  // Also test autoTopUpArena A -> B -> A
  {
    const sentArena = [];
    const targetGate = createDeferred();
    const store = vue.reactive({
      selectedToken: { id: "A", name: "A" },
      wsConnections: {
        A: { status: "connected", client: { id: "cA" } },
        B: { status: "connected", client: { id: "cB" } },
      },
      getWebSocketStatus: (id) =>
        store.wsConnections[id]?.status || "disconnected",
      async sendMessageWithPromise(tokenId, cmd, params) {
        sentArena.push({ tokenId, cmd, params });
        if (cmd === "arena_getareatarget") {
          await targetGate.promise;
          return { rankList: [{ roleId: "target-1" }] };
        }
        return { myMonthInfo: {}, myArenaInfo: { num: 0 } };
      },
    });
    const env = await loadSfcSetup(
      new URL("../src/components/cards/MonthlyTasksCard.vue", import.meta.url),
      {
        "naive-ui": { useMessage: () => createMessageMock() },
        "@/stores/tokenStore": { useTokenStore: () => store },
        "../Common/MyCard.vue": { default: {} },
      },
      { Date: createFixedDate() },
    );
    try {
      env.bindings.monthActivity.value = { myArenaInfo: { num: 0 } };
      const run = env.bindings.autoTopUpArena(10, 50, 240);
      await new Promise((r) => setTimeout(r, 10));
      store.selectedToken = { id: "B", name: "B" };
      store.selectedToken = { id: "A", name: "A" };
      targetGate.resolve();
      await run;

      assert.equal(
        sentArena.some(
          (entry) =>
            entry.tokenId === "A" && entry.cmd === "fight_startareaarena",
        ),
        false,
        "A -> B -> A switch must abort pending arena fight on resumed A",
      );
    } finally {
      env.cleanup();
    }
  }
});

test("Fix #2 & #3: batcharenafight stops before fight on shouldStop and never restores formation to replacement client", async () => {
  const connMod = await loadModule(
    new URL("../src/utils/batch/connectionManager.js", import.meta.url),
    { vue },
  );
  const arenaMod = await loadModule(
    new URL("../src/utils/batch/tasksArena.js", import.meta.url),
    {
      "./connectionManager.js": connMod,
      "./constants.js": { ARENA_TARGET: 240, FISH_TARGET: 2500 },
    },
  );

  // Case 2a: stop clicked during arena_getareatarget -> no fight sent, original formation still restored on intact connection
  {
    const targetGate = createDeferred();
    const sent = [];
    const shouldStop = vue.ref(false);
    const tokenStatus = vue.ref({});
    const connClient = { id: "orig", socket: { id: "s1" } };
    const tokenStore = {
      wsConnections: { t1: { status: "connected", client: connClient } },
      getWebSocketStatus: () => "connected",
      async sendGetRoleInfo() {
        return { role: { items: { 1007: { quantity: 3 } } } };
      },
      async sendMessageWithPromise(_id, cmd, params) {
        sent.push({ cmd, params });
        if (cmd === "presetteam_getinfo") {
          return { presetTeamInfo: { useTeamId: 1 } };
        }
        if (cmd === "arena_getareatarget") {
          await targetGate.promise;
          return { rankList: [{ roleId: "target-1" }] };
        }
        return {};
      },
    };
    const { batcharenafight } = arenaMod.createTasksArena({
      selectedTokens: vue.ref(["t1"]),
      tokens: vue.ref([{ id: "t1", name: "T1" }]),
      tokenStatus,
      isRunning: vue.ref(false),
      shouldStop,
      ensureConnection: async () => true,
      releaseConnectionSlot: () => {},
      connectionQueue: { active: 0 },
      batchSettings: { maxActive: 1 },
      tokenStore,
      currentSettings: { arenaFormation: 3 },
      delayConfig: { battle: 0 },
      pickArenaTargetId: (t) => t?.rankList?.[0]?.roleId,
      addLog: () => {},
      message: createMessageMock(),
      currentRunningTokenId: vue.ref(null),
      taskNames: {},
    });

    const run = batcharenafight();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    shouldStop.value = true;
    targetGate.resolve();
    await run;

    assert.equal(
      sent.some((c) => c.cmd === "fight_startareaarena"),
      false,
      "stopping during arena_getareatarget must not start fight",
    );
    assert.deepEqual(
      sent
        .filter((c) => c.cmd === "presetteam_saveteam")
        .map((c) => c.params.teamId),
      [3, 1],
    );
    assert.equal(tokenStatus.value.t1, "stopped");
  }

  // Case 3: connection replaced during fight -> finally skips presetteam_saveteam on new client
  {
    const fightGate = createDeferred();
    const origSent = [];
    const newSent = [];
    const origClient = { id: "orig", socket: { id: "s1" } };
    const newClient = { id: "user-new", socket: { id: "s2" } };
    const tokenStatus = vue.ref({});
    const connState = vue.reactive({ status: "connected", client: origClient });
    const tokenStore = {
      wsConnections: { t1: connState },
      getWebSocketStatus: () => connState.status,
      async sendGetRoleInfo() {
        return { role: { items: { 1007: { quantity: 1 } } } };
      },
      async sendMessageWithPromise(id, cmd, params) {
        const active = tokenStore.wsConnections[id].client;
        if (active === newClient) {
          newSent.push({ cmd, params });
          return {};
        }
        origSent.push({ cmd, params });
        if (cmd === "presetteam_getinfo") {
          return { presetTeamInfo: { useTeamId: 1 } };
        }
        if (cmd === "arena_getareatarget") {
          return { rankList: [{ roleId: "target-1" }] };
        }
        if (cmd === "fight_startareaarena") {
          await fightGate.promise;
        }
        return {};
      },
    };
    const { batcharenafight } = arenaMod.createTasksArena({
      selectedTokens: vue.ref(["t1"]),
      tokens: vue.ref([{ id: "t1", name: "T1" }]),
      tokenStatus,
      isRunning: vue.ref(false),
      shouldStop: vue.ref(false),
      ensureConnection: async () => true,
      releaseConnectionSlot: () => {},
      connectionQueue: { active: 0 },
      batchSettings: { maxActive: 1 },
      tokenStore,
      currentSettings: { arenaFormation: 3 },
      delayConfig: { battle: 0 },
      pickArenaTargetId: (t) => t?.rankList?.[0]?.roleId,
      addLog: () => {},
      message: createMessageMock(),
      currentRunningTokenId: vue.ref(null),
      taskNames: {},
    });

    const run = batcharenafight();
    await new Promise((r) => setTimeout(r, 15));
    connState.client = newClient;
    fightGate.resolve();
    await run;

    assert.equal(
      newSent.length,
      0,
      "new client must never receive restore command",
    );
    assert.equal(tokenStatus.value.t1, "stopped");
  }
});

test("Fix #3 & #6: Tower and Arena TopUp reject invalid useTeamId and downgrade status if restore fails", async () => {
  const connMod = await loadModule(
    new URL("../src/utils/batch/connectionManager.js", import.meta.url),
    { vue },
  );
  const towerMod = await loadModule(
    new URL("../src/utils/batch/tasksTower.js", import.meta.url),
    {
      "./connectionManager.js": connMod,
      "@/utils/gameValue.js": { isSameGameValue: (a, b) => a === b },
      "../towerActId.js": { getTowerActId: () => 1 },
      "../towerClimbLimit.js": { normalizeWeirdTowerMaxClimb: () => 1 },
    },
  );

  // Case 6a: empty presetTeamInfo stops climbTower before switching formation
  {
    const sent = [];
    const tokenStatus = vue.ref({});
    const client = { id: "c1", socket: { id: "s1" } };
    const { climbTower } = towerMod.createTasksTower({
      selectedTokens: vue.ref(["t1"]),
      tokens: vue.ref([{ id: "t1", name: "T1" }]),
      tokenStatus,
      isRunning: vue.ref(false),
      shouldStop: vue.ref(false),
      ensureConnection: async () => true,
      releaseConnectionSlot: () => {},
      connectionQueue: { active: 0 },
      batchSettings: { maxActive: 1 },
      tokenStore: {
        wsConnections: { t1: { status: "connected", client } },
        getWebSocketStatus: () => "connected",
        async sendMessageWithPromise(_id, cmd, params) {
          sent.push({ cmd, params });
          return {};
        },
        async sendGetRoleInfo() {
          return { role: { tower: { energy: 5 } } };
        },
      },
      currentSettings: { towerFormation: 3 },
      delayConfig: { battle: 0, refresh: 0 },
      addLog: () => {},
      message: createMessageMock(),
      currentRunningTokenId: vue.ref(null),
      taskNames: {},
    });

    await climbTower();
    assert.equal(tokenStatus.value.t1, "failed");
    assert.equal(
      sent.some((c) => c.cmd === "presetteam_saveteam"),
      false,
      "must not switch formation when original useTeamId is missing",
    );
  }

  // Case 6b: restore failure downgrades climbTower from completed to pending
  {
    const tokenStatus = vue.ref({});
    const logs = [];
    const client = { id: "c1", socket: { id: "s1" } };
    let saveCalls = 0;
    const { climbTower } = towerMod.createTasksTower({
      selectedTokens: vue.ref(["t1"]),
      tokens: vue.ref([{ id: "t1", name: "T1" }]),
      tokenStatus,
      isRunning: vue.ref(false),
      shouldStop: vue.ref(false),
      ensureConnection: async () => true,
      releaseConnectionSlot: () => {},
      connectionQueue: { active: 0 },
      batchSettings: { maxActive: 1 },
      tokenStore: {
        wsConnections: { t1: { status: "connected", client } },
        getWebSocketStatus: () => "connected",
        async sendMessageWithPromise(_id, cmd) {
          if (cmd === "presetteam_getinfo") {
            return { presetTeamInfo: { useTeamId: 1 } };
          }
          if (cmd === "presetteam_saveteam") {
            saveCalls++;
            if (saveCalls === 2) throw new Error("restore failed");
          }
          return {};
        },
        async sendGetRoleInfo() {
          return { role: { tower: { energy: 0 } } };
        },
      },
      currentSettings: { towerFormation: 3 },
      delayConfig: { battle: 0, refresh: 0 },
      addLog: (entry) => logs.push(entry.message),
      message: createMessageMock(),
      currentRunningTokenId: vue.ref(null),
      taskNames: {},
    });

    await climbTower();
    assert.equal(tokenStatus.value.t1, "pending", logs.join(" | "));
  }

  // Case 6c: climbWeirdTower rejects missing useTeamId and skips restore to replaced client
  {
    const sent = [];
    const tokenStatus = vue.ref({});
    const origClient = { id: "orig", socket: { id: "s1" } };
    const newClient = { id: "user-new", socket: { id: "s2" } };
    const connState = vue.reactive({ status: "connected", client: origClient });
    const fightGate = createDeferred();
    const newSent = [];
    const { climbWeirdTower } = towerMod.createTasksTower({
      selectedTokens: vue.ref(["t1"]),
      tokens: vue.ref([{ id: "t1", name: "T1" }]),
      tokenStatus,
      isRunning: vue.ref(false),
      shouldStop: vue.ref(false),
      ensureConnection: async () => true,
      releaseConnectionSlot: () => {},
      connectionQueue: { active: 0 },
      batchSettings: { maxActive: 1 },
      tokenStore: {
        wsConnections: { t1: connState },
        getWebSocketStatus: () => connState.status,
        async sendMessageWithPromise(id, cmd, params) {
          if (tokenStoreProxy.wsConnections[id].client === newClient) {
            newSent.push({ cmd, params });
            return {};
          }
          sent.push({ cmd, params });
          if (cmd === "presetteam_getinfo") {
            return { presetTeamInfo: { useTeamId: 1 } };
          }
          if (cmd === "evotower_getinfo") {
            return { evoTower: { towerId: 240, rewardTowerId: 24, energy: 1 } };
          }
          if (cmd === "evotower_readyfight") {
            await fightGate.promise;
            return {};
          }
          return {};
        },
        async sendGetRoleInfo() {
          return { role: {} };
        },
      },
      currentSettings: { towerFormation: 3 },
      delayConfig: { battle: 0, refresh: 0 },
      addLog: () => {},
      message: createMessageMock(),
      currentRunningTokenId: vue.ref(null),
      taskNames: {},
    });
    const tokenStoreProxy = { wsConnections: { t1: connState } };
    const run = climbWeirdTower();
    await new Promise((r) => setTimeout(r, 15));
    connState.client = newClient;
    fightGate.resolve();
    await run;

    assert.equal(newSent.length, 0);
    assert.equal(tokenStatus.value.t1, "stopped");
  }

  // Case 6d: batchTopUpArena rejects missing useTeamId, stops before fight_startareaarena, and skips restore to replaced client
  {
    const arenaMod = await loadModule(
      new URL("../src/utils/batch/tasksArena.js", import.meta.url),
      {
        "./connectionManager.js": connMod,
        "./constants.js": { ARENA_TARGET: 240, FISH_TARGET: 2500 },
      },
      { Date: createFixedDate() },
    );
    {
      // Missing useTeamId -> fails without switching formation
      const sentMissing = [];
      const statusMissing = vue.ref({});
      const client1 = { id: "c1", socket: { id: "s1" } };
      const { batchTopUpArena: runMissing } = arenaMod.createTasksArena({
        selectedTokens: vue.ref(["t1"]),
        tokens: vue.ref([{ id: "t1", name: "T1" }]),
        tokenStatus: statusMissing,
        isRunning: vue.ref(false),
        shouldStop: vue.ref(false),
        ensureConnection: async () => true,
        releaseConnectionSlot: () => {},
        connectionQueue: { active: 0 },
        batchSettings: { maxActive: 1 },
        tokenStore: {
          wsConnections: { t1: { status: "connected", client: client1 } },
          getWebSocketStatus: () => "connected",
          async sendGetRoleInfo() {
            return { role: { items: { 1007: { quantity: 10 } } } };
          },
          async sendMessageWithPromise(_id, cmd, params) {
            sentMissing.push({ cmd, params });
            if (cmd === "activity_get") {
              return { activity: { myArenaInfo: { num: 0 } } };
            }
            return {};
          },
        },
        currentSettings: { arenaFormation: 3 },
        delayConfig: { battle: 0 },
        calculateMonthProgress: () => 0.5,
        pickArenaTargetId: (t) => t?.rankList?.[0]?.roleId,
        addLog: () => {},
        message: createMessageMock(),
        currentRunningTokenId: vue.ref(null),
        taskNames: {},
      });
      await runMissing();
      assert.equal(statusMissing.value.t1, "failed");
      assert.equal(
        sentMissing.some((c) => c.cmd === "presetteam_saveteam"),
        false,
        "batchTopUpArena must not switch formation when useTeamId is missing",
      );

      // Replaced connection during arena_getareatarget -> no fight sent, no restore on new client
      const gate = createDeferred();
      const origClient = { id: "orig", socket: { id: "s1" } };
      const newClient = { id: "user-new", socket: { id: "s2" } };
      const connState = vue.reactive({
        status: "connected",
        client: origClient,
      });
      const newSent = [];
      const origSent = [];
      const statusReplaced = vue.ref({});
      const { batchTopUpArena: runReplaced } = arenaMod.createTasksArena({
        selectedTokens: vue.ref(["t1"]),
        tokens: vue.ref([{ id: "t1", name: "T1" }]),
        tokenStatus: statusReplaced,
        isRunning: vue.ref(false),
        shouldStop: vue.ref(false),
        ensureConnection: async () => true,
        releaseConnectionSlot: () => {},
        connectionQueue: { active: 0 },
        batchSettings: { maxActive: 1 },
        tokenStore: {
          wsConnections: { t1: connState },
          getWebSocketStatus: () => connState.status,
          async sendGetRoleInfo() {
            return { role: { items: { 1007: { quantity: 10 } } } };
          },
          async sendMessageWithPromise(id, cmd, params) {
            if (connState.client === newClient) {
              newSent.push({ cmd, params });
              return {};
            }
            origSent.push({ cmd, params });
            if (cmd === "activity_get") {
              return { activity: { myArenaInfo: { num: 0 } } };
            }
            if (cmd === "presetteam_getinfo") {
              return { presetTeamInfo: { useTeamId: 1 } };
            }
            if (cmd === "arena_getareatarget") {
              await gate.promise;
              return { rankList: [{ roleId: "target-1" }] };
            }
            return {};
          },
        },
        currentSettings: { arenaFormation: 3 },
        delayConfig: { battle: 0 },
        calculateMonthProgress: () => 0.5,
        pickArenaTargetId: (t) => t?.rankList?.[0]?.roleId,
        addLog: () => {},
        message: createMessageMock(),
        currentRunningTokenId: vue.ref(null),
        taskNames: {},
      });
      const task = runReplaced();
      await new Promise((r) => setTimeout(r, 15));
      connState.client = newClient;
      gate.resolve();
      await task;

      assert.equal(
        origSent.some((c) => c.cmd === "fight_startareaarena"),
        false,
        "batchTopUpArena must not fight after connection replacement",
      );
      assert.equal(newSent.length, 0);
      assert.equal(statusReplaced.value.t1, "stopped");
    }
  }
});

test("Fix #4: batchCampChallengePet skips tokens interrupted by connection replacement across rounds", async () => {
  const connMod = await loadModule(
    new URL("../src/utils/batch/connectionManager.js", import.meta.url),
    { vue },
  );
  const campMod = await loadModule(
    new URL("../src/utils/batch/tasksCampChallenge.js", import.meta.url),
    {
      "./connectionManager.js": connMod,
      "../campChallenge.js": {
        CAMP_ORDINARY_LIMITS: {},
        getCampSnapshot: () => ({}),
        makeCampTeam: () => [],
        prepareCampAttack: () => ({}),
        submitCampAttack: async () => true,
      },
    },
  );

  const clientA1 = { id: "a1", socket: { id: "sa1" } };
  const clientA2 = { id: "a2", socket: { id: "sa2" } };
  const connA = vue.reactive({ status: "connected", client: clientA1 });
  const connB = vue.reactive({
    status: "connected",
    client: { id: "b1", socket: { id: "sb1" } },
  });
  const tokenStatus = vue.ref({});
  const challengeCalls = { A: 0, B: 0 };
  const gateA = createDeferred();
  const msg = createMessageMock();

  const { batchCampChallengePet } = campMod.createTasksCampChallenge({
    selectedTokens: vue.ref(["A", "B"]),
    tokens: vue.ref([
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ]),
    tokenStatus,
    isRunning: vue.ref(false),
    shouldStop: vue.ref(false),
    ensureConnection: async () => true,
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 2 },
    tokenStore: {
      wsConnections: { A: connA, B: connB },
      getWebSocketStatus: (id) => (id === "A" ? connA.status : connB.status),
      async sendMessageWithPromise(id, cmd) {
        if (cmd === "presetteam_getinfo") {
          return {
            presetTeamInfo: {
              useTeamId: 1,
              1: { teamInfo: { 0: { heroId: 101 } } },
            },
          };
        }
        if (cmd === "role_getroleinfo") {
          return {
            role: { lordWeaponId: 1 },
          };
        }
        if (cmd === "legion_getcampbattleinfo") {
          return { campBattleInfo: { petOpen: true } };
        }
        if (cmd === "club_attackmonster") {
          challengeCalls[id]++;
          if (id === "A" && challengeCalls.A === 1) {
            await gateA.promise;
          }
          return { battleData: { result: { isWin: true } } };
        }
        return {};
      },
    },
    addLog: () => {},
    message: msg,
    currentRunningTokenId: vue.ref(null),
    taskNames: {},
  });

  const run = batchCampChallengePet();
  await new Promise((r) => setTimeout(r, 15));
  connA.client = clientA2;
  gateA.resolve();
  await run;

  assert.equal(
    challengeCalls.A,
    1,
    "interrupted token A must not rerun in rounds 2 and 3",
  );
  assert.equal(challengeCalls.B, 3);
  assert.equal(tokenStatus.value.A, "stopped");
  assert.ok(msg.calls.some((c) => c.type === "warning"));
});

test("Fix #5: connectionManager neither adopts nor closes user connection when client creation fails", async () => {
  const connMod = await loadModule(
    new URL("../src/utils/batch/connectionManager.js", import.meta.url),
    { vue },
  );

  const userClient = { id: "user", socket: { id: "su" } };
  const closeCalls = [];
  const tokenStore = {
    wsConnections: { t1: { status: "disconnected", client: null } },
    getWebSocketStatus: (id) =>
      tokenStore.wsConnections[id]?.status || "disconnected",
    async createWebSocketConnection(id) {
      // Simulate user establishing their own connection while creation fails
      tokenStore.wsConnections[id] = {
        status: "connected",
        client: userClient,
      };
      return null;
    },
    closeWebSocketConnection(id) {
      closeCalls.push(id);
      tokenStore.wsConnections[id] = { status: "disconnected", client: null };
    },
  };

  let slotReleased = 0;
  let handlerRan = false;
  const queue = { active: 0 };
  const mgr = connMod.createConnectionManager({
    tokenStore,
    batchSettings: { maxActive: 1, connectTimeout: 50, reconnectDelay: 0 },
    connectionQueue: queue,
    addLog: () => {},
    shouldStop: vue.ref(false),
  });
  await assert.rejects(
    () =>
      connMod.withManagedConnection(
        {
          tokenId: "t1",
          tokenName: "T1",
          tokenStore,
          ensureConnection: (...args) =>
            mgr.ensureConnection(
              args[0],
              [{ id: "t1", token: "tok", wsUrl: "ws://localhost" }],
              args[1],
              args[2],
              args[3],
              args[4],
              args[5],
            ),
          releaseConnectionSlot: () => {
            slotReleased++;
          },
          connectionQueue: queue,
          batchSettings: { maxActive: 1 },
          shouldStop: vue.ref(false),
          addLog: () => {},
        },
        async () => {
          handlerRan = true;
        },
      ),
    /连接已被替换|批量任务已停止|任务已停止或连接已断开/,
  );

  assert.equal(handlerRan, false);
  assert.equal(closeCalls.length, 0, "must never close user connection");
  assert.equal(queue.active, 0);
  assert.equal(slotReleased, 0);

  // Also test createConnectionManager.ensureConnection directly
  const directQueue = { active: 0 };
  const closedDirect = [];
  const tokenStoreDirect = {
    wsConnections: { t1: { status: "disconnected", client: null } },
    getWebSocketStatus: (id) =>
      tokenStoreDirect.wsConnections[id]?.status || "disconnected",
    async createWebSocketConnection(id) {
      tokenStoreDirect.wsConnections[id] = {
        status: "connected",
        client: userClient,
      };
      return null;
    },
    closeWebSocketConnection(id) {
      closedDirect.push(id);
    },
  };
  const mgrDirect = connMod.createConnectionManager({
    tokenStore: tokenStoreDirect,
    batchSettings: { maxActive: 1, connectTimeout: 50, reconnectDelay: 0 },
    connectionQueue: directQueue,
    addLog: () => {},
    shouldStop: vue.ref(false),
  });
  let owned = false;
  await assert.rejects(
    () =>
      mgrDirect.ensureConnection(
        "t1",
        [{ id: "t1", token: "tok", wsUrl: "ws://localhost" }],
        1,
        (v) => {
          owned = v;
        },
        () => {},
      ),
    /连接已被替换/,
  );
  assert.equal(owned, false);
  assert.equal(directQueue.active, 0);
  assert.equal(closedDirect.length, 0);
});

test("Fix #7: WeirdTowerStatus runs follow-up items and merge after timeout or manual stop", async () => {
  const timeouts = [];
  const makeTestEnv = async () => {
    timeouts.length = 0;
    const cmds = [];
    const fightGate = createDeferred();
    const tokenStore = vue.reactive({
      selectedToken: { id: "A", name: "A" },
      wsConnections: { A: { status: "connected", client: { id: "cA" } } },
      gameData: {
        evoTowerInfo: {
          evoTower: { towerId: 240, rewardTowerId: 24, energy: 3, id: 10 },
        },
        roleInfo: {
          role: {
            items: { 1011: { quantity: 1 } },
          },
        },
      },
      getWebSocketStatus: () => "connected",
      getWebSocketClient: () => tokenStore.wsConnections.A.client,
      async sendMessageWithPromise(_id, cmd, params) {
        cmds.push({ cmd, params });
        if (cmd === "evotower_getinfo") {
          return {
            evoTower: { towerId: 240, rewardTowerId: 24, energy: 3, id: 10 },
          };
        }
        if (cmd === "mergebox_getinfo") {
          return { mergeBox: { boxNum: 0 } };
        }
        if (cmd === "evotower_readyfight") {
          await fightGate.promise;
          return { evoTower: { id: 10, energy: 2 } };
        }
        return {};
      },
    });
    const fakeSetTimeout = (fn, delay, ...args) => {
      if (delay >= 60000) {
        const handle = { fn };
        timeouts.push(handle);
        return handle;
      }
      return setTimeout(fn, 0, ...args);
    };
    const fakeClearTimeout = (handle) => {
      if (handle && typeof handle === "object" && "fn" in handle) return;
      clearTimeout(handle);
    };
    const { bindings, cleanup } = await loadSfcSetup(
      new URL("../src/components/Tower/WeirdTowerStatus.vue", import.meta.url),
      {
        "naive-ui": { useMessage: () => createMessageMock() },
        "@/stores/tokenStore": { useTokenStore: () => tokenStore },
        "@/utils/gameValue.js": { isSameGameValue: (a, b) => a === b },
        "@/utils/towerClimbLimit.js": {
          DEFAULT_WEIRD_TOWER_MAX_CLIMB: 100,
          normalizeWeirdTowerMaxClimb: () => 5,
        },
        "@/utils/towerEnergyPurchase": {
          createTowerPurchaseSession: () => ({}),
          purchaseTowerEnergy: async () => {},
        },
      },
      {
        setTimeout: fakeSetTimeout,
        clearTimeout: fakeClearTimeout,
      },
    );
    return { bindings, cmds, fightGate, cleanup };
  };

  // Timeout path -> executes follow-ups
  {
    const { bindings, cmds, fightGate, cleanup } = await makeTestEnv();
    try {
      const run = bindings.startTowerClimb();
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(timeouts.length, 1);
      timeouts[0].fn();
      fightGate.resolve();
      await run;
      assert.ok(
        cmds.some((c) => c.cmd === "mergebox_getinfo"),
        "timeout stop should proceed to follow-up item check and merge",
      );
    } finally {
      cleanup();
    }
  }

  // Manual stop stops fighting but still handles items and merging.
  {
    const { bindings, cmds, fightGate, cleanup } = await makeTestEnv();
    try {
      const run = bindings.startTowerClimb();
      await new Promise((r) => setTimeout(r, 15));
      bindings.stopClimbing();
      fightGate.resolve();
      await run;
      assert.equal(
        cmds.some((c) => c.cmd === "evotower_fight"),
        false,
      );
      assert.ok(
        cmds.filter((c) => c.cmd === "mergebox_getinfo").length >= 3,
        `manual stop must check free items, use items, and merge: ${JSON.stringify(cmds)}`,
      );
    } finally {
      cleanup();
    }
  }
});

test("Fix #8: batchGenieSweep sweeps all 45 tickets in 20+20+5 batches when response omits ticket quantity", async () => {
  const connMod = await loadModule(
    new URL("../src/utils/batch/connectionManager.js", import.meta.url),
    { vue },
  );
  const itemMod = await loadModule(
    new URL("../src/utils/batch/tasksItem.js", import.meta.url),
    {
      "./connectionManager.js": connMod,
      "@/utils/HeroList": { HERO_DICT: {} },
      "@/utils/PeachTaskIds": { PEACH_TASKS: {} },
    },
  );

  const sweepCounts = [];
  const logs = [];
  const tokenStatus = vue.ref({});
  const client = { id: "c1", socket: { id: "s1" } };
  const { batchGenieSweep } = itemMod.createTasksItem({
    selectedTokens: vue.ref(["t1"]),
    tokens: vue.ref([{ id: "t1", name: "T1" }]),
    tokenStatus,
    isRunning: vue.ref(false),
    shouldStop: vue.ref(false),
    ensureConnection: async () => true,
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1 },
    tokenStore: {
      wsConnections: { t1: { status: "connected", client } },
      getWebSocketStatus: () => "connected",
      async sendGetRoleInfo() {
        return {
          role: {
            items: { 1021: { quantity: 45 } },
          },
        };
      },
      async sendMessageWithPromise(_id, cmd, params) {
        if (cmd === "role_getroleinfo") {
          return {
            role: {
              items: { 1021: { quantity: 45 } },
              genie: { 1: 10 },
            },
          };
        }
        if (cmd === "genie_getinfo") {
          return { genieList: [{ id: 1, level: 10 }] };
        }
        if (cmd === "genie_sweep") {
          sweepCounts.push(params.sweepCnt);
          return { code: 0 };
        }
        return {};
      },
    },
    tokenSettings: {},
    delayConfig: { action: 0 },
    addLog: (entry) => logs.push(entry.message),
    message: createMessageMock(),
    currentRunningTokenId: vue.ref(null),
    taskNames: {},
  });

  await batchGenieSweep();
  assert.deepEqual(sweepCounts, [20, 20, 5], logs.join(" | "));
  assert.equal(tokenStatus.value.t1, "completed");
});

test("Fix #10: switching accounts clears reactive @vueuse/core chat cache so old messages never return", async () => {
  setActivePinia(createPinia());
  const { map, storage } = createMemoryStorage();
  const emitter = new EventEmitter();
  const evm = {
    $emit: emitter,
    onSome(events, listener) {
      events.forEach((evt) => emitter.on(evt, listener));
    },
    emitPlus(cmd, data) {
      return emitter.emit(cmd, data);
    },
  };

  let chatMod;
  const { bindings: chatLoaded } = await (async () => {
    chatMod = await loadModule(
      new URL("../src/stores/events/chat.ts", import.meta.url),
      {
        "@vueuse/core": {
          useLocalStorage: (key, initial, opts) =>
            vueUseCore.useStorage(key, initial, storage, opts),
        },
        "@/utils/logger": { gameLogger: noopLogger() },
      },
      { localStorage: storage },
    );
    chatMod.ChatPlugin(evm);
    return { bindings: chatMod };
  })();

  const storeMod = await loadModule(
    new URL("../src/stores/tokenStore.ts", import.meta.url),
    {
      "@vueuse/core": {
        useLocalStorage: (_k, initial) => vue.ref(initial),
      },
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
      "@/utils/connectionRecovery": connectionRecovery,
      "@/utils/logger": {
        gameLogger: noopLogger(),
        tokenLogger: noopLogger(),
        wsLogger: noopLogger(),
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
          setMessageListener() {}
          init() {}
        },
      },
      "./events/index.js": evm,
    },
    {
      window: { location: { href: "http://127.0.0.1/" } },
      localStorage: storage,
    },
  );

  storeMod.gameTokens.value = [
    { id: "A", roleId: "A" },
    { id: "B", roleId: "B" },
  ];
  storeMod.selectedTokenId.value = "A";
  const store = storeMod.useTokenStore();
  store.wsConnections = {
    A: { status: "connected" },
    B: { status: "connected" },
  };

  emitter.emit("system_newchatmessagenotify", {
    tokenId: "A",
    isSelectedAccount: true,
    body: { chatMessage: { id: "msgA" } },
  });
  assert.deepEqual(JSON.parse(map.get("xyzw_chat_msg_list")), [{ id: "msgA" }]);

  store.selectToken("B");
  assert.equal(map.has("xyzw_chat_msg_list"), false);
  assert.deepEqual([...chatLoaded.chatMsgList.value], []);

  emitter.emit("system_newchatmessagenotify", {
    tokenId: "A",
    isSelectedAccount: false,
    body: { chatMessage: { id: "backgroundA" } },
  });
  emitter.emit("system_newchatmessagenotify", {
    tokenId: "B",
    isSelectedAccount: true,
    body: { chatMessage: { id: "msgB" } },
  });
  assert.deepEqual(
    JSON.parse(map.get("xyzw_chat_msg_list")),
    [{ id: "msgB" }],
    "account A messages must never reappear when account B logs a chat message",
  );
});

test("Fix #11: StarUpgradeCard rejects { success: false } and { result: 1 } responses", async () => {
  const sent = [];
  const msg = createMessageMock();
  const tokenStore = vue.reactive({
    selectedToken: { id: "A", name: "A" },
    wsConnections: { A: { status: "connected" } },
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(_id, cmd) {
      if (cmd === "hero_heroupgradestar" || cmd === "book_upgrade") {
        sent.push(cmd);
        return sent.length === 1 ? { code: 0, success: false } : { result: 1 };
      }
      return { role: { hero: {} } };
    },
  });

  const { bindings, cleanup } = await loadSfcSetup(
    new URL("../src/components/cards/StarUpgradeCard.vue", import.meta.url),
    {
      "naive-ui": { useMessage: () => msg },
      "@/stores/tokenStore": { useTokenStore: () => tokenStore },
      "@/utils/HeroList": { HERO_DICT: { 101: { name: "Hero101" } } },
      "../Common/MyCard.vue": { default: {} },
    },
  );

  try {
    assert.equal(
      bindings.isSuccessResponse({ code: 0, success: false }),
      false,
    );
    assert.equal(bindings.isSuccessResponse({ result: 1 }), false);
    assert.equal(bindings.isSuccessResponse({ code: 1 }), false);
    assert.equal(bindings.isSuccessResponse({ code: 0 }), true);
    assert.equal(bindings.isSuccessResponse({}), true);

    await bindings.runHeroUpgrade({ delay: 0 });
    await bindings.runBookUpgrade({ delay: 0 });
    assert.deepEqual(sent, ["hero_heroupgradestar", "book_upgrade"]);
    assert.equal(
      bindings.logs.value.some((l) => l.type === "success"),
      false,
      "{ success: false } and { result: 1 } must never log success",
    );
  } finally {
    cleanup();
  }
});

test("Fix #12: BatchDailyTasks ensureConnection aborts without reconnecting when stopped during wait", async () => {
  let connectAttempts = 0;
  const connectGate = createDeferred();
  const closeCalls = [];
  const tokenStore = vue.reactive({
    gameTokens: [
      { id: "t1", name: "T1", token: "tok", wsUrl: "ws://localhost" },
    ],
    selectedTokenId: "t1",
    wsConnections: { t1: { status: "disconnected", client: null } },
    getWebSocketStatus: (id) =>
      tokenStore.wsConnections[id]?.status || "disconnected",
    async createWebSocketConnection(id) {
      connectAttempts++;
      const client = {
        id: `c${connectAttempts}`,
        socket: { id: `s${connectAttempts}` },
      };
      tokenStore.wsConnections[id] = { status: "connecting", client };
      if (connectAttempts === 1) {
        await connectGate.promise;
      }
      return client;
    },
    closeWebSocketConnection(id) {
      closeCalls.push(id);
      tokenStore.wsConnections[id] = { status: "disconnected", client: null };
    },
  });
  const factoryProxy = new Proxy(
    {},
    {
      get: () => () => ({}),
    },
  );
  const { storage } = createMemoryStorage();
  const { bindings, cleanup } = await loadSfcSetup(
    new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
    {
      "@vicons/ionicons5": { Settings: {} },
      "naive-ui": { useMessage: () => createMessageMock() },
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
      "@/stores/events/index.ts": { $emit: new EventEmitter() },
      "@/stores/tokenStore": {
        gameTokens: vue.ref([]),
        tokenGroups: vue.ref([]),
        useTokenStore: () => tokenStore,
      },
      "@/utils/batch": new Proxy(
        {
          availableTasks: [],
          bossTimesOptions: [],
          boxTypeOptions: [],
          fishTypeOptions: [],
          formationOptions: [],
          createTasksApex: () => ({}),
          createTasksArena: () => ({}),
          createTasksBottle: () => ({}),
          createTasksCampChallenge: () => ({}),
          createTasksDungeon: () => ({}),
          createTasksFootball: () => ({}),
          createTasksHangUp: () => ({}),
          createTasksItem: () => ({}),
          createTasksLegacy: () => ({}),
          createTasksStore: () => ({}),
          createTasksTower: () => ({}),
          createTasksXuanwuBlessing: () => ({}),
        },
        {
          get(target, prop) {
            if (Object.hasOwn(target, prop)) return target[prop];
            return () => ({});
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
        ...factoryProxy,
        closeOwnedConnection: (store, id) => store.closeWebSocketConnection(id),
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
      "@/utils/dailyDreamPurchase": factoryProxy,
      "@/utils/dailyTaskRunner": { DailyTaskRunner: class {} },
      "@/utils/dailyTaskSettings": {
        DAILY_TASK_DEFAULTS: {},
        readDailyTaskSettingsForExecution: () => ({}),
        resetDailyTaskSettings: () => ({}),
        SAFE_DAILY_TASK_DEFAULTS: {},
        writeDailyTaskSettings: () => {},
      },
      "@/utils/dreamConstants": {
        goldItemsConfig: [],
        isDungeonOpen: () => false,
        merchantConfig: [],
      },
      "@/utils/dreamShopCheckState": { markDreamShopChecked: () => {} },
      "@/utils/towerClimbLimit.js": { DEFAULT_WEIRD_TOWER_MAX_CLIMB: 100 },
    },
    {
      localStorage: storage,
      window: { addEventListener() {}, removeEventListener() {} },
    },
  );

  try {
    let slotOwned = false;
    const run = bindings.ensureConnection(
      "t1",
      2,
      (v) => {
        slotOwned = v;
      },
      () => {},
    );
    await new Promise((r) => setTimeout(r, 10));
    bindings.shouldStop.value = true;
    connectGate.resolve();
    await assert.rejects(
      () => run,
      (err) => Boolean(err?.interrupted),
    );
    assert.equal(
      connectAttempts,
      1,
      "must not enter reconnect branch after stop",
    );
    assert.equal(slotOwned, false);
    assert.equal(closeCalls.length, 1);

    // Also verify Fix #5 on BatchDailyTasks.ensureConnection when creation returns null and user connects concurrently
    bindings.shouldStop.value = false;
    closeCalls.length = 0;
    tokenStore.wsConnections.t1 = { status: "disconnected", client: null };
    const userClient = { id: "user-concurrent", socket: { id: "s-user" } };
    let ownedClient = "unset";
    let slotConcurrent = false;
    tokenStore.createWebSocketConnection = async (id) => {
      tokenStore.wsConnections[id] = {
        status: "connected",
        client: userClient,
      };
      return null;
    };
    await assert.rejects(
      () =>
        bindings.ensureConnection(
          "t1",
          1,
          (v) => {
            slotConcurrent = v;
          },
          (client) => {
            ownedClient = client;
          },
        ),
      /连接已被替换/,
    );
    assert.equal(ownedClient, null);
    assert.equal(slotConcurrent, false);
    assert.equal(closeCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("Fix #13: PushingLevels updates computed bossName reactively when boss_names.js resolves later", async () => {
  const bossNamesGate = createDeferred();
  const { storage } = createMemoryStorage();
  const tokenStore = vue.reactive({
    gameTokens: [{ id: "t1", name: "T1" }],
    tokens: [{ id: "t1", name: "T1" }],
    wsConnections: {},
    getWebSocketStatus: () => "disconnected",
  });

  const { bindings, cleanup } = await loadSfcSetup(
    new URL("../src/views/PushingLevels.vue", import.meta.url),
    {
      "naive-ui": { useMessage: () => createMessageMock() },
      "@/stores/tokenStore": { useTokenStore: () => tokenStore },
      "./boss_names.js": bossNamesGate.promise,
    },
    { localStorage: storage },
  );

  try {
    bindings.selectedTokenIds.value = ["t1"];
    bindings.runningStates.t1 = { tokenId: "t1", level: 100, running: true };
    assert.equal(bindings.runningCards.value[0].bossName, "");

    bossNamesGate.resolve({ BOSS_NAMES: { 100: "第一百关魔王" } });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(bindings.runningCards.value[0].bossName, "第一百关魔王");
  } finally {
    cleanup();
  }
});

test("monthly fishing stops when the same client reconnects with a new socket", async () => {
  const delayStarted = createDeferred();
  const releaseDelay = createDeferred();
  const sent = [];
  const store = vue.reactive({
    selectedToken: { id: "A" },
    wsConnections: {
      A: { status: "connected", client: { socket: { id: "old" } } },
    },
    gameData: {
      roleInfo: {
        role: {
          statisticsTime: { "artifact:normal:lottery:time": 2000000000 },
        },
      },
    },
    getWebSocketStatus(id) {
      return this.wsConnections[id].status;
    },
    async sendMessageWithPromise(_id, cmd, params) {
      sent.push({ cmd, params });
      return { activity: { myMonthInfo: { 2: { num: 0 } } } };
    },
  });
  const { bindings, cleanup } = await loadSfcSetup(
    new URL("../src/components/cards/MonthlyTasksCard.vue", import.meta.url),
    {
      "naive-ui": { useMessage: () => createMessageMock() },
      "@/stores/tokenStore": { useTokenStore: () => store },
      "../Common/MyCard.vue": { default: {} },
    },
    {
      setTimeout(fn, delay) {
        if (delay === 800) {
          delayStarted.resolve();
          releaseDelay.promise.then(fn);
          return 1;
        }
        return setTimeout(fn, 0);
      },
    },
  );
  try {
    bindings.monthActivity.value = { myMonthInfo: { 2: { num: 0 } } };
    const run = bindings.autoTopUpFish(20, 20, 320);
    await delayStarted.promise;
    store.wsConnections.A.status = "disconnected";
    store.wsConnections.A.client.socket = { id: "new" };
    store.wsConnections.A.status = "connected";
    releaseDelay.resolve();
    await run;
    assert.equal(
      sent.filter(({ cmd }) => cmd === "artifact_lottery").length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("monthly top-ups stop when progress or a battle result cannot be confirmed", async () => {
  for (const scenario of [
    "fish-progress",
    "fish-refresh",
    "arena-timeout",
    "arena-target",
  ]) {
    const sent = [];
    const store = vue.reactive({
      selectedToken: { id: "A" },
      wsConnections: { A: { status: "connected", client: { socket: {} } } },
      gameData: { roleInfo: { role: { statisticsTime: {} } } },
      getWebSocketStatus: () => "connected",
      async sendMessageWithPromise(_id, cmd, params) {
        sent.push({ cmd, params });
        if (cmd === "activity_get") {
          if (scenario === "fish-refresh") throw new Error("timeout");
          return {
            activity: {
              myArenaInfo: { num: 0 },
              myMonthInfo: { 2: { num: 0 } },
            },
          };
        }
        if (cmd === "arena_getareatarget") {
          if (sent.filter((entry) => entry.cmd === cmd).length > 1)
            store.selectedToken = { id: "B" };
          return scenario === "arena-target"
            ? {}
            : { roleList: [{ roleId: 1 }] };
        }
        if (cmd === "fight_startareaarena") throw new Error("timeout");
        return {};
      },
    });
    const env = await loadSfcSetup(
      new URL("../src/components/cards/MonthlyTasksCard.vue", import.meta.url),
      {
        "naive-ui": { useMessage: () => createMessageMock() },
        "@/stores/tokenStore": { useTokenStore: () => store },
        "../Common/MyCard.vue": { default: {} },
      },
      {
        Date: createFixedDate(),
        setTimeout: (fn) => {
          fn();
          return 1;
        },
      },
    );
    try {
      if (scenario.startsWith("fish")) {
        env.bindings.monthActivity.value =
          scenario === "fish-progress"
            ? {}
            : { myMonthInfo: { 2: { num: 0 } } };
        await env.bindings.autoTopUpFish(10, 10, 320);
        assert.equal(
          sent.some(
            ({ cmd, params }) => cmd === "artifact_lottery" && !params.newFree,
          ),
          false,
          scenario,
        );
      } else {
        env.bindings.monthActivity.value = { myArenaInfo: { num: 0 } };
        await env.bindings.autoTopUpArena(10, 10, 240);
        assert.equal(
          sent.filter(({ cmd }) => cmd === "fight_startareaarena").length,
          scenario === "arena-timeout" ? 1 : 0,
          scenario,
        );
        assert.equal(
          sent.filter(({ cmd }) => cmd === "arena_getareatarget").length,
          1,
          scenario,
        );
      }
    } finally {
      env.cleanup();
    }
  }
});

test("an older monthly response cannot replace newer progress or clear its loading state", async () => {
  const first = createDeferred();
  const second = createDeferred();
  let calls = 0;
  let ready = false;
  const store = vue.reactive({
    selectedToken: { id: "A" },
    wsConnections: { A: { status: "connected", client: { socket: {} } } },
    getWebSocketStatus: () => (ready ? "connected" : "disconnected"),
    sendMessageWithPromise: () =>
      ++calls === 1 ? first.promise : second.promise,
  });
  const env = await loadSfcSetup(
    new URL("../src/components/cards/MonthlyTasksCard.vue", import.meta.url),
    {
      "naive-ui": { useMessage: () => createMessageMock() },
      "@/stores/tokenStore": { useTokenStore: () => store },
      "../Common/MyCard.vue": { default: {} },
    },
  );
  try {
    ready = true;
    const older = env.bindings.fetchMonthlyActivity("A");
    const newer = env.bindings.fetchMonthlyActivity("A");
    first.resolve({ activity: { myMonthInfo: { 2: { num: 1 } } } });
    assert.equal(await older, false);
    assert.equal(env.bindings.monthLoading.value, true);
    second.resolve({ activity: { myMonthInfo: { 2: { num: 10 } } } });
    assert.equal(await newer, true);
    assert.equal(env.bindings.monthActivity.value.myMonthInfo[2].num, 10);
    assert.equal(env.bindings.monthLoading.value, false);
  } finally {
    env.cleanup();
  }
});

test("a queued owned close cannot disconnect a newly created connection", async () => {
  setActivePinia(createPinia());
  const { storage } = createMemoryStorage();
  const closed = [];
  const logger = noopLogger();
  class FakeClient {
    constructor() {
      this.socket = { readyState: 3 };
    }
    setMessageListener() {}
    init() {}
    disconnect() {
      closed.push("new");
    }
  }
  const mod = await loadModule(
    new URL("../src/stores/tokenStore.ts", import.meta.url),
    {
      "@vueuse/core": { useLocalStorage: (_key, initial) => vue.ref(initial) },
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
      "@/utils/connectionRecovery": connectionRecovery,
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
      "@/utils/xyzwWebSocket": { XyzwWebSocketClient: FakeClient },
      "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
    },
    {
      window: { location: { href: "http://127.0.0.1/" } },
      localStorage: storage,
      WebSocket: { CLOSED: 3 },
    },
  );
  mod.gameTokens.value = [{ id: "A", token: "test-only-token-value" }];
  mod.selectedTokenId.value = "A";
  const store = mod.useTokenStore();
  const oldClient = {
    socket: { readyState: 3 },
    disconnect() {
      closed.push("old");
    },
  };
  store.wsConnections = { A: { status: "connected", client: oldClient } };
  store.closeWebSocketConnection("A");
  store.closeWebSocketConnectionIfCurrent("A", oldClient, oldClient.socket);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const newClient = await store.createWebSocketConnection(
    "A",
    "test-only-token-value",
  );
  assert.ok(newClient);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(closed, ["old"]);
  assert.equal(vue.toRaw(store.wsConnections.A.client), newClient);
  store.$dispose();
});
