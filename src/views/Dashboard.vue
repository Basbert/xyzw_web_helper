<template>
  <div class="dashboard-page">
    <!-- 主要内容 -->
    <main class="dashboard-main">
      <div class="main-container">
        <div class="dashboard-heading">
          <div>
            <p class="dashboard-date">
              {{ currentDate }}
              <span v-if="currentActivityWeek" class="activity-week-pill">
                本周：{{ currentActivityWeek }}
              </span>
            </p>
            <h1>今天的操作</h1>
            <p>从常用任务开始，其他功能随时可以打开。</p>
          </div>
          <button
            class="account-link"
            type="button"
            @click="handleManageTokens"
          >
            切换账号
          </button>
        </div>

        <div class="account-strip">
          <img src="/icons/173746572831736.png" alt="" />
          <div
            class="account-name"
            :title="
              [tokenStore.selectedToken?.name, tokenStore.selectedToken?.server]
                .filter(Boolean)
                .join(' · ')
            "
          >
            <strong>{{
              tokenStore.selectedToken?.name || "尚未选择账号"
            }}</strong>
            <span>{{
              tokenStore.selectedToken?.server || "在账号管理中选择角色"
            }}</span>
          </div>
          <span class="connection-pill" :class="{ connected: isConnected }">
            <span class="connection-dot" aria-hidden="true"></span
            >{{ connectionLabel }}
          </span>
          <n-button
            v-if="tokenStore.selectedToken && !isConnected"
            size="small"
            :loading="isConnecting"
            :disabled="isConnecting"
            @click="connectSelectedAccount"
          >
            {{ isConnecting ? "连接中" : "连接" }}
          </n-button>
        </div>

        <div
          v-if="accountNotice"
          class="account-notice"
          :class="`is-${accountNotice.type}`"
          role="status"
          aria-live="polite"
        >
          <span>{{ accountNotice.text }}</span>
          <n-button
            v-if="accountNotice.showRelogin"
            size="tiny"
            type="warning"
            secondary
            @click="handleManageTokens"
          >
            重新登录
          </n-button>
        </div>

        <DailyActivityReminders @navigate="openReminder" />

        <section class="today-panel" aria-label="今日常用操作">
          <div class="today-heading">
            <div>
              <h2>日常操作</h2>
              <p>为当前账号执行，也可以进入日常页查看详情</p>
            </div>
          </div>
          <div class="today-items">
            <button
              type="button"
              class="today-item"
              @click="openDailyTarget('tasks')"
            >
              <img src="/icons/174023274867420.png" alt="" />
              <span class="today-item-name">
                <strong>每日任务</strong>
                <span>按当前角色的设置执行</span>
              </span>
              <span v-if="isConnected" class="today-item-status">
                <span>当前进度</span><strong>{{ dailyProgress }}</strong>
              </span>
            </button>
            <button
              type="button"
              class="today-item"
              @click="openDailyTarget('maintenance')"
            >
              <img src="/icons/173746572831736.png" alt="" />
              <span class="today-item-name">
                <strong>盐罐、挂机与残卷</strong>
                <span>一键处理盐罐、挂机和功法残卷</span>
              </span>
              <span v-if="isConnected" class="today-item-status">
                <span>{{ maintenanceSummary }}</span>
              </span>
            </button>
            <button
              type="button"
              class="today-item"
              @click="openDailyTarget('apex')"
            >
              <img src="/icons/legionCup.png" alt="" />
              <span class="today-item-name">
                <strong>逐鹿盐山竞猜</strong>
                <span>每场按助威数选择队伍</span>
              </span>
              <span class="today-item-status">
                <span>{{ apexGuessTip }}</span>
              </span>
            </button>
          </div>
          <div class="quick-actions">
            <n-button
              type="primary"
              size="large"
              :disabled="!isConnected || dailyActions.state.running"
              :loading="
                dailyActions.state.running &&
                dailyActions.state.kind === 'daily'
              "
              @click="dailyActions.run('daily')"
              >执行每日任务</n-button
            >
            <n-button
              type="primary"
              size="large"
              secondary
              :disabled="!isConnected || dailyActions.state.running"
              :loading="
                dailyActions.state.running &&
                dailyActions.state.kind === 'maintenance'
              "
              @click="dailyActions.run('maintenance')"
              >一键处理盐罐、挂机与残卷</n-button
            >
            <n-button
              v-if="dailyActions.state.running"
              size="large"
              @click="dailyActions.stop()"
              >停止后续操作</n-button
            >
          </div>
          <p class="quick-note">
            每日任务按当前角色设置执行；付费招募、黑市及梦境购买开启时可能消耗资源。
            离开页面会停止后续操作。
            <button type="button" @click="openDailyTarget('tasks')">
              查看任务设置
            </button>
          </p>
          <p
            v-if="dailyActions.state.running"
            class="quick-result"
            role="status"
            aria-live="polite"
          >
            正在为 {{ dailyActions.state.name }} 执行：{{
              dailyActions.state.progress
            }}
          </p>
          <p
            v-else-if="dashboardDailyResult"
            class="quick-result"
            role="status"
            aria-live="polite"
          >
            {{ dashboardDailyResult.text }}
          </p>
          <details v-if="dashboardDailyLogs.length" class="quick-logs">
            <summary>
              查看本次执行日志（{{ dashboardDailyLogs.length }} 条）
            </summary>
            <ul class="quick-log-list">
              <li
                v-for="(entry, index) in dashboardDailyLogs"
                :key="`${entry.time}-${index}`"
              >
                <span class="quick-log-time">{{ entry.time }}</span>
                <span>{{ entry.text }}</span>
              </li>
            </ul>
          </details>
          <n-button size="small" @click="router.push('/admin/game-features')"
            >进入日常页</n-button
          >
        </section>

        <section class="other-actions" aria-label="其他功能">
          <h2>其他功能</h2>
          <div class="other-action-list">
            <button
              type="button"
              @click="router.push('/admin/batch-daily-tasks')"
            >
              <strong>批量日常</strong><span>管理多账号与定时计划</span>
            </button>
            <button type="button" @click="openGame">
              <strong>打开游戏</strong><span>使用当前账号进入游戏</span>
            </button>
            <button type="button" @click="handleManageTokens">
              <strong>账号管理</strong><span>添加或切换账号</span>
            </button>
          </div>
          <details class="advanced-links">
            <summary>高级工具</summary>
            <button type="button" @click="router.push('/websocket-test')">
              WebSocket 测试
            </button>
          </details>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DailyActivityReminders from "@/components/DailyActivityReminders.vue";
