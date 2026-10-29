import assert from "node:assert/strict";
import { test } from "node:test";
import { runBottleAndHangUp } from "../src/utils/bottleAndHangUp.js";
import { runWithDailyTaskLock } from "../src/utils/dailyTaskState.js";

function fixture({ running = true, occupiedSlots = 1 } = {}) {
  const now = 1_700_000_000;
  const client = { serverTime: now * 1000 };
  const role = {
    bottleHelpers: { helperStopTime: running ? now + 3600 : 0 },
    hangUp: {
      checkTime: now,
      helpFriend: Array.from({ length: occupiedSlots }, (_, slot) => ({
        slot,
        helpTime: 3600,
      })),
    },
  };
  const calls = [];
  let connected = true;
  const tokenStore = {
    selectedToken: { id: "account-a" },
    wsConnections: { "account-a": { client } },
    gameData: {},
    getWebSocketStatus: () => (connected ? "connected" : "disconnected"),
    async sendMessageWithPromise(tokenId, command, params) {
      assert.equal(tokenId, "account-a");
      calls.push({ command, params });
      if (command === "role_getroleinfo")
        return { role: structuredClone(role) };
      if (command === "bottlehelper_stop")
        role.bottleHelpers.helperStopTime = 0;
      if (command === "bottlehelper_start")
        role.bottleHelpers.helperStopTime = now + 3600;
      if (command === "system_mysharecallback") {
        const slot = role.hangUp.helpFriend.length;
        role.hangUp.helpFriend.push({ slot, helpTime: 3600 });
      }
      return {};
    },
  };
  return {
    calls,
    role,
    tokenStore,
    disconnect: () => (connected = false),
    run: () =>
      runBottleAndHangUp({
        tokenStore,
        tokenId: "account-a",
        sleep: async () => {},
      }),
  };
}

test("one click restarts the bottle, claims the reward, then fills empty slots", async () => {
  const f = fixture();
  const result = await f.run();
  const commands = f.calls.map((call) => call.command);
  assert.deepEqual(commands, [
    "role_getroleinfo",
    "bottlehelper_stop",
    "bottlehelper_start",
    "system_claimhangupreward",
    "role_getroleinfo",
    "system_mysharecallback",
    "system_mysharecallback",
    "system_mysharecallback",
    "role_getroleinfo",
  ]);
  for (const call of f.calls.filter(
    (item) => item.command === "system_mysharecallback",
  ))
    assert.deepEqual(call.params, { isSkipShareCard: true, type: 2 });
  assert.equal(result.sent, 3);
  assert.equal(result.remaining, 0);
  assert.equal(f.tokenStore.gameData.roleInfo.role.hangUp.helpFriend.length, 4);
});

test("a stopped bottle starts without an unnecessary stop", async () => {
  const f = fixture({ running: false, occupiedSlots: 4 });
  const result = await f.run();
  assert.equal(
    f.calls.some((call) => call.command === "bottlehelper_stop"),
    false,
  );
  assert.equal(
    f.calls.some((call) => call.command === "bottlehelper_start"),
    true,
  );
  assert.equal(
    f.calls.some((call) => call.command === "system_mysharecallback"),
    false,
  );
  assert.equal(result.sent, 0);
});

test("a failed reward claim never proceeds to add time", async () => {
  const f = fixture();
  const send = f.tokenStore.sendMessageWithPromise;
  f.tokenStore.sendMessageWithPromise = async (...args) => {
    if (args[1] === "system_claimhangupreward") throw new Error("请求失败");
    return send(...args);
  };
  await assert.rejects(f.run(), /挂机奖励领取失败/);
  assert.equal(
    f.calls.some((call) => call.command === "system_mysharecallback"),
    false,
  );
});

test("a disconnected account does not continue with later operations", async () => {
  const f = fixture();
  const send = f.tokenStore.sendMessageWithPromise;
  f.tokenStore.sendMessageWithPromise = async (...args) => {
    const response = await send(...args);
    if (args[1] === "system_claimhangupreward") f.disconnect();
    return response;
  };
  await assert.rejects(f.run(), /账号或连接已变化/);
  assert.equal(
    f.calls.some((call) => call.command === "system_mysharecallback"),
    false,
  );
});

test("switching accounts after stopping restarts the original bottle without claiming rewards", async () => {
  const f = fixture();
  const send = f.tokenStore.sendMessageWithPromise;
  f.tokenStore.sendMessageWithPromise = async (...args) => {
    const response = await send(...args);
    if (args[1] === "bottlehelper_stop")
      f.tokenStore.selectedToken = { id: "other" };
    return response;
  };
  await assert.rejects(f.run(), /账号或连接已变化/);
  assert.deepEqual(
    f.calls.map((call) => call.command),
    ["role_getroleinfo", "bottlehelper_stop", "bottlehelper_start"],
  );
});

test("the combined operation shares the lock with the daily task runner", async () => {
  const f = fixture();
  await runWithDailyTaskLock("account-a", async () => {
    await assert.rejects(f.run(), /正在执行中/);
  });
  assert.equal(f.calls.length, 0);
});

test("missing bottle state stops before any operation", async () => {
  const f = fixture();
  delete f.role.bottleHelpers.helperStopTime;
  await assert.rejects(f.run(), /未提供盐罐状态/);
  assert.deepEqual(
    f.calls.map((call) => call.command),
    ["role_getroleinfo"],
  );
});

test("failure to start the bottle is reported before the reward is claimed", async () => {
  const f = fixture();
  const send = f.tokenStore.sendMessageWithPromise;
  f.tokenStore.sendMessageWithPromise = async (...args) => {
    if (args[1] === "bottlehelper_start") throw new Error("连接超时");
    return send(...args);
  };
  await assert.rejects(f.run(), /盐罐启动失败/);
  assert.equal(
    f.calls.some((call) => call.command === "system_claimhangupreward"),
    false,
  );
});
