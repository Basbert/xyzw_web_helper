import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const component = await readFile(
  new URL("../src/components/GameStatus.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "GameStatus.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (item) => item.name.getText(source) === "runCombinedDailyAction",
    ),
);
assert.ok(declaration);

function fixture(result) {
  const messages = [];
  const context = {
    tokenStore: { selectedToken: { id: "a", name: "角色 A" } },
    combinedBusy: { value: false },
    combinedProgress: { value: "" },
    combinedRunningName: { value: "" },
    combinedResults: { value: {} },
    message: new Proxy(
      {},
      { get: (_, type) => (text) => messages.push({ type, text }) },
    ),
    runBottleAndHangUp: async ({ tokenId }) => {
      assert.equal(tokenId, "a");
      context.tokenStore.selectedToken = { id: "b", name: "角色 B" };
      return result;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.run = runCombinedDailyAction;`,
    context,
  );
  return { context, messages, run: context.run };
}

test("a fragment timeout reports a warning and the original account", async () => {
  const f = fixture({
    sent: 2,
    remaining: 0,
    legacy: { status: "unconfirmed", error: "请求超时" },
  });
  await f.run();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].type, "warning");
  assert.match(f.messages[0].text, /角色 A.*残卷领取未确认.*请求超时/);
  assert.doesNotMatch(f.messages[0].text, /角色 B/);
  assert.equal(f.context.combinedResults.value.a.type, "warning");
  assert.match(f.context.combinedResults.value.a.text, /请求超时/);
  assert.equal(f.context.combinedResults.value.b, undefined);
  assert.equal(f.context.combinedBusy.value, false);
});

test("a confirmed fragment response is reflected in the completion message", async () => {
  const f = fixture({
    sent: 0,
    remaining: 0,
    legacy: { status: "acknowledged", received: 6 },
  });
  await f.run();
  assert.equal(f.messages[0].type, "success");
  assert.match(f.messages[0].text, /功法残卷领取 6 个/);
  assert.equal(f.context.combinedResults.value.a.type, "success");
});

test("failed maintenance remains visible for the account that initiated it", async () => {
  const f = fixture(null);
  f.context.runBottleAndHangUp = async () => {
    f.context.tokenStore.selectedToken = { id: "b", name: "角色 B" };
    throw new Error("挂机奖励领取失败");
  };
  await f.run();
  assert.equal(f.context.combinedResults.value.a.type, "error");
  assert.match(
    f.context.combinedResults.value.a.text,
    /角色 A.*挂机奖励领取失败/,
  );
  assert.equal(f.context.combinedResults.value.b, undefined);
});

test("the running label keeps the initiating account after switching", async () => {
  const f = fixture(null);
  let finish;
  f.context.runBottleAndHangUp = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const operation = f.run();
  f.context.tokenStore.selectedToken = { id: "b", name: "角色 B" };
  assert.equal(f.context.combinedRunningName.value, "角色 A");
  finish({ sent: 0, remaining: 0, legacy: { status: "acknowledged" } });
  await operation;
  assert.equal(f.context.combinedRunningName.value, "");
  assert.equal(f.context.combinedResults.value.a.type, "success");
  assert.equal(f.context.combinedResults.value.b, undefined);
});
