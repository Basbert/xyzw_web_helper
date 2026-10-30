<template>
  <section class="simulation" aria-labelledby="simulation-title">
    <header class="heading">
      <div>
        <h2 id="simulation-title">模拟十殿</h2>
        <p>使用当前阵容挑战指定殿主，查看战斗结果。</p>
      </div>
      <span class="free-label">免费模拟</span>
    </header>

    <div class="simulation-layout">
      <section class="setup" aria-label="模拟设置">
        <h3>选择殿数</h3>
        <div class="hall-options" role="radiogroup" aria-label="选择殿数">
          <label v-for="option in halls" :key="option.value">
            <input
              v-model="hall"
              type="radio"
              name="ten-hall"
              :value="option.value"
              :disabled="running"
            />
            <span>{{ option.label }}</span>
          </label>
        </div>
        <p class="setup-note">
          使用当前主线阵容、咸王武器和宠物，不消耗正式十殿挑战次数。
        </p>
        <n-button
          type="primary"
          size="large"
          block
          :disabled="running || !connected"
          :loading="running"
          @click="startSimulation"
        >
          {{
            running
              ? "模拟进行中"
              : connected
                ? "开始模拟"
                : "连接角色后开始模拟"
          }}
        </n-button>
        <button
          v-if="running"
          type="button"
          class="cancel"
          :disabled="cancelling"
          @click="cancelSimulation"
        >
          {{ cancelling ? "正在取消…" : "取消模拟" }}
        </button>
        <p v-if="progress" class="progress" role="status" aria-live="polite">
          {{ progress }}
        </p>
        <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>
      </section>

      <section class="result" aria-label="模拟结果">
        <template v-if="result">
          <div class="result-heading">
            <div>
              <span>{{ hallLabel(result.hall) }} · 模拟结果</span>
              <h3
                :class="
                  result.isWin === null ? '' : result.isWin ? 'win' : 'lose'
                "
              >
                {{
                  result.isWin === null
                    ? "胜负未知"
                    : result.isWin
                      ? "挑战成功"
                      : "挑战失败"
                }}
              </h3>
            </div>
            <div class="rounds">
              <strong>{{ result.rounds ?? "—" }}</strong
              ><span>回合</span>
            </div>
          </div>
          <div class="roster-title">
            <h4>我方武将</h4>
            <span>{{
              result.downCount === null
                ? "下将情况未知"
                : result.downCount
                  ? `下将 ${result.downCount} 名`
                  : "全员在场"
            }}</span>
          </div>
          <ul v-if="result.heroes?.length" class="hero-list">
            <li
              v-for="(hero, index) in result.heroes"
              :key="`${hero.heroId}-${index}`"
            >
              <img
                v-if="heroInfo(hero.heroId)?.avatar"
                :src="heroInfo(hero.heroId).avatar"
                alt=""
              />
              <span class="hero-name">{{
                heroInfo(hero.heroId)?.name || `武将 ${hero.heroId ?? "未知"}`
              }}</span>
              <span :class="hero.isDown ? 'hero-down' : 'hero-status'">{{
                hero.isDown === null
                  ? "状态未知"
                  : hero.isDown
                    ? "已下将"
                    : "在场"
              }}</span>
            </li>
          </ul>
          <p v-else class="empty-text">战报未返回我方武将状态。</p>
        </template>
        <div v-else class="empty-result">
          <h3>等待模拟</h3>
          <p>选择殿数后开始，将显示胜负、回合数和我方下将情况。</p>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT } from "@/utils/HeroList";
import { runTenHallSimulation } from "@/utils/tenHallSimulation";

const tokenStore = useTokenStore();
const labels = ["一", "二", "三", "四", "五", "六", "七", "八"];
const halls = labels.map((label, index) => ({
  label: `第${label}殿`,
  value: index + 1,
}));
const hallLabel = (value) =>
  halls.find((item) => item.value === value)?.label || `第${value}殿`;
const heroInfo = (id) => HERO_DICT[id];
const hall = ref(1);
const running = ref(false);
const cancelling = ref(false);
const progress = ref("");
const errorText = ref("");
const result = ref(null);
let controller = null;

const connected = computed(() => {
  const id = tokenStore.selectedToken?.id;
  return !!id && tokenStore.getWebSocketStatus(id) === "connected";
});

