/** Strictly decode the game's schedule -> team -> claimed map. */
function entriesOf(value) {
  if (value instanceof Map) return [...value.entries()];
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value);
  throw new Error("竞猜奖励状态格式异常，请刷新后重试");
}

function claimRecords(info) {
  if (!info || typeof info !== "object" || Array.isArray(info))
    throw new Error("无法读取逐鹿盐山角色信息");
  if (info.guessClaimMap == null)
    throw new Error("服务器未返回竞猜奖励状态，请刷新后重试");
  const records = [];
  const seen = new Set();
  for (const [rawSchedule, teams] of entriesOf(info.guessClaimMap)) {
    // The game uses underscore-prefixed map metadata, not schedule IDs.
    if (String(rawSchedule).startsWith("_")) continue;
    const raw = String(rawSchedule);
    if (!/^\d+$/.test(raw)) throw new Error("竞猜奖励赛程格式异常");
    const scheduleId = Number(raw);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0)
      throw new Error("竞猜奖励赛程格式异常");
    for (const [rawTeam, value] of entriesOf(teams)) {
      const teamId = String(rawTeam);
      if (teamId.startsWith("_")) continue;
      if (!teamId.trim() || teamId !== teamId.trim())
        throw new Error("竞猜奖励队伍格式异常");
      if (value !== false && value !== true && value !== 0 && value !== 1)
        throw new Error("竞猜奖励领取状态无法确认");
      const key = `${scheduleId}\u0000${teamId}`;
      if (seen.has(key)) throw new Error("竞猜奖励记录重复，无法确认");
      seen.add(key);
      records.push({
        scheduleId,
        teamId,
        claimed: value === true || value === 1,
      });
      if (records.length > 2048) throw new Error("竞猜奖励数据异常，已停止");
    }
  }
  return records;
}

/** Return only server-confirmed unclaimed entries; do not infer eligibility. */
export function parseApexClaimableRewards(info) {
  return claimRecords(info)
    .filter((record) => !record.claimed)
    .map(({ scheduleId, teamId }) => ({ scheduleId, teamId }));
}

/** Missing entries are unknown, rather than proof of successful claiming. */
export function apexRewardClaimState(info, target) {
  const record = claimRecords(info).find(
    (item) =>
      item.scheduleId === target.scheduleId && item.teamId === target.teamId,
  );
  return record ? (record.claimed ? "claimed" : "pending") : "unknown";
}