import { useDashboardDailyActions } from "@/composables/useDashboardDailyActions";
import { useApexGuessStatus } from "@/hooks/useApexGuessStatus";
import useIndexedDB from "@/hooks/useIndexedDB";
import { formatShanghaiDate, useShanghaiClock } from "@/hooks/useShanghaiClock";
import { useTokenStore } from "@/stores/tokenStore";
import { compactApexGuessStatus } from "@/utils/apexGuessHelper.js";
import { getCurrentActivityWeek } from "@/utils/batch/viewHelpers";
import { runBottleAndHangUp } from "@/utils/bottleAndHangUp";
import { runDailyTasks } from "@/utils/daily/runDailyTasks.js";
import {
  DAILY_TASK_DEFAULTS,
  readDailyTaskSettingsForExecution,
} from "@/utils/dailyTaskSettings";
import { convertBinToLx } from "@/utils/gameLauncher";

const router = useRouter();
const openDailyTarget = (daily) => {
  if (["tasks", "maintenance", "apex"].includes(daily))
    return router.push({ path: "/admin/game-features", query: { daily } });
};
const openReminder = (kind) => {
  if (kind === "legionWar") {
    return router.push("/admin/legion-war");
  }
  if (kind === "daily") {
    return router.push({
      path: "/admin/game-features",
      query: { daily: "tasks" },
    });
  }
  return router.push({
    path: "/admin/game-features",
    query: { reminder: kind },
  });
};
const message = useMessage();
const tokenStore = useTokenStore();
const { getArrayBuffer } = useIndexedDB();
const { state: apexGuessState } = useApexGuessStatus(tokenStore);
const dailyActions = useDashboardDailyActions(tokenStore, {
  readSettings: (token) => ({
    ...DAILY_TASK_DEFAULTS,
    ...readDailyTaskSettingsForExecution(token, tokenStore.gameTokens || []),
  }),
  executeMaintenance: ({ tokenId, shouldStop, onProgress }) =>
    runBottleAndHangUp({ tokenStore, tokenId, shouldStop, onProgress }),
  executeDaily: ({ tokenId, settings, shouldStop, onProgress }) =>
    runDailyTasks({
      tokenStore,
      tokenId,
      settings,
      callbacks: {
        shouldStop,
        onLog: (item) => onProgress(item.message),
        onProgress: (progress) =>
          onProgress(`服务器每日任务完成并领奖：${progress}%`),
      },
    }),
});
const dashboardDailyResult = computed(
  () => dailyActions.results[tokenStore.selectedToken?.id] || null,
);
const dashboardDailyLogs = computed(() => {
  if (
    dailyActions.state.running &&
    dailyActions.state.tokenId === tokenStore.selectedToken?.id
  ) {
    return dailyActions.state.logs || [];
  }
  return dashboardDailyResult.value?.logs || [];
});

