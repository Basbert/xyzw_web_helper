<script setup>
defineProps({
  currentRunningTokenName: {
    type: String,
    default: "",
  },
  logsCount: {
    type: Number,
    default: 0,
  },
  maxLogEntries: {
    type: Number,
    default: 1000,
  },
  autoScrollLog: {
    type: Boolean,
    default: true,
  },
  filterErrorsOnly: {
    type: Boolean,
    default: false,
  },
  errorCount: {
    type: Number,
    default: 0,
  },
  currentProgress: {
    type: Number,
    default: 0,
  },
  filteredLogs: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "update:autoScrollLog",
  "update:filterErrorsOnly",
  "clear",
  "copy",
  "containerReady",
]);
</script>

<template>
  <div class="right-column">
    <n-card class="log-card">
      <template #header>
        <div class="custom-card-header">
          <div class="card-title">
            {{
              currentRunningTokenName
                ? `正在执行: ${currentRunningTokenName}`
                : "执行日志"
            }}
            <span class="log-count-label">
              {{ logsCount }}/{{ maxLogEntries || 1000 }}
            </span>
          </div>
          <div class="log-header-controls">
            <n-checkbox
              :checked="autoScrollLog"
              size="small"
              @update:checked="(val) => emit('update:autoScrollLog', val)"
            >
              自动滚动
            </n-checkbox>
            <n-checkbox
              :checked="filterErrorsOnly"
              size="small"
              @update:checked="(val) => emit('update:filterErrorsOnly', val)"
            >
              只看错误
            </n-checkbox>
            <n-tag v-if="errorCount > 0" type="error" size="small">
              {{ errorCount }} 个错误
            </n-tag>
            <n-button size="small" @click="emit('clear')">清空日志</n-button>
            <n-button size="small" @click="emit('copy')">复制日志</n-button>
          </div>
        </div>
      </template>
      <n-progress
        type="line"
        :percentage="currentProgress"
        indicator-placement="inside"
        processing
      />
      <div :ref="(el) => emit('containerReady', el)" class="log-container">
        <div
          v-for="(log, logIndex) in filteredLogs"
          :key="logIndex"
          class="log-item"
          :class="log.type"
        >
          <span class="time">{{ log.time }}</span>
          <span class="message">{{ log.message }}</span>
        </div>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.right-column {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 700px;
}

.log-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.log-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.custom-card-header {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-count-label {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.log-header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.log-container {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-tertiary);
  padding: 10px;
  border-radius: 4px;
  margin-top: 10px;
  font-family: monospace;
  min-height: 200px;
}

.log-item {
  margin-bottom: 4px;
  font-size: 12px;
}

.log-item.error {
  color: var(--error-color, #d03050);
}

.log-item.success {
  color: var(--success-color, #18a058);
}

.log-item.warning {
  color: var(--warning-color, #f0a020);
}

.log-item.info {
  color: var(--text-primary);
}

.time {
  color: var(--text-tertiary);
  margin-right: 8px;
}

@media (max-width: 1200px) {
  .right-column {
    width: 380px;
  }
}

@media (max-width: 992px) {
  .right-column {
    width: 100%;
    height: auto;
    flex-shrink: 0;
  }

  .log-container {
    height: 300px;
    min-height: 300px;
  }
}

@media (max-width: 768px) {
  .right-column {
    height: auto;
    width: 100%;
    flex: none;
  }

  .log-card {
    height: auto !important;
  }

  .log-card :deep(.n-card__content) {
    flex: none !important;
    overflow: visible !important;
    display: block !important;
  }

  .log-container {
    height: 300px;
    min-height: 300px;
    flex: none !important;
  }

  .log-header-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}
</style>
