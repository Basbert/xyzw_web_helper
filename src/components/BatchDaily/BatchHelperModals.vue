<script setup>
import { reactive, watch } from "vue";

const props = defineProps({
  showSettingsModal: { type: Boolean, default: false },
  currentSettingsTokenName: { type: String, default: "" },
  currentSettings: { type: Object, required: true },
  formationOptions: { type: Array, default: () => [] },
  bossTimesOptions: { type: Array, default: () => [] },

  showLegacyGiftModal: { type: Boolean, default: false },
  recipientIdInput: { type: [Number, String, null], default: null },
  securityPassword: { type: String, default: "" },
  recipientIdError: { type: String, default: "" },
  recipientInfo: { type: Object, default: null },
  isQueryingRecipient: { type: Boolean, default: false },
  isAvatarLoading: { type: Boolean, default: false },
  avatarLoadError: { type: Boolean, default: false },
  giftQuantity: { type: Number, default: 10 },

  showHelperModal: { type: Boolean, default: false },
  helperType: { type: String, default: "box" },
  helperModalTitle: { type: String, default: "批量助手" },
  helperSettings: { type: Object, required: true },
  boxTypeOptions: { type: Array, default: () => [] },
  fishTypeOptions: { type: Array, default: () => [] },

  showRedeemCodeModal: { type: Boolean, default: false },
  cdkCodes: { type: String, default: "" },
  cdkPlatformType: { type: String, default: "h5" },

  uiBusy: { type: Boolean, default: false },
});

const emit = defineEmits([
  "update:showSettingsModal",
  "saveSettings",
  "update:showLegacyGiftModal",
  "update:recipientIdInput",
  "update:securityPassword",
  "update:giftQuantity",
  "clearRecipientError",
  "queryRecipient",
  "avatarLoad",
  "avatarError",
  "confirmLegacyGift",
  "update:showHelperModal",
  "executeHelper",
  "update:showRedeemCodeModal",
  "update:cdkCodes",
  "update:cdkPlatformType",
  "saveRedeemCode",
  "executeRedeemCodes",
]);

const settingsDraft = reactive({ ...props.currentSettings });
watch(
  () => props.showSettingsModal,
  (isVisible) => {
    if (isVisible) {
      Object.assign(settingsDraft, props.currentSettings);
    }
  },
);

const helperDraft = reactive({ ...props.helperSettings });
watch(
  () => props.showHelperModal,
  (isVisible) => {
    if (isVisible) {
      Object.assign(helperDraft, props.helperSettings);
    }
  },
);
</script>

