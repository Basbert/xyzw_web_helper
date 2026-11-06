import assert from "node:assert/strict";
import test from "node:test";
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
