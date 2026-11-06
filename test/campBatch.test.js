import assert from "node:assert/strict";
import test from "node:test";
import { createTasksCampChallenge } from "../src/utils/batch/tasksCampChallenge.js";

const OPEN_TIME = Date.UTC(2026, 10, 3, 4);
function fixture({
  unknown = false,
  owns = false,
  timeout = false,
  counts,
} = {}) {
  const requests = [];
  const logs = [];
  const closed = [];
  let released = 0;
  let attacked = false;
  let clubReads = 0;
  const role = {
    roleId: 100,
    battleTeam: { 0: { heroId: 104 } },
    lordWeaponId: 2,
    pet: { petId: 501, petUId: "pet-a" },
  };
  const state = () => ({
    club: {
      phase: "261102",
      members: { 1: { roleId: 100 } },
      oppoMap: {
        2: {
          name: "今日",
          defenders: {
            1: {
              roleId: 300,
              name: "今日镜像",
              mirror: true,
              defeated: attacked,
              challengeCnt: 0,
              failCnt: 0,
            },
          },
        },
        3: {
          name: "明日",
          defenders: { 1: { roleId: 999, name: "明日对手" } },
        },
      },
    },
    siege: {
      roleId: 100,
      attackMap: {
        261103: { attackCnt: attacked ? 1 : 0, aSuccessCnt: attacked ? 1 : 0 },
      },
    },
  });
  const tokenStore = {
    async sendMessageWithPromise(id, command, params) {
      requests.push({ id, command, params });
      if (command === "role_getroleinfo") return { role };
      if (command === "club_getinfo") {
        const response = state();
        const current = counts?.[Math.min(clubReads++, counts.length - 1)];
        if (current) response.siege.attackMap[261103] = current;
        return response;
      }
      if (command === "presetteam_getinfo") {
        return { presetTeamInfo: { 1: { teamInfo: { 0: { heroId: 104 } } } } };
      }
      if (command === "club_attackmonster") {
        if (timeout) throw new Error("timeout");
        return unknown ? {} : { battleData: { result: { isWin: true } } };
      }
      if (command === "club_attack") {
        if (timeout) throw new Error("timeout");
        attacked = true;
        return unknown ? {} : { battleData: { result: { isWin: true } } };
      }
      if (command === "club_taskclaim") return {};
      throw new Error(`Unexpected command: ${command}`);
    },
    closeWebSocketConnection(id) {
      closed.push(id);
    },
  };
  const deps = {
    selectedTokens: { value: ["a"] },
    tokens: { value: [{ id: "a", name: "测试角色" }] },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    async ensureConnection(_id, _retries, notify) {
      notify(owns);
    },
    releaseConnectionSlot() {
      released++;
    },
    tokenStore,
    addLog(item) {
      logs.push(item);
    },
    message: { success() {}, warning() {} },
    currentRunningTokenId: { value: null },
    loadSettings: () => ({}),
  };
  return {
    deps,
    requests,
    logs,
    closed,
    get released() {
      return released;
    },
  };
}
async function runAtGameTime(fn) {
  const original = Date.now;
  Date.now = () => OPEN_TIME;
  try {
    await fn();
  } finally {
    Date.now = original;
  }
}

test("batch camp challenges only today's target and keeps an existing connection", async () => {
  const f = fixture();
  await runAtGameTime(() =>
    createTasksCampChallenge(f.deps).batchCampChallenge(),
  );
  const attacks = f.requests.filter((item) => item.command === "club_attack");
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].params.targetId, 300);
  assert.equal(attacks[0].params.targetIsMirror, true);
  assert.equal(attacks[0].params.teamSetParams.petUId, "pet-a");
  assert.equal(attacks[0].params.teamSetParams.lordWeaponId, 2);
  assert.deepEqual(f.closed, []);
  assert.equal(f.released, 0);
  assert.equal(
    f.requests.filter((item) => item.command === "club_taskclaim").length,
    4,
  );
});

test("batch checks the final server snapshot before submitting at ordinary limits", async () => {
  for (const counts of [
    [
      { attackCnt: 9, aSuccessCnt: 1 },
      { attackCnt: 9, aSuccessCnt: 1 },
      { attackCnt: 10, aSuccessCnt: 1 },
    ],
    [
      { attackCnt: 5, aSuccessCnt: 2 },
      { attackCnt: 5, aSuccessCnt: 2 },
      { attackCnt: 6, aSuccessCnt: 3 },
    ],
  ]) {
    const f = fixture({ counts });
    await runAtGameTime(() =>
      createTasksCampChallenge(f.deps).batchCampChallenge(),
    );
    assert.equal(
      f.requests.filter((item) => item.command === "club_attack").length,
      0,
    );
    assert.ok(
      f.logs.some((item) => item.message.includes("已达到普通账号挑战上限")),
    );
  }
});

test("an unknown or timed-out result stops the batch without claiming or retrying", async () => {
  for (const options of [{ unknown: true }, { timeout: true }]) {
    const f = fixture({ ...options, owns: true });
    await runAtGameTime(() =>
      createTasksCampChallenge(f.deps).batchCampChallenge(),
    );
    assert.equal(
      f.requests.filter((item) => item.command === "club_attack").length,
      1,
    );
    assert.equal(
      f.requests.some((item) => item.command === "club_taskclaim"),
      false,
    );
    assert.equal(f.deps.tokenStatus.value.a, "failed");
    assert.deepEqual(f.closed, ["a"]);
    assert.equal(f.released, 1);
  }
});

test("unknown pet battle results stop later rounds and preserve an existing connection", async () => {
  const f = fixture({ unknown: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    await runAtGameTime(() =>
      createTasksCampChallenge(f.deps).batchCampChallengePet(),
    );
  } finally {
    console.error = originalError;
  }
  const attacks = f.requests.filter(
    (item) => item.command === "club_attackmonster",
  );
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].params.teamSetParams.petUId, "pet-a");
  assert.equal(
    f.requests.some((item) => item.command === "club_taskclaim"),
    false,
  );
  assert.deepEqual(f.closed, []);
  assert.equal(f.released, 0);
});
