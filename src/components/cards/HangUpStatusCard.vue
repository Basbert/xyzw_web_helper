<template>
  <MyCard
    class="hang-up"
    :status-class="{ active: hasState && hangUp.isActive }"
  >
    <template #icon>
      <img src="/icons/174061875626614.png" alt="挂机图标" />
    </template>
    <template #title>
      <h3>挂机时间</h3>
      <p>已挂机：{{ hasState ? formatTime(hangUp.elapsedTime) : "—" }}</p>
    </template>
    <template #badge>
      <span>{{
        !hasState ? "状态待更新" : hangUp.isActive ? "挂机中" : "已完成"
      }}</span>
    </template>
    <template #default>
      <div class="time-display">
        {{ hasState ? formatTime(hangUp.remainingTime) : "—" }}
      </div>
    </template>
    <template #action>
      <button
        class="action-button secondary"
        :disabled="
          disabled || hangUp.isExtending || hangUp.isClaiming || !hasState
        "
        @click="extendHangUp"
      >
        <span v-if="hangUp.isExtending" class="loading-text">
          <i class="line-md:loading-loop"></i> 加钟中...
        </span>
        <span v-else>加钟</span>
      </button>
      <button
        class="action-button primary"
        :disabled="
          disabled || hangUp.isExtending || hangUp.isClaiming || !hasState
        "
        @click="claimHangUpReward"
      >
        <span v-if="hangUp.isClaiming" class="loading-text">
          <i class="line-md:loading-loop"></i> 领取中...
        </span>
        <span v-else>领取奖励</span>
      </button>
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
const roleInfo = computed(() => tokenStore.gameData?.roleInfo || null);
const hasState = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  const data = roleInfo.value?.role?.hangUp;
  return (
    Boolean(tokenId) &&
    tokenStore.getWebSocketStatus(tokenId) === "connected" &&
    Number.isFinite(data?.lastTime) &&
    Number.isFinite(data?.hangUpTime)
  );
});

const hangUp = ref({
  isActive: false,
  remainingTime: 0,
  elapsedTime: 0,
  lastTime: 0,
  hangUpTime: 0,
  isExtending: false,
  isClaiming: false,
});
defineExpose({
  isBusy: computed(() => hangUp.value.isExtending || hangUp.value.isClaiming),
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
  if (!role?.hangUp) return;
  const now = Date.now() / 1000;
  hangUp.value.lastTime = role.hangUp.lastTime;
  hangUp.value.hangUpTime = role.hangUp.hangUpTime;
  const elapsed = now - hangUp.value.lastTime;
  if (elapsed <= hangUp.value.hangUpTime) {
    hangUp.value.remainingTime = Math.floor(hangUp.value.hangUpTime - elapsed);
    hangUp.value.isActive = true;
  } else {
    hangUp.value.remainingTime = 0;
    hangUp.value.isActive = false;
  }
  hangUp.value.elapsedTime = Math.floor(
    hangUp.value.hangUpTime - hangUp.value.remainingTime,
  );
};

watch(roleInfo, () => syncFromRole(), { deep: true, immediate: true });

let timer = null;
onMounted(() => {
  timer = setInterval(() => {
    if (hangUp.value.isActive && hangUp.value.remainingTime > 0) {
      hangUp.value.remainingTime = Math.max(0, hangUp.value.remainingTime - 1);
      hangUp.value.elapsedTime = hangUp.value.elapsedTime + 1;
      if (hangUp.value.remainingTime <= 0) hangUp.value.isActive = false;
    }
  }, 1000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const extendHangUp = async () => {
  if (!tokenStore.selectedToken) return message.warning("请先选择Token");
  const tokenId = tokenStore.selectedToken.id;
  try {
    hangUp.value.isExtending = true;
    message.info("正在加钟...");
    const result = await runStandaloneDailyAction({
      tokenStore,
      tokenId,
      action: "extend",
    });
    if (result.remaining)
      message.warning(`仍有 ${result.remaining} 个加钟槽位未确认`);
    else message.success(`挂机加钟已补满（本次加钟 ${result.sent} 次）`);
  } catch (e) {
    message.error(`加钟操作失败: ${e?.message || "未知错误"}`);
  } finally {
    hangUp.value.isExtending = false;
  }
};

const claimHangUpReward = async () => {
  if (!tokenStore.selectedToken) return message.warning("请先选择Token");
  const tokenId = tokenStore.selectedToken.id;
  try {
    hangUp.value.isClaiming = true;
    message.info("正在领取挂机奖励...");
    const result = await runStandaloneDailyAction({
      tokenStore,
      tokenId,
      action: "claim",
    });
    if (result.refreshed) message.success("挂机奖励领取完成");
    else message.warning("领取请求已确认，但状态刷新失败，请稍后查看");
  } catch (e) {
    message.error(`领取挂机奖励失败: ${e?.message || "未知错误"}`);
  } finally {
    hangUp.value.isClaiming = false;
  }
};
</script>

<style scoped lang="scss">
/* 按钮改用 Naive UI；time-display 样式由 MyCard 统一提供 */
</style>
