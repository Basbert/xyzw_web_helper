import { computed, onBeforeUnmount, reactive, watch } from "vue";

// A card can be unmounted while its last request is still in flight.
const activeAccounts = new Set();

// A run belongs to the exact account and connection that started it.
export function useManualBatchRun(tokenStore, message) {
  const state = reactive({
    isRunning: false,
    stopRequested: false,
    visible: false,
    completed: 0,
    total: 0,
    available: null,
    result: "",
  });
  const tokenId = computed(() => tokenStore.selectedToken?.id || null);
  const connected = computed(
    () =>
      !!tokenId.value &&
      tokenStore.getWebSocketStatus(tokenId.value) === "connected",
  );
  let generation = 0;
  watch(
    () => [
      tokenId.value,
      connected.value,
      tokenId.value && tokenStore.getWebSocketClient(tokenId.value),
    ],
    () => {
      generation++;
      if (state.isRunning) state.stopRequested = true;
      state.visible = false;
    },
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    generation++;
    state.stopRequested = true;
  });

  const stop = () => {
    state.stopRequested = true;
  };
  const run = async (task, options) => {
    if (state.isRunning) return;
    const id = tokenId.value;
    if (!id || !connected.value) {
      message.warning("请先连接当前角色");
      return;
    }
    if (activeAccounts.has(id)) {
      message.warning("当前角色的上一项操作仍在结束，请稍候");
      return;
    }
    activeAccounts.add(id);
    const myGeneration = generation;
    const client = tokenStore.getWebSocketClient(id);
    const current = () =>
      generation === myGeneration &&
      tokenId.value === id &&
      connected.value &&
      tokenStore.getWebSocketClient(id) === client;
    Object.assign(state, {
      isRunning: true,
      stopRequested: false,
      visible: true,
      completed: 0,
      total: 0,
      available: null,
      result: "",
    });
    try {
      const result = await task({
        ...options,
        send: (cmd, params) =>
          tokenStore.sendMessageWithPromise(id, cmd, params, 5000),
        shouldContinue: () => current() && !state.stopRequested,
        onProgress: (progress) => {
          if (current()) Object.assign(state, progress);
        },
      });
      if (!current()) return;
      const progress = `已获回包的请求共涉及 ${result.completed}/${result.total} 次`;
      if (result.status === "completed") {
        state.result =
          result.total < options.requested
            ? `${progress}。已按现有库存上限发送，实际结果以游戏内为准。`
            : `${progress}。已发送全部请求，实际结果以游戏内为准。`;
      } else if (result.status === "empty") {
        state.result = "当前没有可用物品，未执行。";
      } else if (result.status === "stopped") {
        state.result = `${progress}，已停止后续操作。实际结果以游戏内为准。`;
      } else if (result.status === "unconfirmed") {
        state.result = `${progress}。本次请求结果未确认，请在游戏中核对后再操作。`;
      } else {
        state.result = `${progress}。已停止：${result.error}`;
      }
      // Refresh the displayed inventory without sending any more consuming commands.
      if (result.completed > 0 || result.status === "unconfirmed") {
        tokenStore.sendMessage(id, "role_getroleinfo");
        if (options.refreshActivity) tokenStore.sendMessage(id, "activity_get");
      }
    } catch (error) {
      if (current()) state.result = `未能开始：${error?.message || "请求失败"}`;
    } finally {
      activeAccounts.delete(id);
      state.isRunning = false;
      state.stopRequested = false;
    }
  };
  return { state, connected, run, stop };
}
