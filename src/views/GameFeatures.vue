<template>
  <div class="game-features-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="container">
        <div class="header-content">
          <div class="header-left">
            <h1 class="page-title">游戏功能</h1>
            <p class="page-subtitle">
              {{ tokenStore.selectedToken?.name || "未选择Token" }}
            </p>
          </div>

          <div class="header-actions">
            <div class="connection-status" :class="connectionStatus">
              <n-icon>
                <CloudDone />
              </n-icon>
              <span>{{ connectionStatusText }}</span>
            </div>
            <n-button text :disabled="isConnecting" @click="toggleConnection">
              {{ isConnected ? "断开连接" : "重新连接" }}
            </n-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 恢复提示区域 -->
    <div v-if="recoveryNote" class="container recovery-note" role="status">
      <span>{{ recoveryNote }}</span>
      <n-button
        v-if="isBlockedByOtherTab"
        text
        type="primary"
        size="small"
        style="margin-left: 10px"
        @click="takeOverConnection"
      >
        在此页接管连接
      </n-button>
      <n-button
        v-else-if="
          credentialRecovery === 'relogin-required' ||
          credentialRecovery === 'refresh-unavailable'
        "
        text
        type="primary"
        size="small"
        style="margin-left: 10px"
        @click="router.push('/tokens')"
      >
        {{
          credentialRecovery === "relogin-required" ? "重新登录" : "账号管理"
        }}
      </n-button>
    </div>

    <!-- 功能模块网格 -->
    <div class="features-grid-section">
      <div class="container">
        <GameStatus />
      </div>
    </div>

    <!-- WebSocket 连接状态 -->
    <details class="ws-status-section container">
      <summary class="connection-details-toggle">连接详情</summary>
      <div class="ws-status-card">
        <div class="status-header">
          <h3>连接状态</h3>
          <n-button text :disabled="isConnecting" @click="toggleConnection">
            {{ isConnected ? "断开连接" : "重新连接" }}
          </n-button>
        </div>
        <div class="status-content">
          <div class="status-item">
            <span>WebSocket状态:</span>
            <span :class="connectionClass">{{ connectionStatusText }}</span>
          </div>
          <div v-if="tokenStore.selectedToken" class="status-item">
            <span>当前Token:</span>
            <span>{{ tokenStore.selectedToken.name }}</span>
          </div>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup>
import { CloudDone } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useTokenStore } from "@/stores/tokenStore";

const router = useRouter();
const message = useMessage();
const tokenStore = useTokenStore();

// 响应式数据
const connectingAccount = ref(null);
let connectionAttempt = 0;
let pageUnmounted = false;

// 计算属性
const connectionStatus = computed(() => {
  if (!tokenStore.selectedToken) return "disconnected";
  const tokenId = tokenStore.selectedToken.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected" && connectingAccount.value?.tokenId === tokenId)
    return "connecting";
  return ["connected", "connecting"].includes(status) ? status : "disconnected";
});

const connectionStatusText = computed(() => {
  if (!tokenStore.selectedToken) return "未选择Token";
  const status = connectionStatus.value;
  return status === "connected"
    ? "已连接"
    : status === "connecting"
      ? "连接中"
      : "未连接";
});

const connectionClass = computed(() => {
  return connectionStatus.value === "connected"
    ? "status-connected"
    : "status-disconnected";
});

const isConnected = computed(() => {
  return connectionStatus.value === "connected";
});

const credentialRecovery = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return tokenId && tokenStore.getConnectionCredentialRecovery?.(tokenId);
});
const isConnecting = computed(
  () =>
    connectionStatus.value === "connecting" ||
    credentialRecovery.value === "refreshing",
);

const isBlockedByOtherTab = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return Boolean(
    tokenId &&
    connectionStatus.value !== "connected" &&
    connectionStatus.value !== "connecting" &&
    tokenStore.isConnectionActiveInAnotherTab?.(tokenId),
  );
});

const recoveryNote = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  const state = tokenId && tokenStore.connectionRecoveryStatus?.[tokenId];
  if (isBlockedByOtherTab.value)
    return "该账号正在另一个助手标签页连接；关闭那个页面后会自动重试，或直接在此页接管。";
  if (credentialRecovery.value === "refreshing")
    return "正在更新登录凭据，请稍候。";
  if (credentialRecovery.value === "relogin-required")
    return "游戏登录接口确认凭据已过期。";
  if (credentialRecovery.value === "refresh-unavailable")
    return "暂时无法自动恢复，可手动重新连接或检查账号设置。";
  if (state === "waiting") {
    if (connectionStatus.value === "connecting")
      return "正在重新连接助手，请稍候。";
    return "暂未连接，正在自动重试。切到后台时浏览器可能暂停页面或延迟重连。";
  }
  if (state === "restored")
    return "连接已恢复，请先核对中断任务的状态和游戏内结果，再决定是否继续。";
  return "";
});

