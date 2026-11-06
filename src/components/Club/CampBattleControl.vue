<template>
  <section class="camp-battle" aria-labelledby="camp-battle-title">
    <div class="battle-heading">
      <div>
        <h2 id="camp-battle-title">今日营地挑战</h2>
        <p>选择今日对手，确认阵容后发起一次挑战。</p>
      </div>
      <span class="battle-status" :class="{ open: snapshot?.canAttack }">{{
        statusLabel
      }}</span>
    </div>

    <div class="battle-body">
      <div class="today-counts" aria-label="今日个人挑战记录">
        <div>
          <span>已挑战</span><strong>{{ snapshot?.attempts ?? "—" }}</strong
          ><small>次</small>
        </div>
        <div>
          <span>已获胜</span><strong>{{ snapshot?.wins ?? "—" }}</strong
          ><small>场</small>
        </div>
        <p>普通账号上限：10 次挑战、3 场胜利；特权账号以游戏内为准。</p>
      </div>

      <div class="target-picker">
        <label for="camp-target-picker"
          >今日对手：{{ snapshot?.opponentName || "等待战况" }}</label
        >
        <div class="target-controls">
          <NSelect
            id="camp-target-picker"
            v-model:value="selectedNode"
            :options="targetOptions"
            :disabled="
              busy || refreshing || !snapshot?.canAttack || requiresRefresh
            "
            filterable
            clearable
            placeholder="选择一个未击破的据点"
          />
          <NButton
            type="primary"
            :disabled="
              busy ||
              refreshing ||
              !selectedTarget ||
              !snapshot?.canAttack ||
              requiresRefresh
            "
            :loading="busy && !showConfirm"
            @click="prepareSelected"
            >查看阵容并挑战</NButton
          >
          <NButton
            :disabled="busy || !connected"
            :loading="refreshing"
            @click="refreshBoard"
            >刷新战况</NButton
          >
        </div>
        <p class="battle-note">
          使用当前主线阵容、玩具和宠物；每次只发起一场，不使用加倍道具。
        </p>
        <p v-if="atOrdinaryLimit" class="battle-note">
          已达到普通账号上限；如有特权，剩余次数以游戏判定为准。
        </p>
        <p v-if="!connected" class="battle-note">连接角色后可查看今日战况。</p>
        <p v-else-if="snapshot?.reason" class="battle-note">
          {{ snapshot.reason }}
        </p>
        <p v-else-if="!snapshot" class="battle-note">
          {{ loading ? "正在读取营地战况…" : "请刷新营地战况。" }}
        </p>
        <p v-if="requiresRefresh" class="battle-warning" role="alert">
          请先刷新战况，确认上次挑战结果后再继续。
        </p>
        <p
          v-if="resultText"
          class="battle-result"
          role="status"
          aria-live="polite"
        >
          {{ resultText }}
        </p>
      </div>
    </div>

    <NModal
      v-model:show="showConfirm"
      preset="card"
      title="确认营地挑战"
      class="camp-confirm"
      :mask-closable="!busy"
      :closable="!busy"
    >
      <template v-if="preview">
        <p class="confirm-opponent">
          挑战 #{{ preview.target.nodeId }} 据点：<strong>{{
            preview.target.name
          }}</strong>
          <span v-if="preview.target.mirror">（镜像）</span>
        </p>
        <p class="confirm-summary">
          今日已挑战 {{ preview.snapshot.attempts }} 次，已获胜
          {{ preview.snapshot.wins }} 场。
        </p>
        <h3>当前主线阵容</h3>
        <ol class="team-list">
          <li v-for="hero in preview.team.heroes" :key="hero.slot">
            <span>{{ hero.slot + 1 }} 号位</span>
            <strong>{{ heroName(hero.heroId) }}</strong>
          </li>
        </ol>
        <p class="confirm-equipment">
          玩具：{{ weaponName(preview.team.weaponId) }} 宠物：{{
            petName(preview.team.petId)
          }}
        </p>
        <p class="confirm-note">
          确认后会消耗本场挑战机会；提交前会再次检查阵容和对手。
        </p>
        <div class="confirm-actions">
          <NButton :disabled="busy" @click="showConfirm = false">取消</NButton>
          <NButton
            type="primary"
            :loading="busy"
            :disabled="busy"
            @click="confirmAttack"
            >确认挑战一次</NButton
          >
        </div>
      </template>
    </NModal>
  </section>
