<template>
  <div
    class="game-status-container"
    :class="{
      'full-grid': activeSection === 'fightPvp' || activeSection === 'tenHall',
      'full-page-mode':
        activeSection === 'saltFieldGroup' ||
        activeSection === 'campChallengeGroup' ||
        activeSection === 'apexChallengeGroup' ||
        activeSection === 'peachGroup' ||
        activeSection === 'rankGroup',
      'club-mode': activeSection === 'club',
      'dream-shop-priority':
        activeSection === 'tools' && dreamInitialTab === 'buy',
    }"
  >
    <nav class="section-navigation" aria-label="游戏功能分类">
      <div class="primary-section-tabs" aria-label="功能分组" role="group">
        <button
          v-for="group in navigationGroups"
          :key="group.value"
          type="button"
          :aria-pressed="activeNavigationGroup === group.value"
          @click="activeNavigationGroup = group.value"
        >
          {{ group.label }}
        </button>
      </div>
      <div
        v-if="activeNavigationSections.length > 1"
        class="secondary-section-tabs"
        aria-label="分组内功能"
        role="group"
      >
        <button
          v-for="section in activeNavigationSections"
          :key="section.value"
          type="button"
          :aria-pressed="activeSection === section.value"
          @click="activeSection = section.value"
        >
          {{ section.label }}
        </button>
      </div>
    </nav>

    <DailyActivityReminders
      v-if="activeSection === 'daily'"
      @navigate="openReminder"
    />

    <section
      v-show="activeSection === 'daily'"
      class="daily-workspace"
      aria-label="每日常用操作"
    >
      <DailyTaskStatus id="daily-task-target" tabindex="-1" />
      <section
        id="daily-maintenance-target"
        class="maintenance-panel"
        aria-label="盐罐、挂机与功法残卷"
        tabindex="-1"
      >
        <div class="maintenance-heading">
          <h2>盐罐、挂机与功法残卷</h2>
          <p>处理盐罐、先领取挂机奖励再加钟，并领取功法残卷</p>
        </div>
        <div class="combined-daily-action">
          <n-button
            type="primary"
            size="large"
            block
            :loading="combinedBusy"
            :disabled="
              !combinedConnected ||
              combinedBusy ||
              bottleHelperCard?.isBusy ||
              hangUpStatusCard?.isBusy
            "
            @click="runCombinedDailyAction"
          >
            {{
              combinedBusy
                ? `${combinedRunningName}：${combinedProgress || "正在处理…"}`
                : "一键处理盐罐、挂机与残卷"
            }}
          </n-button>
          <n-button
            v-if="combinedBusy"
            size="small"
            type="error"
            secondary
            block
            style="margin-top: 8px"
            @click="stopCombinedDailyAction"
          >
            停止后续操作
          </n-button>
          <p
            v-if="combinedResult && !combinedBusy"
            class="combined-daily-result"
            :class="`is-${combinedResult.type}`"
            role="status"
            aria-live="polite"
          >
            {{ combinedResult.text }}
          </p>
        </div>
        <details class="maintenance-details">
          <summary>查看盐罐、挂机状态及单独操作</summary>
          <div class="maintenance-cards">
            <BottleHelperCard ref="bottleHelperCard" :disabled="combinedBusy" />
            <HangUpStatusCard ref="hangUpStatusCard" :disabled="combinedBusy" />
          </div>
        </details>
      </section>
    </section>

    <section
      v-show="activeSection === 'daily'"
      class="daily-secondary"
      :class="{ 'has-tower-status': isShowTowerStatus }"
      aria-label="阵容、爬塔与逐鹿竞猜"
    >
      <div class="daily-secondary-main">
        <TeamFormation />
        <TowerStatus v-if="activeSection === 'daily' && isShowTowerStatus" />
      </div>

      <div
        class="daily-secondary-aside"
        :class="{ 'is-weird-tower-week': isWeirdTowerWeek }"
      >
        <details
          id="daily-apex-target"
          class="daily-collapse-card apex-guess-details"
          :open="apexDetailsOpen"
          tabindex="-1"
          @toggle="onApexDetailsToggle"
        >
          <summary
            class="daily-collapse-summary"
            @click="apexDetailsUserToggled = true"
            @keydown.enter="apexDetailsUserToggled = true"
            @keydown.space="apexDetailsUserToggled = true"
          >
            <img
              src="/icons/legionCup.png"
              alt=""
              class="collapse-summary-icon"
            />
            <span class="collapse-summary-text">
              <span class="collapse-summary-title">逐鹿盐山 · 竞猜</span>
              <span class="collapse-summary-meta apex-summary-status">
                {{ apexGuessSummary }}
              </span>
            </span>
          </summary>
          <div class="daily-collapse-body apex-guess-wrapper">
            <ApexGuessCard
              :active="activeSection === 'daily'"
              @nav-to-apex="activeSection = 'apexChallengeGroup'"
              @status-change="apexGuessSummary = $event"
              @state-change="apexGuessDetailState = $event"
            />
          </div>
        </details>

        <WeirdTowerStatus
          v-if="isWeirdTowerWeek"
          class="weird-tower-open-card"
        />
        <details v-else class="daily-collapse-card weird-tower-collapsed">
          <summary class="daily-collapse-summary">
            <img
              src="/icons/1733492491706152.png"
              alt=""
              class="collapse-summary-icon"
            />
            <span class="collapse-summary-text">
              <span class="collapse-summary-title">怪异塔</span>
              <span class="collapse-summary-meta">
                非黑市周暂未开放 · 点击展开
              </span>
            </span>
          </summary>
          <div class="daily-collapse-body weird-tower-collapsed-body">
            <WeirdTowerStatus />
          </div>
        </details>
      </div>
    </section>

    <details v-if="activeSection !== 'tenHall'" class="role-details">
      <summary>角色资料与资源</summary>
      <IdentityCard embedded />
    </details>

    <!-- 无限阵容助手（提取组件） -->
    <Unlimitedlineup v-if="activeSection === 'tools'" />

    <!-- 宝箱助手（提取组件） -->
    <BoxHelperCard v-if="activeSection === 'tools'" />

    <!-- 钓鱼助手（提取组件） -->
    <FishHelperCard v-if="activeSection === 'tools'" />

    <!-- 招募助手（提取组件） -->
    <RecruitHelperCard v-if="activeSection === 'tools'" />

    <!-- 升星助手（提取组件） -->
    <StarUpgradeCard v-if="activeSection === 'tools'" />

    <!-- 竞技场助手（提取组件） -->
    <FightHelperCard v-if="activeSection === 'tools'" />

    <!-- 梦境助手（提取组件） -->
    <div v-if="activeSection === 'tools'" id="dream-shop-helper" tabindex="-1">
      <DreamHelperCard :initial-tab="dreamInitialTab" />
    </div>

    <!-- 武将升级助手（提取组件） -->
    <HeroUpgradeCard v-if="activeSection === 'tools'" />

    <!-- 洗练助手（提取组件） -->
    <RefineHelperCard v-if="activeSection === 'tools'" />

    <!-- 消耗活动进度（提取组件） -->
    <ConsumptionProgressCard v-if="activeSection === 'tools'" />
    <!-- 俱乐部信息（仅俱乐部分区） -->
    <ClubInfo v-if="activeSection === 'club'" />

    <CompassCard
      v-if="activeSection === 'activity'"
      :active="activeSection === 'activity'"
    />

    <!-- 咸王宝库 -->
    <BossTower v-if="activeSection === 'activity'" />

    <!-- 月度任务进度（提取组件） -->
    <MonthlyTasksCard v-if="activeSection === 'activity'" />

    <!-- 咸鱼大冲关（提取组件） -->
    <StudyChallengeCard v-if="activeSection === 'activity'" />

    <!-- 换皮闯关 -->
    <SkinChallengeCard v-if="activeSection === 'activity'" />

    <!-- 逐鹿盐山分组 -->
    <div
      class="apex-challenge-group"
      v-if="activeSection === 'apexChallengeGroup'"
    >
      <ApexChallenge />
    </div>

    <!-- 营地挑战分组 -->
    <div
      class="camp-challenge-group"
      v-if="activeSection === 'campChallengeGroup'"
    >
      <CampChallenge />
    </div>

    <!-- 盐场分组（包含盐场、周战绩、月战绩） -->
    <div class="salt-field-group" v-if="activeSection === 'saltFieldGroup'">
      <div
        class="sub-nav"
        style="
          padding: 8px;
          background: var(--n-color);
          display: flex;
          justify-content: center;
        "
      >
        <n-tabs
          type="segment"
          animated
          v-model:value="saltFieldSubTab"
          size="small"
        >
          <n-tab-pane name="warrank" tab="盐场" />
          <n-tab-pane name="weekBattle" tab="本周盐场战绩" />
          <n-tab-pane name="monthBattle" tab="本月盐场战绩" />
          <n-tab-pane name="legionWarMap" tab="盐场地图" />
          <n-tab-pane name="legionWarStatistics" tab="盐场战况" />
        </n-tabs>
      </div>

      <!-- 盐场匹配信息详情 样式切换 -->
      <div
        class="style-switch-bar"
        v-if="saltFieldSubTab === 'warrank'"
        style="
          padding: 0 8px 8px;
          background: var(--n-color);
          display: flex;
          justify-content: center;
        "
      >
        <n-radio-group v-model:value="warrankStyle" size="small">
          <n-radio-button value="style1">样式一</n-radio-button>
          <n-radio-button value="style2">样式二</n-radio-button>
        </n-radio-group>
      </div>

      <div
        class="warrank-full-container"
        v-if="saltFieldSubTab === 'weekBattle'"
      >
        <ClubBattleRecords />
      </div>

      <div
        class="warrank-full-container"
        :class="{ 'style2-container': warrankStyle === 'style2' }"
        v-if="saltFieldSubTab === 'warrank'"
      >
        <ClubWarrankV2 v-if="warrankStyle === 'style2'" />
        <ClubWarrank v-else />
      </div>

      <div
        class="warrank-full-container"
        v-if="saltFieldSubTab === 'monthBattle'"
      >
        <ClubMonthBattleRecords />
      </div>

      <div
        class="warrank-full-container"
        v-if="saltFieldSubTab === 'legionWarMap'"
      >
        <LegionWarMap />
      </div>
      <div
        class="warrank-full-container"
        v-if="saltFieldSubTab === 'legionWarStatistics'"
      >
        <LegionWarStatistics />
      </div>
    </div>

    <!-- 蟠桃园分组 -->
    <div class="peach-group" v-if="activeSection === 'peachGroup'">
      <div
        class="sub-nav"
        style="
          padding: 8px;
          background: var(--n-color);
          display: flex;
          justify-content: center;
        "
      >
        <n-tabs
          type="segment"
          animated
          v-model:value="peachSubTab"
          size="small"
        >
          <n-tab-pane name="peach" tab="蟠桃园信息" />
          <n-tab-pane name="peachBattle" tab="蟠桃园战绩" />
        </n-tabs>
      </div>

      <!-- 蟠桃园信息 样式切换 -->
      <div
        class="style-switch-bar"
        v-if="peachSubTab === 'peach'"
        style="
          padding: 0 8px 8px;
          background: var(--n-color);
          display: flex;
          justify-content: center;
        "
      >
        <n-radio-group v-model:value="peachStyle" size="small">
          <n-radio-button value="style1">样式一</n-radio-button>
          <n-radio-button value="style2">样式二</n-radio-button>
        </n-radio-group>
      </div>

      <div class="warrank-full-container" v-if="peachSubTab === 'peachBattle'">
        <PeachBattleRecords />
      </div>

      <div
        class="warrank-full-container"
        :class="{ 'style2-container': peachStyle === 'style2' }"
        v-if="peachSubTab === 'peach'"
      >
        <PeachInfoV2 v-if="peachStyle === 'style2'" />
        <PeachInfo v-else />
      </div>
    </div>

    <!-- 排行榜分组 -->
    <div class="rank-group" v-if="activeSection === 'rankGroup'">
      <div
        class="sub-nav"
        style="
          padding: 8px;
          background: var(--n-color);
          display: flex;
          justify-content: center;
        "
      >
        <n-tabs type="segment" animated v-model:value="rankSubTab" size="small">
          <n-tab-pane name="serverrank" tab="区服榜" />
          <n-tab-pane name="toprank" tab="巅峰榜" />
          <n-tab-pane name="topclubrank" tab="俱乐部榜" />
          <n-tab-pane name="goldclubrank" tab="黄金积分榜" />
          <n-tab-pane name="greatRouteRank" tab="伟大航路积分榜" />
        </n-tabs>
      </div>

      <div class="warrank-full-container" v-if="rankSubTab === 'serverrank'">
        <ServerRankList />
      </div>

      <div class="warrank-full-container" v-if="rankSubTab === 'toprank'">
        <TopRankList />
      </div>

      <div class="warrank-full-container" v-if="rankSubTab === 'topclubrank'">
        <TopClubList />
      </div>

      <div class="warrank-full-container" v-if="rankSubTab === 'goldclubrank'">
        <GoldClubList />
      </div>

      <div
        class="warrank-full-container"
        v-if="rankSubTab === 'greatRouteRank'"
      >
        <GreatRouteRankList />
      </div>
    </div>
    <!-- 切磋（提取组件） -->
    <FightPvp v-if="activeSection === 'fightPvp'" />
    <TenHallSimulator
      v-if="tenHallVisited"
      v-show="activeSection === 'tenHall'"
    />
  </div>
