/**
 * 盐场时间判断与最近比赛日计算工具（轻量模块，供路由、提醒与布局按需引入）
 * 统一按北京时间（UTC+8）计算，避免受设备时区影响。
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getShanghaiParts(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(), // 0=周日, 1=周一, ..., 6=周六
    minutesCount: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function getDaysOfMonthUTC(year, month, targetDayOfWeek) {
  const days = [];
  const cursor = new Date(Date.UTC(year, month, 1));
  while (cursor.getUTCMonth() === month) {
    if (cursor.getUTCDay() === targetDayOfWeek) {
      days.push(cursor.getUTCDate());
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * 获取最近的周六日期（按北京时间计算；若今天为每月第四个周日则返回今天）
 * @param {number|Date} [now]
 * @returns {string} 格式化的日期字符串 YYYY/MM/DD
 */
export function getLastSaturday(now = Date.now()) {
  const { year, month, date, dayOfWeek } = getShanghaiParts(now);

  let daysToSubtract = 0;
  if (dayOfWeek === 6) {
    daysToSubtract = 0;
  } else if (dayOfWeek === 0) {
    const sundays = getDaysOfMonthUTC(year, month, 0);
    daysToSubtract = sundays.length >= 4 && date === sundays[3] ? 0 : 1;
  } else {
    daysToSubtract = dayOfWeek + 1;
  }

  const target = new Date(Date.UTC(year, month, date - daysToSubtract));
  const targetYear = target.getUTCFullYear();
  const targetMonth = String(target.getUTCMonth() + 1).padStart(2, "0");
  const targetDay = String(target.getUTCDate()).padStart(2, "0");

  return `${targetYear}/${targetMonth}/${targetDay}`;
}

/**
 * 判断当前是否允许使用盐场功能（按北京时间 UTC+8）
 * 规则：
 * 1. 每月前四个周六 19:55–21:00
 * 2. 每月第四个周日 19:55–21:30
 * @param {number|Date} [now]
 */
export function isLegionWarAccessible(now = Date.now()) {
  const { year, month, date, dayOfWeek, minutesCount } = getShanghaiParts(now);

  const isTimeAllowed = (isSunday) => {
    const start = 1195; // 19:55
    const end = isSunday ? 1290 : 1260; // 21:30 or 21:00
    return minutesCount >= start && minutesCount <= end;
  };

  if (dayOfWeek === 6) {
    const saturdays = getDaysOfMonthUTC(year, month, 6);
    const index = saturdays.indexOf(date);
    if (index >= 0 && index < 4) {
      return isTimeAllowed(false);
    }
  } else if (dayOfWeek === 0) {
    const sundays = getDaysOfMonthUTC(year, month, 0);
    if (sundays.length >= 4 && sundays[3] === date) {
      return isTimeAllowed(true);
    }
  }

  return false;
}

/**
 * 判断当前时间是否是盐场开放时间（与实时入口复用同一套北京时间准入规则）
 * @param {number|Date} [now]
 */
export function isNowInLegionWarTime(now = Date.now()) {
  return isLegionWarAccessible(now);
}
