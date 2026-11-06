<template>
  <MyCard class="hang-up" :status-class="{ active: state.isRunning }">
    <template #icon>
      <img
        src="/icons/Ob7pyorzmHiJcbab2c25af264d0758b527bc1b61cc3b.png"
        alt="宝库图标"
      />
    </template>
    <template #title>
      <h3>宝库战斗</h3>
    </template>
    <template #default>
      <div class="time-display">宝库当前层数：{{ currentTower ?? "—" }}</div>
    </template>
    <template #action>
      <a-button
        type="primary"
        secondary
        size="small"
        block
        :loading="state.isRunning"
        :disabled="state.isRunning"
        @click="extendbosstower"
        >宝库战斗</a-button
      >
    </template>
  </MyCard>
</template>

<script setup>
import { useMessage } from "naive-ui";

import { computed, onUnmounted, ref } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { runBossTower } from "@/utils/bossTowerRunner.js";
import MyCard from "../Common/MyCard.vue";

const tokenStore = useTokenStore();
const message = useMessage();

let disposed = false;
onUnmounted(() => {
  disposed = true;
});

const bossTowerInfo = computed(() => {
  const data = tokenStore.gameData?.bossTowerInfo || null;
  return data;
});
const currentTower = computed(() => {
  const tower = bossTowerInfo.value?.bossTower;
  return tower?.towerId ?? null;
});
const state = ref({
  isRunning: false,
});

const extendbosstower = async () => {
  if (state.value.isRunning) return;
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId) return message.warning("请先选择账号");
  const checkActive = () => {
    if (
      disposed ||
      tokenStore.selectedToken?.id !== tokenId ||
      tokenStore.getWebSocketStatus(tokenId) !== "connected"
    ) {
      const error = new Error("账号已切换或连接断开，已停止后续宝库操作");
      error.interrupted = true;
      throw error;
    }
  };
  state.value.isRunning = true;
  try {
    const result = await runBossTower({ tokenStore, tokenId, checkActive });
    if (disposed || tokenStore.selectedToken?.id !== tokenId) return;
    if (!result.refreshed)
      message.warning("宝库指令已完成，但战况刷新失败，请手动刷新核对");
    else if (result.towerId <= 3)
      message.success("宝库操作已完成，请上线手动领取奖励");
    else message.success("宝库操作已完成");
  } catch (error) {
    if (!disposed) message.warning(error.message || "宝库操作未完成");
  } finally {
    state.value.isRunning = false;
  }
};
</script>

<style scoped lang="scss">
/* 按钮改用 Naive UI；time-display 样式由 MyCard 统一提供 */
</style>
