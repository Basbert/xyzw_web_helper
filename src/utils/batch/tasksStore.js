/**
 * 商店类任务
 * 包含: legion_storebuygoods, legionStoreBuySkinCoins, store_purchase,
 * store_syncpurchaseconfig, collection_claimfreereward
 */

import {
  compareBlackMarketPurchaseLists,
  normalizeBlackMarketPurchaseList,
  toStorePurchaseItemList,
} from "./blackMarketConfig";
import {
  runBatchForAccounts,
  withManagedConnection,
} from "./connectionManager.js";

/**
 * 创建商店类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksStore(deps) {
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
    currentRunningTokenId,
    delayConfig,
  } = deps;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getBlackMarketPurchaseConfig = () =>
    normalizeBlackMarketPurchaseList(batchSettings.blackMarketPurchaseList);

  const readBlackMarketPurchaseConfig = async (tokenId) => {
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_getpurchase",
      {},
      5000,
    );

    return {
      purchaseCnt: Number(result?.purchaseCnt || 0),
      purchaseItemList: normalizeBlackMarketPurchaseList(
        result?.purchaseItemList || [],
      ),
    };
  };

  const updateBlackMarketPurchaseConfig = async (tokenId, tokenName) => {
    const configuredPurchaseList = getBlackMarketPurchaseConfig();

    if (configuredPurchaseList.length === 0) {
      throw new Error("未配置黑市采购清单");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在读取当前黑市采购清单...`,
      type: "info",
    });

    const currentPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 当前黑市清单: ${currentPurchaseConfig.purchaseItemList.length} 项，共 ${currentPurchaseConfig.purchaseCnt} 次`,
      type: "info",
    });

    if (
      compareBlackMarketPurchaseLists(
        currentPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 黑市采购清单已是目标配置，跳过下发`,
        type: "info",
      });

      return;
    }

    const purchaseCnt = Math.max(1, currentPurchaseConfig.purchaseCnt || 1);
    const purchaseItemList = toStorePurchaseItemList(configuredPurchaseList);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在下发黑市采购清单...`,
      type: "info",
    });

    await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_setpurchase",
      {
        purchaseCnt,
        purchaseItemList,
      },
      5000,
    );

    await sleep(delayConfig.action);

    const verifiedPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);

    if (
      !compareBlackMarketPurchaseLists(
        verifiedPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      throw new Error("黑市采购清单写回后校验失败");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 黑市采购清单已更新 ${purchaseItemList.length} 项`,
      type: "success",
    });
  };

  const handleLegionStoreError = (tokenId, tokenName, limitLabel, error) => {
    if (error?.interrupted) {
      tokenStatus.value[tokenId] = "stopped";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 购买已停止`,
        type: "warning",
      });
      return;
    }
    const messageText = error?.message || "未知错误";
    if (messageText.includes("俱乐部商品购买数量超出上限")) {
      tokenStatus.value[tokenId] = "completed";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 本周已购买过${limitLabel}，跳过`,
        type: "info",
      });
      return;
    }
    tokenStatus.value[tokenId] = "failed";
    if (messageText.includes("物品不存在")) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 盐锭不足或未加入军团，购买失败`,
        type: "error",
      });
      return;
    }
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 购买失败: ${messageText}`,
      type: "error",
    });
  };

  const runStoreBatch = ({ label, startLabel, onExecute, onError }) =>
    runBatchForAccounts(
      {
        selectedTokens,
        tokens,
        tokenStatus,
        isRunning,
        shouldStop,
        currentRunningTokenId,
        addLog,
        label,
      },
      async ({ tokenId, token }) => {
        try {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始${startLabel || label}: ${token.name} ===`,
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
              await onExecute({ tokenId, token, check });
              tokenStatus.value[tokenId] = "completed";
            },
          );
        } catch (error) {
          if (onError) {
            onError(tokenId, token.name, error);
          } else {
            tokenStatus.value[tokenId] = error?.interrupted
              ? "stopped"
              : "failed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: error?.interrupted
                ? `${token.name} ${label}已停止`
                : `${token.name} ${label}失败: ${error.message}`,
              type: error?.interrupted ? "warning" : "error",
            });
          }
        }
      },
    );

  /**
   * 一键购买四圣碎片
   */
  const legion_storebuygoods = () =>
    runStoreBatch({
      label: "购买四圣碎片",
      onExecute: async ({ tokenId, token, check }) => {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_storebuygoods",
          { id: 6 },
          5000,
        );
        check();

        await sleep(delayConfig.action);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买成功，获得四圣碎片`,
          type: "success",
        });
      },
      onError: (tokenId, tokenName, error) =>
        handleLegionStoreError(tokenId, tokenName, "四圣碎片", error),
    });

  /**
   * 一键购买俱乐部5皮肤币
   */
  const legionStoreBuySkinCoins = () =>
    runStoreBatch({
      label: "购买皮肤币",
      startLabel: "购买俱乐部5皮肤币",
      onExecute: async ({ tokenId, token, check }) => {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        for (let i = 0; i < 5; i++) {
          check();
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_storebuygoods",
            { id: 1 },
            5000,
          );
          await sleep(delayConfig.action);
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买成功，获得皮肤币`,
          type: "success",
        });
      },
      onError: (tokenId, tokenName, error) =>
        handleLegionStoreError(tokenId, tokenName, "皮肤币", error),
    });

  /**
   * 免费领取珍宝阁每日奖励
   */
  const collection_claimfreereward = () =>
    runStoreBatch({
      label: "珍宝阁领取",
      startLabel: "免费领取珍宝阁",
      onExecute: async ({ tokenId, token, check }) => {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送珍宝阁免费领取请求...`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "collection_claimfreereward",
          {},
          5000,
        );
        check();

        await sleep(delayConfig.action);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 珍宝阁领取成功`,
          type: "success",
        });
      },
    });

  /**
   * 一键配置黑市采购清单
   */
  const store_syncpurchaseconfig = () =>
    runStoreBatch({
      label: "配置黑市采购清单",
      onExecute: async ({ tokenId, token }) => {
        await updateBlackMarketPurchaseConfig(tokenId, token.name);
      },
    });

  /**
   * 黑市一键采购
   */
  const store_purchase = () =>
    runStoreBatch({
      label: "黑市采购",
      startLabel: "黑市一键采购",
      onExecute: async ({ tokenId, token, check }) => {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送黑市采购请求...`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "store_purchase",
          {},
          5000,
        );
        check();

        await sleep(delayConfig.action);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 黑市采购成功`,
          type: "success",
        });
      },
    });

  return {
    legion_storebuygoods,
    legionStoreBuySkinCoins,
    store_purchase,
    store_syncpurchaseconfig,
    collection_claimfreereward,
  };
}
