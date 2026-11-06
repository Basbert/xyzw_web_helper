<template>
  <div class="status-card apex-guess-card">
    <div class="card-header">
      <img src="/icons/legionCup.png" alt="" class="status-icon" />
      <div class="status-info">
        <h3>逐鹿盐山 · 竞猜</h3>
        <p>每场选择助威数较高的队伍</p>
      </div>
      <div class="header-right">
        <div
          class="status-badge"
          :class="{ active: isGuessActive, completed: isAllCompleted }"
        >
          <div
            class="status-dot"
            :class="{ active: isGuessActive, completed: isAllCompleted }"
          />
          <span>{{ badgeText }}</span>
        </div>
      </div>
    </div>

    <div class="card-content">
      <div class="guess-status-desc" aria-live="polite">
        <p class="summary-line">{{ guessState.summaryText }}</p>
        <p
          v-if="guessState.kind === 'ready' && guessState.hasOpenGuesses"
          class="sub-line"
        >
          已选过的对阵会跳过；助威数仅供参考，不代表胜率。
        </p>
      </div>
      <div v-if="lastResult" class="guess-result" aria-live="polite">
        <strong>{{ lastResult.message }}</strong>
        <details v-if="lastResult.entries.length">
          <summary>查看本次选择（{{ lastResult.entries.length }}）</summary>
          <ul>
            <li v-for="(entry, index) in lastResult.entries" :key="index">
              <span>{{ entry.title }} · {{ entry.name }}</span>
              <small>
                助威 {{ formatVotes(entry.votes) }} vs
                {{ formatVotes(entry.opponentVotes) }} ·
                {{
                  entry.status === "submitted"
                    ? "已提交"
                    : entry.status === "not-sent"
                      ? "未发送"
                      : "结果待确认"
                }}
              </small>
            </li>
          </ul>
        </details>
      </div>
    </div>

    <div class="card-actions">
      <button
        type="button"
        class="action-button"
        :disabled="isButtonDisabled"
        @click="handleAutoGuess"
      >
        {{ isBusy ? progressText || "正在竞猜…" : buttonText }}
      </button>
      <div class="secondary-actions">
        <button
          type="button"
          :disabled="!isConnected || checking || isBusy"
          @click="refresh"
        >
          {{ checking ? "正在刷新…" : "刷新状态" }}
        </button>
        <button type="button" @click="emit('navToApex')">
          查看对阵详情与助威
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, onUnmounted, ref, watch } from "vue";
import { useApexGuessStatus } from "@/hooks/useApexGuessStatus";
import { useTokenStore } from "@/stores/tokenStore";
import { runApexAutoGuess } from "@/utils/apexGuessHelper.js";

const props = defineProps({ active: { type: Boolean, default: true } });
const emit = defineEmits(["navToApex", "statusChange"]);
const tokenStore = useTokenStore();
const message = useMessage();
const {
  state: guessState,
  checking,
  connected: isConnected,
  refresh,
} = useApexGuessStatus(tokenStore, { isActive: () => props.active });
const isBusy = ref(false);
const progressText = ref("");
const lastResult = ref(null);
let disposed = false;

