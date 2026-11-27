<template>
  <div class="status-card team-formation-card">
    <div class="card-header">
      <img
        src="/icons/Ob7pyorzmHiJcbab2c25af264d0758b527bc1b61cc3b.png"
        alt=""
        class="icon"
      />
      <h3>阵容</h3>
      <button
        type="button"
        class="refresh-button"
        :disabled="!isConnected || loading || switching"
        title="刷新队伍数据"
        @click="refreshTeamData(true)"
      >
        <svg
          class="refresh-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
        <span class="refresh-text">刷新</span>
      </button>
      <p>当前使用的战斗阵容</p>
    </div>

    <div class="card-content">
      <div class="team-controls">
        <span class="team-caption">
          {{ loading ? "预设阵容" : `当前阵容 ${currentTeam}` }}
        </span>
        <div class="team-selector" role="group" aria-label="预设阵容">
          <button
            v-for="teamId in availableTeams"
            :key="teamId"
            type="button"
            :disabled="!isConnected || loading || switching"
            class="team-button"
            :class="{ active: currentTeam === teamId }"
            :aria-pressed="currentTeam === teamId"
            :aria-label="`阵容 ${teamId}`"
            @click="selectTeam(teamId)"
          >
            {{ teamId }}
          </button>
        </div>
      </div>

      <div class="heroes-container">
        <div
          v-if="!loading && currentTeamHeroes.length"
          class="heroes-formation"
        >
          <!-- 前排 2个 -->
          <div class="formation-row front-row">
            <div
              v-for="hero in currentTeamHeroes.slice(0, 2)"
              :key="hero.id || hero.name"
              class="hero-item"
            >
              <div class="hero-circle">
                <img
                  v-if="hero.avatar"
                  :src="hero.avatar"
                  :alt="hero.name"
                  class="hero-avatar"
                />
                <div v-else class="hero-placeholder">
                  {{ hero.name?.substring(0, 2) || "?" }}
                </div>
              </div>
              <span class="hero-name">{{ hero.name || "未知" }}</span>
            </div>
          </div>
          <!-- 后排 3个 -->
          <div class="formation-row back-row">
            <div
              v-for="hero in currentTeamHeroes.slice(2)"
              :key="hero.id || hero.name"
              class="hero-item"
            >
              <div class="hero-circle">
                <img
                  v-if="hero.avatar"
                  :src="hero.avatar"
                  :alt="hero.name"
                  class="hero-avatar"
                />
                <div v-else class="hero-placeholder">
                  {{ hero.name?.substring(0, 2) || "?" }}
                </div>
              </div>
              <span class="hero-name">{{ hero.name || "未知" }}</span>
            </div>
          </div>
        </div>

        <div v-if="!loading && !currentTeamHeroes.length" class="empty-team">
          <p>{{ isConnected ? "暂无队伍信息" : "连接恢复后加载阵容" }}</p>
        </div>
        <div v-if="loading" class="empty-team">
          <p>正在加载队伍信息…</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMessage } from "naive-ui";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT } from "@/utils/HeroList.js";

const tokenStore = useTokenStore();
const message = useMessage();

const switching = ref(false);
const currentTeam = ref(1);
const availableTeams = ref<number[]>([1, 2, 3, 4]);
const accountId = computed(() => tokenStore.selectedToken?.id);
const connectionClient = computed(() =>
  accountId.value ? tokenStore.getWebSocketClient(accountId.value) : null,
);
const isConnected = computed(() => {
  const tokenId = accountId.value;
  return !!tokenId && tokenStore.getWebSocketStatus(tokenId) === "connected";
});
type TeamConnection = NonNullable<
  ReturnType<typeof tokenStore.getWebSocketClient>
>;
const pendingLoad = shallowRef<{
  tokenId: string;
  client: TeamConnection;
} | null>(null);
const loading = computed(
  () =>
    isConnected.value &&
    pendingLoad.value?.tokenId === accountId.value &&
    pendingLoad.value?.client === connectionClient.value,
);
let active = true;
onBeforeUnmount(() => {
  active = false;
});
const hasCurrentConnection = (tokenId: string, client: TeamConnection) =>
  active &&
  tokenId === accountId.value &&
  client === connectionClient.value &&
  isConnected.value;

