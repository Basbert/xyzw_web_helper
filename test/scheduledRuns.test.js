import assert from "node:assert/strict";
import { test } from "node:test";
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
