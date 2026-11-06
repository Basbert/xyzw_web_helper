<template>
  <div class="status-card tower-status">
    <div class="card-header">
      <img
        src="/icons/1733492491706148.png"
        alt="爬塔图标"
        class="status-icon"
      />
      <div class="status-info">
        <h3>咸将塔</h3>
        <p>一个不小心就过了</p>
      </div>
      <div class="energy-display">
        <img src="/icons/xiaoyugan.png" alt="小鱼干" class="energy-icon" />
        <span class="energy-count">{{
          isTowerConnected && Number.isFinite(roleInfo?.role?.tower?.energy)
            ? towerEnergy
            : "—"
        }}</span>
        <button
          class="buy-energy-button"
          :class="{ disabled: isBuying || isClimbing }"
          :disabled="!isTowerConnected || isBuying || isClimbing"
          @click="openBuyEnergyDialog"
        >
          购买
        </button>
      </div>
    </div>

    <!-- 购买小鱼干弹窗：Teleport 到 body，脱离 n-tabs animated 的 transform 包含块，
         否则 position: fixed 会失效导致弹窗跟随鼠标移动 -->
    <Teleport to="body">
      <div
        v-if="showBuyEnergyDialog"
        class="buy-energy-mask"
        @click.self="closeBuyEnergyDialog"
      >
        <div class="buy-energy-dialog" @click.stop>
          <div class="dialog-header">
            <h3>购买小鱼干</h3>
            <button class="dialog-close" @click="closeBuyEnergyDialog">
              ×
            </button>
          </div>
          <div class="dialog-body">
            <div class="dialog-row">
              <span class="row-label">购买数量</span>
              <div class="num-selector">
                <button class="num-btn" @click="changeBuyNum(-1)">-</button>
                <input
                  v-model.number="buyEnergyNum"
                  type="number"
                  min="1"
                  max="100"
                  class="num-input"
                  @blur="clampBuyNum"
                />
                <button class="num-btn" @click="changeBuyNum(1)">+</button>
              </div>
            </div>
            <div class="dialog-row">
              <span class="row-label">快捷选择</span>
              <div class="quick-btns">
                <button
                  v-for="n in [1, 10, 50, 100]"
                  :key="n"
                  class="quick-btn"
                  @click="buyEnergyNum = n"
                >
                  {{ n }}
                </button>
              </div>
            </div>
            <div class="dialog-hint">
              消耗
              <svg class="gold-icon" viewBox="0 0 24 24" aria-hidden="true">
                <defs>
                  <linearGradient id="goldFace" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#FFE082" />
                    <stop offset="55%" stop-color="#FFC107" />
                    <stop offset="100%" stop-color="#E6A117" />
                  </linearGradient>
                </defs>
                <path
                  d="M12 1.6 22 6.2 12 10.8 2 6.2Z"
                  fill="url(#goldFace)"
                  stroke="#B07600"
                  stroke-width="1.1"
                  stroke-linejoin="round"
                />
                <path
                  d="M2 6.2V17.8L12 22.4V10.8Z"
                  fill="#F9A825"
                  stroke="#B07600"
                  stroke-width="1.1"
                  stroke-linejoin="round"
                />
                <path
                  d="M22 6.2V17.8L12 22.4V10.8Z"
                  fill="#EFB218"
                  stroke="#B07600"
                  stroke-width="1.1"
                  stroke-linejoin="round"
                />
              </svg>
              金砖，每次购买 1-100 份小鱼干
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn-cancel" @click="closeBuyEnergyDialog">
              取消
            </button>
            <button
              class="btn-confirm"
              :class="{ disabled: buyEnergyNum < 1 || buyEnergyNum > 100 }"
              :disabled="
                !Number.isInteger(buyEnergyNum) ||
                buyEnergyNum < 1 ||
                buyEnergyNum > 100
              "
              @click="confirmBuyEnergy"
            >
              确认购买
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <div class="card-content">
      <div class="tower-details">
        <div class="tower-floor">
          <span class="label">当前层数</span>
          <span class="floor-number">{{ currentFloor }}</span>
        </div>
        <section
          v-if="isTowerConnected"
          class="tower-enemies"
          aria-label="本层敌方阵容"
        >
          <div class="enemies-heading">
            <h4>本层敌方阵容</h4>
            <span>查看不消耗次数</span>
          </div>
          <ul v-if="enemyLineup" class="enemy-list">
            <li v-for="(hero, index) in enemyLineup.heroes" :key="index">
              <img v-if="hero.avatar" :src="hero.avatar" :alt="hero.name" />
              <span>{{ hero.name }}</span>
            </li>
          </ul>
          <p v-else-if="isLoadingLineups" class="enemy-note">
            正在加载敌方阵容…
          </p>
          <p v-else-if="lineupLoadFailed" class="enemy-note">
            阵容加载失败，<button type="button" @click="loadTowerLineups">
              重试
            </button>
          </p>
          <p v-else class="enemy-note">暂无本层阵容数据</p>
          <p
            v-if="enemyLineup && lineupVersion === 'checking'"
            class="enemy-note"
          >
            正在核对游戏配置版本…
          </p>
          <p
            v-else-if="enemyLineup && lineupVersion === 'outdated'"
            class="enemy-warning"
          >
            游戏配置已更新，显示的敌方阵容仅供参考。
          </p>
          <p
            v-else-if="enemyLineup && lineupVersion === 'unknown'"
            class="enemy-warning"
          >
            暂时无法核对游戏配置版本，阵容仅供参考。
          </p>
        </section>
      </div>
    </div>

    <div class="card-actions">
      <button
        class="climb-button"
        :class="[
          {
            active: canClimb,
            disabled: !canClimb,
          },
        ]"
        :disabled="!canClimb"
        @click="startTowerClimb"
      >
        {{ isClimbing ? "爬塔中..." : "开始爬塔" }}
      </button>

      <!-- 停止批量爬塔按钮，仅批量时显示 -->
      <button v-if="isClimbing" class="stop-button" @click="stopClimbing">
        停止爬塔
      </button>
      <!-- 调试用的重置按钮，只在开发环境显示 -->
      <button v-if="false" class="reset-button" @click="resetClimbingState">
        重置状态
      </button>
    </div>
  </div>
