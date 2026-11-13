<script setup>
import { reactive, watch } from "vue";

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  settings: {
    type: Object,
    required: true,
  },
  boxTypeOptions: {
    type: Array,
    default: () => [],
  },
  fishTypeOptions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["update:show", "openDreamBuy", "save"]);

function pickEditableFields(source = {}) {
  return {
    boxCount: source.boxCount ?? 100,
    fishCount: source.fishCount ?? 100,
    recruitCount: source.recruitCount ?? 100,
    defaultBoxType: source.defaultBoxType ?? 2001,
    defaultFishType: source.defaultFishType ?? 1,
    targetBoxPoints: source.targetBoxPoints ?? 1000,
    receiverId: source.receiverId ?? "",
    password: source.password ?? "",
    commandDelay: source.commandDelay ?? 500,
    taskDelay: source.taskDelay ?? 500,
    actionDelay: source.actionDelay ?? 300,
    battleDelay: source.battleDelay ?? 500,
    refreshDelay: source.refreshDelay ?? 1000,
    longDelay: source.longDelay ?? 3000,
    maxActive: source.maxActive ?? 2,
    connectionTimeout: source.connectionTimeout ?? 10000,
    reconnectDelay: source.reconnectDelay ?? 1000,
    tokenListColumns: source.tokenListColumns ?? 2,
    maxLogEntries: source.maxLogEntries ?? 1000,
    enableRefresh: Boolean(source.enableRefresh),
    refreshInterval: source.refreshInterval ?? 360,
  };
}

const draft = reactive(pickEditableFields(props.settings));

watch(
  () => props.show,
  (isVisible) => {
    if (isVisible) {
      Object.assign(draft, pickEditableFields(props.settings));
    }
  },
);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="任务设置"
    style="width: 90%; max-width: 700px"
    @update:show="(val) => emit('update:show', val)"
  >
    <div class="settings-content">
      <div class="settings-two-col">
        <!-- 左列：批量操作设置 -->
        <div>
          <n-divider title-placement="left" style="margin: 1px 0 8px 0">
            批量操作设置
          </n-divider>
          <div class="settings-grid">
            <div class="setting-item-inline">
              <label class="setting-label">开箱数量(10倍)</label>
              <n-input-number
                v-model:value="draft.boxCount"
                :min="10"
                :max="10000"
                :step="10"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">钓鱼数量(10倍)</label>
              <n-input-number
                v-model:value="draft.fishCount"
                :min="10"
                :max="10000"
                :step="10"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">招募数量(10倍)</label>
              <n-input-number
                v-model:value="draft.recruitCount"
                :min="10"
                :max="10000"
                :step="10"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">默认宝箱类型</label>
              <n-select
                v-model:value="draft.defaultBoxType"
                :options="boxTypeOptions"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">默认鱼竿类型</label>
              <n-select
                v-model:value="draft.defaultFishType"
                :options="fishTypeOptions"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">按积分开箱目标</label>
              <n-input-number
                v-model:value="draft.targetBoxPoints"
                :min="1"
                :max="1000000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">梦境商品购买配置</label>
              <n-button size="small" @click="emit('openDreamBuy')">
                点击配置
              </n-button>
            </div>
          </div>
          <n-divider title-placement="left" style="margin: 12px 0 8px 0">
            功法赠送设置
          </n-divider>
          <div class="settings-grid">
            <div class="setting-item-inline">
              <label class="setting-label">接收者ID</label>
              <n-input-number
                v-model:value="draft.receiverId"
                placeholder="ID"
                size="small"
                style="width: 100px"
                :show-button="false"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">密码</label>
              <n-input
                v-model:value="draft.password"
                type="password"
                placeholder="密码"
                size="small"
                style="width: 100px"
              />
            </div>
          </div>
        </div>

        <!-- 右列：延迟与连接设置 -->
        <div>
          <n-divider title-placement="left" style="margin: 1px 0 8px 0">
            延迟设置(ms)
          </n-divider>
          <div class="settings-grid">
            <div class="setting-item-inline">
              <label class="setting-label">命令延迟</label>
              <n-input-number
                v-model:value="draft.commandDelay"
                :min="100"
                :max="2000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">任务间延迟</label>
              <n-input-number
                v-model:value="draft.taskDelay"
                :min="100"
                :max="2000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">操作延迟</label>
              <n-input-number
                v-model:value="draft.actionDelay"
                :min="100"
                :max="2000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">战斗延迟</label>
              <n-input-number
                v-model:value="draft.battleDelay"
                :min="100"
                :max="2000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">刷新延迟</label>
              <n-input-number
                v-model:value="draft.refreshDelay"
                :min="500"
                :max="3000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">长延迟</label>
              <n-input-number
                v-model:value="draft.longDelay"
                :min="1000"
                :max="10000"
                :step="500"
                size="small"
                style="width: 100px"
              />
            </div>
          </div>
          <n-divider title-placement="left" style="margin: 12px 0 8px 0">
            连接设置
          </n-divider>
          <div class="settings-grid">
            <div class="setting-item-inline">
              <label class="setting-label">最大并发数</label>
              <n-input-number
                v-model:value="draft.maxActive"
                :min="1"
                :max="20"
                :step="1"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">连接超时(ms)</label>
              <n-input-number
                v-model:value="draft.connectionTimeout"
                :min="1000"
                :max="30000"
                :step="1000"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">重连等待(ms)</label>
              <n-input-number
                v-model:value="draft.reconnectDelay"
                :min="100"
                :max="5000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
          </div>
          <n-divider title-placement="left" style="margin: 12px 0 8px 0">
            系统设置
          </n-divider>
          <div class="settings-grid">
            <div class="setting-item-inline">
              <label class="setting-label">列表每行数量</label>
              <n-input-number
                v-model:value="draft.tokenListColumns"
                :min="1"
                :max="10"
                :step="1"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">最大日志条目</label>
              <n-input-number
                v-model:value="draft.maxLogEntries"
                :min="100"
                :max="5000"
                :step="100"
                size="small"
                style="width: 100px"
              />
            </div>
            <div class="setting-item-inline">
              <label class="setting-label">定时刷新页面</label>
              <n-switch v-model:value="draft.enableRefresh" />
            </div>
            <div v-if="draft.enableRefresh" class="setting-item-inline">
              <label class="setting-label">刷新间隔(分钟)</label>
              <n-input-number
                v-model:value="draft.refreshInterval"
                :min="10"
                :max="1440"
                :step="30"
                size="small"
                style="width: 100px"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:show', false)"
        >
          取消
        </n-button>
        <n-button type="primary" @click="emit('save', { ...draft })">
          保存设置
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>

<style scoped>
.settings-two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

@media (max-width: 640px) {
  .settings-two-col {
    grid-template-columns: 1fr;
  }
}
</style>
