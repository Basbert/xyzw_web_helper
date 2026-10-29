import assert from "node:assert/strict";
import { test } from "node:test";
import { createTasksArena } from "../src/utils/batch/tasksArena.js";
import * as dailyState from "../src/utils/dailyTaskState.js";
import { loadModule } from "./helpers/loadModule.js";

const { createTasksItem } = await loadModule(
  new URL("../src/utils/batch/tasksItem.js", import.meta.url),
  {
    "@/utils/HeroList": { HERO_DICT: {} },
    "@/utils/PeachTaskIds": { PEACH_TASKS: [] },
  },
);
const { createTasksTower } = await loadModule(
  new URL("../src/utils/batch/tasksTower.js", import.meta.url),
  {
    "@/utils/gameValue.js": { isSameGameValue: (a, b) => a === b },
    "../towerActId.js": { getTowerActId: () => 1 },
    "../towerClimbLimit.js": { normalizeWeirdTowerMaxClimb: (value) => value },
  },
  {
    setTimeout: (callback) => {
      callback();
      return 1;
    },
  },
);
const { createTasksBottle } = await loadModule(
  new URL("../src/utils/batch/tasksBottle.js", import.meta.url),
  { "@/utils/dailyTaskState": dailyState },
  {
    setTimeout: (callback) => {
      callback();
      return 1;
    },
  },
);
const { createTasksLegacy } = await loadModule(
  new URL("../src/utils/batch/tasksLegacy.js", import.meta.url),
  { "@/utils/dailyTaskState": dailyState },
);

function fixture() {
  const calls = [];
  const closed = [];
  let releases = 0;
  const statuses = { value: {} };
  const tokens = [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
  ];
  const roles = {
    alpha: { items: { 1007: { quantity: 2 }, 1011: { quantity: 2 } } },
    beta: { items: { 1007: { quantity: 0 }, 1011: { quantity: 0 } } },
  };
  const tokenStore = {
    // A stale shared snapshot belongs to a different account.
    gameData: {
      roleInfo: {
        role: { items: { 1007: { quantity: 99 }, 1011: { quantity: 99 } } },
      },
    },
    getWebSocketStatus: () => "connected",
    async sendGetRoleInfo(id) {
      return { role: roles[id] };
    },
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ id, cmd, params });
      if (cmd === "fight_starttower") roles[id].tower.energy--;
      if (cmd === "presetteam_getinfo")
        return { presetTeamInfo: { useTeamId: 1 } };
      if (cmd === "arena_getareatarget") return { roleList: [{ roleId: 123 }] };
      if (cmd === "role_getroleinfo") return { role: roles[id] };
      return {};
    },
    closeWebSocketConnection(id) {
      closed.push(id);
    },
  };
  const deps = {
    selectedTokens: { value: ["alpha", "beta"] },
    tokens: { value: tokens },
    tokenStatus: statuses,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async (id, _retries, onSlotChange) => {
      if (id === "alpha") onSlotChange?.(true);
      return true;
    },
    releaseConnectionSlot() {
      releases++;
    },
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 2 },
    tokenStore,
    addLog() {},
    message: { success() {}, warning() {}, error() {} },
    currentRunningTokenId: { value: null },
    currentSettings: { arenaFormation: 1, towerFormation: 1 },
    loadSettings: () => ({ arenaFormation: 1, towerFormation: 1 }),
    pickArenaTargetId: (targets) => targets?.roleList?.[0]?.roleId,
    delayConfig: { battle: 0, action: 0 },
    helperSettings: { fishType: 1, count: 3 },
  };
  return { calls, closed, statuses, deps, roles, getReleases: () => releases };
}

test("batch legacy claim keeps existing connections and accepts acknowledgements without optional rewards", async () => {
  const f = fixture();
  await createTasksLegacy(f.deps).batchLegacyClaim();
  assert.deepEqual(
    f.calls.map((call) => [call.id, call.cmd]),
    [
      ["alpha", "legacy_claimhangup"],
      ["beta", "legacy_claimhangup"],
    ],
  );
  assert.deepEqual(f.closed, ["alpha"]);
  assert.equal(f.getReleases(), 1);
  assert.equal(f.statuses.value.alpha, "completed");
  assert.equal(f.statuses.value.beta, "completed");
});