</template>

<script setup>
import { NButton, NModal, NSelect, useMessage } from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import {
  CAMP_ORDINARY_LIMITS,
  getCampSnapshot,
  prepareCampAttack,
  submitCampAttack,
} from "@/utils/campChallenge";
import { HERO_DICT, weapon } from "@/utils/HeroList";
import { PET_DICT } from "@/utils/PetList";

const props = defineProps({
  club: { type: Object, default: null },
  siege: { type: Object, default: null },
  sourceTokenId: { type: [String, Number], default: null },
  loading: { type: Boolean, default: false },
});
const emit = defineEmits(["updated"]);
const tokenStore = useTokenStore();
const message = useMessage();
const selectedNode = ref(null);
const busy = ref(false);
const refreshing = ref(false);
const requiresRefresh = ref(false);
const showConfirm = ref(false);
const preview = ref(null);
const resultText = ref("");
const now = ref(Date.now());
let timer;
let disposed = false;

const connected = computed(() => {
  const id = tokenStore.selectedToken?.id;
  return Boolean(id) && tokenStore.getWebSocketStatus(id) === "connected";
});
const snapshot = computed(() => {
  if (
    !connected.value ||
    props.sourceTokenId !== tokenStore.selectedToken?.id ||
    !props.club ||
    !props.siege
  )
    return null;
  try {
    return getCampSnapshot({ club: props.club, siege: props.siege }, now.value);
  } catch {
    return null;
  }
});
const targetOptions = computed(() =>
  (snapshot.value?.targets || []).map((target) => ({
    label: `#${target.nodeId} ${target.name}${target.mirror ? "（镜像）" : ""}${target.defeated ? "（已击破）" : ""}`,
    value: target.nodeId,
    disabled: target.defeated,
  })),
);
const atOrdinaryLimit = computed(
  () =>
    snapshot.value &&
    (snapshot.value.attempts >= CAMP_ORDINARY_LIMITS.attempts ||
      snapshot.value.wins >= CAMP_ORDINARY_LIMITS.wins),
);
const selectedTarget = computed(
  () =>
    snapshot.value?.targets.find(
      (item) => item.nodeId === selectedNode.value && !item.defeated,
    ) || null,
);
const statusLabel = computed(() => {
  if (!connected.value) return "未连接";
  if (!snapshot.value) return props.loading ? "加载中" : "待刷新";
  if (snapshot.value.canAttack) return "可挑战";
  return "暂不可挑战";
});
const heroName = (id) => HERO_DICT[id]?.name || `武将 ${id}`;
const weaponName = (id) => (id ? weapon[id] || `玩具 ${id}` : "未配置或未返回");
const petName = (id) =>
  id ? PET_DICT[id]?.name || `宠物 ${id}` : "未配置或未返回";

function checkAccount(tokenId) {
  if (
    disposed ||
    tokenStore.selectedToken?.id !== tokenId ||
    tokenStore.getWebSocketStatus(tokenId) !== "connected"
  ) {
    const error = new Error("账号已切换或连接断开，请重新查看战况");
    error.interrupted = true;
    throw error;
  }
}

async function refreshBoard() {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId || !connected.value || busy.value || refreshing.value) return;
  refreshing.value = true;
  try {
    const response = await tokenStore.sendMessageWithPromise(
      tokenId,
      "club_getinfo",
      {},
      10000,
    );
    checkAccount(tokenId);
    getCampSnapshot(response);
    emit("updated", { tokenId, response });
    requiresRefresh.value = false;
    message.success("营地战况已刷新");
  } catch (error) {
    if (!disposed && tokenStore.selectedToken?.id === tokenId)
      message.error(error.message || "刷新营地战况失败");
  } finally {
    refreshing.value = false;
  }
}

async function prepareTarget(target) {
  const tokenId = tokenStore.selectedToken?.id;
  if (
    !tokenId ||
    !connected.value ||
    busy.value ||
    refreshing.value ||
    requiresRefresh.value
  )
    return;
  busy.value = true;
  resultText.value = "";
  try {
    const result = await prepareCampAttack({
      tokenStore,
      tokenId,
      target,
      checkActive: () => checkAccount(tokenId),
    });
    checkAccount(tokenId);
    preview.value = result;
    selectedNode.value = result.target.nodeId;
    showConfirm.value = true;
  } catch (error) {
    if (!disposed && tokenStore.selectedToken?.id === tokenId)
      message.warning(error.message || "无法准备挑战");
  } finally {
    busy.value = false;
  }
}
function prepareSelected() {
  if (selectedTarget.value) prepareTarget(selectedTarget.value);
}

