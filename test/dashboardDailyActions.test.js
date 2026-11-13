import assert from "node:assert/strict";
import { test } from "node:test";
import { effectScope, reactive } from "vue";
import { useDashboardDailyActions } from "../src/composables/useDashboardDailyActions.js";

function fixture() {
  const client = {};
  const store = reactive({
    selectedToken: { id: "a", name: "角色 A" },
    wsConnections: { a: { client }, b: { client: {} } },
    status: "connected",
    getWebSocketStatus() {
      return this.status;
    },
  });
  const scope = effectScope();
  const calls = [];
  let finish;
  const execute = (args) => {
    calls.push(args);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const api = scope.run(() =>
    useDashboardDailyActions(store, {
      readSettings: () => ({ dreamShopPurchase: true, commandDelay: 500 }),
      executeDaily: execute,
      executeMaintenance: execute,
    }),
  );
  return { api, calls, store, scope, finish: (value) => finish(value) };
}

test("首页操作显式发起并锁定角色和当次设置，重复点击不会重叠", async () => {
  const f = fixture();
  const pending = f.api.run("daily");
  await f.api.run("maintenance");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].tokenId, "a");
  assert.equal(f.calls[0].settings.dreamShopPurchase, true);
  f.finish({ incomplete: 0, failed: 0, skipped: 0 });
  await pending;
  assert.equal(f.api.results.a.type, "success");
  f.scope.stop();
});

test("A→B→A、断线、离页均让正在运行的操作保持停止状态", async () => {
  for (const invalidate of [
    (f) => {
      f.store.selectedToken = { id: "b" };
      f.store.selectedToken = { id: "a" };
    },
    (f) => {
      f.store.status = "disconnected";
      f.store.status = "connected";
    },
    (f) => f.scope.stop(),
  ]) {
    const f = fixture();
    const pending = f.api.run("maintenance");
    const args = f.calls[0];
    assert.equal(args.shouldStop(), false);
    invalidate(f);
    assert.equal(args.shouldStop(), true);
    f.finish({ remaining: 0, sent: 0, legacy: { status: "acknowledged" } });
    await pending;
    assert.notEqual(f.api.results.a?.type, "success");
    f.scope.stop();
  }
});

test("切换账号后旧账号结果不会显示给新账号", async () => {
  const f = fixture();
  const pending = f.api.run("daily");
  f.store.selectedToken = { id: "b", name: "角色 B" };
  f.finish({ incomplete: 0, failed: 0, skipped: 0 });
  await pending;
  assert.equal(f.api.results.b, undefined);
  assert.equal(f.api.results.a.type, "warning");
  f.scope.stop();
});

test("读取设置失败时不发送日常请求", async () => {
  const f = fixture();
  f.scope.stop();
  const scope = effectScope();
  const api = scope.run(() =>
    useDashboardDailyActions(f.store, {
      readSettings: () => {
        throw new Error("存储不可用");
      },
      executeDaily: () => {
        throw new Error("不应执行");
      },
      executeMaintenance: () => {},
    }),
  );
  await api.run("daily");
  assert.equal(api.results.a.type, "error");
  assert.match(api.results.a.text, /设置|存储/);
  scope.stop();
});

test("手动停止后阻止后续操作，即使回包成功也不误报完成", async () => {
  const f = fixture();
  const pending = f.api.run("maintenance");
  f.api.stop();
  assert.equal(f.calls[0].shouldStop(), true);
  f.finish({ remaining: 0, sent: 0, legacy: { status: "acknowledged" } });
  await pending;
  assert.equal(f.api.results.a.type, "warning");
  assert.match(f.api.results.a.text, /已停止/);
  f.scope.stop();
});

test("服务端结果不完整时不误报完成", async () => {
  const f = fixture();
  const pending = f.api.run("daily");
  f.finish({});
  await pending;
  assert.equal(f.api.results.a.type, "error");
  assert.match(f.api.results.a.text, /结果不完整/);
  f.scope.stop();
});

test("首页每日摘要显示服务器跳过的步骤数", async () => {
  const f = fixture();
  const pending = f.api.run("daily");
  f.finish({ incomplete: 0, failed: 0, skipped: 3 });
  await pending;
  assert.match(f.api.results.a.text, /跳过 3/);
  f.scope.stop();
});