<template>
  <!-- Settings Modal -->
  <n-modal
    :show="showSettingsModal"
    preset="card"
    :title="`任务设置 - ${currentSettingsTokenName}`"
    style="width: 90%; max-width: 400px"
    @update:show="(val) => emit('update:showSettingsModal', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-label">竞技场阵容</label>
          <n-select
            v-model:value="settingsDraft.arenaFormation"
            :options="formationOptions"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">爬塔阵容</label>
          <n-select
            v-model:value="settingsDraft.towerFormation"
            :options="formationOptions"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">BOSS阵容</label>
          <n-select
            v-model:value="settingsDraft.bossFormation"
            :options="formationOptions"
            size="small"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">BOSS次数</label>
          <n-select
            v-model:value="settingsDraft.bossTimes"
            :options="bossTimesOptions"
            size="small"
          />
        </div>
        <div class="setting-switches">
          <div class="switch-row">
            <span class="switch-label">领罐子</span>
            <n-switch v-model:value="settingsDraft.claimBottle" />
          </div>
          <div class="switch-row">
            <span class="switch-label">领挂机</span>
            <n-switch v-model:value="settingsDraft.claimHangUp" />
          </div>
          <div class="switch-row">
            <span class="switch-label">竞技场</span>
            <n-switch v-model:value="settingsDraft.arenaEnable" />
          </div>
          <div class="switch-row">
            <span class="switch-label">开宝箱</span>
            <n-switch v-model:value="settingsDraft.openBox" />
          </div>
          <div class="switch-row">
            <span class="switch-label">领取邮件奖励</span>
            <n-switch v-model:value="settingsDraft.claimEmail" />
          </div>
          <div class="switch-row">
            <span class="switch-label">黑市购买物品</span>
            <n-switch v-model:value="settingsDraft.blackMarketPurchase" />
          </div>
          <div class="switch-row">
            <span class="switch-label">付费招募</span>
            <n-switch v-model:value="settingsDraft.payRecruit" />
          </div>
          <div class="switch-row">
            <span class="switch-label">梦境金币商品及高级商人黄金鱼竿</span>
            <n-switch
              v-model:value="settingsDraft.dreamShopPurchase"
              aria-label="梦境商店自动购买"
            />
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <n-button
          type="primary"
          @click="emit('saveSettings', { ...settingsDraft })"
        >
          保存设置
        </n-button>
      </div>
    </div>
  </n-modal>

  <!-- Legacy Gift Modal -->
  <n-modal
    :show="showLegacyGiftModal"
    preset="card"
    title="批量功法残卷赠送"
    style="width: 90%; max-width: 600px"
    @update:show="(val) => emit('update:showLegacyGiftModal', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-label">接收者ID</label>
          <n-space>
            <n-input-number
              :value="recipientIdInput"
              placeholder="ID"
              :show-button="false"
              style="width: 180px"
              @update:value="
                (val) => {
                  emit('update:recipientIdInput', val);
                  emit('clearRecipientError');
                }
              "
            />
            <n-input
              :value="securityPassword"
              placeholder="请输入安全密码"
              type="password"
              style="width: 180px"
              @update:value="
                (val) => {
                  emit('update:securityPassword', val);
                  emit('clearRecipientError');
                }
              "
            />
            <n-button
              type="primary"
              :disabled="
                !recipientIdInput ||
                isQueryingRecipient ||
                !securityPassword ||
                uiBusy
              "
              @click="emit('queryRecipient')"
            >
              查询
            </n-button>
          </n-space>
          <n-text
            v-if="recipientIdError"
            type="error"
            style="margin-top: 5px; display: block"
          >
            {{ recipientIdError }}
          </n-text>
        </div>

        <div v-if="recipientInfo" class="setting-item">
          <label class="setting-label">接收者信息</label>
          <div class="recipient-info">
            <div class="avatar-container">
              <img
                v-if="recipientInfo.avatarUrl && !avatarLoadError"
                :src="recipientInfo.avatarUrl"
                alt="角色头像"
                class="avatar-img"
                @error="emit('avatarError')"
                @load="emit('avatarLoad')"
              />
              <div v-else class="avatar-fallback">
                {{ (recipientInfo.name || "未知角色")[0] || "?" }}
              </div>
              <div v-if="isAvatarLoading" class="avatar-loading">
                <div class="loading-spinner" />
              </div>
            </div>

            <div class="role-info" style="flex: 1; min-width: 0">
              <div class="recipient-name">
                {{ recipientInfo.name || "未知角色" }}
              </div>
              <div class="role-info-grid">
                <div class="info-item">
                  <div class="info-label">角色ID</div>
                  <div class="info-value">{{ recipientInfo.roleId }}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">服务器</div>
                  <div class="info-value">{{ recipientInfo.serverName }}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">战力</div>
                  <div class="info-value highlight">
                    {{ recipientInfo.power }} {{ recipientInfo.powerUnit }}
                  </div>
                </div>
                <div class="info-item">
                  <div class="info-label">军团</div>
                  <div class="info-value">
                    {{ recipientInfo.legionName || "无" }}
                  </div>
                </div>
                <div class="info-item" style="grid-column: 1 / -1">
                  <div class="info-label">军团ID</div>
                  <div class="info-value">
                    {{ recipientInfo.legionId || "无" }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">赠送数量</label>
          <n-input-number
            :value="giftQuantity"
            :min="1"
            :max="1000"
            :step="1"
            placeholder="请输入赠送数量"
            @update:value="(val) => emit('update:giftQuantity', val)"
          />
        </div>
      </div>

      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:showLegacyGiftModal', false)"
        >
          取消
        </n-button>
        <n-button
          type="primary"
          :disabled="!recipientIdInput || !recipientInfo || uiBusy"
          @click="emit('confirmLegacyGift')"
        >
          开始赠送
        </n-button>
      </div>
    </div>
  </n-modal>

  <!-- Helper Modal (开箱/钓鱼/招募/按积分开箱) -->
  <n-modal
    :show="showHelperModal"
    preset="card"
    :title="helperModalTitle"
    style="width: 90%; max-width: 400px"
    @update:show="(val) => emit('update:showHelperModal', val)"
  >
    <div class="settings-content">
      <div class="settings-grid">
        <div v-if="helperType === 'box'" class="setting-item">
          <label class="setting-label">宝箱类型</label>
          <n-select
            v-model:value="helperDraft.boxType"
            :options="boxTypeOptions"
            size="small"
          />
        </div>
        <div v-if="helperType === 'fish'" class="setting-item">
          <label class="setting-label">鱼竿类型</label>
          <n-select
            v-model:value="helperDraft.fishType"
            :options="fishTypeOptions"
            size="small"
          />
        </div>
        <div v-if="helperType === 'pointsBox'" class="setting-item">
          <label class="setting-label">目标积分</label>
          <n-input-number
            v-model:value="helperDraft.targetPoints"
            :min="1"
            :max="1000000"
            :step="100"
            size="small"
            style="width: 100%"
          />
        </div>
        <n-alert
          v-if="helperType === 'pointsBox'"
          type="info"
          style="margin-bottom: 12px"
        >
          开箱优先级: 木质宝箱(保留200个) → 青铜宝箱 → 黄金宝箱 → 铂金宝箱<br />
          积分: 木质=1分, 青铜=10分, 黄金=20分, 铂金=50分
        </n-alert>
        <div v-if="helperType !== 'pointsBox'" class="setting-item">
          <label class="setting-label">消耗数量（10的倍数）</label>
          <n-input-number
            v-model:value="helperDraft.count"
            :min="10"
            :max="10000"
            :step="10"
            size="small"
          />
        </div>
      </div>
      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:showHelperModal', false)"
        >
          取消
        </n-button>
        <n-button
          type="primary"
          :disabled="uiBusy"
          @click="emit('executeHelper', { ...helperDraft })"
        >
          开始执行
        </n-button>
      </div>
    </div>
  </n-modal>

  <!-- Redeem Code Modal -->
  <n-modal
    :show="showRedeemCodeModal"
    preset="card"
    title="一键使用兑换码"
    style="width: 90%; max-width: 560px"
    @update:show="(val) => emit('update:showRedeemCodeModal', val)"
  >
    <div class="settings-content">
      <n-alert type="info" show-icon style="margin-bottom: 12px">
        每行填写一个兑换码，也支持用空格、逗号或分号分隔。执行时会先读取角色已兑换记录，已使用的兑换码会自动跳过。
      </n-alert>
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-label">兑换码列表</label>
          <n-input
            :value="cdkCodes"
            type="textarea"
            placeholder="例如：&#10;vip666&#10;VIP666&#10;happy666"
            :autosize="{ minRows: 7, maxRows: 14 }"
            @update:value="(val) => emit('update:cdkCodes', val)"
          />
        </div>
        <div class="setting-item">
          <label class="setting-label">平台类型</label>
          <n-input
            :value="cdkPlatformType"
            placeholder="默认 h5"
            @update:value="(val) => emit('update:cdkPlatformType', val)"
          />
        </div>
      </div>
      <div class="modal-actions">
        <n-button
          style="margin-right: 12px"
          @click="emit('update:showRedeemCodeModal', false)"
        >
          取消
        </n-button>
        <n-button style="margin-right: 12px" @click="emit('saveRedeemCode')">
          保存配置
        </n-button>
        <n-button
          type="primary"
          :disabled="!cdkCodes?.trim() || uiBusy"
          @click="emit('executeRedeemCodes')"
        >
          开始兑换
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped src="./batchModal.css"></style>

<style scoped>
.recipient-info {
  background: var(--bg-tertiary);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  display: flex;
  align-items: flex-start;
  gap: 16px;
  transition: all 0.3s ease;
}

.recipient-info:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

.avatar-container {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.avatar-container:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.3);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: all 0.3s ease;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: white;
  font-size: 24px;
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.avatar-loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top: 3px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.recipient-name {
  margin-bottom: 12px;
  font-size: 18px;
  font-weight: bold;
  color: var(--text-primary);
}

.role-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.info-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.info-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.info-value.highlight {
  font-size: 16px;
  font-weight: 600;
  color: var(--primary-color);
}

@media (max-width: 600px) {
  .recipient-info {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .avatar-container {
    margin-bottom: 12px;
  }
}
</style>
