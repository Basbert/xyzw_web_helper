import { runApexAutoGuess } from "@/utils/apexGuessHelper.js";

/** Run the same guessing workflow for each selected account. */
export function createTasksApex(deps) {
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

  const batchApexGuess = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const accountIds = [...new Set(selectedTokens.value)];
    isRunning.value = true;
    shouldStop.value = false;
    for (const id of accountIds) tokenStatus.value[id] = "waiting";

    try {
      await Promise.all(
        accountIds.map(async (tokenId) => {
          if (shouldStop.value) {
            tokenStatus.value[tokenId] = "stopped";
            return;
          }
          const token = tokens.value.find((item) => item.id === tokenId);
          if (!token) {
            tokenStatus.value[tokenId] = "failed";
            log("账号已不存在，跳过逐鹿盐山竞猜", "error");
            return;
          }
          let ownsSlot = false;
          tokenStatus.value[tokenId] = "running";
          try {
            await ensureConnection(tokenId, 2, (owned) => {
              ownsSlot = owned;
            });
            const checkInterrupted = () => {
              if (shouldStop.value) {
                const error = new Error("批量任务已停止");
                error.interrupted = true;
                throw error;
              }
              if (
                tokenStore.getWebSocketStatus &&
                tokenStore.getWebSocketStatus(tokenId) !== "connected"
              ) {
                const error = new Error("账号连接已断开");
                error.interrupted = true;
                throw error;
              }
            };
            checkInterrupted();
            log(`开始逐鹿盐山竞猜：${token.name}`);
            const result = await runApexAutoGuess({
              tokenStore,
              tokenId,
              checkInterrupted,
              onProgress: (text) => {
                if (text.startsWith("正在获取") || text.startsWith("等待")) {
                  log(`${token.name} ${text}`);
                }
              },
            });
            for (const entry of result.entries) {
              const verdict =
                entry.status === "submitted"
                  ? "已提交"
                  : entry.status === "not-sent"
                    ? "未发送"
                    : "结果未确认";
              log(
                `${token.name} ${entry.title} ${entry.name}（助威 ${entry.votes}）${verdict}`,
                entry.status === "submitted" ? "success" : "warning",
              );
            }
            tokenStatus.value[tokenId] =
              result.outcome === "stopped"
                ? "stopped"
                : result.outcome === "partial"
                  ? "pending"
                  : "completed";
            log(
              `${token.name} ${result.message}`,
              result.outcome === "partial" || result.outcome === "stopped"
                ? "warning"
                : "success",
            );
          } catch (error) {
            tokenStatus.value[tokenId] = error?.interrupted
              ? "stopped"
              : "failed";
            log(
              `${token.name} 逐鹿盐山竞猜未完成：${error.message || "未知错误"}`,
              error?.interrupted ? "warning" : "error",
            );
          } finally {
            if (ownsSlot) {
              try {
                tokenStore.closeWebSocketConnection(tokenId);
              } finally {
                releaseConnectionSlot();
              }
              log(
                `${token.name} 本次连接已关闭（队列: ${connectionQueue.active}/${batchSettings.maxActive}）`,
              );
            }
          }
        }),
      );
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    if (accountIds.some((id) => tokenStatus.value[id] !== "completed")) {
      message.warning("批量竞猜已结束，部分账号未完成，请查看日志");
    } else {
      message.success("批量逐鹿盐山竞猜结束");
    }
  };

  /** Claim eligible guess rewards independently of whether betting is open. */
  const batchApexClaim = async () => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    const accountIds = [...new Set(selectedTokens.value)];
    isRunning.value = true;
    shouldStop.value = false;
    for (const id of accountIds) tokenStatus.value[id] = "waiting";

    try {
      await Promise.all(
        accountIds.map(async (tokenId) => {
          if (shouldStop.value) {
            tokenStatus.value[tokenId] = "stopped";
            return;
          }
          const token = tokens.value.find((item) => item.id === tokenId);
          if (!token) {
            tokenStatus.value[tokenId] = "failed";
            log("账号已不存在，跳过竞猜奖励领取", "error");
            return;
          }
          let ownsSlot = false;
          let ownedClient;
          let ownedSocket;
          let readyClient;
          let readySocket;
          let toRaw;
          tokenStatus.value[tokenId] = "running";
          try {
            ({ toRaw } = await import("vue"));
            const currentClient = () =>
              toRaw(tokenStore.wsConnections?.[tokenId]?.client);
            const currentSocket = (client) => toRaw(client?.socket);
            const checkInterrupted = () => {
              let reason = "";
              if (shouldStop.value) reason = "批量任务已停止";
              else if (
                tokenStore.getWebSocketStatus &&
                tokenStore.getWebSocketStatus(tokenId) !== "connected"
              )
                reason = "账号连接已断开";
              else if (
                !readyClient ||
                currentClient() !== readyClient ||
                currentSocket(readyClient) !== readySocket ||
                (ownsSlot &&
                  (!ownedClient ||
                    readyClient !== ownedClient ||
                    readySocket !== ownedSocket))
              )
                reason = "账号连接已变化";
              if (reason) {
                const error = new Error(reason);
                error.interrupted = true;
                throw error;
              }
            };
            await ensureConnection(
              tokenId,
              2,
              (owned) => {
                ownsSlot = owned;
              },
              (client) => {
                ownedClient = toRaw(client);
                ownedSocket = currentSocket(ownedClient);
              },
              () => {
                readyClient = currentClient();
                readySocket = currentSocket(readyClient);
                checkInterrupted();
              },
              { skipInitialization: true },
            );
            checkInterrupted();
            // Load on demand so the existing batch guessing flow remains independent.
            const { runApexRewardClaims } =
              await import("@/utils/apexRewardHelper.js");
            checkInterrupted();
            log(`开始领取逐鹿盐山竞猜奖励：${token.name}`);
            const result = await runApexRewardClaims({
              tokenStore,
              tokenId,
              checkInterrupted,
              onProgress: (text) => log(`${token.name} ${text}`),
            });
            for (const entry of result.entries || []) {
              const confirmed = entry.status === "claimed";
              log(
                `${token.name} 赛程 ${entry.scheduleId} 的竞猜奖励${confirmed ? "已领取" : "结果未确认"}`,
                confirmed ? "success" : "warning",
              );
            }
            tokenStatus.value[tokenId] =
              result.outcome === "stopped"
                ? "stopped"
                : result.outcome === "completed"
                  ? "completed"
                  : "pending";
            log(
              `${token.name} ${result.message}`,
              result.outcome === "completed" ? "success" : "warning",
            );
          } catch (error) {
            tokenStatus.value[tokenId] = error?.interrupted
              ? "stopped"
              : "failed";
            log(
              `${token.name} 竞猜奖励领取未完成：${error.message || "未知错误"}`,
              error?.interrupted ? "warning" : "error",
            );
          } finally {
            if (ownsSlot) {
              let closed = false;
              try {
                const currentClient = toRaw?.(
                  tokenStore.wsConnections?.[tokenId]?.client,
                );
                if (
                  ownedClient &&
                  currentClient === ownedClient &&
                  toRaw(currentClient.socket) === ownedSocket
                ) {
                  tokenStore.closeWebSocketConnection(tokenId);
                  closed = true;
                }
              } catch (error) {
                log(
                  `${token.name} 连接关闭失败：${error.message || "未知错误"}`,
                  "warning",
                );
              } finally {
                releaseConnectionSlot();
              }
              log(
                `${token.name} ${closed ? "本次连接已关闭" : "连接已变化或不可确认，保留现有连接"}（队列: ${connectionQueue.active}/${batchSettings.maxActive}）`,
              );
            }
          }
        }),
      );
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    if (accountIds.some((id) => tokenStatus.value[id] !== "completed")) {
      message.warning("批量领取已结束，部分账号未完成，请查看日志");
    } else {
      message.success("批量领取逐鹿盐山竞猜奖励结束");
    }
  };

  return { batchApexGuess, batchApexClaim };
}
