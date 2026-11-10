import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const component = await readFile(
  new URL("../src/components/Daily/DailyTaskStatus.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "DailyTaskStatus.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (item) => item.name.getText(source) === "runDailyFix",
    ),
);
assert.ok(declaration);

function fixture(result, options = {}) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const messages = [];
  const ref = (value) => ({ value });
  const context = {
    tokenStore: { selectedToken: { id: "A", name: "角色 A" } },
    isConnected: ref(true),
    busy: ref(false),
    showLog: ref(false),
    runSummary: ref(null),
    logList: ref([]),
    settings: { commandDelay: 0, taskDelay: 0 },
    runConnectionGeneration: 0,
    markDreamShopChecked: () => true,
    runDailyDreamPurchase: async (request) => {
      context.dreamRequest = request;
      return { status: "completed", purchases: [] };
    },
    log: (message) => calls.push(message),
    message: new Proxy(
      {},
      { get: (_, kind) => (text) => messages.push([kind, text]) },
    ),
    console: { error() {} },
    DailyTaskRunner: class {
      constructor(_store, _delays, runnerOptions) {
        context.runnerOptions = runnerOptions;
      }
      async run(tokenId, callbacks) {
        context.callbacks = callbacks;
        calls.push(tokenId);
        await gate;
        if (options.error) throw new Error("连接已断开");
        return result;
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.run = runDailyFix;`,
    context,
  );
  return { context, calls, messages, release, run: context.run };
}

test("a result remains attached to its starting account after switching roles", async () => {
  const f = fixture({ incomplete: 2, failed: 1, skipped: 3 });
  const run = f.run();
  assert.equal(f.context.runSummary.value.title, "正在执行");
  f.context.tokenStore.selectedToken = { id: "B", name: "角色 B" };
  f.release();
  await run;
  assert.equal(f.calls[1], "A");
  assert.equal(f.context.runSummary.value.tokenId, "A");
  assert.equal(f.context.runSummary.value.account, "执行账号：角色 A");
  assert.match(f.context.runSummary.value.detail, /2 项待处理或核对/);
  assert.match(f.context.runSummary.value.detail, /1 个步骤执行失败/);
  assert.equal(f.context.runSummary.value.title, "本轮结束，请核对结果");
  assert.ok(
    f.messages.some(
      ([type, text]) => type === "warning" && text.includes("角色 A"),
    ),
  );
});

test("a failed step is never displayed as a fully successful run", async () => {
  const f = fixture({ incomplete: 0, failed: 1, skipped: 0 });
  const run = f.run();
  f.release();
  await run;
  assert.equal(f.context.runSummary.value.title, "本轮结束，请核对结果");
  assert.ok(f.messages.some(([type]) => type === "warning"));
  assert.ok(!f.messages.some(([type]) => type === "success"));
});

test("an interrupted run is shown as interrupted and keeps its account", async () => {
  const f = fixture(null, { error: true });
  const run = f.run();
  f.release();
  await run;
  assert.equal(f.context.runSummary.value.title, "本轮执行中断");
  assert.equal(f.context.runSummary.value.tokenId, "A");
  assert.equal(f.context.busy.value, false);
});

test("daily runner receives account-bound interruption and dream purchase hooks", async () => {
  const f = fixture({ incomplete: 0, failed: 0, skipped: 0 });
  const run = f.run();
  assert.equal(f.context.callbacks.shouldStop(), false);
  const checkActive = () => {};
  const sleep = async () => {};
  await f.context.runnerOptions.runDreamShopPurchases({
    tokenId: "A",
    checkActive,
    sleep,
    log: () => {},
  });
  assert.equal(f.context.dreamRequest.accountId, "A");
  assert.equal(f.context.dreamRequest.isOpen, true);
  assert.equal(f.context.dreamRequest.checkActive, checkActive);
  f.context.runConnectionGeneration++;
  assert.equal(f.context.callbacks.shouldStop(), true);
  f.release();
  await run;
});
