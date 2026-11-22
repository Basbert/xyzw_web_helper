import { campClock, getCampSnapshot } from "./campChallenge.js";
import { isLegionWarAccessible } from "./legionWarTime.js";
import { getWeeklyQuizProgress } from "./weeklyQuiz.js";

/** The game's activity days follow China time, independent of device timezone. */
export function getReminderDays(now = Date.now()) {
  const clock = campClock(now);
  return {
    dayKey: clock.dayKey,
    dream: [0, 1, 3, 4].includes(clock.weekday),
    camp: [2, 3, 4].includes(clock.weekday),
    legionWar: isLegionWarAccessible(now),
  };
}

/**
 * Describe weekly quiz reminder using the same official quiz config, progress
 * evaluator, and account toggle as DailyTaskRunner.
 */
export function describeWeeklyQuizReminder({
  role,
  config,
  nowMs = Date.now(),
  weeklyQuizEnabled = true,
} = {}) {
  if (!role || !config) return "";
  const progress = getWeeklyQuizProgress(role, config);
  if (!progress || progress.complete) return "";

  const nowSec = Math.floor(Number(nowMs) / 1000);
  if (
    Number.isFinite(nowSec) &&
    (nowSec < config.startsAt || nowSec > config.endsAt)
  ) {
    return "";
  }

  const autoEnabled = weeklyQuizEnabled !== false;
  if (progress.claimable.length > 0) {
    return autoEnabled
      ? "本周咸鱼大冲关有待领取奖励，执行每日任务时可自动领取。"
      : "本周咸鱼大冲关有待领取奖励（当前已关闭日常自动答题，可手动领取或开启开关）。";
  }

  if (progress.correct < config.target && !progress.attemptedToday) {
    if (!autoEnabled) {
      return `本周咸鱼大冲关最高答对 ${progress.correct}/${config.target} 题（当前已关闭日常自动答题，如需自动完成请前往日常设置开启）。`;
    }
    if (progress.correct === 0) {
      return `本周尚未完成咸鱼大冲关（目标 ${config.target} 题），执行每日任务时可自动答题。`;
    }
    return `本周最高答对 ${progress.correct}/${config.target} 题，今日可继续参与冲关。`;
  }

  return "";
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
