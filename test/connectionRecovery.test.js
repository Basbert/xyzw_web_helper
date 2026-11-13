import assert from "node:assert/strict";
import { test } from "node:test";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";

function fixture() {
  let nextId = 0;
  const timers = new Map();
  const calls = [];
  const allowed = new Set(["A"]);
  const keepTrying = new Set(["A"]);
  const events = [];
  const recovery = createConnectionRecovery({
    canRecover: (id) => allowed.has(id),
    shouldKeepTrying: (id) => keepTrying.has(id),
    onState: (id, state) => events.push([id, state]),
    reconnect: async (id) => {
      calls.push(id);
      return false;
    },
    setTimer: (fn, delay) => {
      const id = ++nextId;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    delays: [1, 2, 4],
    slowRetryMs: 60,
    stableMs: 10,
  });
  const runNext = async () => {
    const [id, timer] = timers.entries().next().value || [];
    assert.ok(timer, "a timer must be pending");
    timers.delete(id);
    await timer.fn();
    return timer.delay;
  };
  return { recovery, timers, calls, allowed, keepTrying, events, runNext };
}

test("unexpected disconnects back off and continue at a low frequency without repeated notifications", async () => {
  const f = fixture();
  assert.equal(f.recovery.schedule("A"), true);
  assert.equal(f.recovery.schedule("A"), false);
  assert.deepEqual(
    [await f.runNext(), await f.runNext(), await f.runNext()],
    [1, 2, 4],
  );
  assert.deepEqual(f.calls, ["A", "A", "A"]);
  assert.equal(f.timers.size, 1);
  assert.equal(f.recovery.schedule("A"), false);
  assert.equal(await f.runNext(), 60);
  assert.equal(await f.runNext(), 60);
  assert.equal(f.calls.length, 5);
  assert.deepEqual(f.events, [["A", "waiting"]]);
  f.recovery.markConnected("A");
  assert.deepEqual(f.events, [
    ["A", "waiting"],
    ["A", "restored"],
  ]);
  assert.equal(await f.runNext(), 10);
  f.recovery.schedule("A");
  assert.equal(await f.runNext(), 1);
});

test("explicit disconnect cancels a queued retry", async () => {
  const f = fixture();
  f.recovery.schedule("A");
  f.recovery.cancel("A");
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.calls, []);
});

test("switching account before a retry prevents reconnecting the old account", async () => {
  const f = fixture();
  f.recovery.schedule("A");
  f.allowed.delete("A");
  f.keepTrying.delete("A");
  await f.runNext();
  assert.deepEqual(f.calls, []);
});

test("temporary offline or other-tab ownership waits slowly without attempting a connection", async () => {
  const f = fixture();
  f.allowed.delete("A");
  assert.equal(f.recovery.schedule("A"), true);
  assert.equal(await f.runNext(), 60);
  assert.equal(f.calls.length, 0);
  f.allowed.add("A");
  assert.equal(await f.runNext(), 60);
  assert.deepEqual(f.calls, ["A"]);
});

test("explicit cancellation prevents slow retries", async () => {
  const f = fixture();
  f.recovery.schedule("A");
  await f.runNext();
  await f.runNext();
  await f.runNext();
  f.recovery.cancel("A");
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.events.at(-1), ["A", "stopped"]);
});

test("brief connections do not reset the retry limit, but a stable one does", async () => {
  const f = fixture();
  f.recovery.schedule("A");
  await f.runNext();
  f.recovery.markConnected("A");
  f.recovery.schedule("A");
  assert.equal(await f.runNext(), 2);
  f.recovery.markConnected("A");
  assert.equal(await f.runNext(), 10);
  f.recovery.schedule("A");
  assert.equal(await f.runNext(), 1);
});

test("cancelling while a reconnect is in flight does not schedule another retry", async () => {
  let release;
  let callback;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let desired = true;
  const recovery = createConnectionRecovery({
    canRecover: () => desired,
    reconnect: async () => {
      await gate;
      return false;
    },
    setTimer: (fn) => {
      callback = fn;
      return 1;
    },
    clearTimer: () => {},
  });
  recovery.schedule("A");
  const attempt = callback();
  desired = false;
  recovery.cancel("A");
  release();
  await attempt;
  assert.equal(recovery.schedule("A"), false);
});

test("an old in-flight attempt cannot schedule or disturb a new recovery for the same account", async () => {
  let release;
  const timers = new Map();
  let nextTimer = 0;
  const recovery = createConnectionRecovery({
    canRecover: () => true,
    reconnect: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    setTimer: (fn) => {
      const id = ++nextTimer;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  recovery.schedule("A");
  const old = timers.get(1);
  timers.delete(1);
  const pending = old();
  recovery.cancel("A");
  recovery.schedule("A");
  assert.equal(timers.size, 1);
  release(false);
  await pending;
  assert.equal(timers.size, 1);
  assert.ok(timers.has(2));
});
