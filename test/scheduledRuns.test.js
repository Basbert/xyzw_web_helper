import assert from "node:assert/strict";
import { test } from "node:test";
import { runScheduledOccurrence } from "../src/utils/batch/scheduledClock.js";
import {
  createScheduledRunQueue,
  summarizeScheduledRun,
} from "../src/utils/batch/scheduledRuns.js";

test("simultaneous scheduled plans run serially and keep their own accounts", async () => {
  const trace = [];
  let releaseFirst;
  let notifyFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const started = new Promise((resolve) => {
    notifyFirst = resolve;
  });
  const queue = createScheduledRunQueue({
    isBusy: () => false,
    execute: async (plan) => {
      trace.push([plan.name, "step 1", [...plan.accounts]]);
      if (plan.name === "A") {
        notifyFirst();
        await gate;
      }
      trace.push([plan.name, "step 2", [...plan.accounts]]);
      return { status: "completed" };
    },
  });
  const a = queue.enqueue({ name: "A", accounts: ["A"] });
  await started;
  const b = queue.enqueue({ name: "B", accounts: ["B"] });
  releaseFirst();
  await Promise.all([a, b]);
  assert.deepEqual(trace, [
    ["A", "step 1", ["A"]],
    ["A", "step 2", ["A"]],
    ["B", "step 1", ["B"]],
    ["B", "step 2", ["B"]],
  ]);
});

test("cancelling pending plans stops them without running their steps", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const calls = [];
  const queue = createScheduledRunQueue({
    isBusy: () => false,
    execute: async (name) => {
      calls.push(name);
      if (name === "A") {
        started();
        await gate;
      }
      return { status: "completed" };
    },
  });
  const first = queue.enqueue("A");
  await entered;
  const second = queue.enqueue("B");
  queue.cancelPending();
  release();
  await first;
  assert.equal((await second).status, "stopped");
  assert.deepEqual(calls, ["A"]);
  assert.equal((await queue.enqueue("C")).status, "completed");
  assert.deepEqual(calls, ["A", "C"]);
});

test("scheduled plans wait until a manual batch releases its running state", async () => {
  let busy = true;
  let release;
  let requested;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    requested = resolve;
  });
  const calls = [];
  const queue = createScheduledRunQueue({
    isBusy: () => busy,
    wait: async () => {
      requested();
      await gate;
    },
    execute: async (value) => {
      calls.push(value);
    },
  });
  const pending = queue.enqueue("plan");
  await waiting;
  assert.deepEqual(calls, []);
  busy = false;
  release();
  await pending;
  assert.deepEqual(calls, ["plan"]);
});

test("停止等待跨标签执行锁的计划后，即使锁释放也不能开始", async () => {
  let release;
  let waiting;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    waiting = resolve;
  });
  let writes = 0;
  const queue = createScheduledRunQueue({
    isBusy: () => false,
    execute: async (_plan, { isCancelled = () => false } = {}) => {
      waiting();
      await gate;
      if (isCancelled()) return { status: "stopped", started: false };
      writes++;
      return { status: "completed" };
    },
  });
  const pending = queue.enqueue("plan");
  await started;
  queue.cancelPending();
  release();
  assert.equal((await pending).status, "stopped");
  assert.equal(writes, 0);
});

test("10:00 等执行锁后停止，10:01 可排队且旧锁释放时只运行新周期", async () => {
  const planned = Date.now();
  const task = { id: "a", enabled: true };
  const storage = { getItem: () => JSON.stringify([task]) };
  const waiting = [];
  let notify;
  const firstWaiting = new Promise((resolve) => {
    notify = resolve;
  });
  const locks = {
    request: (_name, options, callback) =>
      new Promise((resolve, reject) => {
        const entry = { options, callback, resolve };
        waiting.push(entry);
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
        notify();
      }),
  };
  const executed = [];
  const queue = createScheduledRunQueue({
    isBusy: () => false,
    execute: (time, { isCancelled = () => false, signal } = {}) =>
      runScheduledOccurrence({
        locks,
        storage,
        task,
        time,
        now: () => planned + 60_000,
        isActive: () => !isCancelled(),
        signal,
        execute: () => {
          executed.push(time);
          return { status: "completed" };
        },
      }),
  });
  const first = queue.enqueue(planned);
  await firstWaiting;
  queue.cancelPending();
  const firstResult = await first;
  assert.equal(firstResult.status, "stopped");
  assert.equal(firstResult.started, false);
  const second = queue.enqueue(planned + 60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiting.length, 2);
  // A delayed callback from an aborted request must be harmless.
  waiting[0].resolve(await waiting[0].callback({ name: "old" }));
  waiting[1].resolve(await waiting[1].callback({ name: "new" }));
  assert.equal((await second).status, "completed");
  assert.deepEqual(executed, [planned + 60_000]);
});

test("stopped, failed, partial and unknown plans cannot report success", () => {
  assert.equal(summarizeScheduledRun([], { stopped: true }), "stopped");
  assert.equal(summarizeScheduledRun([]), "pending");
  assert.equal(summarizeScheduledRun([{ status: "failed" }]), "failed");
  assert.equal(
    summarizeScheduledRun([{ status: "completed" }, { status: "pending" }]),
    "partial",
  );
  assert.equal(summarizeScheduledRun([{ status: "waiting" }]), "pending");
  assert.equal(
    summarizeScheduledRun([{ status: "completed" }], { missing: 1 }),
    "partial",
  );
  assert.equal(summarizeScheduledRun([{ status: "completed" }]), "completed");
});
