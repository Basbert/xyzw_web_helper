<template>
  <div class="batch-daily-tasks">
    <div class="main-layout">
      <!-- Left Column -->
      <div class="left-column">
        <!-- Header -->
        <div class="page-header">
          <div class="page-header-primary">
            <h2>批量日常任务</h2>
            <p>
              已选
              {{ selectedTokens.length }} 个账号，执行时使用各账号的每日设置
            </p>
            <p>
              梦境开放日按各角色开关购买商店商品；该开关默认开启，购买会消耗游戏资源。
            </p>
          </div>
          <div class="batch-actions">
            <n-button
              type="primary"
              @click="startBatch"
              :disabled="uiBusy || selectedTokens.length === 0"
              size="medium"
            >
              {{ uiBusy ? "执行中..." : "开始执行" }}
            </n-button>
            <n-button
              @click="stopBatch"
              :disabled="!uiBusy"
              type="error"
              size="medium"
            >
              停止
            </n-button>
            <n-button
              @click="openTemplateManagerModal"
              type="info"
              size="medium"
            >
              任务模板
            </n-button>
            <n-button @click="openBatchSettings" type="default" size="medium">
              <template #icon>
                <n-icon>
                  <Settings />
                </n-icon>
              </template>
              设置
            </n-button>
            <n-button size="medium" @click="showBatchLogs = !showBatchLogs">
              {{ showBatchLogs ? "收起日志" : "查看日志" }}
            </n-button>
          </div>
          <div class="schedule-summary">
            <div class="schedule-copy">
              <strong>定时任务 · {{ scheduledTasks.length }} 个</strong>
              <span
                >仅在此页面保持打开且连接正常时执行；关闭页面或设备休眠可能错过时间。</span
              >
              <span v-if="scheduledTasksStale" role="alert"
                >其他页面已修改定时任务，本页调度已暂停；请先记录未保存内容，再刷新页面。</span
              >
              <span v-if="shortestCountdownTask">
                即将执行：{{ shortestCountdownTask.task.name }}（{{
                  shortestCountdownTask.countdown.formatted
                }}）
              </span>
              <span v-else>暂无即将执行的任务</span>
            </div>
            <div class="schedule-actions">
              <n-button size="small" @click="openTaskModal"
                >新增定时任务</n-button
              >
              <n-button size="small" @click="showTasksModal = true">
                查看定时任务
              </n-button>
            </div>
          </div>
          <details class="batch-more">
            <summary>更多配置</summary>
            <div class="batch-more-actions">
              <n-dropdown
                trigger="click"
                :options="exportOptions"
                @select="exportConfig"
              >
                <n-button size="small">导出配置</n-button>
              </n-dropdown>
              <n-upload
                :show-file-list="false"
                accept=".json"
                :custom-request="importConfig"
              >
                <n-button size="small">导入配置</n-button>
              </n-upload>
              <n-button size="small" @click="openBlackMarketPurchaseModal">
                黑市采购清单
              </n-button>
            </div>
          </details>
        </div>

        <!-- Token Selection -->
        <n-card title="账号列表" class="token-list-card">
          <div style="margin-bottom: 16px">
            <!-- 分组管理和选择 -->
            <n-space vertical style="width: 100%">
              <!-- 分组选择部分 -->
              <div
                v-if="tokenGroups.length > 0"
                class="group-selection-section"
              >
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                  "
                >
                  <label style="font-weight: 500; color: var(--text-primary)"
                    >分组选择</label
                  >
                  <n-button
                    size="small"
                    type="error"
                    text
                    @click="clearAllGroupSelection"
                  >
                    一键清除所有分组选择
                  </n-button>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap">
                  <div
                    v-for="group in tokenGroups"
                    :key="group.id"
                    @click="toggleGroupSelection(group.id)"
                    :style="{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      backgroundColor: isGroupSelected(group.id)
                        ? group.color
                        : 'transparent',
                      border: `2px solid ${group.color}`,
                      color: isGroupSelected(group.id) ? 'white' : group.color,
                      fontWeight: isGroupSelected(group.id) ? '600' : '400',
                      transition: 'all 0.3s ease',
                      userSelect: 'none',
                    }"
                  >
                    {{ group.name }} ({{
                      getValidGroupTokenIds(group.id).length
                    }})
                  </div>
                </div>
              </div>

              <!-- 分组管理按钮 -->
              <div
                style="
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <n-button
                  type="info"
                  size="small"
                  @click="showGroupManageModal = true"
                >
                  管理分组
                </n-button>
                <span
                  v-if="selectedGroups.length > 0"
                  style="font-size: 12px; color: #86909c"
                >
                  已选择 {{ selectedGroups.length }} 个分组，包含
                  {{ selectedTokens.length }} 个账号
                </span>
              </div>
            </n-space>
          </div>

          <!-- 排序按钮组 -->
          <div class="sort-buttons" style="margin-bottom: 12px">
            <n-space align="center">
              <n-button-group size="small">
                <n-button
                  @click="toggleSort('name')"
                  :type="sortConfig.field === 'name' ? 'primary' : 'default'"
                >
                  名称 {{ getSortIcon("name") }}
                </n-button>
                <n-button
                  @click="toggleSort('server')"
                  :type="sortConfig.field === 'server' ? 'primary' : 'default'"
                >
                  服务器 {{ getSortIcon("server") }}
                </n-button>
                <n-button
                  @click="toggleSort('createdAt')"
                  :type="
                    sortConfig.field === 'createdAt' ? 'primary' : 'default'
                  "
                >
                  创建时间 {{ getSortIcon("createdAt") }}
                </n-button>
                <n-button
                  @click="toggleSort('lastUsed')"
                  :type="
                    sortConfig.field === 'lastUsed' ? 'primary' : 'default'
                  "
                >
                  最后使用 {{ getSortIcon("lastUsed") }}
                </n-button>
              </n-button-group>
            </n-space>
          </div>

          <n-space vertical>
            <n-checkbox
              :checked="isAllSelected"
              :indeterminate="isIndeterminate"
              @update:checked="handleSelectAll"
            >
              全选
            </n-checkbox>
            <n-checkbox-group v-model:value="selectedTokens">
              <n-grid
                :x-gap="12"
                :y-gap="8"
                :cols="batchSettings.tokenListColumns"
              >
                <n-grid-item
                  v-for="gameToken in sortedTokens"
                  :key="gameToken.id"
                >
                  <div class="token-row">
                    <n-checkbox
                      :value="gameToken.id"
                      :label="gameToken.name"
                      style="flex: 1"
                    >
                      <div class="token-item">
                        <span>{{ gameToken.name }}</span>
                        <n-tag
                          size="small"
                          :type="getStatusType(gameToken.id)"
                          style="margin-left: 8px"
                        >
                          {{ getStatusText(gameToken.id) }}
                        </n-tag>
                        <!-- 显示token所属的分组 -->
                        <div
                          v-if="
                            tokenStore.getTokenGroups(gameToken.id).length > 0
                          "
                          style="
                            margin-left: 8px;
                            display: inline-flex;
                            gap: 4px;
                            flex-wrap: wrap;
                          "
                        >
                          <n-tag
                            v-for="group in tokenStore.getTokenGroups(
                              gameToken.id,
                            )"
                            :key="group.id"
                            size="small"
                            :color="{ color: group.color, textColor: 'white' }"
                            style="font-size: 11px"
                          >
                            {{ group.name }}
                          </n-tag>
                        </div>
                      </div>
                    </n-checkbox>
                    <n-button
                      size="tiny"
                      circle
                      @click.stop="openSettings(gameToken)"
                    >
                      <template #icon>
                        <n-icon>
                          <Settings />
                        </n-icon>
                      </template>
                    </n-button>
                  </div>
                </n-grid-item>
              </n-grid>
            </n-checkbox-group>
          </n-space>
        </n-card>

        <!-- Batch Functions -->
        <n-card title="批量功能列表" style="margin-top: 16px">
          <n-tabs type="line" animated>
            <n-tab-pane name="daily" tab="日常">
              <n-space>
                <n-button
                  size="small"
                  @click="claimHangUpRewards"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  领取挂机
                </n-button>
                <n-button
                  size="small"
                  @click="batchAddHangUpTime"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键加钟
                </n-button>
                <n-button
                  size="small"
                  @click="resetBottles"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  重置罐子
                </n-button>
                <n-button
                  size="small"
                  @click="batchlingguanzi"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键领取罐子
                </n-button>
                <n-button
                  size="small"
                  @click="batchclubsign"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键俱乐部签到
                </n-button>
                <n-button
                  size="small"
                  @click="openApplyLegionModal"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  批量申请俱乐部
                </n-button>
                <n-button
                  size="small"
                  @click="batchStudy"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键答题
                </n-button>
                <n-button
                  size="small"
                  @click="batcharenafight"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isarenaActivityOpen
                  "
                >
                  一键竞技场战斗3次
                </n-button>
                <n-button
                  size="small"
                  @click="store_syncpurchaseconfig"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键配置黑市清单
                </n-button>
                <n-button
                  size="small"
                  @click="store_purchase"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键黑市采购
                </n-button>
                <n-button
                  size="small"
                  @click="collection_claimfreereward"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键领取珍宝阁
                </n-button>
                <n-button
                  size="small"
                  @click="batchGenieSweep"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键灯神扫荡
                </n-button>
                <n-popselect
                  :value="campChallengeMode"
                  :options="campChallengeModeOptions"
                  trigger="click"
                  @update:value="onCampChallengeModeChange"
                >
                  <n-button
                    size="small"
                    :disabled="uiBusy || selectedTokens.length === 0"
                  >
                    营地挑战({{ campChallengeModeLabel }})
                  </n-button>
                </n-popselect>
                <n-button
                  size="small"
                  @click="batchXuanwuBlessing"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键玄武赐福
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="dungeon" tab="副本">
              <n-space>
                <n-button
                  size="small"
                  @click="climbTower"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键爬塔
                </n-button>
                <n-button
                  size="small"
                  @click="batchmengjing"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !ismengjingActivityOpen
                  "
                >
                  一键梦境
                </n-button>
                <n-button
                  size="small"
                  @click="skinChallenge"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键换皮闯关
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimPeachTasks"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键领取蟠桃园任务
                </n-button>
                <n-button
                  size="small"
                  @click="batchBuyDreamItems"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !ismengjingActivityOpen
                  "
                >
                  一键购买梦境商品
                </n-button>
                <n-popselect
                  :value="footballPick"
                  :options="footballPickOptions"
                  trigger="click"
                  @update:value="onFootballPickChange"
                >
                  <n-button
                    size="small"
                    :disabled="uiBusy || selectedTokens.length === 0"
                  >
                    一键竞猜({{ footballPickLabel }})
                  </n-button>
                </n-popselect>
                <n-button
                  size="small"
                  :disabled="uiBusy || selectedTokens.length === 0"
                  @click="batchApexGuess()"
                >
                  逐鹿盐山竞猜
                </n-button>
                <n-button
                  size="small"
                  :disabled="uiBusy || selectedTokens.length === 0"
                  @click="batchApexClaim()"
                >
                  领取逐鹿竞猜奖励
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="baoku" tab="宝库">
              <n-space>
                <n-button
                  size="small"
                  @click="batchbaoku13"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isbaokuActivityOpen
                  "
                >
                  一键宝库前3层
                </n-button>
                <n-button
                  size="small"
                  @click="batchbaoku45"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isbaokuActivityOpen
                  "
                >
                  一键宝库4,5层
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="weirdTower" tab="怪异塔">
              <n-space>
                <n-input-number
                  v-model:value="weirdTowerMaxClimb"
                  class="weird-tower-count-input"
                  size="small"
                  :min="1"
                  :precision="0"
                  :show-button="false"
                  placeholder="次数"
                  :disabled="uiBusy"
                />
                <span class="weird-tower-count-unit">次</span>
                <n-button
                  size="small"
                  @click="climbWeirdTower"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键爬怪异塔
                </n-button>
                <n-button
                  size="small"
                  @click="batchUseItems"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键使用怪异塔道具
                </n-button>
                <n-button
                  size="small"
                  @click="batchMergeItems"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键怪异塔合成
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimFreeEnergy"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键领取怪异塔免费道具
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="resource" tab="资源">
              <n-space>
                <n-button
                  size="small"
                  @click="openHelperModal('box')"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  批量开箱
                </n-button>
                <n-button
                  size="small"
                  @click="openHelperModal('pointsBox')"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  按积分开箱
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimBoxPointReward"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  领取宝箱积分
                </n-button>
                <n-button
                  size="small"
                  @click="openHelperModal('fish')"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  批量钓鱼
                </n-button>
                <n-button
                  size="small"
                  @click="openHelperModal('recruit')"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  批量招募
                </n-button>
                <n-button
                  size="small"
                  @click="openRedeemCodeModal"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键使用兑换码
                </n-button>
                <n-button
                  size="small"
                  @click="batchHeroUpgrade"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键英雄升星
                </n-button>
                <n-button
                  size="small"
                  @click="batchBookUpgrade"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键图鉴升星
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimStarRewards"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键领取图鉴奖励
                </n-button>
                <n-button
                  size="small"
                  @click="legion_storebuygoods"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键购买四圣碎片
                </n-button>
                <n-button
                  size="small"
                  @click="legionStoreBuySkinCoins"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键购买俱乐部5皮肤币
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="legacy" tab="功法">
              <n-space>
                <n-button
                  size="small"
                  @click="batchLegacyClaim"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  批量功法残卷领取
                </n-button>
                <n-button
                  size="small"
                  @click="showLegacyGiftModal = true"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  批量功法残卷赠送
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="monthly" tab="月度">
              <n-space>
                <n-button
                  size="small"
                  @click="batchTopUpFish"
                  :disabled="uiBusy || selectedTokens.length === 0"
                >
                  一键钓鱼补齐
                </n-button>
                <n-button
                  size="small"
                  @click="batchTopUpArena"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isarenaActivityOpen
                  "
                >
                  一键竞技场补齐
                </n-button>
                <n-button
                  size="small"
                  @click="openWarGuessModal"
                  :disabled="
                    uiBusy ||
                    selectedTokens.length === 0 ||
                    !isWarGuessActivityOpen
                  "
                  :title="isWarGuessActivityOpen ? '' : warGuessActivityTip"
                >
                  月赛助威
                </n-button>
              </n-space>
            </n-tab-pane>
          </n-tabs>
        </n-card>
      </div>

      <!-- Right Column - Execution Log -->
      <BatchLogPanel
        v-if="showBatchLogs"
        :current-running-token-name="currentRunningTokenName"
        :logs-count="logs.length"
        :max-log-entries="batchSettings.maxLogEntries || 1000"
        :auto-scroll-log="autoScrollLog"
        :filter-errors-only="filterErrorsOnly"
        :error-count="errorCount"
        :current-progress="currentProgress"
        :filtered-logs="filteredLogs"
        @update:auto-scroll-log="(val) => (autoScrollLog = val)"
        @update:filter-errors-only="(val) => (filterErrorsOnly = val)"
        @clear="clearLogs"
        @copy="copyLogs"
        @container-ready="(el) => (logContainer = el)"
      />
    </div>

    <BatchHelperModals
      :show-settings-modal="showSettingsModal"
      :current-settings-token-name="currentSettingsTokenName"
      :current-settings="currentSettings"
      :formation-options="formationOptions"
      :boss-times-options="bossTimesOptions"
      :show-legacy-gift-modal="showLegacyGiftModal"
      :recipient-id-input="recipientIdInput"
      :security-password="securityPassword"
      :recipient-id-error="recipientIdError"
      :recipient-info="recipientInfo"
      :is-querying-recipient="isQueryingRecipient"
      :is-avatar-loading="isAvatarLoading"
      :avatar-load-error="avatarLoadError"
      :gift-quantity="giftQuantity"
      :show-helper-modal="showHelperModal"
      :helper-type="helperType"
      :helper-modal-title="helperModalTitle"
      :helper-settings="helperSettings"
      :box-type-options="boxTypeOptions"
      :fish-type-options="fishTypeOptions"
      :show-redeem-code-modal="showRedeemCodeModal"
      :cdk-codes="batchSettings.cdkCodes"
      :cdk-platform-type="batchSettings.cdkPlatformType"
      :ui-busy="uiBusy"
      @update:show-settings-modal="(val) => (showSettingsModal = val)"
      @save-settings="saveSettingsFromModal"
      @update:show-legacy-gift-modal="(val) => (showLegacyGiftModal = val)"
      @update:recipient-id-input="(val) => (recipientIdInput = val)"
      @update:security-password="(val) => (securityPassword = val)"
      @update:gift-quantity="(val) => (giftQuantity = val)"
      @clear-recipient-error="clearRecipientError"
      @query-recipient="queryRecipientInfo"
      @avatar-load="handleAvatarLoad"
      @avatar-error="handleAvatarError"
      @confirm-legacy-gift="confirmLegacyGift"
      @update:show-helper-modal="(val) => (showHelperModal = val)"
      @execute-helper="executeHelperFromModal"
      @update:show-redeem-code-modal="(val) => (showRedeemCodeModal = val)"
      @update:cdk-codes="(val) => (batchSettings.cdkCodes = val)"
      @update:cdk-platform-type="(val) => (batchSettings.cdkPlatformType = val)"
      @save-redeem-code="saveRedeemCodeConfig"
      @execute-redeem-codes="executeRedeemCodes"
    />

    <BatchTemplateModals
      :show-task-template-modal="showTaskTemplateModal"
      :current-template-id="currentTemplateId"
      :current-template-name="currentTemplateName"
      :current-template="currentTemplate"
      :formation-options="formationOptions"
      :boss-times-options="bossTimesOptions"
      :show-apply-template-modal="showApplyTemplateModal"
      :selected-template-id="selectedTemplateId"
      :selected-tokens-for-apply="selectedTokensForApply"
      :task-templates="taskTemplates"
      :token-groups="tokenGroups"
      :sorted-tokens="sortedTokens"
      :is-all-selected-for-apply="isAllSelectedForApply"
      :is-indeterminate-for-apply="isIndeterminateForApply"
      :get-valid-group-token-ids="getValidGroupTokenIds"
      :show-template-manager-modal="showTemplateManagerModal"
      :filtered-task-templates="filteredTaskTemplates"
      :show-account-template-modal="showAccountTemplateModal"
      :filtered-account-templates="filteredAccountTemplates"
      :selected-template-for-filter="selectedTemplateForFilter"
      @update:show-task-template-modal="(val) => (showTaskTemplateModal = val)"
      @save-task-template="saveTaskTemplateFromModal"
      @update:show-apply-template-modal="
        (val) => (showApplyTemplateModal = val)
      "
      @update:selected-template-id="(val) => (selectedTemplateId = val)"
      @update:selected-tokens-for-apply="
        (val) => (selectedTokensForApply = val)
      "
      @select-all-for-apply="handleSelectAllForApply"
      @apply-template="applyTemplate"
      @update:show-template-manager-modal="
        (val) => (showTemplateManagerModal = val)
      "
      @open-new-template="openNewTemplateModal"
      @open-apply-template="openApplyTemplateModal"
      @open-account-template="openAccountTemplateModal"
      @open-edit-template="openEditTemplateModal"
      @delete-task-template="deleteTaskTemplate"
      @update:show-account-template-modal="
        (val) => (showAccountTemplateModal = val)
      "
      @update:selected-template-for-filter="
        (val) => (selectedTemplateForFilter = val)
      "
      @filter-account-templates="filterAccountTemplates"
    />

    <BatchDreamBuyModal
      :show="showDreamBuyModal"
      :dream-buy-list="dreamBuyList"
      :merchant-config="merchantConfig"
      @update:show="(val) => (showDreamBuyModal = val)"
      @select-gold="selectGoldItems"
      @select-all="selectAllItems"
      @clear-all="clearAllItems"
      @toggle-item="toggleDreamItem"
      @save="saveDreamBuyConfig"
    />

    <BatchBlackMarketModal
      :show="showBlackMarketPurchaseModal"
      :items="blackMarketPurchaseList"
      :black-market-item-options="blackMarketItemOptions"
      @update:show="(val) => (showBlackMarketPurchaseModal = val)"
      @add="addBlackMarketPurchaseItem"
      @reset="resetBlackMarketPurchaseList"
      @select-catalog="applyBlackMarketCatalogItem"
      @update-item="updateBlackMarketPurchaseItem"
      @remove="removeBlackMarketPurchaseItem"
      @save="saveBlackMarketPurchaseConfig"
    />

    <BatchScheduleModals
      :show-tasks-modal="showTasksModal"
      :scheduled-tasks="scheduledTasks"
      :task-countdowns="taskCountdowns"
      :executing-task-ids="executingTaskIds"
      :ui-busy="uiBusy"
      :show-task-modal="showTaskModal"
      :editing-task="editingTask"
      :task-form="taskForm"
      :cron-validation="cronValidation"
      :cron-next-runs="cronNextRuns"
      :token-groups="tokenGroups"
      :sorted-tokens="sortedTokens"
      :task-schedule-selected-group-ids="taskScheduleSelectedGroupIds"
      :task-group-definitions="taskGroupDefinitions"
      :grouped-available-tasks="groupedAvailableTasks"
      @update:show-tasks-modal="(val) => (showTasksModal = val)"
      @toggle-task-enabled="toggleTaskEnabled"
      @edit-task="editTask"
      @delete-task="deleteTask"
      @manual-execute-task="manualExecuteTask"
      @update:show-task-modal="(val) => (showTaskModal = val)"
      @update-task-form="(patch) => Object.assign(taskForm, patch)"
      @reset-run-type="resetRunType"
      @parse-cron-expression="parseCronExpression"
      @select-all-tokens="selectAllTokens"
      @deselect-all-tokens="deselectAllTokens"
      @select-all-tasks="selectAllTasks"
      @deselect-all-tasks="deselectAllTasks"
      @toggle-schedule-group="toggleScheduleGroup"
      @open-group-manage="showGroupManageModal = true"
      @save-task="saveTask"
    />

    <BatchGlobalSettingsModal
      :show="showBatchSettingsModal"
      :settings="batchSettings"
      :box-type-options="boxTypeOptions"
      :fish-type-options="fishTypeOptions"
      @update:show="(val) => (showBatchSettingsModal = val)"
      @open-dream-buy="openDreamBuyModal"
      @save="saveBatchSettingsFromModal"
    />

    <BatchWarGuessModal
      :show="showWarGuessModal"
      :war-guess-coin="warGuessCoin"
      :selected-war-guess-legion-id="selectedWarGuessLegionId"
      :ui-busy="uiBusy"
      :war-guess-loading="warGuessLoading"
      :war-guess-columns="warGuessColumns"
      :war-guess-list="warGuessList"
      :war-guess-row-props="warGuessRowProps"
      @update:show="(val) => (showWarGuessModal = val)"
      @update:war-guess-coin="(val) => (warGuessCoin = val)"
      @update:selected-war-guess-legion-id="
        (val) => (selectedWarGuessLegionId = val)
      "
      @cheer="handleWarGuessCheer"
      @refresh="fetchWarGuessRank"
    />

    <BatchApplyLegionModal
      :show="showApplyLegionModal"
      :apply-legion-target-id="applyLegionTargetId"
      :apply-legion-loading="applyLegionLoading"
      :apply-legion-preview="applyLegionPreview"
      :apply-legion-error="applyLegionError"
      :ui-busy="uiBusy"
      @update:show="(val) => (showApplyLegionModal = val)"
      @update:apply-legion-target-id="(val) => (applyLegionTargetId = val)"
      @query="fetchApplyLegionTargetInfo"
      @apply="handleBatchApplyLegion"
    />

    <BatchGroupManageModal
      :show="showGroupManageModal"
      :token-groups="tokenGroups"
      :tokens="tokens"
      :sorted-tokens="sortedTokens"
      :group-colors="groupColors"
      :new-group-name="newGroupName"
      :new-group-color="newGroupColor"
      :new-group-selected-tokens="newGroupSelectedTokens"
      :editing-group-id="editingGroupId"
      :editing-group-name="editingGroupName"
      :editing-group-color="editingGroupColor"
      :get-valid-group-token-ids="getValidGroupTokenIds"
      @update:show="(val) => (showGroupManageModal = val)"
      @update:new-group-name="(val) => (newGroupName = val)"
      @update:new-group-color="(val) => (newGroupColor = val)"
      @update:new-group-selected-tokens="
        (val) => (newGroupSelectedTokens = val)
      "
      @update:editing-group-name="(val) => (editingGroupName = val)"
      @update:editing-group-color="(val) => (editingGroupColor = val)"
      @create="createNewGroup"
      @select-all-new="selectAllNewGroup"
      @deselect-all-new="deselectAllNewGroup"
      @save-edit="saveEditGroup"
      @cancel-edit="cancelEditGroup"
      @start-edit="startEditGroup"
      @delete="deleteGroup"
      @add-token="addTokenToSelectedGroup"
      @remove-token="removeTokenFromSelectedGroup"
    />
  </div>