async function startSimulation() {
  if (running.value || !connected.value) return;
  const tokenId = tokenStore.selectedToken.id;
  const chosenHall = hall.value;
  controller = new AbortController();
  running.value = true;
  cancelling.value = false;
  progress.value = "";
  errorText.value = "";
  result.value = null;
  try {
    const nextResult = await runTenHallSimulation({
      tokenStore,
      tokenId,
      hall: chosenHall,
      signal: controller.signal,
      onProgress: (value) => (progress.value = value),
    });
    if (tokenStore.selectedToken?.id === tokenId) {
      result.value = nextResult;
      progress.value = "模拟完成";
    }
  } catch (error) {
    if (tokenStore.selectedToken?.id === tokenId) {
      progress.value = "";
      errorText.value = error.message || "模拟失败，请稍后重试";
    }
  } finally {
    running.value = false;
    cancelling.value = false;
    controller = null;
  }
}

function cancelSimulation() {
  if (!controller || cancelling.value) return;
  cancelling.value = true;
  controller.abort();
}

watch(
  () => tokenStore.selectedToken?.id,
  () => {
    controller?.abort();
    result.value = null;
    progress.value = "";
    errorText.value = "";
  },
);
onUnmounted(() => controller?.abort());
</script>

<style scoped>
.simulation {
  grid-column: 1 / -1;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: clamp(18px, 3vw, 30px);
}
.heading,
.result-heading,
.roster-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.heading h2,
.heading p,
.setup h3,
.result h3,
.result h4,
.result p {
  margin: 0;
}
.heading h2 {
  font-size: 22px;
}
.heading p,
.setup-note,
.empty-text,
.empty-result p {
  color: var(--text-secondary);
  line-height: 1.6;
}
.heading p {
  margin-top: 6px;
}
.free-label {
  flex: none;
  color: var(--success-color);
  font-size: 13px;
  font-weight: 600;
  padding: 5px 10px;
  border: 1px solid currentColor;
  border-radius: 20px;
}
.simulation-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(280px, 1.15fr);
  gap: 28px;
  margin-top: 28px;
}
.setup h3,
.result h4 {
  font-size: 15px;
}
.hall-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0;
}
.hall-options label {
  position: relative;
}
.hall-options input {
  position: absolute;
  opacity: 0;
}
.hall-options span {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 6px;
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}
.hall-options input:checked + span {
  border-color: var(--primary-color);
  color: var(--primary-color);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--primary-color);
}
.hall-options input:focus-visible + span,
.cancel:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.hall-options input:disabled + span {
  cursor: default;
  opacity: 0.7;
}
.setup-note {
  font-size: 13px;
  margin: 0 0 18px;
}
.cancel {
  display: block;
  margin: 12px auto 0;
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}
.progress,
.error {
  font-size: 13px;
  line-height: 1.5;
  margin: 12px 0 0;
}
.progress {
  color: var(--text-secondary);
}
.error,
.lose,
.hero-down {
  color: var(--error-color);
}
.result {
  min-height: 230px;
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 20px;
}
.result-heading span,
.roster-title span {
  font-size: 13px;
  color: var(--text-secondary);
}
.result-heading h3 {
  font-size: 22px;
  margin-top: 5px;
}
.win {
  color: var(--success-color);
}
.rounds {
  display: flex;
  gap: 4px;
  align-items: baseline;
}
.rounds strong {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}
.roster-title {
  align-items: center;
  border-top: 1px solid var(--border-light);
  padding-top: 18px;
  margin-top: 18px;
}
.hero-list {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.hero-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
}
.hero-list img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 6px;
}
.hero-name {
  flex: 1;
}
.hero-down,
.hero-status {
  font-size: 13px;
}
.hero-status {
  color: var(--text-secondary);
}
.empty-result {
  display: flex;
  min-height: 190px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}
.empty-result h3 {
  font-size: 16px;
}
.empty-result p {
  margin-top: 8px;
  max-width: 260px;
  font-size: 13px;
}
@media (max-width: 720px) {
  .simulation-layout {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .result {
    min-height: 190px;
  }
  .empty-result {
    min-height: 150px;
  }
}
</style>
