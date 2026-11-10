<template>
  <MyCard
    class="study"
    :status-class="{ weekly: true, completed: study.isCompleted }"
  >
    <template #icon>
      <img src="/icons/1736425783912140.png" alt="学习图标" />
    </template>
    <template #title>
      <h3>咸鱼大冲关</h3>
      <p>每日知识挑战</p>
    </template>
    <template #badge>
      <span>每周任务</span>
    </template>
    <template #default>
      <p class="description">没有什么可以阻挡我求知的欲望！</p>
    </template>
    <template #action>
      <n-button
        v-if="!study.thisWeek && isIdle"
        type="primary"
        :disabled="!isConnected"
        @click="startStudy"
      >
        🎯 一键答题
      </n-button>
      <n-button v-else-if="study.thisWeek" type="success" disabled>
        ✅ 已完成无需作答
      </n-button>
      <n-button v-else type="warning" disabled>
        {{ statusLabel }}
      </n-button>
      <p v-if="!isConnected && !study.thisWeek" class="connection-hint">
        请先连接账号
      </p>
    </template>
  </MyCard>
</template>

<script setup>
import { useMessage } from "naive-ui";

import { computed, onUnmounted, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { isSameGameValue } from "@/utils/gameValue.js";
import {
  getQuestionCount,
  preloadQuestions,
} from "@/utils/studyQuestionsFromJSON.js";
import MyCard from "../Common/MyCard.vue";

const tokenStore = useTokenStore();
const message = useMessage();
const study = computed(() => tokenStore.gameData.studyStatus || {});
const isConnected = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return !!tokenId && tokenStore.getWebSocketStatus(tokenId) === "connected";
});
const isIdle = computed(
  () =>
    isSameGameValue(study.value.status, "") ||
    isSameGameValue(study.value.status, "idel") ||
    study.value.status == null,
);
const statusLabel = computed(
  () =>
    ({
      starting: "正在获取题库…",
      answering: "答题中…",
      claiming_rewards: "正在领取奖励…",
      completed: "答题完成",
    })[study.value.status] || "正在处理…",
);

let sessionGeneration = 0;
let disposed = false;
const operations = new Map();
watch(
  [
    () => tokenStore.selectedToken?.id,
    () => tokenStore.getWebSocketStatus(tokenStore.selectedToken?.id),
    () => tokenStore.wsConnections?.[tokenStore.selectedToken?.id]?.client,
  ],
  () => {
    sessionGeneration++;
  },
  { flush: "sync" },
);
onUnmounted(() => {
  disposed = true;
  sessionGeneration++;
});

const startStudy = async () => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId || !isConnected.value || study.value.thisWeek || !isIdle.value)
    return;
  const accountData = tokenStore.gameData;
  const client = tokenStore.wsConnections?.[tokenId]?.client;
  const generation = sessionGeneration;
  const initialStatus = accountData.studyStatus;
  const isCurrent = () =>
    !disposed &&
    generation === sessionGeneration &&
    tokenStore.selectedToken?.id === tokenId &&
    tokenStore.getWebSocketStatus(tokenId) === "connected" &&
    tokenStore.wsConnections?.[tokenId]?.client === client;
  if (!client) return;
  initialStatus.status = "starting";
  let sent = false;
  let pendingStatus = initialStatus;
  try {
    await preloadQuestions();
    const questionCount = await getQuestionCount();
    if (!isCurrent()) return;
    if (accountData.studyStatus.isCompleted) {
      message.success("咸鱼大冲关任务已完成，无需重复作答");
      return;
    }
    accountData.studyStatus = {
      ...accountData.studyStatus,
      isAnswering: true,
      questionCount: 0,
      answeredCount: 0,
      status: "starting",
      timestamp: Date.now(),
    };
    pendingStatus = accountData.studyStatus;
    if (!tokenStore.sendMessage(tokenId, "study_startgame")) {
      throw new Error("连接不可用，请重新连接后重试");
    }
    sent = true;
    message.info(`开始一键答题（题库包含 ${questionCount} 道题目）`);
    const operation = Symbol("study");
    operations.set(tokenId, operation);
    setTimeout(() => {
      if (operations.get(tokenId) !== operation) return;
      operations.delete(tokenId);
      // Use the original account's store, even when another account is selected.
      const status = accountData.studyStatus;
      if (status.isAnswering && status.status !== "completed") {
        accountData.studyStatus = {
          ...status,
          isAnswering: false,
          questionCount: 0,
          answeredCount: 0,
          status: "",
          timestamp: null,
        };
        if (isCurrent()) message.warning("答题超时，已自动重置状态");
      }
    }, 40000);
  } catch (error) {
    if (isCurrent())
      message.error(`启动答题失败：${error.message || "未知错误"}`);
  } finally {
    if (!sent) {
      const status = accountData.studyStatus;
      if (status === pendingStatus && status.status === "starting") {
        status.isAnswering = false;
        status.status = "";
      }
    }
  }
};
</script>
