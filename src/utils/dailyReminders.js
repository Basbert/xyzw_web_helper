import { campClock, getCampSnapshot } from "./campChallenge.js";

/** The game's activity days follow China time, independent of device timezone. */
export function getReminderDays(now = Date.now()) {
  const clock = campClock(now);
  return {
    dayKey: clock.dayKey,
    dream: [0, 1, 3, 4].includes(clock.weekday),
    camp: [2, 3, 4].includes(clock.weekday),
  };
}

/** Counts are informative; paid privileges can raise the ordinary limits. */
export function describeCampProgress(response, now = Date.now()) {
  const snapshot = getCampSnapshot(response, now);
  if (
    !snapshot.phaseConfirmed ||
    !Number.isInteger(snapshot.attempts) ||
    !Number.isInteger(snapshot.wins) ||
    snapshot.wins > snapshot.attempts
  )
    return "挑战进度待确认";
  const counts = `已挑战 ${snapshot.attempts} 次，获胜 ${snapshot.wins} 场`;
  return snapshot.attempts >= 10 || snapshot.wins >= 3
    ? `${counts}；已达普通上限，特权次数以游戏为准`
    : counts;
}