</template>

<script setup>
import { useMessage } from "naive-ui";
// 停止批量爬塔操作
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT } from "@/utils/HeroList";
import {
  checkTowerConfigVersion,
  getTowerEnemyLineup,
  nextTowerStageId,
} from "@/utils/towerEnemyLineups";
import {
  createTowerPurchaseSession,
  purchaseTowerEnergy,
} from "@/utils/towerEnergyPurchase";
let stopFlag = false;

const stopClimbing = () => {
  stopFlag = true;
  if (climbTimeout.value) {
    clearTimeout(climbTimeout.value);
    climbTimeout.value = null;
  }
  message.info("正在停止爬塔");
};

const tokenStore = useTokenStore();
const message = useMessage();

// 响应式数据
const isClimbing = ref(false);
const isBuying = ref(false); // 购买小鱼干状态
const showBuyEnergyDialog = ref(false); // 购买弹窗显示
const buyDialogSession = ref(null); // 打开弹窗时的账号和连接
const buyEnergyNum = ref(1); // 购买数量（1-100）
const climbTimeout = ref(null); // 用于超时重置状态
// 最后一次爬塔结果

// 计算属性 - 从gameData中获取塔相关信息
const roleInfo = computed(() => {
  const data = tokenStore.gameData?.roleInfo || null;
  return data;
});
const isTowerConnected = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return (
    Boolean(tokenId) && tokenStore.getWebSocketStatus(tokenId) === "connected"
  );
});

const lineupData = shallowRef(null);
const lineupVersion = ref("checking");
const lineupLoadFailed = ref(false);
const isLoadingLineups = ref(false);
let lineupPromise = null;

