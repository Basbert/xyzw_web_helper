import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCompassRewardBatches,
  formatCompassReward,
  summarizeCompassRewards,
} from "../src/utils/compassRewards.js";

test("已识别的奖励用简洁物品名，未知物品保留类型和 ID", () => {
  for (const [itemId, name] of [
    [1020, "皮肤币"],
    [1022, "白玉"],
    [1023, "彩玉"],
    [1033, "贝壳"],
    [10002, "蓝玉"],
    [10003, "红玉"],
    [10101, "四圣碎片"],
  ]) {
    assert.equal(
      formatCompassReward({ type: 3, itemId, value: 2 }),
      `${name} × 2`,
    );
  }
  assert.equal(
    formatCompassReward({ type: 3, itemId: 99999, value: 1 }),
    "道具 ID 99999（类型 3） × 1",
  );
  assert.equal(
    formatCompassReward({ type: 1, itemId: 10002, value: 1 }),
    "道具 ID 10002（类型 1） × 1",
  );
});

test("按真实类型和 ID 聚合，数量由大到小，并保留原始记录", () => {
  const raw = [
    { type: 3, itemId: 10002, value: 2 },
    { type: 3, itemId: 1023, value: 9 },
    { type: "3", itemId: "10002", value: "4" },
    { type: 1, itemId: 10002, value: 8 },
  ];
  const rows = summarizeCompassRewards(raw);
  assert.deepEqual(
    rows.map((row) => row.text),
    ["彩玉 × 9", "道具 ID 10002（类型 1） × 8", "蓝玉 × 6"],
  );
  assert.deepEqual(rows[2].originals, [raw[0], raw[2]]);
  assert.equal(rows[2].originals[0], raw[0]);
  assert.deepEqual(raw[0], { type: 3, itemId: 10002, value: 2 });
});

test("未知类型、未知数量和不安全数值分别展示，不错误合并", () => {
  const huge = "9007199254740993";
  const raw = [
    { itemId: 10002, value: 2 },
    { itemId: 10002, value: 3 },
    { type: 3, itemId: 1023 },
    { type: 3, itemId: 1023 },
    { type: 3, itemId: 1033, value: huge },
    { type: 3, itemId: 1033, value: 1 },
  ];
  const rows = summarizeCompassRewards(raw);
  assert.equal(rows.length, raw.length);
  assert.ok(rows.some((row) => row.text === `贝壳 × ${huge}`));
  assert.equal(rows.filter((row) => row.text === "彩玉 × 数量未知").length, 2);
  assert.equal(rows.flatMap((row) => row.originals).length, raw.length);
});

test("相同物品的合计超出安全范围时保留每条原始数量", () => {
  const raw = [
    { type: 3, itemId: 1022, value: Number.MAX_SAFE_INTEGER },
    { type: 3, itemId: 1022, value: 2 },
  ];
  const rows = summarizeCompassRewards(raw);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.amount),
    [Number.MAX_SAFE_INTEGER, 2],
  );
  assert.match(
    formatCompassReward({
      type: 3,
      itemId: 1022,
      value: Number.MAX_SAFE_INTEGER + 1,
    }),
    /数量超出安全范围/,
  );
});

test("星级每个回包为一次，混沌一一对应时可逐次展示", () => {
  const a = { type: 3, itemId: 10002, value: 1 };
  const b = { type: 3, itemId: 1023, value: 3 };
  const batches = [
    { kind: "white", rewards: [a, b] },
    { kind: "chaos", rewards: [a, b], confIdList: [11, 12] },
  ];
  const view = describeCompassRewardBatches(batches);
  assert.equal(view.confirmedDraws, 3);
  assert.equal(view.details.length, 3);
  assert.deepEqual(view.details[0].rewards, [a, b]);
  assert.deepEqual(view.details[1].rewards, [a]);
  assert.deepEqual(view.details[2].rewards, [b]);
  assert.equal(batches[1].rewards[0], a);
});

test("混沌数量无法对应时保留整个回包，不猜次数", () => {
  const rewards = [
    { type: 3, itemId: 10002, value: 1 },
    { type: 3, itemId: 1023, value: 3 },
  ];
  for (const confIdList of [undefined, [1], [1, 2, 3], [1, null]]) {
    const result = describeCompassRewardBatches([
      { kind: "chaos", rewards, confIdList },
    ]);
    assert.equal(result.confirmedDraws, null);
    assert.equal(result.details.length, 1);
    assert.match(result.details[0].label, /批（抽取次数未确认）/);
    assert.equal(result.details[0].rewards, rewards);
  }
});

test("奖励数量与记录批次不一致时不声称准确次数", () => {
  const batches = [
    { kind: "white", rewards: [{ type: 3, itemId: 1022, value: 1 }] },
  ];
  const view = describeCompassRewardBatches(batches, 2);
  assert.equal(view.incomplete, true);
  assert.equal(view.confirmedDraws, null);
  assert.equal(view.details.length, 1);
});
