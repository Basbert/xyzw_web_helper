import { DAILY_TASK_DEFAULTS } from "../dailyTaskSettings.js";

/** Batch setting keys allowed in config backup export and import. */
export const BACKUP_BATCH_SETTING_KEYS = [
  "boxCount",
  "fishCount",
  "recruitCount",
  "defaultBoxType",
  "defaultFishType",
  "blackMarketPurchaseList",
  "commandDelay",
  "taskDelay",
  "actionDelay",
  "battleDelay",
  "refreshDelay",
  "longDelay",
  "maxActive",
  "tokenListColumns",
];

const ALLOWED_BATCH_SETTING_SET = new Set(BACKUP_BATCH_SETTING_KEYS);
const SAFE_EXPORT_TOKEN_SETTING_KEYS = new Set([
  ...Object.keys(DAILY_TASK_DEFAULTS),
  "towerFormation",
  "freeGachaEnable",
]);

/** Build a sanitized settings backup or explicit full credential backup payload. */
export function buildConfigBackupData({
  mode = "settings",
  tokens = [],
  scheduledTasks = [],
  batchSettings = {},
  storage = globalThis.localStorage,
} = {}) {
  const validTokenIds = new Set(tokens.map((t) => t.id));

  const filteredScheduledTasks = scheduledTasks
    .map((task) => ({
      id: task.id,
      name: task.name,
      runType: task.runType,
      runTime: task.runTime,
      cronExpression: task.cronExpression,
      selectedTasks: task.selectedTasks,
      legionApplyTargetId: task.legionApplyTargetId,
      enabled: task.enabled,
      selectedTokens:
        task.selectedTokens?.filter((tokenId) => validTokenIds.has(tokenId)) ||
        [],
    }))
    .filter((task) => task.selectedTokens.length > 0);

  const tokenSettings = [];
  tokens.forEach((token) => {
    const raw = storage?.getItem?.(`daily-settings:${token.id}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      tokenSettings.push({
        tokenId: token.id,
        settings:
          mode === "full"
            ? parsed
            : Object.fromEntries(
                Object.entries(parsed).filter(([key]) =>
                  SAFE_EXPORT_TOKEN_SETTING_KEYS.has(key),
                ),
              ),
      });
    } catch (error) {
      console.warn(`Failed to parse settings for token ${token.id}`, error);
    }
  });

  const exportedBatchSettings = {};
  for (const key of BACKUP_BATCH_SETTING_KEYS) {
    exportedBatchSettings[key] = batchSettings[key];
  }

  return {
    version: "1.2",
    exportTime: new Date().toISOString(),
    tokens: tokens.map((t) =>
      mode === "full"
        ? {
            id: t.id,
            name: t.name,
            roleId: t.roleId,
            token: t.token,
            server: t.server,
            wsUrl: t.wsUrl,
            remark: t.remark,
            importMethod: t.importMethod,
            sourceUrl: t.sourceUrl,
            upgradedToPermanent: true,
            upgradedAt: t.upgradedAt,
            updatedAt: t.updatedAt,
          }
        : { id: t.id, name: t.name, roleId: t.roleId, server: t.server },
    ),
    scheduledTasks: filteredScheduledTasks,
    batchSettings: exportedBatchSettings,
    tokenSettings,
  };
}

/** Apply an imported backup payload onto accounts, scheduled tasks, and settings. */
export function applyConfigBackupData({
  importData,
  gameTokens,
  tokens = gameTokens,
  scheduledTasks,
  availableTasks = [],
  batchSettings,
  normalizeBlackMarketPurchaseList,
  createDefaultBlackMarketPurchaseList,
  canImportScheduledTasks = () => true,
  writeDailyTaskSettings,
  saveScheduledTasks = () => {},
  saveBatchSettings = () => {},
}) {
  if (
    !importData?.version ||
    !Array.isArray(importData.tokens) ||
    !Array.isArray(importData.scheduledTasks)
  ) {
    return { status: "invalid", error: "无效的配置文件格式" };
  }

  let importedTokens = 0;
  let importedTasks = 0;
  let skippedTasks = 0;
  let unmatchedReferences = 0;
  const accountMap = new Map();

  importData.tokens.forEach((token) => {
    const exists = gameTokens.find(
      (t) => (token.token && t.token === token.token) || t.id === token.id,
    );
    if (
      exists &&
      token.id &&
      (!token.roleId ||
        !exists.roleId ||
        String(token.roleId) === String(exists.roleId))
    ) {
      accountMap.set(token.id, exists.id);
    }
    if (!exists && token.token) {
      gameTokens.push({
        id:
          token.id ||
          `token_${Date.now()}${Math.random().toString(36).slice(2)}`,
        name: token.name || "",
        roleId: token.roleId || null,
        token: token.token,
        server: token.server || "",
        wsUrl: token.wsUrl || null,
        remark: token.remark || "",
        importMethod: "import",
        sourceUrl: token.sourceUrl || null,
        upgradedToPermanent: true,
        upgradedAt: token.upgradedAt || null,
        updatedAt: token.updatedAt || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      });
      importedTokens++;
      if (token.id) accountMap.set(token.id, token.id);
    }
  });

  importData.tokens.forEach((token) => {
    if (!token.id || accountMap.has(token.id) || !token.roleId) return;
    const matches = gameTokens.filter(
      (entry) =>
        entry.roleId &&
        String(entry.roleId) === String(token.roleId) &&
        (!token.server || !entry.server || token.server === entry.server),
    );
    if (matches.length === 1) accountMap.set(token.id, matches[0].id);
  });

  let scheduledTasksSkippedByStaleConfig = false;
  if (Array.isArray(importData.scheduledTasks)) {
    if (canImportScheduledTasks()) {
      importData.scheduledTasks.forEach((task) => {
        const exists = scheduledTasks.some((t) => t.id === task.id);
        if (
          !exists &&
          task.id &&
          Array.isArray(task.selectedTokens) &&
          Array.isArray(task.selectedTasks)
        ) {
          if (
            task.selectedTasks.some(
              (name) => !availableTasks.some((entry) => entry.value === name),
            )
          ) {
            skippedTasks++;
            return;
          }
          const selectedTokens = task.selectedTokens
            .map((id) => accountMap.get(id))
            .filter(Boolean);
          unmatchedReferences +=
            task.selectedTokens.length - selectedTokens.length;
          if (!selectedTokens.length) {
            skippedTasks++;
            return;
          }
          scheduledTasks.push({
            ...task,
            selectedTokens,
            enabled: false,
          });
          importedTasks++;
        }
      });
      saveScheduledTasks();
    } else {
      scheduledTasksSkippedByStaleConfig = importData.scheduledTasks.length > 0;
    }
  }

  if (importData.batchSettings && batchSettings) {
    const safeSettings = Object.fromEntries(
      Object.entries(importData.batchSettings).filter(([key]) =>
        ALLOWED_BATCH_SETTING_SET.has(key),
      ),
    );
    Object.assign(batchSettings, safeSettings);
    if (
      normalizeBlackMarketPurchaseList &&
      createDefaultBlackMarketPurchaseList
    ) {
      batchSettings.blackMarketPurchaseList = normalizeBlackMarketPurchaseList(
        batchSettings.blackMarketPurchaseList?.length
          ? batchSettings.blackMarketPurchaseList
          : createDefaultBlackMarketPurchaseList(),
      );
    }
    saveBatchSettings();
  }

  if (Array.isArray(importData.tokenSettings) && writeDailyTaskSettings) {
    importData.tokenSettings.forEach((item) => {
      if (item.tokenId && item.settings) {
        const mappedId = accountMap.get(item.tokenId);
        const token = tokens.find((entry) => entry.id === mappedId);
        if (token) writeDailyTaskSettings(token, item.settings);
      }
    });
  }

  const summary = `导入 ${importedTokens} 个新账号、${importedTasks} 个定时任务。新导入的定时任务默认关闭，请核对账号后启用。`;
  const unmatchedAccounts = importData.tokens.filter(
    (token) => token.id && !accountMap.has(token.id),
  ).length;
  const warning =
    skippedTasks || unmatchedReferences || unmatchedAccounts
      ? `${summary} ${unmatchedAccounts} 个账号未匹配，${skippedTasks} 个计划未导入，${unmatchedReferences} 个账号引用未匹配。`
      : null;

  return {
    status: "imported",
    importedTokens,
    importedTasks,
    skippedTasks,
    unmatchedReferences,
    unmatchedAccounts,
    scheduledTasksSkippedByStaleConfig,
    summary,
    warning,
  };
}
