<script setup>
defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  applyLegionTargetId: {
    type: [Number, null],
    default: null,
  },
  applyLegionLoading: {
    type: Boolean,
    default: false,
  },
  applyLegionPreview: {
    type: Object,
    default: null,
  },
  applyLegionError: {
    type: String,
    default: "",
  },
  uiBusy: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "update:show",
  "update:applyLegionTargetId",
  "query",
  "apply",
]);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="批量申请俱乐部"
    style="width: 90%; max-width: 720px"
    @update:show="(val) => emit('update:show', val)"
  >
    <div class="settings-content">
      <div class="settings-grid" style="display: block">
        <div
          style="
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          "
        >
          <span style="font-size: 16px">俱乐部ID:</span>
          <n-input-number
            :value="applyLegionTargetId"
            placeholder="请输入俱乐部ID"
            :min="1"
            clearable
            style="width: 180px"
            @update:value="(val) => emit('update:applyLegionTargetId', val)"
          />
          <n-button
            :loading="applyLegionLoading"
            :disabled="uiBusy"
            @click="emit('query')"
          >
            查询俱乐部
          </n-button>
          <n-button
            type="primary"
            :disabled="!applyLegionPreview?.id || uiBusy"
            @click="emit('apply')"
          >
            发起申请
          </n-button>
        </div>

        <div class="apply-legion-tip">
          仅会对当前未加入俱乐部的账号发申请，已加入任意俱乐部的账号会自动跳过。
        </div>

        <n-alert
          v-if="applyLegionError"
          type="error"
          :show-icon="true"
          style="margin-bottom: 16px"
        >
          {{ applyLegionError }}
        </n-alert>

        <div v-if="applyLegionPreview" class="legion-preview-card">
          <img
            :src="applyLegionPreview.logo || ''"
            alt="俱乐部头像"
            class="legion-preview-avatar"
          />
          <div style="flex: 1; min-width: 0">
            <div class="legion-preview-header">
              <div class="legion-preview-name">
                {{ applyLegionPreview.name }}
              </div>
              <n-tag type="info">ID: {{ applyLegionPreview.id }}</n-tag>
            </div>
            <div class="legion-preview-meta">
              <span>等级: {{ applyLegionPreview.level || 0 }}</span>
              <span>成员数: {{ applyLegionPreview.memberCount || 0 }}</span>
              <span v-if="applyLegionPreview.chairmanName">
                会长: {{ applyLegionPreview.chairmanName }}
              </span>
            </div>
            <div v-if="applyLegionPreview.notice" class="legion-preview-notice">
              公告: {{ applyLegionPreview.notice }}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <n-button @click="emit('update:show', false)">关闭</n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>

<style scoped>
.apply-legion-tip {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.legion-preview-card {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.legion-preview-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
}

.legion-preview-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.legion-preview-name {
  font-size: 18px;
  font-weight: 600;
}

.legion-preview-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--text-secondary);
}

.legion-preview-notice {
  margin-top: 10px;
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