function loadTowerLineups() {
  if (lineupData.value || lineupPromise) return lineupPromise;
  isLoadingLineups.value = true;
  lineupLoadFailed.value = false;
  lineupPromise = import("@/data/towerLineups.json")
    .then(({ default: data }) => {
      lineupData.value = data;
      checkTowerConfigVersion(data.configVersion).then((version) => {
        lineupVersion.value = version;
      });
    })
    .catch(() => {
      lineupLoadFailed.value = true;
      lineupPromise = null;
    })
    .finally(() => {
      isLoadingLineups.value = false;
    });
  return lineupPromise;
}

const enemyLineup = computed(() =>
  isTowerConnected.value
    ? getTowerEnemyLineup(
        roleInfo.value?.role?.tower?.id,
        lineupData.value,
        HERO_DICT,
      )
    : null,
);
watch(
  [isTowerConnected, () => roleInfo.value?.role?.tower?.id],
  ([connected, id]) => {
    if (connected && nextTowerStageId(id)) loadTowerLineups();
  },
  { immediate: true },
);

const currentFloor = computed(() => {
  if (!isTowerConnected.value) return "—";
  const stageId = nextTowerStageId(roleInfo.value?.role?.tower?.id);
  if (!stageId) return "—";
  const floor = Math.floor((stageId - 1) / 10) + 1;
  const layer = ((stageId - 1) % 10) + 1;
  return `${floor} - ${layer}`;
});

const towerEnergy = computed(() => {
  const tower = roleInfo.value?.role?.tower;

  const energy = tower?.energy || 0;
  return energy;
});

const canClimb = computed(() => {
  const hasEnergy = towerEnergy.value > 0;
  const notClimbing = !isClimbing.value;
  return isTowerConnected.value && hasEnergy && notClimbing && !isBuying.value;
});

// ==================== 购买小鱼干 ====================
// 接口来源：逆向 game bundle (game/index.140bc.jsc) 解密后源码
//   TowerService.buyEnergy({ buyNum: N })
// 对应 WebSocket 命令：tower_buyenergy
// 普通塔与普通咸鱼王参数为 buyNum（怪异塔是 energy）

const openBuyEnergyDialog = () => {
  if (!tokenStore.selectedToken) {
    message.warning("请先选择Token");
    return;
  }
  if (isClimbing.value || isBuying.value) {
    message.warning("正在执行其他操作，请稍候");
    return;
  }
  try {
    buyDialogSession.value = createTowerPurchaseSession(tokenStore);
  } catch (error) {
    message.warning(error.message || "请先连接账号");
    return;
  }
  buyEnergyNum.value = 1;
  showBuyEnergyDialog.value = true;
};

const closeBuyEnergyDialog = () => {
  if (isBuying.value) return;
  showBuyEnergyDialog.value = false;
};

const changeBuyNum = (delta) => {
  buyEnergyNum.value = Math.max(1, Math.min(100, buyEnergyNum.value + delta));
};

const clampBuyNum = () => {
  if (!buyEnergyNum.value || buyEnergyNum.value < 1) buyEnergyNum.value = 1;
  if (buyEnergyNum.value > 100) buyEnergyNum.value = 100;
};

/**
 * 确认购买小鱼干，发送购买指令并刷新塔能量。
 *
 * @returns {Promise<void>} 无返回值，结果通过 message 提示
 */
const confirmBuyEnergy = async () => {
  if (isBuying.value) return;
  const session = buyDialogSession.value;
  const quantity = buyEnergyNum.value;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    message.warning("购买数量必须是 1-100 的整数");
    return;
  }
  if (!session) {
    message.warning("请重新打开购买窗口");
    return;
  }
  const { tokenId, checkSession } = session;
  isBuying.value = true;
  showBuyEnergyDialog.value = false;
  try {
    const result = await purchaseTowerEnergy({
      tokenStore,
      tokenId,
      kind: "normal",
      quantity,
      checkSession,
    });
    if (result.status === "uncertain") {
      message.warning(
        "购买结果未确认，请先核对原账号的小鱼干和金砖，再决定是否重试",
      );
    } else if (result.status === "confirmed-unrefreshed") {
      message.warning("购买已确认，但未能读取原账号最新体力，请返回原账号核对");
    } else {
      message.success(`购买已确认，当前小鱼干 ${result.energy}`);
    }
  } catch (error) {
    message.warning(error.message || "无法确认购买，请重新检查账号");
  } finally {
    isBuying.value = false;
  }
};

