import assert from "node:assert/strict";
import { test } from "node:test";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";

function fixture() {
  let nextId = 0;
  const timers = new Map();
  const calls = [];
  const allowed = new Set(["A"]);
  const recovery = createConnectionRecovery({
    canRecover: (id) => allowed.has(id),
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
    stableMs: 10,
  });
  const runNext = async () => {
    const [id, timer] = timers.entries().next().value || [];
    assert.ok(timer, "a timer must be pending");
    timers.delete(id);
    await timer.fn();
    return timer.delay;
  };
  return { recovery, timers, calls, allowed, runNext };
}

test("unexpected disconnects retry a limited number of times with increasing delay", async () => {
  const f = fixture();
  assert.equal(f.recovery.schedule("A"), true);
  assert.equal(f.recovery.schedule("A"), false);
  assert.deepEqual(
    [await f.runNext(), await f.runNext(), await f.runNext()],
    [1, 2, 4],
  );
  assert.deepEqual(f.calls, ["A", "A", "A"]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.recovery.schedule("A"), false);
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
  await f.runNext();
  assert.deepEqual(f.calls, []);
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
