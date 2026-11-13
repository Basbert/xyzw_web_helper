<script setup>
import { computed, reactive, ref, watch } from "vue";

const props = defineProps({
  showTaskTemplateModal: { type: Boolean, default: false },
  currentTemplateId: { type: [String, null], default: null },
  currentTemplateName: { type: String, default: "" },
  currentTemplate: { type: Object, required: true },
  formationOptions: { type: Array, default: () => [] },
  bossTimesOptions: { type: Array, default: () => [] },

  showApplyTemplateModal: { type: Boolean, default: false },
  selectedTemplateId: { type: [String, null], default: null },
  selectedTokensForApply: { type: Array, default: () => [] },
  taskTemplates: { type: Array, default: () => [] },
  tokenGroups: { type: Array, default: () => [] },
  sortedTokens: { type: Array, default: () => [] },
  isAllSelectedForApply: { type: Boolean, default: false },
  isIndeterminateForApply: { type: Boolean, default: false },
  getValidGroupTokenIds: { type: Function, required: true },

  showTemplateManagerModal: { type: Boolean, default: false },
  filteredTaskTemplates: { type: Array, default: () => [] },

  showAccountTemplateModal: { type: Boolean, default: false },
  filteredAccountTemplates: { type: Array, default: () => [] },
  selectedTemplateForFilter: { type: [String, null], default: null },
});

const emit = defineEmits([
  "update:showTaskTemplateModal",
  "saveTaskTemplate",
  "update:showApplyTemplateModal",
  "update:selectedTemplateId",
  "update:selectedTokensForApply",
  "selectAllForApply",
  "applyTemplate",
  "update:showTemplateManagerModal",
  "openNewTemplate",
  "openApplyTemplate",
  "openAccountTemplate",
  "openEditTemplate",
  "deleteTaskTemplate",
  "update:showAccountTemplateModal",
  "update:selectedTemplateForFilter",
  "filterAccountTemplates",
]);

const templateNameDraft = ref(props.currentTemplateName);
const templateDraft = reactive({ ...props.currentTemplate });

watch(
  () => props.showTaskTemplateModal,
  (isVisible) => {
    if (isVisible) {
      templateNameDraft.value = props.currentTemplateName;
      Object.assign(templateDraft, props.currentTemplate);
    }
  },
);

const templateSearch = ref("");
const displayedTemplates = computed(() => {
  const query = templateSearch.value.trim().toLowerCase();
  if (!query) return props.filteredTaskTemplates;
  return props.filteredTaskTemplates.filter((item) =>
    (item.name || "").toLowerCase().includes(query),
  );
});

const handleSelectGroupForApply = (groupId) => {
  const groupTokenIds = props.getValidGroupTokenIds(groupId);
  const merged = Array.from(
    new Set([...props.selectedTokensForApply, ...groupTokenIds]),
  );
  emit("update:selectedTokensForApply", merged);
};
</script>

