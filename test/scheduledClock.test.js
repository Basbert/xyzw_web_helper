import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimScheduledOccurrence,
  createScheduledTaskClock,
  runScheduledOccurrence,
  validateScheduledOccurrence,
} from "../src/utils/batch/scheduledClock.js";

const time = (hour, minute, second = 0) =>
  new Date(2026, 10, 12, hour, minute, second).getTime();
const daily = (extra = {}) => ({
  id: "a",
  name: "daily",
  enabled: true,
  runType: "daily",
  runTime: "10:00",
  selectedTokens: ["one"],
  selectedTasks: ["task"],
  ...extra,
});
const cron = (extra = {}) =>
  daily({ runType: "cron", cronExpression: "* * * * *", ...extra });
const clock = (tasks, initial) =>
  createScheduledTaskClock({ tasks, now: initial, matchesCron: () => true });

test("短暂后台节流跨过触发分钟时补跑一次，保留原计划时间", () => {
  const scheduler = clock([daily()], time(9, 59, 50));
  const result = scheduler.poll([daily()], time(10, 3));
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].time, time(10, 0));
  assert.equal(result.missed.length, 0);
  assert.equal(scheduler.poll([daily()], time(10, 3, 10)).due.length, 0);
});

test("超过半小时只提示，不自动补跑；频繁 cron 只执行最新一期", () => {
  const once = clock([daily()], time(9, 59));
  const old = once.poll([daily()], time(10, 31));
  assert.equal(old.due.length, 0);
  assert.equal(old.missed.length, 1);
  const frequent = clock([cron()], time(9, 0));
  const result = frequent.poll([cron()], time(10, 0, 20));
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].time, time(10, 0));
  assert.equal(result.missed.length, 1);
});

test("页面启动、新建、修改、启用任务不会补跑变更前的时间", () => {
  const scheduler = clock([], time(10, 5));
  assert.equal(scheduler.poll([daily()], time(10, 6)).due.length, 0);
  const changed = daily({ runTime: "10:05" });
  scheduler.observe([changed], time(10, 6, 10));
  assert.equal(scheduler.poll([changed], time(10, 7)).due.length, 0);
  scheduler.observe([daily({ enabled: false })], time(10, 7, 1));
  scheduler.observe([daily()], time(10, 7, 2));
  assert.equal(scheduler.poll([daily()], time(10, 8)).due.length, 0);
});

test("系统时间回拨后不得再次执行已经经过的周期", () => {
  const scheduler = clock([cron()], time(10, 0));
  assert.equal(scheduler.poll([cron()], time(10, 1)).due.length, 1);
  assert.equal(scheduler.poll([cron()], time(9, 59)).due.length, 0);
  assert.equal(scheduler.poll([cron()], time(10, 0)).due.length, 0);
  assert.equal(scheduler.poll([cron()], time(10, 1)).due.length, 0);
  assert.equal(scheduler.poll([cron()], time(10, 2)).due.length, 1);
});

test("待调度的任务保留当时的配置快照，不跟随之后编辑变化", () => {
  const task = daily();
  const scheduler = clock([task], time(9, 59));
  const result = scheduler.poll([task], time(10, 0));
  task.selectedTokens.push("two");
  assert.deepEqual(result.due[0].task.selectedTokens, ["one"]);
});

function sharedStorage(task) {
  const data = new Map([["scheduledTasks", JSON.stringify([task])]]);
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}

function browserLocks() {
  const tails = new Map();
  const held = new Set();
  return {
    request(name, options, callback) {
      const fn = typeof options === "function" ? options : callback;
      if (options?.ifAvailable && held.has(name))
        return Promise.resolve(fn(null));
      const previous = tails.get(name) || Promise.resolve();
      const run = previous.then(async () => {
        held.add(name);
        try {
          return await fn({ name });
        } finally {
          held.delete(name);
        }
      });
      tails.set(
        name,
        run.catch(() => {}),
      );
      return run;
    },
  };
}

test("部分步骤完成后停止时保留周期标记，另一标签不能重做", async () => {
  const task = daily();
  const storage = sharedStorage(task);
  const locks = browserLocks();
  let calls = 0;
  const args = {
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 0),
    enqueue: async () => {
      calls++;
      return { status: "stopped", steps: [{ status: "completed" }] };
    },
  };
  assert.equal((await claimScheduledOccurrence(args)).status, "queued");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await claimScheduledOccurrence(args)).status, "duplicate");
  assert.equal(calls, 1);
});

