import { campClock, getCampSnapshot } from "./campChallenge.js";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function isLegionWarReminderTime(now = Date.now()) {
  const shifted = new Date(Number(now) + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();
  const weekday = shifted.getUTCDay();
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();

  if (weekday === 6 && minutes >= 1195 && minutes <= 1260) {
    return true;
  }
  if (weekday === 0 && minutes >= 1195 && minutes <= 1290) {
    const firstDayWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const firstSundayDate = 1 + ((7 - firstDayWeekday) % 7);
    return date === firstSundayDate + 21;
  }
  return false;
}

/** The game's activity days follow China time, independent of device timezone. */
export function getReminderDays(now = Date.now()) {
  const clock = campClock(now);
  return {
    dayKey: clock.dayKey,
    dream: [0, 1, 3, 4].includes(clock.weekday),
    camp: [2, 3, 4].includes(clock.weekday),
    legionWar: isLegionWarReminderTime(now),
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
