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
      <a-button
        type="primary"
        secondary
        size="small"
        block
        :disabled="disabled || isBusy || !hasState"
        @click="handleBottleHelper"
      >
        {{ state.isRunning ? "重启服务" : "启动服务" }}
      </a-button>
    </template>
  </MyCard>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
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

const syncFromRole = () => {
  const role = roleInfo.value?.role;
  if (!role?.bottleHelpers) return;
  const now = Date.now() / 1000;
  state.value.stopTime = role.bottleHelpers.helperStopTime;
  state.value.isRunning = role.bottleHelpers.helperStopTime > now;
  state.value.remainingTime = Math.max(
    0,
    Math.floor(role.bottleHelpers.helperStopTime - now),
  );
};

watch(roleInfo, () => syncFromRole(), { deep: true, immediate: true });

let timer = null;
onMounted(() => {
  timer = setInterval(() => {
    if (state.value.isRunning && state.value.remainingTime > 0) {
      state.value.remainingTime = Math.max(0, state.value.remainingTime - 1);
      if (state.value.remainingTime <= 0) state.value.isRunning = false;
    }
  }, 1000);
});
onUnmounted(() => {
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
