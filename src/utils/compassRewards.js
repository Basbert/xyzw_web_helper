const ITEM_NAMES = Object.freeze({
  1020: "皮肤币",
  1022: "白玉",
  1023: "彩玉",
  1033: "贝壳",
  10002: "蓝玉",
  10003: "红玉",
  10101: "四圣碎片",
});

/** Format a server reward without assigning item names to other resource types. */
export function formatCompassReward(reward) {
  const id = reward.itemId ?? reward.id;
  const type = reward.type;
  const amount = reward.value ?? reward.count ?? reward.num;
  const name =
    reward.name ||
    (Number(type) === 3 ? ITEM_NAMES[id] : undefined) ||
    (id != null && id !== 0 ? `道具 ID ${id}` : `奖励类型 ${type ?? "未知"}`);
  const typeLabel =
    type != null && id != null && id !== 0 ? `（类型 ${type}）` : "";
  return `${name}${typeLabel} × ${amount ?? "数量未知"}`;
}
