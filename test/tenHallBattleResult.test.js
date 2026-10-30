import assert from "node:assert/strict";
import test from "node:test";
import { parseTenHallBattleResult } from "../src/utils/tenHallBattleResult.js";

const battle = {
  maxRound: 30,
  leftTeam: { roleId: 123 },
  rightTeam: { roleId: -1 },
  result: {
    isWin: true,
    round: 8,
    sponsor: {
      roleId: 123,
      teamInfo: [
        { heroId: 11, slot: 0, hp: 100 },
        { heroId: 22, slot: 1, hp: "0" },
      ],
    },
    accept: { roleId: -1, teamInfo: [{ heroId: 33, hp: 0 }] },
  },
};

test("uses the actual result round and identifies the user's defeated heroes", () => {
  assert.deepEqual(parseTenHallBattleResult(battle, "123"), {
    ownSide: "sponsor",
    isWin: true,
    rounds: 8,
    heroes: [
      { heroId: 11, slot: 0, isDown: false },
      { heroId: 22, slot: 1, isDown: true },
    ],
    downCount: 1,
  });
});

test("reverses the win flag and team when the user is on the right", () => {
  const reversed = {
    ...battle,
    leftTeam: { roleId: -1 },
    rightTeam: { roleId: 123 },
    result: {
      ...battle.result,
      sponsor: battle.result.accept,
      accept: battle.result.sponsor,
    },
  };
  const parsed = parseTenHallBattleResult(reversed, 123);
  assert.equal(parsed.ownSide, "accept");
  assert.equal(parsed.isWin, false);
  assert.equal(parsed.downCount, 1);
});

test("uses the winner identifier when the battle result omits its win flag", () => {
  const partial = structuredClone(battle);
  delete partial.result.isWin;
  assert.equal(parseTenHallBattleResult(partial, 123, 123).isWin, true);
  assert.equal(parseTenHallBattleResult(partial, 123, 1).isWin, false);
  assert.equal(parseTenHallBattleResult(partial, 123).isWin, null);
});

test("does not infer the player, victory, round, or deaths from absent data", () => {
  const missing = {
    ...battle,
    result: {
      isWin: true,
      sponsor: { roleId: 999, teamInfo: [{ hp: 0 }] },
      accept: { roleId: -1, teamInfo: [{ hp: 0 }] },
    },
  };
  assert.deepEqual(parseTenHallBattleResult(missing, 123), {
    ownSide: null,
    isWin: null,
    rounds: null,
    heroes: null,
    downCount: null,
  });
  const incomplete = structuredClone(battle);
  delete incomplete.result.round;
  delete incomplete.result.sponsor.teamInfo[0].hp;
  const parsed = parseTenHallBattleResult(incomplete, 123);
  assert.equal(parsed.rounds, null);
  assert.equal(parsed.downCount, null);
  assert.equal(parsed.heroes[0].isDown, null);
  assert.equal(parsed.heroes[1].isDown, true);
});