// 方法

// 已移除 sendWebSocketMessage，使用 tokenStore.sendMessage 代替

const connectWebSocket = async () => {
  if (!tokenStore.selectedToken) {
    message.warning("请先选择一个Token");
    router.push("/tokens");
    return;
  }

  const selected = tokenStore.selectedToken;
  const tokenId = selected.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (
    ["connected", "connecting"].includes(status) ||
    connectingAccount.value?.tokenId === tokenId
  )
    return;
  const attempt = ++connectionAttempt;
  connectingAccount.value = { tokenId, attempt };
  const isCurrentAttempt = () =>
    !pageUnmounted &&
    attempt === connectionAttempt &&
    tokenStore.selectedToken?.id === tokenId;

  try {
    const client = await tokenStore.createWebSocketConnection(
      tokenId,
      selected.token,
      selected.wsUrl,
    );
    if (!isCurrentAttempt()) return;
    const currentStatus = tokenStore.getWebSocketStatus(tokenId);
    if (!client && !["connected", "connecting"].includes(currentStatus)) {
      message.warning(
        tokenStore.isConnectionActiveInAnotherTab(tokenId)
          ? "该账号可能已在另一个助手页面连接，关闭那个页面后会自动重试"
          : "暂时无法建立助手连接，请检查网络或账号状态",
      );
    }
  } catch (error) {
    if (isCurrentAttempt()) {
      console.error("WebSocket连接失败:", error);
      message.error("助手连接未能建立，请稍后重试");
    }
  } finally {
    if (connectingAccount.value?.attempt === attempt)
      connectingAccount.value = null;
  }
};

const takeOverConnection = async () => {
  if (!tokenStore.selectedToken) return;
  const selected = tokenStore.selectedToken;
  const tokenId = selected.id;
  if (
    ["connected", "connecting"].includes(
      tokenStore.getWebSocketStatus(tokenId),
    ) ||
    connectingAccount.value?.tokenId === tokenId
  )
    return;
  const attempt = ++connectionAttempt;
  connectingAccount.value = { tokenId, attempt };
  const isCurrentAttempt = () =>
    !pageUnmounted &&
    attempt === connectionAttempt &&
    tokenStore.selectedToken?.id === tokenId;
  try {
    const client =
      typeof tokenStore.takeOverCrossTabConnection === "function"
        ? await tokenStore.takeOverCrossTabConnection(tokenId)
        : await tokenStore.createWebSocketConnection(
            tokenId,
            selected.token,
            selected.wsUrl,
          );
    if (!isCurrentAttempt()) return;
    const currentStatus = tokenStore.getWebSocketStatus(tokenId);
    if (!client && !["connected", "connecting"].includes(currentStatus)) {
      message.warning("暂时无法接管助手连接，请检查网络或账号状态");
    }
  } catch (error) {
    if (isCurrentAttempt()) {
      console.error("接管WebSocket连接失败:", error);
      message.error("接管助手连接失败，请稍后重试");
    }
  } finally {
    if (connectingAccount.value?.attempt === attempt)
      connectingAccount.value = null;
  }
};

const disconnectWebSocket = () => {
  if (tokenStore.selectedToken) {
    connectionAttempt++;
    connectingAccount.value = null;
    const tokenId = tokenStore.selectedToken.id;
    tokenStore.closeWebSocketConnection(tokenId);
    message.info("WebSocket连接已断开");
  }
};

const toggleConnection = () => {
  if (connectionStatus.value === "connected") {
    disconnectWebSocket();
  } else if (!isConnecting.value) {
    connectWebSocket();
  }
};

// handleWebSocketMessage 已移除，消息处理由 tokenStore 负责

// 生命周期
onMounted(() => {
  tokenStore.initConnectionCoordination();
  // 检查是否需要连接 WebSocket
  if (tokenStore.selectedToken) {
    const tokenId = tokenStore.selectedToken.id;
    const status = tokenStore.getWebSocketStatus(tokenId);
    if (
      status !== "connected" &&
      status !== "connecting" &&
      !credentialRecovery.value &&
      tokenStore.connectionRecoveryStatus?.[tokenId] !== "waiting"
    ) {
      connectWebSocket();
    } else if (status === "connected") {
      // 如果已连接，立即获取初始数据
      initializeGameData();
    }
  }
});