</template>

<script setup>
import { useMessage } from "naive-ui";
import {
  computed,
  defineAsyncComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import { useShanghaiClock } from "@/hooks/useShanghaiClock";
import { useTokenStore } from "@/stores/tokenStore";
import {
  getTodayApexGuessSchedule,
  toChinaWallClockMs,
} from "@/utils/apexRules";
import { getCurrentActivityWeek } from "@/utils/batch/viewHelpers";
import { runBottleAndHangUp } from "@/utils/bottleAndHangUp";

import ApexGuessCard from "./cards/ApexGuessCard.vue";
import BottleHelperCard from "./cards/BottleHelperCard.vue";
import HangUpStatusCard from "./cards/HangUpStatusCard.vue";
import DailyActivityReminders from "./DailyActivityReminders.vue";
import WeirdTowerStatus from "./Tower/WeirdTowerStatus.vue";

const loadingSection = {
  render: () =>
    h("p", { class: "lazy-section-state", role: "status" }, "正在加载…"),
};
const failedSection = {
  render: () =>
    h(
      "p",
      { class: "lazy-section-state", role: "alert" },
      "加载失败，请刷新页面后重试。",
    ),
};
const lazySection = (loader) =>
  defineAsyncComponent({
    loader,
    delay: 200,
    timeout: 30000,
    loadingComponent: loadingSection,
    errorComponent: failedSection,
  });

const BoxHelperCard = lazySection(() => import("./cards/BoxHelperCard.vue"));
const FishHelperCard = lazySection(() => import("./cards/FishHelperCard.vue"));
const MonthlyTasksCard = lazySection(
  () => import("./cards/MonthlyTasksCard.vue"),
);
const RecruitHelperCard = lazySection(
  () => import("./cards/RecruitHelperCard.vue"),
);
const SkinChallengeCard = lazySection(
  () => import("./cards/SkinChallengeCard.vue"),
);
const StudyChallengeCard = lazySection(
  () => import("./cards/StudyChallengeCard.vue"),
);
const Unlimitedlineup = lazySection(
  () => import("./cards/Unlimitedlineup.vue"),
);
const TowerStatus = lazySection(() => import("./Tower/TowerStatus.vue"));

const CompassCard = lazySection(() => import("./cards/CompassCard.vue"));
const ApexChallenge = lazySection(() => import("./Apex/ApexChallenge.vue"));
const ConsumptionProgressCard = lazySection(
  () => import("./cards/ConsumptionProgressCard.vue"),
);
const DreamHelperCard = lazySection(
  () => import("./cards/DreamHelperCard.vue"),
);
const FightHelperCard = lazySection(
  () => import("./cards/FightHelperCard.vue"),
);
const FightPvp = lazySection(() => import("./cards/FightPvp.vue"));
const GoldClubList = lazySection(
  () => import("./cards/GoldRankListPageCard.vue"),
);
const HeroUpgradeCard = lazySection(
  () => import("./cards/HeroUpgradeCard.vue"),
);
const RefineHelperCard = lazySection(
  () => import("./cards/RefineHelperCard.vue"),
);
const ServerRankList = lazySection(
  () => import("./cards/ServerRankListPageCard.vue"),
);
const StarUpgradeCard = lazySection(
  () => import("./cards/StarUpgradeCard.vue"),
);
const TenHallSimulator = lazySection(
  () => import("./cards/TenHallSimulator.vue"),
);
const TopClubList = lazySection(
  () => import("./cards/TopClubListPageCard.vue"),
);
const TopRankList = lazySection(
  () => import("./cards/TopRankListPageCard.vue"),
);
const CampChallenge = lazySection(() => import("./Club/CampChallenge.vue"));
const ClubBattleRecords = lazySection(
  () => import("./Club/ClubBattleRecords.vue"),
);
const ClubInfo = lazySection(() => import("./Club/ClubInfo.vue"));
const ClubMonthBattleRecords = lazySection(
  () => import("./Club/ClubMonthBattleRecords.vue"),
);
const ClubWarrank = lazySection(() => import("./Club/ClubWarrank.vue"));
const ClubWarrankV2 = lazySection(() => import("./Club/ClubWarrankV2.vue"));
const GreatRouteRankList = lazySection(
  () => import("./Club/GreatRouteRankListPageCard.vue"),
);
const LegionWarMap = lazySection(() => import("./Club/LegionWarMap.vue"));
const LegionWarStatistics = lazySection(
  () => import("./Club/LegionWarStatistics.vue"),
);
const PeachBattleRecords = lazySection(
  () => import("./Club/PeachBattleRecords.vue"),
);
const PeachInfo = lazySection(() => import("./Club/PeachInfo.vue"));
const PeachInfoV2 = lazySection(() => import("./Club/PeachInfoV2.vue"));
const BossTower = lazySection(() => import("./Tower/BossTower.vue"));

const tokenStore = useTokenStore();
const message = useMessage();
const bottleHelperCard = ref(null);
const hangUpStatusCard = ref(null);
const apexGuessSummary = ref("检查中");
const apexGuessDetailState = ref(null);
const apexDetailsUserToggled = ref(false);
const combinedBusy = ref(false);
const combinedProgress = ref("");
const combinedRunningName = ref("");
const combinedResults = ref({});
let combinedGeneration = 0;
watch(
  () => {
    const id = tokenStore.selectedToken?.id;
    return [
      id,
      id ? tokenStore.getWebSocketStatus(id) : null,
      id ? tokenStore.wsConnections?.[id]?.client : null,
    ];
  },
  () => combinedGeneration++,
  { flush: "sync" },
);
onBeforeUnmount(() => {
  combinedGeneration++;
});
const combinedResult = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return tokenId ? combinedResults.value[tokenId] : null;
});
const combinedConnected = computed(() => {
  const tokenId = tokenStore.selectedToken?.id;
  return tokenId && tokenStore.getWebSocketStatus(tokenId) === "connected";
});
const shanghaiNow = useShanghaiClock();
const isWeirdTowerWeek = computed(
  () => getCurrentActivityWeek(shanghaiNow.value) === "黑市周",
);
const shouldAutoExpandApex = computed(() => {
  const today = getTodayApexGuessSchedule(
    toChinaWallClockMs(shanghaiNow.value),
  );
  const state = apexGuessDetailState.value;
  return Boolean(
    today.isGuessDay ||
    state?.hasOpenGuesses ||
    (state?.claimState === "ready" && state?.claimableRewards?.length > 0),
  );
});
const apexDetailsOpen = ref(shouldAutoExpandApex.value);
watch(
  shouldAutoExpandApex,
  (shouldOpen) => {
    if (!apexDetailsUserToggled.value) {
      apexDetailsOpen.value = shouldOpen;
    }
  },
  { immediate: true },
);
const onApexDetailsToggle = (event) => {
  const nextOpen = Boolean(event?.target?.open);
  if (nextOpen !== apexDetailsOpen.value) {
    apexDetailsOpen.value = nextOpen;
  }
};

