<template>
  <section class="status-card compass-card" aria-labelledby="compass-title">
    <header class="compass-header">
      <div>
        <h3 id="compass-title">十殿 · 罗盘寻宝</h3>
        <p>一键抽完已有次数，并查看奖励。</p>
      </div>
      <button
        class="refresh-button"
        type="button"
        :disabled="!connected || busy || loading"
        @click="refresh"
      >
        {{ loading ? "刷新中…" : "刷新次数" }}
      </button>
    </header>

    <p v-if="!connected" class="notice">请先连接游戏角色，再刷新可用次数。</p>
    <p v-else-if="errorText" class="notice error" role="alert">
      {{ errorText }}
    </p>
    <p v-else-if="!state" class="notice">请刷新次数后操作。</p>

    <div class="compass-group">
      <div class="group-title">
        <strong>混沌罗盘</strong
        ><span>剩余 {{ showCount(state?.chaos) }} 次</span>
      </div>
      <p>自动抽完剩余次数，并领取可用的赠送次数后继续抽取。</p>
      <p v-if="chaosBonusProgress !== null">
        {{ busy && drawing === "chaos" ? "开始前赠送进度" : "赠送进度" }}
        {{ chaosBonusProgress % CHAOS_BONUS_THRESHOLD }}/{{
          CHAOS_BONUS_THRESHOLD
        }}
        · 待领取 {{ Math.floor(chaosBonusProgress / CHAOS_BONUS_THRESHOLD) }} 次
      </p>
      <p v-else>赠送进度尚未确认</p>
      <button
        class="primary-button"
        type="button"
        :disabled="!canDrawChaos"
        @click="drawChaos"
      >
        {{
          busy && drawing === "chaos"
            ? progressText
            : state?.chaos === 0 && chaosBonusProgress >= CHAOS_BONUS_THRESHOLD
              ? "领取赠送次数并抽取"
              : "抽取全部剩余次数"
        }}
      </button>
    </div>

    <div class="compass-group">
      <div class="group-title">
        <strong>星级罗盘</strong><span>每次消耗对应颜色钥匙 1 把</span>
      </div>
      <p>
        白色 {{ showCount(state?.star?.white) }} 把 · 绿色
        {{ showCount(state?.star?.green) }} 把 · 蓝色
        {{ showCount(state?.star?.blue) }} 把
      </p>
      <p>
        按白、绿、蓝顺序抽完，预计消耗
        {{ starTotal === null ? "—" : starTotal }} 把钥匙。{{
          starTotal > MAX_STAR_DRAWS
            ? `当前超过单次安全上限 ${MAX_STAR_DRAWS} 把，暂无法自动抽取。`
            : ""
        }}
      </p>
      <button
        class="primary-button"
        type="button"
        :disabled="!canDrawStar"
        @click="drawStar"
      >
        {{ busy && drawing === "star" ? progressText : "一键抽完全部星级罗盘" }}
      </button>
    </div>

    <button
      v-if="busy && drawing"
      type="button"
      class="stop-button"
      @click="cancelRequested = true"
      :disabled="cancelRequested"
    >
      {{ cancelRequested ? "等待当前请求结束…" : "停止后续抽取" }}
    </button>
    <div v-if="result" class="results" role="status" aria-live="polite">
      <strong>{{ result.message }}</strong>
      <ul v-if="result.rewards?.length">
        <li v-for="(reward, index) in result.rewards" :key="index">
          {{ formatCompassReward(reward) }}
        </li>
      </ul>
      <p v-else>暂无可确认的奖励明细。</p>
    </div>
  </section>
</template>

<script>
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import {
  CHAOS_BONUS_THRESHOLD,
  COMPASS_COMMANDS,
  isCompassAccountUncertain,
  MAX_STAR_DRAWS,
  parseChaosSnapshot,
  parseStarSnapshot,
  runCompassDraw,
} from "@/utils/compassProtocol.js";
import { formatCompassReward } from "@/utils/compassRewards.js";

// Preserve the original account's confirmed results when navigating or switching.
const compassResultsByAccount = reactive(new Map());
</script>

