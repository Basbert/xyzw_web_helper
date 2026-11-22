import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyConfigBackupData,
  buildConfigBackupData,
} from "../src/utils/batch/configBackup.js";

function createAccounts() {
  return [
    {
      id: "current",
      name: "A",
      roleId: 123,
      server: "s1",
      token: "sensitive-token",
      sourceUrl: "https://example.test/?secret=1",
    },
  ];
}

function createScheduledTasks() {
  return [
    {
      id: "task",
      name: "Daily",
      runType: "daily",
      runTime: "08:00",
      selectedTokens: ["current"],
      selectedTasks: ["startBatch"],
      enabled: true,
      token: "hidden-token",
    },
  ];
}

test("settings export omits account tokens, source URLs and unrelated secret fields", () => {
  const exported = buildConfigBackupData({
    mode: "settings",
    tokens: createAccounts(),
    scheduledTasks: createScheduledTasks(),
    batchSettings: { blackMarketPurchaseList: [] },
    storage: {
      getItem: () =>
        JSON.stringify({ arenaFormation: 3, password: "hidden-password" }),
    },
  });
  const content = JSON.stringify(exported);
  assert.ok(!content.includes("sensitive-token"));
  assert.ok(!content.includes("hidden-token"));
  assert.ok(!content.includes("hidden-password"));
  assert.ok(!content.includes("example.test"));
  assert.equal(exported.tokenSettings[0].settings.arenaFormation, 3);
  assert.equal(exported.scheduledTasks[0].selectedTokens[0], "current");
});

test("explicit account backup includes the account credential", () => {
  const exported = buildConfigBackupData({
    mode: "full",
    tokens: createAccounts(),
    scheduledTasks: createScheduledTasks(),
    batchSettings: { blackMarketPurchaseList: [] },
    storage: {
      getItem: () => null,
    },
  });
  assert.equal(exported.tokens[0].token, "sensitive-token");
});

test("import maps a uniquely matching role and keeps new scheduled tasks disabled", () => {
  const gameTokens = createAccounts();
  const scheduledTasks = [];
  const writes = [];
  const result = applyConfigBackupData({
    importData: {
      version: "1.2",
      tokens: [{ id: "old", roleId: 123, server: "s1" }],
      scheduledTasks: [
        {
          id: "new-task",
          selectedTokens: ["old"],
          selectedTasks: ["startBatch"],
          enabled: true,
        },
      ],
      tokenSettings: [{ tokenId: "old", settings: { arenaFormation: 4 } }],
    },
    gameTokens,
    scheduledTasks,
    availableTasks: [{ value: "startBatch" }],
    batchSettings: { blackMarketPurchaseList: [] },
    normalizeBlackMarketPurchaseList: (list) => list,
    createDefaultBlackMarketPurchaseList: () => [],
    writeDailyTaskSettings: (token, values) => writes.push({ token, values }),
  });
  assert.equal(result.status, "imported");
  assert.equal(scheduledTasks[0].selectedTokens[0], "current");
  assert.equal(scheduledTasks[0].enabled, false);
  assert.equal(writes[0].token.id, "current");
});

test("import skips an unmatched account and reports that the task was not imported", () => {
  const gameTokens = createAccounts();
  const scheduledTasks = [];
  const result = applyConfigBackupData({
    importData: {
      version: "1.2",
      tokens: [{ id: "unknown", roleId: 999 }],
      scheduledTasks: [
        {
          id: "new-task",
          selectedTokens: ["unknown"],
          selectedTasks: ["startBatch"],
          enabled: true,
        },
      ],
    },
    gameTokens,
    scheduledTasks,
    availableTasks: [{ value: "startBatch" }],
    batchSettings: { blackMarketPurchaseList: [] },
    normalizeBlackMarketPurchaseList: (list) => list,
    createDefaultBlackMarketPurchaseList: () => [],
    writeDailyTaskSettings: () => {},
  });
  assert.equal(result.status, "imported");
  assert.equal(scheduledTasks.length, 0);
  assert.ok(result.warning?.includes("未匹配"));
});

test("import skips scheduled tasks when local scheduler config is stale", () => {
  const gameTokens = createAccounts();
  const scheduledTasks = [];
  const result = applyConfigBackupData({
    importData: {
      version: "1.2",
      tokens: [{ id: "old", roleId: 123, server: "s1" }],
      scheduledTasks: [
        {
          id: "new-task",
          selectedTokens: ["old"],
          selectedTasks: ["startBatch"],
          enabled: true,
        },
      ],
    },
    gameTokens,
    scheduledTasks,
    availableTasks: [{ value: "startBatch" }],
    canImportScheduledTasks: () => false,
  });
  assert.equal(result.status, "imported");
  assert.equal(result.scheduledTasksSkippedByStaleConfig, true);
  assert.equal(scheduledTasks.length, 0);
});

test("full backup preserves combUser, serverId, roleIndex, importMethod, dreamPurchaseList and role-scoped settings", () => {
  const exported = buildConfigBackupData({
    mode: "full",
    tokens: [
      {
        id: "t1",
        name: "主号",
        roleId: 888,
        serverId: 1000037,
        roleIndex: 1,
        server: "10服",
        token: "tok-1",
        importMethod: "wxQrcode",
        combUser: { uid: "u1", token: "c1" },
      },
    ],
    scheduledTasks: [],
    batchSettings: {
      blackMarketPurchaseList: [],
      dreamPurchaseList: [{ id: 1, enabled: true }],
    },
    storage: {
      getItem: (key) =>
        key === "daily-role-settings:888"
          ? JSON.stringify({ claimLegacy: false, arenaFormation: 2 })
          : null,
    },
  });

  assert.equal(exported.tokens[0].importMethod, "wxQrcode");
  assert.equal(exported.tokens[0].serverId, 1000037);
  assert.equal(exported.tokens[0].roleIndex, 1);
  assert.deepEqual(exported.tokens[0].combUser, { uid: "u1", token: "c1" });
  assert.deepEqual(exported.batchSettings.dreamPurchaseList, [
    { id: 1, enabled: true },
  ]);
  assert.equal(exported.tokenSettings[0].settings.claimLegacy, false);

  const restoredTokens = [];
  const restoredBatchSettings = {
    blackMarketPurchaseList: [],
    dreamPurchaseList: [],
  };
  const result = applyConfigBackupData({
    importData: exported,
    gameTokens: restoredTokens,
    scheduledTasks: [],
    batchSettings: restoredBatchSettings,
  });

  assert.equal(result.status, "imported");
  assert.equal(restoredTokens.length, 1);
  assert.equal(restoredTokens[0].importMethod, "wxQrcode");
  assert.equal(restoredTokens[0].serverId, 1000037);
  assert.equal(restoredTokens[0].roleIndex, 1);
  assert.deepEqual(restoredTokens[0].combUser, { uid: "u1", token: "c1" });
  assert.deepEqual(restoredBatchSettings.dreamPurchaseList, [
    { id: 1, enabled: true },
  ]);
});
