/** 批量盐杯竞猜。 */
export function createTasksFootball(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
  } = deps;
  const log = (text, type = "info") =>
    addLog({ time: new Date().toLocaleTimeString(), message: text, type });

  /** @param {number} pick 1=主胜, 2=平局, 3=客胜 */
  const batchFootballBet = async (pick = 3) => {
    if (isRunning.value || selectedTokens.value.length === 0) return;
    if (![1, 2, 3].includes(pick)) {
      message.warning("竞猜选项无效，请重新选择");
      return;
    }
    const ids = [...new Set(selectedTokens.value)];
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
          const token = tokens.value.find((item) => item.id === tokenId);
          if (!token) {
            tokenStatus.value[tokenId] = "failed";
            log("账号已不存在，跳过盐杯竞猜", "error");
            return;
          }
          let ownsSlot = false;
          tokenStatus.value[tokenId] = "running";
          const checkInterrupted = () => {
            if (
              shouldStop.value ||
              (tokenStore.getWebSocketStatus &&
                tokenStore.getWebSocketStatus(tokenId) !== "connected")
            ) {
              const error = new Error(
                shouldStop.value ? "批量任务已停止" : "账号连接已断开",
              );
              error.interrupted = true;
              throw error;
            }
          };
          try {
            await ensureConnection(tokenId, 2, (owned) => {
              ownsSlot = owned;
            });
            checkInterrupted();
            const response = await tokenStore.sendMessageWithPromise(
              tokenId,
              "saltcup26_getbetinfo",
              {},
              8000,
            );
            checkInterrupted();
            const roleData = response?.roleData;
            if (
              !roleData ||
              typeof roleData !== "object" ||
              Array.isArray(roleData)
            )
              throw new Error("未获取到竞猜记录，请刷新后重试");
            const betRecord = roleData.betRecord ?? {};
            if (
              !betRecord ||
              typeof betRecord !== "object" ||
              Array.isArray(betRecord)
            )
              throw new Error("竞猜记录格式异常，请刷新后重试");
            const scheduleIds = Object.keys(betRecord);
            if (!scheduleIds.length) {
              tokenStatus.value[tokenId] = "completed";
              log(`${token.name} 当前没有可竞猜的比赛`, "info");
              return;
            }
            const bets = betRecord[scheduleIds[scheduleIds.length - 1]];
            if (!bets || typeof bets !== "object" || Array.isArray(bets))
              throw new Error("比赛记录不完整，请刷新后重试");
            if (
              Object.values(bets).some(
                (item) => !item || ![0, 1, 2, 3].includes(item.pick),
              )
            )
              throw new Error("比赛竞猜状态不完整，请刷新后重试");
            const matchIds = Object.keys(bets).filter(
              (id) => bets[id]?.pick === 0,
            );
            if (!matchIds.length) {
              tokenStatus.value[tokenId] = "completed";
              log(`${token.name} 当前比赛没有待竞猜项目`, "info");
              return;
            }
            const label = { 1: "主胜", 2: "平局", 3: "客胜" }[pick];
            let sent = 0;
            for (const [index, matchId] of matchIds.entries()) {
              checkInterrupted();
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "saltcup26_placebet",
                  { matchId, pick },
                  8000,
                );
              } catch {
                log(
                  `${token.name} ${matchId} 竞猜结果未确认，请刷新比赛记录后再决定是否重试`,
                  "warning",
                );
                tokenStatus.value[tokenId] = "pending";
                return;
              }
              sent++;
              log(`${token.name} ${matchId} → ${label} 已提交`, "success");
              checkInterrupted();
              if (index < matchIds.length - 1)
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            tokenStatus.value[tokenId] = "completed";
            log(`${token.name} 已提交 ${sent} 场竞猜`, "success");
          } catch (error) {
            tokenStatus.value[tokenId] = error?.interrupted
              ? "stopped"
              : "failed";
            log(
              `${token.name} 盐杯竞猜未完成：${error.message || "未知错误"}`,
              error?.interrupted ? "warning" : "error",
            );
          } finally {
            if (ownsSlot) {
              try {
                tokenStore.closeWebSocketConnection(tokenId);
              } finally {
                releaseConnectionSlot();
              }
            }
          }
        }),
      );
    } finally {
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    if (ids.some((id) => tokenStatus.value[id] !== "completed")) {
      message.warning("批量盐杯竞猜已结束，部分账号未完成，请查看日志");
    } else {
      message.success("批量盐杯竞猜结束");
    }
  };
  return { batchFootballBet };
}
