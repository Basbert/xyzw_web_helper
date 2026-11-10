import assert from "node:assert/strict";
import test from "node:test";
import { reactive, toRaw } from "vue";
import { loadModule } from "./helpers/loadModule.js";

test("batch guessing keeps existing connections and reports partial accounts", async () => {
  const closed = [];
  const messages = [];
  let released = 0;
  const helper = {
    async runApexAutoGuess({ tokenId, checkInterrupted }) {
      checkInterrupted();
      return {
        outcome: tokenId === "new" ? "completed" : "partial",
        message: tokenId === "new" ? "已完成" : "仍有场次未完成",
        entries: [],
      };
    },
  };
  const { createTasksApex } = await loadModule(
    new URL("../src/utils/batch/tasksApex.js", import.meta.url),
    {
      "@/utils/apexGuessHelper.js": helper,
    },
  );
  const deps = {
    selectedTokens: { value: ["new", "existing"] },
    tokens: {
      value: [
        { id: "new", name: "新连接" },
        { id: "existing", name: "原连接" },
      ],
    },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async (id, _retries, onSlotChange) => {
      if (id === "new") onSlotChange(true);
    },
    releaseConnectionSlot() {
      released++;
    },
    connectionQueue: { active: 1 },
    batchSettings: { maxActive: 2 },
    tokenStore: {
      getWebSocketStatus: () => "connected",
      closeWebSocketConnection(id) {
        closed.push(id);
      },
    },
    addLog() {},
    message: {
      success: (text) => messages.push(text),
      warning: (text) => messages.push(text),
    },
    currentRunningTokenId: { value: null },
  };
  await createTasksApex(deps).batchApexGuess();
  assert.deepEqual(closed, ["new"]);
  assert.equal(released, 1);
  assert.equal(deps.tokenStatus.value.new, "completed");
  assert.equal(deps.tokenStatus.value.existing, "pending");
  assert.match(messages[0], /部分账号未完成/);
  assert.equal(deps.isRunning.value, false);
});

test("stopping while a new batch connection opens releases only its own slot", async () => {
  const closed = [];
  let released = 0;
  let ran = false;
  const helper = {
    async runApexAutoGuess() {
      ran = true;
    },
  };
  const { createTasksApex } = await loadModule(
    new URL("../src/utils/batch/tasksApex.js", import.meta.url),
    {
      "@/utils/apexGuessHelper.js": helper,
    },
  );
  const deps = {
    selectedTokens: { value: ["new"] },
    tokens: { value: [{ id: "new", name: "新连接" }] },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    async ensureConnection(_id, _retries, onSlotChange) {
      onSlotChange(true);
      deps.shouldStop.value = true;
    },
    releaseConnectionSlot() {
      released++;
    },
    connectionQueue: { active: 1 },
    batchSettings: { maxActive: 1 },
    tokenStore: {
      getWebSocketStatus: () => "connected",
      closeWebSocketConnection(id) {
        closed.push(id);
      },
    },
    addLog() {},
    message: { success() {}, warning() {} },
    currentRunningTokenId: { value: null },
  };
  await createTasksApex(deps).batchApexGuess();
  assert.equal(ran, false);
  assert.equal(deps.tokenStatus.value.new, "stopped");
  assert.deepEqual(closed, ["new"]);
  assert.equal(released, 1);
  assert.equal(deps.isRunning.value, false);
});

async function claimFixture({
  ids = ["new", "existing"],
  claim,
  onConnect,
} = {}) {
  const clients = Object.fromEntries(ids.map((id) => [id, { socket: {} }]));
  const closed = [];
  const logs = [];
  const messages = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: ids },
    tokens: { value: ids.map((id) => ({ id, name: id })) },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async (
      id,
      _retries,
      setOwned,
      onCreated,
      onReady,
      options,
    ) => {
      assert.equal(options.skipInitialization, true);
      if (id === "new") {
        setOwned(true);
        onCreated(clients[id]);
      }
      await onConnect?.(id, deps);
      onReady();
    },
    releaseConnectionSlot: () => {
      released++;
    },
    connectionQueue: { active: 1 },
    batchSettings: { maxActive: 2 },
    tokenStore: {
      wsConnections: Object.fromEntries(
        ids.map((id) => [id, { client: clients[id] }]),
      ),
      getWebSocketStatus: () => "connected",
      closeWebSocketConnection: (id) => closed.push(id),
    },
    addLog: (entry) => logs.push(entry),
    message: {
      success: (text) => messages.push(text),
      warning: (text) => messages.push(text),
    },
    currentRunningTokenId: { value: null },
  };
  const { createTasksApex } = await loadModule(
    new URL("../src/utils/batch/tasksApex.js", import.meta.url),
    {
      "@/utils/apexGuessHelper.js": { runApexAutoGuess() {} },
      "@/utils/apexRewardHelper.js": { runApexRewardClaims: claim },
      vue: { toRaw },
    },
  );
  return {
    deps,
    clients,
    closed,
    logs,
    messages,
    released: () => released,
    run: createTasksApex(deps).batchApexClaim,
  };
}

