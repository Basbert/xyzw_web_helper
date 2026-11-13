<script setup>
defineProps({
  showTasksModal: { type: Boolean, default: false },
  scheduledTasks: { type: Array, default: () => [] },
  taskCountdowns: { type: Object, default: () => ({}) },
  executingTaskIds: { type: Array, default: () => [] },
  uiBusy: { type: Boolean, default: false },

  showTaskModal: { type: Boolean, default: false },
  editingTask: { type: Object, default: null },
  taskForm: { type: Object, required: true },
  cronValidation: { type: Object, required: true },
  cronNextRuns: { type: Array, default: () => [] },
  tokenGroups: { type: Array, default: () => [] },
  sortedTokens: { type: Array, default: () => [] },
  taskScheduleSelectedGroupIds: { type: Array, default: () => [] },
  taskGroupDefinitions: { type: Array, default: () => [] },
  groupedAvailableTasks: { type: Object, default: () => ({}) },
});

const emit = defineEmits([
  "update:showTasksModal",
  "toggleTaskEnabled",
  "editTask",
  "deleteTask",
  "manualExecuteTask",
  "update:showTaskModal",
  "updateTaskForm",
  "resetRunType",
  "parseCronExpression",
  "selectAllTokens",
  "deselectAllTokens",
  "selectAllTasks",
  "deselectAllTasks",
  "toggleScheduleGroup",
  "openGroupManage",
  "saveTask",
]);
</script>

