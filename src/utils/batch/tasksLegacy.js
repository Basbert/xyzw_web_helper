/**
 * 功法类任务
 * 包含: batchLegacyClaim, batchLegacyGiftSendEnhanced
 */
import { runWithDailyTaskLock } from "@/utils/dailyTaskState";

/**
 * 创建功法类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksLegacy(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    recipientIdInput,
    recipientInfo,
    securityPassword,
    giftQuantity,
  } = deps;

  /**
   * 批量领取功法残卷
   */
  const batchLegacyClaim = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const tokenIds = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;

    tokenIds.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = tokenIds.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        tokenStatus.value[tokenId] = "failed";
        return;
      }
      try {
        await runWithDailyTaskLock(tokenId, async () => {
          let ownsSlot = false;
          try {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== 开始领取功法残卷: ${token.name} ===`,
              type: "info",
            });
            await ensureConnection(tokenId, 2, (owned) => {
              ownsSlot = owned;
            });
            if (shouldStop.value) {
              const error = new Error("任务已停止");
              error.interrupted = true;
              throw error;
            }
            const response = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legacy_claimhangup",
              {},
              5000,
            );
            const received = response?.reward?.[0]?.value;
            const total = response?.role?.items?.[37007]?.quantity;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 已领取功法残卷${received == null ? "" : ` ${received}`} ${total == null ? "" : `，共有 ${total} 个`} ===`,
              type: "success",
            });
            tokenStatus.value[tokenId] = "completed";
          } finally {
            if (ownsSlot) {
              try {
                tokenStore.closeWebSocketConnection(tokenId);
              } finally {
                releaseConnectionSlot();
              }
            }
          }
        });
      } catch (error) {
        tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 领取功法残卷失败: ${error.message || "未知错误"}`,
          type: error.interrupted ? "warning" : "error",
        });
      }
    });
    try {
      await Promise.all(taskPromises);
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    if (
      shouldStop.value ||
      tokenIds.some((id) => tokenStatus.value[id] !== "completed")
    ) {
      message.warning("批量领取功法残卷未全部完成，请查看日志");
    } else {
      message.success("批量领取功法残卷结束");
    }
  };

  /**
   * 增强版批量赠送功法残卷（含完善的验证和错误处理）
   */
  const batchLegacyGiftSendEnhanced = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择要操作的角色");
      return;
    }

    const recipientId = isScheduledTask
      ? batchSettings.receiverId
      : recipientIdInput.value;
    const password = isScheduledTask
      ? batchSettings.password
      : securityPassword.value;

    const giftConfig = {
      recipientId: Number(recipientId),
      itemId: 37007,
      quantity: Number(giftQuantity.value),
      serverName: recipientInfo.value?.serverName || "",
      name: recipientInfo.value?.name || "",
    };

    if (
      !Number.isSafeInteger(giftConfig.recipientId) ||
      giftConfig.recipientId <= 0
    ) {
      message.error("请输入有效的接收者ID");
      return;
    }

    if (
      !Number.isInteger(giftConfig.quantity) ||
      giftConfig.quantity <= 0 ||
      giftConfig.quantity > 9999
    ) {
      message.error("赠送数量必须在1-9999之间");
      return;
    }

    if (isRunning.value) return;
    const tokenIds = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;

    tokenIds.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    let totalSuccess = 0;
    let totalFailed = 0;

    const taskPromises = tokenIds.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        tokenStatus.value[tokenId] = "failed";
        totalFailed++;
        return;
      }
      const accountGift = { ...giftConfig };
      let giftAttempted = false;
      let giftConfirmed = false;
      const checkStop = () => {
        if (shouldStop.value) {
          const error = new Error("任务已停止");
          error.interrupted = true;
          throw error;
        }
      };

      try {
        await runWithDailyTaskLock(tokenId, async () => {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始赠送功法残卷: ${token.name} ===`,
            type: "info",
          });

          let ownsSlot = false;
          try {
            await ensureConnection(tokenId, 2, (owned) => {
              ownsSlot = owned;
            });
            checkStop();
            const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
            checkStop();
            if (!roleInfo?.role?.items) {
              throw new Error("无法读取当前账号的残卷数量");
            }
            const rawCount =
              roleInfo.role.items[accountGift.itemId]?.quantity ?? 0;
            if (!Number.isInteger(rawCount) || rawCount < 0) {
              throw new Error("服务器返回的残卷数量无效");
            }
            const legacyFragmentCount = Math.min(rawCount, 9999);
            if (isScheduledTask) {
              if (legacyFragmentCount === 0) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `=== ${token.name} 功法残卷不足，当前拥有: 0 ===`,
                  type: "error",
                });
                tokenStatus.value[tokenId] = "failed";
                totalFailed++;
                return;
              }
              const rankroleinfo = await tokenStore.sendMessageWithPromise(
                tokenId,
                "rank_getroleinfo",
                {
                  bottleType: 0,
                  includeBottleTeam: false,
                  isSearch: false,
                  roleId: accountGift.recipientId,
                },
                5000,
              );
              accountGift.serverName = rankroleinfo?.roleInfo?.serverName || "";
              accountGift.name = rankroleinfo?.roleInfo?.name || "";
              if (!rankroleinfo?.roleInfo?.roleId) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `=== ${token.name} 赠送功法残卷失败: 接收者${accountGift.recipientId}不存在`,
                  type: "error",
                });
                tokenStatus.value[tokenId] = "failed";
                totalFailed++;
                return;
              }
              accountGift.quantity = legacyFragmentCount;
            }

            if (legacyFragmentCount < accountGift.quantity) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 功法残卷不足，当前拥有: ${legacyFragmentCount}，需要: ${accountGift.quantity} ===`,
                type: "error",
              });
              tokenStatus.value[tokenId] = "failed";
              totalFailed++;
              return;
            }

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== 开始解除安全密码验证 ===`,
              type: "info",
            });

            checkStop();
            const commitPasswordResp = await tokenStore.sendMessageWithPromise(
              tokenId,
              "role_commitpassword",
              {
                password,
                passwordType: 1,
              },
              5000,
            );

            if (!commitPasswordResp) {
              throw new Error("安全密码验证请求无响应");
            }
            if (!commitPasswordResp.role?.statistics?.["que:wh:tm"]) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} === 密码解除失败,请检查密码是否配置正确 ===`,
                type: "error",
              });
              tokenStatus.value[tokenId] = "failed";
              totalFailed++;
              return;
            }
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== 安全密码验证成功 ===`,
              type: "success",
            });

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} === 开始赠送功法残卷${accountGift.quantity}个,目标:[${accountGift.serverName}] ID:${accountGift.recipientId} ${accountGift.name} ===`,
              type: "info",
            });

            checkStop();
            giftAttempted = true;
            const legacySendGiftResp = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legacy_sendgift",
              {
                itemCnt: accountGift.quantity,
                legacyUIds: [],
                targetId: accountGift.recipientId,
              },
              5000,
            );

            if (!legacySendGiftResp) {
              throw new Error("赠送请求无响应");
            }
            giftConfirmed = true;

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 成功赠送功法残卷${accountGift.quantity}个给[${accountGift.serverName}] ID:${accountGift.recipientId} ${accountGift.name} ===`,
              type: "success",
            });

            tokenStatus.value[tokenId] = "completed";
            totalSuccess++;
          } finally {
            if (ownsSlot) {
              try {
                tokenStore.closeWebSocketConnection(tokenId);
              } finally {
                releaseConnectionSlot();
              }
            }
          }
        });
      } catch (error) {
        let errorMsg = error.message || "未知错误";

        if (errorMsg.includes("200160")) {
          errorMsg = "模块未开启";
        } else if (errorMsg.includes("timeout")) {
          errorMsg = "请求超时";
        } else if (errorMsg.includes("网络")) {
          errorMsg = "网络错误";
        }

        if (giftConfirmed) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 已赠送，但连接清理失败，请检查连接状态 ===`,
            type: "warning",
          });
        } else if (giftAttempted) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 的赠送结果未确认，请先核对游戏记录再操作 ===`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "pending";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 赠送功法残卷未完成: ${errorMsg} ===`,
            type: error.interrupted ? "warning" : "error",
          });
          tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
          totalFailed++;
        }
      }
    });

    try {
      await Promise.all(taskPromises);
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }

    const unconfirmed = tokenIds.filter(
      (id) => tokenStatus.value[id] === "pending",
    ).length;

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 批量赠送功法残卷结束: 成功 ${totalSuccess} 个，失败 ${totalFailed} 个，待核对 ${unconfirmed} 个 ===`,
      type:
        totalFailed || unconfirmed || shouldStop.value ? "warning" : "success",
    });

    const resultMessage = `批量赠送功法残卷结束，成功 ${totalSuccess} 个，失败 ${totalFailed} 个，待核对 ${unconfirmed} 个`;
    if (totalFailed || unconfirmed || shouldStop.value)
      message.warning(resultMessage);
    else message.success(resultMessage);
  };

  return {
    batchLegacyClaim,
    batchLegacyGiftSendEnhanced,
  };
}