</template>

<script setup>
import { Settings } from "@vicons/ionicons5";

import { useMessage } from "naive-ui";
// Import required dependencies
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowReactive,
  toRaw,
  watch,
} from "vue";
import BatchApplyLegionModal from "@/components/BatchDaily/BatchApplyLegionModal.vue";
import BatchBlackMarketModal from "@/components/BatchDaily/BatchBlackMarketModal.vue";
import BatchDreamBuyModal from "@/components/BatchDaily/BatchDreamBuyModal.vue";
import BatchGlobalSettingsModal from "@/components/BatchDaily/BatchGlobalSettingsModal.vue";
import BatchGroupManageModal from "@/components/BatchDaily/BatchGroupManageModal.vue";
import BatchHelperModals from "@/components/BatchDaily/BatchHelperModals.vue";
import BatchLogPanel from "@/components/BatchDaily/BatchLogPanel.vue";
import BatchScheduleModals from "@/components/BatchDaily/BatchScheduleModals.vue";
import BatchTemplateModals from "@/components/BatchDaily/BatchTemplateModals.vue";
import BatchWarGuessModal from "@/components/BatchDaily/BatchWarGuessModal.vue";
import { useBatchLegionModals } from "@/composables/batch/useBatchLegionModals";
import { useBatchTokenGroups } from "@/composables/batch/useBatchTokenGroups";
import { useShanghaiClock } from "@/hooks/useShanghaiClock";
import { $emit } from "@/stores/events/index.ts";
import { gameTokens, tokenGroups, useTokenStore } from "@/stores/tokenStore";
// Import batch task modules
import {
  addTaskSaveLog,
  availableTasks,
  bossTimesOptions,
  // Constants
  boxTypeOptions,
  calculateMonthProgress,
  calculateNextExecutionTime,
  calculateNextRuns,
  isWarGuessActivityOpen as checkWarGuessActivityOpen,
  isWeirdTowerActivityOpen as checkWeirdTowerActivityOpen,
  createTasksApex,
  createTasksArena,
  createTasksBottle,
  createTasksCampChallenge,
  createTasksDungeon,
  createTasksFootball,
  // Task factories
  createTasksHangUp,
  createTasksItem,
  createTasksLegacy,
  createTasksStore,
  createTasksTower,
  createTasksXuanwuBlessing,
  fishTypeOptions,
  formationOptions,
  formatTimeDifference,
  getNextSortConfig,
  getSortIndicator,
  getTodayStartSec,
  getWarGuessActivityTip,
  isArenaActivityOpen,
  isBaokuActivityOpen,
  isTodayAvailable,
  matchesCronExpression,
  parseSortConfig,
  pickArenaTargetId,
  sortTokensList,
  validateCronExpression,
} from "@/utils/batch";
import {
  blackMarketItemCatalog,
  createBlackMarketPurchaseEntry,
  defaultBlackMarketPurchaseList,
  normalizeBlackMarketPurchaseList,
} from "@/utils/batch/blackMarketConfig";
import {
  applyConfigBackupData,
  buildConfigBackupData,
} from "@/utils/batch/configBackup";
import {
  closeOwnedConnection,
  withManagedConnection,
} from "@/utils/batch/connectionManager";
import {
  claimScheduledOccurrence,
  createScheduledTaskClock,
  runScheduledOccurrence,
} from "@/utils/batch/scheduledClock";
import {
  createScheduledRunQueue,
  summarizeScheduledRun,
} from "@/utils/batch/scheduledRuns";
import { runDailyDreamPurchase } from "@/utils/dailyDreamPurchase";
import { DailyTaskRunner } from "@/utils/dailyTaskRunner";
import {
  DAILY_TASK_DEFAULTS,
  readDailyTaskSettingsForExecution,
  resetDailyTaskSettings,
  SAFE_DAILY_TASK_DEFAULTS,
  writeDailyTaskSettings,
} from "@/utils/dailyTaskSettings";
import {
  goldItemsConfig,
  isDungeonOpen,
  merchantConfig,
} from "@/utils/dreamConstants";
import { markDreamShopChecked } from "@/utils/dreamShopCheckState";

import { DEFAULT_WEIRD_TOWER_MAX_CLIMB } from "@/utils/towerClimbLimit.js";

// Initialize token store, message service, and task runner
const tokenStore = useTokenStore();
const message = useMessage();
const weirdTowerMaxClimb = ref(DEFAULT_WEIRD_TOWER_MAX_CLIMB);

// 排序配置（从localStorage读取，与TokenImport共享）
const sortConfig = ref(
  parseSortConfig(localStorage.getItem("tokenSortConfig")),
);

