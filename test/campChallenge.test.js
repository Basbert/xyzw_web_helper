import assert from "node:assert/strict";
import test from "node:test";
import {
  campClock,
  getCampSnapshot,
  makeCampTeam,
  prepareCampAttack,
  submitCampAttack,
} from "../src/utils/campChallenge.js";

const OPEN_TIME = Date.UTC(2026, 10, 3, 4, 0); // Tuesday 12:00 in China
const role = () => ({
  roleId: 100,
  battleTeam: { 0: { heroId: 104 }, 1: { heroId: 105 } },
  lordWeaponId: 2,
  pet: { petId: 501, petUId: "test-pet" },
});
const club = () => ({
  club: {
    phase: "261102",
    members: { 1: { roleId: 100 } },
    oppoMap: {
      2: {
        name: "今日对手",
        defenders: {
          1: {
            roleId: 300,
            name: "镜像对手",
            mirror: true,
            defeated: false,
            challengeCnt: 4,
            failCnt: 2,
          },
          2: {
            roleId: 301,
            name: "普通对手",
            mirror: false,
            defeated: false,
            challengeCnt: 0,
            failCnt: 0,
          },
        },
      },
      3: {
        name: "明日对手",
        defenders: {
          1: { roleId: 999, name: "明天", challengeCnt: 0, failCnt: 0 },
        },
      },
    },
  },
  siege: {
    roleId: 100,
    attackMap: { 261103: { attackCnt: 2, aSuccessCnt: 1 } },
  },
});
function fixture(options = {}) {
  const calls = [];
  let roleReads = 0;
  let clubReads = 0;
  const tokenStore = {
    async sendMessageWithPromise(tokenId, command, params) {
      calls.push({ tokenId, command, params });
      if (command === "role_getroleinfo") {
        roleReads++;
        return { role: options.getRole ? options.getRole(roleReads) : role() };
      }
      if (command === "club_getinfo") {
        clubReads++;
        return options.getClub ? options.getClub(clubReads) : club();
      }
      if (command === "club_attack") {
        if (options.attack) return options.attack(params);
        return {
          battleData: { result: { isWin: true, round: 9 } },
          addScore: 8,
        };
      }
      throw new Error(`Unexpected request ${command}`);
    },
  };
  return { tokenStore, calls };
}
const target = { nodeId: 1, roleId: 300, mirror: true };
const prepare = (f) =>
  prepareCampAttack({
    tokenStore: f.tokenStore,
    tokenId: "account",
    target,
    now: () => OPEN_TIME,
  });
const submit = (f, preview, extra = {}) =>
  submitCampAttack({
    tokenStore: f.tokenStore,
    preview,
    now: () => OPEN_TIME,
    ...extra,
  });

test("challenge schedule uses China time and stops at 22:00", () => {
  assert.equal(campClock(OPEN_TIME).isOpen, true);
  assert.equal(campClock(Date.UTC(2026, 10, 3, 14, 0)).isOpen, false);
  assert.equal(campClock(Date.UTC(2026, 10, 6, 4, 0)).isOpen, false);
});

test("snapshot uses today's opponent and treats missing zero fields as zero", () => {
  const data = club();
  data.siege.attackMap = { 261103: {} };
  const snapshot = getCampSnapshot(data, OPEN_TIME);
  assert.equal(snapshot.canAttack, true);
  assert.equal(snapshot.opponentName, "今日对手");
  assert.equal(snapshot.targets.length, 2);
  assert.equal(snapshot.attempts, 0);
  assert.equal(snapshot.wins, 0);
});

test("stale weekly data and non-match days cannot be used for an attack", async () => {
  const stale = club();
  stale.club.phase = "261026";
  assert.equal(getCampSnapshot(stale, OPEN_TIME).canAttack, false);
  const f = fixture();
  await assert.rejects(
    prepareCampAttack({
      tokenStore: f.tokenStore,
      tokenId: "account",
      target,
      now: () => Date.UTC(2026, 10, 6, 4, 0),
    }),
    /挑战时间/,
  );
  assert.equal(
    f.calls.some((x) => x.command === "club_attack"),
    false,
  );
});

test("preparation requires a valid current team and a known pet identifier", () => {
  const r = role();
  delete r.pet.petUId;
  assert.throws(() => makeCampTeam(r), /宠物信息不完整/);
  assert.throws(() => makeCampTeam({ battleTeam: {} }), /阵容为空/);
});

