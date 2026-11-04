<template>
  <div v-if="guessState.hasOpenGuesses" class="status-card apex-guess-card">
    <div class="card-header">
      <img
        src="/icons/legionCup.png"
        alt="逐鹿盐山"
        class="status-icon"
      />
      <div class="status-info">
        <h3>逐鹿盐山 · 竞猜</h3>
        <p>自动选择助威人数最多队伍</p>
      </div>
      <div class="header-right">
        <div
          class="status-badge"
          :class="{
            active: isGuessActive,
            completed: isAllCompleted,
          }"
        >
          <div
            class="status-dot"
            :class="{
              active: isGuessActive,
              completed: isAllCompleted,
            }"
          />
          <span>{{ badgeText }}</span>
        </div>
      </div>
    </div>

    <div class="card-content">
      <div class="guess-status-desc">
        <p class="summary-line">{{ statusSummary }}</p>
        <p v-if="subSummary" class="sub-line">{{ subSummary }}</p>
      </div>
    </div>

    <div class="card-actions">
      <button
        class="action-button"
        :disabled="isButtonDisabled"
        @click="handleAutoGuess"
      >
        <span v-if="isBusy" class="loading-text">
          <svg class="loading-icon" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 22c5.421 0 10-4.579 10-10h-2c0 4.337-3.663 8-8 8s-8-3.663-8-8c0-4.336 3.663-8 8-8V2C6.579 2 2 6.58 2 12c0 5.421 4.579 10 10 10z"
            />
          </svg>
          {{ progressText || "正在竞猜..." }}
        </span>
        <span v-else-if="!isConnected">连接后一键竞猜</span>
        <span v-else-if="!guessState.hasOpenGuesses">暂无开放竞猜</span>
        <span v-else-if="isAllCompleted">已全部竞猜完成</span>
        <span v-else>一键自动竞猜</span>
      </button>

      <button
        type="button"
        class="detail-link"
        @click="emit('navToApex')"
      >
        查看对阵详情与助威
      </button>
    </div>
  </div>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import {
  getApexGuessStatus,
  runApexAutoGuess,
} from "@/utils/apexGuessHelper.js";

const emit = defineEmits(["navToApex"]);

const tokenStore = useTokenStore();
const message = useMessage();

const isBusy = ref(false);
const progressText = ref("");
const guessState = ref({
  hasOpenGuesses: false,
  season: 0,
  openRoundsCount: 0,
  openStagesCount: 0,
  pendingStagesCount: 0,
  summaryText: "正在检查逐鹿盐山状态...",
  details: [],
});

const isConnected = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return (
    Boolean(tokenId) && tokenStore.getWebSocketStatus(tokenId) === "connected"
  );
});

const isGuessActive = computed(() => {
  return isConnected.value && guessState.value.hasOpenGuesses && guessState.value.pendingStagesCount > 0;
});

const isAllCompleted = computed(() => {
  return (
    isConnected.value &&
    guessState.value.hasOpenGuesses &&
    guessState.value.pendingStagesCount === 0
  );
});

const badgeText = computed(() => {
  if (!isConnected.value) return "未连接";
  if (!guessState.value.hasOpenGuesses) return "未开放";
  if (isAllCompleted.value) return "已竞猜";
  return `待竞猜 (${  guessState.value.pendingStagesCount  })`;
});

const statusSummary = computed(() => {
  if (!isConnected.value) return "连接账号后自动检测逐鹿盐山赛程与竞猜";
  return guessState.value.summaryText;
});

const subSummary = computed(() => {
  if (!isConnected.value || !guessState.value.hasOpenGuesses) return "";
  const parts = [];
  if (guessState.value.season > 0) parts.push(`第 ${  guessState.value.season  } 赛季`);
  parts.push(`共 ${  guessState.value.openStagesCount  } 个阶段开放`);
  return parts.join(" · ");
});

const isButtonDisabled = computed(() => {
  if (!isConnected.value || isBusy.value) return true;
  if (!guessState.value.hasOpenGuesses) return true;
  if (isAllCompleted.value) return true;
  return false;
});

const checkStatus = async (fetchRole = true) => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId || !isConnected.value) {
    guessState.value = {
      hasOpenGuesses: false,
      season: 0,
      openRoundsCount: 0,
      openStagesCount: 0,
      pendingStagesCount: 0,
      summaryText: "连接账号后自动检测逐鹿盐山赛程与竞猜",
      details: [],
    };
    return;
  }
  try {
    const res = await getApexGuessStatus(tokenStore, tokenId, { fetchRole });
    guessState.value = res;
  } catch {
    // 忽略异常保持上一次状态
  }
};

watch(
  () => [tokenStore.selectedToken?.id, isConnected.value],
  ([tokenId, connected]) => {
    if (tokenId && connected) {
      checkStatus(true);
    } else {
      checkStatus(false);
    }
  },
  { immediate: true },
);

const handleAutoGuess = async () => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId) {
    message.warning("请先选择账号");
    return;
  }
  if (isBusy.value) return;

  isBusy.value = true;
  progressText.value = "准备竞猜...";
  try {
    const res = await runApexAutoGuess({
      tokenStore,
      tokenId,
      onProgress: (txt) => {
        progressText.value = txt;
      },
      checkInterrupted: () => {
        if (tokenStore.selectedToken?.id !== tokenId) {
          throw new Error("账号已切换，停止竞猜");
        }
      },
    });

    if (res.successCount > 0) {
      message.success(res.message);
    } else if (res.failCount > 0) {
      message.warning(res.message);
    } else {
      message.info(res.message);
    }
    await checkStatus(true);
  } catch (err) {
    message.error(err.message || "竞猜过程出现异常");
  } finally {
    isBusy.value = false;
    progressText.value = "";
  }
};
</script>

<style scoped lang="scss">
.apex-guess-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
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
  }
}

.detail-link {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: 13px;
  text-align: center;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.loading-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  .loading-icon {
    width: 16px;
    height: 16px;
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>

