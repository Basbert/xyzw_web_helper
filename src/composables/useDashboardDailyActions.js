import { onScopeDispose, reactive, watch } from "vue";

/** Bind a dashboard operation to its initial account and connection. */
export function useDashboardDailyActions(tokenStore, dependencies) {
  const state = reactive({
    running: false,
    kind: "",
    tokenId: "",
    name: "",
    progress: "",
  });
  const results = reactive({});
  let generation = 0;
  let disposed = false;
  let manuallyStopped = false;
  watch(
    () => {
      const id = tokenStore.selectedToken?.id;
      return [
        id,
        id ? tokenStore.getWebSocketStatus(id) : null,
        id ? tokenStore.wsConnections?.[id]?.client : null,
      ];
    },
    () => generation++,
    { flush: "sync" },
  );
  onScopeDispose(() => {
    disposed = true;
    generation++;
  });

  async function run(kind) {
    if (state.running || !["daily", "maintenance"].includes(kind)) return;
    const token = tokenStore.selectedToken;
    const tokenId = token?.id;
    const client = tokenStore.wsConnections?.[tokenId]?.client;
    if (
      !tokenId ||
      !client ||
      tokenStore.getWebSocketStatus(tokenId) !== "connected"
    )
      return;
    const name = token.name || "当前角色";
    manuallyStopped = false;
    const startGeneration = generation;
    const shouldStop = () =>
      disposed ||
      generation !== startGeneration ||
      tokenStore.selectedToken?.id !== tokenId ||
      tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
      tokenStore.wsConnections?.[tokenId]?.client !== client;
    Object.assign(state, {
      running: true,
      kind,
      tokenId,
      name,
      progress: "准备中",
    });
    delete results[tokenId];
    try {
      const settings =
        kind === "daily" ? { ...dependencies.readSettings(token) } : undefined;
      const execute =
        kind === "daily"
          ? dependencies.executeDaily
          : dependencies.executeMaintenance;
      const result = await execute({
        tokenId,
        settings,
        shouldStop,
        onProgress: (text) => {
          if (!shouldStop()) state.progress = text;
        },
      });
      if (disposed) return;
      if (shouldStop()) {
        results[tokenId] = {
          type: "warning",
          text: manuallyStopped
            ? `${name}：本轮已停止，请核对游戏状态。`
            : `${name}：账号或连接已变化，本轮已停止，请核对游戏状态。`,
        };
      } else if (kind === "daily") {
        if (
          !Number.isFinite(result?.incomplete) ||
          !Number.isFinite(result?.failed)
        )
          throw new Error("服务器执行结果不完整，请在日常页核对");
        const incomplete = Number(result?.incomplete) || 0;
        const failed = Number(result?.failed) || 0;
        const skippedText =
          Number.isSafeInteger(result?.skipped) && result.skipped >= 0
            ? `跳过 ${result.skipped} 项`
            : "跳过次数待确认";
        results[tokenId] =
          incomplete || failed
            ? {
                type: "warning",
                text: `${name}：本轮结束，${incomplete} 项待核对，${failed} 个步骤失败，${skippedText}。`,
              }
            : {
                type: "success",
                text: `${name}：每日任务本轮已完成，服务器状态已核对，${skippedText}。`,
              };
      } else {
        if (!Number.isFinite(result?.remaining) || !result?.legacy?.status)
          throw new Error("补给结果不完整，请在日常页核对");
        const warning =
          result?.remaining || result?.legacy?.status !== "acknowledged";
        const legacy =
          result?.legacy?.status === "acknowledged"
            ? "残卷领取请求已完成"
            : "残卷领取未确认";
        results[tokenId] = warning
          ? {
              type: "warning",
              text: `${name}：日常补给已结束；${legacy}，请查看日常页核对。`,
            }
          : { type: "success", text: `${name}：盐罐和挂机已处理，${legacy}。` };
      }
    } catch (error) {
      if (!disposed)
        results[tokenId] = {
          type: shouldStop() ? "warning" : "error",
          text: `${name}：本轮未完成，${error?.message || "请检查连接和设置"}。`,
        };
    } finally {
      Object.assign(state, {
        running: false,
        kind: "",
        tokenId: "",
        name: "",
        progress: "",
      });
    }
  }
  function stop() {
    if (!state.running || manuallyStopped) return;
    manuallyStopped = true;
    generation++;
    state.progress = "正在停止，等待当前请求结束";
  }
  return { state, results, run, stop };
}
