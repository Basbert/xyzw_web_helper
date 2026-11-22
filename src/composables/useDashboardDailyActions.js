import { onScopeDispose, reactive, watch } from "vue";

/** Bind a dashboard operation to its initial account and connection. */
export function useDashboardDailyActions(tokenStore, dependencies) {
  const MAX_LOGS = 200;
  const state = reactive({
    running: false,
    kind: "",
    tokenId: "",
    name: "",
    progress: "",
    logs: [],
  });
  const results = reactive({});
  let generation = 0;
  let disposed = false;
  let manuallyStopped = false;
  const appendLog = (entries, text) => {
    if (!text) return;
    entries.push({
      time: new Date().toLocaleTimeString(),
      text: String(text),
    });
    if (entries.length > MAX_LOGS) {
      entries.splice(0, entries.length - MAX_LOGS);
    }
  };
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
    const runLogs = [];
    Object.assign(state, {
      running: true,
      kind,
      tokenId,
      name,
      progress: "准备中",
      logs: runLogs,
    });
    appendLog(
      runLogs,
      kind === "daily" ? "开始执行每日任务" : "开始处理盐罐、挂机与残卷",
    );
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
          if (!shouldStop()) {
            state.progress = text;
            appendLog(runLogs, text);
          }
        },
      });
      if (disposed) return;
      if (shouldStop()) {
        const text = manuallyStopped
          ? `${name}：本轮已停止，请核对游戏状态。`
          : `${name}：账号或连接已变化，本轮已停止，请核对游戏状态。`;
        appendLog(runLogs, text);
        results[tokenId] = {
          type: "warning",
          text,
          logs: [...runLogs],
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
        const text =
          incomplete || failed
            ? `${name}：本轮结束，${incomplete} 项待核对，${failed} 个步骤失败，${skippedText}。`
            : `${name}：每日任务本轮已完成，服务器状态已核对，${skippedText}。`;
        appendLog(runLogs, text);
        results[tokenId] = {
          type: incomplete || failed ? "warning" : "success",
          text,
          logs: [...runLogs],
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
        const text = warning
          ? `${name}：日常补给已结束；${legacy}，请查看日常页核对。`
          : `${name}：盐罐和挂机已处理，${legacy}。`;
        appendLog(runLogs, text);
        results[tokenId] = {
          type: warning ? "warning" : "success",
          text,
          logs: [...runLogs],
        };
      }
    } catch (error) {
      if (!disposed) {
        const text = `${name}：本轮未完成，${error?.message || "请检查连接和设置"}。`;
        appendLog(runLogs, text);
        results[tokenId] = {
          type: shouldStop() ? "warning" : "error",
          text,
          logs: [...runLogs],
        };
      }
    } finally {
      Object.assign(state, {
        running: false,
        kind: "",
        tokenId: "",
        name: "",
        progress: "",
        logs: [],
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
