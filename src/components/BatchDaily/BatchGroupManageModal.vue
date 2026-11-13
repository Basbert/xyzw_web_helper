<script setup>
defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  tokenGroups: {
    type: Array,
    default: () => [],
  },
  tokens: {
    type: Array,
    default: () => [],
  },
  sortedTokens: {
    type: Array,
    default: () => [],
  },
  groupColors: {
    type: Array,
    default: () => [],
  },
  newGroupName: {
    type: String,
    default: "",
  },
  newGroupColor: {
    type: String,
    default: "#1677ff",
  },
  newGroupSelectedTokens: {
    type: Array,
    default: () => [],
  },
  editingGroupId: {
    type: [String, Number, null],
    default: null,
  },
  editingGroupName: {
    type: String,
    default: "",
  },
  editingGroupColor: {
    type: String,
    default: "",
  },
  getValidGroupTokenIds: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits([
  "update:show",
  "update:newGroupName",
  "update:newGroupColor",
  "update:newGroupSelectedTokens",
  "update:editingGroupName",
  "update:editingGroupColor",
  "create",
  "selectAllNew",
  "deselectAllNew",
  "saveEdit",
  "cancelEdit",
  "startEdit",
  "delete",
  "addToken",
  "removeToken",
]);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="分组管理"
    style="width: 90%; max-width: 800px"
    @update:show="(val) => emit('update:show', val)"
  >
    <div class="settings-content">
      <!-- 创建新分组 -->
      <n-divider title-placement="left" style="margin: 0 0 16px 0">
        创建新分组
      </n-divider>
      <div style="margin-bottom: 24px">
        <div
          style="
            display: flex;
            gap: 12px;
            align-items: center;
            margin-bottom: 12px;
            flex-wrap: wrap;
          "
        >
          <n-input
            :value="newGroupName"
            placeholder="输入分组名称"
            style="width: 200px"
            size="small"
            @update:value="(val) => emit('update:newGroupName', val)"
          />
          <div style="display: flex; gap: 8px; align-items: center">
            <span style="font-size: 12px">选择颜色:</span>
            <div style="display: flex; gap: 6px">
              <div
                v-for="slotColor in groupColors"
                :key="slotColor"
                class="color-swatch"
                :class="{ active: newGroupColor === slotColor }"
                :style="{ backgroundColor: slotColor }"
                @click="emit('update:newGroupColor', slotColor)"
              />
            </div>
          </div>
          <n-button type="primary" size="small" @click="emit('create')">
            创建分组
          </n-button>
        </div>

        <!-- 选择包含的账号 -->
        <div class="group-picker-box">
          <div
            style="
              display: flex;
              justify-content: space-between;
              margin-bottom: 8px;
            "
          >
            <span style="font-size: 13px; font-weight: bold">
              包含账号 ({{ newGroupSelectedTokens.length }})
            </span>
            <n-space size="small">
              <n-button size="tiny" @click="emit('selectAllNew')"
                >全选</n-button
              >
              <n-button size="tiny" @click="emit('deselectAllNew')">
                全不选
              </n-button>
            </n-space>
          </div>
          <div style="max-height: 150px; overflow-y: auto">
            <n-checkbox-group
              :value="newGroupSelectedTokens"
              @update:value="
                (val) => emit('update:newGroupSelectedTokens', val)
              "
            >
              <n-grid :cols="3" :x-gap="12" :y-gap="8">
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
      </div>

      <!-- 分组列表 -->
      <n-divider title-placement="left" style="margin: 0 0 16px 0">
        分组列表
      </n-divider>
      <div class="group-list-container">
        <div
          v-for="group in tokenGroups"
          :key="group.id"
          class="group-list-card"
        >
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 12px;
            "
          >
            <div style="flex: 1">
              <!-- 编辑模式 -->
              <div
                v-if="editingGroupId === group.id"
                style="
                  display: flex;
                  gap: 8px;
                  flex-wrap: wrap;
                  align-items: center;
                "
              >
                <n-input
                  :value="editingGroupName"
                  placeholder="分组名称"
                  size="small"
                  style="width: 150px"
                  @update:value="(val) => emit('update:editingGroupName', val)"
                />
                <div style="display: flex; gap: 6px; align-items: center">
                  <div
                    v-for="slotColor in groupColors"
                    :key="slotColor"
                    class="color-swatch small"
                    :class="{ active: editingGroupColor === slotColor }"
                    :style="{ backgroundColor: slotColor }"
                    @click="emit('update:editingGroupColor', slotColor)"
                  />
                </div>
                <n-button
                  size="small"
                  type="primary"
                  style="width: 60px"
                  @click="emit('saveEdit')"
                >
                  保存
                </n-button>
                <n-button
                  size="small"
                  style="width: 60px"
                  @click="emit('cancelEdit')"
                >
                  取消
                </n-button>
              </div>
              <!-- 显示模式 -->
              <div v-else>
                <div
                  style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                  "
                >
                  <div
                    :style="{
                      width: '16px',
                      height: '16px',
                      backgroundColor: group.color,
                      borderRadius: '3px',
                    }"
                  />
                  <span style="font-weight: 500; font-size: 14px">
                    {{ group.name }}
                  </span>
                  <n-tag size="small" type="info">
                    {{ getValidGroupTokenIds(group.id).length }} 个账号
                  </n-tag>
                </div>
                <div
                  style="
                    display: flex;
                    gap: 4px;
                    flex-wrap: wrap;
                    margin-bottom: 8px;
                  "
                >
                  <div
                    v-for="tokenId in getValidGroupTokenIds(group.id)"
                    :key="tokenId"
                    class="group-token-chip"
                  >
                    {{ tokens.find((t) => t.id === tokenId)?.name }}
                    <n-button
                      size="tiny"
                      type="error"
                      text
                      @click="emit('removeToken', group.id, tokenId)"
                    >
                      ×
                    </n-button>
                  </div>
                </div>
                <div style="margin-bottom: 8px">
                  <n-select
                    placeholder="添加账号到分组"
                    size="small"
                    filterable
                    :value="null"
                    :options="
                      tokens
                        .filter(
                          (t) =>
                            !getValidGroupTokenIds(group.id).includes(t.id),
                        )
                        .map((t) => ({ label: t.name, value: t.id }))
                    "
                    @update:value="
                      (tokenId) => {
                        if (tokenId) {
                          emit('addToken', group.id, tokenId);
                        }
                      }
                    "
                  />
                </div>
              </div>
            </div>

            <div
              v-if="editingGroupId !== group.id"
              style="display: flex; gap: 8px"
            >
              <n-button size="small" @click="emit('startEdit', group.id)">
                编辑
              </n-button>
              <n-button
                size="small"
                type="error"
                @click="emit('delete', group.id)"
              >
                删除
              </n-button>
            </div>
          </div>
        </div>

        <div v-if="tokenGroups.length === 0" class="modal-empty-text">
          暂无分组，请创建一个新分组
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
.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid var(--border-light);
  cursor: pointer;
  transition: transform 0.2s ease;
}

.color-swatch.small {
  width: 20px;
  height: 20px;
}

.color-swatch.active {
  border: 3px solid var(--text-primary);
}

.color-swatch:hover {
  transform: scale(1.1);
}

.group-picker-box {
  background: var(--bg-tertiary);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-light);
}

.group-list-container {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 12px;
}

.group-list-card {
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  margin-bottom: 12px;
  background: var(--bg-secondary);
}

.group-token-chip {
  padding: 2px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  color: var(--text-primary);
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