test("同一高频计划正在另一标签执行时不排队下个周期", async () => {
  const task = cron();
  const storage = sharedStorage(task);
  const locks = browserLocks();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const args = {
    locks,
    storage,
    task,
    now: () => time(10, 1),
    enqueue: async () => {
      calls++;
      await gate;
      return { status: "completed" };
    },
  };
  assert.equal(
    (await claimScheduledOccurrence({ ...args, time: time(10, 0) })).status,
    "queued",
  );
  assert.equal(
    (await claimScheduledOccurrence({ ...args, time: time(10, 1) })).status,
    "already-pending",
  );
  assert.equal(calls, 1);
  release();
});

test("取消领取锁时终止等待，不写去重标记或执行请求", async () => {
  const task = daily();
  const storage = sharedStorage(task);
  const controller = new AbortController();
  let calls = 0;
  const locks = {
    request: (_name, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      }),
  };
  const pending = claimScheduledOccurrence({
    locks,
    storage,
    task,
    signal: controller.signal,
    time: time(10, 0),
    now: () => time(10, 0),
    enqueue: () => {
      calls++;
    },
  });
  controller.abort();
  assert.equal((await pending).status, "closed");
  assert.equal(calls, 0);
  assert.equal(storage.getItem("lastTaskExecution_a"), null);
});

test("多个标签页同时调度时仅排队一次；缺失跨标签锁时不执行", async () => {
  const task = daily();
  const storage = sharedStorage(task);
  const locks = browserLocks();
  const run = [];
  const call = () =>
    claimScheduledOccurrence({
      locks,
      storage,
      task,
      time: time(10, 0),
      now: () => time(10, 0),
      enqueue: () => {
        run.push("run");
      },
    });
  const results = await Promise.all([call(), call()]);
  assert.equal(run.length, 1);
  assert.equal(results.filter((x) => x.status === "queued").length, 1);
  assert.equal(
    (
      await claimScheduledOccurrence({
        locks: null,
        storage,
        task,
        time: time(10, 1),
        enqueue: () => run.push("bad"),
      })
    ).status,
    "unsupported",
  );
  assert.equal(run.length, 1);
});

test("任务已在另一标签页修改或关闭时不执行旧快照", async () => {
  const task = daily();
  const locks = {
    request: (name, options, callback) => (callback || options)({ name }),
  };
  const storage = sharedStorage(daily({ enabled: false }));
  let called = false;
  const result = await claimScheduledOccurrence({
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 0),
    enqueue: () => {
      called = true;
    },
  });
  assert.equal(result.status, "stale");
  assert.equal(called, false);
});

test("旧时间戳和损坏的去重记录均不能触发重复执行", async () => {
  const task = daily();
  const locks = {
    request: (name, options, callback) => (callback || options)({ name }),
  };
  const storage = sharedStorage(task);
  storage.setItem("lastTaskExecution_a", "a_2026_11_12_10_1");
  let calls = 0;
  const args = {
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 1),
    enqueue: () => {
      calls++;
    },
  };
  assert.equal((await claimScheduledOccurrence(args)).status, "duplicate");
  storage.setItem("lastTaskExecution_a", "broken");
  assert.equal((await claimScheduledOccurrence(args)).status, "unknown-marker");
  assert.equal(calls, 0);
});

test("第一标签旧配置持锁时，新标签等待锁后可正常入队", async () => {
  const oldTask = daily({ name: "old" });
  const task = daily({ name: "current" });
  const storage = sharedStorage(task);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const underlying = browserLocks();
  const locks = {
    request(name, options, callback) {
      const fn = typeof options === "function" ? options : callback;
      if (name.startsWith("xyzw-scheduled-task:"))
        return underlying.request(name, async (lock) => {
          await gate;
          return fn(lock);
        });
      return underlying.request(name, options, callback);
    },
  };
  let calls = 0;
  const args = {
    locks,
    storage,
    time: time(10, 0),
    now: () => time(10, 0),
    enqueue: () => {
      calls++;
    },
  };
  const first = claimScheduledOccurrence({ ...args, task: oldTask });
  const second = claimScheduledOccurrence({ ...args, task });
  release();
  assert.equal((await first).status, "stale");
  assert.equal((await second).status, "queued");
  assert.equal(calls, 1);
});

