<script setup>
defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  dreamBuyList: {
    type: Array,
    default: () => [],
  },
  merchantConfig: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits([
  "update:show",
  "selectGold",
  "selectAll",
  "clearAll",
  "toggleItem",
  "save",
]);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="梦境商品购买配置"
    style="width: 90%; max-width: 600px"
    @update:show="(val) => emit('update:show', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <n-alert type="info" show-icon style="margin-bottom: 12px">
          请勾选需要购买的商品。只会购买列表中存在的商品。
        </n-alert>

        <div
          style="display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap"
        >
          <n-button size="small" type="warning" @click="emit('selectGold')">
            一键勾选金币商品
          </n-button>
          <n-button size="small" @click="emit('selectAll')">全选所有</n-button>
          <n-button size="small" @click="emit('clearAll')">清空选择</n-button>
        </div>

        <div
          v-for="(merchant, id) in merchantConfig"
          :key="id"
          style="margin-bottom: 16px"
        >
          <div style="font-weight: bold; margin-bottom: 8px">
            {{ merchant.name }}
          </div>
          <n-grid :cols="3" :x-gap="12" :y-gap="8">
            <n-grid-item
              v-for="(item, itemIndex) in merchant.items"
              :key="itemIndex"
            >
              <n-checkbox
                :value="`${id}-${itemIndex}`"
                :checked="dreamBuyList.includes(`${id}-${itemIndex}`)"
                @update:checked="
                  (checked) => emit('toggleItem', `${id}-${itemIndex}`, checked)
                "
              >
                {{ item }}
              </n-checkbox>
            </n-grid-item>
          </n-grid>
        </div>
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
