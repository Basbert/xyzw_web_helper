import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "vue/compiler-sfc";

const file = await readFile(
  new URL("../src/views/Dashboard.vue", import.meta.url),
  "utf8",
);
const { descriptor } = parse(file);
const source = ts.createSourceFile(
  "dashboard.js",
  descriptor.scriptSetup.content,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "connectSelectedAccount",
    ),
);
assert.ok(declaration);

function setup(connect) {
  const messages = [];
  const tokenStore = {
    selectedToken: { id: "a", token: "token-a", wsUrl: "url-a" },
    getWebSocketStatus: () => "disconnected",
    createWebSocketConnection: connect,
  };
  const connectingAccount = { value: null };
  const context = {
    tokenStore,
    connectingAccount,
    isConnected: { value: false },
    isConnecting: {
      get value() {
        return Boolean(connectingAccount.value);
      },
    },
    message: {
      warning: (value) => messages.push(value),
      error: (value) => messages.push(value),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.connect = connectSelectedAccount;`,
    context,
  );
  return { context, messages, tokenStore, connectingAccount };
}

test("首页重连只发起一次请求，并在请求结束后恢复按钮", async () => {
  let complete;
  const calls = [];
  const fixture = setup((...args) => {
    calls.push(args);
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const first = fixture.context.connect();
  await fixture.context.connect();
  assert.deepEqual(calls, [["a", "token-a", "url-a"]]);
  assert.equal(fixture.connectingAccount.value, "a");
  complete({});
  await first;
  assert.equal(fixture.connectingAccount.value, null);
  assert.deepEqual(fixture.messages, []);
});

test("账号切换后，旧账号的连接失败不会显示在新账号", async () => {
  let complete;
  const fixture = setup(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const attempt = fixture.context.connect();
  fixture.tokenStore.selectedToken = { id: "b" };
  complete(null);
  await attempt;
  assert.deepEqual(fixture.messages, []);
  assert.equal(fixture.connectingAccount.value, null);
});

test("无法创建连接时给当前账号提示，且不声称已经连接", async () => {
  const fixture = setup(async () => null);
  await fixture.context.connect();
  assert.equal(fixture.messages.length, 1);
  assert.match(fixture.messages[0], /无法建立连接/);
  assert.equal(fixture.connectingAccount.value, null);
});
