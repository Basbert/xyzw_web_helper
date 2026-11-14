import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "vue/compiler-sfc";
import {
  DAILY_TASK_DEFAULTS,
  readDailyTaskSettingsForExecution,
  resetDailyTaskSettings,
  SAFE_DAILY_TASK_DEFAULTS,
  writeDailyTaskSettings,
} from "../src/utils/dailyTaskSettings.js";

const component = await readFile(
  new URL("../src/components/Daily/DailyTaskStatus.vue", import.meta.url),
  "utf8",
);
const descriptor = parse(component).descriptor;
const setup = descriptor.scriptSetup.content;
const source = ts.createSourceFile(
  "DailyTaskStatus.js",
  setup,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "runDailyFix",
    ),
);
assert.ok(declaration);

test("设置异常时在警告内容中提供明确重置按钮", () => {
  const nodes = [];
  const collect = (node) => {
    if (node?.type === 1) nodes.push(node);
    for (const child of node?.children || []) collect(child);
  };
  collect(descriptor.template.ast);
  const alert = nodes.find(
    (node) =>
      node.tag === "n-alert" &&
      node.props.some(
        (prop) => prop.name === "if" && prop.exp?.content === "settingsIssue",
      ),
  );
  assert.ok(alert);
  const descendants = [];
  const collectAlert = (node) => {
    if (node?.type === 1) descendants.push(node);
    for (const child of node?.children || []) collectAlert(child);
  };
  collectAlert(alert);
  assert.ok(
    descendants.some(
      (node) =>
        node.tag === "n-button" &&
        node.props.some(
          (prop) =>
            prop.name === "on" &&
            prop.arg?.content === "click" &&
            prop.exp?.content === "resetInvalidSettings",
        ),
    ),
  );
  assert.ok(
    !descendants.some(
      (node) =>
        node.tag === "template" &&
        node.props.some(
          (prop) => prop.name === "slot" && prop.arg?.content === "footer",
        ),
    ),
  );
});

test("日常页面在执行前检查损坏的设置，不发送请求", async () => {
  const previous = globalThis.localStorage;
  const records = new Map([["daily-settings:a", "{"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, value) => records.set(key, value),
    },
  });
  let runnerCreated = false;
  const warnings = [];
  const token = { id: "a", roleId: "r" };
  const context = {
    tokenStore: { selectedToken: token, gameTokens: [token] },
    busy: { value: false },
    settingsIssue: { value: "" },
    isConnected: { value: true },
    DAILY_TASK_DEFAULTS,
    readDailyTaskSettingsForExecution,
    settings: { ...DAILY_TASK_DEFAULTS },
    message: {
      warning: (value) => warnings.push(value),
      error: (value) => warnings.push(value),
    },
    DailyTaskRunner: class {
      constructor() {
        runnerCreated = true;
      }
    },
  };
  try {
    vm.createContext(context);
    vm.runInContext(
      `${declaration.getText(source)}\nglobalThis.run = runDailyFix;`,
      context,
    );
    await context.run();
    assert.equal(runnerCreated, false);
    assert.equal(context.busy.value, false);
    assert.match(warnings[0], /设置.*损坏/);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
  }
});

test("批量页面对损坏的角色设置返回不可执行状态，而不是使用付费默认值", async () => {
  const batch = await readFile(
    new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
    "utf8",
  );
  const batchSetup = parse(batch).descriptor.scriptSetup.content;
  const batchSource = ts.createSourceFile(
    "BatchDailyTasks.js",
    batchSetup,
    ts.ScriptTarget.Latest,
    true,
  );
  const load = batchSource.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (item) => item.name.getText(batchSource) === "loadSettings",
      ),
  );
  assert.ok(load);
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (key === "daily-settings:a" ? "{" : null),
      setItem() {},
    },
  });
  const context = {
    tokens: { value: [{ id: "a" }] },
    DAILY_TASK_DEFAULTS,
    readDailyTaskSettingsForExecution,
    console: { error() {} },
  };
  try {
    vm.createContext(context);
    vm.runInContext(
      `${load.getText(batchSource)}\nglobalThis.load = loadSettings;`,
      context,
    );
    assert.equal(context.load("a"), null);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
  }
});

test("批量设置明确保存后可修复损坏隐藏字段，不会启用付费选项", async () => {
  const batch = await readFile(
    new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
    "utf8",
  );
  const batchSetup = parse(batch).descriptor.scriptSetup.content;
  const batchSource = ts.createSourceFile(
    "BatchDailyTasks.js",
    batchSetup,
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set(["loadSettings", "openSettings", "saveSettings"]);
  const declarations = batchSource.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) =>
          names.has(item.name.getText(batchSource)),
        ),
    )
    .map((node) => node.getText(batchSource))
    .join("\n");
  const previous = globalThis.localStorage;
  const records = new Map([
    ["daily-settings:a", '{"freeGachaEnable":"false"}'],
  ]);
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const token = { id: "a", roleId: "r", name: "A" };
  const context = {
    tokens: { value: [token] },
    DAILY_TASK_DEFAULTS,
    SAFE_DAILY_TASK_DEFAULTS,
    readDailyTaskSettingsForExecution,
    resetDailyTaskSettings,
    writeDailyTaskSettings,
    currentSettings: {},
    currentSettingsTokenId: { value: null },
    currentSettingsTokenName: { value: "" },
    settingsNeedRepair: { value: false },
    showSettingsModal: { value: false },
    console: { error() {} },
    message: { warning() {}, error() {}, success() {} },
  };
  try {
    vm.createContext(context);
    vm.runInContext(
      `${declarations}\nglobalThis.open = openSettings; globalThis.save = saveSettings;`,
      context,
    );
    context.open(token);
    assert.equal(context.settingsNeedRepair.value, true);
    assert.equal(
      records.get("daily-settings:a"),
      '{"freeGachaEnable":"false"}',
    );
    context.save();
    const saved = readDailyTaskSettingsForExecution(token, [token], storage);
    assert.equal(saved.payRecruit, false);
    assert.equal(saved.blackMarketPurchase, false);
    assert.equal(saved.dreamShopPurchase, false);
    assert.equal(Object.hasOwn(saved, "freeGachaEnable"), false);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
  }
});