test("队列执行前再次核查时限和保存的配置，过期或关闭时不允许消费", () => {
  const task = daily();
  const storage = sharedStorage(task);
  const args = { storage, task, time: time(10, 0) };
  assert.equal(
    validateScheduledOccurrence({ ...args, now: time(10, 2) }).status,
    "valid",
  );
  assert.equal(
    validateScheduledOccurrence({ ...args, now: time(10, 31) }).status,
    "expired",
  );
  storage.setItem(
    "scheduledTasks",
    JSON.stringify([daily({ enabled: false })]),
  );
  assert.equal(
    validateScheduledOccurrence({ ...args, now: time(10, 2) }).status,
    "stale",
  );
});

test("同一任务仍在队列中时不叠加新一期，也不写入跳过周期的标记", async () => {
  const task = cron();
  const storage = sharedStorage(task);
  const locks = {
    request: (name, options, callback) => (callback || options)({ name }),
  };
  const result = await claimScheduledOccurrence({
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 0),
    canEnqueue: () => false,
    enqueue: () => assert.fail("不应加入队列"),
  });
  assert.equal(result.status, "already-pending");
  assert.equal(storage.getItem("lastTaskExecution_a"), null);
});

test("不同标签的定时任务排队等跨标签执行锁，等待超过半小时后不执行", async () => {
  const task = daily();
  const storage = sharedStorage(task);
  let current = time(10, 0);
  let tail = Promise.resolve();
  const locks = {
    request: (name, callback) => {
      const pending = tail.then(() => callback({ name }));
      tail = pending.then(() => undefined);
      return pending;
    },
  };
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entering = new Promise((resolve) => {
    started = resolve;
  });
  let count = 0;
  const args = { locks, storage, task, time: time(10, 0), now: () => current };
  const first = runScheduledOccurrence({
    ...args,
    execute: async () => {
      count++;
      started();
      await gate;
      return { status: "completed" };
    },
  });
  await entering;
  const second = runScheduledOccurrence({
    ...args,
    execute: async () => {
      count++;
      return { status: "completed" };
    },
  });
  current = time(10, 31);
  release();
  assert.equal((await first).status, "completed");
  assert.deepEqual(await second, {
    status: "stopped",
    reason: "expired",
    started: false,
  });
  assert.equal(count, 1);
});

test("等待执行锁期间配置被关闭时不会执行", async () => {
  const task = daily();
  const storage = sharedStorage(task);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const locks = {
    request: async (name, callback) => {
      await gate;
      return callback({ name });
    },
  };
  let called = false;
  const pending = runScheduledOccurrence({
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 1),
    execute: () => {
      called = true;
    },
  });
  storage.setItem(
    "scheduledTasks",
    JSON.stringify([daily({ enabled: false })]),
  );
  release();
  assert.deepEqual(await pending, {
    status: "stopped",
    reason: "stale",
    started: false,
  });
  assert.equal(called, false);
});

test("执行已开始后即使停止导致异常，也不能误判为未开始", async () => {
  const task = daily();
  const storage = sharedStorage(task);
  const controller = new AbortController();
  let rejectRun;
  let notify;
  const started = new Promise((resolve) => {
    notify = resolve;
  });
  const result = runScheduledOccurrence({
    locks: { request: (_name, _options, callback) => callback({}) },
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 0),
    signal: controller.signal,
    execute: () => {
      notify();
      return new Promise((_resolve, reject) => {
        rejectRun = reject;
      });
    },
  });
  await started;
  controller.abort();
  rejectRun(new Error("结果未知"));
  await assert.rejects(result, /结果未知/);
});

test("入队结果未知保留去重标记，仅明确执行前取消时回滚", async () => {
  const task = daily();
  const data = new Map([["scheduledTasks", JSON.stringify([task])]]);
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  const locks = {
    request: (name, options, callback) => (callback || options)({ name }),
  };
  let capturedError = null;
  await claimScheduledOccurrence({
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 0),
    enqueue: () => Promise.reject(new Error("settings missing")),
    onError: (err) => {
      capturedError = err;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(capturedError?.message || "", /settings missing/);
  assert.notEqual(storage.getItem("lastTaskExecution_a"), null);
  storage.removeItem("lastTaskExecution_a");

  await claimScheduledOccurrence({
    locks,
    storage,
    task,
    time: time(10, 0),
    now: () => time(10, 0),
    enqueue: () =>
      Promise.resolve({ status: "stopped", reason: "closed", started: false }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.getItem("lastTaskExecution_a"), null);
});