test("batch legacy claim shares the daily account lock", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["alpha"];
  await dailyState.runWithDailyTaskLock("alpha", async () => {
    await createTasksLegacy(f.deps).batchLegacyClaim();
  });
  assert.deepEqual(f.calls, []);
  assert.equal(f.statuses.value.alpha, "failed");
});

test("scheduled legacy gifting rejects a missing recipient before any game command", async () => {
  const f = fixture();
  f.deps.recipientIdInput = { value: "" };
  f.deps.recipientInfo = { value: null };
  f.deps.securityPassword = { value: "" };
  f.deps.giftQuantity = { value: 1 };
  f.deps.batchSettings.receiverId = "";
  await createTasksLegacy(f.deps).batchLegacyGiftSendEnhanced(true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.deps.isRunning.value, false);
});

test("parallel scheduled gifts use each account's own fragment count", async () => {
  const f = fixture();
  f.deps.recipientIdInput = { value: "" };
  f.deps.recipientInfo = { value: null };
  f.deps.securityPassword = { value: "" };
  f.deps.giftQuantity = { value: 10 };
  f.deps.batchSettings.receiverId = 123;
  f.deps.batchSettings.password = "test-only";
  f.roles.alpha.items[37007] = { quantity: 2 };
  f.roles.beta.items[37007] = { quantity: 7 };
  let releaseAlpha;
  let alphaReady;
  let betaDone;
  const alphaGate = new Promise((resolve) => {
    releaseAlpha = resolve;
  });
  const alphaStarted = new Promise((resolve) => {
    alphaReady = resolve;
  });
  const betaSent = new Promise((resolve) => {
    betaDone = resolve;
  });
  f.deps.tokenStore.sendMessageWithPromise = async (id, cmd, params) => {
    f.calls.push({ id, cmd, params });
    if (cmd === "rank_getroleinfo")
      return { roleInfo: { roleId: 123, name: "Target" } };
    if (cmd === "role_commitpassword") {
      if (id === "alpha") {
        alphaReady();
        await alphaGate;
      }
      return { role: { statistics: { "que:wh:tm": 1 } } };
    }
    if (cmd === "legacy_sendgift" && id === "beta") betaDone();
    return {};
  };
  const pending = createTasksLegacy(f.deps).batchLegacyGiftSendEnhanced(true);
  await alphaStarted;
  await betaSent;
  f.deps.selectedTokens.value = ["beta"];
  releaseAlpha();
  await pending;
  assert.deepEqual(
    f.calls
      .filter((call) => call.cmd === "legacy_sendgift")
      .map((call) => [call.id, call.params.itemCnt]),
    [
      ["beta", 7],
      ["alpha", 2],
    ],
  );
  assert.deepEqual(f.closed, ["alpha"]);
  assert.equal(f.statuses.value.alpha, "completed");
  assert.equal(f.statuses.value.beta, "completed");
});

test("an unconfirmed gift is never retried and is reported as pending", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["beta"];
  f.deps.recipientIdInput = { value: 123 };
  f.deps.recipientInfo = { value: { name: "Target" } };
  f.deps.securityPassword = { value: "test-only" };
  f.deps.giftQuantity = { value: 2 };
  f.roles.beta.items[37007] = { quantity: 10 };
  f.deps.tokenStore.sendMessageWithPromise = async (id, cmd, params) => {
    f.calls.push({ id, cmd, params });
    if (cmd === "role_commitpassword")
      return { role: { statistics: { "que:wh:tm": 1 } } };
    if (cmd === "legacy_sendgift") throw new Error("timeout");
    return {};
  };
  await createTasksLegacy(f.deps).batchLegacyGiftSendEnhanced();
  assert.equal(
    f.calls.filter((call) => call.cmd === "legacy_sendgift").length,
    1,
  );
  assert.equal(f.statuses.value.beta, "pending");
  assert.deepEqual(f.closed, []);
});

