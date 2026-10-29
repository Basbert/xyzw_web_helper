<template>
  <div class="dashboard-page">
    <!-- 主要内容 -->
    <main class="dashboard-main">
      <div class="main-container">
        <div class="dashboard-heading">
          <div>
            <p class="dashboard-date">{{ currentDate }}</p>
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
          <div class="account-name">
            <strong>{{
              tokenStore.selectedToken?.name || "尚未选择账号"
            }}</strong>
            <span>{{
              tokenStore.selectedToken?.server || "在账号管理中选择角色"
            }}</span>
          </div>
          <span class="connection-pill" :class="{ connected: isConnected }">{{
            connectionLabel
          }}</span>
        </div>

        <section class="today-grid" aria-label="今日常用操作">
          <article class="today-panel daily-panel">
            <div class="panel-heading">
              <img src="/icons/174023274867420.png" alt="" />
              <div>
                <h2>每日任务</h2>
                <p>使用当前角色保存的任务设置</p>
              </div>
            </div>
            <div class="daily-progress">
              <span>当前进度</span><strong>{{ dailyProgress }}</strong>
            </div>
            <n-button
              type="primary"
              size="large"
              @click="router.push('/admin/game-features')"
              >打开每日任务</n-button
            >
          </article>
          <article class="today-panel maintenance-summary">
            <div class="panel-heading">
              <img src="/icons/173746572831736.png" alt="" />
              <div>
                <h2>盐罐与挂机</h2>
                <p>领奖励、补挂机时间和处理盐罐</p>
              </div>
            </div>
            <p class="panel-note">
              {{
                isConnected
                  ? "可在日常页查看两项状态。"
                  : "连接后可查看两项状态。"
              }}
            </p>
            <n-button size="large" @click="router.push('/admin/game-features')"
              >前往处理</n-button
            >
          </article>
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
import lz4 from "lz4js";
import { useMessage } from "naive-ui";
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import useIndexedDB from "@/hooks/useIndexedDB";
import { useTokenStore } from "@/stores/tokenStore";

const router = useRouter();
const message = useMessage();
const tokenStore = useTokenStore();
const { getArrayBuffer } = useIndexedDB();

// ============ BIN 格式转换 ============

function extractKey(bytes) {
  return (
    (((bytes[2] >> 6) & 1) << 7) |
    (((bytes[2] >> 4) & 1) << 6) |
    (((bytes[2] >> 2) & 1) << 5) |
    ((bytes[2] & 1) << 4) |
    (((bytes[3] >> 6) & 1) << 3) |
    (((bytes[3] >> 4) & 1) << 2) |
    (((bytes[3] >> 2) & 1) << 1) |
    (bytes[3] & 1)
  );
}

function encodeKey(bytes, r) {
  bytes[2] =
    (bytes[2] & 0b10101010) |
    (((r >> 7) & 1) << 6) |
    (((r >> 6) & 1) << 4) |
    (((r >> 5) & 1) << 2) |
    ((r >> 4) & 1);
  bytes[3] =
    (bytes[3] & 0b10101010) |
    (((r >> 3) & 1) << 6) |
    (((r >> 2) & 1) << 4) |
    (((r >> 1) & 1) << 2) |
    (r & 1);
}

function xDecrypt(buf) {
  const e = new Uint8Array(buf);
  const t = extractKey(e);
  const out = new Uint8Array(e);
  for (let n = out.length; --n >= 4;) out[n] ^= t;
  return out.subarray(4);
}

function lxEncrypt(plain) {
  const compressed = lz4.compress(plain);
  const out = new Uint8Array(compressed.length);
  out.set(compressed);
  const r = 2 + ~~(Math.random() * 248);
  for (let n = Math.min(out.length, 100); --n >= 0;) out[n] ^= r;
  out[0] = 112;
  out[1] = 108;
  encodeKey(out, r);
  return out;
}

function convertBinToLx(buf) {
  const e = new Uint8Array(buf);
  if (e.length > 4 && e[0] === 112 && e[1] === 108) return e;
  if (e.length > 4 && e[0] === 112 && e[1] === 120) {
    const plain = xDecrypt(e);
    return lxEncrypt(plain);
  }
  return e;
}

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
const currentDate = computed(() => {
  return new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
});

const isConnected = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return (
    Boolean(tokenId) && tokenStore.getWebSocketStatus(tokenId) === "connected"
  );
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

.today-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 16px;
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
  border-radius: 14px;

  :deep(.n-button) {
    min-width: 180px;
    margin-top: auto;
  }
}

.daily-panel {
  border-top: 3px solid var(--primary-color);
}

.panel-heading {
  display: flex;
  align-items: center;
  gap: 14px;

  img {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }
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

.daily-progress {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: baseline;
  padding: 14px 0;
  border-top: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 14px;

  strong {
    color: var(--text-primary);
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }
}

.panel-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
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
  .today-grid,
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
</style>
