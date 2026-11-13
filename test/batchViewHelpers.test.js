import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatPower,
  getCurrentActivityWeek,
  getFourthSundayOfMonth,
  getNextSortConfig,
  getSortIndicator,
  getWarGuessActivityTip,
  isArenaActivityOpen,
  isBaokuActivityOpen,
  isWarGuessActivityOpen,
  isWeirdTowerActivityOpen,
  parseSortConfig,
  sortTokensList,
} from "../src/utils/batch/viewHelpers.js";

describe("parseSortConfig", () => {
  test("returns default sort config for empty or corrupted JSON", () => {
    assert.deepEqual(parseSortConfig(null), {
      field: "createdAt",
      direction: "asc",
    });
    assert.deepEqual(parseSortConfig("{not-json"), {
      field: "createdAt",
      direction: "asc",
    });
    assert.deepEqual(
      parseSortConfig(JSON.stringify({ field: "unknown", direction: "desc" })),
      {
        field: "createdAt",
        direction: "desc",
      },
    );
  });

  test("preserves valid persisted field and direction", () => {
    assert.deepEqual(
      parseSortConfig(JSON.stringify({ field: "server", direction: "desc" })),
      { field: "server", direction: "desc" },
    );
  });
});

describe("sortTokensList / getNextSortConfig / getSortIndicator", () => {
  const sampleTokens = [
    {
      id: "2",
      name: "zeta",
      server: "S20",
      createdAt: "2026-01-03T00:00:00Z",
      lastUsed: "2026-01-05T00:00:00Z",
    },
    {
      id: "1",
      name: "Alpha",
      server: "s10",
      createdAt: "2026-01-01T00:00:00Z",
      lastUsed: "2026-01-09T00:00:00Z",
    },
  ];

  test("sorts without mutating original array", () => {
    const copyBefore = sampleTokens.map((t) => t.id);
    const byName = sortTokensList(sampleTokens, {
      field: "name",
      direction: "asc",
    });
    assert.deepEqual(
      byName.map((t) => t.id),
      ["1", "2"],
    );
    assert.deepEqual(
      sampleTokens.map((t) => t.id),
      copyBefore,
    );

    const byLastUsedDesc = sortTokensList(sampleTokens, {
      field: "lastUsed",
      direction: "desc",
    });
    assert.deepEqual(
      byLastUsedDesc.map((t) => t.id),
      ["1", "2"],
    );

    const byServerDesc = sortTokensList(sampleTokens, {
      field: "server",
      direction: "desc",
    });
    assert.deepEqual(
      byServerDesc.map((t) => t.id),
      ["2", "1"],
    );
  });

  test("toggles direction on same field and resets to asc on new field", () => {
    const next1 = getNextSortConfig(
      { field: "createdAt", direction: "asc" },
      "createdAt",
    );
    assert.deepEqual(next1, { field: "createdAt", direction: "desc" });
    assert.equal(getSortIndicator(next1, "createdAt"), "↓");
    assert.equal(getSortIndicator(next1, "name"), null);

    const next2 = getNextSortConfig(next1, "name");
    assert.deepEqual(next2, { field: "name", direction: "asc" });
    assert.equal(getSortIndicator(next2, "name"), "↑");
  });
});

describe("activity schedule helpers", () => {
  test("baoku is closed on Monday/Tuesday and open Wednesday-Sunday", () => {
    assert.equal(isBaokuActivityOpen(new Date("2026-03-02T12:00:00")), false); // Monday
    assert.equal(isBaokuActivityOpen(new Date("2026-03-03T12:00:00")), false); // Tuesday
    assert.equal(isBaokuActivityOpen(new Date("2026-03-04T12:00:00")), true); // Wednesday
    assert.equal(isBaokuActivityOpen(new Date("2026-03-01T12:00:00")), true); // Sunday
  });

  test("arena opens 06:00-21:59", () => {
    assert.equal(isArenaActivityOpen(new Date("2026-03-01T05:59:00")), false);
    assert.equal(isArenaActivityOpen(new Date("2026-03-01T06:00:00")), true);
    assert.equal(isArenaActivityOpen(new Date("2026-03-01T21:59:00")), true);
    assert.equal(isArenaActivityOpen(new Date("2026-03-01T22:00:00")), false);
  });

  test("activity week cycles 黑市周 -> 招募周 -> 宝箱周 starting 2025-12-12 12:00", () => {
    assert.equal(getCurrentActivityWeek(new Date("2025-12-12T11:59:59")), null);
    assert.equal(
      getCurrentActivityWeek(new Date("2025-12-12T12:00:00")),
      "黑市周",
    );
    assert.equal(
      getCurrentActivityWeek(new Date("2025-12-19T12:00:00")),
      "招募周",
    );
    assert.equal(
      getCurrentActivityWeek(new Date("2025-12-26T12:00:00")),
      "宝箱周",
    );
    assert.equal(
      getCurrentActivityWeek(new Date("2026-01-02T12:00:00")),
      "黑市周",
    );
  });

  test("weird tower opens only during 黑市周 and after 12:00 on Fridays", () => {
    assert.equal(
      isWeirdTowerActivityOpen(new Date("2025-12-12T11:59:59")),
      false,
    );
    assert.equal(
      isWeirdTowerActivityOpen(new Date("2025-12-12T12:00:00")),
      true,
    );
    assert.equal(
      isWeirdTowerActivityOpen(new Date("2026-01-02T11:30:00")),
      false,
    ); // Friday 11:30 in 黑市周 (before cycle reset to 黑市周 at 12:00 anyway)
    assert.equal(
      isWeirdTowerActivityOpen(new Date("2026-01-03T10:00:00")),
      true,
    ); // Saturday in 黑市周
    assert.equal(
      isWeirdTowerActivityOpen(new Date("2025-12-20T10:00:00")),
      false,
    ); // 招募周
  });

  test("fourth sunday and war guess schedule preserve March 2026 special rules", () => {
    const march2026 = getFourthSundayOfMonth(new Date("2026-03-10T10:00:00"));
    assert.equal(march2026.getFullYear(), 2026);
    assert.equal(march2026.getMonth(), 2);
    assert.equal(march2026.getDate(), 29);

    assert.equal(isWarGuessActivityOpen(new Date("2026-03-01T19:55:00")), true);
    assert.equal(
      isWarGuessActivityOpen(new Date("2026-03-01T19:56:00")),
      false,
    );
    assert.equal(isWarGuessActivityOpen(new Date("2026-03-29T18:00:00")), true);
    assert.equal(
      isWarGuessActivityOpen(new Date("2026-03-29T19:56:00")),
      false,
    );
    assert.equal(getWarGuessActivityTip(new Date("2026-03-29T18:00:00")), "");
    assert.equal(
      getWarGuessActivityTip(new Date("2026-03-29T20:00:00")),
      "月赛助威仅在每月第四个周日 (3月29日) 00:00-19:55 开放",
    );
  });
});

describe("formatPower", () => {
  test("formats zero, raw numbers, 万, and 亿 consistently", () => {
    assert.equal(formatPower(0), "0");
    assert.equal(formatPower(null), "0");
    assert.equal(formatPower(9500), "9500");
    assert.equal(formatPower(123456), "12.35万");
    assert.equal(formatPower(250000000), "2.50亿");
  });
});
