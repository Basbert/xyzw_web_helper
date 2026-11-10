import assert from "node:assert/strict";
import test from "node:test";
import { isDungeonOpen } from "../src/utils/dreamConstants.js";

test("梦境开放日按北京时间判断，包含跨日边界", () => {
  const cases = [
    ["2026-11-07T15:59:59Z", false], // Saturday 23:59:59 China time
    ["2026-11-07T16:00:00Z", true], // Sunday 00:00 China time
    ["2026-11-09T15:59:59Z", true], // Monday 23:59:59
    ["2026-11-09T16:00:00Z", false], // Tuesday 00:00
    ["2026-11-10T16:00:00Z", true], // Wednesday 00:00
    ["2026-11-12T16:00:00Z", false], // Friday 00:00
  ];
  for (const [instant, expected] of cases)
    assert.equal(isDungeonOpen(Date.parse(instant)), expected, instant);
});