const presetTeamRaw = computed(() => tokenStore.gameData?.presetTeam ?? null);

function normalizePresetTeam(raw: any) {
  if (!raw)
    return {
      useTeamId: 1,
      teams: {} as Record<number, { teamInfo: Record<string, any> }>,
    };
  const root = raw.presetTeamInfo ?? raw;
  const findUseIdRec = (obj: any): number | null => {
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.useTeamId === "number") return obj.useTeamId;
    for (const k of Object.keys(obj)) {
      const v = findUseIdRec(obj[k]);
      if (v) return v;
    }
    return null;
  };
  const useTeamId =
    root.useTeamId ?? root.presetTeamInfo?.useTeamId ?? findUseIdRec(root) ?? 1;

  const dict = root.presetTeamInfo ?? root;
  const teams: Record<number, { teamInfo: Record<string, any> }> = {};
  const ids = Object.keys(dict || {}).filter((k) => /^\d+$/.test(k));
  for (const idStr of ids) {
    const id = Number(idStr);
    const node = dict[idStr];
    if (!node) {
      teams[id] = { teamInfo: {} };
      continue;
    }
    if (node.teamInfo) {
      teams[id] = { teamInfo: node.teamInfo };
    } else if (node.heroes) {
      const ti: Record<string, any> = {};
      node.heroes.forEach((h: any, idx: number) => {
        ti[String(idx + 1)] = h;
      });
      teams[id] = { teamInfo: ti };
    } else if (typeof node === "object") {
      const hasHero = Object.values(node).some(
        (v: any) => v && typeof v === "object" && "heroId" in v,
      );
      teams[id] = { teamInfo: hasHero ? node : {} };
    } else {
      teams[id] = { teamInfo: {} };
    }
  }
  return { useTeamId: Number(useTeamId) || 1, teams };
}

const presetTeam = computed(() => normalizePresetTeam(presetTeamRaw.value));

const currentTeamHeroes = computed(() => {
  const team = (presetTeam.value.teams as any)[currentTeam.value]?.teamInfo;
  if (!team) return [] as any[];
  const heroes: any[] = [];
  for (const [pos, hero] of Object.entries(team)) {
    const hid = (hero as any)?.heroId ?? (hero as any)?.id;
    if (!hid) continue;
    const meta = HERO_DICT[Number(hid)];
    const avatarPath = meta?.avatar;
    const fullAvatarPath = avatarPath
      ? import.meta.env.BASE_URL + avatarPath.replace(/^\//, "")
      : undefined;
    heroes.push({
      id: Number(hid),
      name: meta?.name ?? `英雄${hid}`,
      type: meta?.type ?? "",
      position: Number(pos),
      level: (hero as any)?.level ?? 1,
      avatar: fullAvatarPath,
    });
  }
  heroes.sort((a, b) => a.position - b.position);
  return heroes;
});

const refreshTeamData = async (showError = false) => {
  const tokenId = accountId.value;
  const client = connectionClient.value;
  if (!tokenId || !client || !isConnected.value || loading.value) return;
  const request = { tokenId, client };
  pendingLoad.value = request;
  try {
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_getinfo",
      {},
      8000,
    );
    if (
      pendingLoad.value === request &&
      hasCurrentConnection(tokenId, client)
    ) {
      tokenStore.getAccountGameData(tokenId).value.presetTeam = result;
    }
  } catch (error) {
    if (
      showError &&
      pendingLoad.value === request &&
      hasCurrentConnection(tokenId, client)
    ) {
      message.error(
        `获取阵容信息失败：${error instanceof Error ? error.message : error}`,
      );
    }
  } finally {
    if (pendingLoad.value === request) pendingLoad.value = null;
  }
};