<script setup>
const props = defineProps({ active: { type: Boolean, default: true } });
const tokenStore = useTokenStore();
const state = ref(null);
const chaosRoleId = ref(null);
const errorText = ref("");
const loading = ref(false);
const busy = ref(false);
const drawing = ref("");
const progressText = ref("正在抽取…");
const cancelRequested = ref(false);
const tokenId = computed(() => tokenStore.selectedToken?.id || null);
const result = computed(
  () => compassResultsByAccount.get(tokenId.value) || null,
);
const uncertain = computed(() => {
  return (
    !!tokenId.value &&
    !!result.value &&
    isCompassAccountUncertain(tokenId.value)
  );
});
const connected = computed(
  () =>
    !!tokenId.value &&
    tokenStore.getWebSocketStatus(tokenId.value) === "connected",
);
const starTotal = computed(() => {
  const star = state.value?.star;
  const counts = [star?.white, star?.green, star?.blue];
  return counts.every((value) => Number.isSafeInteger(value) && value >= 0)
    ? counts.reduce((sum, value) => sum + value, 0)
    : null;
});
const chaosBonusProgress = computed(() => {
  const value = state.value?.chaosBonus;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
});
const canDrawChaos = computed(
  () =>
    connected.value &&
    !busy.value &&
    !loading.value &&
    !uncertain.value &&
    !!chaosRoleId.value &&
    Number.isSafeInteger(state.value?.chaos) &&
    (state.value.chaos > 0 || state.value.chaosBonus >= CHAOS_BONUS_THRESHOLD),
);
const canDrawStar = computed(
  () =>
    connected.value &&
    !busy.value &&
    !loading.value &&
    !uncertain.value &&
    starTotal.value > 0 &&
    starTotal.value <= MAX_STAR_DRAWS,
);
const showCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : "—";
let generation = 0;
let disposed = false;

function capture() {
  const id = tokenId.value;
  const version = generation;
  const client = id ? tokenStore.wsConnections?.[id]?.client : null;
  return {
    id,
    valid: () =>
      !disposed &&
      !!client &&
      version === generation &&
      tokenId.value === id &&
      connected.value &&
      tokenStore.wsConnections?.[id]?.client === client,
  };
}

function record(id, value) {
  compassResultsByAccount.set(id, value);
}

async function refresh() {
  if (!connected.value || loading.value || busy.value) return;
  const context = capture();
  if (!context.valid()) return;
  loading.value = true;
  errorText.value = "";
  state.value = null;
  chaosRoleId.value = null;
  try {
    const send = (command, params = {}) =>
      tokenStore.sendMessageWithPromise(context.id, command, params, 15000);
    const getChaos = async () => {
      const role = await send("role_getroleinfo");
      if (!context.valid()) throw new Error("连接已变化");
      const roleId = Number(role?.role?.roleId);
      if (!Number.isSafeInteger(roleId) || roleId <= 0)
        throw new Error("角色信息不完整");
      const response = await send(COMPASS_COMMANDS.chaosInfo, { roleId });
      return { ...parseChaosSnapshot(response, { full: true }), roleId };
    };
    const [chaos, star] = await Promise.allSettled([
      getChaos(),
      send(COMPASS_COMMANDS.starInfo).then(parseStarSnapshot),
    ]);
    if (!context.valid()) return;
    chaosRoleId.value =
      chaos.status === "fulfilled" ? chaos.value.roleId : null;
    state.value = {
      chaos: chaos.status === "fulfilled" ? chaos.value.left : null,
      chaosBonus:
        chaos.status === "fulfilled" ? chaos.value.bonusProgress : null,
      star: star.status === "fulfilled" ? star.value : null,
    };
    const failed = [];
    if (chaos.status === "rejected") failed.push("混沌罗盘");
    if (star.status === "rejected") failed.push("星级罗盘");
    if (failed.length)
      errorText.value = `${failed.join("、")}次数获取失败，请稍后刷新`;
  } finally {
    loading.value = false;
  }
}