// 排序后的游戏角色Token列表
const sortedTokens = computed(() =>
  sortTokensList(tokenStore.gameTokens, sortConfig.value),
);

// 切换排序
const toggleSort = (field) => {
  sortConfig.value = getNextSortConfig(sortConfig.value, field);
  localStorage.setItem("tokenSortConfig", JSON.stringify(sortConfig.value));
};

// 获取排序图标
const getSortIcon = (field) => getSortIndicator(sortConfig.value, field);

const tokens = computed(() => tokenStore.gameTokens);
const shanghaiNow = useShanghaiClock();
const ismengjingActivityOpen = computed(() => isDungeonOpen(shanghaiNow.value));
const isbaokuActivityOpen = computed(() => isBaokuActivityOpen());
const isarenaActivityOpen = computed(() => isArenaActivityOpen());
const isWeirdTowerActivityOpen = computed(() => checkWeirdTowerActivityOpen());
const isWarGuessActivityOpen = computed(() => checkWarGuessActivityOpen());
const warGuessActivityTip = computed(() => getWarGuessActivityTip());

const selectedTokens = ref([]);
const tokenStatus = ref({}); // { tokenId: 'waiting' | 'running' | 'completed' | 'failed' }
const isRunning = ref(false);
const shouldStop = ref(false);
const activeScheduledRun = ref(null);
const scheduledQueueSize = ref(0);
const executionTokens = computed(
  () => activeScheduledRun.value?.accounts ?? selectedTokens.value,
);
const pendingScheduledTasks = shallowReactive(new Map());
const uiBusy = computed(
  () =>
    isRunning.value ||
    scheduledQueueSize.value > 0 ||
    pendingScheduledTasks.size > 0,
);
const showBatchLogs = ref(false);
watch(uiBusy, (running) => {
  if (running) showBatchLogs.value = true;
});

// =====================
// Token分组管理状态
// =====================
const taskScheduleSelectedGroupIds = ref([]); // 定时任务中通过分组按钮选中的分组ID列表
const {
  showGroupManageModal,
  selectedGroups,
  newGroupName,
  newGroupColor,
  newGroupSelectedTokens,
  editingGroupId,
  editingGroupName,
  editingGroupColor,
  groupColors,
  createNewGroup,
  selectAllNewGroup,
  deselectAllNewGroup,
  deleteGroup,
  saveEditGroup,
  startEditGroup,
  cancelEditGroup,
  toggleGroupSelection,
  isGroupSelected,
  clearAllGroupSelection,
  addTokenToSelectedGroup,
  removeTokenFromSelectedGroup,
  getValidGroupTokenIds,
} = useBatchTokenGroups({
  tokenGroups,
  sortedTokens,
  selectedTokens,
  tokenStore,
  message,
});

// ======================
// War Guess & Apply Legion Modals
// ======================
const {
  showWarGuessModal,
  warGuessList,
  warGuessLoading,
  warGuessCoin,
  selectedWarGuessLegionId,
  warGuessColumns,
  warGuessRowProps,
  openWarGuessModal,
  fetchWarGuessRank,
  handleWarGuessCheer,
  showApplyLegionModal,
  applyLegionTargetId,
  applyLegionPreview,
  applyLegionLoading,
  applyLegionError,
  openApplyLegionModal,
  fetchApplyLegionTargetInfo,
  handleBatchApplyLegion,
} = useBatchLegionModals({
  tokens,
  selectedTokens,
  tokenStore,
  message,
  addLog: (entry) => addLog(entry),
  batchWarGuessCheer: (...args) => batchWarGuessCheer(...args),
  queryLegionById: (...args) => queryLegionById(...args),
  batchApplyLegion: (...args) => batchApplyLegion(...args),
});

// Settings Modal State
const showSettingsModal = ref(false);
const currentSettingsTokenId = ref(null);
const currentSettingsTokenName = ref("");
const settingsNeedRepair = ref(false);
const currentSettings = reactive({
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
  dreamShopPurchase: true,
});

// Task Template State
const showTaskTemplateModal = ref(false);
const showApplyTemplateModal = ref(false);
const showTemplateManagerModal = ref(false);
const showAccountTemplateModal = ref(false);
const taskTemplates = ref([]);
const selectedTemplateId = ref(null);
const selectedTokensForApply = ref([]);
const currentTemplateName = ref("");
const currentTemplateId = ref(null); // 用于编辑现有模板
const currentTemplate = reactive({
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
});

// Account Template References
const accountTemplateReferences = ref([]);
const filteredAccountTemplates = ref([]);
const selectedTemplateForFilter = ref(null);

// Computed for Apply Template
const isAllSelectedForApply = computed(() => {
  return (
    selectedTokensForApply.value.length === sortedTokens.value.length &&
    sortedTokens.value.length > 0
  );
});

const isIndeterminateForApply = computed(() => {
  return (
    selectedTokensForApply.value.length > 0 &&
    selectedTokensForApply.value.length < sortedTokens.value.length
  );
});

// Computed for Template Manager
const filteredTaskTemplates = computed(() => {
  return taskTemplates.value;
});

// Helper Modal State
const showHelperModal = ref(false);
const helperType = ref("box"); // 'box' | 'fish' | 'recruit'
const helperSettings = reactive({
  boxType: 2001,
  fishType: 1,
  count: 100,
  targetPoints: 1000,
});

const helperModalTitle = computed(() => {
  const titles = {
    box: "批量开宝箱",
    fish: "批量钓鱼",
    recruit: "批量招募",
    pointsBox: "按积分开箱",
  };
  return titles[helperType.value] || "批量助手";
});

// Batch Settings State
const showBatchSettingsModal = ref(false);

const defaultDreamPurchaseList = [];
for (const merchantId in goldItemsConfig) {
  goldItemsConfig[merchantId].forEach((index) => {
    defaultDreamPurchaseList.push(`${merchantId}-${index}`);
  });
}

const createDefaultBlackMarketPurchaseList = () =>
  defaultBlackMarketPurchaseList.map((item) => ({ ...item }));

const blackMarketItemOptions = blackMarketItemCatalog.map((item) => ({
  label: `${item.label} (${item.itemId})`,
  value: item.itemId,
}));

const batchSettings = reactive({
  dreamPurchaseList: defaultDreamPurchaseList,
  blackMarketPurchaseList: createDefaultBlackMarketPurchaseList(),
  boxCount: 100,
  fishCount: 100,
  recruitCount: 100,
  cdkCodes: "",
  cdkPlatformType: "h5",
  defaultBoxType: 2001,
  defaultFishType: 1,
  targetBoxPoints: 1000,
  receiverId: "",
  password: "",
  tokenListColumns: 2,
  // 延迟配置（毫秒）
  commandDelay: 500, // 命令间延迟
  taskDelay: 500, // 任务间延迟
  actionDelay: 300, // 一般操作延迟（开箱、钓鱼、招募等）
  battleDelay: 500, // 战斗延迟（宝库、竞技场等）
  refreshDelay: 1000, // 刷新延迟
  longDelay: 3000, // 长延迟（功法赠送等）
  // 其他配置
  maxActive: 2,
  connectionTimeout: 10000,
  reconnectDelay: 1000,
  maxLogEntries: 1000,
  // 页面刷新配置
  enableRefresh: false,
  refreshInterval: 360, // 分钟
});
const runtimeBatchSettings = new Proxy(batchSettings, {
  get(target, key, receiver) {
    const snapshot = activeScheduledRun.value?.batchSettings;
    return snapshot && Object.hasOwn(snapshot, key)
      ? snapshot[key]
      : Reflect.get(target, key, receiver);
  },
});

// Load batch settings from localStorage
const loadBatchSettings = () => {
  try {
    const saved = localStorage.getItem("batchSettings");
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(batchSettings, parsed);
    }
    batchSettings.cdkCodes = batchSettings.cdkCodes || "";
    batchSettings.cdkPlatformType = batchSettings.cdkPlatformType || "h5";
    batchSettings.blackMarketPurchaseList = normalizeBlackMarketPurchaseList(
      batchSettings.blackMarketPurchaseList?.length
        ? batchSettings.blackMarketPurchaseList
        : createDefaultBlackMarketPurchaseList(),
    );
  } catch (error) {
    console.error("Failed to load batch settings:", error);
  }
};

// Save batch settings to localStorage
const saveBatchSettings = () => {
  try {
    localStorage.setItem("batchSettings", JSON.stringify(batchSettings));
    message.success("定时批量任务设置已保存");
    showBatchSettingsModal.value = false;
  } catch (error) {
    console.error("Failed to save batch settings:", error);
    message.error("保存设置失败");
  }
};

// Open batch settings modal
const openBatchSettings = () => {
  loadBatchSettings();
  showBatchSettingsModal.value = true;
};

const saveBatchSettingsFromModal = (payload) => {
  Object.assign(batchSettings, payload);
  saveBatchSettings();
};

// Load settings on component mount
loadBatchSettings();

// ======================
// Legacy Gift Feature
// ======================

// Legacy Gift Modal State
const showLegacyGiftModal = ref(false);
const recipientIdInput = ref("");
const recipientIdError = ref("");
const recipientInfo = ref(null);
const isQueryingRecipient = ref(false);
const giftQuantity = ref(10);
const securityPassword = ref(""); // 安全密码
// 头像加载状态
const isAvatarLoading = ref(false);
const avatarLoadError = ref(false);

// ======================
// Scheduled Tasks Feature
// ======================

// Scheduled Tasks State Management
const scheduledTasks = ref([]); // List of all scheduled tasks
const scheduledTasksStale = ref(false);
const showTaskModal = ref(false); // Control the visibility of the add/edit task modal
const showTasksModal = ref(false); // Control the visibility of the tasks list modal
const showRedeemCodeModal = ref(false); // Control the visibility of the redeem code modal
const editingTask = ref(null); // Currently editing task
const taskForm = reactive({
  name: "", // Task name
  runType: "daily", // 'daily' or 'cron'
  runTime: null, // Daily run time (HH:mm format)
  cronExpression: "", // Cron expression for complex scheduling
  selectedTokens: [], // Selected token IDs
  selectedTasks: [], // Selected task function names
  legionApplyTargetId: null, // Target legion for batchApplyLegion
  enabled: true, // Whether the task is enabled
});

// 任务分组定义
const taskGroupDefinitions = [
  {
    name: "daily",
    label: "日常",
    tasks: [
      "startBatch",
      "claimHangUpRewards",
      "batchAddHangUpTime",
      "resetBottles",
      "batchlingguanzi",
      "batchclubsign",
      "batchApplyLegion",
      "batchStudy",
      "batcharenafight",
      "batchCampChallenge",
      "batchCampChallengePet",
      "batchCampClaimTasks",
      "store_syncpurchaseconfig",
      "store_purchase",
      "collection_claimfreereward",
      "batchGenieSweep",
      "batchXuanwuBlessing",
    ],
  },
  {
    name: "dungeon",
    label: "副本",
    tasks: [
      "climbTower",
      "batchmengjing",
      "skinChallenge",
      "batchClaimPeachTasks",
      "batchBuyDreamItems",
    ],
  },
  { name: "baoku", label: "宝库", tasks: ["batchbaoku13", "batchbaoku45"] },
  {
    name: "weirdTower",
    label: "怪异塔",
    tasks: [
      "climbWeirdTower",
      "batchUseItems",
      "batchMergeItems",
      "batchClaimFreeEnergy",
    ],
  },
  {
    name: "resource",
    label: "资源",
    tasks: [
      "batchOpenBox",
      "batchOpenBoxByPoints",
      "batchClaimBoxPointReward",
      "batchFish",
      "batchRecruit",
      "batchRedeemCodes",
      "legion_storebuygoods",
    ],
  },
  {
    name: "legacy",
    label: "功法",
    tasks: ["batchLegacyClaim", "batchLegacyGiftSendEnhanced"],
  },
  {
    name: "monthly",
    label: "月度",
    tasks: ["batchTopUpFish", "batchTopUpArena"],
  },
];

// 计算属性，根据 taskGroupDefinitions 将 availableTasks 分组
const groupedAvailableTasks = computed(() => {
  const groups = {};
  taskGroupDefinitions.forEach((group) => {
    groups[group.name] = availableTasks.filter((task) =>
      group.tasks.includes(task.value),
    );
  });

  // 处理未分组的任务
  const groupedTaskValues = taskGroupDefinitions.flatMap((g) => g.tasks);
  const otherTasks = availableTasks.filter(
    (task) => !groupedTaskValues.includes(task.value),
  );
  if (otherTasks.length > 0) {
    groups.other = otherTasks;
  }

  return groups;
});

// Cron表达式解析相关变量
const cronValidation = ref({ valid: true, message: "" });
const cronNextRuns = ref([]);

// ======================
// Scheduled Tasks Storage
// ======================

// Track executing tasks for UI loading state
const executingTaskIds = ref([]);

// Manual execute task
const manualExecuteTask = async (task) => {
  if (!requireCurrentScheduledConfig()) return;
  if (executingTaskIds.value.includes(task.id) || uiBusy.value) return;

  executingTaskIds.value.push(task.id);
  try {
    message.info(`开始执行任务: ${task.name}`);
    const result = await enqueueScheduledTask(task);
    if (result.status === "completed")
      message.success(`任务 ${task.name} 执行结束`);
    else if (result.status === "failed")
      message.error(`任务 ${task.name} 执行失败，请查看日志`);
    else message.warning(`任务 ${task.name} 未全部完成，请查看日志`);
  } catch (e) {
    console.error(`执行任务 ${task.name} 失败:`, e);
    message.error(`任务 ${task.name} 执行失败`);
  } finally {
    executingTaskIds.value = executingTaskIds.value.filter(
      (id) => id !== task.id,
    );
  }
};

// Load scheduled tasks from localStorage
const loadScheduledTasks = () => {
  try {
    const saved = localStorage.getItem("scheduledTasks");

    if (saved) {
      const parsed = JSON.parse(saved);

      // Ensure we have an array
      scheduledTasks.value = Array.isArray(parsed) ? parsed : [];
    } else {
      scheduledTasks.value = [];
    }
  } catch (error) {
    console.error("Failed to load scheduled tasks:", error);
    scheduledTasks.value = [];
  }
};

// Save scheduled tasks to localStorage
const saveScheduledTasks = () => {
  if (scheduledTasksStale.value) return;
  try {
    const dataToSave = JSON.stringify(scheduledTasks.value);

    localStorage.setItem("scheduledTasks", dataToSave);
    // Verify save was successful
    localStorage.getItem("scheduledTasks");
  } catch (error) {
    console.error("Failed to save scheduled tasks:", error);
  }
};

