import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { getApexGuessStatus } from "@/utils/apexGuessHelper.js";

const emptyStatus = (kind, summaryText) => ({
  kind,
  summaryText,
  hasOpenGuesses: false,
  pendingStagesCount: 0,
  remainingSlots: 0,
  uncertainStagesCount: 0,
  openStagesCount: 0,
  claimState: "unknown",
  claimableRewards: [],
  details: [],
});

/** Keep status scoped to the selected connected account. */
export function useApexGuessStatus(tokenStore, { isActive = () => true } = {}) {
  const state = ref(emptyStatus("disconnected", "连接账号后查看竞猜状态"));
  const checking = ref(false);
  const connected = computed(() => {
    const id = tokenStore.selectedToken?.id;
    return Boolean(id) && tokenStore.getWebSocketStatus(id) === "connected";
  });
  let sequence = 0;
  let disposed = false;
  let timer;

  const refresh = async () => {
    const tokenId = tokenStore.selectedToken?.id;
    if (!tokenId || !connected.value || !isActive() || disposed) return;
    const request = ++sequence;
    checking.value = true;
    state.value = emptyStatus("loading", "正在检查竞猜状态…");
    try {
      const checkInterrupted = () => {
        if (
          disposed ||
          request !== sequence ||
          tokenStore.selectedToken?.id !== tokenId ||
          !connected.value ||
          !isActive()
        )
          throw new Error("状态检查已取消");
      };
      const result = await getApexGuessStatus(tokenStore, tokenId, {
        checkInterrupted,
      });
      if (
        disposed ||
        request !== sequence ||
        tokenStore.selectedToken?.id !== tokenId ||
        !connected.value ||
        !isActive()
      )
        return;
      state.value = { ...result, kind: "ready" };
    } catch {
      if (
        disposed ||
        request !== sequence ||
        tokenStore.selectedToken?.id !== tokenId ||
        !connected.value ||
        !isActive()
      )
        return;
      state.value = emptyStatus("error", "暂时无法获取竞猜状态，请刷新重试");
    } finally {
      if (!disposed && request === sequence) checking.value = false;
    }
  };

  watch(
    () => {
      const id = tokenStore.selectedToken?.id;
      return [
        id,
        connected.value,
        isActive(),
        id ? tokenStore.wsConnections?.[id]?.client : null,
      ];
    },
    ([id, isConnected, active]) => {
      sequence++;
      checking.value = false;
      state.value = emptyStatus("disconnected", "连接账号后查看竞猜状态");
      if (id && isConnected && active) refresh();
    },
    { immediate: true, flush: "sync" },
  );

  const refreshIfVisible = () => {
    if (
      document.visibilityState === "visible" &&
      connected.value &&
      isActive() &&
      !checking.value
    )
      refresh();
  };
  onMounted(() => {
    document.addEventListener("visibilitychange", refreshIfVisible);
    timer = window.setInterval(refreshIfVisible, 60000);
  });
  onUnmounted(() => {
    disposed = true;
    sequence++;
    document.removeEventListener("visibilitychange", refreshIfVisible);
    window.clearInterval(timer);
  });

  return { state, checking, connected, refresh };
}
