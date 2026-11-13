import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  claimScheduledOccurrence,
  createScheduledTaskClock,
} from "../src/utils/batch/scheduledClock.js";

const sourceText = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const scheduleModalsText = await readFile(
  new URL(
    "../src/components/BatchDaily/BatchScheduleModals.vue",
    import.meta.url,
  ),
  "utf8",
);
const script = sourceText.match(/<script setup>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "batch.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "startScheduler",
    ),
);
assert.ok(declaration);

test("批量页轮询漏过分钟后通过锁与持久去重排队，运行账号保留快照", async () => {
  const when = (minute, second = 0) =>
    new Date(2026, 10, 12, 9, minute, second).getTime();
  let current = when(59, 50);
  const task = {
    id: "a",
    name: "早晨",
    enabled: true,
    runType: "daily",
    runTime: "10:00",
    selectedTokens: ["one"],
    selectedTasks: ["task"],
  };
  const data = new Map([["scheduledTasks", JSON.stringify([task])]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  let tick;
  const queued = [];
  const messages = [];
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [current]));
    }
    static now() {
      return current;
    }
  }
  const context = {
    Date: FakeDate,
    intervalId: { value: null },
    scheduledTasks: { value: [task] },
    scheduledClock: createScheduledTaskClock({
      tasks: [task],
      now: current,
      matchesCron: () => false,
    }),
    schedulerPageActive: true,
    noSchedulerLockWarning: false,
    pendingScheduledTasks: new Set(),
    requireCurrentScheduledConfig: () => true,
    navigator: {
      locks: { request: (name, callback) => callback({ name }) },
    },
    localStorage: storage,
    claimScheduledOccurrence: (args) =>
      claimScheduledOccurrence({ ...args, now: () => current }),
    enqueueScheduledTask: (snapshot) => {
      queued.push(snapshot);
      return Promise.resolve();
    },
    addLog: (entry) => messages.push(entry),
    message: { warning: (entry) => messages.push(entry) },
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.start = startScheduler;`,
    context,
  );
  context.start();
  current = new Date(2026, 10, 12, 10, 3).getTime();
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].selectedTokens, ["one"]);
  assert.equal(storage.getItem("lastTaskExecution_a"), "a_2026_11_12_10_0");
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queued.length, 1);
});

test("其他标签修改定时任务时暂停旧调度并保留未保存表单", () => {
  const names = new Set([
    "pauseStaleScheduler",
    "requireCurrentScheduledConfig",
    "handleScheduledStorageChange",
  ]);
  const declarations = source.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) =>
          names.has(item.name.getText(source)),
        ),
    )
    .map((node) => node.getText(source))
    .join("\n");
  const storage = { getItem: () => "[]" };
  const stale = { value: false };
  const form = { name: "尚未保存" };
  let cancelled = 0;
  const messages = [];
  const context = {
    localStorage: storage,
    scheduledTasks: { value: [] },
    scheduledTasksStale: stale,
    scheduledQueue: { cancelPending: () => cancelled++ },
    activeScheduledRun: { value: { scheduledTime: 123 } },
    shouldStop: { value: false },
    message: { warning: (value) => messages.push(value) },
    addLog: () => {},
    Date,
  };
  vm.createContext(context);
  vm.runInContext(
    `${declarations}\nglobalThis.api = { handleScheduledStorageChange, requireCurrentScheduledConfig };`,
    context,
  );
  context.api.handleScheduledStorageChange({
    storageArea: storage,
    key: "scheduledTasks",
  });
  assert.equal(stale.value, true);
  assert.equal(cancelled, 1);
  assert.equal(context.shouldStop.value, true);
  assert.equal(context.api.requireCurrentScheduledConfig(), false);
  assert.equal(form.name, "尚未保存");
  assert.equal(messages.length, 1);
});

test("频繁 Cron 等待跨标签锁期间不会堆积多次调度请求", async () => {
  let current = new Date(2026, 10, 12, 9, 59, 50).getTime();
  const task = {
    id: "cron",
    name: "cron",
    enabled: true,
    runType: "cron",
    cronExpression: "* * * * *",
    selectedTokens: ["one"],
    selectedTasks: ["task"],
  };
  const data = new Map([["scheduledTasks", JSON.stringify([task])]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  let tick;
  let release;
  let lockRequests = 0;
  let executions = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [current]));
    }
    static now() {
      return current;
    }
  }
  const context = {
    Date: FakeDate,
    intervalId: { value: null },
    scheduledTasks: { value: [task] },
    scheduledClock: createScheduledTaskClock({
      tasks: [task],
      now: current,
      matchesCron: () => true,
    }),
    schedulerPageActive: true,
    noSchedulerLockWarning: false,
    pendingScheduledTasks: new Set(),
    requireCurrentScheduledConfig: () => true,
    navigator: {
      locks: {
        request: (name, callback) => {
          lockRequests++;
          return new Promise((resolve) => {
            release = () => resolve(callback({ name }));
          });
        },
      },
    },
    localStorage: storage,
    claimScheduledOccurrence: (args) =>
      claimScheduledOccurrence({ ...args, now: () => current }),
    enqueueScheduledTask: () => {
      executions++;
      return Promise.resolve();
    },
    addLog: () => {},
    message: { warning: () => {} },
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.start = startScheduler;`,
    context,
  );
  context.start();
  current = new Date(2026, 10, 12, 10, 0).getTime();
  tick();
  current = new Date(2026, 10, 12, 10, 1).getTime();
  tick();
  assert.equal(lockRequests, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executions, 1);
});

test("切换定时任务时先核对已保存配置，再更新开关", () => {
  const opening = scheduleModalsText.match(
    /<n-switch\s[^>]*@update:value="\(val\) => emit\('toggleTaskEnabled', task\.id, val\)"[^>]*>/,
  )?.[0];
  assert.ok(opening);
  assert.doesNotMatch(opening, /v-model:value/);
  assert.match(sourceText, /@toggle-task-enabled="toggleTaskEnabled"/);
  const toggle = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (item) => item.name.getText(source) === "toggleTaskEnabled",
      ),
  );
  assert.ok(toggle);
  const tasks = [{ id: "a", name: "A", enabled: false }];
  let saved = JSON.stringify(tasks);
  const context = {
    scheduledTasks: { value: tasks },
    requireCurrentScheduledConfig: () => saved === JSON.stringify(tasks),
    saveScheduledTasks: () => {
      saved = JSON.stringify(tasks);
    },
    message: { success() {} },
    addLog() {},
    Date,
  };
  vm.createContext(context);
  vm.runInContext(
    `${toggle.getText(source)}\nglobalThis.toggle = toggleTaskEnabled;`,
    context,
  );
  context.toggle("a", true);
  assert.equal(JSON.parse(saved)[0].enabled, true);
});
