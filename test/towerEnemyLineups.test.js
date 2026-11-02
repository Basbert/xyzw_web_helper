import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { HERO_DICT } from "../src/utils/HeroList.js";
import {
  checkTowerConfigVersion,
  getTowerEnemyLineup,
  nextTowerStageId,
  TOWER_MANIFEST_URL,
} from "../src/utils/towerEnemyLineups.js";

const data = JSON.parse(
  readFileSync(
    new URL("../src/data/towerLineups.json", import.meta.url),
    "utf8",
  ),
);

test("the next stage is one after the completed stage, including floor boundaries", () => {
  assert.equal(nextTowerStageId(0), 1);
  assert.equal(nextTowerStageId("9"), 10);
  assert.equal(nextTowerStageId(10), 11);
  assert.equal(nextTowerStageId(4411), 4412);
  for (const value of [null, undefined, "", " ", false, -1, 1.5, "x"])
    assert.equal(nextTowerStageId(value), null);
});

test("the screenshot stage 442-2 shows all five configured enemies, including duplicates", () => {
  const lineup = getTowerEnemyLineup(4411, data, HERO_DICT);
  assert.equal(lineup.stageId, 4412);
  assert.deepEqual(
    lineup.heroes.map((hero) => hero.name),
    ["黄盖", "吕蒙", "张飞", "庞统", "张飞"],
  );
  assert.deepEqual(
    lineup.heroes.map((hero) => hero.heroId),
    [222, 221, 204, 206, 204],
  );
});

test("every included stage has five known heroes with locally available images", () => {
  assert.ok(data.lineups.length >= 4500);
  for (let i = 0; i < data.lineups.length; i++) {
    const lineup = getTowerEnemyLineup(i, data, HERO_DICT);
    assert.equal(lineup?.heroes.length, 5, `stage ${i + 1}`);
    for (const hero of lineup.heroes)
      assert.ok(
        existsSync(new URL(`../public${hero.avatar}`, import.meta.url)),
      );
  }
});

test("unavailable or malformed stages never invent an enemy lineup", () => {
  assert.equal(getTowerEnemyLineup(null, data, HERO_DICT), null);
  assert.equal(getTowerEnemyLineup(data.lineups.length, data, HERO_DICT), null);
  assert.equal(getTowerEnemyLineup(0, { lineups: [[101]] }, HERO_DICT), null);
  assert.equal(
    getTowerEnemyLineup(0, { lineups: [[101, 102, 103, 104, 999]] }, HERO_DICT),
    null,
  );
});

test("version check sends no account data and distinguishes current, changed and unknown", async () => {
  const calls = [];
  const response = (config) => async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        body: JSON.stringify({ bundleVers: JSON.stringify({ config }) }),
      }),
    };
  };
  assert.equal(
    await checkTowerConfigVersion("78fbc", { fetchImpl: response("78fbc") }),
    "current",
  );
  assert.equal(
    await checkTowerConfigVersion("78fbc", { fetchImpl: response("new") }),
    "outdated",
  );
  assert.equal(
    await checkTowerConfigVersion("78fbc", {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    "unknown",
  );
  assert.equal(
    await checkTowerConfigVersion("78fbc", { fetchImpl: response(null) }),
    "unknown",
  );
  for (const call of calls) {
    assert.equal(call.url, TOWER_MANIFEST_URL);
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.body, "");
    assert.deepEqual(Object.keys(call.options.headers), ["Content-Type"]);
  }
});
