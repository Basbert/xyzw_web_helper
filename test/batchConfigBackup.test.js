import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { DAILY_TASK_DEFAULTS } from "../src/utils/dailyTaskSettings.js";

const component = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "BatchDailyTasks.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((item) =>
        ["exportConfig", "importConfig"].includes(item.name.getText(source)),
      ),
  )
  .map((statement) => statement.getText(source))
  .join("\n");

function fixture() {
  const blobs = [];
  const notices = [];
  const writes = [];
  const accounts = [
    {
      id: "current",
      name: "A",
      roleId: 123,
      server: "s1",
      token: "sensitive-token",
      sourceUrl: "https://example.test/?secret=1",
    },
  ];
  const context = {
    tokens: { value: accounts },
    gameTokens: { value: accounts },
    scheduledTasks: {
      value: [
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
      ],
    },
    batchSettings: { blackMarketPurchaseList: [] },
    DAILY_TASK_DEFAULTS,
    localStorage: {
      getItem: () =>
        JSON.stringify({ arenaFormation: 3, password: "hidden-password" }),
    },
    Blob,
    URL: {
      createObjectURL: (blob) => {
        blobs.push(blob);
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    document: {
      createElement: () => ({ click() {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    message: {
      success: (text) => notices.push(text),
      warning: (text) => notices.push(text),
      error: (text) => notices.push(text),
    },
    console,
    saveScheduledTasks() {},
    saveBatchSettings() {},
    writeDailyTaskSettings: (token, values) => writes.push({ token, values }),
    normalizeBlackMarketPurchaseList: (list) => list,
    createDefaultBlackMarketPurchaseList: () => [],
    availableTasks: [{ value: "startBatch" }],
    FileReader: class {
      readAsText(data) {
        this.onload({ target: { result: JSON.stringify(data) } });
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declarations}\nglobalThis.api = { exportConfig, importConfig };`,
    context,
  );
  return { context, blobs, notices, writes, ...context.api };
}

test("settings export omits account tokens, source URLs and unrelated secret fields", async () => {
  const f = fixture();
  f.exportConfig("settings");
  const content = await f.blobs[0].text();
  assert.ok(!content.includes("sensitive-token"));
  assert.ok(!content.includes("hidden-token"));
  assert.ok(!content.includes("hidden-password"));
  assert.ok(!content.includes("example.test"));
  const exported = JSON.parse(content);
  assert.equal(exported.tokenSettings[0].settings.arenaFormation, 3);
  assert.equal(exported.scheduledTasks[0].selectedTokens[0], "current");
});

test("explicit account backup includes the account credential", async () => {
  const f = fixture();
  f.exportConfig("full");
  const exported = JSON.parse(await f.blobs[0].text());
  assert.equal(exported.tokens[0].token, "sensitive-token");
});

test("import maps a uniquely matching role and keeps new scheduled tasks disabled", async () => {
  const f = fixture();
  f.context.scheduledTasks.value = [];
  await f.importConfig({
    file: {
      file: {
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
    },
  });
  assert.equal(f.context.scheduledTasks.value[0].selectedTokens[0], "current");
  assert.equal(f.context.scheduledTasks.value[0].enabled, false);
  assert.equal(f.writes[0].token.id, "current");
});

test("import skips an unmatched account and reports that the task was not imported", async () => {
  const f = fixture();
  f.context.scheduledTasks.value = [];
  await f.importConfig({
    file: {
      file: {
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
    },
  });
  assert.equal(f.context.scheduledTasks.value.length, 0);
  assert.ok(f.notices.some((text) => text.includes("未匹配")));
});