const toggleScheduleGroup = (groupId) => {
  const index = taskScheduleSelectedGroupIds.value.indexOf(groupId);
  const groupTokenIds = getValidGroupTokenIds(groupId);

  if (index > -1) {
    taskScheduleSelectedGroupIds.value.splice(index, 1);
    taskForm.selectedTokens = taskForm.selectedTokens.filter(
      (id) => !groupTokenIds.includes(id),
    );
  } else {
    taskScheduleSelectedGroupIds.value.push(groupId);
    groupTokenIds.forEach((id) => {
      if (!taskForm.selectedTokens.includes(id)) {
        taskForm.selectedTokens.push(id);
      }
    });
  }
};

// Open task modal for adding new task
const openTaskModal = () => {
  editingTask.value = null;
  Object.assign(taskForm, {
    name: "",
    runType: "daily",
    runTime: undefined,
    cronExpression: "",
    selectedTokens: [],
    selectedTasks: [],
    legionApplyTargetId: null,
    enabled: true,
  });
  taskScheduleSelectedGroupIds.value = [];
  showTaskModal.value = true;
};

// Edit existing task
const editTask = (task) => {
  editingTask.value = task;
  const taskData = { ...task };
  if (
    task.runType === "daily" &&
    task.runTime &&
    typeof task.runTime === "string"
  ) {
    const [hours, minutes] = task.runTime.split(":").map(Number);
    const now = new Date();
    taskData.runTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
    );
  }
  Object.assign(taskForm, {
    name: "",
    runType: "daily",
    runTime: undefined,
    cronExpression: "",
    selectedTokens: [],
    selectedTasks: [],
    legionApplyTargetId: null,
    enabled: true,
  });
  Object.assign(taskForm, taskData);
  taskScheduleSelectedGroupIds.value = [];
  showTaskModal.value = true;
};

// 注: validateCronExpression 已从 @/utils/batch 导入

// Parse cron expression and calculate next execution times
const parseCronExpression = (expression) => {
  // Validate the expression first
  const validation = validateCronExpression(expression);
  cronValidation.value = validation;

  if (!validation.valid) {
    cronNextRuns.value = [];
    return;
  }

  // Parse the expression and calculate next runs
  const cronParts = expression.split(" ").filter(Boolean);
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] =
    cronParts;

  // Calculate next 5 execution times
  const nextRuns = calculateNextRuns(
    minuteField,
    hourField,
    dayOfMonthField,
    monthField,
    dayOfWeekField,
    5,
  );
  cronNextRuns.value = nextRuns;
};

// 注: calculateNextRuns 已从 @/utils/batch 导入

// Save task (create or update)
const saveTask = () => {
  if (!requireCurrentScheduledConfig()) return;
  if (!taskForm.name) {
    message.warning("请输入任务名称");
    return;
  }

  if (taskForm.runType === "daily" && !taskForm.runTime) {
    message.warning("请选择运行时间");
    return;
  }

  if (taskForm.runType === "cron") {
    if (!taskForm.cronExpression) {
      message.warning("请输入Cron表达式");
      return;
    }

    // Validate cron expression
    const validation = validateCronExpression(taskForm.cronExpression);
    if (!validation.valid) {
      message.warning(validation.message);
      return;
    }
  }

  if (taskForm.selectedTokens.length === 0) {
    message.warning("请选择至少一个账号");
    return;
  }

  if (taskForm.selectedTasks.length === 0) {
    message.warning("请选择至少一个任务");
    return;
  }

  if (
    taskForm.selectedTasks.includes("batchApplyLegion") &&
    !Number(taskForm.legionApplyTargetId)
  ) {
    message.warning("请为批量申请俱乐部任务填写目标俱乐部ID");
    return;
  }

  // Format runTime as string for storage
  let formattedRunTime = null;
  if (taskForm.runType === "daily" && taskForm.runTime) {
    const time = new Date(taskForm.runTime);
    formattedRunTime = time.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const taskData = {
    id: editingTask.value?.id || `task_${Date.now()}`,
    name: taskForm.name,
    runType: taskForm.runType,
    runTime: formattedRunTime,
    cronExpression: taskForm.runType === "cron" ? taskForm.cronExpression : "",
    selectedTokens: [...taskForm.selectedTokens],
    selectedTasks: [...taskForm.selectedTasks],
    legionApplyTargetId: Number(taskForm.legionApplyTargetId || 0) || null,
    enabled: taskForm.enabled,
  };

  const isNew = !editingTask.value;

  if (editingTask.value) {
    // Update existing task
    const index = scheduledTasks.value.findIndex(
      (t) => t.id === editingTask.value.id,
    );
    if (index !== -1) {
      scheduledTasks.value[index] = taskData;
    }
  } else {
    // Add new task
    scheduledTasks.value.push(taskData);
  }

  saveScheduledTasks();

  // Add log entry for task save
  addTaskSaveLog(taskData, isNew, addLog);

  showTaskModal.value = false;
  message.success("定时任务已保存");
};

// Delete task
const deleteTask = (taskId) => {
  if (!requireCurrentScheduledConfig()) return;
  const task = scheduledTasks.value.find((t) => t.id === taskId);
  if (task) {
    scheduledTasks.value = scheduledTasks.value.filter((t) => t.id !== taskId);
    saveScheduledTasks();
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务 ${task.name} 已删除 ===`,
      type: "info",
    });
    message.success("定时任务已删除");
  }
};

// Toggle task enabled state
const toggleTaskEnabled = (taskId, enabled) => {
  if (!requireCurrentScheduledConfig()) return;
  const task = scheduledTasks.value.find((t) => t.id === taskId);
  if (task) {
    task.enabled = enabled;
    saveScheduledTasks();
    message.success(`定时任务已${enabled ? "启用" : "禁用"}`);
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务 ${task.name} 已${enabled ? "启用" : "禁用"} ===`,
      type: "info",
    });
  }
};

// 注: addTaskSaveLog 已从 @/utils/batch 导入，调用时需传入 addLog

// Reset run type related fields
const resetRunType = () => {
  if (taskForm.runType === "daily") {
    taskForm.cronExpression = "";
  } else {
    taskForm.runTime = undefined;
  }
};

// Select all tokens
const selectAllTokens = () => {
  taskForm.selectedTokens = tokens.value.map((token) => token.id);
};

// Deselect all tokens
const deselectAllTokens = () => {
  taskForm.selectedTokens = [];
};

// Select all tasks
const selectAllTasks = () => {
  const giftSelected = taskForm.selectedTasks.includes(
    "batchLegacyGiftSendEnhanced",
  );
  taskForm.selectedTasks = availableTasks
    .filter(
      (task) => task.value !== "batchLegacyGiftSendEnhanced" || giftSelected,
    )
    .map((task) => task.value);
};

// Deselect all tasks
const deselectAllTasks = () => {
  taskForm.selectedTasks = [];
};

// ======================
// Import/Export Config
// ======================

const exportOptions = [
  { label: "导出任务设置（不含账号凭据）", key: "settings" },
  { label: "备份账号和设置（包含账号凭据）", key: "full" },
];

// Export settings by default; credentials are included only in an explicit backup.
const exportConfig = (mode = "settings") => {
  try {
    const exportData = buildConfigBackupData({
      mode,
      tokens: tokens.value,
      scheduledTasks: scheduledTasks.value,
      batchSettings,
      storage: localStorage,
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xyzw_${mode === "full" ? "account_backup" : "settings"}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    message.success(
      mode === "full"
        ? `账号备份已导出，包含 ${exportData.tokens.length} 个账号凭据`
        : `任务设置已导出，不包含账号凭据`,
    );
  } catch (error) {
    console.error("Export failed:", error);
    message.error(`导出失败: ${error.message}`);
  }
};

// Import tokens and scheduled tasks configuration
const importConfig = async ({ file }) => {
  try {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        const result = applyConfigBackupData({
          importData,
          gameTokens: gameTokens.value,
          tokens: tokens.value,
          scheduledTasks: scheduledTasks.value,
          availableTasks,
          batchSettings,
          normalizeBlackMarketPurchaseList,
          createDefaultBlackMarketPurchaseList,
          canImportScheduledTasks: requireCurrentScheduledConfig,
          writeDailyTaskSettings,
          saveScheduledTasks,
          saveBatchSettings,
        });

        if (result.status === "invalid") {
          message.error(result.error);
          return;
        }
        if (result.scheduledTasksSkippedByStaleConfig) {
          message.warning("定时任务配置已陈旧，已仅导入账号与基础设置");
        }
        if (result.warning) {
          message.warning(result.warning);
        } else {
          message.success(result.summary);
        }
      } catch (parseError) {
        console.error("Parse error:", parseError);
        message.error("解析配置文件失败");
      }
    };
    reader.readAsText(file.file);
  } catch (error) {
    console.error("Import failed:", error);
    message.error(`导入失败: ${error.message}`);
  }
};

// ======================
// Scheduled Tasks Countdown
// ======================

// 注: parseCronField, calculateNextExecutionTime, formatTimeDifference 已从 @/utils/batch 导入

// Task countdowns ref
const taskCountdowns = ref({});
const nextExecutionTimes = ref({});

// Update countdowns for all tasks
const updateCountdowns = () => {
  const now = Date.now();

  scheduledTasks.value.forEach((task) => {
    if (!task.enabled) {
      // Clear countdown for disabled tasks
      delete taskCountdowns.value[task.id];
      return;
    }

    if (
      !nextExecutionTimes.value[task.id] ||
      nextExecutionTimes.value[task.id] <= now
    ) {
      // Calculate next execution time if not set or passed
      nextExecutionTimes.value[task.id] = calculateNextExecutionTime(task);
    }

    if (nextExecutionTimes.value[task.id]) {
      const timeDiff = nextExecutionTimes.value[task.id] - now;
      taskCountdowns.value[task.id] = {
        remainingTime: Math.max(0, timeDiff),
        formatted: formatTimeDifference(Math.max(0, timeDiff)),
        isNearExecution: timeDiff < 5 * 60 * 1000, // Less than 5 minutes
      };
    }
  });
};

// 计算最短倒计时任务
const shortestCountdownTask = computed(() => {
  if (scheduledTasks.value.length === 0) return null;

  let shortestTask = null;
  let shortestTime = Infinity;

  // 遍历所有任务，找到倒计时最短的任务
  scheduledTasks.value.forEach((task) => {
    if (!task.enabled) return;

    const countdown = taskCountdowns.value[task.id];
    if (countdown && countdown.remainingTime < shortestTime) {
      shortestTime = countdown.remainingTime;
      shortestTask = {
        task,
        countdown,
      };
    }
  });

  return shortestTask;
});

// Start countdown interval
let countdownInterval = null;

const startCountdown = () => {
  // Clear any existing interval
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  // Update countdowns immediately
  updateCountdowns();

  // Update countdowns every second
  countdownInterval = setInterval(updateCountdowns, 1000);
};

// ======================
// Scheduled Tasks Scheduler
// ======================

// Initialize scheduled tasks from localStorage
loadScheduledTasks();
const scheduledClock = createScheduledTaskClock({
  tasks: scheduledTasks.value,
  now: Date.now(),
  matchesCron: matchesCronExpression,
});

// Watch for changes to scheduledTasks for debugging
watch(
  scheduledTasks,
  () => {
    scheduledClock.observe(scheduledTasks.value, Date.now());
    // Reset countdowns when tasks change
    nextExecutionTimes.value = {};
    taskCountdowns.value = {};
    updateCountdowns();
  },
  { deep: true, flush: "sync" },
);

// 修复TimePicker的"Invalid time value"错误：确保runTime的初始值不是null
watch(
  () => showTaskModal.value,
  (isVisible) => {
    if (isVisible && !taskForm.runTime) {
      // 当模态框显示且runTime为null时，将其设置为undefined
      taskForm.runTime = undefined;
    }
  },
);

// Task scheduler variables - moved to component level scope
const intervalId = ref(null);
let healthCheckInterval = null;
const pageLoadTime = Date.now();
let lastTimeoutWarning = null;
let schedulerPageActive = true;
let scheduledClaimGeneration = 0;
let noSchedulerLockWarning = false;

const releaseScheduledClaim = (id, claim) => {
  if (pendingScheduledTasks.get(id) === claim) pendingScheduledTasks.delete(id);
};
const abortWaitingScheduledClaims = () => {
  for (const [id, claim] of pendingScheduledTasks) {
    if (!claim.queued) {
      releaseScheduledClaim(id, claim);
      claim.controller.abort();
    }
  }
};

const pauseStaleScheduler = () => {
  if (scheduledTasksStale.value) return;
  scheduledTasksStale.value = true;
  abortWaitingScheduledClaims();
  scheduledQueue.cancelPending();
  if (activeScheduledRun.value?.scheduledTime != null) shouldStop.value = true;
  const warning =
    "定时任务已在其他页面变更或数据不可用，本页已暂停调度；请先记录未保存内容，再刷新页面";
  message.warning(warning);
  addLog({
    time: new Date().toLocaleTimeString(),
    message: warning,
    type: "warning",
  });
};

const requireCurrentScheduledConfig = () => {
  if (scheduledTasksStale.value) return false;
  try {
    const persisted = JSON.parse(
      localStorage.getItem("scheduledTasks") || "[]",
    );
    if (
      Array.isArray(persisted) &&
      JSON.stringify(persisted) === JSON.stringify(scheduledTasks.value)
    )
      return true;
  } catch {}
  pauseStaleScheduler();
  return false;
};

const handleScheduledStorageChange = (event) => {
  if (
    event.storageArea === localStorage &&
    (event.key === "scheduledTasks" || event.key === null)
  )
    pauseStaleScheduler();
};

// Health check for the scheduler
const healthCheck = () => {
  // If interval is not running, restart it
  if (!intervalId.value) {
    console.error(
      `[${new Date().toISOString()}] Task scheduler interval is not running, restarting...`,
    );
    startScheduler();
  }

  const startedAt = activeScheduledRun.value?.startedAt;
  if (
    startedAt &&
    Date.now() - startedAt >= 10 * 60 * 1000 &&
    lastTimeoutWarning !== startedAt
  ) {
    lastTimeoutWarning = startedAt;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "定时任务已运行超过 10 分钟，可查看日志或手动停止",
      type: "warning",
    });
  }

  // Check for page refresh
  if (batchSettings.enableRefresh && batchSettings.refreshInterval > 0) {
    const elapsedMinutes = (Date.now() - pageLoadTime) / 1000 / 60;
    if (elapsedMinutes >= batchSettings.refreshInterval) {
      if (!uiBusy.value) {
        console.log(
          `[${new Date().toISOString()}] Refreshing page as scheduled (Interval: ${batchSettings.refreshInterval}m, Elapsed: ${elapsedMinutes.toFixed(1)}m)`,
        );
        window.location.reload();
      } else {
        console.log(
          `[${new Date().toISOString()}] Scheduled refresh postponed due to running task`,
        );
      }
    }
  }
};

