import { runWithDailyTaskLock } from "@/utils/dailyTaskState";
import {
  runBatchForAccounts,
  withManagedConnection,
} from "./connectionManager.js";

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

  const runBatch = (label, execute) =>
    runBatchForAccounts(
      {
        selectedTokens,
        tokens,
        tokenStatus,
        isRunning,
        shouldStop,
        currentRunningTokenId,
        addLog,
        message,
        label,
        notifyOnFinish: true,
      },
      async ({ tokenId, token }) => {
        try {
          await runWithDailyTaskLock(tokenId, async () => {
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
                log(`=== 开始${label}: ${token.name} ===`);
                await execute(tokenId, token.name, check);
                check();
                tokenStatus.value[tokenId] = "completed";
                log(`=== ${token.name} ${label}完成 ===`, "success");
              },
            );
          });
        } catch (error) {
          tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
          log(
            `${token.name} ${label}未完成: ${error.message || "未知错误"}`,
            error.interrupted ? "warning" : "error",
          );
        }
      },
    );

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
