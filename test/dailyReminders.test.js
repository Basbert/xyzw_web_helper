import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCampProgress,
  getReminderDays,
} from "../src/utils/dailyReminders.js";

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