const stopCombinedDailyAction = () => {
  if (!combinedBusy.value) return;
  combinedGeneration++;
  combinedProgress.value = "正在停止，等待当前请求结束";
  message.info("已请求停止，当前步骤完成后结束");
};

const runCombinedDailyAction = async () => {
  const tokenId = tokenStore.selectedToken?.id;
  if (!tokenId) return message.warning("请先选择Token");
  if (combinedBusy.value) return;
  const accountName = tokenStore.selectedToken?.name || "当前角色";
  const generation = combinedGeneration;
  combinedBusy.value = true;
  combinedRunningName.value = accountName;
  try {
    const result = await runBottleAndHangUp({
      tokenStore,
      tokenId,
      shouldStop: () => combinedGeneration !== generation,
      onProgress: (text) => {
        if (combinedGeneration === generation) combinedProgress.value = text;
      },
    });
    const legacyText =
      result.legacy.status === "acknowledged"
        ? result.legacy.received == null
          ? "功法残卷领取请求已完成"
          : `功法残卷领取 ${result.legacy.received} 个`
        : `功法残卷领取未确认：${result.legacy.error}`;
    const hangUpText = result.remaining
      ? `还有 ${result.remaining} 个加钟槽位未确认`
      : `加钟已补满（本次加钟 ${result.sent} 次）`;
    const summary = `${accountName}：盐罐已启动，挂机奖励已领取，${hangUpText}；${legacyText}`;
    const type =
      result.remaining || result.legacy.status !== "acknowledged"
        ? "warning"
        : "success";
    combinedResults.value = {
      ...combinedResults.value,
      [tokenId]: { type, text: summary },
    };
    if (type === "warning") message.warning(summary);
    else message.success(summary);
  } catch (error) {
    const text = `${accountName}的一键处理未完成：${error.message || "未知错误"}`;
    combinedResults.value = {
      ...combinedResults.value,
      [tokenId]: { type: "error", text },
    };
    message.error(text);
  } finally {
    combinedBusy.value = false;
    combinedProgress.value = "";
    combinedRunningName.value = "";
  }
};