<template>
  <!-- Task Template Modal -->
  <n-modal
    :show="showTaskTemplateModal"
    preset="card"
    :title="currentTemplateId ? '编辑任务模板' : '任务模板设置'"
    style="width: 90%; max-width: 400px"
    @update:show="(val) => emit('update:showTaskTemplateModal', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-label">模板名称</label>
          <n-input
            v-model:value="templateNameDraft"
            placeholder="请输入模板名称"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">竞技场阵容</label>
          <n-select
            v-model:value="templateDraft.arenaFormation"
            :options="formationOptions"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">爬塔阵容</label>
          <n-select
            v-model:value="templateDraft.towerFormation"
            :options="formationOptions"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">BOSS阵容</label>
          <n-select
            v-model:value="templateDraft.bossFormation"
            :options="formationOptions"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">BOSS次数</label>
          <n-select
            v-model:value="templateDraft.bossTimes"
            :options="bossTimesOptions"
            size="small"
          />
        </div>
        <div class="setting-switches">
          <div class="switch-row">
            <span class="switch-label">领罐子</span>
            <n-switch v-model:value="templateDraft.claimBottle" />
          </div>
          <div class="switch-row">
            <span class="switch-label">领挂机</span>
            <n-switch v-model:value="templateDraft.claimHangUp" />
          </div>
          <div class="switch-row">
            <span class="switch-label">竞技场</span>
            <n-switch v-model:value="templateDraft.arenaEnable" />
          </div>
          <div class="switch-row">
            <span class="switch-label">开宝箱</span>
            <n-switch v-model:value="templateDraft.openBox" />
          </div>
          <div class="switch-row">
            <span class="switch-label">领取邮件奖励</span>
            <n-switch v-model:value="templateDraft.claimEmail" />
          </div>
          <div class="switch-row">
            <span class="switch-label">黑市购买物品</span>
            <n-switch v-model:value="templateDraft.blackMarketPurchase" />
          </div>
          <div class="switch-row">
            <span class="switch-label">付费招募</span>
            <n-switch v-model:value="templateDraft.payRecruit" />
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:showTaskTemplateModal', false)"
        >
          取消
        </n-button>
        <n-button
          type="primary"
          @click="
            emit('saveTaskTemplate', {
              name: templateNameDraft,
              settings: { ...templateDraft },
            })
          "
        >
          保存模板
        </n-button>
      </div>
    </div>
  </n-modal>

  <!-- Apply Template Modal -->
  <n-modal
    :show="showApplyTemplateModal"
    preset="card"
    title="应用任务模板"
    style="width: 90%; max-width: 600px"
    @update:show="(val) => emit('update:showApplyTemplateModal', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-label">选择模板</label>
          <n-select
            :value="selectedTemplateId"
            :options="taskTemplates"
            label-field="name"
            value-field="id"
            placeholder="请选择要应用的模板"
            size="small"
            style="width: 100%"
            @update:value="(val) => emit('update:selectedTemplateId', val)"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">选择账号</label>

          <!-- 分组快速选择 -->
          <div class="quick-group-box">
            <div class="modal-hint-text" style="margin-bottom: 8px">
              快速选择分组：
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <n-button
                v-for="group in tokenGroups"
                :key="group.id"
                size="small"
                :style="{ borderColor: group.color, color: group.color }"
                ghost
                @click="handleSelectGroupForApply(group.id)"
              >
                {{ group.name }}
              </n-button>
              <div v-if="tokenGroups.length === 0" class="modal-hint-text">
                暂无分组
              </div>
            </div>
          </div>

          <n-checkbox
            :checked="isAllSelectedForApply"
            :indeterminate="isIndeterminateForApply"
            @update:checked="(val) => emit('selectAllForApply', val)"
          >
            全选
          </n-checkbox>
          <n-checkbox-group
            :value="selectedTokensForApply"
            style="margin-top: 8px"
            @update:value="(val) => emit('update:selectedTokensForApply', val)"
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
      </div>
      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:showApplyTemplateModal', false)"
        >
          取消
        </n-button>
        <n-button
          type="success"
          :disabled="!selectedTemplateId || selectedTokensForApply.length === 0"
          @click="emit('applyTemplate')"
        >
          应用模板
        </n-button>
      </div>
    </div>
  </n-modal>

  <!-- Template Manager Modal -->
  <n-modal
    :show="showTemplateManagerModal"
    preset="card"
    title="任务模板管理"
    style="width: 90%; max-width: 800px"
    @update:show="(val) => emit('update:showTemplateManagerModal', val)"
  >
    <div class="settings-content">
      <div class="modal-header-actions">
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <n-button type="primary" @click="emit('openNewTemplate')">
            新增模板
          </n-button>
          <n-button type="success" @click="emit('openApplyTemplate')">
            应用模板
          </n-button>
          <n-button type="info" @click="emit('openAccountTemplate')">
            查看账号模板引用
          </n-button>
        </div>
        <n-input
          v-model:value="templateSearch"
          placeholder="搜索模板"
          clearable
          size="small"
          style="width: 200px"
        />
      </div>

      <div
        class="template-list"
        style="max-height: 400px; overflow-y: auto; margin-bottom: 16px"
      >
        <n-card
          v-for="template in displayedTemplates"
          :key="template.id"
          size="small"
          style="margin-bottom: 12px"
        >
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
            "
          >
            <div>
              <h4 style="margin: 0 0 8px 0">{{ template.name }}</h4>
              <div class="modal-hint-text">
                创建时间: {{ new Date(template.createdAt).toLocaleString() }}
                <span v-if="template.updatedAt">
                  , 更新时间:
                  {{ new Date(template.updatedAt).toLocaleString() }}
                </span>
              </div>
            </div>
            <div style="display: flex; gap: 8px">
              <n-button
                size="small"
                @click="emit('openEditTemplate', template)"
              >
                编辑
              </n-button>
              <n-button
                size="small"
                type="error"
                @click="emit('deleteTaskTemplate', template.id)"
              >
                删除
              </n-button>
            </div>
          </div>
        </n-card>
        <div v-if="displayedTemplates.length === 0" class="modal-empty-text">
          暂无模板
        </div>
      </div>

      <div class="modal-actions">
        <n-button @click="emit('update:showTemplateManagerModal', false)">
          关闭
        </n-button>
      </div>
    </div>
  </n-modal>

  <!-- Account Template References Modal -->
  <n-modal
    :show="showAccountTemplateModal"
    preset="card"
    title="账号模板引用查看"
    style="width: 90%; max-width: 800px"
    @update:show="(val) => emit('update:showAccountTemplateModal', val)"
  >
    <div class="settings-content">
      <div class="modal-header-actions">
        <div>
          <span>共 {{ filteredAccountTemplates.length }} 个账号</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <label class="modal-hint-text">按模板筛选:</label>
          <n-select
            :value="selectedTemplateForFilter"
            :options="taskTemplates"
            label-field="name"
            value-field="id"
            placeholder="全部模板"
            clearable
            size="small"
            style="width: 180px"
            @update:value="
              (val) => {
                emit('update:selectedTemplateForFilter', val);
                emit('filterAccountTemplates');
              }
            "
          />
        </div>
      </div>

      <div
        class="account-template-list"
        style="max-height: 400px; overflow-y: auto; margin-bottom: 16px"
      >
        <n-card
          v-for="item in filteredAccountTemplates"
          :key="item.tokenId"
          size="small"
          style="margin-bottom: 12px"
        >
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
            "
          >
            <div>
              <h4 style="margin: 0 0 4px 0">{{ item.tokenName }}</h4>
            </div>
            <div>
              <n-tag
                :type="item.templateId ? 'success' : 'default'"
                size="small"
              >
                {{ item.templateName }}
              </n-tag>
            </div>
          </div>
        </n-card>
        <div
          v-if="filteredAccountTemplates.length === 0"
          class="modal-empty-text"
        >
          暂无账号数据
        </div>
      </div>

      <div class="modal-actions">
        <n-button @click="emit('update:showAccountTemplateModal', false)">
          关闭
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>

<style scoped>
.quick-group-box {
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 8px;
}

.modal-header-actions {
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
