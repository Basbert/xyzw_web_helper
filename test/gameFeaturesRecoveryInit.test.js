import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { computed, nextTick, reactive, watch } from "vue";
import { parse } from "vue/compiler-sfc";

const component = await readFile(
  new URL("../src/views/GameFeatures.vue", import.meta.url),
  "utf8",
);
const { descriptor } = parse(component);
const source = ts.createSourceFile(
  "GameFeatures.js",
  descriptor.scriptSetup.content,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "initializeGameData",
    ),
);
assert.ok(declaration);

async function run(state, options) {
  const calls = [];
  const tokenStore = {
    selectedToken: { id: "a" },
    connectionRecoveryStatus: { a: state },
    sendMessage: (id, cmd) => calls.push([id, cmd]),
    sendMessageWithPromise: async (id, cmd) => {
      calls.push([id, cmd]);
      return { battleData: { version: 123 } };
    },
    setBattleVersion: (version, id) => calls.push([id, "set-version", version]),
  };
  const context = { tokenStore };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.initialize = initializeGameData;`,
    context,
  );
  await context.initialize(options);
  return calls;
}

test("automatic connection recovery refreshes read-only data without sending fight_startlevel", async () => {
  const calls = await run("restored");
  assert.deepEqual(
    calls.map((call) => call[1]),
    [
      "role_getroleinfo",
      "tower_getinfo",
      "evotower_getinfo",
      "presetteam_getinfo",
    ],
  );
});

test("切换到已连接账号时只读初始化，不自动触发战斗", async () => {
  const calls = await run(undefined, { readOnly: true });
  assert.deepEqual(
    calls.map((call) => call[1]),
    [
      "role_getroleinfo",
      "tower_getinfo",
      "evotower_getinfo",
      "presetteam_getinfo",
    ],
  );
});

test("从已连接账号 A 切换到已连接账号 B 会初始化 B", async () => {
  const statement = source.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(source) === "watch" &&
      ts.isArrayLiteralExpression(node.expression.arguments[0]) &&
      node.getText(source).includes("connectionStatus"),
  );
  assert.ok(statement, "必须同时监听账号和连接状态");
  const tokenStore = reactive({ selectedToken: { id: "a" } });
  const connectionStatus = computed(() => "connected");
  const calls = [];
  const context = {
    watch,
    tokenStore,
    connectionStatus,
    initializeGameData: (options) =>
      calls.push({ id: tokenStore.selectedToken.id, options }),
  };
  vm.createContext(context);
  vm.runInContext(statement.getText(source), context);
  tokenStore.selectedToken = { id: "b" };
  await nextTick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "b");
  assert.equal(calls[0].options.readOnly, true);
});

test("first connection keeps the existing battle version initialization", async () => {
  const calls = await run(undefined);
  assert.deepEqual(
    calls.map((call) => call[1]),
    [
      "role_getroleinfo",
      "tower_getinfo",
      "evotower_getinfo",
      "presetteam_getinfo",
      "fight_startlevel",
      "set-version",
    ],
  );
});