// 响应式数据

const ENABLE_TOOLS_TAB = true; // 工具分区开关
const activeSection = ref("daily");
// Keep the existing section identifiers as the source of truth, including
// direct navigation from reminders and the guessing card.
const navigationGroups = computed(() => [
  {
    value: "daily",
    label: "日常",
    sections: [{ value: "daily", label: "日常" }],
  },
  {
    value: "battle",
    label: "十殿与切磋",
    sections: [
      { value: "tenHall", label: "模拟十殿" },
      { value: "fightPvp", label: "切磋" },
    ],
  },
  {
    value: "events",
    label: "赛事与排行",
    sections: [
      { value: "apexChallengeGroup", label: "逐鹿盐山" },
      { value: "campChallengeGroup", label: "营地挑战" },
      { value: "saltFieldGroup", label: "盐场" },
      { value: "peachGroup", label: "蟠桃园" },
      { value: "rankGroup", label: "排行榜" },
    ],
  },
  {
    value: "club",
    label: "俱乐部",
    sections: [{ value: "club", label: "俱乐部" }],
  },
  {
    value: "activity",
    label: "活动",
    sections: [{ value: "activity", label: "活动" }],
  },
  ...(ENABLE_TOOLS_TAB
    ? [
        {
          value: "tools",
          label: "工具",
          sections: [{ value: "tools", label: "工具" }],
        },
      ]
    : []),
]);
const lastVisitedSections = ref({});
const activeNavigationGroup = computed({
  get: () =>
    navigationGroups.value.find((group) =>
      group.sections.some((section) => section.value === activeSection.value),
    )?.value || "daily",
  set: (value) => {
    const group = navigationGroups.value.find((item) => item.value === value);
    if (!group) return;
    const last = lastVisitedSections.value[value];
    activeSection.value = group.sections.some((item) => item.value === last)
      ? last
      : group.sections[0].value;
  },
});
const activeNavigationSections = computed(
  () =>
    navigationGroups.value.find(
      (group) => group.value === activeNavigationGroup.value,
    )?.sections || [],
);
const dreamInitialTab = ref("battle");
const route = useRoute();
let dreamObserver;
const openReminder = async (kind) => {
  if (kind === "camp") activeSection.value = "campChallengeGroup";
  if (kind === "legionWar") activeSection.value = "saltFieldGroup";
  if (kind === "apex") {
    activeSection.value = "daily";
    apexDetailsOpen.value = true;
    await nextTick();
    const target = document.getElementById("daily-apex-target");
    if (target) target.open = true;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: "auto", block: "start" });
  }
  if (kind === "daily") {
    activeSection.value = "daily";
    await nextTick();
    const target = document.getElementById("daily-task-target");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: "auto", block: "start" });
  }
  if (kind === "dream") {
    dreamInitialTab.value = "buy";
    activeSection.value = "tools";
    await nextTick();
    dreamObserver?.disconnect();
    const target = document.getElementById("dream-shop-helper");
    if (!target || activeSection.value !== "tools") return;
    const focusWhenReady = () => {
      if (activeSection.value !== "tools" || !target.isConnected) {
        dreamObserver?.disconnect();
        return;
      }
      if (!target.querySelector(".merchant-actions")) return;
      dreamObserver?.disconnect();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "auto", block: "start" });
    };
    dreamObserver = new MutationObserver(focusWhenReady);
    dreamObserver.observe(target, { childList: true, subtree: true });
    focusWhenReady();
  }
};
watch(
  () => route.query.reminder,
  (kind) => {
    if (kind === "camp" || kind === "dream") openReminder(kind);
  },
  { immediate: true },
);
const openDailyTarget = async (kind) => {
  const targets = {
    tasks: "daily-task-target",
    maintenance: "daily-maintenance-target",
    apex: "daily-apex-target",
  };
  if (typeof kind !== "string" || !Object.hasOwn(targets, kind)) return;
  activeSection.value = "daily";
  await nextTick();
  if (route.query.daily !== kind || activeSection.value !== "daily") return;
  const target = document.getElementById(targets[kind]);
  if (!target) return;
  if (kind === "apex") target.open = true;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: "auto", block: "start" });
};
watch(() => route.query.daily, openDailyTarget, { immediate: true });
const tenHallVisited = ref(false);
watch(
  activeSection,
  (section) => {
    const group = navigationGroups.value.find((item) =>
      item.sections.some((entry) => entry.value === section),
    );
    if (group) lastVisitedSections.value[group.value] = section;
    if (section === "tenHall") tenHallVisited.value = true;
  },
  { immediate: true, flush: "sync" },
);
const saltFieldSubTab = ref("warrank");
const peachSubTab = ref("peach");
const rankSubTab = ref("serverrank");