test("batch arena checks each account's own ticket count and preserves existing connections", async () => {
  const { calls, closed, statuses, deps, getReleases } = fixture();
  await createTasksArena(deps).batcharenafight();
  assert.equal(
    calls.filter(
      (call) => call.id === "alpha" && call.cmd === "fight_startareaarena",
    ).length,
    2,
  );
  assert.equal(
    calls.filter(
      (call) => call.id === "beta" && call.cmd === "fight_startareaarena",
    ).length,
    0,
  );
  assert.equal(statuses.value.alpha, "pending");
  assert.equal(statuses.value.beta, "pending");
  assert.deepEqual(closed, ["alpha"]);
  assert.equal(getReleases(), 1);
});

test("batch fishing checks each account's own rod inventory", async () => {
  const { calls, statuses, closed, deps } = fixture();
  await createTasksItem(deps).batchFish();
  const fish = calls.filter((call) => call.cmd === "artifact_lottery");
  assert.equal(fish.length, 1);
  assert.equal(fish[0].id, "alpha");
  assert.equal(fish[0].params.lotteryNumber, 2);
  assert.equal(statuses.value.alpha, "pending");
  assert.equal(statuses.value.beta, "pending");
  assert.deepEqual(closed, ["alpha"]);
});

test("batch fishing stops when a mid-run inventory refresh is unavailable", async () => {
  const { calls, statuses, deps, roles } = fixture();
  roles.alpha.items[1011].quantity = 61;
  deps.helperSettings.count = 61;
  const send = deps.tokenStore.sendMessageWithPromise;
  deps.tokenStore.sendMessageWithPromise = async (...args) => {
    if (args[0] === "alpha" && args[1] === "role_getroleinfo") return {};
    return send(...args);
  };
  await createTasksItem(deps).batchFish();
  const fish = calls.filter(
    (call) => call.id === "alpha" && call.cmd === "artifact_lottery",
  );
  assert.equal(fish.length, 5);
  assert.ok(fish.every((call) => call.params.lotteryNumber === 10));
  assert.equal(statuses.value.alpha, "pending");
});

test("monthly top-up tasks preserve an account's pre-existing connection", async () => {
  for (const taskName of ["batchTopUpFish", "batchTopUpArena"]) {
    const { closed, deps, getReleases } = fixture();
    const send = deps.tokenStore.sendMessageWithPromise;
    deps.tokenStore.sendMessageWithPromise = async (...args) =>
      args[1] === "activity_get" ? null : send(...args);
    await createTasksArena(deps)[taskName]();
    assert.deepEqual(closed, ["alpha"]);
    assert.equal(getReleases(), 1);
  }
});

test("batch tower tracks each account's energy instead of another account's cache", async () => {
  const { calls, roles, statuses, deps } = fixture();
  roles.alpha.tower = { energy: 2 };
  roles.beta.tower = { energy: 0 };
  deps.tokenStore.gameData.roleInfo.role.tower = { energy: 99 };
  await createTasksTower(deps).climbTower();
  assert.equal(
    calls.filter(
      (call) => call.id === "alpha" && call.cmd === "fight_starttower",
    ).length,
    2,
  );
  assert.equal(
    calls.filter(
      (call) => call.id === "beta" && call.cmd === "fight_starttower",
    ).length,
    0,
  );
  assert.equal(statuses.value.alpha, "completed");
});

test("batch tower stops retrying repeated rate-limit or reward errors", async () => {
  for (const code of ["200400", "1500040"]) {
    const { roles, statuses, deps } = fixture();
    roles.alpha.tower = { energy: 2, id: 1 };
    roles.beta.tower = { energy: 0, id: 1 };
    const send = deps.tokenStore.sendMessageWithPromise;
    let attempts = 0;
    deps.tokenStore.sendMessageWithPromise = async (...args) => {
      if (args[0] === "alpha" && args[1] === "fight_starttower") {
        attempts++;
        throw new Error(`服务器错误: ${code}`);
      }
      return send(...args);
    };
    await createTasksTower(deps).climbTower();
    assert.equal(attempts, 3);
    assert.equal(statuses.value.alpha, "pending");
  }
});

