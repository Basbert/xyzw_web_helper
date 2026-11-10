import assert from "node:assert/strict";
import { test } from "node:test";
import { createRenderer, h, reactive } from "vue";
import { useManualBatchRun } from "../src/composables/useManualBatchRun.js";
import { runFishBatch } from "../src/utils/manualBatchHelpers.js";

const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  parentNode: () => null,
  nextSibling: () => null,
});

test("账号切换后即便切回原账号，也不继续旧任务或显示旧结果", async () => {
  const calls = [];
  let finish;
  const clients = { a: {}, b: {} };
  const store = reactive({
    selectedToken: { id: "a" },
    status: "connected",
    getWebSocketStatus() {
      return this.status;
    },
    getWebSocketClient(id) {
      return clients[id];
    },
    sendMessageWithPromise(id, cmd) {
      calls.push([id, cmd]);
      if (cmd === "role_getroleinfo")
        return Promise.resolve({ role: { items: { 1011: { quantity: 20 } } } });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    sendMessage(id, cmd) {
      calls.push([id, cmd]);
    },
  });
  let helper;
  const app = renderer.createApp({
    setup() {
      helper = useManualBatchRun(store, { warning() {} });
      return () => h("div");
    },
  });
  app.mount({});
  const pending = helper.run(runFishBatch, { type: 1, requested: 20 });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    calls.map(([, cmd]) => cmd),
    ["role_getroleinfo", "artifact_lottery"],
  );
  store.selectedToken = { id: "b" };
  store.selectedToken = { id: "a" };
  finish({});
  await pending;
  assert.deepEqual(
    calls.map(([, cmd]) => cmd),
    ["role_getroleinfo", "artifact_lottery"],
  );
  assert.equal(helper.state.visible, false);
  assert.equal(helper.state.isRunning, false);
  app.unmount();
});

test("短暂断线后恢复也不会继续旧任务", async () => {
  const calls = [];
  let finish;
  const client = {};
  const store = reactive({
    selectedToken: { id: "a" },
    status: "connected",
    getWebSocketStatus() {
      return this.status;
    },
    getWebSocketClient() {
      return client;
    },
    sendMessageWithPromise(id, cmd) {
      calls.push(cmd);
      if (cmd === "role_getroleinfo")
        return Promise.resolve({ role: { items: { 1011: { quantity: 20 } } } });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    sendMessage() {
      throw new Error("断线后不应继续刷新");
    },
  });
  let helper;
  const app = renderer.createApp({
    setup() {
      helper = useManualBatchRun(store, { warning() {} });
      return () => h("div");
    },
  });
  app.mount({});
  const pending = helper.run(runFishBatch, { type: 1, requested: 20 });
  await Promise.resolve();
  await Promise.resolve();
  store.status = "disconnected";
  store.status = "connected";
  finish({});
  await pending;
  assert.deepEqual(calls, ["role_getroleinfo", "artifact_lottery"]);
  assert.equal(helper.state.visible, false);
  assert.equal(helper.state.isRunning, false);
  app.unmount();
});

test("切页卸载后仍等待旧请求结束，防止再次点击重叠消耗", async () => {
  const calls = [];
  const warnings = [];
  let finish;
  const client = {};
  const store = reactive({
    selectedToken: { id: "unmount-test" },
    getWebSocketStatus() {
      return "connected";
    },
    getWebSocketClient() {
      return client;
    },
    sendMessageWithPromise(id, cmd) {
      calls.push(cmd);
      if (cmd === "role_getroleinfo")
        return Promise.resolve({ role: { items: { 1011: { quantity: 20 } } } });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    sendMessage() {},
  });
  const mount = () => {
    let helper;
    const app = renderer.createApp({
      setup() {
        helper = useManualBatchRun(store, {
          warning: (value) => warnings.push(value),
        });
        return () => h("div");
      },
    });
    app.mount({});
    return { app, helper };
  };
  const first = mount();
  const pending = first.helper.run(runFishBatch, { type: 1, requested: 20 });
  await Promise.resolve();
  await Promise.resolve();
  first.app.unmount();
  const second = mount();
  await second.helper.run(runFishBatch, { type: 1, requested: 20 });
  assert.match(warnings[0], /上一项操作仍在结束/);
  assert.deepEqual(calls, ["role_getroleinfo", "artifact_lottery"]);
  finish({});
  await pending;
  second.app.unmount();
});

test("成功空回包只报告请求已获回包，不声称实际执行次数", async () => {
  const client = {};
  const store = reactive({
    selectedToken: { id: "empty-response" },
    getWebSocketStatus() {
      return "connected";
    },
    getWebSocketClient() {
      return client;
    },
    sendMessageWithPromise(id, cmd) {
      return Promise.resolve(
        cmd === "role_getroleinfo"
          ? { role: { items: { 1011: { quantity: 1 } } } }
          : {},
      );
    },
    sendMessage() {},
  });
  let helper;
  const app = renderer.createApp({
    setup() {
      helper = useManualBatchRun(store, { warning() {} });
      return () => h("div");
    },
  });
  app.mount({});
  await helper.run(runFishBatch, { type: 1, requested: 10 });
  assert.match(helper.state.result, /已获回包的请求共涉及 1\/1 次/);
  assert.match(helper.state.result, /实际结果以游戏内为准/);
  assert.doesNotMatch(helper.state.result, /已确认|已完成/);
  app.unmount();
});
