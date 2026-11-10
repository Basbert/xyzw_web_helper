import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as vue from "vue";

const component = await readFile(
  new URL("../src/components/cards/StudyChallengeCard.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
const source = ts.createSourceFile(
  "StudyChallengeCard.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const body = source.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(source))
  .join("\n");

function fixture(preload = async () => {}) {
  const accounts = vue.reactive({
    a: { studyStatus: { status: "" } },
    b: { studyStatus: { status: "" } },
  });
  const calls = [];
  const timers = [];
  const store = vue.reactive({
    selectedToken: { id: "a" },
    wsConnections: { a: { client: {} }, b: { client: {} } },
    statuses: { a: "connected", b: "connected" },
    get gameData() {
      return accounts[this.selectedToken.id];
    },
    getWebSocketStatus(id) {
      return this.statuses[id];
    },
    sendMessage(id, command) {
      calls.push([id, command]);
      return true;
    },
  });
  const context = {
    ...vue,
    onUnmounted: () => {},
    useTokenStore: () => store,
    useMessage: () => ({ info() {}, warning() {}, error() {}, success() {} }),
    isSameGameValue: (a, b) => a === b,
    preloadQuestions: preload,
    getQuestionCount: async () => 50,
    setTimeout: (fn) => timers.push(fn),
  };
  vm.createContext(context);
  const scope = vue.effectScope();
  scope.run(() =>
    vm.runInContext(
      `${body}\nglobalThis.api={startStudy,isConnected};`,
      context,
    ),
  );
  return { accounts, store, calls, timers, api: context.api, scope };
}

test("断线时不能启动答题", async () => {
  const f = fixture();
  f.store.statuses.a = "disconnected";
  assert.equal(f.api.isConnected.value, false);
  await f.api.startStudy();
  assert.equal(f.calls.length, 0);
  f.scope.stop();
});

test("题库加载期间切换账号并切回也不会发送答题指令", async () => {
  let release;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = f.api.startStudy();
  f.store.selectedToken = { id: "b" };
  f.store.selectedToken = { id: "a" };
  release();
  await pending;
  assert.equal(f.calls.length, 0);
  assert.equal(f.accounts.a.studyStatus.status, "");
  assert.equal(f.accounts.b.studyStatus.status, "");
  f.scope.stop();
});

test("各账号答题超时只重置原账号", async () => {
  const f = fixture();
  await f.api.startStudy();
  f.store.selectedToken = { id: "b" };
  await f.api.startStudy();
  assert.deepEqual(
    f.calls.map((x) => x[0]),
    ["a", "b"],
  );
  f.timers[0]();
  assert.equal(f.accounts.a.studyStatus.isAnswering, false);
  assert.equal(f.accounts.b.studyStatus.isAnswering, true);
  f.timers[1]();
  assert.equal(f.accounts.b.studyStatus.isAnswering, false);
  f.scope.stop();
});
