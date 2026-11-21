const pickArenaTargetId = (targets) => {
  if (!targets) return null;

  // Handle if targets is an array directly
  if (Array.isArray(targets)) {
    const candidate = targets[0];
    return candidate?.roleId || candidate?.id || candidate?.targetId;
  }

  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];

  if (candidate) {
    if (candidate.roleId) return candidate.roleId;
    if (candidate.id) return candidate.id;
    if (candidate.targetId) return candidate.targetId;
  }

  return targets?.roleId || targets?.id || targets?.targetId;
};

/** Plan the daily arena sequence with the caller's connection and formation guard. */
export function dailyArenaTask({
  getCurrentHour,
  log,
  refreshRole,
  goalReached,
  switchFormation,
  execute,
  sleep,
}) {
  return {
    name: "竞技场战斗",
    condition: 13,
    execute: async () => {
      log("开始竞技场战斗流程");
      const hour = getCurrentHour();
      if (hour < 6) {
        log("当前时间未到6点，跳过竞技场战斗", "warning");
        return false;
      }
      if (hour >= 22) {
        log("当前时间已到22点，跳过竞技场战斗", "warning");
        return false;
      }

      // Recheck immediately before entering: other game sessions may have
      // completed the one-fight daily goal since this run was planned.
      await refreshRole();
      if (goalReached()) {
        log(
          "竞技场每日任务已完成，无法确认剩余免费次数，跳过额外挑战",
          "warning",
        );
        return false;
      }

      await switchFormation();
      await execute("arena_startarea", {}, "开始竞技场");

      // The daily goal requires one fight; it is not the free-fight limit.
      // Only start this three-fight sequence while that goal is still pending.
      const arenaAttempts = 3;
      for (let i = 1; i <= arenaAttempts; i++) {
        log(`竞技场战斗 ${i}/${arenaAttempts}`);
        const targets = await execute(
          "arena_getareatarget",
          {},
          `获取竞技场目标${i}`,
        );

        const targetId = pickArenaTargetId(targets);
        if (targetId) {
          await execute(
            "fight_startareaarena",
            { targetId },
            `竞技场战斗${i}`,
            10000,
          );
        } else {
          log(
            `竞技场战斗${i} - 未找到目标: ${JSON.stringify(targets)}`,
            "warning",
          );
          return false;
        }
        await sleep(1000);
      }
    },
  };
}