// 盐场匹配信息详情 / 蟠桃园信息 界面样式选择（style1=原有样式，style2=移植样式）
const warrankStyle = ref(
  localStorage.getItem("club_warrank_style") || "style1",
);
const peachStyle = ref(localStorage.getItem("peach_info_style") || "style1");

watch(warrankStyle, (newStyle) => {
  localStorage.setItem("club_warrank_style", newStyle);
});
watch(peachStyle, (newStyle) => {
  localStorage.setItem("peach_info_style", newStyle);
});

// 活动开放时间：仅周一到周三可参与

// 计算属性
const roleInfo = computed(() => {
  return tokenStore.gameData?.roleInfo || null;
});
const isShowTowerStatus = computed(() => {
  const tower = roleInfo.value?.role?.tower;
  const towerId = tower?.id;
  const floor = Math.floor(towerId / 10) + 1;
  if (floor > 450) {
    return false;
  }
  return true;
});

// 监听 WebSocket 连接状态（按账号隔离俱乐部信息拉取）
const fetchedLegionTokenIds = new Set();
const fetchLegionInfoIfNeeded = (tokenId, status) => {
  if (!tokenId) return;
  if (status === "connected") {
    if (!fetchedLegionTokenIds.has(tokenId)) {
      fetchedLegionTokenIds.add(tokenId);
      tokenStore.sendMessage(tokenId, "legion_getinfo");
    }
  } else if (status === "disconnected" || status === "error") {
    fetchedLegionTokenIds.delete(tokenId);
  }
};

