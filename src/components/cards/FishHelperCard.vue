<template>
  <MyCard class="helper" :status-class="{ active: state.isRunning }">
    <template #icon>
      <img :src="iconPath" alt="普通鱼竿图标" />
    </template>
    <template #title>
      <h3>钓鱼助手</h3>
    </template>
    <template #badge>
      <span>{{ state.isRunning ? "运行中" : "已停止" }}</span>
    </template>
    <template #default>
      <div class="container">
        <div class="list">
          <div class="item" v-for="item in dataList" :key="item.type">
            <img :src="item.img" :alt="item.type" />
            <div class="box-info">
              <div class="box-type">{{ item.type }}</div>
              <div class="box-count">数量：{{ item.count }}</div>
            </div>
          </div>
        </div>
        <div class="selects">
          <n-select
            v-model:value="type"
            :options="typeOptions"
            :disabled="state.isRunning"
          />
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
                  : "正在核对鱼竿数量"
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
        @click="state.isRunning ? stop() : handleHelper()"
      >
        {{
          state.isRunning
            ? state.stopRequested
              ? "正在停止"
              : "停止钓鱼"
            : "开始钓鱼"
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
import { readItemCount, runFishBatch } from "@/utils/manualBatchHelpers";
import MyCard from "../Common/MyCard.vue";

const tokenStore = useTokenStore();
const message = useMessage();
const { state, connected, run, stop } = useManualBatchRun(tokenStore, message);

const iconPath = computed(() => {
  return `${import.meta.env.BASE_URL}fish/hjyg.png`;
});

const roleInfo = computed(() => tokenStore.gameData?.roleInfo || null);

const dataList = computed(() => {
  const getImgPath = (path) =>
    import.meta.env.BASE_URL + path.replace(/^\//, "");
  return [
    {
      type: "普通鱼竿",
      img: getImgPath("/fish/ptyg.png"),
      count: getCount(1011),
    },
    {
      type: "黄金鱼竿",
      img: getImgPath("/fish/hjyg.png"),
      count: getCount(1012),
    },
  ];
});

function getCount(itemId) {
  try {
    return readItemCount(roleInfo.value, itemId);
  } catch {
    return "—";
  }
}

const type = ref(1);
const typeOptions = [
  { label: "普通鱼竿", value: 1 },
  { label: "黄金鱼竿", value: 2 },
];

const number = ref(10);
const numberOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "80", value: 80 },
  { label: "100", value: 100 },
  { label: "160", value: 160 },
];

const handleHelper = () =>
  run(runFishBatch, {
    type: type.value,
    requested: number.value,
    refreshActivity: true,
  });
</script>

<style scoped lang="scss">
.container {
  padding: 10px 0;
  display: flex;
  flex-direction: column;

  .list {
    display: flex;
    align-items: center;
    justify-content: space-around;

    .item {
      display: flex;
      flex-direction: column;
      align-items: center;

      > img {
        width: 40px;
        height: 40px;
      }

      .box-info {
        display: flex;
        flex-direction: column;
        align-items: center;

        .box-type {
          font-weight: bold;
          margin-top: 4px;
        }

        .box-count {
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
}
.run-result {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  margin: 12px 0 0;
}
</style>
