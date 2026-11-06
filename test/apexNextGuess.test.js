import assert from "node:assert/strict";
import test from "node:test";
import * as actualMap from "../src/utils/apexStageMap.js";
import { loadModule } from "./helpers/loadModule.js";

const schedule = {
  1: {
    season: 1,
    round: 1,
    stage: 3,
    date: "2026/11/09",
    signStartTime: -86400,
    endTime: 36000,
    fightTime: 34200,
    lockTime: 30600,
    advanceNum: 0,
  },
  2: {
    season: 1,
    round: 1,
    stage: 4,
    date: "2026/11/09",
    signStartTime: 0,
    endTime: 71100,
    fightTime: 68400,
    lockTime: 64800,
    advanceNum: 32,
  },
  3: {
    season: 1,
    round: 1,
    stage: 5,
    date: "2026/11/09",
    signStartTime: 0,
    endTime: 80100,
    fightTime: 77400,
    lockTime: 73800,
    advanceNum: 16,
  },
  4: {
    season: 1,
    round: 1,
    stage: 6,
    date: "2026/11/10",
    endDate: "2026/11/30",
    signStartTime: 0,
    endTime: 71100,
    fightTime: 68400,
    lockTime: 64800,
    advanceNum: 8,
  },
};
const fixtureMap = {
  APEX_TAOTAI_STAGES: [4, 5, 6, 7, 8, 9, 10],
  apexScheduleMap: schedule,
  apexStageNames: {
    4: { simpleName: "64强赛" },
    5: { simpleName: "32强赛" },
    6: { simpleName: "16强赛" },
  },
  apexSeasonConf: {},
  apexConstantConf: {},
  apexSupportLevels: [],
};
const rules = await loadModule(
  new URL("../src/utils/apexRules.js", import.meta.url),
  { "./apexStageMap": fixtureMap },
);
const dayZero = rules.getDateZeroTime("2026/11/09");

test("next opening waits for a same-day preceding match to end", () => {
  const next = rules.getNextApexGuessWindow(dayZero + 9 * 3600000);
  assert.equal(next.startsAt, dayZero + 10 * 3600000);
  assert.equal(next.stage, 4);
  assert.equal(
    rules.getScheduleStatus(next.scheduleId, next.startsAt - 1),
    rules.ApexScheduleStatus.None,
  );
  assert.equal(
    rules.getScheduleStatus(next.scheduleId, next.startsAt),
    rules.ApexScheduleStatus.Unlocked,
  );
});

test("during the first fight the next guess starts at the end, not at midnight or fight time", () => {
  const next = rules.getNextApexGuessWindow(
    dayZero + 19 * 3600000 + 15 * 60000,
  );
  assert.equal(next.stage, 5);
  assert.equal(next.startsAt, dayZero + 19 * 3600000 + 45 * 60000);
  assert.equal(
    rules.getScheduleStatus(next.scheduleId, next.startsAt - 1),
    rules.ApexScheduleStatus.None,
  );
  assert.equal(
    rules.getScheduleStatus(next.scheduleId, next.startsAt),
    rules.ApexScheduleStatus.Unlocked,
  );
});

test("a later day opens at midnight and the end of known schedules returns no invented time", () => {
  const next = rules.getNextApexGuessWindow(dayZero + 20 * 3600000);
  assert.equal(next.stage, 6);
  assert.equal(next.startsAt, rules.getDateZeroTime("2026/11/10"));
  assert.equal(rules.getNextApexGuessWindow(dayZero + 2 * 86400000), null);
  assert.equal(rules.getNextApexGuessWindow(Number.NaN), null);
});

test("current public snapshot finds the November 9 four-team round", async () => {
  const actual = await loadModule(
    new URL("../src/utils/apexRules.js", import.meta.url),
    { "./apexStageMap": actualMap },
  );
  const before = actual.getDateZeroTime("2026/11/06") + 12 * 3600000;
  const next = actual.getNextApexGuessWindow(before);
  assert.equal(next.startsAt, actual.getDateZeroTime("2026/11/09"));
  assert.equal(next.stage, 8);
  assert.equal(next.title, "4强赛");
});