const updateAvailableTeams = () => {
  const ids = Object.keys(presetTeam.value.teams)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  availableTeams.value = ids.length ? ids : [1, 2, 3, 4];
};
const updateCurrentTeam = () => {
  currentTeam.value = (presetTeam.value as any).useTeamId || 1;
};

const selectTeam = async (teamId: number) => {
  const tokenId = accountId.value;
  const client = connectionClient.value;
  if (
    !tokenId ||
    !client ||
    !isConnected.value ||
    switching.value ||
    loading.value
  )
    return;
  const prev = currentTeam.value;
  switching.value = true;
  try {
    await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_saveteam",
      { teamId },
      8000,
    );
    if (!hasCurrentConnection(tokenId, client)) return;
    currentTeam.value = teamId;
    message.success(`已切换到阵容 ${teamId}`);
    await refreshTeamData(true);
  } catch (error) {
    if (hasCurrentConnection(tokenId, client)) {
      currentTeam.value = prev;
      message.error(
        `切换阵容失败：${error instanceof Error ? error.message : error}`,
      );
    }
  } finally {
    switching.value = false;
  }
};

watch(
  () => presetTeamRaw.value,
  () => {
    updateAvailableTeams();
    updateCurrentTeam();
  },
  { deep: true, immediate: true },
);
watch([accountId, connectionClient, isConnected], () => refreshTeamData(), {
  immediate: true,
});
</script>

<style scoped lang="scss">
.team-formation-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 220px;
  border: 1px solid var(--border-light);
  box-shadow: none;

  &:hover {
    transform: none;
    box-shadow: none;
  }

  .card-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    margin-bottom: 0;
  }
}

.card-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  grid-template-areas:
    "icon title refresh"
    "icon description description";
  align-items: center;
  gap: 2px 12px;
  margin-bottom: 14px;
}

.icon {
  grid-area: icon;
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.card-header h3 {
  grid-area: title;
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
}

.card-header p {
  grid-area: description;
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.team-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.team-caption {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: var(--font-weight-medium);
}

.team-selector {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}

.team-button {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.team-button:hover {
  background: var(--bg-secondary);
}

.team-button.active {
  background: var(--primary-color-hover);
  color: white;
}

.team-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.refresh-button {
  grid-area: refresh;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  white-space: nowrap;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--bg-primary, #ffffff);
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s ease);
}

.team-button:focus-visible,
.refresh-button:focus-visible {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

.refresh-button:hover {
  background: var(--bg-secondary, #f9fafb);
  border-color: var(--border-hover, #d1d5db);
  color: var(--text-primary, #374151);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.refresh-button:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.refresh-icon {
  width: 14px;
  height: 14px;
  transition: transform var(--transition-fast, 0.15s ease);
}

.refresh-button:not(:disabled):hover .refresh-icon {
  transform: rotate(180deg);
}

.refresh-button:disabled .refresh-icon {
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

.heroes-container {
  flex: 1;
  background: var(--bg-secondary);
  border-radius: var(--border-radius-large);
  padding: var(--spacing-sm);
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.heroes-formation {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  align-items: center;
  width: 100%;
}

.formation-row {
  display: flex;
  gap: var(--spacing-md);
  justify-content: center;
  width: 100%;
}

.hero-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 64px;
  flex: 0 1 88px;
}

.hero-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.hero-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-placeholder {
  font-size: 12px;
  color: var(--text-secondary);
}

.hero-name {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-team {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

@media (max-width: 768px) {
  .heroes-container {
    padding: var(--spacing-sm);
  }

  .heroes-formation {
    gap: var(--spacing-sm);
  }

  .formation-row {
    gap: var(--spacing-sm);
  }

  .hero-item {
    min-width: 45px;
  }

  .hero-circle {
    width: 40px;
    height: 40px;
  }

  .hero-name {
    font-size: 10px;
    min-width: 0;
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
@media (prefers-reduced-motion: reduce) {
  .team-button,
  .refresh-button,
  .refresh-icon {
    transition: none;
  }

  .refresh-button:disabled .refresh-icon {
    animation: none;
  }
}
</style>