const openGame = async () => {
  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择一个Token");
    return;
  }
  const binData = await getArrayBuffer(token.id);
  if (!binData) {
    message.error("未找到该Token的BIN数据");
    return;
  }
  const converted = convertBinToLx(binData);
  const hex = Array.from(converted)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  localStorage.setItem(`bin_data_${token.id}`, hex);
  localStorage.setItem("current_bin_id", token.id);
  let binList = [];
  try {
    binList = JSON.parse(localStorage.getItem("bin_file_list") || "[]");
  } catch (e) {}
  if (!binList.find((i) => i.id === token.id)) {
    binList.push({
      id: token.id,
      name: token.name || "Token",
      byteLength: binData.byteLength,
      size: `${(binData.byteLength / 1024).toFixed(1)} KB`,
      order: binList.length,
    });
    localStorage.setItem("bin_file_list", JSON.stringify(binList));
  }
  router.push("/game");
};

// 响应式数据
// const recentActivities = ref([]);

// 计算属性
const now = useShanghaiClock();
const currentDate = computed(() => formatShanghaiDate(now.value));
const currentActivityWeek = computed(() => getCurrentActivityWeek(now.value));
const secondTickMs = ref(Date.now());
let secondTimer = null;

const isConnected = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return (
    Boolean(tokenId) && tokenStore.getWebSocketStatus(tokenId) === "connected"
  );
});

const connectingAccount = ref(null);
const isConnecting = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId) return false;
  return (
    connectingAccount.value === tokenId ||
    tokenStore.getWebSocketStatus(tokenId) === "connecting"
  );
});

const pendingBattleVersionIds = new Set();
const ensureDashboardBattleVersion = async (tokenId) => {
  if (!tokenId || pendingBattleVersionIds.has(tokenId)) return;
  if (tokenStore.connectionRecoveryStatus?.[tokenId] === "restored") return;
  const accountData = tokenStore.getAccountGameData?.(tokenId)?.value;
  if (accountData?.battleVersion) return;

  pendingBattleVersionIds.add(tokenId);
  try {
    const response = await tokenStore.sendMessageWithPromise(
      tokenId,
      "fight_startlevel",
    );
    const version = response?.battleData?.version;
    if (version && tokenStore.getWebSocketStatus(tokenId) === "connected") {
      tokenStore.setBattleVersion(version, tokenId);
    }
  } catch {
    // 战斗版本号初始化失败不阻断首页使用
  } finally {
    pendingBattleVersionIds.delete(tokenId);
  }
};

watch(
  [() => tokenStore.selectedToken?.id, isConnected],
  ([tokenId, connected]) => {
    if (tokenId && connected) {
      ensureDashboardBattleVersion(tokenId);
    }
  },
  { immediate: true },
);

const connectSelectedAccount = async () => {
  const token = tokenStore.selectedToken;
  if (!token || isConnected.value || isConnecting.value) return;

  connectingAccount.value = token.id;
  try {
    const client = await tokenStore.createWebSocketConnection(
      token.id,
      token.token,
      token.wsUrl,
    );
    if (tokenStore.selectedToken?.id !== token.id) return;
    if (!client && tokenStore.getWebSocketStatus(token.id) !== "connected") {
      message.warning("暂时无法建立连接，请检查账号状态或稍后重试");
    }
  } catch {
    if (tokenStore.selectedToken?.id === token.id)
      message.error("连接未能建立，请稍后重试");
  } finally {
    connectingAccount.value = null;
  }
};

const apexGuessTip = computed(() => {
  if (!isConnected.value) return "未连接";
  if (apexGuessState.value.kind === "loading") return "检查中";
  if (apexGuessState.value.kind !== "ready") return "状态待确认";
  return compactApexGuessStatus(apexGuessState.value);
});

const connectionLabel = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId) return "未选择账号";
  const status = tokenStore.getWebSocketStatus(tokenId);
  return status === "connected"
    ? "已连接"
    : status === "connecting"
      ? "连接中"
      : "未连接";
});