test("a partial arena fight is not reported as complete", async () => {
  const { calls, statuses, deps, roles } = fixture();
  roles.alpha.items[1007].quantity = 3;
  const send = deps.tokenStore.sendMessageWithPromise;
  let attempts = 0;
  deps.tokenStore.sendMessageWithPromise = async (...args) => {
    if (
      args[0] === "alpha" &&
      args[1] === "fight_startareaarena" &&
      ++attempts === 2
    )
      throw new Error("challenge rejected");
    return send(...args);
  };
  await createTasksArena(deps).batcharenafight();
  assert.equal(
    calls.filter(
      (call) => call.id === "alpha" && call.cmd === "fight_startareaarena",
    ).length,
    1,
  );
  assert.equal(attempts, 2);
  assert.equal(statuses.value.alpha, "pending");
});

test("batch arena restores the original formation when no target is available", async () => {
  const { calls, statuses, deps, roles } = fixture();
  roles.alpha.items[1007].quantity = 3;
  const send = deps.tokenStore.sendMessageWithPromise;
  deps.tokenStore.sendMessageWithPromise = async (...args) => {
    if (args[0] === "alpha" && args[1] === "presetteam_getinfo")
      return { presetTeamInfo: { useTeamId: 2 } };
    if (args[0] === "alpha" && args[1] === "arena_getareatarget")
      return { roleList: [] };
    return send(...args);
  };
  await createTasksArena(deps).batcharenafight();
  const changes = calls.filter(
    (call) => call.id === "alpha" && call.cmd === "presetteam_saveteam",
  );
  assert.deepEqual(
    changes.map((call) => call.params.teamId),
    [1, 2],
  );
  assert.equal(statuses.value.alpha, "pending");
});

test("batch salt-jar reset preserves pre-existing connections", async () => {
  const { calls, closed, statuses, deps, getReleases } = fixture();
  await createTasksBottle(deps).resetBottles();
  for (const id of ["alpha", "beta"]) {
    assert.deepEqual(
      calls.filter((call) => call.id === id).map((call) => call.cmd),
      ["bottlehelper_stop", "bottlehelper_start"],
    );
    assert.equal(statuses.value[id], "completed");
  }
  assert.deepEqual(closed, ["alpha"]);
  assert.equal(getReleases(), 1);
});

test("batch salt-jar claim does not overlap another daily action", async () => {
  const { calls, statuses, deps } = fixture();
  await dailyState.runWithDailyTaskLock("alpha", async () => {
    await createTasksBottle(deps).batchlingguanzi();
  });
  assert.equal(
    calls.filter(
      (call) => call.id === "alpha" && call.cmd === "bottlehelper_claim",
    ).length,
    0,
  );
  assert.equal(
    calls.filter(
      (call) => call.id === "beta" && call.cmd === "bottlehelper_claim",
    ).length,
    1,
  );
  assert.equal(statuses.value.alpha, "failed");
  assert.equal(statuses.value.beta, "completed");
});

test("stopping after the salt helper stops still attempts to restart it", async () => {
  const { calls, statuses, deps } = fixture();
  const send = deps.tokenStore.sendMessageWithPromise;
  deps.tokenStore.sendMessageWithPromise = async (...args) => {
    const response = await send(...args);
    if (args[0] === "alpha" && args[1] === "bottlehelper_stop")
      deps.shouldStop.value = true;
    return response;
  };
  await createTasksBottle(deps).resetBottles();
  assert.deepEqual(
    calls.filter((call) => call.id === "alpha").map((call) => call.cmd),
    ["bottlehelper_stop", "bottlehelper_start"],
  );
  assert.equal(statuses.value.alpha, "stopped");
});