// 方法
const startTowerClimb = async () => {
  if (!tokenStore.selectedToken) {
    message.warning("请先选择Token");
    return;
  }

  if (!canClimb.value) {
    message.warning("体力不足或正在爬塔中");
    return;
  }

  // 清除之前的超时
  if (climbTimeout.value) {
    clearTimeout(climbTimeout.value);
    climbTimeout.value = null;
  }

  isClimbing.value = true;
  stopFlag = false;
  let climbCount = 0;
  const maxClimb = 100; // 最多批量次数，防止死循环
  // 设置超时保护，60秒后自动重置状态
  climbTimeout.value = setTimeout(() => {
    climbTimeout.value = null;
    stopFlag = true;
    message.info("批量爬塔已超时自动停止");
  }, 60000);

  const tokenId = tokenStore.selectedToken.id;
  const client = tokenStore.wsConnections?.[tokenId]?.client;
  try {
    const checkSession = () => {
      if (
        !client ||
        tokenStore.selectedToken?.id !== tokenId ||
        tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
        tokenStore.wsConnections?.[tokenId]?.client !== client
      )
        throw new Error("账号或连接已变化，请重新检查爬塔状态");
    };
    for (let i = 0; i < maxClimb; i++) {
      if (stopFlag) break;
      checkSession();
      const response = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        10000,
      );
      checkSession();
      if (stopFlag) break;
      const energy = response?.role?.tower?.energy;
      if (!Number.isFinite(energy)) throw new Error("服务器未返回当前爬塔体力");
      if (energy <= 0) break;
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "fight_starttower",
        {},
        10000,
      );
      climbCount++;
      message.success(`第${climbCount}次爬塔命令已发送`);
      await new Promise((res) => setTimeout(res, 2000)); // 每次间隔2秒
    }
    if (stopFlag) message.info(`爬塔已停止，本次爬塔 ${climbCount} 次`);
    else message.success(`已自动爬塔${climbCount}次，体力已耗尽或达到上限。`);
  } catch (error) {
    message.error(`批量爬塔失败: ${error.message || "未知错误"}`);
  }

  // A stopped batch may have completed its last fight after the preceding read.
  if (
    climbCount > 0 &&
    client &&
    tokenStore.selectedToken?.id === tokenId &&
    tokenStore.getWebSocketStatus(tokenId) === "connected" &&
    tokenStore.wsConnections?.[tokenId]?.client === client
  ) {
    tokenStore.sendMessage(tokenId, "role_getroleinfo");
  }

  // 清除超时并重置状态
  if (climbTimeout.value) {
    clearTimeout(climbTimeout.value);
    climbTimeout.value = null;
  }
  isClimbing.value = false;
};

// 重置爬塔状态的方法
const resetClimbingState = () => {
  if (climbTimeout.value) {
    clearTimeout(climbTimeout.value);
    climbTimeout.value = null;
  }
  isClimbing.value = false;
  message.info("爬塔状态已重置");
};

const getTowerInfo = async () => {
  if (!tokenStore.selectedToken) {
    return;
  }

  try {
    const tokenId = tokenStore.selectedToken.id;
    // 检查WebSocket连接状态
    const wsStatus = tokenStore.getWebSocketStatus(tokenId);

    if (wsStatus !== "connected") {
      return;
    }
    // 首先获取角色信息，这包含了塔的数据
    tokenStore.sendMessage(tokenId, "role_getroleinfo");
    // 直接请求塔信息
    tokenStore.sendMessage(tokenId, "tower_getinfo");
  } catch (error) {
    // 获取塔信息失败：静默，避免噪声
  }
};

