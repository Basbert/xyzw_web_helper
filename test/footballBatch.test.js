import assert from "node:assert/strict";
import test from "node:test";
import { createTasksFootball } from "../src/utils/batch/tasksFootball.js";

function fixture({
  owns = false,
  stopDuringConnect = false,
  response,
  attack,
} = {}) {
  const calls = [];
  const closed = [];
  const notices = [];
  const logs = [];
  let released = 0;
  const client = { socket: {} };
  const deps = {
    selectedTokens: { value: ["a"] },
    tokens: { value: [{ id: "a", name: "测试角色" }] },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    async ensureConnection(_id, _retries, notify, onCreated, onReady) {
      notify(owns);
      if (owns) onCreated?.(client, client.socket);
      if (stopDuringConnect) deps.shouldStop.value = true;
      onReady?.();
    },
    releaseConnectionSlot() {
      released++;
    },
    tokenStore: {
      wsConnections: { a: { client } },
      getWebSocketStatus() {
        return "connected";
      },
      closeWebSocketConnection(id) {
        closed.push(id);
      },
      async sendMessageWithPromise(_id, command, params) {
        calls.push({ command, params });
        if (command === "saltcup26_getbetinfo")
          return (
            response ?? {
              roleData: {
                betRecord: { 1: { 10: { pick: 0 }, 11: { pick: 0 } } },
              },
            }
          );
        if (command === "saltcup26_placebet")
          return attack ? attack(params) : {};
        throw new Error(`Unexpected command ${command}`);
      },
    },
    addLog(item) {
      logs.push(item);
    },
    message: {
      success(s) {
        notices.push(s);
      },
      warning(s) {
        notices.push(s);
      },
    },
    currentRunningTokenId: { value: null },
  };
  return {
    deps,
    calls,
    closed,
    notices,
    logs,
    get released() {
      return released;
    },
  };
}

test("timeout stops subsequent bets and leaves an existing connection alone", async () => {
  const f = fixture({
    attack: () => {
      throw new Error("timeout");
    },
  });
  await createTasksFootball(f.deps).batchFootballBet(3);
  assert.equal(
    f.calls.filter((c) => c.command === "saltcup26_placebet").length,
    1,
  );
  assert.equal(f.deps.tokenStatus.value.a, "pending");
  assert.match(f.notices[0], /部分账号未完成/);
  assert.ok(f.logs.some((entry) => /结果未确认/.test(entry.message)));
  assert.deepEqual(f.closed, []);
  assert.equal(f.released, 0);
});

test("stop during connection releases only the slot created by the task", async () => {
  const f = fixture({ owns: true, stopDuringConnect: true });
  await createTasksFootball(f.deps).batchFootballBet(1);
  assert.deepEqual(f.calls, []);
  assert.equal(f.deps.tokenStatus.value.a, "stopped");
  assert.deepEqual(f.closed, ["a"]);
  assert.equal(f.released, 1);
});

test("missing and malformed records are errors rather than confirmed empty matches", async () => {
  for (const response of [{}, { roleData: { betRecord: { 1: { 10: {} } } } }]) {
    const f = fixture({ response });
    await createTasksFootball(f.deps).batchFootballBet(3);
    assert.equal(f.deps.tokenStatus.value.a, "failed");
    assert.equal(
      f.calls.some((item) => item.command === "saltcup26_placebet"),
      false,
    );
    assert.match(f.notices[0], /部分账号未完成/);
  }
});

test("a single valid match uses the chosen option and preserves existing connections", async () => {
  const f = fixture({
    response: { roleData: { betRecord: { 1: { 10: { pick: 0 } } } } },
  });
  await createTasksFootball(f.deps).batchFootballBet(2);
  assert.deepEqual(
    f.calls.find((item) => item.command === "saltcup26_placebet").params,
    { matchId: "10", pick: 2 },
  );
  assert.equal(f.deps.tokenStatus.value.a, "completed");
  assert.equal(f.released, 0);
  assert.deepEqual(f.closed, []);
});

test("invalid choices send no requests", async () => {
  const f = fixture();
  await createTasksFootball(f.deps).batchFootballBet(4);
  assert.equal(f.calls.length, 0);
  assert.match(f.notices[0], /无效/);
});
