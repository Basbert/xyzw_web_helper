<template>
  <MyCard
    class="bottle-helper"
    :status-class="{ active: hasState && state.isRunning }"
  >
    <template #icon>
      <img src="/icons/173746572831736.png" alt="盐罐图标" />
    </template>
    <template #title>
      <h3>盐罐机器人</h3>
      <p>剩余时间</p>
    </template>
    <template #badge>
      <span>{{
        !hasState ? "状态待更新" : state.isRunning ? "运行中" : "已停止"
      }}</span>
    </template>
    <template #default>
      <div class="time-display">
        {{ hasState ? formatTime(state.remainingTime) : "—" }}
      </div>
    </template>
    <template #action>
      <n-button
        type="primary"
        secondary
        size="small"
        block
        :disabled="disabled || isBusy || !hasState"
        @click="handleBottleHelper"
      >
        {{ state.isRunning ? "重启服务" : "启动服务" }}
      </n-button>
    </template>
  </MyCard>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import {
  getEstimatedServerNowSec,
  sampleFromWebSocketClient,
} from "@/utils/serverClock";
import { runStandaloneDailyAction } from "@/utils/standaloneDailyActions";
import MyCard from "../Common/MyCard.vue";

defineProps({ disabled: { type: Boolean, default: false } });

const tokenStore = useTokenStore();
const message = useMessage();
const isBusy = ref(false);
defineExpose({ isBusy });

const roleInfo = computed(() => tokenStore.gameData?.roleInfo || null);
const hasState = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return (
    Boolean(tokenId) &&
    tokenStore.getWebSocketStatus(tokenId) === "connected" &&
    Number.isFinite(roleInfo.value?.role?.bottleHelpers?.helperStopTime)
  );
});

const state = ref({
  isRunning: false,
  remainingTime: 0,
  stopTime: 0,
});

const formatTime = (seconds) => {
  const total = Math.floor(Number(seconds) || 0);
  if (total <= 0) return "00:00:00";
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};

let serverTimeSample = null;
let sampledTokenId = null;

const resetState = () => {
  serverTimeSample = null;
  sampledTokenId = null;
  state.value.stopTime = 0;
  state.value.remainingTime = 0;
  state.value.isRunning = false;
};

const recomputeFromTimestamp = () => {
  if (!Number.isFinite(state.value.stopTime) || state.value.stopTime <= 0) {
    state.value.isRunning = false;
    state.value.remainingTime = 0;
    return;
  }
  const nowSec = getEstimatedServerNowSec(serverTimeSample);
  const remaining = Math.max(0, Math.floor(state.value.stopTime - nowSec));
  state.value.remainingTime = remaining;
  state.value.isRunning = remaining > 0;
};

const syncFromRole = () => {
  const tokenId = tokenStore.selectedToken?.id;
  const stopTime = roleInfo.value?.role?.bottleHelpers?.helperStopTime;
  if (!tokenId || !Number.isFinite(stopTime)) {
    resetState();
    return;
  }
  const client = tokenStore.wsConnections?.[tokenId]?.client;
  serverTimeSample = sampleFromWebSocketClient(
    client,
    sampledTokenId === tokenId ? serverTimeSample : null,
  );
  sampledTokenId = tokenId;
  state.value.stopTime = stopTime;
  recomputeFromTimestamp();
};

watch(
  () => [
    tokenStore.selectedToken?.id,
    roleInfo.value?.role?.bottleHelpers?.helperStopTime,
    tokenStore.selectedToken?.id
      ? tokenStore.wsConnections?.[tokenStore.selectedToken.id]?.client
          ?.serverTime
      : null,
    tokenStore.selectedToken?.id
      ? tokenStore.wsConnections?.[tokenStore.selectedToken.id]?.client
          ?.serverTimeSampledAt
      : null,
  ],
  () => syncFromRole(),
  { immediate: true },
);

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") {
    recomputeFromTimestamp();
  }
};

let timer = null;
onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  timer = setInterval(() => {
    recomputeFromTimestamp();
  }, 1000);
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (timer) clearInterval(timer);
});

const handleBottleHelper = async () => {
  if (!tokenStore.selectedToken) {
    message.warning("请先选择Token");
    return;
  }
  const tokenId = tokenStore.selectedToken.id;
  isBusy.value = true;
  try {
    message.info("正在处理盐罐机器人...");
    const result = await runStandaloneDailyAction({
      tokenStore,
      tokenId,
      action: "bottle",
    });
    message.success(
      result.wasRunning ? "盐罐机器人已重启" : "盐罐机器人已启动",
    );
  } catch (error) {
    message.error(`盐罐操作未完成：${error.message || "未知错误"}`);
  } finally {
    isBusy.value = false;
  }
};
</script>

<style scoped lang="scss">
/* 样式遵循全局变量；time-display 样式由 MyCard 统一提供 */
</style>