// Start the scheduler
const startScheduler = () => {
  // Clear any existing interval first
  if (intervalId.value) {
    clearInterval(intervalId.value);
  }

  // Check every 10 seconds instead of 60 seconds for more timely task execution
  intervalId.value = setInterval(() => {
    try {
      if (!requireCurrentScheduledConfig()) return;
      const now = new Date();
      const currentTime = now.toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const tasks = scheduledTasks.value;
      const { due, missed, errors } = scheduledClock.poll(tasks, now.getTime());
      if (!navigator.locks?.request) {
        if (tasks.some((task) => task.enabled) && !noSchedulerLockWarning) {
          noSchedulerLockWarning = true;
          const warning =
            "当前浏览器无法防止多个页面重复执行，定时任务已暂停；请使用支持跨标签锁的浏览器";
          message.warning(warning);
          addLog({ time: currentTime, message: warning, type: "warning" });
        }
        return;
      }
      for (const item of errors) {
        addLog({
          time: currentTime,
          message: `定时任务 ${item.task.name} 的时间配置无效：${item.error.message}`,
          type: "error",
        });
      }
      if (missed.length) {
        message.warning(
          `有 ${missed.length} 个定时任务可能错过执行时间，请查看日志并按需手动处理`,
        );
      }
      for (const item of missed) {
        const detail = item.unknown
          ? "页面暂停过久，可能错过执行时间"
          : "错过的执行时间已超过 30 分钟";
        addLog({
          time: currentTime,
          message: `定时任务 ${item.task.name}：${detail}，请检查是否需要手动执行`,
          type: "warning",
        });
      }
      for (const item of due) {
        // A frequent cron must not stack claims while this task is waiting,
        // queued or running, including while another tab owns the claim lock.
        if (pendingScheduledTasks.has(item.task.id)) continue;
        const claim = { controller: new AbortController(), queued: false };
        pendingScheduledTasks.set(item.task.id, claim);
        const claimGeneration = scheduledClaimGeneration;
        claimScheduledOccurrence({
          locks: navigator.locks,
          storage: localStorage,
          task: item.task,
          time: item.time,
          signal: claim.controller.signal,
          isActive: () =>
            schedulerPageActive &&
            claimGeneration === scheduledClaimGeneration &&
            requireCurrentScheduledConfig(),
          enqueue: (task) => {
            claim.queued = true;
            return enqueueScheduledTask(task, item.time).finally(() =>
              releaseScheduledClaim(task.id, claim),
            );
          },
          onError: (error) =>
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `定时任务 ${item.task.name} 无法加入队列：${error.message}`,
              type: "error",
            }),
        }).then((result) => {
          if (result.status !== "queued")
            releaseScheduledClaim(item.task.id, claim);
          if (result.status === "stale") pauseStaleScheduler();
          if (
            ["error", "unknown-marker", "expired", "unsupported"].includes(
              result.status,
            )
          ) {
            const reasonText =
              result.status === "expired"
                ? "已超过补跑时限"
                : result.status === "unsupported"
                  ? "浏览器不支持跨标签锁"
                  : "无法确认去重状态";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `定时任务 ${item.task.name} 无法安全执行（${reasonText}），请检查后手动执行`,
              type: "warning",
            });
          }
        });
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error in task scheduler:`,
        error,
      );
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 定时任务调度服务发生错误: ${error.message} ===`,
        type: "error",
      });
    }
  }, 10000); // Check every 10 seconds
};

// Token刷新等待处理函数
const handleTokenRefreshWaiting = (data) => {
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `Token刷新限流等待中，预计等待 ${data.waitSeconds} 秒（队列: ${data.queueSize}）`,
    type: "warning",
  });
};

// Debug: Log initial state when component mounts
onMounted(() => {
  window.addEventListener("storage", handleScheduledStorageChange);
  // Start the task scheduler after all functions are initialized
  scheduleTaskExecution();
  // Start countdown timer
  startCountdown();
  loadTaskTemplates();
  // 监听Token刷新等待事件
  $emit.on("token:refresh:waiting", handleTokenRefreshWaiting);
});

// Cleanup countdown interval on unmount
onBeforeUnmount(() => {
  schedulerPageActive = false;
  abortWaitingScheduledClaims();
  window.removeEventListener("storage", handleScheduledStorageChange);
  scheduledQueue.close();
  if (activeScheduledRun.value || isRunning.value) shouldStop.value = true;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // 移除Token刷新等待事件监听
  $emit.off("token:refresh:waiting", handleTokenRefreshWaiting);

  // Cleanup task scheduler intervals
  if (intervalId.value) {
    clearInterval(intervalId.value);
    intervalId.value = null;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "=== 定时任务调度服务已停止 ===",
      type: "info",
    });
  }

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
});

// Task scheduler - ensure it runs properly
const scheduleTaskExecution = () => {
  // Log the start of the scheduler
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "=== 定时任务调度服务已启动 ===",
    type: "info",
  });

  // Start the scheduler
  startScheduler();

  // Health check every 5 minutes instead of 1 hour for more frequent safety checks
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  healthCheckInterval = setInterval(healthCheck, 5 * 60 * 1000);

  // Initial health check
  healthCheck();
};

/** Resolve a configured task without evaluating user-controlled source code.
 * @param {string} taskName Stored task identifier.
 * @returns {Function|undefined} The registered task, or undefined for unknown names.
 */
function getScheduledTask(taskName) {
  const tasks = {
    startBatch,
    claimHangUpRewards,
    batchAddHangUpTime,
    resetBottles,
    batchlingguanzi,
    climbTower,
    climbWeirdTower,
    batchStudy,
    batchOpenBox,
    batchOpenBoxByPoints,
    batchClaimBoxPointReward,
    batchFish,
    batchRecruit,
    batchRedeemCodes,
    batchbaoku13,
    batchbaoku45,
    batchmengjing,
    batchclubsign,
    batchCampChallenge,
    batchCampChallengePet,
    batchCampClaimTasks,
    batchApplyLegion,
    batcharenafight,
    batchTopUpFish,
    batchTopUpArena,
    batchClaimFreeEnergy,
    skinChallenge,
    legion_storebuygoods,
    store_syncpurchaseconfig,
    store_purchase,
    collection_claimfreereward,
    batchLegacyClaim,
    batchLegacyGiftSendEnhanced,
    batchUseItems,
    batchMergeItems,
    batchClaimPeachTasks,
    batchGenieSweep,
    batchBuyDreamItems,
    batchXuanwuBlessing,
  };
  return Object.hasOwn(tasks, taskName) ? tasks[taskName] : undefined;
}

// Verify task dependencies - 只验证基础依赖，WebSocket连接由具体任务函数处理
const verifyTaskDependencies = async (task) => {
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始验证定时任务 ${task.name} 的依赖 ===`,
    type: "info",
  });

  // Verify localStorage is available
  try {
    const probeKey = `xyzw_scheduler_probe_${Date.now()}_${Math.random()}`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "✅ localStorage可用",
      type: "info",
    });
  } catch (error) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `❌ localStorage不可用: ${error.message}`,
      type: "error",
    });
    return false;
  }

  // Verify token store is available
  if (!tokenStore || !tokenStore.gameTokens) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "❌ Token存储不可用",
      type: "error",
    });
    return false;
  }

  // Verify task functions exist
  for (const taskName of task.selectedTasks) {
    const taskFunction = getScheduledTask(taskName);
    if (typeof taskFunction !== "function") {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `❌ 任务函数不存在: ${taskName}`,
        type: "error",
      });
      return false;
    }
  }

  if (
    task.selectedTasks.includes("batchApplyLegion") &&
    !Number(task.legionApplyTargetId)
  ) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务 ${task.name} 缺少目标俱乐部ID ===`,
      type: "error",
    });
    return false;
  }

  // 直接使用所有选中的token，WebSocket连接由具体任务函数内部管理
  // ensureConnection函数会自动处理并行连接和连接池管理
  const connectedTokens = task.selectedTokens.map((tokenId) => {
    const tokenName =
      tokenStore.gameTokens.find((t) => t.id === tokenId)?.name || tokenId;
    return { id: tokenId, name: tokenName };
  });

  // Log connection status
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `✅ 将使用 ${connectedTokens.length} 个账号执行任务`,
    type: "info",
  });

  // Store connected tokens for execution
  task.connectedTokens = connectedTokens.map((t) => t.id);

  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 定时任务 ${task.name} 的依赖验证通过，将执行 ${connectedTokens.length} 个账号 ===`,
    type: "success",
  });
  return true;
};

// Execute a scheduled task with dependency verification
const executeScheduledTask = async (task) => {
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始执行定时任务: ${task.name} ===`,
    type: "info",
  });

  try {
    // Verify dependencies before executing task
    const dependenciesValid = await verifyTaskDependencies(task);
    if (!dependenciesValid) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 定时任务 ${task.name} 依赖验证失败，取消执行 ===`,
        type: "error",
      });
      return { status: "failed", steps: [] };
    }

    // Filter out tokens that don't exist in current tokens.value
    const availableTokens = (
      task.connectedTokens || task.selectedTokens
    ).filter((tokenId) => {
      return tokens.value.some((t) => t.id === tokenId);
    });

    const missingTokens = (task.connectedTokens || task.selectedTokens).filter(
      (tokenId) => {
        return !tokens.value.some((t) => t.id === tokenId);
      },
    );

    if (missingTokens.length > 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `⚠️  跳过不存在的Token: ${missingTokens.join(", ")}`,
        type: "warning",
      });
    }

    if (availableTokens.length === 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 定时任务 ${task.name} 没有可用的Token，取消执行 ===`,
        type: "error",
      });
      return { status: "failed", steps: [] };
    }

    if (!activeScheduledRun.value) {
      throw new Error("定时任务缺少独立的执行上下文");
    }
    activeScheduledRun.value.accounts = [...availableTokens];
    const steps = [];

    // Task types share account connections and run state; account-level concurrency stays inside each task.
    for (const taskName of task.selectedTasks) {
      if (shouldStop.value) break;

      if (
        ["batchbaoku45", "batchbaoku13"].includes(taskName) &&
        !isbaokuActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在宝库开放时间)`,
          type: "warning",
        });
        steps.push({ name: taskName, status: "skipped" });
        continue;
      }

      if (
        ["batchmengjing", "batchBuyDreamItems"].includes(taskName) &&
        !isDungeonOpen()
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在梦境开放时间)`,
          type: "warning",
        });
        steps.push({ name: taskName, status: "skipped" });
        continue;
      }

      if (
        ["batchTopUpArena", "batcharenafight"].includes(taskName) &&
        !isarenaActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在竞技场开放时间)`,
          type: "warning",
        });
        steps.push({ name: taskName, status: "skipped" });
        continue;
      }

      if (
        [
          "climbWeirdTower",
          "batchUseItems",
          "batchMergeItems",
          "batchClaimFreeEnergy",
        ].includes(taskName) &&
        !isWeirdTowerActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在怪异塔开放时间)`,
          type: "warning",
        });
        steps.push({ name: taskName, status: "skipped" });
        continue;
      }

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `执行任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName}`,
        type: "info",
      });

      // Call the task function dynamically
      const taskFunction = getScheduledTask(taskName);
      if (typeof taskFunction === "function") {
        availableTokens.forEach((id) => {
          tokenStatus.value[id] = "waiting";
        });
        // For batch operations, pass isScheduledTask = true
        // 具体的batch任务函数内部会使用ensureConnection管理并行连接
        if (
          [
            "batchOpenBox",
            "batchOpenBoxByPoints",
            "batchFish",
            "batchRecruit",
            "batchLegacyGiftSendEnhanced",
          ].includes(taskName)
        ) {
          await taskFunction(true);
        } else if (taskName === "batchApplyLegion") {
          await taskFunction(task.legionApplyTargetId);
        } else {
          await taskFunction();
        }
        const statuses = availableTokens.map((id) => tokenStatus.value[id]);
        const status = statuses.every((value) => value === "completed")
          ? "completed"
          : statuses.includes("failed")
            ? "failed"
            : statuses.includes("stopped")
              ? "stopped"
              : "pending";
        steps.push({ name: taskName, status });
      } else {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `任务函数不存在: ${taskName}`,
          type: "error",
        });
        steps.push({ name: taskName, status: "failed" });
      }
    }

    const status = summarizeScheduledRun(steps, {
      stopped:
        shouldStop.value || steps.some((step) => step.status === "stopped"),
      missing: missingTokens.length,
    });
    const summary = {
      completed: "执行流程结束，请查看各账号结果",
      partial: "部分步骤完成，其余步骤待检查",
      pending: "未确认全部完成，请查看日志",
      failed: "执行失败，请查看日志",
      stopped: "已停止，未执行的步骤需要重新开始",
    }[status];
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务 ${task.name}: ${summary} ===`,
      type:
        status === "failed"
          ? "error"
          : status === "completed"
            ? "info"
            : "warning",
    });
    return { status, steps };
  } catch (error) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务执行失败: ${error.message} ===`,
      type: "error",
    });
    console.error(
      `[${new Date().toISOString()}] Error executing scheduled task ${task.name}:`,
      error,
    );
    return { status: "failed", steps: [] };
  }
};

// Freeze each plan before it is queued, so later UI edits cannot change its targets.
const snapshotScheduledValue = (value) => JSON.parse(JSON.stringify(value));
const scheduledQueue = createScheduledRunQueue({
  isBusy: () =>
    isRunning.value ||
    isQueryingRecipient.value ||
    warGuessLoading.value ||
    applyLegionLoading.value,
  onPendingChange: (count) => {
    scheduledQueueSize.value = count;
  },
  execute: async (context, { isCancelled, signal }) => {
    const execute = async () => {
      if (isCancelled()) return { status: "stopped", started: false };
      shouldStop.value = false;
      context.startedAt = Date.now();
      activeScheduledRun.value = context;
      try {
        return await executeScheduledTask(context.task);
      } finally {
        activeScheduledRun.value = null;
      }
    };
    if (context.scheduledTime == null) {
      if (isCancelled() || !requireCurrentScheduledConfig())
        return { status: "stopped", started: false };
      return execute();
    }
    const result = await runScheduledOccurrence({
      locks: navigator.locks,
      storage: localStorage,
      task: context.task,
      time: context.scheduledTime,
      signal,
      isActive: () =>
        !isCancelled() &&
        schedulerPageActive &&
        requireCurrentScheduledConfig(),
      execute,
    });
    if (
      result.status === "stopped" &&
      result.reason &&
      result.reason !== "closed"
    ) {
      const detail =
        result.reason === "expired"
          ? "排队已超过 30 分钟"
          : "配置或执行环境已变化";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `定时任务 ${context.task.name}：${detail}，已跳过，请按需手动处理`,
        type: "warning",
      });
      message.warning(`定时任务 ${context.task.name}：${detail}，已跳过`);
    }
    return result;
  },
});

