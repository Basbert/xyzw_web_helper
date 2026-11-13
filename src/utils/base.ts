// 判断当前时间是否在本周内（周一00点重置）
export const isInCurrentWeek = (
  timestamp: number,
  now: Date = new Date(),
): boolean => {
  if (!Number.isFinite(timestamp)) return false;
  const dayOffset = (now.getDay() + 6) % 7; // 周一=0 .. 周日=6
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - dayOffset,
    0,
    0,
    0,
    0,
  ).getTime();
  const nextWeekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - dayOffset + 7,
    0,
    0,
    0,
    0,
  ).getTime();
  return timestamp >= weekStart && timestamp < nextWeekStart;
};

/** 生成 [min,max] 的随机整数 */
export const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Promise 版 sleep */
export { sleep } from "./helperTaskRunner.js";
