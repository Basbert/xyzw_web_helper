import assert from "node:assert/strict";
import test from "node:test";
import { formatCompassReward } from "../src/utils/compassRewards.js";

test("星级罗盘物品使用游戏中已有的名称", () => {
  for (const [itemId, name] of [
    [1033, "贝壳"],
    [10002, "蓝玉"],
    [10003, "红玉"],
    [10101, "四圣碎片"],
  ]) {
    assert.equal(
      formatCompassReward({ type: 3, itemId, value: 2 }),
      `${name}（类型 3） × 2`,
    );
  }
});

test("未知物品和其他资源类型保留 ID，避免错误命名", () => {
  assert.equal(
    formatCompassReward({ type: 3, itemId: 99999, value: 1 }),
    "道具 ID 99999（类型 3） × 1",
  );
  assert.equal(
    formatCompassReward({ type: 1, itemId: 10002, value: 1 }),
    "道具 ID 10002（类型 1） × 1",
  );
});