const enqueueScheduledTask = async (task, scheduledTime = null) => {
  const taskSnapshot = snapshotScheduledValue(task);
  if (
    !Array.isArray(taskSnapshot.selectedTokens) ||
    !Array.isArray(taskSnapshot.selectedTasks)
  ) {
    throw new TypeError("定时任务的账号或步骤配置无效");
  }
  const accountSettings = {};
  for (const id of taskSnapshot.selectedTokens) {
    const settings = loadSettings(id);
    if (!settings) throw new Error("无法读取账号的每日任务设置");
    accountSettings[id] = snapshotScheduledValue(settings);
  }
  return scheduledQueue.enqueue({
    task: taskSnapshot,
    scheduledTime,
    accounts: [...taskSnapshot.selectedTokens],
    accountSettings,
    batchSettings: snapshotScheduledValue(batchSettings),
    currentSettings: snapshotScheduledValue(currentSettings),
    helperSettings: snapshotScheduledValue(helperSettings),
    weirdTowerMaxClimb: weirdTowerMaxClimb.value,
    recipientInfo: snapshotScheduledValue(recipientInfo.value),
    giftQuantity: giftQuantity.value,
  });
};

// 注: boxTypeOptions, fishTypeOptions 已从 @/utils/batch 导入

const openHelperModal = (type) => {
  helperType.value = type;
  showHelperModal.value = true;
};

// 批量功法残卷赠送相关方法
const clearRecipientError = () => {
  recipientIdError.value = "";
};

// 头像处理方法
const handleAvatarLoad = () => {
  isAvatarLoading.value = false;
  avatarLoadError.value = false;
};

const handleAvatarError = () => {
  isAvatarLoading.value = false;
  avatarLoadError.value = true;
};

const resetAvatarState = () => {
  isAvatarLoading.value = true;
  avatarLoadError.value = false;
};

const queryRecipientInfo = async () => {
  // 1. 输入验证
  if (!recipientIdInput.value || recipientIdInput.value === "") {
    recipientIdError.value = "请输入接收者ID";
    return;
  }

  const recipientId = Number(recipientIdInput.value);
  if (!Number.isInteger(recipientId) || recipientId <= 0) {
    recipientIdError.value = "请输入有效的数字ID";
    return;
  }

  // 2. 检查选中账号
  if (selectedTokens.value.length === 0) {
    recipientIdError.value = "请先选择要操作的角色";
    return;
  }

  // 3. 初始化状态
  isQueryingRecipient.value = true;
  recipientIdError.value = "";
  recipientInfo.value = null;
  // 重置头像状态
  resetAvatarState();

  const firstTokenId = selectedTokens.value[0];
  const token = tokens.value.find((t) => t.id === firstTokenId);

  // 记录开始查询
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始查询接收者信息: 使用账号 ${token.name} (ID: ${firstTokenId}) ===`,
    type: "info",
  });

  try {
    // 确保WebSocket连接
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在建立WebSocket连接...`,
      type: "info",
    });

    await withManagedConnection(
      {
        tokenId: firstTokenId,
        tokenName: token.name,
        ensureConnection,
        releaseConnectionSlot,
        connectionQueue,
        batchSettings: runtimeBatchSettings,
        tokenStore,
        shouldStop,
        addLog,
        logOnClose: true,
      },
      async () => {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `WebSocket连接成功`,
          type: "success",
        });

        // 发送查询命令
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `正在发送查询命令，接收者ID: ${recipientId}`,
          type: "info",
        });

        // 延长超时时间到10秒，确保有足够时间处理
        const resp = await tokenStore.sendMessageWithPromise(
          firstTokenId,
          "rank_getroleinfo",
          {
            bottleType: 0,
            includeBottleTeam: false,
            isSearch: false,
            roleId: recipientId,
          },
          10000,
        );

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `查询命令发送成功，正在处理响应...`,
          type: "info",
        });

        // 处理查询结果
        console.log("rank_getroleinfo 响应结果:", resp);

        // 兼容不同的响应结构
        const roleData = resp?.role || resp?.roleInfo;

        if (roleData) {
          // 构建完整的角色信息，移除等级和VIP字段
          recipientInfo.value = {
            roleId: roleData.roleId || roleData.role?.roleId,
            name: roleData.name || roleData.role?.name,
            // 添加头像URL
            avatarUrl:
              resp?.roleInfo?.headImg ||
              roleData?.headImg ||
              roleData?.role?.headImg ||
              "",
            // 战力转换为亿为单位
            power: (function (p) {
              const billion = 100000000;
              return (p / billion).toFixed(2);
            })(roleData.power || roleData.role?.power || 0),
            powerUnit: "亿",
            // 扩展更多角色信息
            serverName: roleData.serverName || roleData.role?.serverName || "",
            legionName: resp?.legionInfo?.name || "",
            legionId: resp?.legionInfo?.id || 0,
          };

          // 格式化角色名，处理特殊字符
          const displayName = recipientInfo.value.name || "未知角色";

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 查询成功: 找到角色 ${displayName} (ID: ${recipientInfo.value.roleId})，战力: ${recipientInfo.value.power}${recipientInfo.value.powerUnit} ===`,
            type: "success",
          });

          message.success("查询成功");
        } else {
          const errorMsg = "未找到该角色信息";
          recipientIdError.value = errorMsg;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 查询失败: ${errorMsg} ===`,
            type: "error",
          });

          message.error(errorMsg);
        }
      },
    );
  } catch (error) {
    // 详细的错误处理
    console.error("查询接收者信息失败:", error);

    let errorMsg = "查询失败";
    let logType = "error";

    // 根据错误类型提供更友好的错误信息
    if (error.message.includes("连接失败")) {
      errorMsg = "WebSocket连接失败，请检查网络或账号状态";
    } else if (
      error.message.includes("timeout") ||
      error.message.includes("超时")
    ) {
      errorMsg = "查询超时，请稍后重试";
      logType = "warning";
    } else if (error.message.includes("200160")) {
      errorMsg = "功法系统未开启";
    } else {
      errorMsg = `查询失败: ${error.message}`;
    }

    recipientIdError.value = errorMsg;

    // 记录错误日志
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== ${errorMsg} ===`,
      type: logType,
    });

    // 显示用户友好的错误提示
    message.error(errorMsg);
  } finally {
    isQueryingRecipient.value = false;

    // 记录查询完成
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 查询操作完成 ===`,
      type: "info",
    });
  }
};

const confirmLegacyGift = async () => {
  if (!recipientIdInput.value || !recipientInfo.value) {
    message.error("请先查询并确认接收者信息");
    return;
  }

  if (!securityPassword.value) {
    message.error("请输入安全密码");
    return;
  }

  // 调用增强版批量赠送功能
  await batchLegacyGiftSendEnhanced();

  // 关闭模态框
  showLegacyGiftModal.value = false;
  // 清空安全密码
  securityPassword.value = "";
};

const executeHelper = () => {
  if (helperType.value !== "pointsBox") {
    if (helperSettings.count % 10 !== 0 || helperSettings.count < 10) {
      message.warning("消耗数量必须是10的整数倍，最小为10");
      return;
    }
  }
  showHelperModal.value = false;
  if (helperType.value === "box") {
    batchOpenBox();
  } else if (helperType.value === "fish") {
    batchFish();
  } else if (helperType.value === "recruit") {
    batchRecruit();
  } else if (helperType.value === "pointsBox") {
    batchOpenBoxByPoints();
  }
};

const executeHelperFromModal = (payload) => {
  Object.assign(helperSettings, payload);
  executeHelper();
};

const openRedeemCodeModal = () => {
  loadBatchSettings();
  batchSettings.cdkCodes = batchSettings.cdkCodes || "";
  batchSettings.cdkPlatformType = batchSettings.cdkPlatformType || "h5";
  showRedeemCodeModal.value = true;
};

const saveRedeemCodeConfig = () => {
  batchSettings.cdkCodes = batchSettings.cdkCodes || "";
  batchSettings.cdkPlatformType = batchSettings.cdkPlatformType || "h5";
  localStorage.setItem("batchSettings", JSON.stringify(batchSettings));
  message.success("兑换码配置已保存");
};

const executeRedeemCodes = async () => {
  if (!batchSettings.cdkCodes?.trim()) {
    message.error("请先填写兑换码");
    return;
  }

  saveRedeemCodeConfig();
  showRedeemCodeModal.value = false;
  await batchRedeemCodes();
};

// Dream Buy Modal Logic
const showDreamBuyModal = ref(false);
const dreamBuyList = ref([]);

// Black Market Purchase Modal Logic
const showBlackMarketPurchaseModal = ref(false);
const blackMarketPurchaseList = ref(createDefaultBlackMarketPurchaseList());

const openBlackMarketPurchaseModal = () => {
  blackMarketPurchaseList.value = normalizeBlackMarketPurchaseList(
    batchSettings.blackMarketPurchaseList?.length
      ? batchSettings.blackMarketPurchaseList
      : createDefaultBlackMarketPurchaseList(),
  ).map((item) => ({ ...item }));

  showBlackMarketPurchaseModal.value = true;
};

const addBlackMarketPurchaseItem = () => {
  blackMarketPurchaseList.value.push(createBlackMarketPurchaseEntry());
};

const applyBlackMarketCatalogItem = (index, itemId) => {
  blackMarketPurchaseList.value[index] = {
    ...blackMarketPurchaseList.value[index],
    ...createBlackMarketPurchaseEntry(itemId),
  };
};

const updateBlackMarketPurchaseItem = (index, patch) => {
  blackMarketPurchaseList.value[index] = {
    ...blackMarketPurchaseList.value[index],
    ...patch,
  };
};

const removeBlackMarketPurchaseItem = (index) => {
  blackMarketPurchaseList.value.splice(index, 1);
};

const resetBlackMarketPurchaseList = () => {
  blackMarketPurchaseList.value = createDefaultBlackMarketPurchaseList();
};

const saveBlackMarketPurchaseConfig = () => {
  const normalized = normalizeBlackMarketPurchaseList(
    blackMarketPurchaseList.value,
  );

  if (normalized.length === 0) {
    message.error("请至少配置一项黑市采购条目");
    return;
  }

  batchSettings.blackMarketPurchaseList = normalized;
  saveBatchSettings();

  showBlackMarketPurchaseModal.value = false;
  message.success("黑市采购清单已保存");
};

const openDreamBuyModal = () => {
  // Load saved settings
  dreamBuyList.value = batchSettings.dreamPurchaseList || [];
  showDreamBuyModal.value = true;
};

const toggleDreamItem = (itemKey, checked) => {
  if (checked) {
    if (!dreamBuyList.value.includes(itemKey)) {
      dreamBuyList.value.push(itemKey);
    }
  } else {
    dreamBuyList.value = dreamBuyList.value.filter((k) => k !== itemKey);
  }
};

const saveDreamBuyConfig = () => {
  // Save settings
  batchSettings.dreamPurchaseList = [...dreamBuyList.value];
  saveBatchSettings();

  showDreamBuyModal.value = false;
  message.success("梦境购买配置已保存");
};

const selectGoldItems = () => {
  const newSelection = new Set(dreamBuyList.value);

  for (const merchantId in goldItemsConfig) {
    const items = goldItemsConfig[merchantId];
    items.forEach((index) => {
      newSelection.add(`${merchantId}-${index}`);
    });
  }

  dreamBuyList.value = Array.from(newSelection);
};

const selectAllItems = () => {
  const newSelection = new Set(dreamBuyList.value);

  for (const merchantId in merchantConfig) {
    const items = merchantConfig[merchantId].items;
    items.forEach((_, index) => {
      newSelection.add(`${merchantId}-${index}`);
    });
  }

  dreamBuyList.value = Array.from(newSelection);
};

const clearAllItems = () => {
  dreamBuyList.value = [];
};

// 注: formationOptions, bossTimesOptions 已从 @/utils/batch 导入

const loadSettings = (tokenId) => {
  try {
    const token = tokens.value.find((entry) => entry.id === tokenId) || {
      id: tokenId,
    };
    const saved = readDailyTaskSettingsForExecution(token, tokens.value);
    const defaultSettings = { ...DAILY_TASK_DEFAULTS, towerFormation: 1 };
    return saved ? { ...defaultSettings, ...saved } : defaultSettings;
  } catch (error) {
    console.error("Failed to load settings:", error);
    return null;
  }
};

const openSettings = (token) => {
  currentSettingsTokenId.value = token.id;
  currentSettingsTokenName.value = token.name;
  const saved = loadSettings(token.id);
  settingsNeedRepair.value = !saved;
  if (!saved) {
    Object.assign(currentSettings, {
      ...SAFE_DAILY_TASK_DEFAULTS,
      towerFormation: 1,
    });
    message.warning(
      "账号设置损坏或冲突，保存后将重置异常设置；付费选项已先关闭",
    );
  } else Object.assign(currentSettings, saved);
  showSettingsModal.value = true;
};

const saveSettings = () => {
  if (currentSettingsTokenId.value) {
    const token = tokens.value.find(
      (entry) => entry.id === currentSettingsTokenId.value,
    ) || { id: currentSettingsTokenId.value };
    try {
      if (settingsNeedRepair.value) resetDailyTaskSettings(token);
      writeDailyTaskSettings(token, currentSettings);
      settingsNeedRepair.value = false;
      message.success(`已保存 ${currentSettingsTokenName.value} 的设置`);
      showSettingsModal.value = false;
    } catch (error) {
      message.error(error.message || "设置保存失败，请检查浏览器存储权限");
    }
  }
};

const saveSettingsFromModal = (payload) => {
  Object.assign(currentSettings, payload);
  saveSettings();
};

// Task Template Functions

const loadTaskTemplates = () => {
  const templates = localStorage.getItem("task-templates");
  const parsed = templates ? JSON.parse(templates) : [];
  taskTemplates.value = parsed;
  return parsed;
};

const openApplyTemplateModal = () => {
  // 加载模板列表
  loadTaskTemplates();
  // 重置选择
  selectedTemplateId.value = null;
  selectedTokensForApply.value = [];
  showApplyTemplateModal.value = true;
};

const handleSelectAllForApply = (checked) => {
  if (checked) {
    selectedTokensForApply.value = sortedTokens.value.map((token) => token.id);
  } else {
    selectedTokensForApply.value = [];
  }
};