test("attack re-reads the target and sends the selected main team, toy, pet and mirror flag", async () => {
  const f = fixture({
    getClub(read) {
      const data = club();
      if (read > 1) {
        data.club.oppoMap[2].defenders[1].challengeCnt = 6;
        data.club.oppoMap[2].defenders[1].failCnt = 3;
      }
      return data;
    },
  });
  const preview = await prepare(f);
  const result = await submit(f, preview);
  const attack = f.calls.find((x) => x.command === "club_attack");
  assert.equal(attack.tokenId, "account");
  assert.equal(attack.params.nodeId, 1);
  assert.equal(attack.params.targetId, 300);
  assert.equal(attack.params.targetIsMirror, true);
  assert.equal(attack.params.challengeCnt, 6);
  assert.equal(attack.params.failCnt, 3);
  assert.equal(attack.params.useItem, false);
  assert.deepEqual(
    [...attack.params.teamSetParams.battleTeam],
    [
      [0, 104],
      [1, 105],
    ],
  );
  assert.equal(attack.params.teamSetParams.lordWeaponId, 2);
  assert.equal(attack.params.teamSetParams.petUId, "test-pet");
  assert.equal(result.outcome, "win");
  assert.equal(result.rounds, 9);
  assert.equal(result.score, 8);
  assert.ok(result.refreshed);
});

test("a changed lineup or target stops before the attack command", async () => {
  const changedTeam = fixture({
    getRole(read) {
      const r = role();
      if (read > 1) r.lordWeaponId = 3;
      return r;
    },
  });
  const preview = await prepare(changedTeam);
  await assert.rejects(submit(changedTeam, preview), /阵容、玩具或宠物已变化/);
  assert.equal(
    changedTeam.calls.some((x) => x.command === "club_attack"),
    false,
  );

  const changedTarget = fixture({
    getClub(read) {
      const data = club();
      if (read > 1) data.club.oppoMap[2].defenders[1].roleId = 700;
      return data;
    },
  });
  const otherPreview = await prepare(changedTarget);
  await assert.rejects(submit(changedTarget, otherPreview), /目标据点已变化/);
  assert.equal(
    changedTarget.calls.some((x) => x.command === "club_attack"),
    false,
  );
});

test("switching account during the final check prevents a battle", async () => {
  const f = fixture();
  const preview = await prepare(f);
  let checks = 0;
  await assert.rejects(
    submit(f, preview, {
      checkActive() {
        if (++checks === 3) throw new Error("账号已切换");
      },
    }),
    /账号已切换/,
  );
  assert.equal(
    f.calls.some((x) => x.command === "club_attack"),
    false,
  );
});

test("a lost attack response is marked uncertain and never retried", async () => {
  const f = fixture({
    attack: async () => {
      throw new Error("timeout");
    },
  });
  const preview = await prepare(f);
  await assert.rejects(
    submit(f, preview),
    (error) => error.uncertain && /结果未确认/.test(error.message),
  );
  assert.equal(f.calls.filter((x) => x.command === "club_attack").length, 1);
});

test("missing battle result stays unknown rather than being called a loss", async () => {
  const f = fixture({ attack: async () => ({ battleData: { result: {} } }) });
  const result = await submit(f, await prepare(f));
  assert.equal(result.outcome, "unknown");
  assert.equal(result.rounds, null);
});

test("snapshot rejects malformed counts and reads numeric Map keys", () => {
  const data = club();
  data.siege.attackMap = new Map([[261103, { attackCnt: 2, aSuccessCnt: 1 }]]);
  data.club.oppoMap = new Map([[2, data.club.oppoMap[2]]]);
  assert.equal(getCampSnapshot(data, OPEN_TIME).wins, 1);
  data.siege.attackMap = "invalid";
  assert.equal(getCampSnapshot(data, OPEN_TIME).canAttack, false);
  data.siege.attackMap = { 261103: { attackCnt: 1, aSuccessCnt: 2 } };
  assert.equal(getCampSnapshot(data, OPEN_TIME).canAttack, false);
});

test("unknown target flags do not expose the target as attackable", () => {
  const data = club();
  data.club.oppoMap[2].defenders[1].mirror = "false";
  data.club.oppoMap[2].defenders[2].defeated = "unknown";
  const snapshot = getCampSnapshot(data, OPEN_TIME);
  assert.equal(snapshot.targets.length, 1);
  assert.equal(snapshot.targets[0].mirror, false);
});

test("a mismatch with the game's reset date stops preparation", async () => {
  const f = fixture({
    getRole() {
      return { ...role(), resetTime: { day: 261104 } };
    },
  });
  await assert.rejects(prepare(f), /设备日期与游戏数据不一致/);
  assert.equal(
    f.calls.some((x) => x.command === "club_attack"),
    false,
  );
});

test("only one attack can be in flight for the same account", async () => {
  let finish;
  let notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  const f = fixture({
    attack: () =>
      new Promise((resolve) => {
        finish = resolve;
        notifyStarted();
      }),
  });
  const preview = await prepare(f);
  const pending = submit(f, preview);
  await started;
  await assert.rejects(submit(f, preview), /已有营地挑战正在进行/);
  finish({ battleData: { result: { isWin: true } } });
  await pending;
  assert.equal(f.calls.filter((x) => x.command === "club_attack").length, 1);
});
