const ITEM_NAMES = Object.freeze({
  1020: "皮肤币",
  1022: "白玉",
  1023: "彩玉",
  1033: "贝壳",
  10002: "蓝玉",
  10003: "红玉",
  10101: "四圣碎片",
});

const amountOf = (reward) => reward?.value ?? reward?.count ?? reward?.num;
function safeWhole(value) {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : null;
  }
  return null;
}

function amountText(value) {
  if (value === null || value === undefined || value === "") return "数量未知";
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    if (!Number.isFinite(value)) return "数量未知";
    return Math.abs(value) > Number.MAX_SAFE_INTEGER
      ? `数量超出安全范围（原始值：${value}）`
      : `数量无法安全合计（原始值：${value}）`;
  }
  if (["number", "string", "bigint"].includes(typeof value))
    return String(value);
  return "数量未知";
}

/** Known item names need no type suffix; unknown IDs retain their type. */
export function formatCompassReward(reward, amount = amountOf(reward)) {
  const id = reward?.itemId ?? reward?.id;
  const type = reward?.type;
  const typeId = safeWhole(type);
  const itemId = safeWhole(id);
  const knownName =
    typeId === 3 && itemId !== null && Object.hasOwn(ITEM_NAMES, itemId)
      ? ITEM_NAMES[itemId]
      : "";
  const name =
    knownName ||
    (typeof reward?.name === "string" && reward.name.trim() ? reward.name : "");
  const label =
    name ||
    (id != null && id !== 0 ? `道具 ID ${id}` : `奖励类型 ${type ?? "未知"}`);
  const typeLabel =
    !name && type != null && id != null && id !== 0 ? `（类型 ${type}）` : "";
  return `${label}${typeLabel} × ${amountText(amount)}`;
}

/** Aggregate only identical, valid type/ID pairs with safely summable amounts. */
export function summarizeCompassRewards(rewards) {
  const buckets = new Map();
  const separate = [];
  for (const [index, reward] of (Array.isArray(rewards)
    ? rewards
    : []
  ).entries()) {
    const type = safeWhole(reward?.type);
    const id = safeWhole(reward?.itemId ?? reward?.id);
    const amount = safeWhole(amountOf(reward));
    const entry = { reward, amount, index };
    if (type === null || id === null || id === 0 || amount === null) {
      separate.push(entry);
      continue;
    }
    const key = `${type}:${id}`;
    const bucket = buckets.get(key) || [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  const rows = [];
  for (const bucket of buckets.values()) {
    let total = 0;
    for (const entry of bucket) {
      total += entry.amount;
      if (!Number.isSafeInteger(total)) break;
    }
    if (!Number.isSafeInteger(total)) {
      separate.push(...bucket);
      continue;
    }
    rows.push({
      index: bucket[0].index,
      amount: total,
      text: formatCompassReward(bucket[0].reward, total),
      originals: bucket.map((entry) => entry.reward),
    });
  }
  rows.push(
    ...separate.map(({ reward, amount, index }) => ({
      index,
      amount,
      text: formatCompassReward(reward),
      originals: [reward],
    })),
  );
  return rows.sort((a, b) => {
    if (a.amount === null && b.amount !== null) return 1;
    if (a.amount !== null && b.amount === null) return -1;
    return (b.amount ?? 0) - (a.amount ?? 0) || a.index - b.index;
  });
}

const KIND_NAMES = {
  chaos: "混沌罗盘",
  white: "白色星级罗盘",
  green: "绿色星级罗盘",
  blue: "蓝色星级罗盘",
};

/**
 * Each star response is one draw. For chaos, only pair config IDs and rewards
 * when they correspond one-to-one; otherwise keep the response as one batch.
 */
export function describeCompassRewardBatches(
  batches,
  expectedRewardCount = null,
) {
  const details = [];
  let confirmedDraws = 0;
  let countKnown = true;
  let recordedRewards = 0;
  for (const [index, batch] of (Array.isArray(batches)
    ? batches
    : []
  ).entries()) {
    const rewards = Array.isArray(batch?.rewards) ? batch.rewards : [];
    recordedRewards += rewards.length;
    const ids = batch?.confIdList;
    const validIds =
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => safeWhole(id) !== null && safeWhole(id) > 0);
    const star = ["white", "green", "blue"].includes(batch?.kind);
    const match =
      star ||
      (batch?.kind === "chaos" && validIds && ids.length === rewards.length);
    const label = KIND_NAMES[batch?.kind] || "罗盘";
    if (!match) {
      countKnown = false;
      details.push({
        label: `${label} · 第 ${index + 1} 批（抽取次数未确认）`,
        rewards,
      });
    } else {
      const draws = star ? 1 : ids.length;
      confirmedDraws += draws;
      const drawLabel = (drawIndex) =>
        `${label} · 第 ${index + 1} 批 · 本批第 ${drawIndex + 1} 次`;
      if (draws === 1) {
        details.push({
          label: drawLabel(0),
          rewards,
        });
      } else {
        ids.forEach((_, drawIndex) =>
          details.push({
            label: drawLabel(drawIndex),
            rewards: [rewards[drawIndex]],
          }),
        );
      }
    }
  }
  const incomplete =
    expectedRewardCount !== null && recordedRewards !== expectedRewardCount;
  return {
    details,
    incomplete,
    confirmedDraws: countKnown && !incomplete ? confirmedDraws : null,
  };
}
