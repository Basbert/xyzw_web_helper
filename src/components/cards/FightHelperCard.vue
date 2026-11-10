<template>
  <MyCard class="bottle-helper" :status-class="{ active: state.isRunning }">
    <template #icon>
      <img src="/icons/1736425783912140.png" alt="竞技场" />
    </template>
    <template #title>
      <h3>竞技场助手</h3>
    </template>
    <template #badge>
      <span>{{ state.isRunning ? "运行中" : "已停止" }}</span>
    </template>
    <template #default>
      <div class="total-points">
        <span class="label">当前咸神门票数量：</span>
        <span class="value">{{ itemcount }}</span>
      </div>
      <div class="container">
        <div class="selects">
          <n-select
            v-model:value="number"
            :options="numberOptions"
            :disabled="state.isRunning"
          />
        </div>
        <p
          v-if="state.visible && (state.isRunning || state.result)"
          class="run-result"
          aria-live="polite"
        >
          {{
            state.isRunning
              ? state.available === null
                ? state.stopRequested
                  ? "正在停止"
                  : "正在核对门票数量"
                : `已获回包的请求共涉及 ${state.completed}/${state.total} 次${state.stopRequested ? "，正在停止" : ""}`
              : state.result
          }}
        </p>
      </div>
    </template>
    <template #action>
      <n-button
        type="primary"
        :disabled="state.isRunning ? state.stopRequested : !connected"
        secondary
        size="small"
        block
        @click="state.isRunning ? stop() : handleFightHelper()"
      >
        {{
          state.isRunning
            ? state.stopRequested
              ? "正在停止"
              : "停止战斗"
            : "开始战斗"
        }}
      </n-button>
    </template>
  </MyCard>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, ref } from "vue";
import { useManualBatchRun } from "@/composables/useManualBatchRun";
import { useTokenStore } from "@/stores/tokenStore";
import { readItemCount, runArenaBatch } from "@/utils/manualBatchHelpers";
import MyCard from "../Common/MyCard.vue";

const tokenStore = useTokenStore();
const message = useMessage();
const { state, connected, run, stop } = useManualBatchRun(tokenStore, message);

const roleInfo = computed(() => tokenStore.gameData?.roleInfo || null);
const itemcount = computed(() => {
  try {
    return readItemCount(roleInfo.value, 1007);
  } catch {
    return "—";
  }
});

const number = ref(10);
const numberOptions = [
  { label: "10", value: 10 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "500", value: 500 },
  { label: "1000", value: 1000 },
  { label: "2000", value: 2000 },
  { label: "5000", value: 5000 },
  { label: "10000", value: 10000 },
];
const handleFightHelper = () => run(runArenaBatch, { requested: number.value });
</script>

<style scoped lang="scss">
.container {
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  .list {
    display: flex;
    align-items: center;
    justify-content: center;
    .item {
      display: flex;
      flex-direction: column;
      align-items: center;
      > img {
        width: 40px;
        height: 40px;
      }
      .fight-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        .fight-type {
          font-weight: bold;
          margin-top: 4px;
        }
        .fight-count {
          margin-top: 2px;
          color: #666;
        }
      }
    }
  }
  .selects {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }
  .total-points {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 2px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-medium);

    .label {
      color: var(--text-secondary);
      font-size: var(--font-size-sm);
    }

    .value {
      color: var(--text-primary);
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-semibold);
    }
  }
}
.run-result {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  margin: 12px 0 0;
}
</style>
