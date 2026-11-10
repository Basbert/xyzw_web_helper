<template>
  <section
    v-if="days.dream || days.camp"
    class="activity-reminders"
    aria-label="今日活动提醒"
  >
    <div class="reminder-heading">今日提醒</div>
    <div v-if="days.dream" class="reminder-row">
      <div>
        <strong>梦境商店</strong>
        <p>
          {{
            dreamChecked
              ? "今日已通过每日任务自动检查商店。"
              : "今天梦境开放，记得检查商店里的商品。"
          }}
        </p>
      </div>
      <button type="button" @click="emit('navigate', 'dream')">查看梦境</button>
    </div>
    <div v-if="days.camp" class="reminder-row">
      <div>
        <strong>营地挑战</strong>
        <p>{{ campText }} · 开放时间 10:00–22:00</p>
      </div>
      <button type="button" @click="emit('navigate', 'camp')">查看营地</button>
    </div>
  </section>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useShanghaiClock } from "@/hooks/useShanghaiClock";
import { useTokenStore } from "@/stores/tokenStore";
import { describeCampProgress, getReminderDays } from "@/utils/dailyReminders";
import {
  isDreamShopChecked,
  subscribeDreamShopChecks,
} from "@/utils/dreamShopCheckState";

const emit = defineEmits(["navigate"]);
const tokenStore = useTokenStore();
const now = useShanghaiClock();
const days = computed(() => getReminderDays(now.value));
const dreamChecked = ref(false);
function refreshDreamChecked() {
  dreamChecked.value = isDreamShopChecked({
    roleId: tokenStore.selectedToken?.roleId,
    dayKey: days.value.dayKey,
  });
}
watch(
  () => [
    tokenStore.selectedToken?.id,
    tokenStore.selectedToken?.roleId,
    days.value.dayKey,
  ],
  refreshDreamChecked,
  { immediate: true },
);
const connected = computed(() => {
  const id = tokenStore.selectedToken?.id;
  return !!id && tokenStore.getWebSocketStatus(id) === "connected";
});
const campText = ref("挑战进度待确认");
let sequence = 0;
let timer;
let disposed = false;
let lastRefresh = 0;
let unsubscribeDream = () => {};
async function refreshCamp() {
  const id = tokenStore.selectedToken?.id;
  const dayKey = days.value.dayKey;
  const request = ++sequence;
  campText.value = "挑战进度待确认";
  if (!days.value.camp || !id || !connected.value || disposed) return;
  lastRefresh = Date.now();
  try {
    const result = await tokenStore.sendMessageWithPromise(
      id,
      "club_getinfo",
      {},
      8000,
    );
    if (
      disposed ||
      request !== sequence ||
      tokenStore.selectedToken?.id !== id ||
      !connected.value ||
      days.value.dayKey !== dayKey
    )
      return;
    campText.value = describeCampProgress(result, now.value);
  } catch {
    if (!disposed && request === sequence) campText.value = "挑战进度待确认";
  }
}
watch(
  () => [tokenStore.selectedToken?.id, connected.value, days.value.dayKey],
  refreshCamp,
  { immediate: true },
);
function refreshWhenVisible() {
  now.value = Date.now();
  if (
    document.visibilityState === "visible" &&
    Date.now() - lastRefresh >= 60000
  )
    refreshCamp();
}
onMounted(() => {
  unsubscribeDream = subscribeDreamShopChecks(refreshDreamChecked);
  refreshDreamChecked();
  document.addEventListener("visibilitychange", refreshWhenVisible);
  timer = window.setInterval(refreshWhenVisible, 60000);
});
onUnmounted(() => {
  unsubscribeDream();
  disposed = true;
  sequence++;
  document.removeEventListener("visibilitychange", refreshWhenVisible);
  window.clearInterval(timer);
});
</script>
<style scoped>
.activity-reminders {
  grid-column: 1 / -1;
  margin: 0 0 16px;
  padding: 16px 18px;
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.reminder-heading {
  margin-bottom: 5px;
  font-size: 15px;
  font-weight: 700;
}
.reminder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
}
.reminder-row + .reminder-row {
  border-top: 1px solid var(--border-light);
}
.reminder-row strong {
  font-size: 14px;
}
.reminder-row p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.reminder-row button {
  flex: none;
  padding: 7px 12px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
}
.reminder-row button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
@media (max-width: 420px) {
  .activity-reminders {
    padding: 12px;
  }
  .reminder-row {
    align-items: flex-start;
  }
}
</style>