watch(
  [
    () => tokenStore.selectedToken?.id,
    () =>
      tokenStore.selectedToken
        ? tokenStore.getWebSocketStatus(tokenStore.selectedToken.id)
        : "disconnected",
  ],
  ([tokenId, status]) => {
    fetchLegionInfoIfNeeded(tokenId, status);
  },
);

// 战绩加载逻辑现由俱乐部信息模块负责

// 生命周期
onMounted(() => {
  // 获取俱乐部信息
  const tokenId = tokenStore.selectedToken?.id;
  if (tokenId) {
    fetchLegionInfoIfNeeded(tokenId, tokenStore.getWebSocketStatus(tokenId));
  }
});

onUnmounted(() => {
  dreamObserver?.disconnect();
});
</script>

<style scoped lang="scss">
.lazy-section-state {
  grid-column: 1 / -1;
  padding: 20px;
  color: var(--text-secondary);
}

.daily-secondary {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(270px, 0.8fr) minmax(0, 1.5fr);
  gap: var(--spacing-lg);
  align-items: start;
  min-width: 0;

  &.has-tower-status {
    grid-template-columns: minmax(0, 1fr);

    .daily-secondary-main {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--spacing-lg);
      align-items: stretch;
    }
  }
}

.daily-secondary-main {
  min-width: 0;
}

