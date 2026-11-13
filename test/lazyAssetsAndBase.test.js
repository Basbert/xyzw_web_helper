import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

test("isInCurrentWeek enforces Monday 00:00 week boundaries without moment", async () => {
  const { isInCurrentWeek } = await loadModule(
    new URL("../src/utils/base.ts", import.meta.url),
    { "./helperTaskRunner.js": { sleep: async () => {} } },
  );

  // Wednesday 2026-11-11 12:00:00 local time
  const wednesdayNoon = new Date(2026, 10, 11, 12, 0, 0, 0);
  // Sunday 2026-11-15 23:59:59.999 local time
  const sundayLate = new Date(2026, 10, 15, 23, 59, 59, 999);

  const mondayStart = new Date(2026, 10, 9, 0, 0, 0, 0).getTime();
  const prevSundayEnd = new Date(2026, 10, 8, 23, 59, 59, 999).getTime();
  const currentSundayEnd = new Date(2026, 10, 15, 23, 59, 59, 999).getTime();
  const nextMondayStart = new Date(2026, 10, 16, 0, 0, 0, 0).getTime();

  for (const now of [wednesdayNoon, sundayLate]) {
    assert.equal(isInCurrentWeek(mondayStart, now), true);
    assert.equal(isInCurrentWeek(currentSundayEnd, now), true);
    assert.equal(isInCurrentWeek(prevSundayEnd, now), false);
    assert.equal(isInCurrentWeek(nextMondayStart, now), false);
  }
  assert.equal(isInCurrentWeek(Number.NaN, wednesdayNoon), false);
});

test("studyQuestionsFromJSON defers fetching answer.json until requested", async (t) => {
  const requests = [];
  let payload = [{ name: "测试题目", value: 2 }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => payload,
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const mod = await import("../src/utils/studyQuestionsFromJSON.js");

  assert.equal(requests.length, 0);
  assert.equal(await mod.findAnswer("测试题目"), 2);
  assert.equal(requests.length, 1);

  // Subsequent calls reuse the cached question bank.
  assert.equal(await mod.getQuestionCount(), 1);
  assert.equal(requests.length, 1);

  // clearCache forces a fresh fetch on next load.
  payload = [{ name: "新题目", value: 4 }];
  mod.clearCache();
  assert.equal(await mod.findAnswer("新题目"), 4);
  assert.equal(requests.length, 2);
});
