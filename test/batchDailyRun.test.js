import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { computed, reactive, ref, toRaw, watch } from "vue";
import { isDungeonOpen } from "../src/utils/dreamConstants.js";

const component = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "BatchDailyTasks must contain a setup script");
const source = ts.createSourceFile(
  "BatchDailyTasks.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set([
  "waitForConnectionSlot",
  "releaseConnectionSlot",
  "ensureConnection",
  "startBatch",
]);
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source)),
      ),
  )
  .map((statement) => statement.getText(source))
  .join("\n");

/** Run the component's actual batch orchestration with isolated transports and refs. */
function fixture({
  connected = true,
  connectionSucceeds = true,
  runError = null,
  incomplete = 0,
  failed = 0,
  runImpl = null,
} = {}) {
  const logs = [];
  const state = reactive({
    runs: 0,
    closed: 0,
    connected,
    sent: [],
    marks: [],
    dreamCalls: 0,
  });
  const connections = reactive(
    connected ? { "account-a": { client: { socket: {} } } } : {},
  );
  const context = {
    selectedTokens: { value: ["account-a"] },
    tokens: {
      value: [{ id: "account-a", name: "Test account", token: "fixture" }],
    },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    currentRunningTokenId: { value: null },
    connectionQueue: { active: 1 },
    toRaw,
    watch,
    batchSettings: {
      maxActive: 2,
      reconnectDelay: 0,
      commandDelay: 0,
      taskDelay: 0,
    },
    addLog: (log) => logs.push(log),
    message: { info() {}, warning() {}, success() {} },
    setTimeout: (callback) => {
      callback();
    },
    waitForConnection: async () => {
      state.connected = connectionSucceeds;
      return connectionSucceeds;
    },
    tokenStore: {
      wsConnections: connections,
      getWebSocketStatus: () =>
        state.connected ? "connected" : "disconnected",
      createWebSocketConnection(id) {
        const client = { socket: {} };
        connections[id] = { client };
        return client;
      },
      closeWebSocketConnection() {
        state.closed++;
        state.connected = false;
      },
      sendMessageWithPromise: async (id, cmd, params) => {
        state.sent.push({ id, cmd, params });
        return {};
      },
    },
    runDailyDreamPurchase: async (options) => {
      state.dreamCalls++;
      options.checkActive();
      await options.send("role_getroleinfo", {});
      options.onProgress({ confirmed: 1, total: 1 });
      return { status: "completed" };
    },
    markDreamShopChecked: (details) => state.marks.push(details),
    DailyTaskRunner: class {
      constructor(_store, _delays, options) {
        this.options = options;
      }
      async run(id, callbacks, accountSettings) {
        state.runs++;
        state.receivedSettings = accountSettings;
        if (runImpl)
          return runImpl({
            id,
            callbacks,
            accountSettings,
            options: this.options,
            context,
            state,
          });
        if (runError) throw runError;
        return { incomplete, failed };
      }
    },
  };
  context.executionTokens = context.selectedTokens;
  context.runtimeBatchSettings = context.batchSettings;
  context.activeScheduledRun = { value: null };
  vm.createContext(context);
  vm.runInContext(
    `${declarations}\nglobalThis.api = { startBatch, waitForConnectionSlot, ensureConnection };`,
    context,
  );
  return { context, state, logs, ...context.api };
}

test("batch rate-limit failure executes once and preserves another caller's connection and slot", async () => {
  const f = fixture({ runError: new Error("200400 操作太快") });
  await f.startBatch();
  assert.equal(f.state.runs, 1);
  assert.equal(f.state.closed, 0);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.equal(f.context.tokenStatus.value["account-a"], "failed");
  assert.equal(f.context.isRunning.value, false);
});

test("failed connection releases its slot once without releasing another account's slot", async () => {
  const f = fixture({ connected: false, connectionSucceeds: false });
  await f.startBatch();
  assert.equal(f.state.runs, 0);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.equal(f.context.tokenStatus.value["account-a"], "failed");
  assert.equal(f.context.isRunning.value, false);
});

test("batch releases the new connection it owns and respects the runner's pending result", async () => {
  const f = fixture({ connected: false, incomplete: 2 });
  await f.startBatch();
  assert.equal(f.state.runs, 1);
  assert.equal(f.state.closed, 1);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.equal(f.context.tokenStatus.value["account-a"], "pending");
});

test("stop while waiting for a connection slot does not acquire a slot", async () => {
  const f = fixture();
  f.context.connectionQueue.active = 2;
  f.context.shouldStop.value = true;
  await assert.rejects(
    f.waitForConnectionSlot(),
    (error) => error.interrupted === true,
  );
  assert.equal(f.context.connectionQueue.active, 2);
});

test("批量日常注入梦境购买与已检查记录，并使用当前账号", async () => {
  const f = fixture({
    runImpl: async ({ id, callbacks, options }) => {
      const result = await options.runDreamShopPurchases({
        tokenId: id,
        checkActive: () => {
          if (callbacks.shouldStop()) throw new Error("已停止");
        },
        sleep: async () => {},
        log: () => {},
      });
      assert.equal(result.status, "completed");
      options.onDreamShopChecked({ tokenId: id, roleId: 99, taskDay: 123 });
      return { incomplete: 0, failed: 0 };
    },
  });
  await f.startBatch();
  assert.equal(f.state.dreamCalls, 1);
  assert.equal(f.state.marks.length, 1);
  assert.equal(f.state.marks[0].roleId, 99);
  assert.ok(
    f.state.sent.some(
      (call) => call.id === "account-a" && call.cmd === "role_getroleinfo",
    ),
  );
  assert.equal(f.context.tokenStatus.value["account-a"], "completed");
});