.daily-secondary-aside {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-lg);
  align-items: start;

  &.is-weird-tower-week .weird-tower-open-card {
    order: -1;
  }
}

.daily-collapse-card {
  min-width: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-xl);
  background: var(--bg-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);

  &:hover {
    border-color: var(--border-medium, var(--border-light));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  }

  &[open] {
    border-style: solid;
  }
}

.weird-tower-collapsed:not([open]) {
  border-style: dashed;
}

.daily-collapse-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;

  &::-webkit-details-marker {
    display: none;
  }

  &::after {
    content: "";
    flex: none;
    width: 8px;
    height: 8px;
    margin-left: auto;
    border-right: 2px solid var(--text-secondary);
    border-bottom: 2px solid var(--text-secondary);
    transform: rotate(-45deg);
    transition: transform var(--transition-fast);
  }

  &:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
    border-radius: var(--border-radius-xl);
  }
}

.daily-collapse-card[open] > .daily-collapse-summary {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-light);
  border-radius: var(--border-radius-xl) var(--border-radius-xl) 0 0;
  background: var(--bg-secondary);

  .collapse-summary-icon {
    display: none;
  }

  .collapse-summary-text {
    flex-direction: row;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
  }

  .collapse-summary-title {
    font-size: 13px;
    color: var(--text-secondary);
  }

  &::after {
    transform: rotate(45deg);
  }
}

.collapse-summary-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}

.collapse-summary-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.collapse-summary-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.collapse-summary-meta {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.daily-collapse-body {
  padding: 0;

  :deep(.status-card) {
    min-width: 0;
    min-height: 0;
    border: 0;
    border-radius: 0 0 var(--border-radius-xl) var(--border-radius-xl);
    box-shadow: none;
    transform: none;
  }

  :deep(.status-card:hover) {
    transform: none;
    box-shadow: none;
  }
}

.weird-tower-collapsed-body {
  margin-top: 0;
}
.game-status-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);

  // 在大屏幕上限制最大列数以确保卡片有足够宽度
  @media (min-width: 1400px) {
    grid-template-columns: repeat(3, 1fr);
    max-width: 1400px;
    margin: 0 auto;
  }

  // 在中等屏幕上确保有足够空间
  @media (max-width: 1200px) {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  // 在较小屏幕上使用单列布局
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }

  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--spacing-sm);
    gap: var(--spacing-md);
  }
}

.full-grid {
  grid-template-columns: repeat(1, 1fr);
}

.game-status-container.full-page-mode {
  max-width: 100% !important;
  grid-template-columns: 1fr;
  padding: var(--spacing-sm);

  @media (min-width: 1400px) {
    max-width: 100% !important;
  }
}

.game-status-container.club-mode {
  @media (min-width: 1400px) {
    grid-template-columns: repeat(2, 1fr);
    max-width: 100% !important;
  }
}

// Keep the selected dream card ahead of other lazily loaded tool cards so their
// eventual height cannot move it away after the router has positioned it.
.dream-shop-priority .section-navigation {
  order: -2;
}
.dream-shop-priority #dream-shop-helper {
  order: -1;
}
#dream-shop-helper {
  min-width: 0;
  scroll-margin-top: 76px;
}
#daily-task-target,
#daily-maintenance-target,
#daily-apex-target {
  scroll-margin-top: 76px;
}

.section-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px var(--spacing-sm);
}

.identity-toggle {
  padding: 6px 12px;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
}

.section-navigation {
  grid-column: 1 / -1;
  min-width: 0;
  display: grid;
  gap: 8px;
  margin: 0 var(--spacing-sm) var(--spacing-md);
}

