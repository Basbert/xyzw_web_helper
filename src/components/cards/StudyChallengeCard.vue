<template>
  <MyCard class="study" :status-class="{ weekly: true }">
    <template #icon>
      <img src="/icons/1736425783912140.png" alt="" />
    </template>
    <template #title>
      <h3>咸鱼大冲关</h3>
    </template>
    <template #badge>
      <span>每周任务</span>
    </template>
    <template #default>
      <p class="description">
        一键每日会检查本周进度，未完成时尝试答题并领奖。
      </p>
    </template>
    <template #action>
      <n-button
        type="primary"
        :loading="Boolean(phase)"
        :disabled="!isConnected || Boolean(phase)"
        @click="startStudy"
      >
        {{ phaseLabel }}
      </n-button>
      <p v-if="!isConnected" class="connection-hint">请先连接账号</p>
    </template>
  </MyCard>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, onUnmounted, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { loadDailyTaskConfig } from "@/utils/dailyTaskState";
import { runWeeklyQuiz } from "@/utils/weeklyQuiz.js";
import MyCard from "../Common/MyCard.vue";

const tokenStore = useTokenStore();
const message = useMessage();
const tokenId = computed(() => tokenStore.selectedToken?.id);
const isConnected = computed(
  () =>
    !!tokenId.value &&
    tokenStore.getWebSocketStatus(tokenId.value) === "connected",
);
const phase = computed(() => tokenStore.gameData.weeklyQuizPhase);
const phaseLabel = computed(
  () =>
    ({
      checking: "正在核对本周进度…",
      answering: "答题中…",
      claiming: "正在领取奖励…",
    })[phase.value] || "检查并答题",
);

let sessionGeneration = 0;
watch(
  [tokenId, isConnected],
  () => {
    sessionGeneration++;
  },
  { flush: "sync" },
);
onUnmounted(() => {
  sessionGeneration++;
});

const startStudy = async () => {
  const id = tokenId.value;
  if (!isConnected.value || phase.value) return;
  const generation = sessionGeneration;
  const check = () => {
    if (generation !== sessionGeneration) {
      const error = new Error("角色、连接或页面已变化，停止答题");
      error.interrupted = true;
      throw error;
    }
  };

  try {
    const quiz = await runWeeklyQuiz({
      tokenStore,
      tokenId: id,
      check,
      loadConfig: async () =>
        (await loadDailyTaskConfig(tokenStore, id)).weeklyQuiz,
    });
    check();
    if (quiz.status === "pending") message.warning(quiz.message);
    else if (quiz.status === "completed") message.success(quiz.message);
    else message.info(quiz.message);
  } catch (error) {
    if (generation === sessionGeneration) message.warning(error.message);
  }
};
</script>