// 监听WebSocket连接状态变化
const wsStatus = computed(() => {
  if (!tokenStore.selectedToken) return "disconnected";
  return tokenStore.getWebSocketStatus(tokenStore.selectedToken.id);
});

// 监听WebSocket连接状态，连接成功后自动获取塔信息
watch(wsStatus, (newStatus, oldStatus) => {
  if (newStatus === "connected" && oldStatus !== "connected") {
    // 延迟一点时间让WebSocket完全就绪
    setTimeout(() => {
      getTowerInfo();
    }, 1000);
  }
});

// 监听选中Token变化
watch(
  () => tokenStore.selectedToken,
  (newToken, oldToken) => {
    if (newToken && newToken.id !== oldToken?.id) {
      // 检查WebSocket是否已连接
      const status = tokenStore.getWebSocketStatus(newToken.id);
      if (status === "connected") {
        getTowerInfo();
      }
    }
  },
);

// 监听爬塔结果
watch(
  () => tokenStore.gameData.towerResult,
  (newResult, oldResult) => {
    if (newResult && newResult.timestamp !== oldResult?.timestamp) {
      // 显示爬塔结果消息
      if (newResult.success) {
        message.success("咸将塔挑战成功！");

        if (newResult.autoReward) {
          setTimeout(() => {
            message.success(`自动领取第${newResult.rewardFloor}层奖励`);
          }, 1000);
        }
      } else {
        message.error("咸将塔挑战失败");
      }
    }
  },
  { deep: true },
);

// 生命周期
onMounted(() => {
  // 检查WebSocket客户端
  if (tokenStore.selectedToken) {
    tokenStore.getWebSocketClient(tokenStore.selectedToken.id);
  }

  // 组件挂载时获取塔信息
  if (tokenStore.selectedToken && wsStatus.value === "connected") {
    getTowerInfo();
  }
});
</script>

<style scoped lang="scss">
.stop-button {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border: 1px solid #e5e7eb;
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
  background: #fff;
  color: #e11d48;

  &:hover {
    background: #e11d48;
    color: white;
    border-color: #e11d48;
  }
}

// 使用GameStatus中的统一卡片样式
.tower-status {
  border-left: 4px solid #6366f1; // 咸将塔专用颜色
  display: flex;
  flex-direction: column;
  min-height: 240px; // 继续缩小整体高度
  padding: var(--spacing-lg);
}

.status-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.energy-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  background: var(--bg-tertiary);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-medium);
  margin-left: auto; // 使小鱼干展示靠右
}

