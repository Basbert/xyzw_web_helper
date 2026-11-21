import { normalizeRoleId } from "../accountIdentity.js";

const shanghaiDay = (seconds) => Math.floor((seconds + 28800) / 86400);

export function dailyDreamTasks({
  role,
  tokenId,
  weekday,
  execute,
  purchase,
  readRole,
  onChecked,
  checkActive,
  sleep,
  log,
}) {
  if (![0, 1, 3, 4].includes(weekday)) return [];

  const taskDay = role.dailyTask.dailyTime;
  const roleId = normalizeRoleId(role.roleId);
  const began = Number(role.dungeon?.beginTime);
  const daysSinceStart = shanghaiDay(taskDay) - shanghaiDay(began);
  let finished =
    Number.isInteger(role.dungeon?.id) &&
    role.dungeon.id < 0 &&
    Number.isFinite(began) &&
    began > 0 &&
    daysSinceStart >= 0 &&
    daysSinceStart < 2;
  const tasks = [
    {
      name: "咸王梦境",
      execute: async () => {
        if (finished) {
          log("服务器显示本期梦境已完成，直接检查商店");
          return true;
        }
        const response = await execute(
          "dungeon_selecthero",
          { battleTeam: { 0: 107 } },
          "咸王梦境",
        );
        finished = true;
        return response;
      },
    },
  ];

  if (purchase)
    tasks.push({
      name: "购买梦境金币商品和高级商人黄金鱼竿",
      execute: async () => {
        if (!finished) {
          log("梦境步骤未成功，跳过梦境商店购买", "warning");
          return false;
        }
        checkActive();
        const result = await purchase({ checkActive, sleep, log });
        if (result?.message) log(result.message);
        if (result?.status !== "completed") return false;
        if (
          onChecked &&
          roleId &&
          Number.isSafeInteger(taskDay) &&
          taskDay > 0
        ) {
          let verified;
          try {
            // Role info has a separate request limit from shop purchases.
            await sleep(1000);
            verified = await readRole();
          } catch (error) {
            if (error.interrupted) throw error;
            log("商店已检查，但未能核对今日状态", "warning");
          }
          const verifiedId = normalizeRoleId(verified?.roleId);
          if (verifiedId && verifiedId !== roleId) {
            const error = new Error("服务器角色已变化，请重新连接后再继续");
            error.interrupted = true;
            throw error;
          }
          if (
            verifiedId === roleId &&
            verified?.dailyTask?.dailyTime === taskDay
          ) {
            checkActive();
            try {
              await onChecked({ tokenId, roleId, taskDay });
            } catch {
              log("商店已检查，但提醒状态未能保存", "warning");
            }
          } else if (verified) {
            log("商店已检查，但身份或日期未能核对", "warning");
          }
        }
        return true;
      },
    });
  return tasks;
}
