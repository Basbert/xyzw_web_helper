import { isSameGameValue } from "../gameValue.js";

const WEEK_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const CYCLE_DURATION_MS = 3 * WEEK_DURATION_MS;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ACTIVITY_CYCLE_START_MS = Date.parse("2025-12-12T12:00:00+08:00");

function toTimestampMs(now = Date.now()) {
  return now instanceof Date ? now.getTime() : Number(now);
}

function getShanghaiCalendar(now = Date.now()) {
  const shifted = new Date(toTimestampMs(now) + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

const DEFAULT_SORT_CONFIG = {
  field: "createdAt",
  direction: "asc",
};

/**
 * Safely parse persisted token sort settings from storage.
 */
export function parseSortConfig(raw) {
  if (!raw) return { ...DEFAULT_SORT_CONFIG };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_SORT_CONFIG };
    }
    const validFields = new Set(["name", "server", "createdAt", "lastUsed"]);
    return {
      field: validFields.has(parsed.field) ? parsed.field : "createdAt",
      direction: parsed.direction === "desc" ? "desc" : "asc",
    };
  } catch {
    return { ...DEFAULT_SORT_CONFIG };
  }
}

/**
 * Return a sorted copy of the token list without mutating the input array.
 */
export function sortTokensList(tokens = [], sortConfig = DEFAULT_SORT_CONFIG) {
  const field = sortConfig?.field || "createdAt";
  const direction = sortConfig?.direction === "desc" ? "desc" : "asc";

  return [...tokens].sort((tokenA, tokenB) => {
    let valueA;
    let valueB;

    switch (field) {
      case "name":
        valueA = tokenA.name?.toLowerCase() || "";
        valueB = tokenB.name?.toLowerCase() || "";
        break;
      case "server":
        valueA = tokenA.server?.toLowerCase() || "";
        valueB = tokenB.server?.toLowerCase() || "";
        break;
      case "createdAt":
        valueA = new Date(tokenA.createdAt || 0).getTime();
        valueB = new Date(tokenB.createdAt || 0).getTime();
        break;
      case "lastUsed":
        valueA = new Date(tokenA.lastUsed || 0).getTime();
        valueB = new Date(tokenB.lastUsed || 0).getTime();
        break;
      default:
        valueA = tokenA.name?.toLowerCase() || "";
        valueB = tokenB.name?.toLowerCase() || "";
    }

    if (valueA < valueB) {
      return direction === "asc" ? -1 : 1;
    }
    if (valueA > valueB) {
      return direction === "asc" ? 1 : -1;
    }
    return 0;
  });
}

/**
 * Compute next sort config after clicking a sortable column/button.
 */
export function getNextSortConfig(currentConfig, field) {
  if (currentConfig?.field === field) {
    return {
      field,
      direction: currentConfig.direction === "asc" ? "desc" : "asc",
    };
  }
  return {
    field,
    direction: "asc",
  };
}

/**
 * Return directional arrow for active sort field, or null when inactive.
 */
export function getSortIndicator(sortConfig, field) {
  if (sortConfig?.field !== field) return null;
  return sortConfig.direction === "asc" ? "↑" : "↓";
}

/**
 * Baoku opens Wednesday through Sunday in China time (days 0, 3, 4, 5, 6).
 */
export function isBaokuActivityOpen(now = Date.now()) {
  const { day } = getShanghaiCalendar(now);
  return !isSameGameValue(day, 1) && !isSameGameValue(day, 2);
}

/**
 * Arena opens daily from 06:00 to 21:59 China time.
 */
export function isArenaActivityOpen(now = Date.now()) {
  const { hour } = getShanghaiCalendar(now);
  return hour >= 6 && hour < 22;
}

/**
 * Compute current weekly rotation ("黑市周" | "招募周" | "宝箱周") starting 2025-12-12 12:00+08:00.
 */
export function getCurrentActivityWeek(now = Date.now()) {
  const elapsed = toTimestampMs(now) - ACTIVITY_CYCLE_START_MS;
  if (elapsed < 0) return null;

  const cyclePosition = elapsed % CYCLE_DURATION_MS;

  if (cyclePosition < WEEK_DURATION_MS) {
    return "黑市周";
  } else if (cyclePosition < 2 * WEEK_DURATION_MS) {
    return "招募周";
  } else {
    return "宝箱周";
  }
}

/**
 * Weird Tower opens during 黑市周, starting Friday 12:00 China time.
 */
export function isWeirdTowerActivityOpen(now = Date.now()) {
  if (getCurrentActivityWeek(now) !== "黑市周") return false;

  const { day, hour } = getShanghaiCalendar(now);
  if (day === 5) {
    return hour >= 12;
  }
  return true;
}

/**
 * Return the fourth Sunday calendar date of the China-time month (keeping March 2026 override).
 */
export function getFourthSundayOfMonth(now = Date.now()) {
  const { year, month } = getShanghaiCalendar(now);

  const dayOfWeek = new Date(Date.UTC(year, month, 1)).getUTCDay();

  let firstSundayDate = 1 + ((7 - dayOfWeek) % 7);

  // 仅针对2026年3月进行特殊处理
  if (year === 2026 && month === 2 && dayOfWeek === 0) {
    firstSundayDate = 8;
  }

  return new Date(year, month, firstSundayDate + 21);
}

/**
 * War Guess opens 00:00-19:55 China time on the 4th Sunday (and March 1, 2026 override).
 */
export function isWarGuessActivityOpen(now = Date.now()) {
  const { year, month, date, hour, minute } = getShanghaiCalendar(now);

  // 手动修正：2026年3月1日开放
  if (year === 2026 && month === 2 && date === 1) {
    if (hour < 19 || (hour === 19 && minute <= 55)) return true;
  }

  const fourthSunday = getFourthSundayOfMonth(now);

  if (date !== fourthSunday.getDate()) return false;

  if (hour > 19 || (hour === 19 && minute > 55)) return false;

  return true;
}

/**
 * Human-readable War Guess schedule hint when closed.
 */
export function getWarGuessActivityTip(now = Date.now()) {
  if (isWarGuessActivityOpen(now)) return "";

  const fourthSunday = getFourthSundayOfMonth(now);
  const month = fourthSunday.getMonth() + 1;
  const date = fourthSunday.getDate();
  return `月赛助威仅在每月第四个周日 (${month}月${date}日) 00:00-19:55 开放`;
}

/**
 * Format battle power / heat values using 亿 / 万 units.
 */
export function formatPower(power) {
  if (!power) return "0";
  if (power >= 100000000) {
    return `${(power / 100000000).toFixed(2)}亿`;
  }
  if (power >= 10000) {
    return `${(power / 10000).toFixed(2)}万`;
  }
  return power.toString();
}
