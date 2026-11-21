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

function fixture(loadConfig = async () => ({ weeklyQuiz: {} })) {
  const accounts = vue.reactive({
    a: { weeklyQuizPhase: "" },
    b: { weeklyQuizPhase: "" },
  });
  const calls = [];
  const store = vue.reactive({
    selectedToken: { id: "a" },
    statuses: { a: "connected", b: "connected" },
    get gameData() {
      return accounts[this.selectedToken.id];
    },
    getWebSocketStatus(id) {
      return this.statuses[id];
    },
  });
  const context = {
    ...vue,
    onUnmounted: () => {},
    useTokenStore: () => store,
    useMessage: () => ({ info() {}, warning() {}, success() {} }),
    loadDailyTaskConfig: loadConfig,
    runWeeklyQuiz: async ({ tokenId, check, loadConfig }) => {
      await loadConfig();
      check();
      calls.push(tokenId);
      return { status: "completed", message: "ok" };
    },
  };
  vm.createContext(context);
  const scope = vue.effectScope();
  scope.run(() =>
    vm.runInContext(
      `${body}\nglobalThis.api={startStudy,isConnected};`,
      context,
    ),
  );
  return { accounts, store, calls, api: context.api, scope };
}

test("断线时不能启动答题", async () => {
  const f = fixture();
  f.store.statuses.a = "disconnected";
  assert.equal(f.api.isConnected.value, false);
  await f.api.startStudy();
  assert.equal(f.calls.length, 0);
  f.scope.stop();
});

test("读取配置时切换账号并切回也不会启动原来的答题", async () => {
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
  release({ weeklyQuiz: {} });
  await pending;
  assert.equal(f.calls.length, 0);
  f.scope.stop();
});

test("手动入口不会覆盖同一角色正在运行的每日答题", async () => {
  const f = fixture();
  f.accounts.a.weeklyQuizPhase = "answering";
  await f.api.startStudy();
  f.store.selectedToken = { id: "b" };
  await f.api.startStudy();
  assert.deepEqual(f.calls, ["b"]);
  assert.equal(f.accounts.a.weeklyQuizPhase, "answering");
  f.scope.stop();
});
