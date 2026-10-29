import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  createScheduledRunQueue,
  summarizeScheduledRun,
} from "../src/utils/batch/scheduledRuns.js";

const component = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "BatchDailyTasks.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set([
  "verifyTaskDependencies",
  "executeScheduledTask",
  "snapshotScheduledValue",
  "scheduledQueue",
  "enqueueScheduledTask",
  "readScheduledSettings",
  "createTaskDeps",
]);
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source)),
      ),
  )
  .map((statement) => statement.getText(source))
  .join("\n");

function fixture() {
  const logs = [];
  const calls = [];
  const handlers = {};
  const saved = new Map();
  const selectedTokens = { value: ["manual"] };
  const activeScheduledRun = { value: null };
  const context = {
    createScheduledRunQueue,
    summarizeScheduledRun,
    selectedTokens,
    activeScheduledRun,
    scheduledQueueSize: { value: 0 },
    isRunning: { value: false },
    shouldStop: { value: false },
    isQueryingRecipient: { value: false },
    warGuessLoading: { value: false },
    applyLegionLoading: { value: false },
    tokenStatus: { value: {} },
    tokens: {
      value: [
        { id: "A", name: "A" },
        { id: "B", name: "B" },
      ],
    },
    tokenStore: {
      gameTokens: [
        { id: "A", name: "A" },
        { id: "B", name: "B" },
      ],
    },
    localStorage: {
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    addLog: (entry) => logs.push(entry),
    getScheduledTask: (name) => handlers[name],
    availableTasks: [],
    isbaokuActivityOpen: { value: true },
    ismengjingActivityOpen: { value: true },
    isarenaActivityOpen: { value: true },
    isWeirdTowerActivityOpen: { value: true },
    batchSettings: { commandDelay: 1, maxActive: 2 },
    currentSettings: {},
    helperSettings: {},
    weirdTowerMaxClimb: { value: 20 },
    recipientInfo: { value: null },
    giftQuantity: { value: 10 },
    loadSettings: (id) => ({ formation: id }),
    computed: (read) => ({
      get value() {
        return read();
      },
    }),
    ensureConnection() {},
    releaseConnectionSlot() {},
    connectionQueue: {},
    message: {},
    currentRunningTokenId: { value: null },
    logs: { value: [] },
    logContainer: {},
    autoScrollLog: {},
    nextTick() {},
    recipientIdInput: { value: "" },
    securityPassword: { value: "" },
    pickArenaTargetId() {},
    getTodayStartSec() {},
    isTodayAvailable() {},
    calculateMonthProgress() {},
    console,
  };
  context.executionTokens = {
    get value() {
      return activeScheduledRun.value?.accounts ?? selectedTokens.value;
    },
  };
  context.runtimeBatchSettings = new Proxy(context.batchSettings, {
    get(target, key) {
      return activeScheduledRun.value?.batchSettings?.[key] ?? target[key];
    },
  });
  vm.createContext(context);
  vm.runInContext(
    `${declarations}\nglobalThis.api = { enqueueScheduledTask, executeScheduledTask, createTaskDeps, scheduledQueue };`,
    context,
  );
  const deps = context.api.createTaskDeps();
  return { context, logs, calls, handlers, deps, ...context.api };
}

test("component queues simultaneous plans with frozen account selections and settings", async () => {
  const f = fixture();
  let release;
  let notify;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    notify = resolve;
  });
  f.handlers.first = async () => {
    const ids = [...f.deps.selectedTokens.value];
    f.calls.push([
      "first",
      ids,
      f.deps.batchSettings.commandDelay,
      f.deps.loadSettings(ids[0]).formation,
    ]);
    if (ids[0] === "A") {
      notify();
      await gate;
    }
    ids.forEach((id) => {
      f.context.tokenStatus.value[id] = "completed";
    });
  };
  f.handlers.second = async () => {
    const ids = [...f.deps.selectedTokens.value];
    f.calls.push([
      "second",
      ids,
      f.deps.batchSettings.commandDelay,
      f.deps.loadSettings(ids[0]).formation,
    ]);
    ids.forEach((id) => {
      f.context.tokenStatus.value[id] = "completed";
    });
  };
  const a = f.enqueueScheduledTask({
    name: "A",
    selectedTokens: ["A"],
    selectedTasks: ["first", "second"],
  });
  await started;
  const bTask = {
    name: "B",
    selectedTokens: ["B"],
    selectedTasks: ["first", "second"],
  };
  const b = f.enqueueScheduledTask(bTask);
  bTask.selectedTokens[0] = "A";
  f.context.selectedTokens.value = ["B"];
  f.context.batchSettings.commandDelay = 99;
  release();
  const results = await Promise.all([a, b]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["completed", "completed"],
  );
  assert.deepEqual(f.calls, [
    ["first", ["A"], 1, "A"],
    ["second", ["A"], 1, "A"],
    ["first", ["B"], 1, "B"],
    ["second", ["B"], 1, "B"],
  ]);
  assert.deepEqual(f.context.selectedTokens.value, ["B"]);
});

test("a stopped plan with no executed steps reports stopped, not success", async () => {
  const f = fixture();
  f.handlers.first = async () => {
    f.calls.push("first");
  };
  f.context.activeScheduledRun.value = { accounts: ["A"] };
  f.context.shouldStop.value = true;
  const result = await f.executeScheduledTask({
    name: "Stopped",
    selectedTokens: ["A"],
    selectedTasks: ["first"],
  });
  assert.equal(result.status, "stopped");
  assert.equal(f.calls.length, 0);
  assert.ok(f.logs.some((entry) => entry.message.includes("已停止")));
  assert.ok(!f.logs.some((entry) => entry.message.includes("执行流程结束")));
});

test("unknown task fails dependency checks and never runs a step", async () => {
  const f = fixture();
  const result = await f.enqueueScheduledTask({
    name: "Unknown",
    selectedTokens: ["A"],
    selectedTasks: ["missing"],
  });
  assert.equal(result.status, "failed");
  assert.equal(f.calls.length, 0);
});

test("a missing account prevents an otherwise successful plan from claiming full completion", async () => {
  const f = fixture();
  f.handlers.first = async () => {
    f.context.tokenStatus.value.A = "completed";
  };
  const result = await f.enqueueScheduledTask({
    name: "Partial",
    selectedTokens: ["A", "missing"],
    selectedTasks: ["first"],
  });
  assert.equal(result.status, "partial");
});