test("定时任务保留角色设置快照，关闭和缺失开关都不擅自开启购买", async () => {
  for (const saved of [{ dreamShopPurchase: false }, { bossTimes: 1 }]) {
    const f = fixture({
      runImpl: async ({ accountSettings, options, id }) => {
        if (accountSettings?.dreamShopPurchase === true)
          await options.runDreamShopPurchases({
            tokenId: id,
            checkActive() {},
            sleep: async () => {},
            log() {},
          });
        return { incomplete: 0, failed: 0 };
      },
    });
    f.context.activeScheduledRun.value = {
      accountSettings: { "account-a": saved },
    };
    await f.startBatch();
    assert.equal(f.state.dreamCalls, 0);
    assert.equal(
      f.state.receivedSettings.dreamShopPurchase,
      saved.dreamShopPurchase,
    );
  }
});

test("断开又重连即使客户端不变，也停止后续梦境购买", async () => {
  const f = fixture({
    runImpl: async ({ id, options, context, state }) => {
      context.runDailyDreamPurchase = async (purchase) => {
        purchase.checkActive();
        state.connected = false;
        state.connected = true;
        purchase.checkActive();
        await purchase.send("dungeon_buymerchant", {});
      };
      await options.runDreamShopPurchases({
        tokenId: id,
        checkActive() {},
        sleep: async () => {},
        log() {},
      });
      return { incomplete: 0, failed: 0 };
    },
  });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "stopped");
  assert.equal(
    f.state.sent.some((call) => call.cmd === "dungeon_buymerchant"),
    false,
  );
  assert.equal(f.state.closed, 0);
});

test("批量任务创建的连接被替换后，不能关闭用户的新客户端", async () => {
  const f = fixture({
    connected: false,
    runImpl: async ({ context }) => {
      context.tokenStore.wsConnections["account-a"] = {
        client: { socket: {} },
      };
      return { incomplete: 0, failed: 0 };
    },
  });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "stopped");
  assert.equal(f.state.closed, 0);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.ok(f.context.tokenStore.wsConnections["account-a"]);
});

test("同一客户端 socket 被替换后停止，不关闭新的 socket", async () => {
  const f = fixture({
    connected: false,
    runImpl: async ({ context, callbacks }) => {
      context.tokenStore.wsConnections["account-a"].client.socket = {};
      assert.equal(callbacks.shouldStop(), true);
      return { incomplete: 0, failed: 0 };
    },
  });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "stopped");
  assert.equal(f.state.closed, 0);
  assert.equal(f.context.connectionQueue.active, 1);
});

test("步骤失败时，即使 incomplete 为零也不能报告全部成功", async () => {
  const f = fixture({ failed: 1 });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "pending");
  assert.ok(
    f.logs.some(
      (entry) => entry.type === "warning" && /1 个步骤失败/.test(entry.message),
    ),
  );
});

test("只读批量领奖连接跳过角色和战斗初始化请求", async () => {
  const f = fixture({ connected: false });
  await f.ensureConnection("account-a", 2, null, null, null, {
    skipInitialization: true,
  });
  assert.deepEqual(f.state.sent, []);
});

test("批量梦境按钮随北京时间跨日实时更新", () => {
  const dayDeclarations = source.statements
    .filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((declaration) =>
          ["shanghaiNow", "ismengjingActivityOpen"].includes(
            declaration.name.getText(source),
          ),
        ),
    )
    .map((statement) => statement.getText(source))
    .join("\n");
  const now = ref(Date.parse("2026-11-10T15:59:00Z"));
  const scope = { useShanghaiClock: () => now, computed, isDungeonOpen };
  vm.createContext(scope);
  vm.runInContext(
    `${dayDeclarations}\nglobalThis.status = ismengjingActivityOpen;`,
    scope,
  );
  assert.equal(scope.status.value, false);
  now.value = Date.parse("2026-11-10T16:00:00Z");
  assert.equal(scope.status.value, true);
});

test("定时梦境开放判断读取执行当刻，而不是上一分钟 UI 状态", () => {
  let condition;
  const visit = (node) => {
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(source).includes('"batchmengjing"') &&
      node.expression.getText(source).includes('"batchBuyDreamItems"')
    )
      condition = node.expression.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(condition, "missing scheduled dream gate");
  let instant = Date.parse("2026-11-10T15:59:00Z");
  const scope = {
    isDungeonOpen: () => isDungeonOpen(instant),
    ismengjingActivityOpen: { value: false },
  };
  vm.createContext(scope);
  vm.runInContext(`globalThis.skip = (taskName) => (${condition});`, scope);
  assert.equal(scope.skip("batchmengjing"), true);
  instant = Date.parse("2026-11-10T16:00:00Z");
  assert.equal(scope.skip("batchmengjing"), false);
  assert.equal(scope.skip("batchBuyDreamItems"), false);
});