test("批量领取逐角色统计，仅关闭本次创建的连接", async () => {
  const calls = [];
  const f = await claimFixture({
    ids: ["new", "existing", "new"],
    claim: async ({ tokenId, checkInterrupted, onProgress }) => {
      checkInterrupted();
      calls.push(tokenId);
      onProgress("正在检查奖励");
      return tokenId === "new"
        ? {
            outcome: "completed",
            message: "已确认领取 1 项",
            entries: [{ scheduleId: 12, status: "claimed" }],
          }
        : {
            outcome: "partial",
            message: "结果未确认",
            entries: [{ scheduleId: 13, status: "unconfirmed" }],
          };
    },
  });
  await f.run();
  assert.deepEqual(calls.sort(), ["existing", "new"]);
  assert.deepEqual(f.closed, ["new"]);
  assert.equal(f.released(), 1);
  assert.equal(f.deps.tokenStatus.value.new, "completed");
  assert.equal(f.deps.tokenStatus.value.existing, "pending");
  assert.match(f.messages[0], /部分账号未完成/);
  assert.ok(f.logs.some((entry) => /结果未确认/.test(entry.message)));
  assert.equal(f.deps.isRunning.value, false);
});

test("领取中连接被替换时停止，并保留用户的新连接", async () => {
  let calls = 0;
  const f = await claimFixture({
    ids: ["new"],
    claim: async ({ checkInterrupted }) => {
      calls++;
      f.deps.tokenStore.wsConnections.new.client = { socket: {} };
      checkInterrupted();
      throw new Error("should not continue");
    },
  });
  await f.run();
  assert.equal(calls, 1);
  assert.equal(f.deps.tokenStatus.value.new, "stopped");
  assert.deepEqual(f.closed, []);
  assert.equal(f.released(), 1);
  assert.match(f.messages[0], /部分账号未完成/);
});

test("同一客户端重连了新 socket 时不关闭新连接", async () => {
  const f = await claimFixture({
    ids: ["new"],
    claim: async ({ checkInterrupted }) => {
      f.clients.new.socket = {};
      checkInterrupted();
    },
  });
  await f.run();
  assert.equal(f.deps.tokenStatus.value.new, "stopped");
  assert.deepEqual(f.closed, []);
  assert.equal(f.released(), 1);
});

test("建立连接期间停止后不发起领取，释放本次槽位", async () => {
  let calls = 0;
  const f = await claimFixture({
    ids: ["new"],
    onConnect: async (_id, deps) => {
      deps.shouldStop.value = true;
    },
    claim: async () => {
      calls++;
    },
  });
  await f.run();
  assert.equal(calls, 0);
  assert.equal(f.deps.tokenStatus.value.new, "stopped");
  assert.deepEqual(f.closed, ["new"]);
  assert.equal(f.released(), 1);
});

test("没有奖励也按已完成计数，不重复执行并正确释放状态", async () => {
  const f = await claimFixture({
    ids: ["existing"],
    claim: async ({ checkInterrupted }) => {
      checkInterrupted();
      return {
        outcome: "completed",
        successCount: 0,
        entries: [],
        message: "当前没有可领取的竞猜奖励",
      };
    },
  });
  await f.run();
  assert.equal(f.deps.tokenStatus.value.existing, "completed");
  assert.deepEqual(f.closed, []);
  assert.match(f.messages[0], /结束/);
});

test("建立连接时被用户替换，领取不开始且不关闭新连接", async () => {
  let calls = 0;
  const f = await claimFixture({
    ids: ["new"],
    onConnect: async (_id, deps) => {
      deps.tokenStore.wsConnections.new.client = { socket: {} };
    },
    claim: async () => {
      calls++;
    },
  });
  await f.run();
  assert.equal(calls, 0);
  assert.equal(f.deps.tokenStatus.value.new, "stopped");
  assert.deepEqual(f.closed, []);
  assert.equal(f.released(), 1);
});

test("Vue 代理和创建时的原始客户端视为同一个连接", async () => {
  let original;
  let calls = 0;
  const f = await claimFixture({
    ids: ["new"],
    onConnect: async (_id, deps) => {
      original = deps.tokenStore.wsConnections.new.client;
      deps.tokenStore.wsConnections.new.client = reactive(original);
    },
    claim: async ({ checkInterrupted }) => {
      checkInterrupted();
      calls++;
      return { outcome: "completed", message: "无待领取奖励", entries: [] };
    },
  });
  await f.run();
  assert.equal(calls, 1);
  assert.equal(toRaw(f.deps.tokenStore.wsConnections.new.client), original);
  assert.deepEqual(f.closed, ["new"]);
  assert.equal(f.released(), 1);
});

test("连接创建后异常退出仍按原客户端清理", async () => {
  const f = await claimFixture({
    ids: ["new"],
    onConnect: async () => {
      throw new Error("初始化失败");
    },
    claim: async () => {
      throw new Error("不应执行");
    },
  });
  await f.run();
  assert.equal(f.deps.tokenStatus.value.new, "failed");
  assert.deepEqual(f.closed, ["new"]);
  assert.equal(f.released(), 1);
});

test("建立连接过程中同一客户端的 socket 被替换时保留新 socket", async () => {
  let calls = 0;
  const f = await claimFixture({
    ids: ["new"],
    onConnect: async (_id, deps) => {
      deps.tokenStore.wsConnections.new.client.socket = {};
    },
    claim: async () => {
      calls++;
    },
  });
  await f.run();
  assert.equal(calls, 0);
  assert.equal(f.deps.tokenStatus.value.new, "stopped");
  assert.deepEqual(f.closed, []);
  assert.equal(f.released(), 1);
});