<template>
  <!-- Tasks List Modal -->
  <n-modal
    :show="showTasksModal"
    preset="card"
    title="定时任务列表"
    style="width: 90%; max-width: 800px"
    @update:show="(val) => emit('update:showTasksModal', val)"
  >
    <div class="tasks-list" style="max-height: 600px; overflow-y: auto">
      <div
        v-for="task in scheduledTasks"
        :key="task.id"
        class="scheduled-task-card"
      >
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          "
        >
          <div style="font-weight: bold">{{ task.name }}</div>
          <n-switch
            :value="task.enabled"
            @update:value="(val) => emit('toggleTaskEnabled', task.id, val)"
          />
        </div>
        <div style="margin-bottom: 4px">
          <span class="task-meta-label">运行类型：</span>
          <span>
            {{ task.runType === "daily" ? "每天固定时间" : "Cron表达式" }}
          </span>
        </div>
        <div style="margin-bottom: 4px">
          <span class="task-meta-label">运行时间：</span>
          <span>
            {{ task.runType === "daily" ? task.runTime : task.cronExpression }}
          </span>
        </div>
        <div style="margin-bottom: 4px">
          <span class="task-meta-label">下次执行：</span>
          <span
            :style="{
              fontWeight: 'bold',
              color: taskCountdowns[task.id]?.isNearExecution
                ? '#ff4d4f'
                : '#1677ff',
            }"
          >
            {{
              task.enabled
                ? taskCountdowns[task.id]?.formatted || "计算中..."
                : "已禁用"
            }}
          </span>
        </div>
        <div style="margin-bottom: 4px">
          <span class="task-meta-label">选中账号：</span>
          <span>{{ task.selectedTokens.length }} 个</span>
        </div>
        <div style="margin-bottom: 8px">
          <span class="task-meta-label">选中任务：</span>
          <span>{{ task.selectedTasks.length }} 个</span>
        </div>
        <div style="display: flex; gap: 8px">
          <n-button size="tiny" @click="emit('editTask', task)">编辑</n-button>
          <n-button
            size="tiny"
            type="error"
            @click="emit('deleteTask', task.id)"
          >
            删除
          </n-button>
          <n-button
            size="tiny"
            type="info"
            secondary
            :loading="executingTaskIds.includes(task.id)"
            :disabled="uiBusy"
            @click="emit('manualExecuteTask', task)"
          >
            立即执行
          </n-button>
        </div>
      </div>
      <div v-if="scheduledTasks.length === 0" class="modal-empty-text">
        暂无定时任务
      </div>
    </div>
  </n-modal>

  <!-- Task Modal -->
  <n-modal
    :show="showTaskModal"
    preset="card"
    :title="editingTask ? '编辑定时任务' : '新增定时任务'"
    style="width: 90%; max-width: 600px"
    @update:show="(val) => emit('update:showTaskModal', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-label">任务名称</label>
          <n-input
            :value="taskForm.name"
            placeholder="请输入任务名称"
            @update:value="(val) => emit('updateTaskForm', { name: val })"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">运行类型</label>
          <n-radio-group
            :value="taskForm.runType"
            @update:value="
              (val) => {
                emit('updateTaskForm', { runType: val });
                emit('resetRunType');
              }
            "
          >
            <n-radio value="daily">每天固定时间</n-radio>
            <n-radio value="cron">Cron表达式</n-radio>
          </n-radio-group>
        </div>
        <div v-if="taskForm.runType === 'daily'" class="setting-item">
          <label class="setting-label">运行时间</label>
          <n-time-picker
            :value="taskForm.runTime"
            format="HH:mm"
            @update:value="(val) => emit('updateTaskForm', { runTime: val })"
          />
        </div>
        <div v-if="taskForm.runType === 'cron'" class="setting-item">
          <label class="setting-label">Cron表达式</label>
          <n-input
            :value="taskForm.cronExpression"
            placeholder="请输入Cron表达式"
            @update:value="
              (val) => {
                emit('updateTaskForm', { cronExpression: val });
                emit('parseCronExpression');
              }
            "
          />

          <div v-if="taskForm.cronExpression" class="cron-parser">
            <div v-if="cronValidation.valid" class="cron-validation success">
              <n-text type="success">✓ {{ cronValidation.message }}</n-text>
            </div>
            <div v-else class="cron-validation error">
              <n-text type="error">✗ {{ cronValidation.message }}</n-text>
            </div>

            <div
              v-if="cronValidation.valid && cronNextRuns.length > 0"
              class="cron-next-runs"
            >
              <h4>未来5次执行时间：</h4>
              <ul>
                <li v-for="(run, runIndex) in cronNextRuns" :key="runIndex">
                  {{ run }}
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div class="setting-item">
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
            "
          >
            <label class="setting-label">选择账号</label>
            <n-space size="small">
              <n-button size="small" @click="emit('selectAllTokens')">
                全选
              </n-button>
              <n-button size="small" @click="emit('deselectAllTokens')">
                全不选
              </n-button>
            </n-space>
          </div>

          <div style="margin-bottom: 12px">
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
              "
            >
              <div class="modal-hint-text">快速选择分组：</div>
              <n-button
                type="primary"
                size="tiny"
                text
                @click="emit('openGroupManage')"
              >
                管理分组
              </n-button>
            </div>
            <div v-if="tokenGroups.length === 0" class="modal-hint-text">
              暂无分组
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <n-button
                v-for="group in tokenGroups"
                :key="group.id"
                size="small"
                :type="
                  taskScheduleSelectedGroupIds.includes(group.id)
                    ? 'primary'
                    : 'default'
                "
                :style="{ borderColor: group.color }"
                @click="emit('toggleScheduleGroup', group.id)"
              >
                {{ group.name }}
              </n-button>
            </div>
          </div>

          <n-checkbox-group
            :value="taskForm.selectedTokens"
            @update:value="
              (val) => emit('updateTaskForm', { selectedTokens: val })
            "
          >
            <n-grid :cols="2" :x-gap="12" :y-gap="8">
              <n-grid-item
                v-for="gameToken in sortedTokens"
                :key="gameToken.id"
              >
                <n-checkbox :value="gameToken.id">
                  {{ gameToken.name }}
                </n-checkbox>
              </n-grid-item>
            </n-grid>
          </n-checkbox-group>
        </div>

        <div class="setting-item">
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
            "
          >
            <label class="setting-label">选择任务</label>
            <n-space size="small">
              <n-button size="small" @click="emit('selectAllTasks')">
                全选（不含赠送）
              </n-button>
              <n-button size="small" @click="emit('deselectAllTasks')">
                全不选
              </n-button>
            </n-space>
          </div>

          <n-checkbox-group
            :value="taskForm.selectedTasks"
            @update:value="
              (val) => emit('updateTaskForm', { selectedTasks: val })
            "
          >
            <n-tabs
              type="line"
              animated
              size="small"
              pane-style="padding-top: 12px;"
              default-value="daily"
            >
              <n-tab-pane
                v-for="group in taskGroupDefinitions"
                :key="group.name"
                :name="group.name"
                :tab="group.label"
              >
                <n-grid :cols="2" :x-gap="12" :y-gap="8">
                  <n-grid-item
                    v-for="task in groupedAvailableTasks[group.name]"
                    :key="task.value"
                  >
                    <n-checkbox :value="task.value">
                      {{ task.label }}
                    </n-checkbox>
                  </n-grid-item>
                </n-grid>
              </n-tab-pane>

              <n-tab-pane
                v-if="
                  groupedAvailableTasks.other &&
                  groupedAvailableTasks.other.length > 0
                "
                name="other"
                tab="其他"
              >
                <n-grid :cols="2" :x-gap="12" :y-gap="8">
                  <n-grid-item
                    v-for="task in groupedAvailableTasks.other"
                    :key="task.value"
                  >
                    <n-checkbox :value="task.value">
                      {{ task.label }}
                    </n-checkbox>
                  </n-grid-item>
                </n-grid>
              </n-tab-pane>
            </n-tabs>
          </n-checkbox-group>
          <n-alert
            v-if="
              taskForm.selectedTasks.includes('batchLegacyGiftSendEnhanced')
            "
            type="warning"
            style="margin-top: 12px"
          >
            定时赠送会将每个账号当前持有的功法残卷赠送给设置中的接收者，每次最多
            9999 个。
          </n-alert>
        </div>

        <div
          v-if="taskForm.selectedTasks.includes('batchApplyLegion')"
          class="setting-item"
        >
          <label class="setting-label">目标俱乐部ID</label>
          <n-input-number
            :value="taskForm.legionApplyTargetId"
            placeholder="请输入目标俱乐部ID"
            :min="1"
            clearable
            @update:value="
              (val) => emit('updateTaskForm', { legionApplyTargetId: val })
            "
          />
          <div class="modal-hint-text">
            定时执行“批量申请俱乐部”时会对所有选中账号申请这个俱乐部。
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:showTaskModal', false)"
        >
          取消
        </n-button>
        <n-button type="primary" @click="emit('saveTask')">保存</n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>

<style scoped>
.scheduled-task-card {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.task-meta-label {
  color: var(--text-secondary);
}

.cron-parser {
  margin-top: 12px;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 8px;
}

.cron-validation {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 4px;
}

.cron-validation.success {
  background-color: rgba(24, 160, 88, 0.12);
}

.cron-validation.error {
  background-color: rgba(235, 87, 87, 0.12);
}

.cron-next-runs h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.cron-next-runs ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.cron-next-runs li {
  padding: 6px 0;
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.cron-next-runs li:last-child {
  border-bottom: none;
}
</style>
