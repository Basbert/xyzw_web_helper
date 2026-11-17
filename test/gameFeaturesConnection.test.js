import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

const url = new URL("../src/views/GameFeatures.vue", import.meta.url);
const source = await readFile(url, "utf8");
const { descriptor } = parse(source);
const script = compileScript(descriptor, { id: "game-features-connection" });
const { outputText } = ts.transpileModule(script.content, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: url.pathname,
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(createConnection, otherTab = false) {
  const notifications = [];
  const mounted = [];
  const unmounted = [];
  const calls = [];
  const store = vue.reactive({
    selectedToken: { id: "a", token: "fixture-a", wsUrl: "wss://fixture" },
    statuses: { a: "disconnected", b: "disconnected" },
    wsConnections: {},
    connectionRecoveryStatus: {},
    initConnectionCoordination: () => calls.push("init"),
    getWebSocketStatus(id) {
      return this.statuses[id] || "disconnected";
    },
    isConnectionActiveInAnotherTab: () => otherTab,
    createWebSocketConnection: (...args) => {
      calls.push(args);
      return createConnection(...args);
    },
    closeWebSocketConnection: () => {},
    sendMessage: () => {},
    sendMessageWithPromise: async () => ({}),
    setBattleVersion: () => {},
  });
  const message = Object.fromEntries(
    ["info", "warning", "error", "success"].map((type) => [
      type,
      (text) => notifications.push({ type, text }),
    ]),
  );
  const dependencies = {
    "@vicons/ionicons5": { CloudDone: {} },
    "naive-ui": { useMessage: () => message },
    vue: {
      ...vue,
      onMounted: (fn) => mounted.push(fn),
      onUnmounted: (fn) => unmounted.push(fn),
    },
    "vue-router": { useRouter: () => ({ push() {} }) },
    "@/stores/tokenStore": { useTokenStore: () => store },
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    console,
    require(name) {
      if (!Object.hasOwn(dependencies, name))
        throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const scope = vue.effectScope(true);
  let bindings;
  scope.run(() => {
    bindings = exports.default.setup({}, { expose() {} });
  });
  return {
    bindings,
    calls,
    notifications,
    store,
    mount: () => mounted.forEach((fn) => fn()),
    cleanup: () => {
      unmounted.forEach((fn) => fn());
      scope.stop();
    },
  };
}

test("连接过程使用实时状态，不重复创建或显示误导性的固定提示", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  try {
    const first = f.bindings.connectWebSocket();
    await f.bindings.connectWebSocket();
    assert.equal(f.bindings.connectionStatus.value, "connecting");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.notifications, []);
    f.store.statuses.a = "connected";
    gate.resolve({});
    await first;
    assert.equal(f.bindings.connectionStatus.value, "connected");
    assert.deepEqual(f.notifications, []);
  } finally {
    f.cleanup();
  }
});

test("未建立连接时给出可操作的原因，而不误报连接成功", async () => {
  for (const otherTab of [false, true]) {
    const f = fixture(async () => null, otherTab);
    try {
      await f.bindings.connectWebSocket();
      assert.equal(f.bindings.connectionStatus.value, "disconnected");
      assert.equal(f.notifications.length, 1);
      assert.equal(f.notifications[0].type, "warning");
      assert.match(
        f.notifications[0].text,
        otherTab ? /另一个助手页面/ : /网络或账号状态/,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("账号切换或离开页面后，旧连接结果不再弹出提示", async () => {
  for (const change of ["switch", "unmount"]) {
    const gate = deferred();
    const f = fixture(() => gate.promise);
    try {
      const attempt = f.bindings.connectWebSocket();
      if (change === "switch") f.store.selectedToken = { id: "b" };
      else f.cleanup();
      gate.resolve(null);
      await attempt;
      assert.deepEqual(f.notifications, []);
      if (change === "switch")
        assert.equal(f.bindings.connectionStatus.value, "disconnected");
    } finally {
      if (change !== "unmount") f.cleanup();
    }
  }
});

test("页面打开时自动初始化连接协调，不展示固定的连接提示", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  try {
    f.mount();
    assert.equal(f.calls[0], "init");
    assert.equal(f.bindings.connectionStatus.value, "connecting");
    assert.deepEqual(f.notifications, []);
    f.store.statuses.a = "connected";
    gate.resolve({});
    await vue.nextTick();
  } finally {
    f.cleanup();
  }
});
