import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCampProgress,
  describeWeeklyQuizReminder,
  getReminderDays,
} from "../src/utils/dailyReminders.js";
import {
  getLastSaturday,
  isLegionWarAccessible,
  isNowInLegionWarTime,
} from "../src/utils/legionWarTime.js";
import { readWeeklyQuizConfig } from "../src/utils/weeklyQuiz.js";

const chinaDay = (day) => Date.UTC(2026, 10, day, 4); // 2026-11-01 is Sunday
const data = (attempts, wins) => ({
  club: { phase: "261102", oppoMap: {} },
  siege: { attackMap: { 261103: { attackCnt: attempts, aSuccessCnt: wins } } },
});

test("reminders appear only on the requested China-time activity days", () => {
  const week = Array.from({ length: 7 }, (_, index) =>
    getReminderDays(chinaDay(index + 1)),
  );
  assert.deepEqual(
    week.map((day) => day.dream),
    [true, true, false, true, true, false, false],
  );
  assert.deepEqual(
    week.map((day) => day.camp),
    [false, false, true, true, true, false, false],
  );
  assert.equal(getReminderDays(Date.UTC(2026, 10, 2, 16)).camp, true);
  assert.equal(getReminderDays(Date.UTC(2026, 10, 2, 15, 59)).dream, true);
  // Saturday 20:00 CST (2026-11-07 12:00Z) -> legionWar true; 18:00 CST -> false
  assert.equal(
    getReminderDays(Date.parse("2026-11-07T20:00:00+08:00")).legionWar,
    true,
  );
  assert.equal(
    getReminderDays(Date.parse("2026-11-07T18:00:00+08:00")).legionWar,
    false,
  );
});

test("camp progress distinguishes attempts and wins without overstating a privilege limit", () => {
  assert.match(
    describeCampProgress(data(4, 2), chinaDay(3)),
    /已挑战 4 次，获胜 2 场/,
  );
  assert.match(
    describeCampProgress(data(5, 3), chinaDay(3)),
    /已达普通上限，特权次数以游戏为准/,
  );
});

test("stale, invalid, or impossible counts cannot be shown as current progress", () => {
  const stale = data(0, 0);
  stale.club.phase = "261026";
  assert.equal(describeCampProgress(stale, chinaDay(3)), "挑战进度待确认");
  assert.equal(describeCampProgress(data(1, 2), chinaDay(3)), "挑战进度待确认");
  assert.throws(() => describeCampProgress({}, chinaDay(3)), /不完整/);
});

test("legionWar reminder, route guard, and map accessibility share China-time rules and exclude 5th Saturday", () => {
  const cases = [
    // 1st Saturday of Nov 2026 at 20:00 CST (12:00 UTC)
    [Date.parse("2026-11-07T20:00:00+08:00"), true],
    // 4th Saturday of Nov 2026 at 21:00 CST
    [Date.parse("2026-11-28T21:00:00+08:00"), true],
    // 5th Saturday of Oct 2026 (Oct 3, 10, 17, 24, 31) at 20:00 CST -> closed!
    [Date.parse("2026-10-31T20:00:00+08:00"), false],
    // 4th Sunday of Nov 2026 (Nov 1, 8, 15, 22) at 20:30 CST -> open!
    [Date.parse("2026-11-22T20:30:00+08:00"), true],
    // 4th Sunday of Nov 2026 at 21:31 CST -> closed!
    [Date.parse("2026-11-22T21:31:00+08:00"), false],
    // 1st Sunday of Nov 2026 at 20:00 CST -> closed!
    [Date.parse("2026-11-01T20:00:00+08:00"), false],
  ];
  for (const [ts, expected] of cases) {
    assert.equal(isLegionWarAccessible(ts), expected);
    assert.equal(isNowInLegionWarTime(ts), expected);
    assert.equal(getReminderDays(ts).legionWar, expected);
  }
  // China Sunday 01:00 (UTC Saturday 17:00) on non-4th Sunday resolves to Saturday in China time
  assert.equal(
    getLastSaturday(Date.parse("2026-11-08T01:00:00+08:00")),
    "2026/11/07",
  );
  // 4th Sunday of Nov 2026 (2026-11-22) resolves to Sunday itself in China time
  assert.equal(
    getLastSaturday(Date.parse("2026-11-22T01:00:00+08:00")),
    "2026/11/22",
  );
});

test("describeWeeklyQuizReminder follows real quiz config target and account weeklyQuizEnabled toggle", () => {
  const quizConfig = readWeeklyQuizConfig({
    StudyActConf: {
      1: {
        id: 1,
        actType: 1,
        startTime: Date.parse("2026-11-01T00:00:00+08:00") / 1000,
        endTime: Date.parse("2026-11-30T23:59:59+08:00") / 1000,
      },
    },
    StudyRewardConf: {
      1: { id: 1, actId: 1, periodType: 2, correctNum: 3 },
      2: { id: 2, actId: 1, periodType: 2, correctNum: 6 },
    },
    StudyConf: Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        i + 1,
        { id: i + 1, correctOption: 1 },
      ]),
    ),
    ConstantConf: {
      studyQuestionNum: 6,
      studyDailyChance: 2,
      studyEnergyCost: 10,
    },
  });
  const nowMs = Date.parse("2026-11-11T10:00:00+08:00");
  const todaySec = Date.parse("2026-11-11T00:00:00+08:00") / 1000;
  const yesterdaySec = Date.parse("2026-11-10T09:00:00+08:00") / 1000;

  // Complete at config.target=6 (even though 6 < 10!) -> hidden
  assert.equal(
    describeWeeklyQuizReminder({
      role: {
        dailyTask: { dailyTime: todaySec },
        study: {
          beginTime: yesterdaySec,
          maxCorrectNum: 6,
          taskComplete: { 1: "claimed", 2: "claimed" },
        },
      },
      config: quizConfig,
      nowMs,
      weeklyQuizEnabled: true,
    }),
    "",
  );

  // Incomplete with weeklyQuizEnabled=false -> does not claim daily task will auto-complete
  const disabledText = describeWeeklyQuizReminder({
    role: {
      dailyTask: { dailyTime: todaySec },
      study: {
        beginTime: yesterdaySec,
        maxCorrectNum: 3,
        taskComplete: { 1: "claimed", 2: "not" },
      },
    },
    config: quizConfig,
    nowMs,
    weeklyQuizEnabled: false,
  });
  assert.match(disabledText, /3\/6/);
  assert.match(disabledText, /已关闭日常自动答题/);

  // Enabled and not started this week -> references target 6, not hardcoded 10
  const enabledText = describeWeeklyQuizReminder({
    role: {
      dailyTask: { dailyTime: todaySec },
      study: { beginTime: 0, maxCorrectNum: 0, taskComplete: {} },
    },
    config: quizConfig,
    nowMs,
    weeklyQuizEnabled: true,
  });
  assert.match(enabledText, /目标 6 题/);
  assert.match(enabledText, /可自动答题/);

  // Outside activity window -> hidden
  assert.equal(
    describeWeeklyQuizReminder({
      role: {
        dailyTask: { dailyTime: todaySec },
        study: { beginTime: 0, maxCorrectNum: 0, taskComplete: {} },
      },
      config: quizConfig,
      nowMs: Date.parse("2026-12-05T10:00:00+08:00"),
      weeklyQuizEnabled: true,
    }),
    "",
  );
});
