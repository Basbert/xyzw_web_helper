<script setup>
defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  warGuessCoin: {
    type: Number,
    default: 20,
  },
  selectedWarGuessLegionId: {
    type: [Number, String, null],
    default: null,
  },
  uiBusy: {
    type: Boolean,
    default: false,
  },
  warGuessLoading: {
    type: Boolean,
    default: false,
  },
  warGuessColumns: {
    type: Array,
    default: () => [],
  },
  warGuessList: {
    type: Array,
    default: () => [],
  },
  warGuessRowProps: {
    type: Function,
    default: () => ({}),
  },
});

const emit = defineEmits([
  "update:show",
  "update:warGuessCoin",
  "update:selectedWarGuessLegionId",
  "cheer",
  "refresh",
]);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="月赛助威"
    style="width: 90%; max-width: 800px"
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
          <span style="font-size: 16px">拍手器:</span>
          <n-input-number
            :value="warGuessCoin"
            placeholder="拍手器"
            :min="1"
            :max="20"
            style="width: 120px"
            @update:value="(val) => emit('update:warGuessCoin', val)"
          />
          <n-button
            type="primary"
            :disabled="!selectedWarGuessLegionId || uiBusy"
            @click="emit('cheer')"
          >
            助威
          </n-button>
          <n-button
            :loading="warGuessLoading"
            :disabled="uiBusy"
            @click="emit('refresh')"
          >
            刷新数据
          </n-button>
        </div>

        <n-data-table
          :columns="warGuessColumns"
          :data="warGuessList"
          :loading="warGuessLoading"
          :row-key="(row) => row.id"
          :checked-row-keys="
            selectedWarGuessLegionId ? [selectedWarGuessLegionId] : []
          "
          :row-props="warGuessRowProps"
          style="height: 400px; flex: 1"
          flex-height
          @update:checked-row-keys="
            (keys) => emit('update:selectedWarGuessLegionId', keys[0])
          "
        />
      </div>
      <div class="modal-actions">
        <n-button @click="emit('update:show', false)">关闭</n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>