const isGuessActive = computed(
  () =>
    isConnected.value &&
    guessState.value.kind === "ready" &&
    guessState.value.pendingStagesCount > 0,
);
const isAllCompleted = computed(
  () =>
    isConnected.value &&
    guessState.value.kind === "ready" &&
    guessState.value.hasOpenGuesses &&
    !guessState.value.pendingStagesCount &&
    !guessState.value.uncertainStagesCount,
);
const badgeText = computed(() => {
  if (isBusy.value) return "竞猜中";
  if (!isConnected.value) return "未连接";
  if (guessState.value.kind === "loading") return "检查中";
  if (
    guessState.value.kind === "error" ||
    guessState.value.uncertainStagesCount
  )
    return "需检查";
  if (!guessState.value.hasOpenGuesses) return "暂无开放";
  if (isAllCompleted.value) return "已竞猜";
  return `待竞猜 ${guessState.value.pendingStagesCount} 阶段`;
});
const buttonText = computed(() => {
  if (!isConnected.value) return "连接后一键竞猜";
  if (guessState.value.kind === "loading") return "正在检查竞猜状态…";
  if (guessState.value.kind === "error") return "请先刷新状态";
  if (!guessState.value.hasOpenGuesses) return "暂无开放竞猜";
  if (isAllCompleted.value) return "已全部竞猜完成";
  if (!guessState.value.pendingStagesCount) return "请先查看对阵详情";
  return "一键自动竞猜";
});
const isButtonDisabled = computed(
  () =>
    !isConnected.value ||
    isBusy.value ||
    checking.value ||
    guessState.value.kind !== "ready" ||
    !guessState.value.pendingStagesCount,
);
const formatVotes = (value) => Number(value).toLocaleString("zh-CN");

watch(badgeText, (value) => emit("statusChange", value), { immediate: true });
watch(
  () => tokenStore.selectedToken?.id,
  () => {
    lastResult.value = null;
  },
);
onUnmounted(() => {
  disposed = true;
});

const handleAutoGuess = async () => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId || isBusy.value || isButtonDisabled.value) return;
  isBusy.value = true;
  lastResult.value = null;
  try {
    const result = await runApexAutoGuess({
      tokenStore,
      tokenId,
      onProgress: (text) => {
        if (!disposed && tokenStore.selectedToken?.id === tokenId)
          progressText.value = text;
      },
      checkInterrupted: () => {
        let reason = "";
        if (disposed) reason = "已离开页面";
        else if (tokenStore.selectedToken?.id !== tokenId)
          reason = "账号已切换";
        else if (tokenStore.getWebSocketStatus(tokenId) !== "connected")
          reason = "账号连接已断开";
        if (reason) {
          const error = new Error(reason);
          error.interrupted = true;
          throw error;
        }
      },
    });
    if (disposed) return;
    if (tokenStore.selectedToken?.id === tokenId) {
      lastResult.value = result;
      if (result.outcome === "partial" || result.outcome === "stopped")
        message.warning(result.message);
      else if (result.outcome === "completed" && result.successCount)
        message.success(result.message);
      else message.info(result.message);
      await refresh();
    } else {
      message.warning(`原账号${result.message}`);
    }
  } catch (error) {
    if (!disposed) message.error(error.message || "竞猜过程出现异常");
  } finally {
    isBusy.value = false;
    progressText.value = "";
  }
};
</script>

<style scoped lang="scss">
.apex-guess-card {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.card-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  margin-bottom: 16px;
}
.status-info {
  min-width: 0;
  h3 {
    margin: 0 0 5px;
    color: var(--text-primary);
    font-size: 16px;
    line-height: 1.4;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.4;
  }
}
.status-badge {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  white-space: nowrap;
}
.status-dot.active,
.status-dot.completed {
  background: currentColor;
}
.card-actions .action-button {
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border: 0;
  border-radius: 8px;
  background: #18a058;
  color: #fff;
  font: inherit;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #14834a;
  }
  &:disabled {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: not-allowed;
  }
}
.card-actions button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}
.guess-status-desc {
  padding: 4px 0 8px;
  .summary-line {
    margin: 0;
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 500;
  }
  .sub-line {
    margin: 6px 0 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
}
.guess-result {
  margin: 8px 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #f4f5f7);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  summary {
    margin-top: 6px;
    cursor: pointer;
    color: var(--primary-color);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }
  li + li {
    margin-top: 8px;
  }
  small {
    display: block;
    color: var(--text-secondary);
  }
}
.secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 10px;
  button {
    padding: 6px 0;
    border: none;
    background: transparent;
    color: var(--primary-color);
    font-size: 13px;
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
    &:disabled {
      color: var(--text-secondary);
      cursor: not-allowed;
    }
  }
}
</style>
