/**
 * 竞技场、补齐类任务
 * 包含: batcharenafight, batchTopUpFish, batchTopUpArena
 */

import {
  restorePresetFormation,
  switchPresetFormation,
  withManagedConnection,
} from "./connectionManager.js";
import { ARENA_TARGET, FISH_TARGET } from "./constants.js";

/**
 * 创建竞技场、补齐类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksArena(deps) {
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
    currentSettings,
    pickArenaTargetId,
    isTodayAvailable,
    calculateMonthProgress,
    delayConfig,
    loadSettings,
  } = deps;

  const readProgress = (result, type) => {
    const activity = result?.activity || result?.body?.activity || result;
    const raw =
      type === "fish"
        ? activity?.myMonthInfo?.["2"]?.num
        : activity?.myArenaInfo?.num;
    if (
      raw === undefined ||
      raw === null ||
      (typeof raw !== "number" && typeof raw !== "string") ||
      (typeof raw === "string" && !raw.trim())
    ) {
      return null;
    }
    const count = Number(raw);
    return Number.isFinite(count) && count >= 0 ? count : null;
  };
  const readFishProgress = (result) => readProgress(result, "fish");
  const readArenaProgress = (result) => readProgress(result, "arena");

  /**
   * 一键竞技场战斗3次
   */
  const batcharenafight = async () => {
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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: "账号已不存在，跳过竞技场",
          type: "error",
        });
        return;
      }
      // 配置无法读取时停止，避免使用其他账号的设置。
      const tokenSettings = loadSettings
        ? loadSettings(tokenId)
        : currentSettings;
      if (!tokenSettings) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: "账号设置损坏或冲突，请核对后重试",
          type: "error",
        });
        return;
      }

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键竞技场战斗: ${token.name} ===`,
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
            logOnClose: true,
          },
          async ({ check, isConnectionIntact }) => {
            const formationState = {
              originalFormation: undefined,
              changed: false,
            };
            try {
              check();

              // 检查咸神门票 (ID: 1007)
              const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
              const role = roleInfo?.role;
              if (!role) throw new Error("未获取到当前账号的角色信息");
              const ticketCount = role?.items?.[1007]?.quantity || 0;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 当前咸神门票: ${ticketCount}`,
                type: "info",
              });

              if (ticketCount <= 0) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 咸神门票不足，无法进行竞技场战斗`,
                  type: "warning",
                });
                tokenStatus.value[tokenId] = "pending";
                return;
              }

              await switchPresetFormation({
                tokenStore,
                tokenId,
                check,
                targetFormation: tokenSettings.arenaFormation,
                addLog,
                errorMessage: "服务器未提供有效阵容，停止竞技场挑战",
                state: formationState,
              });
              check();

              const fights = Math.min(3, ticketCount);
              if (fights < 3) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 咸神门票仅剩 ${ticketCount} 张，将执行 ${fights} 次战斗`,
                  type: "warning",
                });
              }

              let completedFights = 0;
              for (let i = 0; i < fights; i++) {
                if (shouldStop.value) break;
                check();
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "arena_startarea",
                  {},
                );
                if (shouldStop.value) break;
                check();
                let targets;
                try {
                  targets = await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "arena_getareatarget",
                    {},
                  );
                } catch (err) {
                  if (err?.interrupted) throw err;
                  throw new Error(`获取竞技场目标失败：${err.message}`);
                }
                if (shouldStop.value) break;
                check();
                const targetId = pickArenaTargetId(targets);
                if (!targetId) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 未找到可用的竞技场目标`,
                    type: "error",
                  });
                  break;
                }
                try {
                  await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "fight_startareaarena",
                    { targetId },
                  );
                  completedFights++;
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 竞技场战斗 ${i + 1}/3`,
                    type: "info",
                  });
                  await new Promise((r) => setTimeout(r, delayConfig.battle));
                } catch (e) {
                  if (e?.interrupted) throw e;
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 竞技场对决失败: ${e.message || "未知错误"}`,
                    type: "error",
                  });
                  break;
                }
              }
              await new Promise((r) => setTimeout(r, delayConfig.battle));
              check();
              tokenStatus.value[tokenId] = shouldStop.value
                ? "stopped"
                : completedFights === 3
                  ? "completed"
                  : "pending";
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 竞技场本轮完成 ${completedFights}/3 场 ===`,
                type: completedFights === 3 ? "success" : "warning",
              });
            } finally {
              await restorePresetFormation({
                tokenStore,
                tokenId,
                tokenName: token.name,
                tokenStatus,
                addLog,
                state: formationState,
                isConnectionIntact,
              });
            }
          },
        );
      } catch (error) {
        if (error?.interrupted) {
          tokenStatus.value[tokenId] = "stopped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 一键竞技场战斗已停止`,
            type: "warning",
          });
        } else {
          console.error(error);
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 一键竞技场战斗失败: ${error.message || "未知错误"}`,
            type: "error",
          });
        }
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (
      selectedTokens.value.some((id) => tokenStatus.value[id] !== "completed")
    )
      message.warning("批量竞技场已结束，部分账号未完成，请查看日志");
    else message.success("批量竞技场战斗完成");
  };

  /**
   * 批量钓鱼补齐
   */
  const batchTopUpFish = async () => {
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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: "账号已不存在，跳过钓鱼补齐",
          type: "error",
        });
        return;
      }
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始钓鱼补齐: ${token.name} ===`,
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
            logOnClose: true,
          },
          async ({ check }) => {
            check();
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 获取月度任务进度...`,
              type: "info",
            });
            const result = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              10000,
            );
            check();
            const fishNum = readFishProgress(result);
            if (fishNum === null) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 未获取到有效钓鱼进度，请刷新后重试`,
                type: "warning",
              });
              tokenStatus.value[tokenId] = "pending";
              return;
            }

            const monthProgress = calculateMonthProgress();
            const now = new Date();
            const daysInMonth = new Date(
              now.getFullYear(),
              now.getMonth() + 1,
              0,
            ).getDate();
            const dayOfMonth = now.getDate();
            const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
            const shouldBe =
              remainingDays === 0
                ? FISH_TARGET
                : Math.min(FISH_TARGET, Math.ceil(monthProgress * FISH_TARGET));
            const need = Math.max(0, shouldBe - fishNum);
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 当前进度: ${fishNum}/${FISH_TARGET}，需要补齐: ${need}次`,
              type: "info",
            });
            if (need <= 0) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `当前进度已达标，无需补齐`,
                type: "success",
              });
              tokenStatus.value[tokenId] = "completed";
              return;
            }

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 开始执行钓鱼补齐...`,
              type: "info",
            });

            const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
            check();
            const role = roleInfo?.role;
            if (!role) throw new Error("未获取到当前账号的角色信息");
            let freeUsed = 0;
            let freeUncertain = false;
            const lastFreeTime = Number(
              role?.statisticsTime?.["artifact:normal:lottery:time"] || 0,
            );
            if (isTodayAvailable(lastFreeTime)) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 检测到今日免费钓鱼次数，开始消耗 3 次`,
                type: "info",
              });
              for (
                let i = 0;
                i < 3 && need > freeUsed && !shouldStop.value;
                i++
              ) {
                try {
                  check();
                  await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "artifact_lottery",
                    { lotteryNumber: 1, newFree: true, type: 1 },
                    8000,
                  );
                  freeUsed++;
                  await new Promise((r) => setTimeout(r, delayConfig.action));
                } catch (e) {
                  if (e?.interrupted) throw e;
                  freeUncertain = true;
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 免费钓鱼失败: ${e.message}`,
                    type: "error",
                  });
                  break;
                }
              }
            }

            check();
            if (freeUncertain) {
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "activity_get",
                  {},
                  10000,
                );
              } catch {
                // The free request may still have succeeded; do not spend rods.
              }
              check();
              tokenStatus.value[tokenId] = "pending";
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 免费钓鱼结果未确认，已停止付费钓鱼，请核对进度`,
                type: "warning",
              });
              return;
            }
            const updatedResult = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              10000,
            );
            check();
            const updatedFishNum = readFishProgress(updatedResult);
            if (updatedFishNum === null || updatedFishNum < fishNum) {
              tokenStatus.value[tokenId] = "pending";
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 刷新后的钓鱼进度无效，已停止付费钓鱼`,
                type: "warning",
              });
              return;
            }
            let remaining = Math.max(0, shouldBe - updatedFishNum);
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 免费次数后进度: ${updatedFishNum}/${FISH_TARGET}，还需补齐: ${remaining}次`,
              type: "info",
            });
            if (remaining <= 0) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `已通过免费次数完成目标`,
                type: "success",
              });
              tokenStatus.value[tokenId] = "completed";
              return;
            }

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 开始付费钓鱼补齐: 共需 ${remaining} 次（每次最多10）`,
              type: "info",
            });

            // 检查普通鱼竿 (ID: 1011)
            const rodCount = role?.items?.[1011]?.quantity || 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 当前普通鱼竿: ${rodCount}`,
              type: "info",
            });

            if (rodCount < remaining) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 普通鱼竿不足 (${rodCount} < ${remaining})，将仅使用现有鱼竿`,
                type: "warning",
              });
              remaining = rodCount;
            }

            let paidUncertain = false;
            while (remaining > 0 && !shouldStop.value) {
              check();
              const batch = Math.min(10, remaining);
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "artifact_lottery",
                  { lotteryNumber: batch, newFree: false, type: 1 },
                  12000,
                );
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 完成 ${batch} 次付费钓鱼`,
                  type: "info",
                });
                remaining -= batch;

                // 每钓鱼5轮（50次）后，重新获取角色信息，校验鱼竿数量
                if (remaining > 0 && batch >= 10 && remaining % 50 === 0) {
                  try {
                    const roleRes = await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "role_getroleinfo",
                      {},
                      5000,
                    );
                    const currentRole = roleRes?.role || roleRes?.data?.role;
                    if (currentRole) {
                      const currentRodCount =
                        currentRole.items?.[1011]?.quantity || 0;
                      if (currentRodCount < remaining) {
                        addLog({
                          time: new Date().toLocaleTimeString(),
                          message: `${token.name} 同步后发现鱼竿不足 (${currentRodCount} < ${remaining})，调整目标`,
                          type: "warning",
                        });
                        remaining = currentRodCount;
                      }
                    }
                  } catch (e) {
                    // ignore
                  }
                }

                await new Promise((r) => setTimeout(r, delayConfig.battle));
              } catch (e) {
                if (e?.interrupted) throw e;
                paidUncertain = true;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 付费钓鱼失败: ${e.message}`,
                  type: "error",
                });
                break;
              }
            }

            check();
            const finalResult = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              10000,
            );
            check();
            const finalFishNum = readFishProgress(finalResult);
            if (paidUncertain || finalFishNum === null) {
              tokenStatus.value[tokenId] = "pending";
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 钓鱼结果未完全确认，请核对进度和鱼竿`,
                type: "warning",
              });
              return;
            }
            if (finalFishNum >= shouldBe || finalFishNum >= FISH_TARGET) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 钓鱼补齐完成，最终进度: ${finalFishNum}/${FISH_TARGET}`,
                type: "success",
              });
            } else {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 钓鱼补齐已停止，未达到目标，最终进度: ${finalFishNum}/${FISH_TARGET}`,
                type: "warning",
              });
            }

            // 自动领取鱼竿累计奖励
            try {
              check();
              const roleRes = await tokenStore.sendMessageWithPromise(
                tokenId,
                "role_getroleinfo",
                {},
                5000,
              );
              const currentRole = roleRes?.role || roleRes?.data?.role;
              check();
              if (currentRole) {
                const points = currentRole.statistics?.["artifact:point"] || 0;
                const exchangeCount = Math.floor(points / 20);

                if (exchangeCount > 0) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 检测到鱼竿累计使用 ${points}，开始领取 ${exchangeCount} 次累计奖励`,
                    type: "info",
                  });

                  for (let k = 0; k < exchangeCount && !shouldStop.value; k++) {
                    try {
                      check();
                      await tokenStore.sendMessageWithPromise(
                        tokenId,
                        "artifact_exchange",
                        {},
                        3000,
                      );
                      await new Promise((r) => setTimeout(r, 500));
                    } catch (err) {
                      if (err?.interrupted) throw err;
                      addLog({
                        time: new Date().toLocaleTimeString(),
                        message: `${token.name} 领取累计奖励失败 (第${k + 1}次): ${err.message}`,
                        type: "warning",
                      });
                      break;
                    }
                  }
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 累计奖励领取结束`,
                    type: "success",
                  });
                }
              }
            } catch (e) {
              if (e?.interrupted) throw e;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 检查累计奖励失败: ${e.message}`,
                type: "warning",
              });
            }

            tokenStatus.value[tokenId] =
              finalFishNum >= shouldBe || finalFishNum >= FISH_TARGET
                ? "completed"
                : "pending";
          },
        );
      } catch (error) {
        if (error?.interrupted) {
          tokenStatus.value[tokenId] = "stopped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼补齐已停止`,
            type: "warning",
          });
        } else {
          console.error(error);
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼补齐失败: ${error.message}`,
            type: "error",
          });
        }
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (
      selectedTokens.value.some((id) => tokenStatus.value[id] !== "completed")
    ) {
      message.warning("批量钓鱼补齐未全部完成，请查看日志");
    } else {
      message.success("批量钓鱼补齐结束");
    }
  };

  /**
   * 批量竞技场补齐
   */
  const batchTopUpArena = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      // 配置无法读取时停止，避免使用其他账号的设置。
      const tokenSettings = loadSettings
        ? loadSettings(tokenId)
        : currentSettings;
      if (!tokenSettings) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: "账号设置损坏或冲突，请核对后重试",
          type: "error",
        });
        return;
      }
      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: "账号已不存在，跳过竞技场补齐",
          type: "error",
        });
        return;
      }

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始竞技场补齐: ${token.name} ===`,
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
            logOnClose: true,
          },
          async ({ check, isConnectionIntact }) => {
            const formationState = {
              originalFormation: undefined,
              changed: false,
            };
            try {
              check();

              await switchPresetFormation({
                tokenStore,
                tokenId,
                check,
                targetFormation: tokenSettings.arenaFormation,
                addLog,
                errorMessage: "服务器未提供有效阵容，停止竞技场补齐",
                state: formationState,
              });
              check();
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 获取月度任务进度...`,
                type: "info",
              });
              const result = await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_get",
                {},
                10000,
              );
              check();
              const arenaNum = readArenaProgress(result);
              if (arenaNum === null) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 未获取到有效竞技场进度，请刷新后重试`,
                  type: "warning",
                });
                tokenStatus.value[tokenId] = "pending";
                return;
              }

              const monthProgress = calculateMonthProgress();
              const now = new Date();
              const daysInMonth = new Date(
                now.getFullYear(),
                now.getMonth() + 1,
                0,
              ).getDate();
              const dayOfMonth = now.getDate();
              const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
              const shouldBe =
                remainingDays === 0
                  ? ARENA_TARGET
                  : Math.min(
                      ARENA_TARGET,
                      Math.ceil(monthProgress * ARENA_TARGET),
                    );
              const need = Math.max(0, shouldBe - arenaNum);
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 当前进度: ${arenaNum}/${ARENA_TARGET}，需要补齐: ${need}次`,
                type: "info",
              });
              if (need <= 0) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 当前进度已达标，无需补齐`,
                  type: "success",
                });
                tokenStatus.value[tokenId] = "completed";
                return;
              }

              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 开始执行竞技场补齐...`,
                type: "info",
              });

              // 检查咸神门票 (ID: 1007)
              const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
              check();
              const role = roleInfo?.role;
              if (!role) throw new Error("未获取到当前账号的角色信息");
              const ticketCount = role?.items?.[1007]?.quantity || 0;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 当前咸神门票: ${ticketCount}`,
                type: "info",
              });

              if (ticketCount < need) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 咸神门票不足 (${ticketCount} < ${need})，将仅使用现有门票`,
                  type: "warning",
                });
              }

              let ticketsLeft = ticketCount;
              let remaining = Math.min(need, ticketsLeft);

              if (remaining <= 0) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 没有可用的咸神门票`,
                  type: "warning",
                });
                tokenStatus.value[tokenId] = "pending";
                return;
              }

              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "arena_startarea",
                  {},
                  6000,
                );
              } catch (error) {
                if (error?.interrupted) throw error;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 开始竞技场失败: ${error.message}`,
                  type: "warning",
                });
                tokenStatus.value[tokenId] = "pending";
                return;
              }

              let safetyCounter = 0;
              const safetyMaxFights = 100;
              let round = 1;
              while (
                remaining > 0 &&
                ticketsLeft > 0 &&
                safetyCounter < safetyMaxFights &&
                !shouldStop.value
              ) {
                check();
                const planFights = Math.min(
                  Math.ceil(remaining / 2),
                  ticketsLeft,
                );
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 第${round}轮：计划战斗 ${planFights} 场 (剩余门票: ${ticketsLeft})`,
                  type: "info",
                });

                let roundUncertain = false;
                for (
                  let i = 0;
                  i < planFights &&
                  safetyCounter < safetyMaxFights &&
                  !shouldStop.value;
                  i++
                ) {
                  check();
                  let targets;
                  try {
                    targets = await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "arena_getareatarget",
                      {},
                      8000,
                    );
                  } catch (err) {
                    if (err?.interrupted) throw err;
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 获取竞技场目标失败：${err.message}`,
                      type: "error",
                    });
                    roundUncertain = true;
                    break;
                  }
                  if (shouldStop.value) break;
                  check();

                  const targetId = pickArenaTargetId(targets);
                  if (!targetId) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 未找到可用的竞技场目标`,
                      type: "warning",
                    });
                    roundUncertain = true;
                    break;
                  }

                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "fight_startareaarena",
                      { targetId },
                      15000,
                    );

                    ticketsLeft--;
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 竞技场战斗 ${i + 1}/${planFights} 完成`,
                      type: "info",
                    });
                  } catch (e) {
                    if (e?.interrupted) throw e;
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 竞技场对决失败：${e.message}`,
                      type: "error",
                    });
                    roundUncertain = true;
                    break;
                  }

                  safetyCounter++;
                  await new Promise((r) => setTimeout(r, delayConfig.refresh));
                }

                check();
                if (roundUncertain) {
                  tokenStatus.value[tokenId] = "pending";
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 竞技场结果未确认，已停止后续挑战`,
                    type: "warning",
                  });
                  return;
                }
                const updatedResult = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "activity_get",
                  {},
                  10000,
                );
                check();
                const updatedArenaNum = readArenaProgress(updatedResult);
                if (updatedArenaNum === null) {
                  tokenStatus.value[tokenId] = "pending";
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 无法确认最新竞技场进度，已停止挑战`,
                    type: "warning",
                  });
                  return;
                }

                // Re-calculate remaining needed for target, but don't exceed ticketsLeft
                const neededForTarget = Math.max(0, shouldBe - updatedArenaNum);

                // 每轮战斗后重新获取角色信息以更新门票数量
                try {
                  const roleRes = await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "role_getroleinfo",
                    {},
                    5000,
                  );
                  const currentRole = roleRes?.role || roleRes?.data?.role;
                  if (currentRole) {
                    const newTickets = currentRole.items?.[1007]?.quantity || 0;
                    if (newTickets !== ticketsLeft) {
                      addLog({
                        time: new Date().toLocaleTimeString(),
                        message: `${token.name} 同步最新门票数量: ${newTickets} (原记录: ${ticketsLeft})`,
                        type: "info",
                      });
                      ticketsLeft = newTickets;
                    }
                  }
                } catch (e) {
                  // ignore error, use local calculation
                }

                remaining = Math.min(neededForTarget, ticketsLeft);

                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 第${round}轮后进度: ${updatedArenaNum}/${ARENA_TARGET}，还需补齐: ${remaining}次`,
                  type: "info",
                });

                round++;
              }

              const finalResult = await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_get",
                {},
                10000,
              );
              check();
              const finalArenaNum = readArenaProgress(finalResult);
              if (finalArenaNum === null) {
                tokenStatus.value[tokenId] = "pending";
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 无法确认最终竞技场进度`,
                  type: "warning",
                });
                return;
              }
              if (finalArenaNum >= shouldBe || finalArenaNum >= ARENA_TARGET) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 竞技场补齐完成，最终进度: ${finalArenaNum}/${ARENA_TARGET}`,
                  type: "success",
                });
              } else if (safetyCounter >= safetyMaxFights) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `达到安全上限，竞技场补齐已停止，最终进度: ${finalArenaNum}/${ARENA_TARGET}`,
                  type: "warning",
                });
              } else {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 竞技场补齐已停止，未达到目标，最终进度: ${finalArenaNum}/${ARENA_TARGET}`,
                  type: "warning",
                });
              }
              check();
              tokenStatus.value[tokenId] =
                finalArenaNum >= shouldBe || finalArenaNum >= ARENA_TARGET
                  ? "completed"
                  : "pending";
            } finally {
              await restorePresetFormation({
                tokenStore,
                tokenId,
                tokenName: token.name,
                tokenStatus,
                addLog,
                state: formationState,
                isConnectionIntact,
              });
            }
          },
        );
      } catch (error) {
        if (error?.interrupted) {
          tokenStatus.value[tokenId] = "stopped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 竞技场补齐已停止`,
            type: "warning",
          });
        } else {
          console.error(error);
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 竞技场补齐失败: ${error.message}`,
            type: "error",
          });
        }
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (
      selectedTokens.value.some((id) => tokenStatus.value[id] !== "completed")
    ) {
      message.warning("批量竞技场补齐未全部完成，请查看日志");
    } else {
      message.success("批量竞技场补齐结束");
    }
  };

  return {
    batcharenafight,
    batchTopUpFish,
    batchTopUpArena,
  };
}
