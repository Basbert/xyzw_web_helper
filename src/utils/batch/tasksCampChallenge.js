import {
  CAMP_ORDINARY_LIMITS,
  getCampSnapshot,
  makeCampTeam,
  prepareCampAttack,
  submitCampAttack,
} from "../campChallenge.js";
import { withManagedConnection } from "./connectionManager.js";

/**
 * 营地挑战类任务
 * 包含: batchCampChallenge, batchCampChallengePet, batchCampClaimTasks
 */

/**
 * 创建营地挑战类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksCampChallenge(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    loadSettings,
  } = deps;

  /**
   * 一键营地挑战
   */
  const batchCampChallenge = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((t) => t.id === tokenId);
      const name = token?.name || "角色";
      let count = 0;
      tokenStatus.value[tokenId] = "running";
      try {
        await withManagedConnection(
          {
            tokenId,
            tokenName: name,
            ensureConnection,
            releaseConnectionSlot,
            connectionQueue,
            batchSettings,
            tokenStore,
            shouldStop,
            addLog,
          },
          async ({ check }) => {
            const checkActive = () => {
              check();
            };
            checkActive();
            const data = await tokenStore.sendMessageWithPromise(
              tokenId,
              "club_getinfo",
              {},
              8000,
            );
            let snapshot = getCampSnapshot(data);
            if (!snapshot.canAttack) throw new Error(snapshot.reason);
            const targets = snapshot.targets.filter((item) => !item.defeated);
            // 保持原有的随机选人、每轮最多 3 次，不购买额外次数。
            for (let i = targets.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [targets[i], targets[j]] = [targets[j], targets[i]];
            }
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${name} 使用当前主线阵容、玩具和宠物，随机挑战今日对手`,
              type: "info",
            });
            for (const target of targets) {
              checkActive();
              if (
                count >= 3 ||
                snapshot.attempts >= CAMP_ORDINARY_LIMITS.attempts ||
                snapshot.wins >= CAMP_ORDINARY_LIMITS.wins
              )
                break;
              const preview = await prepareCampAttack({
                tokenStore,
                tokenId,
                target,
                checkActive,
              });
              // 在前一次战况和确认预览之间，其他操作可能已达到普通上限。
              if (
                preview.snapshot.attempts >= CAMP_ORDINARY_LIMITS.attempts ||
                preview.snapshot.wins >= CAMP_ORDINARY_LIMITS.wins
              )
                break;
              let result;
              try {
                result = await submitCampAttack({
                  tokenStore,
                  preview,
                  checkActive,
                  limits: CAMP_ORDINARY_LIMITS,
                });
              } catch (error) {
                if (error?.code !== "CAMP_ORDINARY_LIMIT_REACHED") throw error;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${name} ${error.message}`,
                  type: "info",
                });
                break;
              }
              count++;
              const outcome =
                result.outcome === "win"
                  ? "胜利"
                  : result.outcome === "loss"
                    ? "失败"
                    : "结果未返回";
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${name} 挑战 ${target.name}：${outcome}`,
                type: result.outcome === "win" ? "success" : "warning",
              });
              if (result.outcome === "unknown" || !result.refreshed) {
                throw new Error(
                  "战报或新战况未确认，已停止后续挑战，请先刷新核对",
                );
              }
              snapshot = getCampSnapshot(result.refreshed);
              if (!snapshot.canAttack) break;
            }
            tokenStatus.value[tokenId] = "completed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${name} 本轮完成 ${count} 次挑战；达到普通上限时停止`,
              type: "info",
            });
          },
        );
      } catch (error) {
        tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${name} 营地挑战${error.interrupted ? "已停止" : `未完成：${error.message || "未知错误"}`}`,
          type: error.interrupted ? "warning" : "error",
        });
      }
    });
    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (shouldStop.value) {
      message.warning("批量营地挑战已停止");
      return;
    }
    if (
      selectedTokens.value.some(
        (id) =>
          tokenStatus.value[id] === "failed" ||
          tokenStatus.value[id] === "stopped",
      )
    ) {
      message.warning("部分角色挑战未完成，请查看日志并核对战况");
      return;
    }
    message.success("批量营地挑战结束");
    if (!shouldStop.value) {
      await batchCampClaimTasks();
    }
  };

  /**
   * 一键营地挑战宠物
   */
  const batchCampChallengePet = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const failedTokens = new Set();
    const stoppedTokens = new Set();
    const maxRounds = 3;
    for (let round = 1; round <= maxRounds; round++) {
      if (shouldStop.value) break;

      const taskPromises = selectedTokens.value.map(async (tokenId) => {
        if (
          shouldStop.value ||
          failedTokens.has(tokenId) ||
          stoppedTokens.has(tokenId)
        ) {
          return;
        }
        tokenStatus.value[tokenId] = "running";
        const token = tokens.value.find((t) => t.id === tokenId);
        if (!token) {
          failedTokens.add(tokenId);
          tokenStatus.value[tokenId] = "failed";
          return;
        }
        try {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 营地挑战宠物 ${token.name} (第${round}/${maxRounds}轮) ===`,
            type: "info",
          });
          await withManagedConnection(
            {
              tokenId,
              tokenName: token.name,
              ensureConnection,
              releaseConnectionSlot,
              connectionQueue,
              batchSettings,
              tokenStore,
              shouldStop,
              addLog,
            },
            async ({ check }) => {
              check();

              // 获取我方阵容配置
              const [presetTeamResult, roleInfoResult] = await Promise.all([
                tokenStore.sendMessageWithPromise(
                  tokenId,
                  "presetteam_getinfo",
                  {},
                  5000,
                ),
                tokenStore.sendMessageWithPromise(
                  tokenId,
                  "role_getroleinfo",
                  {},
                  15000,
                ),
              ]);

              const lordWeaponId = roleInfoResult?.role?.lordWeaponId || 0;

              // 解析阵容数据，优先使用竞技场阵容
              const tokenSettings = loadSettings ? loadSettings(tokenId) : {};
              if (!tokenSettings)
                throw new Error("账号设置损坏或冲突，请核对后重试");
              const formationId = String(tokenSettings?.arenaFormation || 1);
              const root =
                presetTeamResult?.presetTeamInfo?.presetTeamInfo ||
                presetTeamResult?.presetTeamInfo ||
                {};
              const teamInfoData =
                root[formationId]?.teamInfo || root["1"]?.teamInfo || {};

              const battleTeam = {};
              for (const [pos, hero] of Object.entries(teamInfoData)) {
                const hid = hero?.heroId ?? hero?.id;
                if (hid) {
                  battleTeam[pos] = Number(hid);
                }
              }

              if (Object.keys(battleTeam).length === 0) {
                throw new Error(`无法获取阵容${formationId}数据`);
              }

              const { petUId } = makeCampTeam(roleInfoResult?.role);
              const teamSetParams = {
                lordWeaponId,
                petUId,
                battleTeam,
              };

              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 使用阵容${formationId}: ${Object.values(battleTeam).join(", ")}`,
                type: "info",
              });

              check();
              // 网络超时无法判断是否消耗次数，不能自动进入下一轮。
              let attackRes;
              try {
                attackRes = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "club_attackmonster",
                  { useItem: false, teamSetParams },
                  8000,
                );
              } catch (error) {
                if (error?.interrupted) throw error;
                failedTokens.add(tokenId);
                throw new Error("宠物挑战结果未确认，已停止后续轮次", {
                  cause: error,
                });
              }

              const battleResult = attackRes?.battleData?.result?.isWin;
              const outcome =
                battleResult === true
                  ? "胜利"
                  : battleResult === false
                    ? "失败"
                    : "结果未返回";
              const rewardCount = attackRes?.reward?.length || 0;

              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 挑战宠物${outcome}${rewardCount > 0 ? ` (获得${rewardCount}个奖励)` : ""}`,
                type: battleResult === true ? "success" : "warning",
              });

              check();
              if (typeof battleResult !== "boolean") {
                failedTokens.add(tokenId);
                throw new Error("宠物挑战结果未确认，已停止后续轮次");
              }
              tokenStatus.value[tokenId] = "completed";
            },
          );
        } catch (error) {
          if (error?.interrupted) {
            stoppedTokens.add(tokenId);
            tokenStatus.value[tokenId] = "stopped";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 营地挑战宠物已停止`,
              type: "warning",
            });
          } else {
            failedTokens.add(tokenId);
            console.error(error);
            tokenStatus.value[tokenId] = "failed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 营地挑战宠物失败: ${error.message || "未知错误"}`,
              type: "error",
            });
          }
        }
      });

      await Promise.all(taskPromises);
    }

    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (shouldStop.value) {
      message.warning("批量营地挑战宠物已停止");
      return;
    }
    if (
      failedTokens.size > 0 ||
      stoppedTokens.size > 0 ||
      selectedTokens.value.some(
        (id) =>
          tokenStatus.value[id] === "failed" ||
          tokenStatus.value[id] === "stopped",
      )
    ) {
      message.warning("部分角色挑战宠物未完成，请查看日志并核对战况");
      return;
    }
    message.success("批量营地挑战宠物结束");
    if (!shouldStop.value) {
      await batchCampClaimTasks();
    }
  };

  /**
   * 领取营地挑战任务奖励
   * 通过 role_getroleinfo 获取 siege.taskProgress 和 siege.taskClaimedMap
   * taskProgress: 1/2/3 是3个区域(值为1可领取), 4是挑战3次(值>=3可领取)
   * taskClaimedMap 中已有的 key 表示已领取
   */
  const batchCampClaimTasks = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        tokenStatus.value[tokenId] = "failed";
        return;
      }
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取营地任务奖励: ${token.name} ===`,
          type: "info",
        });
        await withManagedConnection(
          {
            tokenId,
            tokenName: token.name,
            ensureConnection,
            releaseConnectionSlot,
            connectionQueue,
            batchSettings,
            tokenStore,
            shouldStop,
            addLog,
          },
          async ({ check }) => {
            check();

            await tokenStore.sendMessageWithPromise(
              tokenId,
              "club_getinfo",
              {},
              15000,
            );

            let claimedCount = 0;
            for (const confId of [1, 2, 3, 4]) {
              if (shouldStop.value) break;
              try {
                check();
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "club_taskclaim",
                  { confId },
                  5000,
                );
                claimedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 成功领取任务 ${confId} 奖励`,
                  type: "success",
                });
              } catch (err) {
                if (err?.interrupted) throw err;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取任务 ${confId} 失败: ${err.message || "未知错误"}`,
                  type: "error",
                });
              }
            }

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 营地任务奖励领取完成，共领取 ${claimedCount} 个`,
              type: "info",
            });

            tokenStatus.value[tokenId] = "completed";
          },
        );
      } catch (error) {
        if (error?.interrupted) {
          tokenStatus.value[tokenId] = "stopped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 领取营地任务奖励已停止`,
            type: "warning",
          });
        } else {
          console.error(error);
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 领取营地任务奖励失败: ${error.message || "未知错误"}`,
            type: "error",
          });
        }
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取营地任务奖励结束");
  };

  return {
    batchCampChallenge,
    batchCampChallengePet,
    batchCampClaimTasks,
  };
}
