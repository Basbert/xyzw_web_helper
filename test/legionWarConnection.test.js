import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { reactive } from "vue";
import { parse } from "vue/compiler-sfc";
import { waitForAccountConnection } from "../src/utils/waitForAccountConnection.js";

const file = await readFile(
  new URL("../src/views/LegionWar.vue", import.meta.url),
  "utf8",
);
const { descriptor } = parse(file);
const source = ts.createSourceFile(
  "LegionWar.js",
  descriptor.scriptSetup.content,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "connectWebSocket",
    ),
);
assert.ok(declaration);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture({ status = "connecting", otherTab = false, response } = {}) {
  const calls = [];
  const messages = [];
  const store = reactive({
    selectedToken: { id: "a", token: "test-a", wsUrl: "wss://test" },
    status,
    getWebSocketStatus: () => store.status,
    isConnectionActiveInAnotherTab: () => otherTab,
    async createWebSocketConnection(...args) {
      calls.push(["create", ...args]);
      return null;
    },
    async sendMessageWithPromise(...args) {
      calls.push(["send", ...args]);
      return response ? response() : { info: { sid: 1, battlefieldId: 2 } };
    },
  });
  const context = {
    tokenStore: store,
    connectingBattlefield: false,
    accountGeneration: 0,
    pageAbort: new AbortController(),
    waitForAccountConnection,
    fetchBattleRecords1: async (result) => calls.push(["battlefield", result]),
    message: {
      warning: (text) => messages.push(text),
      error: (text) => messages.push(text),
    },
    router: { push() {} },
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.connect = connectWebSocket;`,
    context,
  );
  return { context, store, calls, messages };
}

test("盐场等待真实连接建立后才读取战场信息", async () => {
  const f = fixture();
  const pending = f.context.connect();
  assert.deepEqual(f.calls, []);
  await new Promise((resolve) => setTimeout(resolve, 10));
  f.store.status = "connected";
  await pending;
  assert.equal(f.calls[0][0], "send");
  assert.equal(f.calls[0][2], "legion_getbattlefield");
  assert.equal(f.calls[1][0], "battlefield");
  assert.deepEqual(f.messages, []);
});

test("盐场已有连接时直接读取战场，不重复建立连接", async () => {
  const f = fixture({ status: "connected" });
  await f.context.connect();
  assert.equal(
    f.calls.some(([type]) => type === "create"),
    false,
  );
  assert.equal(f.calls.filter(([type]) => type === "send").length, 1);
});

test("盐场切换账号后不继续读取或进入旧账号的战场", async () => {
  const f = fixture();
  const pending = f.context.connect();
  f.context.accountGeneration++;
  f.store.selectedToken = { id: "b" };
  await pending;
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.messages, []);

  const gate = deferred();
  const g = fixture({ status: "connected", response: () => gate.promise });
  const loading = g.context.connect();
  await Promise.resolve();
  g.context.accountGeneration += 2;
  g.store.selectedToken = { id: "b" };
  g.store.selectedToken = { id: "a" };
  gate.resolve({ info: { sid: 1, battlefieldId: 2 } });
  await loading;
  assert.equal(
    g.calls.some(([type]) => type === "battlefield"),
    false,
  );
});

test("盐场连接被其他助手页面占用时显示原因，不请求战场", async () => {
  const f = fixture({ status: "disconnected", otherTab: true });
  await f.context.connect();
  assert.equal(f.calls.filter(([type]) => type === "create").length, 1);
  assert.equal(
    f.calls.some(([type]) => type === "send"),
    false,
  );
  assert.match(f.messages[0], /另一个助手页面/);
});

test("等待连接支持超时、账号切换和页面关闭", async () => {
  const store = reactive({
    selectedToken: { id: "a" },
    status: "connecting",
    getWebSocketStatus: () => store.status,
  });
  assert.equal(
    await waitForAccountConnection(store, "a", { timeoutMs: 5 }),
    false,
  );
  const switched = waitForAccountConnection(store, "a");
  store.selectedToken = { id: "b" };
  assert.equal(await switched, false);
  store.selectedToken = { id: "a" };
  const abort = new AbortController();
  const canceled = waitForAccountConnection(store, "a", {
    signal: abort.signal,
  });
  abort.abort();
  assert.equal(await canceled, false);
});