defineExpose({ prepareTarget });

async function confirmAttack() {
  const current = preview.value;
  if (!current || busy.value) return;
  const tokenId = current.tokenId;
  busy.value = true;
  try {
    const result = await submitCampAttack({
      tokenStore,
      preview: current,
      checkActive: () => checkAccount(tokenId),
    });
    if (disposed || tokenStore.selectedToken?.id !== tokenId) return;
    showConfirm.value = false;
    const title =
      result.outcome === "win"
        ? "挑战成功"
        : result.outcome === "loss"
          ? "挑战失败"
          : "挑战已提交，胜负未返回";
    const rounds = result.rounds ? `，${result.rounds} 回合` : "";
    const score = result.score != null ? `，获得 ${result.score} 分` : "";
    resultText.value = `${title}${rounds}${score}。`;
    if (result.refreshed)
      emit("updated", { tokenId, response: result.refreshed });
    requiresRefresh.value = !result.refreshed || result.outcome === "unknown";
    if (result.outcome === "win") message.success(resultText.value);
    else message.warning(resultText.value);
  } catch (error) {
    if (disposed || tokenStore.selectedToken?.id !== tokenId) return;
    if (error.uncertain) {
      showConfirm.value = false;
      requiresRefresh.value = true;
      resultText.value = error.message;
    }
    message.warning(error.message || "挑战未完成");
  } finally {
    busy.value = false;
  }
}

watch(
  () => tokenStore.selectedToken?.id,
  () => {
    selectedNode.value = null;
    showConfirm.value = false;
    preview.value = null;
    resultText.value = "";
    requiresRefresh.value = false;
  },
);
onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 30000);
});
onUnmounted(() => {
  disposed = true;
  window.clearInterval(timer);
});
</script>

<style scoped>
.camp-battle {
  margin: 12px 0 18px;
  padding: 20px;
  border: 1px solid var(--border-light);
  border-left: 4px solid #18a058;
  border-radius: 12px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.battle-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.battle-heading h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
}
.battle-heading p,
.battle-note {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.battle-status {
  flex: none;
  padding: 4px 9px;
  border-radius: 5px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
}
.battle-status.open {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
}
.battle-body {
  display: grid;
  grid-template-columns: minmax(190px, 260px) minmax(0, 1fr);
  gap: 20px;
  align-items: center;
  margin-top: 18px;
}
.today-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border-radius: 8px;
}
.today-counts div {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.today-counts span,
.today-counts small {
  color: var(--text-secondary);
  font-size: 12px;
}
.today-counts strong {
  font-size: 23px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.today-counts p {
  width: 100%;
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.target-picker {
  min-width: 0;
}
.target-picker label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.target-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
.target-controls :deep(.n-select) {
  flex: 1;
  min-width: 0;
}
.battle-warning {
  margin: 8px 0 0;
  color: #c56b13;
  font-size: 13px;
}
.battle-result {
  margin: 8px 0 0;
  font-weight: 600;
  font-size: 13px;
}
.camp-confirm {
  width: min(560px, calc(100vw - 32px));
}
.confirm-opponent {
  margin: 0 0 8px;
  font-size: 16px;
}
.confirm-summary,
.confirm-note,
.confirm-equipment {
  color: var(--text-secondary);
  line-height: 1.6;
}
.camp-confirm h3 {
  margin: 20px 0 8px;
  font-size: 15px;
}
.team-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(125px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.team-list li {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px;
  background: var(--bg-secondary);
  border-radius: 6px;
}
.team-list li span {
  color: var(--text-secondary);
  font-size: 12px;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
@media (max-width: 700px) {
  .camp-battle {
    padding: 16px;
  }
  .battle-body {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .target-controls {
    flex-wrap: wrap;
  }
  .target-controls :deep(.n-select) {
    flex-basis: 100%;
  }
  .target-controls :deep(.n-button) {
    flex: 1;
  }
}
</style>
