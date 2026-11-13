import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "vue/compiler-sfc";

const component = await readFile(
  new URL("../src/views/Dashboard.vue", import.meta.url),
  "utf8",
);
const setup = parse(component).descriptor.scriptSetup.content;
const source = ts.createSourceFile(
  "Dashboard.js",
  setup,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "dailyActions",
    ),
);
assert.ok(declaration);

function fixture() {
  const calls = [];
  let dependencies;
  class Runner {
    constructor(store, delays, options) {
      calls.push({ store, delays, options });
    }
    run(...args) {
      calls.push({ run: args });
      return { incomplete: 0, failed: 0 };
    }
  }
  const store = {
    gameTokens: [{ id: "a" }],
    sendMessageWithPromise: (...args) => calls.push({ send: args }),
  };
  const context = {
    tokenStore: store,
    useDashboardDailyActions: (_, value) => {
      dependencies = value;
      return {};
    },
    DAILY_TASK_DEFAULTS: {
      commandDelay: 500,
      taskDelay: 500,
      dreamShopPurchase: true,
    },
    readDailyTaskSettingsForExecution: () => ({
      dreamShopPurchase: false,
      commandDelay: 900,
    }),
    DailyTaskRunner: Runner,
    runBottleAndHangUp: (args) => calls.push({ maintenance: args }),
    markDreamShopChecked: () => {},
    runDailyDreamPurchase: (args) => {
      calls.push({ dream: args });
      return {};
    },
  };
  vm.createContext(context);
  vm.runInContext(declaration.getText(source), context);
  return { calls, dependencies, store };
}

test("首页每日执行使用该角色设置、原有执行器和取消回调", () => {
  const f = fixture();
  const settings = f.dependencies.readSettings({ id: "a" });
  assert.equal(settings.commandDelay, 900);
  assert.equal(settings.taskDelay, 500);
  assert.equal(settings.dreamShopPurchase, false);
  const shouldStop = () => false;
  f.dependencies.executeDaily({
    tokenId: "a",
    settings,
    shouldStop,
    onProgress: () => {},
  });
  assert.equal(f.calls[0].store, f.store);
  assert.equal(f.calls[0].delays.commandDelay, 900);
  assert.equal(f.calls[1].run[0], "a");
  assert.equal(f.calls[1].run[1].shouldStop, shouldStop);
  assert.equal(f.calls[1].run[2], settings);
  const checkActive = () => {};
  const sleep = () => {};
  f.calls[0].options.runDreamShopPurchases({
    tokenId: "a",
    checkActive,
    sleep,
    log: () => {},
  });
  assert.equal(f.calls[2].dream.accountId, "a");
  assert.equal(f.calls[2].dream.checkActive, checkActive);
});

test("首页补给使用原有共享执行器并传递取消回调", () => {
  const f = fixture();
  const shouldStop = () => false;
  f.dependencies.executeMaintenance({
    tokenId: "a",
    shouldStop,
    onProgress: () => {},
  });
  assert.equal(f.calls[0].maintenance.tokenStore, f.store);
  assert.equal(f.calls[0].maintenance.tokenId, "a");
  assert.equal(f.calls[0].maintenance.shouldStop, shouldStop);
});
