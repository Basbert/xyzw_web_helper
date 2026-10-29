import assert from "node:assert/strict";
import { test } from "node:test";
import { runStandaloneDailyAction } from "../src/utils/standaloneDailyActions.js";

function fixture(roles) {
  const commands = [];
  const client = { serverTime: 1_000_000 };
  const store = {
    selectedToken: { id: "account" },
    wsConnections: { account: { client } },
    gameData: {},
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(_id, command, params) {
      commands.push({ command, params });
      if (command === "role_getroleinfo") return { role: roles.shift() };
      return {};
    },
  };
  const run = (action) =>
    runStandaloneDailyAction({
      tokenStore: store,
      tokenId: "account",
      action,
      sleep: async () => {},
    });
  return { store, commands, run };
}

test("starting a stopped bottle does not send an unnecessary stop", async () => {
  const f = fixture([
    { bottleHelpers: { helperStopTime: 900 } },
    { bottleHelpers: { helperStopTime: 1200 } },
  ]);
  const result = await f.run("bottle");
  assert.equal(result.wasRunning, false);
  assert.deepEqual(
    f.commands.map((entry) => entry.command),
    ["role_getroleinfo", "bottlehelper_start", "role_getroleinfo"],
  );
});

test("restarting a running bottle stops then starts and verifies the server state", async () => {
  const f = fixture([
    { bottleHelpers: { helperStopTime: 1200 } },
    { bottleHelpers: { helperStopTime: 1500 } },
  ]);
  const result = await f.run("bottle");
  assert.equal(result.wasRunning, true);
  assert.deepEqual(
    f.commands.map((entry) => entry.command),
    [
      "role_getroleinfo",
      "bottlehelper_stop",
      "bottlehelper_start",
      "role_getroleinfo",
    ],
  );
});

test("an unconfirmed bottle start is reported rather than marked successful", async () => {
  const f = fixture([
    { bottleHelpers: { helperStopTime: 900 } },
    { bottleHelpers: { helperStopTime: 900 } },
  ]);
  await assert.rejects(f.run("bottle"), /尚未确认/);
});

test("switching selection after stopping still restarts the original live connection", async () => {
  const f = fixture([{ bottleHelpers: { helperStopTime: 1200 } }]);
  const originalSend = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await originalSend(...args);
    if (args[1] === "bottlehelper_stop")
      f.store.selectedToken = { id: "other" };
    return result;
  };
  await assert.rejects(f.run("bottle"), /账号或连接已变化/);
  assert.deepEqual(
    f.commands.map((entry) => entry.command),
    ["role_getroleinfo", "bottlehelper_stop", "bottlehelper_start"],
  );
});

test("claiming hang-up rewards does not implicitly add time", async () => {
  const f = fixture([{ hangUp: {} }]);
  const result = await f.run("claim");
  assert.equal(result.refreshed, true);
  assert.deepEqual(
    f.commands.map((entry) => entry.command),
    ["system_claimhangupreward", "role_getroleinfo"],
  );
});

test("a failed claim stops immediately without an add-time request", async () => {
  const f = fixture([]);
  f.store.sendMessageWithPromise = async (_id, command) => {
    f.commands.push({ command });
    throw new Error("server rejected");
  };
  await assert.rejects(f.run("claim"), /server rejected/);
  assert.deepEqual(
    f.commands.map((entry) => entry.command),
    ["system_claimhangupreward"],
  );
});

test("adding time sends only the empty server-confirmed slots", async () => {
  const helpers = [
    { slot: 0, helpTime: 3600 },
    { slot: 1, helpTime: 3600 },
  ];
  const full = [
    ...helpers,
    { slot: 2, helpTime: 3600 },
    { slot: 3, helpTime: 3600 },
  ];
  const f = fixture([
    { hangUp: { checkTime: 1000, helpFriend: helpers } },
    { hangUp: { checkTime: 1000, helpFriend: full } },
  ]);
  const result = await f.run("extend");
  assert.equal(result.sent, 2);
  assert.equal(result.remaining, 0);
  assert.deepEqual(
    f.commands.map((entry) => entry.command),
    [
      "role_getroleinfo",
      "system_mysharecallback",
      "system_mysharecallback",
      "role_getroleinfo",
    ],
  );
});

test("a disconnected account causes no game operation", async () => {
  const f = fixture([]);
  f.store.getWebSocketStatus = () => "disconnected";
  await assert.rejects(f.run("claim"), /账号或连接已变化/);
  assert.deepEqual(f.commands, []);
});
