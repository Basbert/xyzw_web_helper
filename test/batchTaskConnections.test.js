import assert from "node:assert/strict";
import { test } from "node:test";
import * as blackMarketConfig from "../src/utils/batch/blackMarketConfig.js";
import * as connectionManager from "../src/utils/batch/connectionManager.js";
import * as dailyState from "../src/utils/dailyTaskState.js";
import { loadModule } from "./helpers/loadModule.js";

const immediateSetTimeout = (callback) => {
  callback();
  return 1;
};

const { createTasksStore } = await loadModule(
  new URL("../src/utils/batch/tasksStore.js", import.meta.url),
  {
    "./blackMarketConfig": blackMarketConfig,
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

const { createTasksTower } = await loadModule(
  new URL("../src/utils/batch/tasksTower.js", import.meta.url),
  {
    "@/utils/gameValue.js": { isSameGameValue: (a, b) => a === b },
    "../towerActId.js": { getTowerActId: () => 1 },
    "../towerClimbLimit.js": { normalizeWeirdTowerMaxClimb: (value) => value },
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

const { createTasksItem } = await loadModule(
  new URL("../src/utils/batch/tasksItem.js", import.meta.url),
  {
    "@/utils/HeroList": { HERO_DICT: {} },
    "@/utils/PeachTaskIds": { PEACH_TASKS: [] },
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

const { createTasksHangUp } = await loadModule(
  new URL("../src/utils/batch/tasksHangUp.js", import.meta.url),
  {
    "@/utils/dailyTaskState": dailyState,
    "@/utils/studyQuestionsFromJSON.js": { preloadQuestions: async () => {} },
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

const { createTasksXuanwuBlessing } = await loadModule(
  new URL("../src/utils/batch/tasksXuanwuBlessing.js", import.meta.url),
  {
    "@/utils/towerActId": { getXuanwuActBase: () => "260206" },
    "./connectionManager.js": connectionManager,
  },
  { setTimeout: immediateSetTimeout },
);

function createFixture(overrides = {}) {
  const closed = [];
  const logs = [];
  const calls = [];
  let releases = 0;
  const statuses = { value: {} };
  const accountData = {
    alpha: { value: { studyStatus: {} } },
    beta: { value: { studyStatus: {} } },
  };
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
    gameData: { studyStatus: { isRunning: false, isCompleted: false } },
    getWebSocketStatus: () => "connected",
    getAccountGameData: (id) => accountData[id],
    async sendMessage(id, cmd, params) {
      calls.push({ id, cmd, params });
      return {};
    },
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ id, cmd, params });
      if (overrides.onSend) {
        return overrides.onSend(id, cmd, params);
      }
      return {};
    },
    closeWebSocketConnection(id) {
      closed.push(id);
    },
  };

  const deps = {
    selectedTokens: { value: overrides.selected || ["alpha", "beta"] },
    tokens: { value: tokens },
    tokenStatus: statuses,
    isRunning: { value: false },
    shouldStop: { value: false },
    // alpha owns a newly created slot; beta reuses an existing user connection
    ensureConnection: async (
      id,
      _retries,
      onSlotChange,
      onClientCreated,
      onConnectionReady,
    ) => {
      onSlotChange?.(id === "alpha");
      if (id === "alpha") onClientCreated?.(clients[id], clients[id].socket);
      onConnectionReady?.();
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
      purchaseItems: [{ itemId: 1001, discount: 8 }],
      blackMarketEnabled: true,
    },
    helperSettings: { boxType: 2001, count: 1 },
    tokenStore,
    addLog(entry) {
      logs.push(entry);
    },
    message: { success() {}, warning() {}, error() {} },
    currentRunningTokenId: { value: null },
    delayConfig: { battle: 0, action: 0 },
    loadSettings: () => ({}),
    currentSettings: {},
  };

  return {
    deps,
    statuses,
    logs,
    calls,
    closed,
    accountData,
    getReleases: () => releases,
  };
}

test("tasksStore legion limit errors mark completed and reuse existing connections", async () => {
  const { deps, statuses, logs, closed, getReleases } = createFixture({
    onSend: async (id, cmd) => {
      if (cmd === "legion_storebuygoods") {
        if (id === "alpha") {
          throw new Error("俱乐部商品购买数量超出上限");
        }
        throw new Error("物品不存在");
      }
      return {};
    },
  });

  const storeTasks = createTasksStore(deps);
  await storeTasks.legion_storebuygoods();

  assert.equal(statuses.value.alpha, "completed");
  assert.equal(statuses.value.beta, "failed");
  assert.ok(
    logs.some((entry) => entry.message.includes("本周已购买过四圣碎片")),
  );
  assert.deepEqual(closed, ["alpha"]);
  assert.equal(getReleases(), 1);

  const skinFixture = createFixture({
    onSend: async () => {
      throw new Error("俱乐部商品购买数量超出上限");
    },
  });
  await createTasksStore(skinFixture.deps).legionStoreBuySkinCoins();
  assert.equal(skinFixture.statuses.value.alpha, "completed");
  assert.equal(skinFixture.statuses.value.beta, "completed");
  assert.ok(
    skinFixture.logs.some((entry) =>
      entry.message.includes("本周已购买过皮肤币"),
    ),
  );
  assert.deepEqual(skinFixture.closed, ["alpha"]);
  assert.equal(skinFixture.getReleases(), 1);
});

test("tasksTower batchClaimFreeEnergy handles missing mergeBox without crashing and guards missing tokens", async () => {
  const { deps, statuses, closed, getReleases } = createFixture({
    selected: ["alpha", "beta", "missing"],
    onSend: async (id, cmd) => {
      if (cmd === "mergebox_getinfo") {
        return id === "alpha" ? { mergeBox: null } : {};
      }
      return {};
    },
  });

  await createTasksTower(deps).batchClaimFreeEnergy();

  assert.equal(statuses.value.alpha, "completed");
  assert.equal(statuses.value.beta, "completed");
  assert.equal(statuses.value.missing, "failed");
  assert.deepEqual(closed, ["alpha"]);
  assert.equal(getReleases(), 1);
});

test("tasksItem keeps pre-existing connections and marks interrupted runs stopped", async () => {
  const { deps, statuses, closed, getReleases } = createFixture({
    selected: ["alpha", "beta", "missing"],
  });
  await createTasksItem(deps).batchOpenBox();

  assert.equal(statuses.value.alpha, "completed");
  assert.equal(statuses.value.beta, "completed");
  assert.equal(statuses.value.missing, "failed");
  assert.deepEqual(closed, ["alpha"]);
  assert.equal(getReleases(), 1);

  const interrupted = createFixture({
    selected: ["beta"],
    onSend: async (_id, cmd) => {
      if (cmd === "item_openbox") {
        interrupted.deps.shouldStop.value = true;
      }
      return {};
    },
  });
  await createTasksItem(interrupted.deps).batchOpenBox();
  assert.equal(interrupted.statuses.value.beta, "stopped");
  assert.deepEqual(interrupted.closed, []);
  assert.equal(interrupted.getReleases(), 0);
});

test("tasksHangUp batchStudy isolates per-account studyStatus and preserves existing connections", async () => {
  const fixture = createFixture({
    onSend: async (id, cmd) => {
      if (cmd === "study_startgame") {
        fixture.accountData[id].value.studyStatus = {
          isAnswering: false,
          questionCount: 10,
          answeredCount: id === "alpha" ? 10 : 8,
          status: "completed",
          timestamp: Date.now(),
        };
      }
      return {};
    },
  });

  await createTasksHangUp(fixture.deps).batchStudy();

  assert.equal(fixture.statuses.value.alpha, "completed");
  assert.equal(fixture.statuses.value.beta, "completed");
  assert.equal(fixture.accountData.alpha.value.studyStatus.answeredCount, 10);
  assert.equal(fixture.accountData.beta.value.studyStatus.answeredCount, 8);
  assert.equal(
    fixture.deps.tokenStore.gameData.studyStatus.answeredCount,
    undefined,
  );
  assert.deepEqual(fixture.closed, ["alpha"]);
  assert.equal(fixture.getReleases(), 1);
});

test("tasksXuanwuBlessing guards missing tokens and keeps pre-existing connections", async () => {
  const { deps, statuses, closed, getReleases } = createFixture({
    selected: ["alpha", "beta", "missing"],
    onSend: async (_id, cmd, params) => {
      if (cmd === "activity_warorderget") {
        return {
          activity: {
            warOrderActivityInfo: {
              [params.actId]: { complete: {}, taskClaimed: {} },
            },
          },
        };
      }
      return {};
    },
  });

  await createTasksXuanwuBlessing(deps).batchXuanwuBlessing();

  assert.equal(statuses.value.alpha, "completed");
  assert.equal(statuses.value.beta, "completed");
  assert.equal(statuses.value.missing, "failed");
  assert.deepEqual(closed, ["alpha"]);
  assert.equal(getReleases(), 1);
});