.energy-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.energy-count {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

/* ==================== 购买小鱼干按钮 ==================== */
.buy-energy-button {
  padding: 2px 10px;
  margin-left: 4px;
  font-size: var(--font-size-xs, 12px);
  font-weight: var(--font-weight-medium);
  color: #fff;
  background: linear-gradient(135deg, #f7b733 0%, #fc4a1a 100%);
  border: none;
  border-radius: var(--border-radius-small, 6px);
  cursor: pointer;
  transition:
    opacity 0.2s,
    transform 0.15s;
  white-space: nowrap;
  line-height: 20px;
}

.buy-energy-button:hover:not(.disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(252, 74, 26, 0.35);
}

.buy-energy-button:active:not(.disabled) {
  transform: translateY(0);
}

.buy-energy-button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ==================== 购买小鱼干弹窗 ==================== */
.buy-energy-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: var(--spacing-md);
}

.buy-energy-dialog {
  width: 100%;
  max-width: 360px;
  background: var(--bg-primary, #fff);
  border-radius: var(--border-radius-large, 12px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.buy-energy-dialog .dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.buy-energy-dialog .dialog-header h3 {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.buy-energy-dialog .dialog-close {
  width: 28px;
  height: 28px;
  font-size: 20px;
  line-height: 1;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--border-radius-small, 6px);
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.buy-energy-dialog .dialog-close:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.buy-energy-dialog .dialog-body {
  padding: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.buy-energy-dialog .dialog-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.buy-energy-dialog .row-label {
  flex-shrink: 0;
  width: 76px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.num-selector {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.num-btn {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  font-size: 18px;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--border-radius-small, 6px);
  cursor: pointer;
  transition: background 0.2s;
}

.num-btn:hover {
  background: var(--bg-secondary);
}

.num-input {
  flex: 1;
  height: 36px;
  padding: 0 var(--spacing-sm);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  text-align: center;
  color: var(--text-primary);
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--border-radius-small, 6px);
  outline: none;
}

.num-input:focus {
  border-color: #fc4a1a;
  box-shadow: 0 0 0 2px rgba(252, 74, 26, 0.15);
}

.quick-btns {
  flex: 1;
  display: flex;
  gap: var(--spacing-xs);
}

.quick-btn {
  flex: 1;
  padding: 6px 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--border-radius-small, 6px);
  cursor: pointer;
  transition: all 0.2s;
}

.quick-btn:hover {
  color: #fc4a1a;
  border-color: #fc4a1a;
}

.dialog-hint {
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
  text-align: center;
  padding-top: var(--spacing-xs);
  border-top: 1px dashed var(--border-color, #e5e7eb);
}

.dialog-hint .gold-icon {
  width: 15px;
  height: 15px;
  vertical-align: -2px;
  margin: 0 2px;
}

.buy-energy-dialog .dialog-footer {
  display: flex;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-lg) var(--spacing-lg);
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  padding: 10px 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border-radius: var(--border-radius-small, 6px);
  cursor: pointer;
  transition:
    opacity 0.2s,
    transform 0.15s;
}

.btn-cancel {
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color, #e5e7eb);
}

.btn-cancel:hover {
  background: var(--bg-secondary);
}

.btn-confirm {
  color: #fff;
  background: linear-gradient(135deg, #f7b733 0%, #fc4a1a 100%);
  border: none;
}

.btn-confirm:hover:not(.disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(252, 74, 26, 0.4);
}

.btn-confirm.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.card-content {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-md);
  flex: 1; // 占据可用空间，使上下分布更均衡
  display: flex;
  align-items: center;
  min-width: 0;
}

.tower-details {
  width: 100%;
  min-width: 0;
}

.tower-floor {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-sm);

  .label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .floor-number {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    font-family: "SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace;
  }
}

.tower-enemies {
  border-top: 1px solid var(--border-color, #e5e7eb);
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
}

.enemies-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;

  h4 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  span {
    color: var(--text-secondary);
    font-size: 12px;
    white-space: nowrap;
  }
}

.enemy-list {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  padding: 0;
  margin: 12px 0 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    color: var(--text-primary);
    font-size: 12px;
    line-height: 1.3;
    text-align: center;
    overflow-wrap: anywhere;
  }

  img {
    width: min(100%, 52px);
    aspect-ratio: 1;
    object-fit: contain;
  }
}

.enemy-note,
.enemy-warning {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.45;
}

.enemy-note {
  color: var(--text-secondary);

  button {
    padding: 0;
    border: 0;
    background: transparent;
    color: #6366f1;
    cursor: pointer;
    text-decoration: underline;
  }
}

.enemy-warning {
  color: var(--warning-color, #b45309);
}

.card-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: auto;
  padding-top: var(--spacing-sm);
}

.climb-button {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border: none;
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all var(--transition-fast);

  &.active {
    background: #6366f1;
    color: white;

    &:hover {
      background: #5855eb;
    }
  }

  &.disabled {
    background: var(--bg-secondary);
    color: var(--text-tertiary);
    cursor: not-allowed;
  }
}

.reset-button {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  border: 1px solid var(--warning-color);
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--warning-color);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--warning-color);
    color: white;
  }
}

.debug-info {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-xs);
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-small);
  font-family: monospace;
  word-break: break-all;

  small {
    color: var(--text-secondary);
    font-size: 10px;
  }
}

// 响应式设计
@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
    gap: var(--spacing-sm);
    text-align: center;
  }

  .energy-display {
    align-self: center;
  }
}
</style>