watch(
  () => tokenStore.selectedToken?.id,
  () => {
    connectionAttempt++;
    connectingAccount.value = null;
  },
  { flush: "sync" },
);

watch(
  [() => tokenStore.selectedToken?.id, connectionStatus],
  ([id, status], [previousId, previousStatus]) => {
    if (
      id &&
      status === "connected" &&
      (id !== previousId || previousStatus !== "connected")
    ) {
      initializeGameData({ readOnly: id !== previousId });
    }
  },
);

// 初始化游戏数据
const initializeGameData = async ({ readOnly = false } = {}) => {
  if (!tokenStore.selectedToken) return;

  try {
    const tokenId = tokenStore.selectedToken.id;
    // 获取初始化数据（静默）
    tokenStore.sendMessage(tokenId, "role_getroleinfo");
    tokenStore.sendMessage(tokenId, "tower_getinfo");
    tokenStore.sendMessage(tokenId, "evotower_getinfo");
    tokenStore.sendMessage(tokenId, "presetteam_getinfo");
    // This command's side effects are not confirmed. On automatic recovery,
    // retain the previously known battle version and do not send it again.
    if (
      readOnly ||
      tokenStore.connectionRecoveryStatus?.[tokenId] === "restored"
    )
      return;
    if (typeof tokenStore.ensureBattleVersion === "function") {
      await tokenStore.ensureBattleVersion(tokenId);
      return;
    }
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "fight_startlevel",
    );
    tokenStore.setBattleVersion(res?.battleData?.version, tokenId);
  } catch (error) {
    // 静默处理初始化异常
  }
};

onUnmounted(() => {
  pageUnmounted = true;
  connectionAttempt++;
});
</script>

<style scoped lang="scss">
.game-features-page {
  min-height: 100dvh;
  background: var(--bg-secondary);
  padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));
}

/* 深色主题下背景 */
[data-theme="dark"] .game-features-page {
  background: var(--bg-secondary);
}

// 页面头部
.page-header {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-light);
  padding: var(--spacing-lg) 0;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 var(--spacing-lg);
}

.recovery-note {
  margin-top: var(--spacing-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

@media (max-width: 768px) {
  .container {
    padding: 0 var(--spacing-md);
  }

  .page-header {
    padding: var(--spacing-md) 0;

    .header-content {
      gap: var(--spacing-sm);
    }

    .page-title {
      font-size: var(--font-size-xl);
    }
  }

  .features-grid-section {
    padding: var(--spacing-sm) 0;
  }

  .ws-status-section {
    padding: 0 0 var(--spacing-lg) 0;
  }

  .ws-status-card {
    padding: var(--spacing-md);
  }
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.page-title {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0 0 var(--spacing-xs) 0;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--font-size-md);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);

  &.connected {
    background: rgba(24, 160, 88, 0.1);
    color: var(--success-color);
  }

  &.disconnected {
    background: rgba(208, 48, 80, 0.1);
    color: var(--error-color);
  }

  &.connecting {
    background: rgba(245, 158, 11, 0.1);
    color: var(--warning-color);
  }
}

// 功能模块网格
.features-grid-section {
  padding: var(--spacing-md) 0;
}

.connection-details-toggle {
  padding: 8px 0;
  color: var(--text-secondary);
  cursor: pointer;
}

// WebSocket状态区域
.ws-status-section {
  padding: 0 0 var(--spacing-xl) 0;
}

.ws-status-card {
  background: var(--bg-primary);
  border-radius: var(--border-radius-large);
  padding: var(--spacing-lg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);

  h3 {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin: 0;
  }
}

.status-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--border-light);

  &:last-child {
    border-bottom: none;
  }

  span:first-child {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  span:last-child {
    font-weight: var(--font-weight-medium);
    font-size: var(--font-size-sm);
  }
}

.status-connected {
  color: var(--success-color);
}

.status-disconnected {
  color: var(--error-color);
}

// 响应式设计
@media (max-width: 768px) {
  .container {
    padding: 0 var(--spacing-md);
  }

  .header-content {
    flex-direction: row;
    gap: var(--spacing-sm);
    text-align: left;
  }
}
</style>
