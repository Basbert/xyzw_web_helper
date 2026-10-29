import { runWithDailyTaskLock } from "@/utils/dailyTaskState";

/** Create the batch actions for resetting and claiming salt jars. */
export function createTasksBottle(deps) {
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

  const log = (text, type = "info") =>
    addLog({ time: new Date().toLocaleTimeString(), message: text, type });

  const runBatch = async (label, execute) => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const ids = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;
    ids.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    try {
      await Promise.all(
        ids.map(async (tokenId) => {
          if (shouldStop.value) {
            tokenStatus.value[tokenId] = "stopped";
            return;
          }
          tokenStatus.value[tokenId] = "running";
          const token = tokens.value.find((item) => item.id === tokenId);
          if (!token) {
            tokenStatus.value[tokenId] = "failed";
            log(`账号已不存在，跳过${label}`, "error");
            return;
          }

          try {
            await runWithDailyTaskLock(tokenId, async () => {
              let ownsSlot = false;
              const check = () => {
                if (
                  shouldStop.value ||
                  tokenStore.getWebSocketStatus(tokenId) !== "connected"
                ) {
                  const error = new Error("任务已停止或连接已断开");
                  error.interrupted = true;
                  throw error;
                }
              };
              try {
                await ensureConnection(tokenId, 2, (owned) => {
                  ownsSlot = owned;
                });
                check();
                log(`=== 开始${label}: ${token.name} ===`);
                await execute(tokenId, token.name, check);
                check();
                tokenStatus.value[tokenId] = "completed";
                log(`=== ${token.name} ${label}完成 ===`, "success");
              } finally {
                if (ownsSlot) {
                  try {
                    tokenStore.closeWebSocketConnection(tokenId);
                  } finally {
                    releaseConnectionSlot();
                  }
                  log(
                    `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
                  );
                }
              }
            });
          } catch (error) {
            tokenStatus.value[tokenId] = error.interrupted
              ? "stopped"
              : "failed";
            log(
              `${token.name} ${label}未完成: ${error.message || "未知错误"}`,
              error.interrupted ? "warning" : "error",
            );
          }
        }),
      );
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }

    if (ids.some((id) => tokenStatus.value[id] !== "completed")) {
      message.warning(`批量${label}已结束，部分账号未完成，请查看日志`);
    } else {
      message.success(`批量${label}完成`);
    }
  };

  const resetBottles = () =>
    runBatch("重置罐子", async (tokenId, tokenName) => {
      log(`${tokenName} 停止计时...`);
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_stop",
        {},
        5000,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Complete the restart after a stop request, even if the user cancels.
      if (tokenStore.getWebSocketStatus(tokenId) !== "connected")
        throw new Error("盐罐已停止，连接断开，请检查并重新启动");
      log(`${tokenName} 开始计时...`);
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_start",
        {},
        5000,
      );
    });

  const batchlingguanzi = () =>
    runBatch("领取盐罐", async (tokenId, _tokenName, check) => {
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_claim",
        {},
        5000,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      check();
    });

  return { resetBottles, batchlingguanzi };
}
