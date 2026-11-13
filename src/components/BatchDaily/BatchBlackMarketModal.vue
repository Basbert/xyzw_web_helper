<script setup>
defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  items: {
    type: Array,
    default: () => [],
  },
  blackMarketItemOptions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "update:show",
  "add",
  "reset",
  "selectCatalog",
  "updateItem",
  "remove",
  "save",
]);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="黑市采购清单配置"
    style="width: 90%; max-width: 760px"
    @update:show="(val) => emit('update:show', val)"
  >
    <div class="settings-content">
      <n-alert type="info" show-icon style="margin-bottom: 12px">
        这里保存的是要下发到游戏服务器的黑市采购清单。每条填写 `itemId`
        和折扣，折扣范围
        1-10；保存后需手动执行“一键配置黑市清单”才会真正写入服务器。
      </n-alert>

      <div style="display: flex; gap: 12px; margin-bottom: 12px">
        <n-button size="small" type="primary" @click="emit('add')">
          新增条目
        </n-button>
        <n-button size="small" @click="emit('reset')">恢复默认</n-button>
      </div>

      <n-alert type="warning" show-icon style="margin-bottom: 12px">
        优先从下拉框选择常用物品，系统会自动填入
        `itemId`、备注和推荐折扣；如果下拉里没有，再手动填写 `itemId`。
      </n-alert>

      <div
        v-for="(item, itemIndex) in items"
        :key="`${itemIndex}-${item.itemId ?? 'new'}`"
        class="black-market-row"
      >
        <n-select
          :value="item.itemId"
          :options="blackMarketItemOptions"
          placeholder="选择常用物品"
          clearable
          filterable
          @update:value="(value) => emit('selectCatalog', itemIndex, value)"
        />
        <n-input-number
          :value="item.itemId"
          placeholder="itemId"
          :min="1"
          :show-button="false"
          @update:value="
            (val) => emit('updateItem', itemIndex, { itemId: val })
          "
        />
        <n-input-number
          :value="item.discount"
          placeholder="折扣"
          :min="1"
          :max="10"
          @update:value="
            (val) => emit('updateItem', itemIndex, { discount: val })
          "
        />
        <n-input
          :value="item.note"
          placeholder="备注（可选）"
          @update:value="(val) => emit('updateItem', itemIndex, { note: val })"
        />
        <n-button type="error" secondary @click="emit('remove', itemIndex)">
          删除
        </n-button>
      </div>

      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:show', false)"
        >
          取消
        </n-button>
        <n-button type="primary" @click="emit('save')">保存配置</n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>

<style scoped>
.black-market-row {
  display: grid;
  grid-template-columns: 220px 120px 120px 1fr 96px;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

@media (max-width: 640px) {
  .black-market-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