const applyTemplate = () => {
  if (!selectedTemplateId.value || selectedTokensForApply.value.length === 0) {
    message.error("请选择模板和要应用的账号");
    return;
  }

  // 找到选中的模板
  const templates = loadTaskTemplates();
  const template = templates.find((t) => t.id === selectedTemplateId.value);
  if (!template) {
    message.error("模板不存在");
    return;
  }

  // 应用模板到选中的账号
  let successCount = 0;
  selectedTokensForApply.value.forEach((tokenId) => {
    // 保存账号设置时同时保存模板ID
    const accountSettings = {
      ...template.settings,
      templateId: template.id, // 记录模板ID
    };
    const token = tokens.value.find((entry) => entry.id === tokenId) || {
      id: tokenId,
    };
    writeDailyTaskSettings(token, accountSettings);
    successCount++;
  });

  message.success(`已成功应用模板到 ${successCount} 个账号`);
  showApplyTemplateModal.value = false;
};

// Template Manager Functions
const openTemplateManagerModal = () => {
  // 加载模板列表
  loadTaskTemplates();
  showTemplateManagerModal.value = true;
};

const openEditTemplateModal = (template) => {
  // 加载模板数据到当前编辑模板
  currentTemplateId.value = template.id;
  currentTemplateName.value = template.name;
  Object.assign(currentTemplate, template.settings);
  showTaskTemplateModal.value = true;
};

const updateTaskTemplate = () => {
  if (!currentTemplateName.value.trim()) {
    message.error("请输入模板名称");
    return;
  }

  // 找到并更新模板
  const templates = loadTaskTemplates();
  const templateIndex = templates.findIndex(
    (t) => t.id === currentTemplateId.value,
  );
  if (templateIndex === -1) {
    message.error("模板不存在");
    return;
  }

  // 更新模板
  templates[templateIndex] = {
    ...templates[templateIndex],
    name: currentTemplateName.value.trim(),
    settings: {
      ...currentTemplate,
    },
    updatedAt: new Date().toISOString(),
  };

  // 保存模板到localStorage
  localStorage.setItem("task-templates", JSON.stringify(templates));

  // 更新模板列表
  taskTemplates.value = templates;

  message.success(`已更新模板 "${templates[templateIndex].name}"`);
  showTaskTemplateModal.value = false;

  // 重置编辑状态
  resetTemplateForm();
};

const deleteTaskTemplate = (templateId) => {
  // 确认删除
  // eslint-disable-next-line no-alert -- Preserve the existing native notification or confirmation flow.
  if (confirm("确定要删除这个模板吗？")) {
    // 找到并删除模板
    const templates = loadTaskTemplates();
    const filteredTemplates = templates.filter((t) => t.id !== templateId);

    // 保存模板到localStorage
    localStorage.setItem("task-templates", JSON.stringify(filteredTemplates));

    // 更新模板列表
    taskTemplates.value = filteredTemplates;

    message.success("模板已删除");
  }
};

const resetTemplateForm = () => {
  currentTemplateId.value = null;
  currentTemplateName.value = "";
  Object.assign(currentTemplate, {
    arenaFormation: 1,
    towerFormation: 1,
    bossFormation: 1,
    bossTimes: 2,
    claimBottle: true,
    payRecruit: true,
    openBox: true,
    arenaEnable: true,
    claimHangUp: true,
    claimEmail: true,
    blackMarketPurchase: true,
  });
};

const openAccountTemplateModal = () => {
  // 加载账号模板引用关系
  loadAccountTemplateReferences();
  showAccountTemplateModal.value = true;
};

const loadAccountTemplateReferences = () => {
  const templates = loadTaskTemplates();
  const references = [];

  // 遍历所有账号，获取其模板引用
  sortedTokens.value.forEach((token) => {
    const settingsStr = localStorage.getItem(`daily-settings:${token.id}`);
    if (settingsStr) {
      try {
        const settings = JSON.parse(settingsStr);
        const templateId = settings.templateId;
        const template = templates.find((t) => t.id === templateId);

        references.push({
          tokenId: token.id,
          tokenName: token.name,
          templateId,
          templateName: template ? template.name : "未引用模板",
        });
      } catch (e) {
        console.error(`解析账号 ${token.name} 的设置失败:`, e);
      }
    } else {
      // 没有设置的账号
      references.push({
        tokenId: token.id,
        tokenName: token.name,
        templateId: null,
        templateName: "未引用模板",
      });
    }
  });

  accountTemplateReferences.value = references;
  filteredAccountTemplates.value = references;
};

const filterAccountTemplates = () => {
  if (!selectedTemplateForFilter.value) {
    filteredAccountTemplates.value = accountTemplateReferences.value;
  } else {
    filteredAccountTemplates.value = accountTemplateReferences.value.filter(
      (item) => item.templateId === selectedTemplateForFilter.value,
    );
  }
};

const openNewTemplateModal = () => {
  // 重置表单，准备创建新模板
  resetTemplateForm();
  showTaskTemplateModal.value = true;
};

// 修改saveTaskTemplate函数，支持新增和编辑
const saveTaskTemplate = () => {
  if (!currentTemplateName.value.trim()) {
    message.error("请输入模板名称");
    return;
  }

  const templates = loadTaskTemplates();

  if (currentTemplateId.value) {
    // 更新现有模板
    updateTaskTemplate();
  } else {
    // 创建新模板
    const template = {
      id: Date.now().toString(),
      name: currentTemplateName.value.trim(),
      settings: {
        ...currentTemplate,
      },
      createdAt: new Date().toISOString(),
    };

    // 添加新模板
    templates.push(template);
    localStorage.setItem("task-templates", JSON.stringify(templates));

    // 更新模板列表
    taskTemplates.value = templates;

    message.success(`已保存模板 "${template.name}"`);
    showTaskTemplateModal.value = false;

    // 重置表单
    resetTemplateForm();
  }
};

const saveTaskTemplateFromModal = ({ name, settings }) => {
  currentTemplateName.value = name;
  Object.assign(currentTemplate, settings);
  saveTaskTemplate();
};

const currentRunningTokenId = ref(null);
const currentProgress = ref(0);
const logs = ref([]);
const logContainer = ref(null);
const autoScrollLog = ref(true);
const filterErrorsOnly = ref(false);
const errorCount = computed(() => {
  return logs.value.filter((log) => log.type === "error").length;
});

const filteredLogs = computed(() => {
  if (filterErrorsOnly.value) {
    return logs.value.filter((log) => log.type === "error");
  }
  return logs.value;
});

const currentRunningTokenName = computed(() => {
  const t = tokens.value.find((x) => x.id === currentRunningTokenId.value);
  return t ? t.name : "";
});

// Selection logic
const isAllSelected = computed(
  () =>
    selectedTokens.value.length === tokens.value.length &&
    tokens.value.length > 0,
);
const isIndeterminate = computed(
  () =>
    selectedTokens.value.length > 0 &&
    selectedTokens.value.length < tokens.value.length,
);

const handleSelectAll = (checked) => {
  if (checked) {
    selectedTokens.value = tokens.value.map((t) => t.id);
  } else {
    selectedTokens.value = [];
  }
};

const getStatusType = (tokenId) => {
  const status = tokenStatus.value[tokenId];
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "info";
  return "default";
};

const getStatusText = (tokenId) => {
  const status = tokenStatus.value[tokenId];
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "skipped") return "已跳过";
  if (status === "stopped") return "已停止";
  if (status === "pending") return "待继续";
  if (status === "running") return "执行中";
  return "等待中";
};

// =====================
// Token分组管理相关方法
// =====================

// 注: pickArenaTargetId, FISH_TARGET, ARENA_TARGET, getTodayStartSec, isTodayAvailable, calculateMonthProgress 已从 @/utils/batch 导入

const addLog = (log) => {
  // 添加日志数据到数组
  logs.value.push(log);

  // 限制logs数组大小，防止内存占用过大
  const maxLogEntries = batchSettings.maxLogEntries || 1000;
  if (logs.value.length > maxLogEntries) {
    logs.value = logs.value.slice(-maxLogEntries);
  }

  // 尝试DOM操作，但不依赖nextTick确保日志显示
  // 在后台运行时，浏览器可能会限制DOM操作
  try {
    if (logContainer.value && autoScrollLog.value) {
      // 直接尝试滚动，不使用nextTick
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  } catch (error) {
    // 忽略DOM操作错误，确保日志数据仍然被记录
    console.warn("Failed to scroll log container:", error);
  }

  // 同时使用nextTick作为后备，确保在页面回到前台时能正确滚动
  nextTick(() => {
    try {
      if (logContainer.value && autoScrollLog.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }
    } catch (error) {
      // 忽略错误
    }
  });
};

watch(autoScrollLog, (newValue) => {
  if (newValue && logContainer.value) {
    nextTick(() => {
      try {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      } catch (error) {
        // 忽略DOM操作错误
        console.warn("Failed to scroll log container:", error);
      }
    });
  }
});

const copyLogs = () => {
  if (logs.value.length === 0) {
    message.warning("没有可复制的日志");
    return;
  }
  const logText = logs.value
    .map((log) => `${log.time} ${log.message}`)
    .join("\n");
  navigator.clipboard
    .writeText(logText)
    .then(() => {
      message.success("日志已复制到剪贴板");
    })
    .catch((err) => {
      message.error(`复制日志失败: ${err.message}`);
    });
};

const clearLogs = () => {
  logs.value = [];
  message.success("日志已清空");
};

const waitForConnection = async (
  tokenId,
  timeout = runtimeBatchSettings.connectionTimeout,
) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (shouldStop.value) return false;
    const status = tokenStore.getWebSocketStatus(tokenId);
    if (status === "connected") return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

// 全局连接队列控制 - 限制并发连接数
const connectionQueue = { active: 0 };

const waitForConnectionSlot = async () => {
  while (connectionQueue.active >= runtimeBatchSettings.maxActive) {
    if (shouldStop.value) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (shouldStop.value) {
    const error = new Error("批量任务已停止，取消等待连接槽位");
    error.interrupted = true;
    throw error;
  }
  connectionQueue.active++;
};

const releaseConnectionSlot = () => {
  if (connectionQueue.active > 0) {
    connectionQueue.active--;
  }
};

/**
 * Establish a connection and report whether this caller owns a queue slot.
 * @param {string} tokenId Account identity.
 * @param {number} maxRetries Whether connection retry is allowed.
 * @param {Function|null} onSlotChange Optional ownership notification.
 * @param {Function|null} onClientCreated Optional exact created-client notification.
 * @param {Function|null} onConnectionReady Optional guard before initialization.
 * @param {object} options Connection options; `skipInitialization` is read-only.
 * @returns {Promise<boolean>} True after connection initialization.
 */
const ensureConnection = async (
  tokenId,
  maxRetries = 2,
  onSlotChange = null,
  onClientCreated = null,
  onConnectionReady = null,
  options = {},
) => {
  const latestToken = tokens.value.find((t) => t.id === tokenId);
  if (!latestToken) {
    throw new Error(`Token not found: ${tokenId}`);
  }

  const status = tokenStore.getWebSocketStatus(tokenId);
  let connected = status === "connected";

  if (!connected) {
    // 等待连接槽位，限制并发连接数
    await waitForConnectionSlot();
    onSlotChange?.(true);
    onClientCreated?.(null, null);

    let slotReleased = false;
    const releaseOwnedSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      releaseConnectionSlot();
      onSlotChange?.(false);
    };

    let createdSocket = null;
    let createdClient = null;
    try {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `正在连接... (队列: ${connectionQueue.active}/${runtimeBatchSettings.maxActive})`,
        type: "info",
      });

      createdClient = await tokenStore.createWebSocketConnection(
        tokenId,
        latestToken.token,
        latestToken.wsUrl,
      );
      createdSocket = toRaw(createdClient?.socket);
      onClientCreated?.(createdClient, createdSocket);
      connected =
        createdClient || !onClientCreated
          ? await waitForConnection(tokenId)
          : false;

      if (!connected && maxRetries > 0 && !shouldStop.value) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `连接超时，尝试重连...`,
          type: "warning",
        });

        const current = tokenStore.wsConnections?.[tokenId]?.client;
        if (onClientCreated) {
          if (
            current &&
            (!createdClient ||
              toRaw(current) !== toRaw(createdClient) ||
              (createdSocket && toRaw(current.socket) !== createdSocket))
          ) {
            const error = new Error("连接已被替换，停止批量任务");
            error.interrupted = true;
            throw error;
          }
          if (
            createdClient &&
            current &&
            toRaw(current) === toRaw(createdClient) &&
            (!createdSocket || toRaw(current.socket) === createdSocket)
          ) {
            closeOwnedConnection(
              tokenStore,
              tokenId,
              createdClient,
              createdSocket ?? null,
            );
          }
        } else {
          tokenStore.closeWebSocketConnection(tokenId);
        }
        await new Promise((r) =>
          setTimeout(r, runtimeBatchSettings.reconnectDelay),
        );

        if (!shouldStop.value) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `正在重连...`,
            type: "info",
          });

          const refreshedToken = tokens.value.find((t) => t.id === tokenId);
          if (!refreshedToken) {
            throw new Error(`Token not found: ${tokenId}`);
          }
          createdClient = await tokenStore.createWebSocketConnection(
            tokenId,
            refreshedToken.token,
            refreshedToken.wsUrl,
          );
          createdSocket = toRaw(createdClient?.socket);
          onClientCreated?.(createdClient, createdSocket);

          connected =
            createdClient || !onClientCreated
              ? await waitForConnection(tokenId)
              : false;
        }
      }

      if (!connected) {
        const current = tokenStore.wsConnections?.[tokenId]?.client;
        if (
          !onClientCreated ||
          (createdClient &&
            current &&
            toRaw(createdClient) === toRaw(current) &&
            (!createdSocket || toRaw(current.socket) === createdSocket))
        ) {
          if (onClientCreated) {
            closeOwnedConnection(
              tokenStore,
              tokenId,
              createdClient,
              createdSocket ?? null,
            );
          } else {
            tokenStore.closeWebSocketConnection(tokenId);
          }
        }
        const error = new Error(
          shouldStop.value ? "任务已停止" : "连接失败 (重试后仍超时)",
        );
        if (shouldStop.value) {
          error.interrupted = true;
        }
        throw error;
      }
    } catch (err) {
      releaseOwnedSlot();
      throw err;
    }
  }

  // 连接成功，槽位保持占用，直到任务完成后手动释放
  onConnectionReady?.();
  if (options.skipInitialization) return true;

  // Initialize Game Data (Critical for Battle Version and Session)
  try {
    // Fetch Role Info first (Standard flow)
    await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
      5000,
    );
    onConnectionReady?.();

    // Fetch Battle Version
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "fight_startlevel",
      {},
      5000,
    );
    onConnectionReady?.();
    if (res?.battleData?.version) {
      tokenStore.setBattleVersion(res.battleData.version, tokenId);
    }
  } catch (e) {
    if (e?.interrupted) throw e;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `初始化数据失败: ${e.message}`,
      type: "warning",
    });
  }

  return true;
};

const readScheduledSettings = (name, fallback) =>
  new Proxy(fallback, {
    get(target, key, receiver) {
      const snapshot = activeScheduledRun.value?.[name];
      return snapshot && Object.hasOwn(snapshot, key)
        ? snapshot[key]
        : Reflect.get(target, key, receiver);
    },
  });