.primary-section-tabs,
.secondary-section-tabs {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.primary-section-tabs {
  border-bottom: 1px solid var(--border-light);
}

.section-navigation button {
  flex: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 8px 12px;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.section-navigation button[aria-pressed="true"] {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.section-navigation button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
  border-radius: 4px;
}

.secondary-section-tabs button {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 13px;
}

.secondary-section-tabs button[aria-pressed="true"] {
  background: var(--bg-primary);
}

.daily-workspace {
  grid-column: 1 / -1;
  display: grid;
  gap: var(--spacing-lg);
  min-width: 0;
  grid-template-columns: minmax(270px, 0.8fr) minmax(0, 1.5fr);
  align-items: stretch;
}

.maintenance-panel {
  min-width: 0;
  padding: 20px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-xl);
}

.maintenance-heading {
  margin-bottom: 16px;

  h2 {
    margin: 0 0 4px;
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.maintenance-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;

  :deep(.status-card) {
    min-width: 0;
    min-height: 0;
    padding: 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-light);
    border-radius: var(--border-radius-medium);
    box-shadow: none;
    transform: none;
  }

  :deep(.card-header) {
    margin-bottom: 12px;
  }

  :deep(.card-content) {
    margin-bottom: 12px;
    font-variant-numeric: tabular-nums;
  }
}

.apex-guess-details {
  .apex-summary-status {
    color: var(--primary-color);
  }
}

.role-details {
  grid-column: 1 / -1;
  min-width: 0;

  summary {
    padding: 10px 2px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
  }

  summary:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 3px;
  }
}

.combined-daily-action {
  grid-column: 1 / -1;

  :deep(.n-button) {
    min-height: 52px;
    font-size: 15px;
    font-weight: 600;
  }
}

.combined-daily-result {
  margin: 10px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;

  &.is-warning {
    border-left: 3px solid #e09b24;
  }
  &.is-error {
    border-left: 3px solid #d34c4c;
  }
  &.is-success {
    border-left: 3px solid #18a058;
  }
}

.maintenance-details {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-light);

  summary {
    width: fit-content;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
  }

  summary:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 3px;
  }
}

@media (max-width: 900px) {
  .daily-workspace,
  .daily-secondary,
  .daily-secondary.has-tower-status .daily-secondary-main {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 600px) {
  .maintenance-panel {
    padding: 16px;
  }

  .maintenance-cards,
  .daily-secondary-aside {
    grid-template-columns: minmax(0, 1fr);
  }
}

.warrank-full-container {
  grid-column: 1 / -1;
  width: 100%;
  height: calc(100vh - 200px);
  min-height: 600px;
  overflow: hidden;

  @media (max-width: 768px) {
    height: calc(100vh - 180px);
    min-height: 500px;
  }
}

/* 样式二（移植版）容器尺寸，不影响样式一 */
.warrank-full-container.style2-container {
  position: relative;
  z-index: 1;
  height: calc(100vh - 180px);
  min-height: 700px;

  @media (max-width: 768px) {
    height: calc(100vh - 180px);
    min-height: 500px;
  }
}

.salt-field-group,
.peach-group,
.rank-group {
  grid-column: 1 / -1;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.monthly-tasks .description.muted {
  color: var(--text-tertiary);
  margin-top: var(--spacing-sm);
}

.monthly-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-sm);
}

.status-dot {
  &.completed {
    background: var(--success-color);
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
  }
}

.energy-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.card-content {
  .time-display {
    font-size: 1.5rem;
    /* text-2xl */
    font-weight: 700;
    /* font-bold */
    color: var(--text-primary);
    text-align: center;
    margin-bottom: var(--spacing-md);
    font-family:
      "SF Mono", "Monaco", "Inconsolata", "Roboto Mono", "Consolas", monospace;
    letter-spacing: 0.1em;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    background: var(--bg-tertiary);
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border-light);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.06);
    transition: all 0.2s ease-in-out;

    &:hover {
      transform: translateY(-1px);
      box-shadow:
        0 4px 6px rgba(0, 0, 0, 0.1),
        0 2px 4px rgba(0, 0, 0, 0.06);
    }
  }

  .description {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    margin-bottom: var(--spacing-lg);
  }

  .club-name {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    margin-bottom: var(--spacing-lg);

    strong {
      color: var(--text-primary);
      font-weight: var(--font-weight-medium);
    }
  }

  .tower-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-lg);

    .label {
      color: var(--text-secondary);
      font-size: var(--font-size-sm);
    }

    .tower-level {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--text-primary);
    }
  }
}

.action-row {
  display: flex;
  gap: var(--spacing-sm);

  .action-button {
    flex: 1;
  }
}

.loading-text {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
}

.loading-icon {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

// 响应式设计
@media (max-width: 768px) {
  .game-status-container {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--spacing-sm);
  }

  .game-status-container > * {
    min-width: 0;
  }

  .game-status-container :deep(.lineup-saver .toolbar),
  .game-status-container :deep(.lineup-saver .team-selector),
  .game-status-container :deep(.dream-helper .merchant-actions),
  .game-status-container :deep(.dream-helper .team-actions) {
    flex-wrap: wrap;
  }

  .game-status-container :deep(.dream-helper .merchant-actions .n-button) {
    max-width: 100%;
    height: auto;
    min-height: 32px;
    white-space: normal;
  }

  .status-card {
    padding: var(--spacing-md);
  }

  .card-header {
    flex-wrap: wrap;
    gap: var(--spacing-sm);

    .status-info {
      flex: 1;
      min-width: 120px;
    }

    .status-badge {
      margin-left: auto;
    }
  }
}
</style>
