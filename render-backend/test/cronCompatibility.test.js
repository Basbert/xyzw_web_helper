/* eslint-disable test/no-import-node-test -- Standalone backend uses Node's built-in test runner. */
import assert from "node:assert/strict";
import test from "node:test";
import cron from "node-cron";

test("backend cron accepts existing expressions and schedules using Shanghai time", () => {
  assert.equal(cron.validate("0 8 * * *"), true);
  assert.equal(cron.validate("0 12 * * *"), true);
  assert.equal(cron.validate("99 * * * *"), false);
  assert.equal(cron.validate("invalid"), false);

  // Check wall-clock matching for a known instant without waiting for 08:00.
  const task = cron.schedule("0 8 * * *", () => {}, {
    timezone: "Asia/Shanghai",
  });
  try {
    assert.equal(task.options.timezone, "Asia/Shanghai");
    assert.match(
      task.options.name,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(
      task._scheduler.timeMatcher.match(new Date("2026-01-01T00:00:00.000Z")),
      true,
    );
    assert.equal(
      task._scheduler.timeMatcher.match(new Date("2026-01-01T08:00:00.000Z")),
      false,
    );
  } finally {
    task.stop();
  }
});

test("backend-style stop cancels subsequent scheduled callbacks", async () => {
  let calls = 0;
  let task;
  let timeout;
  try {
    await new Promise((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("cron callback timed out")),
        5000,
      );
      task = cron.schedule(
        "* * * * * *",
        () => {
          calls++;
          resolve();
        },
        { timezone: "Asia/Shanghai" },
      );
    });
    clearTimeout(timeout);
    // The backend stops jobs from its control path, outside the callback.
    task.stop();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(calls, 1);
  } finally {
    clearTimeout(timeout);
    task?.stop();
  }
});