const createTaskDeps = () => ({
  selectedTokens: executionTokens,
  tokens,
  tokenStatus,
  isRunning,
  shouldStop,
  ensureConnection,
  releaseConnectionSlot,
  connectionQueue,
  batchSettings: runtimeBatchSettings,
  tokenStore,
  addLog,
  message,
  currentRunningTokenId,
  // 延迟配置
  delayConfig: {
    get command() {
      return runtimeBatchSettings.commandDelay;
    },
    get task() {
      return runtimeBatchSettings.taskDelay;
    },
    get action() {
      return runtimeBatchSettings.actionDelay;
    },
    get battle() {
      return runtimeBatchSettings.battleDelay;
    },
    get refresh() {
      return runtimeBatchSettings.refreshDelay;
    },
    get long() {
      return runtimeBatchSettings.longDelay;
    },
  },
  // 其他特定依赖
  logs,
  logContainer,
  autoScrollLog,
  nextTick,
  // 设置相关
  currentSettings: readScheduledSettings("currentSettings", currentSettings),
  helperSettings: readScheduledSettings("helperSettings", helperSettings),
  weirdTowerMaxClimb: computed(
    () =>
      activeScheduledRun.value?.weirdTowerMaxClimb ?? weirdTowerMaxClimb.value,
  ),
  // 功法赠送相关
  recipientIdInput,
  recipientInfo: computed(() =>
    activeScheduledRun.value
      ? activeScheduledRun.value.recipientInfo
      : recipientInfo.value,
  ),
  securityPassword,
  giftQuantity: computed(
    () => activeScheduledRun.value?.giftQuantity ?? giftQuantity.value,
  ),
  // 竞技场相关辅助函数
  pickArenaTargetId,
  getTodayStartSec,
  isTodayAvailable,
  calculateMonthProgress,
  // 配置加载函数
  loadSettings: (id) =>
    activeScheduledRun.value?.accountSettings[id] ?? loadSettings(id),
});

// 初始化任务模块
const tasksHangUp = createTasksHangUp(createTaskDeps());
const {
  claimHangUpRewards,
  batchAddHangUpTime,
  batchStudy,
  batchclubsign,
  batchApplyLegion,
  batchWarGuessCheer,
  queryLegionById,
} = tasksHangUp;

const tasksBottle = createTasksBottle(createTaskDeps());
const { resetBottles, batchlingguanzi } = tasksBottle;

const tasksTower = createTasksTower(createTaskDeps());
const {
  climbTower,
  climbWeirdTower,
  batchClaimFreeEnergy,
  skinChallenge,
  batchUseItems,
  batchMergeItems,
} = tasksTower;

const tasksItem = createTasksItem(createTaskDeps());
const {
  batchOpenBox,
  batchOpenBoxByPoints,
  batchClaimBoxPointReward,
  batchFish,
  batchRecruit,
  batchRedeemCodes,
  batchHeroUpgrade,
  batchBookUpgrade,
  batchClaimStarRewards,
  batchClaimPeachTasks,
  batchGenieSweep,
} = tasksItem;

const tasksDungeon = createTasksDungeon(createTaskDeps());
const { batchbaoku13, batchbaoku45, batchmengjing, batchBuyDreamItems } =
  tasksDungeon;

const tasksArena = createTasksArena(createTaskDeps());
const { batcharenafight, batchTopUpFish, batchTopUpArena } = tasksArena;

const tasksStore = createTasksStore(createTaskDeps());
const {
  legion_storebuygoods,
  legionStoreBuySkinCoins,
  store_syncpurchaseconfig,
  store_purchase,
  collection_claimfreereward,
} = tasksStore;

const tasksLegacy = createTasksLegacy(createTaskDeps());
const { batchLegacyClaim, batchLegacyGiftSendEnhanced } = tasksLegacy;

const tasksFootball = createTasksFootball(createTaskDeps());
const { batchFootballBet } = tasksFootball;

const tasksApex = createTasksApex(createTaskDeps());
const { batchApexClaim, batchApexGuess } = tasksApex;

const tasksCampChallenge = createTasksCampChallenge(createTaskDeps());
const { batchCampChallenge, batchCampChallengePet, batchCampClaimTasks } =
  tasksCampChallenge;
const tasksXuanwuBlessing = createTasksXuanwuBlessing(createTaskDeps());
const { batchXuanwuBlessing } = tasksXuanwuBlessing;

// 营地挑战模式选择
const campChallengeMode = ref("pet");
const campChallengeModeOptions = [
  { label: "挑战宠物", value: "pet" },
  { label: "随机挑战人员（主线阵容）", value: "random" },
  { label: "领取任务奖励", value: "claim" },
];
const campChallengeModeLabel = computed(() => {
  return (
    campChallengeModeOptions.find((o) => o.value === campChallengeMode.value)
      ?.label || ""
  );
});
const onCampChallengeModeChange = async (val) => {
  campChallengeMode.value = val;
  if (val === "pet") {
    await batchCampChallengePet();
  } else if (val === "claim") {
    await batchCampClaimTasks();
  } else {
    await batchCampChallenge();
  }
};

// 盐杯竞猜 pick 选择
const footballPick = ref(3);
const footballPickOptions = [
  { label: "主胜", value: 1 },
  { label: "平局", value: 2 },
  { label: "客胜", value: 3 },
];
const footballPickLabel = computed(() => {
  return (
    footballPickOptions.find((o) => o.value === footballPick.value)?.label || ""
  );
});
const onFootballPickChange = async (val) => {
  footballPick.value = val;
  await batchFootballBet(val);
};

const startBatch = async () => {
  const tokenIds = [...executionTokens.value];
  if (isRunning.value || tokenIds.length === 0) return;

  isRunning.value = true;
  shouldStop.value = false;

  // Reset status
  tokenIds.forEach((id) => {
    tokenStatus.value[id] = "waiting";
  });

  // 并行执行任务，但通过connectionQueue限制并发连接数
  const taskPromises = tokenIds.map(async (tokenId) => {
    if (shouldStop.value) return;

    tokenStatus.value[tokenId] = "running";

    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      tokenStatus.value[tokenId] = "failed";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: "账号已移除，跳过执行",
        type: "error",
      });
      return;
    }
    let ownsSlot = false;
    let clientTrackingProvided = false;
    let ownedClient = null;
    let ownedSocket = null;
    let runClient =
      tokenStore.getWebSocketStatus(tokenId) === "connected"
        ? toRaw(tokenStore.wsConnections?.[tokenId]?.client)
        : null;
    let runSocket = runClient ? toRaw(runClient.socket) : null;
    let connectionInvalidated = false;
    let stopConnectionWatch = null;
    const assertRunConnection = () => {
      const current = toRaw(tokenStore.wsConnections?.[tokenId]?.client);
      const socket = toRaw(tokenStore.wsConnections?.[tokenId]?.client?.socket);
      if (
        shouldStop.value ||
        connectionInvalidated ||
        (ownsSlot && (!ownedClient || current !== ownedClient)) ||
        (clientTrackingProvided && (!ownedClient || current !== ownedClient)) ||
        tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
        !current ||
        !socket ||
        (runClient && current !== runClient) ||
        (runSocket && socket !== runSocket)
      ) {
        const error = new Error("批量任务已停止或账号连接已变化");
        error.interrupted = true;
        throw error;
      }
      if (!runClient) runClient = current;
      if (!runSocket) runSocket = socket;
      if (ownedClient === current && !ownedSocket) ownedSocket = socket;
    };
    const watchRunConnection = () => {
      assertRunConnection();
      if (!stopConnectionWatch) {
        stopConnectionWatch = watch(
          () => [
            tokenStore.getWebSocketStatus(tokenId),
            toRaw(tokenStore.wsConnections?.[tokenId]?.client),
            toRaw(tokenStore.wsConnections?.[tokenId]?.client?.socket),
          ],
          ([status, client, socket]) => {
            if (
              status !== "connected" ||
              client !== runClient ||
              socket !== runSocket
            )
              connectionInvalidated = true;
          },
          { flush: "sync" },
        );
      }
    };
    try {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 开始执行: ${token.name} ===`,
        type: "info",
      });
      await ensureConnection(
        tokenId,
        2,
        (owned) => {
          ownsSlot = owned;
        },
        (client, socket) => {
          clientTrackingProvided = true;
          ownedClient = client ? toRaw(client) : null;
          ownedSocket = socket || null;
          if (ownedClient) runClient = ownedClient;
          if (ownedSocket) runSocket = ownedSocket;
        },
        watchRunConnection,
      );
      assertRunConnection();
      const runner = new DailyTaskRunner(
        tokenStore,
        {
          commandDelay: runtimeBatchSettings.commandDelay,
          taskDelay: runtimeBatchSettings.taskDelay,
        },
        {
          onDreamShopChecked: (details) => {
            assertRunConnection();
            return markDreamShopChecked(details);
          },
          runDreamShopPurchases: ({ tokenId: id, checkActive, sleep, log }) => {
            if (id !== tokenId) {
              const error = new Error("梦境购买账号已变化，停止执行");
              error.interrupted = true;
              throw error;
            }
            return runDailyDreamPurchase({
              accountId: id,
              isOpen: true,
              send: (command, params) => {
                assertRunConnection();
                return tokenStore.sendMessageWithPromise(
                  id,
                  command,
                  params,
                  15000,
                );
              },
              checkActive: () => {
                checkActive();
                assertRunConnection();
              },
              pause: sleep,
              onProgress: ({ confirmed, total }) =>
                log(`梦境商品：已确认购买 ${confirmed}/${total} 件`),
            });
          },
        },
      );
      const result = await runner.run(
        tokenId,
        {
          shouldStop: () =>
            shouldStop.value ||
            connectionInvalidated ||
            tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
            toRaw(tokenStore.wsConnections?.[tokenId]?.client) !== runClient ||
            toRaw(tokenStore.wsConnections?.[tokenId]?.client?.socket) !==
              runSocket,
          onLog: (log) =>
            addLog({ ...log, message: `${token.name}: ${log.message}` }),
          onProgress: (progress) =>
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name}: 服务器每日任务完成并领奖 ${progress}%`,
              type: "info",
            }),
        },
        activeScheduledRun.value?.accountSettings[tokenId] ?? null,
      );
      assertRunConnection();
      const needsAttention = Boolean(result.incomplete || result.failed);
      tokenStatus.value[tokenId] = needsAttention ? "pending" : "completed";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: needsAttention
          ? `=== ${token.name} 本轮结束，${result.incomplete || 0} 个步骤待继续，${result.failed || 0} 个步骤失败 ===`
          : `=== ${token.name} 执行完成 ===`,
        type: needsAttention ? "warning" : "success",
      });
    } catch (error) {
      tokenStatus.value[tokenId] = error.interrupted ? "stopped" : "failed";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name}: ${error.message}`,
        type: error.interrupted ? "warning" : "error",
      });
    } finally {
      stopConnectionWatch?.();
      if (ownsSlot) {
        try {
          const current = toRaw(tokenStore.wsConnections?.[tokenId]?.client);
          const socket = toRaw(
            tokenStore.wsConnections?.[tokenId]?.client?.socket,
          );
          if (
            ownedClient &&
            current === ownedClient &&
            (!ownedSocket || socket === ownedSocket)
          )
            closeOwnedConnection(tokenStore, tokenId, ownedClient, ownedSocket);
        } finally {
          releaseConnectionSlot();
        }
      }
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 连接清理结束  (队列: ${connectionQueue.active}/${runtimeBatchSettings.maxActive})`,
        type: "info",
      });
    }
  });

  try {
    await Promise.all(taskPromises);
  } finally {
    isRunning.value = false;
    currentRunningTokenId.value = null;
  }
  if (shouldStop.value)
    message.info("批量任务已停止，再次开始将按服务器任务列表补差");
  else if (
    tokenIds.some((id) =>
      ["failed", "pending", "stopped"].includes(tokenStatus.value[id]),
    )
  )
    message.warning("本轮结束，仍有未完成任务，可再次开始继续");
  else message.success("批量任务执行结束");
};

const stopBatch = () => {
  shouldStop.value = true;
  scheduledClaimGeneration++;
  abortWaitingScheduledClaims();
  scheduledQueue.cancelPending();
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "正在停止...",
    type: "warning",
  });
};
</script>

<style scoped>
.batch-daily-tasks {
  padding: 20px;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.main-layout {
  display: flex;
  gap: 20px;
  height: 100%;
  overflow: hidden;
}

.left-column {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding-right: 8px;
}

.page-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 20px;
}

.page-header-primary h2 {
  margin: 0 0 4px;
}

.page-header-primary p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.schedule-summary,
.schedule-actions,
.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.schedule-summary {
  justify-content: space-between;
  max-width: 100%;
  box-sizing: border-box;
  padding: 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.schedule-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  color: var(--text-primary);
  font-size: 13px;
}

.schedule-copy span {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.batch-more summary {
  width: fit-content;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.batch-more-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.batch-more summary:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}

:global(html[data-theme="dark"] .batch-daily-tasks .batch-more summary) {
  color: #bdc8ff;
}

:global(
  html[data-theme="dark"]
    .batch-daily-tasks
    .n-button--default-type.n-button--disabled
) {
  opacity: 0.7 !important;
}

.token-item {
  display: flex;
  align-items: center;
}

.token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}

.weird-tower-count-input {
  width: 86px;
  flex-shrink: 0;
}

.weird-tower-count-unit {
  display: inline-flex;
  align-items: center;
  height: 28px;
  color: var(--text-secondary);
  font-size: 14px;
}

/* Token分组管理样式 */
.group-selection-section {
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-light);
}

.group-tag {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  user-select: none;
  text-align: center;
  font-weight: 500;
}

.group-tag:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.group-tag-selected {
  color: white;
  font-weight: 600;
}

/* Responsive Design */
@media (max-width: 992px) {
  .batch-daily-tasks {
    height: auto;
    overflow: visible;
  }

  .main-layout {
    flex-direction: column;
    height: auto;
    overflow: visible;
  }

  .left-column {
    overflow-y: visible;
    padding-right: 0;
  }
}

@media (max-width: 768px) {
  .batch-daily-tasks {
    padding: 12px;
    height: auto;
    overflow: visible;
  }

  .main-layout {
    height: auto;
    overflow: visible;
    flex-direction: column;
  }

  .left-column {
    overflow: visible;
    padding-right: 0;
    flex: none;
    height: auto;
  }

  .page-header {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .page-header-primary {
    flex-direction: column;
    align-items: stretch !important;
    gap: 8px !important;
  }

  .page-header-primary h2 {
    margin: 0;
  }

  .token-list-card :deep(.n-grid) {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}
</style>