const dailyProgress = computed(() => {
  if (!isConnected.value) return "连接后查看";
  const point = tokenStore.gameData?.roleInfo?.role?.dailyTask?.dailyPoint;
  return Number.isFinite(point)
    ? `${Math.min(Math.max(point, 0), 100)}%`
    : "等待更新";
});

const formatCompactDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}小时${String(m).padStart(2, "0")}分`;
  const s = total % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
};

const maintenanceSummary = computed(() => {
  if (!isConnected.value) return "未连接";
  const role = tokenStore.gameData?.roleInfo?.role;
  const tokenId = tokenStore.selectedToken?.id;
  if (!role || !tokenId) return "等待更新";
  const client = tokenStore.wsConnections?.[tokenId]?.client;
  const nowSec =
    Number.isFinite(client?.serverTime) && client.serverTime > 0
      ? client.serverTime / 1000
      : secondTickMs.value / 1000;

  const parts = [];
  const bottleStop = role.bottleHelpers?.helperStopTime;
  if (Number.isFinite(bottleStop)) {
    const left = Math.floor(bottleStop - nowSec);
    parts.push(left > 0 ? `盐罐剩 ${formatCompactDuration(left)}` : "盐罐已停");
  }
  const hangUp = role.hangUp;
  if (
    Number.isFinite(hangUp?.lastTime) &&
    Number.isFinite(hangUp?.hangUpTime)
  ) {
    const left = Math.floor(hangUp.lastTime + hangUp.hangUpTime - nowSec);
    parts.push(left > 0 ? `挂机剩 ${formatCompactDuration(left)}` : "挂机已满");
  }
  return parts.length ? parts.join(" · ") : "等待更新";
});

const accountNotice = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId || isConnected.value) return null;
  const conn = tokenStore.wsConnections?.[tokenId];
  const lastError = conn?.lastError?.error || "";
  if (/凭据已失效|token expired|重新登录/i.test(lastError)) {
    return {
      type: "warning",
      text: "当前账号登录凭据已失效，请前往账号管理扫码或验证码原地刷新（无需清除账号）。",
      showRelogin: true,
    };
  }
  const recovery = tokenStore.connectionRecoveryStatus?.[tokenId];
  if (recovery === "waiting") {
    return {
      type: "info",
      text: "连接已断开，正在自动等待重连；若长时间未恢复可点击重新登录。",
      showRelogin: true,
    };
  }
  return null;
});

const handleManageTokens = () => {
  // 降噪
  /* 当前Token状态:
    hasTokens: tokenStore.hasTokens,
    selectedToken: tokenStore.selectedToken?.name,
    tokenCount: tokenStore.gameTokens.length
  */

  try {
    router.push("/tokens");
    // 降噪
  } catch (error) {
    console.error("❌ 导航失败:", error);
    message.error("导航到Token管理页面失败");
  }
};

/*
const getActivityIcon = (type) => {
  switch (type) {
    case "success":
      return CheckmarkCircle;
    case "warning":
      return Time;
    case "info":
    default:
      return Cube;
  }
};

const formatTime = (timestamp) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days > 0) {
    return `${days}天前`;
  } else if (hours > 0) {
    return `${hours}小时前`;
  } else if (minutes > 0) {
    return `${minutes}分钟前`;
  } else {
    return "刚刚";
  }
};
*/

// 生命周期
onMounted(async () => {
  // 确保有Token
  if (!tokenStore.hasTokens) {
    router.push("/tokens");
    return;
  }

  // 初始化Token数据
  tokenStore.initTokenStore();

  // 进入首页时自动为当前选中账号建立连接，减少每次手动点“连接”
  const selected = tokenStore.selectedToken;
  if (
    selected &&
    tokenStore.getWebSocketStatus(selected.id) === "disconnected" &&
    !tokenStore.isConnectionActiveInAnotherTab?.(selected.id)
  ) {
    connectSelectedAccount();
  }

  secondTimer = window.setInterval(() => {
    if (isConnected.value && document.visibilityState === "visible") {
      secondTickMs.value = Date.now();
    }
  }, 1000);
});

onUnmounted(() => {
  if (secondTimer) {
    window.clearInterval(secondTimer);
    secondTimer = null;
  }
});
</script>

<style scoped lang="scss">
.dashboard-page {
  min-height: 100dvh;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.dashboard-main {
  padding: 36px 28px 64px;
}

.main-container {
  max-width: 1160px;
  margin: 0 auto;
}

.dashboard-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;

  h1 {
    margin: 4px 0 6px;
    font-size: 28px;
    line-height: 1.25;
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
  }
}

.dashboard-date {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.activity-week-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-color-light, rgba(24, 160, 88, 0.12));
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 600;
}

.account-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 16px;
  border-radius: 10px;
  font-size: 13px;
  border: 1px solid var(--border-light);
  background: var(--bg-primary);

  &.is-warning {
    border-color: rgba(240, 160, 32, 0.45);
    background: rgba(240, 160, 32, 0.08);
    color: var(--text-primary);
  }
}

.quick-logs {
  width: 100%;
  font-size: 13px;
  color: var(--text-secondary);

  summary {
    width: fit-content;
    cursor: pointer;
    color: var(--primary-color);
  }
}

.quick-log-list {
  margin: 8px 0 0;
  padding: 10px 12px;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  border-radius: 6px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;

  li {
    display: flex;
    gap: 8px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
}

.quick-log-time {
  flex: none;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.account-link,
.advanced-links button {
  border: 0;
  padding: 6px 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 14px;
}

.account-link {
  flex-shrink: 0;
  white-space: nowrap;
}

.account-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  margin-bottom: 20px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 12px;

  img {
    width: 36px;
    height: 36px;
    object-fit: contain;
  }
}

.account-name {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
  }
  span {
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.connection-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  white-space: nowrap;
  font-size: 13px;

  &.connected {
    background: rgba(24, 160, 88, 0.1);
    color: var(--success-color);
  }
}

.connection-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}

.today-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
  min-width: 0;
  padding: 24px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-top: 3px solid var(--primary-color);
  border-radius: 14px;

  :deep(.n-button) {
    min-width: 180px;
    margin-top: auto;
  }
}

.today-heading {
  h2 {
    margin: 0 0 4px;
    font-size: 18px;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
}

.quick-note,
.quick-result {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.quick-note button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font: inherit;
}

.quick-result {
  width: 100%;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
  overflow-wrap: anywhere;
}

.today-items {
  width: 100%;
  border-top: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
}

.today-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 14px 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--bg-secondary);
  }

  & + & {
    border-top: 1px solid var(--border-light);
  }

  img {
    width: 36px;
    height: 36px;
    object-fit: contain;
    flex-shrink: 0;
  }
}

.today-item-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;

  strong {
    font-size: 15px;
  }
  span {
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.today-item-status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: right;
  overflow-wrap: anywhere;

  strong {
    color: var(--text-primary);
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }
}

.other-actions {
  margin-top: 30px;

  h2 {
    margin: 0 0 12px;
    font-size: 16px;
  }
}

.other-action-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;

  button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 18px;
    text-align: left;
    background: var(--bg-primary);
    border: 1px solid var(--border-light);
    border-radius: 10px;
    color: var(--text-primary);
    cursor: pointer;
  }

  button:hover {
    border-color: var(--primary-color);
  }
  span {
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.advanced-links {
  margin-top: 18px;
  color: var(--text-secondary);
  font-size: 14px;
  summary {
    cursor: pointer;
  }
}

:global(html[data-theme="dark"] .dashboard-page .account-link),
:global(html[data-theme="dark"] .dashboard-page .advanced-links button) {
  color: #bdc8ff;
}

:global(
  html[data-theme="dark"] .dashboard-page .today-panel .n-button--primary-type
) {
  --n-color: #167a4c !important;
  --n-color-hover: #20935b !important;
  --n-color-pressed: #10653e !important;
}

button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}

@media (max-width: 700px) {
  .dashboard-main {
    padding: 22px 16px 52px;
  }
  .dashboard-heading {
    align-items: flex-start;
  }
  .dashboard-heading h1 {
    font-size: 24px;
  }
  .other-action-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .today-panel {
    padding: 20px;
    gap: 16px;
  }
  .today-panel :deep(.n-button) {
    width: 100%;
  }
  .other-action-list button {
    padding: 14px 16px;
  }
}

@media (max-width: 430px) {
  .today-item {
    flex-wrap: wrap;
  }
  .today-item-name {
    flex-basis: calc(100% - 48px);
  }
  .today-item-status {
    flex-basis: calc(100% - 48px);
    justify-content: space-between;
    margin-left: 48px;
    text-align: left;
  }
}
</style>
