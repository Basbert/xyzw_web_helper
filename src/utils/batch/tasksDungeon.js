import { isDungeonOpen, merchantConfig } from "@/utils/dreamConstants";

/**
 * 宝库、梦境类任务
 * 包含: batchbaoku13, batchbaoku45, batchmengjing, batchBuyDreamItems
 */

/**
 * 创建宝库、梦境类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksDungeon(deps) {
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
  } = deps;

  const checkStop = () => {
    if (!shouldStop.value) return;
    const error = new Error("任务已停止");
    error.interrupted = true;
    throw error;
  };
  const markMissing = (tokenId) => {
    tokenStatus.value[tokenId] = "failed";
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "选中的账号已不存在，本次跳过",
      type: "error",
    });
  };
  const releaseOwnedConnection = (tokenId, name, ownsSlot) => {
    if (!ownsSlot) return;
    let closeRequested = false;
    try {
      tokenStore.closeWebSocketConnection(tokenId);
      closeRequested = true;
    } catch (error) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 关闭本次连接失败: ${error.message}`,
        type: "warning",
      });
    } finally {
      releaseConnectionSlot();
    }
    if (closeRequested)
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 已请求关闭本次连接 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
        type: "info",
      });
  };
  const finishBatch = async (taskPromises, tokenIds, label) => {
    try {
      await Promise.all(taskPromises);
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    if (tokenIds.some((id) => tokenStatus.value[id] !== "completed")) {
      message.warning(`批量${label}未全部完成，请查看日志`);
    } else {
      message.success(`批量${label}完成`);
    }
  };

  /**
   * 一键宝库前3层
   */
  const batchbaoku13 = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const tokenIds = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;

    tokenIds.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = tokenIds.map(async (tokenId) => {
      if (shouldStop.value) {
        tokenStatus.value[tokenId] = "stopped";
        return;
      }
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        markMissing(tokenId);
        return;
      }
      let ownsSlot = false;
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键宝库: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId, 2, (owned) => {
          ownsSlot = owned;
        });
        checkStop();
        const bosstowerinfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "bosstower_getinfo",
          {},
        );
        checkStop();
        const towerId = bosstowerinfo.bossTower.towerId;
        if (towerId >= 1 && towerId <= 3) {
          for (let i = 0; i < 2; i++) {
            if (shouldStop.value) break;
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "bosstower_startboss",
              {},
            );
            await new Promise((r) => setTimeout(r, 500));
          }
          for (let i = 0; i < 9; i++) {
            if (shouldStop.value) break;
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "bosstower_startbox",
              {},
            );
            await new Promise((r) => setTimeout(r, 500));
          }
        } else {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前不在宝库 1–3 层，未执行`,
            type: "warning",
          });
          return;
        }
        checkStop();
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 宝库战斗已完成，请上线手动领取奖励 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝库战斗失败: ${error.message || "未知错误"}`,
          type: error.interrupted ? "warning" : "error",
        });
      } finally {
        releaseOwnedConnection(tokenId, token.name, ownsSlot);
      }
    });

    await finishBatch(taskPromises, tokenIds, "宝库");
  };

  /**
   * 一键宝库4,5层
   */
  const batchbaoku45 = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const tokenIds = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;

    tokenIds.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = tokenIds.map(async (tokenId) => {
      if (shouldStop.value) {
        tokenStatus.value[tokenId] = "stopped";
        return;
      }
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        markMissing(tokenId);
        return;
      }
      let ownsSlot = false;
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键宝库: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId, 2, (owned) => {
          ownsSlot = owned;
        });
        checkStop();
        const bosstowerinfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "bosstower_getinfo",
          {},
        );
        checkStop();
        const towerId = bosstowerinfo.bossTower.towerId;
        if (towerId >= 4 && towerId <= 5) {
          for (let i = 0; i < 2; i++) {
            if (shouldStop.value) break;
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "bosstower_startboss",
              {},
            );
            await new Promise((r) => setTimeout(r, 500));
          }
        } else {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前不在宝库 4–5 层，未执行`,
            type: "warning",
          });
          return;
        }
        checkStop();
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 宝库战斗已完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝库战斗失败: ${error.message || "未知错误"}`,
          type: error.interrupted ? "warning" : "error",
        });
      } finally {
        releaseOwnedConnection(tokenId, token.name, ownsSlot);
      }
    });

    await finishBatch(taskPromises, tokenIds, "宝库");
  };

  /**
   * 一键梦境
   */
  const batchmengjing = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const tokenIds = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;

    tokenIds.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = tokenIds.map(async (tokenId) => {
      if (shouldStop.value) {
        tokenStatus.value[tokenId] = "stopped";
        return;
      }
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        markMissing(tokenId);
        return;
      }
      let ownsSlot = false;
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始咸王梦境: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId, 2, (owned) => {
          ownsSlot = owned;
        });
        checkStop();
        const mjbattleTeam = { 0: 107 };
        if (isDungeonOpen()) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "dungeon_selecthero",
            { battleTeam: mjbattleTeam },
            5000,
          );
          await new Promise((r) => setTimeout(r, 500));
          checkStop();
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 咸王梦境已完成 ===`,
            type: "success",
          });
        } else {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 当前未在开放时间 ===`,
            type: "warning",
          });
        }
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 咸王梦境失败: ${error.message || "未知错误"}`,
          type: error.interrupted ? "warning" : "error",
        });
      } finally {
        releaseOwnedConnection(tokenId, token.name, ownsSlot);
      }
    });

    await finishBatch(taskPromises, tokenIds, "梦境");
  };

  /**
   * 一键购买梦境商品
   */
  const batchBuyDreamItems = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const tokenIds = [...selectedTokens.value];

    if (!isDungeonOpen()) {
      message.warning("当前不是梦境开放时间（周三/周四/周日/周一）");
      return;
    }

    const purchaseList = Array.isArray(batchSettings.dreamPurchaseList)
      ? [...batchSettings.dreamPurchaseList]
      : [];
    if (purchaseList.length === 0) {
      message.warning("请先在设置中配置购买清单");
      return;
    }

    isRunning.value = true;
    shouldStop.value = false;

    tokenIds.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = tokenIds.map(async (tokenId) => {
      if (shouldStop.value) {
        tokenStatus.value[tokenId] = "stopped";
        return;
      }
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      if (!token) {
        markMissing(tokenId);
        return;
      }
      let ownsSlot = false;
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始梦境购买: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId, 2, (owned) => {
          ownsSlot = owned;
        });
        checkStop();

        // 1. 获取角色信息以获得商店数据
        const roleInfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          15000,
        );

        if (
          !roleInfo ||
          !roleInfo.role ||
          !roleInfo.role.dungeon ||
          !roleInfo.role.dungeon.merchant
        ) {
          throw new Error("无法获取梦境商店数据");
        }

        const merchantData = roleInfo.role.dungeon.merchant;
        const levelId = roleInfo.role.levelId || 0;
        let successCount = 0;
        let failCount = 0;

        const operations = [];

        for (const itemKey of purchaseList) {
          const [targetMerchantId, targetItemIndex] = itemKey
            .split("-")
            .map(Number);

          const merchantItems = merchantData[targetMerchantId];
          if (merchantItems) {
            for (let pos = 0; pos < merchantItems.length; pos++) {
              if (merchantItems[pos] === targetItemIndex) {
                operations.push({
                  merchantId: targetMerchantId,
                  index: targetItemIndex,
                  pos,
                });
              }
            }
          }
        }
        operations.sort((a, b) => {
          if (a.merchantId !== b.merchantId) return a.merchantId - b.merchantId;
          return b.pos - a.pos;
        });
        checkStop();
        if (!operations.length) {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前商店没有清单中的商品，本次未购买`,
            type: "warning",
          });
          return;
        }

        for (const op of operations) {
          checkStop();

          if (levelId < 4000) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 关卡数小于4000，无法购买`,
              type: "warning",
            });
            tokenStatus.value[tokenId] = "skipped";
            return;
          }

          try {
            const response = await tokenStore.sendMessageWithPromise(
              tokenId,
              "dungeon_buymerchant",
              {
                id: op.merchantId,
                index: op.index,
                pos: op.pos,
              },
              5000,
            );

            if (response && response.reward) {
              successCount++;
              const merchantName = merchantConfig[op.merchantId]
                ? merchantConfig[op.merchantId].name
                : `商人${op.merchantId}`;
              const itemName =
                merchantConfig[op.merchantId] &&
                merchantConfig[op.merchantId].items[op.index]
                  ? merchantConfig[op.merchantId].items[op.index]
                  : `商品${op.index}`;

              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 购买成功: ${merchantName} - ${itemName}`,
                type: "success",
              });
            } else {
              failCount++;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 购买结果未确认，已停止后续购买`,
                type: "warning",
              });
              break;
            }
          } catch (err) {
            failCount++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买结果未确认，已停止后续购买: ${err.message || "未知错误"}`,
              type: "warning",
            });
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        checkStop();
        tokenStatus.value[tokenId] = failCount ? "failed" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 梦境购买结束: 成功${successCount}, 未确认${failCount} ===`,
          type: failCount ? "warning" : "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 梦境购买失败: ${error.message || "未知错误"}`,
          type: error.interrupted ? "warning" : "error",
        });
      } finally {
        releaseOwnedConnection(tokenId, token.name, ownsSlot);
      }
    });

    await finishBatch(taskPromises, tokenIds, "梦境购买");
  };

  return {
    batchbaoku13,
    batchbaoku45,
    batchmengjing,
    batchBuyDreamItems,
  };
}
