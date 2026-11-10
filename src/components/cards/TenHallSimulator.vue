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
        <h3>出战阵容</h3>
        <div class="hall-options" role="group" aria-label="切换游戏预设阵容">
          <n-button
            v-for="id in [1, 2, 3, 4]"
            :key="id"
            :type="presetId === id ? 'primary' : 'default'"
            :disabled="running || presetBusy || !connected"
            @click="switchPreset(id)"
            >阵容 {{ id }}</n-button
          >
        </div>
        <p class="setup-note">
          {{
            presetBusy
              ? "正在确认阵容…"
              : presetId
                ? `当前使用阵容 ${presetId}`
                : "当前阵容编号未确认，请切换或刷新后检查"
          }}。切换会同步修改游戏中的当前阵容。
        </p>
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
        <h3>模拟次数</h3>
        <div
          class="hall-options count-options"
          role="radiogroup"
          aria-label="模拟次数"
        >
          <label v-for="option in [1, 10, 20]" :key="option">
            <input
              v-model="count"
              type="radio"
              name="ten-hall-count"
              :value="option"
              :disabled="running"
            />
            <span>{{ option }} 次</span>
          </label>
        </div>
        <p class="setup-note">
          读取当前主线阵容，确认后开始。不消耗正式十殿挑战次数。
          多次模拟时，每场之间约间隔 10 秒；中断时保留已完成的战报。
        </p>
        <n-button
          type="primary"
          size="large"
          block
          :disabled="running || presetBusy || !connected"
          :loading="running"
          @click="startSimulation"
        >
          {{
            running
              ? "模拟进行中"
              : connected
                ? "查看阵容并模拟"
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
        <p v-if="running" class="progress">
          可切换本页的其他栏目；离开游戏功能页会停止模拟。
        </p>
        <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>
        <p v-if="historyError" class="error" role="status">
          {{ historyError }}
        </p>
      </section>

      <section class="result" aria-label="模拟结果">
        <template v-if="result">
          <div v-if="runCount > 1" class="series-summary" aria-live="polite">
            <strong
              >已完成 {{ seriesResults.length }} / {{ runCount }} 场</strong
            >
            <p>
              胜 {{ summary.wins }} · 负 {{ summary.losses
              }}<template v-if="summary.unknown">
                · 未知 {{ summary.unknown }}</template
              >
            </p>
            <p v-if="summary.wins + summary.losses">
              已确认场次胜率
              {{
                Math.round(
                  (summary.wins / (summary.wins + summary.losses)) * 100,
                )
              }}%
            </p>
            <p v-if="summary.averageRounds !== null">
              胜利平均 {{ summary.averageRounds }} 回合<span
                v-if="summary.roundSamples < summary.wins"
                >（{{ summary.roundSamples }} 场有回合数据）</span
              >
              · 无下将胜利 {{ summary.noDownWins }} 场
            </p>
            <p v-if="summary.best">
              最佳样本：第 {{ summary.best.index }} 场 · 下将
              {{ summary.best.downCount }} · {{ summary.best.rounds }} 回合
              <button
                type="button"
                class="best-result-link"
                @click="selectBattle(summary.best.index - 1)"
              >
                查看
              </button>
            </p>
            <p v-if="summary.best" class="summary-note">
              优先比较胜利场次的下将数，再比较回合数
            </p>
            <details>
              <summary>查看每场结果</summary>
              <ol>
                <li v-for="(item, index) in seriesResults" :key="index">
                  <button
                    type="button"
                    class="battle-result-link"
                    :aria-pressed="selectedBattleIndex === index"
                    @click="selectBattle(index)"
                  >
                    第 {{ index + 1 }} 场：{{
                      item.isWin === null
                        ? "胜负未知"
                        : item.isWin
                          ? "胜利"
                          : "失败"
                    }}
                    · {{ item.rounds ?? "—" }} 回合 ·
                    {{
                      item.downCount === null
                        ? "下将未知"
                        : `下将 ${item.downCount}`
                    }}
                  </button>
                </li>
              </ol>
            </details>
          </div>
          <div class="result-heading">
            <div>
              <span
                >{{ hallLabel(result.hall) }} ·
                {{
                  runCount > 1 ? `第 ${selectedBattleIndex + 1} 场` : "模拟结果"
                }}</span
              >
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
          <div
            v-if="result.loadout"
            class="battle-loadout"
            aria-label="实际出战配置"
          >
            <div>
              <span>玩具</span>
              <strong>{{
                loadoutName(result.loadout.weapon, "weapon")
              }}</strong>
              <small :class="loadoutClass(result.loadout.weapon)">{{
                loadoutStatus(result.loadout.weapon)
              }}</small>
            </div>
            <div>
              <span>宠物</span>
              <strong>{{ loadoutName(result.loadout.pet, "pet") }}</strong>
              <small :class="loadoutClass(result.loadout.pet)">{{
                loadoutStatus(result.loadout.pet)
              }}</small>
            </div>
          </div>
          <p v-if="loadoutWarning" class="loadout-warning" role="status">
            {{ loadoutWarning }}
          </p>
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
    <section
      v-if="historyItems.length"
      class="history"
      aria-label="最近模拟记录"
    >
      <div class="history-heading">
        <div>
          <h3>最近模拟记录</h3>
          <p>按角色保存在当前浏览器，最多 20 组；装备变化也会影响结果。</p>
        </div>
      </div>
      <ul class="history-list">
        <li
          v-for="entry in visibleHistory"
          :key="entry.id"
          class="history-entry"
        >
          <button
            type="button"
            class="history-open"
            :disabled="running"
            @click="openHistory(entry)"
          >
            <span class="history-top"
              ><strong
                >{{ hallLabel(entry.hall) }} · {{ entry.results.length }} /
                {{ entry.requestedCount }} 场
                <small>{{ historyStatus(entry) }}</small></strong
              ><span class="history-meta"
                ><time>{{ historyTime(entry.time) }}</time
                ><span>查看战报</span></span
              ></span
            >
            <span class="history-metrics">{{ historyMetrics(entry) }}</span>
            <span class="history-roster">{{ historyRoster(entry) }}</span>
          </button>
          <n-popconfirm @positive-click="deleteHistory(entry.id)">
            <template #trigger
              ><n-button
                text
                :disabled="running"
                :aria-label="`删除${hallLabel(entry.hall)}的模拟记录`"
                >删除</n-button
              ></template
            >
            删除这组模拟记录？
          </n-popconfirm>
        </li>
      </ul>
      <button
        v-if="historyItems.length > 3"
        type="button"
        class="history-more"
        @click="showAllHistory = !showAllHistory"
      >
        {{ showAllHistory ? "收起记录" : `显示全部 ${historyItems.length} 组` }}
      </button>
    </section>
    <n-modal
      :show="!!confirmation"
      preset="card"
      title="确认出战阵容"
      :closable="false"
      :mask-closable="false"
      :close-on-esc="false"
      style="width: min(520px, calc(100vw - 32px))"
    >
      <template v-if="confirmation">
        <p class="confirm-intro">
          {{ confirmation.roleName || "当前角色" }} ·
          {{ hallLabel(confirmation.hall) }} · {{ confirmation.count }} 次
        </p>
        <p class="confirm-note">
          这是刚从游戏读取的当前主线阵容。可直接切换预设，切换会同步修改游戏中的当前阵容。
        </p>
        <div class="hall-options" role="group" aria-label="确认并切换预设阵容">
          <n-button
            v-for="id in [1, 2, 3, 4]"
            :key="id"
            :type="presetId === id ? 'primary' : 'default'"
            :disabled="presetBusy || !connected"
            @click="switchPreset(id, true)"
            >阵容 {{ id }}</n-button
          >
          <n-button
            :disabled="presetBusy || !connected"
            @click="refreshConfirmation"
            >刷新预览</n-button
          >
        </div>
        <p v-if="presetError" class="error" role="alert">{{ presetError }}</p>
        <ul class="confirm-heroes">
          <li v-for="hero in confirmation.heroes" :key="hero.slot">
            <span>{{ hero.slot + 1 }} 号位</span>
            <strong>{{
              heroInfo(hero.heroId)?.name || `武将 ${hero.heroId}`
            }}</strong>
          </li>
        </ul>
        <div class="confirm-equipment">
          <span
            >玩具
            <strong>{{
              confirmation.weaponId
                ? weapon[confirmation.weaponId] ||
                  `玩具 ${confirmation.weaponId}`
                : "未携带"
            }}</strong></span
          >
          <span
            >宠物
            <strong>{{
              confirmation.hasPet
                ? PET_DICT[confirmation.petId]?.name || "已携带（名称未知）"
                : "未携带"
            }}</strong></span
          >
        </div>
        <div class="confirm-actions">
          <n-button :disabled="presetBusy" @click="settleConfirmation?.(false)"
            >取消</n-button
          >
          <n-button
            type="primary"
            :disabled="presetBusy || !!presetError || !connected"
            @click="settleConfirmation?.(true)"
            >确认并开始</n-button
          >
        </div>
      </template>
    </n-modal>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT, weapon } from "@/utils/HeroList";
import { PET_DICT } from "@/utils/PetList";
import {
  presetSwitchFailure,
  readTenHallPreset,
  setTenHallPreset,
} from "@/utils/tenHallFormation";
import {
  readTenHallHistory,
  removeTenHallHistory,
  saveTenHallHistory,
  TEN_HALL_HISTORY_PREFIX,
} from "@/utils/tenHallHistory";
import {
  runTenHallSeries,
  summarizeTenHallResults,
} from "@/utils/tenHallSeries";

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
const count = ref(1);
const runCount = ref(1);
const running = ref(false);
const cancelling = ref(false);
const progress = ref("");
const errorText = ref("");
const result = ref(null);
const seriesResults = ref([]);
const selectedBattleIndex = ref(-1);
const historyItems = ref([]);
const showAllHistory = ref(false);
const visibleHistory = computed(() =>
  showAllHistory.value ? historyItems.value : historyItems.value.slice(0, 3),
);
const historyRoleId = ref(null);
const historyError = ref("");
const activeHistoryId = ref(null);
const confirmation = ref(null);
const presetId = ref(null);
const presetBusy = ref(false);
const presetError = ref("");
let presetGeneration = 0;
let presetSwitchOperation = 0;
const summary = computed(() => summarizeTenHallResults(seriesResults.value));
let settleConfirmation = null;
let controller = null;
let manualBattleSelection = false;

const connected = computed(() => {
  const id = tokenStore.selectedToken?.id;
  return !!id && tokenStore.getWebSocketStatus(id) === "connected";
});
const loadoutWarning = computed(() => {
  const loadout = result.value?.loadout;
  if (!loadout) return "";
  const unconfirmed = [];
  if (loadout.heroes === "unknown") unconfirmed.push("武将阵容");
  if (loadout.weapon.status === "unknown") unconfirmed.push("玩具");
  if (loadout.pet.status === "unknown") unconfirmed.push("宠物");
  const mismatch = [];
  if (loadout.heroes === "mismatch") mismatch.push("武将阵容");
  if (loadout.weapon.status === "mismatch") mismatch.push("玩具");
  if (loadout.pet.status === "mismatch") mismatch.push("宠物");
  return [
    mismatch.length ? `${mismatch.join("、")}与所选配置不一致` : "",
    unconfirmed.length ? `战报未能确认${unconfirmed.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("；");
});
function loadoutName(item, type) {
  if (item.status === "none") return "未携带";
  if (!item.actualId) return item.status === "mismatch" ? "未携带" : "未知";
  return type === "weapon"
    ? weapon[item.actualId] || `玩具 ${item.actualId}`
    : PET_DICT[item.actualId]?.name || `宠物 ${item.actualId}`;
}
function loadoutStatus(item) {
  return {
    matched: "已上阵",
    none: "",
    mismatch: "与配置不一致",
    unknown: "未能确认",
  }[item.status];
}
function loadoutClass(item) {
  return ["mismatch", "unknown"].includes(item.status) ? "loadout-issue" : "";
}

function refreshHistory(roleId) {
  historyRoleId.value = roleId || null;
  try {
    historyItems.value = readTenHallHistory(historyRoleId.value);
    historyError.value = "";
  } catch {
    historyItems.value = [];
    historyError.value = "无法读取本地模拟记录，请检查浏览器存储。";
  }
}

function saveRecord(entry, tokenId) {
  if (!entry?.results.length) return;
  const selected = tokenStore.selectedToken;
  const isOwner =
    selected?.id === tokenId &&
    (!selected.roleId || String(selected.roleId) === String(entry.roleId));
  try {
    const list = saveTenHallHistory(entry.roleId, entry);
    if (isOwner) {
      historyRoleId.value = entry.roleId;
      historyItems.value = list;
      historyError.value = "";
    }
  } catch {
    if (isOwner) historyError.value = "模拟仍可继续，但记录未能保存到浏览器。";
  }
}

function historyTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function historyStatus(entry) {
  if (entry.status === "completed") return "已完成";
  if (
    entry.status === "running" &&
    running.value &&
    activeHistoryId.value === entry.id
  )
    return "进行中";
  return entry.status === "stopped" ? "已停止" : "未完成";
}
function historyMetrics(entry) {
  const stats = summarizeTenHallResults(entry.results);
  const known = stats.wins + stats.losses;
  const rate = known
    ? `胜率 ${Math.round((stats.wins / known) * 100)}%（${stats.wins}/${known}）`
    : "胜率未知";
  const rounds =
    stats.averageRounds === null
      ? "平均回合未知"
      : `胜利平均 ${stats.averageRounds} 回合`;
  return `${rate} · ${rounds} · 无下将胜利 ${stats.noDownWins} 场${stats.unknown ? ` · 胜负未知 ${stats.unknown} 场` : ""}`;
}
function historyRoster(entry) {
  const heroes =
    entry.setup.heroes
      .map((hero) => heroInfo(hero.heroId)?.name || `武将 ${hero.heroId}`)
      .join("、") || "阵容未知";
  const toy = entry.setup.weaponId
    ? weapon[entry.setup.weaponId] || `玩具 ${entry.setup.weaponId}`
    : "无玩具";
  const pet = entry.setup.hasPet
    ? PET_DICT[entry.setup.petId]?.name || "宠物未知"
    : "无宠物";
  return `${heroes} | ${toy} | ${pet}`;
}
function selectBattle(index) {
  if (!seriesResults.value[index]) return;
  manualBattleSelection = true;
  selectedBattleIndex.value = index;
  result.value = seriesResults.value[index];
}
function openHistory(entry) {
  if (running.value) return;
  runCount.value = entry.requestedCount;
  seriesResults.value = entry.results.map((item) => ({
    ...item,
    hall: entry.hall,
  }));
  selectedBattleIndex.value = seriesResults.value.length - 1;
  result.value = seriesResults.value.at(-1);
  manualBattleSelection = false;
  progress.value = "已打开历史战报";
  errorText.value = "";
}
function deleteHistory(id) {
  try {
    historyItems.value = removeTenHallHistory(historyRoleId.value, id);
    historyError.value = "";
  } catch {
    historyError.value = "无法删除模拟记录，请检查浏览器存储。";
  }
}

async function refreshPreset() {
  const tokenId = tokenStore.selectedToken?.id;
  const generation = ++presetGeneration;
  presetId.value = null;
  if (!tokenId || !connected.value) return;
  try {
    const id = await readTenHallPreset({ tokenStore, tokenId });
    if (generation === presetGeneration) presetId.value = id;
  } catch {
    // The simulation can still preview the actual main-line team.
  }
}

function clearPresetError() {
  if (presetError.value && errorText.value === presetError.value)
    errorText.value = "";
  presetError.value = "";
}

async function switchPreset(teamId, fromConfirmation = false) {
  if (
    presetBusy.value ||
    !connected.value ||
    (running.value && !fromConfirmation)
  )
    return;
  const tokenId = tokenStore.selectedToken.id;
  const generation = ++presetGeneration;
  const operation = ++presetSwitchOperation;
  presetBusy.value = true;
  clearPresetError();
  try {
    await setTenHallPreset({
      tokenStore,
      tokenId,
      teamId,
      signal: controller?.signal,
    });
    if (
      generation !== presetGeneration ||
      tokenStore.selectedToken?.id !== tokenId
    )
      return;
    presetId.value = teamId;
    if (fromConfirmation) settleConfirmation?.("refresh");
  } catch (error) {
    if (
      generation !== presetGeneration ||
      tokenStore.selectedToken?.id !== tokenId
    )
      return;
    presetId.value = null;
    presetError.value = presetSwitchFailure(error);
    if (!fromConfirmation) errorText.value = presetError.value;
  } finally {
    if (operation === presetSwitchOperation) presetBusy.value = false;
  }
}

function invalidatePresetSwitch() {
  presetSwitchOperation++;
  presetBusy.value = false;
}

function refreshConfirmation() {
  clearPresetError();
  refreshPreset();
  settleConfirmation?.("refresh");
}

function requestConfirmation(loadout, signal, selectedCount) {
  return new Promise((resolve) => {
    const onAbort = () => finish(false);
    function finish(confirmed) {
      signal.removeEventListener("abort", onAbort);
      confirmation.value = null;
      settleConfirmation = null;
      resolve(confirmed);
    }
    settleConfirmation = finish;
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return finish(false);
    confirmation.value = { ...loadout, count: selectedCount };
  });
}

async function startSimulation() {
  if (running.value || !connected.value) return;
  const tokenId = tokenStore.selectedToken.id;
  const chosenHall = hall.value;
  const chosenCount = count.value;
  controller = new AbortController();
  const signal = controller.signal;
  let record = null;
  running.value = true;
  cancelling.value = false;
  progress.value = "";
  errorText.value = "";
  try {
    const completed = await runTenHallSeries({
      tokenStore,
      tokenId,
      hall: chosenHall,
      count: chosenCount,
      signal,
      confirmLoadout: async (loadout) => {
        const confirmed = await requestConfirmation(
          loadout,
          signal,
          chosenCount,
        );
        if (
          confirmed === true &&
          !signal.aborted &&
          tokenStore.selectedToken?.id === tokenId
        ) {
          runCount.value = chosenCount;
          result.value = null;
          seriesResults.value = [];
          selectedBattleIndex.value = -1;
          manualBattleSelection = false;
          record = {
            id:
              globalThis.crypto?.randomUUID?.() ||
              `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            time: Date.now(),
            roleId: loadout.roleId,
            hall: chosenHall,
            requestedCount: chosenCount,
            status: "running",
            setup: loadout,
            results: [],
          };
          activeHistoryId.value = record.id;
          if (!tokenStore.selectedToken?.roleId) refreshHistory(loadout.roleId);
        }
        return confirmed;
      },
      onProgress: (value) => {
        if (tokenStore.selectedToken?.id === tokenId) progress.value = value;
      },
      onResult: (results) => {
        if (record) {
          record.results = results;
          saveRecord(record, tokenId);
        }
        if (tokenStore.selectedToken?.id !== tokenId) return;
        seriesResults.value = results;
        if (!manualBattleSelection) {
          selectedBattleIndex.value = results.length - 1;
          result.value = results.at(-1);
        }
      },
    });
    if (record?.results.length) {
      record.status = completed.error
        ? completed.error.name === "AbortError"
          ? "stopped"
          : "incomplete"
        : "completed";
      saveRecord(record, tokenId);
    }
    if (tokenStore.selectedToken?.id === tokenId) {
      if (completed.error?.name === "AbortError") {
        progress.value = `已停止，保留 ${completed.results.length} 场结果`;
      } else if (completed.error) {
        progress.value = `已完成 ${completed.results.length} / ${chosenCount} 场`;
        errorText.value = completed.error.message || "后续模拟未完成";
      } else {
        progress.value = `模拟完成，共 ${completed.results.length} 场`;
      }
    }
  } catch (error) {
    if (record?.results.length) {
      record.status = error.name === "AbortError" ? "stopped" : "incomplete";
      saveRecord(record, tokenId);
    }
    if (tokenStore.selectedToken?.id === tokenId) {
      progress.value = error.name === "AbortError" ? "已取消模拟" : "";
      errorText.value =
        error.name === "AbortError"
          ? ""
          : error.message || "模拟失败，请稍后重试";
    }
  } finally {
    running.value = false;
    cancelling.value = false;
    controller = null;
    activeHistoryId.value = null;
  }
}