async function draw(type) {
  if (type === "chaos" ? !canDrawChaos.value : !canDrawStar.value) return;
  const context = capture();
  if (!context.valid()) return;
  const requestedCount =
    type === "chaos" ? state.value.chaos : { ...state.value.star };
  const requestedTotal = type === "chaos" ? requestedCount : starTotal.value;
  const roleId = chaosRoleId.value;
  const confirmedRewards = [];
  let confirmed = 0;
  busy.value = true;
  drawing.value = type;
  cancelRequested.value = false;
  progressText.value = "正在抽取…";
  record(context.id, null);
  errorText.value = "";
  const assertActive = () => {
    if (!context.valid() || cancelRequested.value) {
      throw new Error("账号、连接或页面已变化，或已停止后续抽取");
    }
  };
  try {
    const next = await runCompassDraw({
      accountId: context.id,
      kind: type === "chaos" ? "chaos" : "allStar",
      roleId,
      count: requestedCount,
      send: (command, params) =>
        tokenStore.sendMessageWithPromise(context.id, command, params, 15000),
      assertActive,
      onWait: (milliseconds) => {
        if (context.valid())
          progressText.value =
            milliseconds > 0
              ? `等待 ${Math.ceil(milliseconds / 1000)} 秒后继续…`
              : "正在继续处理…";
      },
      onDraw: ({ completed, rewards }) => {
        confirmed = completed;
        confirmedRewards.push(...rewards);
        const message =
          type === "chaos"
            ? `混沌罗盘已确认 ${completed} 次`
            : `已确认 ${completed}/${requestedTotal} 次`;
        record(context.id, { message, rewards: confirmedRewards.slice() });
        if (context.valid()) progressText.value = message;
      },
    });
    record(context.id, {
      message:
        type === "chaos"
          ? "混沌罗盘抽取完成"
          : `星级罗盘已完成 ${next.completed} 次`,
      rewards: next.rewards,
    });
  } catch (error) {
    const rewards = Array.isArray(error.compassRewards)
      ? error.compassRewards
      : confirmedRewards;
    const completed = error.compassCompleted ?? confirmed;
    const prefix =
      type === "chaos"
        ? "混沌罗盘抽取未完成"
        : `星级罗盘已确认 ${completed} 次`;
    record(context.id, {
      message: error.compassUncertain
        ? `${prefix}：${error.message || "请求失败"}。最后一次操作结果未确认，请到游戏内核对后重新加载页面。`
        : `${prefix}：${error.message || "请求失败"}。已确认的奖励保留如下。`,
      rewards,
    });
  } finally {
    busy.value = false;
    drawing.value = "";
    if (context.valid()) {
      state.value = null;
      await refresh();
    }
  }
}
const drawChaos = () => draw("chaos");
const drawStar = () => draw("star");

watch(
  () => {
    const id = tokenId.value;
    return [
      id,
      id ? tokenStore.getWebSocketStatus(id) : null,
      id ? tokenStore.wsConnections?.[id]?.client : null,
    ];
  },
  () => {
    generation += 1;
    state.value = null;
    chaosRoleId.value = null;
    errorText.value = "";
    cancelRequested.value = true;
  },
  { flush: "sync" },
);
watch(
  [connected, () => props.active, busy],
  ([isConnected, active, isBusy]) => {
    if (active && isConnected && !state.value && !isBusy && !loading.value)
      refresh();
  },
  { immediate: true },
);
onUnmounted(() => {
  disposed = true;
  generation += 1;
  cancelRequested.value = true;
});
</script>

<style scoped>
.compass-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.compass-header,
.group-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.compass-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
}
.compass-header p,
.compass-group p {
  margin: 0;
  color: var(--text-color-secondary, #73777f);
  font-size: 13px;
  line-height: 1.5;
}
.compass-group {
  padding: 14px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  display: grid;
  gap: 10px;
}
.group-title span {
  color: var(--text-color-secondary, #73777f);
  font-size: 13px;
}
button,
input {
  font: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.refresh-button,
.all-button,
.stop-button,
.star-choices button {
  padding: 7px 12px;
  border: 1px solid var(--border-color, #d9dce3);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}
.primary-button {
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: 6px;
  color: white;
  background: #6670e8;
}
.star-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.star-choices button {
  flex: 1;
  min-width: 90px;
}
.star-choices button.selected {
  border-color: #6670e8;
  color: #6670e8;
  background: rgba(102, 112, 232, 0.08);
}
.star-choices small {
  display: block;
  margin-top: 3px;
}
.star-action {
  display: flex;
  align-items: center;
  gap: 8px;
}
.star-action input {
  min-width: 0;
  width: 90px;
  padding: 7px;
  border: 1px solid var(--border-color, #d9dce3);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}
.notice,
.results {
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(102, 112, 232, 0.08);
  font-size: 13px;
}
.notice.error {
  color: #c53636;
  background: rgba(220, 60, 60, 0.08);
}
.results ul {
  margin: 8px 0 0;
  padding-left: 20px;
}
.results p {
  margin-bottom: 0;
}
@media (max-width: 420px) {
  .compass-header {
    align-items: flex-start;
  }
  .star-choices button {
    min-width: 70px;
  }
}
</style>
