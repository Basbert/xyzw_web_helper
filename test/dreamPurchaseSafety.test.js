import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as vue from "vue";
import { withDreamPurchaseLock } from "../src/utils/dailyDreamPurchase.js";
import {
  goldItemsConfig,
  merchantConfig,
} from "../src/utils/dreamConstants.js";

const source = await readFile(
  new URL("../src/components/cards/DreamHelperCard.vue", import.meta.url),
  "utf8",
);
const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile(
  "DreamHelperCard.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const setup = ast.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(ast))
  .join("\n")
  .replace("import.meta.env.BASE_URL", '"/offline/"');

function fixture({
  mode = "gold",
  answer = { reward: [{ itemId: 1, count: 1 }] },
  onDelay,
  lock = async (_id, operation) => operation(),
  serverMerchant,
} = {}) {
  const calls = [];
  const notices = [];
  const delays = [];
  const unmount = [];
  const statuses = vue.reactive({ a: "connected", b: "connected" });
  const store = vue.reactive({
    selectedToken: { id: "a", name: "A" },
    getWebSocketStatus: (id) => statuses[id],
    async sendMessageWithPromise(id, command) {
      calls.push({ id, command });
      if (command === "role_getroleinfo")
        return {
          role: {
            levelId: 5000,
            dungeon: {
              merchant:
                serverMerchant ||
                (mode === "fish"
                  ? { 1: [], 2: [], 3: [2, 2] }
                  : { 1: [5, 6], 2: [], 3: [] }),
            },
          },
        };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  const context = {
    ...vue,
    onUnmounted: (fn) => unmount.push(fn),
    defineProps: () => ({ initialTab: "buy" }),
    useTokenStore: () => store,
    useMessage: () =>
      Object.fromEntries(
        ["success", "warning", "error", "info"].map((key) => [
          key,
          (text) => notices.push({ key, text }),
        ]),
      ),
    merchantConfig,
    goldItemsConfig,
    isDungeonOpen: () => true,
    withDreamPurchaseLock: lock,
    setTimeout: (fn) => delays.push(fn),
    console,
  };
  vm.createContext(context);
  const scope = vue.effectScope();
  scope.run(() =>
    vm.runInContext(
      `${setup}\nglobalThis.api = {buyAllGoldItems,buyAllGoldFishItems,merchantData,merchantDataLoaded,levelId,isRunning};`,
      context,
    ),
  );
  context.api.merchantData.value =
    mode === "fish" ? { 1: [], 2: [], 3: [2, 2] } : { 1: [5, 6], 2: [], 3: [] };
  context.api.merchantDataLoaded.value = true;
  context.api.levelId.value = 5000;
  const f = {
    store,
    statuses,
    calls,
    notices,
    api: context.api,
    unmount,
    async run() {
      let finished = false;
      const promise = (
        mode === "fish"
          ? this.api.buyAllGoldFishItems()
          : this.api.buyAllGoldItems()
      ).finally(() => {
        finished = true;
      });
      for (let i = 0; i < 80; i++) {
        if (finished) break;
        await vue.nextTick();
        await Promise.resolve();
        if (delays.length) {
          await onDelay?.(f);
          delays.shift()();
        }
      }
      await promise;
      scope.stop();
    },
  };
  return f;
}
test("同账号已有每日购买时，手动购买不发送请求", async () => {
  const f = fixture({
    lock: async () => {
      throw new Error("当前账号已有梦境购买任务");
    },
  });
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
    0,
  );
  assert.ok(
    f.notices.some(
      (item) => item.key === "warning" && /已有梦境购买/.test(item.text),
    ),
  );
});
test("每日购买持有共享锁时，手动入口不能重叠购买", async () => {
  let release;
  const holding = withDreamPurchaseLock(
    "a",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  try {
    const f = fixture({ lock: withDreamPurchaseLock });
    await f.run();
    assert.equal(
      f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
      0,
    );
    assert.ok(
      f.notices.some(
        (item) => item.key === "warning" && /梦境购买正在进行/.test(item.text),
      ),
    );
  } finally {
    release();
    await holding;
  }
});
test("拿到共享锁后重读商店，避免按过期位置购买", async () => {
  const f = fixture({ serverMerchant: { 1: [], 2: [], 3: [] } });
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
    0,
  );
  assert.ok(
    f.notices.some(
      (item) => item.key === "success" && /已确认购买 0 件/.test(item.text),
    ),
  );
});
for (const mode of ["gold", "fish"]) {
  test(`${mode}: account switch and return cannot resume queued purchases`, async () => {
    const f = fixture({
      mode,
      onDelay(fixture) {
        fixture.store.selectedToken = { id: "b" };
        fixture.store.selectedToken = { id: "a" };
      },
    });
    await f.run();
    assert.deepEqual(
      f.calls
        .filter((call) => call.command === "dungeon_buymerchant")
        .map((call) => call.id),
      ["a"],
    );
    assert.ok(
      f.notices.some(
        (item) => item.key === "warning" && /后续购买已停止/.test(item.text),
      ),
    );
  });
  test(`${mode}: unwrapped successful reward bodies count as successes`, async () => {
    const f = fixture({ mode });
    await f.run();
    assert.equal(
      f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
      2,
    );
    assert.ok(
      f.notices.some(
        (item) => item.key === "success" && /已确认购买 2 件/.test(item.text),
      ),
    );
  });
  test(`${mode}: an unknown purchase response stops further writes`, async () => {
    const f = fixture({ mode, answer: {} });
    await f.run();
    assert.equal(
      f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
      1,
    );
    assert.ok(
      f.notices.some(
        (item) => item.key === "warning" && /结果未确认/.test(item.text),
      ),
    );
  });
}
test("disconnect and reconnect during the wait stops the old purchase run", async () => {
  const f = fixture({
    onDelay(fixture) {
      fixture.statuses.a = "disconnected";
      fixture.statuses.a = "connected";
    },
  });
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
    1,
  );
});
test("unmount during the wait stops the old purchase run", async () => {
  const f = fixture({
    onDelay(fixture) {
      fixture.unmount.forEach((fn) => fn());
    },
  });
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
    1,
  );
});

async function unwrapThroughRealClient() {
  const { loadModule } = await import("./helpers/loadModule.js");
  const quiet = {
    info() {},
    verbose() {},
    wsMessage() {},
    warn() {},
    error() {},
  };
  const utils = { bon: { encode: (value) => value } };
  const modules = await loadModule(
    new URL("../src/utils/xyzwWebSocket.js", import.meta.url),
    {
      "@/stores/cache": { $CacheManager: { getCache: () => ({}) } },
      "./bonProtocol.js": { g_utils: utils },
      "./helperTaskRunner.js": { sleep: async () => {} },
      "./logger.js": { gameLogger: quiet, wsLogger: quiet },
    },
    { WebSocket: { OPEN: 1 } },
  );
  const client = new modules.XyzwWebSocketClient({
    url: "ws://offline.invalid",
    utils,
  });
  client.connected = true;
  client.socket = { readyState: 1, send() {} };
  const storeCode = await readFile(
    new URL("../src/stores/tokenStore.ts", import.meta.url),
    "utf8",
  );
  const storeAst = ts.createSourceFile(
    "tokenStore.ts",
    storeCode,
    ts.ScriptTarget.Latest,
    true,
  );
  let declaration;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(storeAst) === "sendMessageWithPromise"
    )
      declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(storeAst);
  assert.ok(declaration);
  const context = {
    wsConnections: { value: { a: { status: "connected", client } } },
    wsLogger: quiet,
    accountGameData: {
      forToken() {
        throw new Error("unexpected battle");
      },
    },
  };
  vm.createContext(context);
  const code = ts.transpileModule(
    `const ${declaration.getText(storeAst)}; globalThis.sender = sendMessageWithPromise;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInContext(code, context);
  const pending = context.sender("a", "dungeon_buymerchant", {});
  client._handlePromiseResponse({
    resp: client.seq,
    code: 0,
    rawData: { reward: [{ itemId: 123, count: 1 }] },
  });
  const body = await pending;
  client._clearTimers();
  return body;
}
for (const mode of ["gold", "fish"]) {
  test(`${mode}: real WebSocket and token-store unwrapping produces confirmed purchase`, async () => {
    const answer = await unwrapThroughRealClient();
    assert.equal(answer.code, undefined);
    const f = fixture({ mode, answer });
    await f.run();
    assert.ok(
      f.notices.some(
        (item) => item.key === "success" && /已确认购买 2 件/.test(item.text),
      ),
    );
  });
}

test("rejected or timed-out purchase does not continue the batch", async () => {
  const f = fixture({ answer: new Error("请求超时") });
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
    1,
  );
  assert.ok(
    f.notices.some(
      (item) => item.key === "warning" && /结果未确认/.test(item.text),
    ),
  );
});

test("an explicit server rejection is reported separately and stops later purchases", async () => {
  const f = fixture({ answer: new Error("服务器错误: 400010 - 物品数量不足") });
  await f.run();
  assert.equal(
    f.calls.filter((call) => call.command === "dungeon_buymerchant").length,
    1,
  );
  assert.ok(
    f.notices.some(
      (item) => item.key === "warning" && /服务器拒绝本次购买/.test(item.text),
    ),
  );
  assert.ok(f.notices.every((item) => !/结果未确认/.test(item.text)));
});
