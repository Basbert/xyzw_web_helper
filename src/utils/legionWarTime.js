/**
 * 盐场时间判断与最近比赛日计算工具（轻量模块，供路由与布局按需引入）
 */

import { isSameGameValue } from "./gameValue.js";

/**
 * 获取最近的周六日期
 * 如果今天是周六，返回今天的日期；否则返回上周六的日期
 * @returns {string} 格式化的日期字符串 YYYY/MM/DD
 */
export function getLastSaturday() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const year = today.getFullYear();
  const month = today.getMonth();

  let daysToSubtract = 0;
  if (dayOfWeek === 6) {
    daysToSubtract = 0;
  } else if (dayOfWeek === 0) {
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();

    const firstSunday = new Date(year, month, 1);
    if (firstDayOfWeek === 0) {
      firstSunday.setDate(1);
    } else {
      firstSunday.setDate(1 + (7 - firstDayOfWeek));
    }

    const fourthSunday = new Date(firstSunday);
    fourthSunday.setDate(firstSunday.getDate() + 21);

    daysToSubtract = today.getDate() === fourthSunday.getDate() ? 0 : 1;
  } else {
    daysToSubtract = dayOfWeek + 1;
  }

  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() - daysToSubtract);

  const targetYear = targetDate.getFullYear();
  const targetMonth = String(targetDate.getMonth() + 1).padStart(2, "0");
  const targetDay = String(targetDate.getDate()).padStart(2, "0");

  return `${targetYear}/${targetMonth}/${targetDay}`;
}

/**
 * 判断当前时间是否是盐场时间
 */
export function isNowInLegionWarTime() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const date = today.getDate();
  const hours = today.getHours();
  const minutes = today.getMinutes();
  const minutesCount = hours * 60 + minutes;

  const getSundayOfMonths = (year, month) => {
    const sundayArr = [];
    for (let d = 0; d < 31; d++) {
      const temp = new Date(year, month, d);
      if (
        isSameGameValue(temp.getMonth(), month) &&
        isSameGameValue(temp.getDay(), 0)
      ) {
        sundayArr.push(d);
      }
    }
    return sundayArr;
  };

  if (
    isSameGameValue(dayOfWeek, 6) &&
    minutesCount >= 1195 &&
    minutesCount <= 1260
  ) {
    return true;
  }
  const sundayArr = getSundayOfMonths(today.getFullYear(), today.getMonth());
  if (
    isSameGameValue(dayOfWeek, 0) &&
    sundayArr.length >= 4 &&
    isSameGameValue(date, sundayArr[3]) &&
    minutesCount >= 1195 &&
    minutesCount <= 1290
  ) {
    return true;
  }
  return false;
}

/**
 * 判断当前是否允许使用盐场功能
 * 规则：
 * 1. 每月前四周周六
 * 2. 每月第四周周日
 */
export function isLegionWarAccessible() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();
  const dayOfWeek = today.getDay();

  const hours = today.getHours();
  const minutes = today.getMinutes();
  const minutesCount = hours * 60 + minutes;

  const isTimeAllowed = (isSunday) => {
    const start = 1195; // 19:55
    const end = isSunday ? 1290 : 1260; // 21:30 or 21:00
    return minutesCount >= start && minutesCount <= end;
  };

  const getDaysOfMonth = (y, m, targetDayOfWeek) => {
    const days = [];
    const d = new Date(y, m, 1);
    while (d.getMonth() === m) {
      if (d.getDay() === targetDayOfWeek) {
        days.push(d.getDate());
      }
      d.setDate(d.getDate() + 1);
    }
    return days;
  };

  if (dayOfWeek === 6) {
    const saturdays = getDaysOfMonth(year, month, 6);
    const index = saturdays.indexOf(date);
    if (index >= 0 && index < 4) {
      return isTimeAllowed(false);
    }
  } else if (dayOfWeek === 0) {
    const sundays = getDaysOfMonth(year, month, 0);
    if (sundays.length >= 4 && sundays[3] === date) {
      return isTimeAllowed(true);
    }
  }

  return false;
}