function cancelSimulation() {
  if (!controller || cancelling.value) return;
  cancelling.value = true;
  controller.abort();
}

watch(
  [() => tokenStore.selectedToken?.id, () => tokenStore.selectedToken?.roleId],
  ([tokenId, roleId], previous = []) => {
    const [previousToken, previousRole] = previous;
    if (
      previousToken &&
      (tokenId !== previousToken ||
        (previousRole && roleId && String(previousRole) !== String(roleId)))
    ) {
      controller?.abort();
      result.value = null;
      seriesResults.value = [];
      selectedBattleIndex.value = -1;
      manualBattleSelection = false;
      progress.value = "";
      errorText.value = "";
    }
    invalidatePresetSwitch();
    clearPresetError();
    refreshHistory(roleId);
    refreshPreset();
    showAllHistory.value = false;
  },
  { immediate: true, flush: "sync" },
);
watch(
  connected,
  (isConnected) => {
    if (!isConnected) {
      invalidatePresetSwitch();
      clearPresetError();
      presetGeneration++;
      presetId.value = null;
      controller?.abort();
    } else {
      refreshPreset();
    }
  },
  { flush: "sync" },
);
const onHistoryStorage = (event) => {
  if (event.key === null || event.key?.startsWith(TEN_HALL_HISTORY_PREFIX)) {
    refreshHistory(historyRoleId.value);
  }
};
onMounted(() => window.addEventListener("storage", onHistoryStorage));
onUnmounted(() => {
  window.removeEventListener("storage", onHistoryStorage);
  presetGeneration++;
  invalidatePresetSwitch();
  controller?.abort();
});
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
.count-options {
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.series-summary {
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 16px;
  margin-bottom: 18px;
  font-size: 13px;
  line-height: 1.6;
}
.result .series-summary p {
  margin-top: 4px;
}
.series-summary .summary-note,
.series-summary details {
  color: var(--text-secondary);
}
.series-summary details {
  margin-top: 8px;
}
.series-summary summary {
  cursor: pointer;
}
.series-summary ol {
  max-height: 200px;
  overflow-y: auto;
  padding-left: 22px;
}
.battle-result-link {
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  line-height: 1.7;
  padding: 2px 4px;
}
.best-result-link {
  border: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  padding: 2px 4px;
}
.battle-result-link[aria-pressed="true"] {
  color: var(--primary-color);
  font-weight: 700;
}
.history {
  margin-top: 30px;
  padding-top: 22px;
  border-top: 1px solid var(--border-light);
}
.history-heading h3,
.history-heading p {
  margin: 0;
}
.history-heading h3 {
  font-size: 17px;
}
.history-heading p {
  margin-top: 5px;
  color: var(--text-secondary);
  font-size: 13px;
}
.history-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}
.history-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-light);
}
.history-open {
  display: grid;
  gap: 5px;
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  padding: 10px 4px;
  cursor: pointer;
}
.history-open:disabled {
  cursor: default;
  opacity: 0.7;
}
.history-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.history-top small,
.history-top time,
.history-roster {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.history-meta {
  display: flex;
  gap: 12px;
  align-items: baseline;
  color: var(--primary-color);
  font-size: 12px;
}
.history-metrics {
  font-size: 13px;
  line-height: 1.5;
}
.history-more {
  margin-top: 12px;
  border: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  padding: 4px;
}
.history-open:focus-visible,
.history-more:focus-visible,
.best-result-link:focus-visible,
.battle-result-link:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.confirm-intro {
  font-weight: 700;
}
.confirm-note {
  color: var(--text-secondary);
  line-height: 1.6;
}
.confirm-heroes {
  list-style: none;
  margin: 16px 0;
  padding: 0;
  border-top: 1px solid var(--border-light);
}
.confirm-heroes li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-light);
}
.confirm-heroes li span {
  color: var(--text-secondary);
}
.confirm-equipment {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 28px;
  color: var(--text-secondary);
}
.confirm-equipment strong {
  margin-left: 6px;
  color: var(--text-primary);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
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
.battle-loadout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  border-top: 1px solid var(--border-light);
  padding-top: 16px;
  margin-top: 18px;
}
.battle-loadout div {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.battle-loadout span,
.battle-loadout small {
  color: var(--text-secondary);
  font-size: 12px;
}
.battle-loadout strong {
  overflow-wrap: anywhere;
  font-size: 14px;
}
.battle-loadout .loadout-issue,
.loadout-warning {
  color: var(--error-color);
}
.result .loadout-warning {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
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
