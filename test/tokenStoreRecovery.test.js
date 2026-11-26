import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
import * as accountIdentity from "../src/utils/accountIdentity.js";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";
import { loadModule } from "./helpers/loadModule.js";

async function fixture(options = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const logger = new Proxy({}, { get: () => () => {} });
  const values = options.values || new Map();
  const timers = new Map();
  const intervals = new Map();
  const clients = [];
  const sent = [];
  const listeners = {};
  const removedListeners = [];
  const network = {
    onLine: true,
    ...(options.locks ? { locks: options.locks } : {}),
  };
  let nextTimer = 0;
  let nextInterval = 0;
  const clock = options.now
    ? class extends Date {
        constructor(...args) {
          super(...(args.length ? args : [options.now()]));
        }
        static now() {
          return options.now();
        }
      }
    : Date;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const module = await loadModule(
    new URL("../src/stores/tokenStore.ts", import.meta.url),
    {
      "@/utils/accountIdentity.js": accountIdentity,
      "@vueuse/core": { useLocalStorage: (_key, value) => vue.ref(value) },
      pinia: { defineStore },
      vue,
      "@/hooks/useIndexedDB": {
        default: () => ({
          getArrayBuffer: options.getArrayBuffer || (() => {}),
          error: options.idbError,
          storeArrayBuffer() {},
          deleteArrayBuffer() {},
          clearAll() {},
        }),
      },
      "@/router": {
        default: { currentRoute: { value: { path: "/admin/game-features" } } },
      },
      "@/utils/accountGameData": accountData,
      "@/utils/bonProtocol": { g_utils: {} },
      "@/utils/connectionRecovery": {
        createConnectionRecovery: (options) =>
          createConnectionRecovery({
            ...options,
            setTimer: (fn, delay) => {
              const id = ++nextTimer;
              timers.set(id, { fn, delay });
              return id;
            },
            clearTimer: (id) => timers.delete(id),
          }),
      },
      "@/utils/logger": {
        gameLogger: logger,
        tokenLogger: logger,
        wsLogger: logger,
      },
      "@/utils/randomSeed": { generateRandomSeed: () => 1 },
      "@/utils/token": {
        fetchTokenPayloadFromUrl:
          options.fetchTokenPayloadFromUrl ||
          (async () => ({ token: "test-token-refreshed-long" })),
        scheduleAuthUserRequest: (callback) => callback(),
        setAuthUserRateLimiterCallback() {},
        transformToken: options.transformToken || (() => {}),
      },
      "@/utils/wechatForceLogout": {
        refreshTokenFromCombUser() {},
        roleIndexFromServerId() {},
      },
      "@/utils/xyzwWebSocket": {
        XyzwWebSocketClient: class {
          constructor({ url }) {
            this.socket = null;
            this.url = url;
            clients.push(this);
          }
          setMessageListener(listener) {
            this.listener = listener;
          }
          init() {
            if (!options.deferClient?.(clients.length)) this.onConnect();
          }
          disconnect() {
            this.socket = null;
          }
          send(cmd) {
            sent.push(cmd);
          }
          sendHeartbeat() {
            sent.push("heartbeat");
          }
        },
      },
      "./events/index.js": { $emit: { emit() {} }, emitPlus() {} },
    },
    {
      AbortController,
      Date: clock,
      WebSocket: { CLOSED: 3 },
      localStorage: storage,
      navigator: network,
      setTimeout: options.setTimeout || setTimeout,
      clearTimeout: options.clearTimeout || clearTimeout,
      setInterval: (fn, delay) => {
        const id = ++nextInterval;
        intervals.set(id, { fn, delay });
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
      window: {
        location: { href: "http://127.0.0.1/" },
        addEventListener: (name, fn) => {
          listeners[name] = fn;
        },
        removeEventListener: (name, fn) => {
          removedListeners.push([name, fn]);
          if (listeners[name] === fn) delete listeners[name];
        },
      },
      document: {
        visibilityState: "visible",
        addEventListener: (name, fn) => {
          listeners[name] = fn;
        },
        removeEventListener() {},
      },
    },
  );
  module.gameTokens.value = [
    { id: "alpha", name: "Alpha", token: "test-token-alpha-long" },
    { id: "beta", name: "Beta", token: "test-token-beta-long" },
  ];
  module.selectedTokenId.value = "alpha";
  const store = module.useTokenStore();
  if (!options.skipInitial)
    await store.createWebSocketConnection("alpha", "test-token-alpha-long");
  const runNext = async () => {
    const [id, timer] = timers.entries().next().value || [];
    assert.ok(timer);
    timers.delete(id);
    await timer.fn();
  };
  return {
    pinia,
    module,
    store,
    clients,
    sent,
    values,
    timers,
    intervals,
    listeners,
    removedListeners,
    runNext,
    network,
  };
}

test("an unexpected close reconnects only the selected account without replaying game actions", async () => {
  const f = await fixture();
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).action,
    "connected",
  );
  await f.clients[0].onDisconnect({ code: 1006 });
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).action,
    "disconnected",
  );
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
  assert.deepEqual(f.sent, ["role_getroleinfo", "role_getroleinfo"]);
});

test("manual disconnect cancels recovery and returning to the page does not reconnect", async () => {
  const f = await fixture();
  await f.clients[0].onDisconnect({ code: 1006 });
  f.store.closeWebSocketConnection("alpha");
  f.listeners.visibilitychange();
  assert.equal(f.timers.size, 0);
  assert.equal(f.clients.length, 1);
});

test("switching the selected account cancels the old account's retry", async () => {
  const f = await fixture();
  await f.clients[0].onDisconnect({ code: 1006 });
  f.module.selectedTokenId.value = "beta";
  assert.equal(f.timers.size, 0);
  assert.equal(f.store.connectionRecoveryStatus.alpha, undefined);
  assert.equal(f.clients.length, 1);
});

test("offline connection waits without opening sockets and resumes once online", async () => {
  const f = await fixture();
  f.network.onLine = false;
  await f.clients[0].onDisconnect({ code: 1006 });
  assert.equal([...f.timers.values()][0].delay, 60000);
  await f.runNext();
  assert.equal(f.clients.length, 1);
  f.network.onLine = true;
  f.listeners.online();
  assert.equal([...f.timers.values()][0].delay, 0);
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
  assert.deepEqual(f.sent, ["role_getroleinfo", "role_getroleinfo"]);
});

test("other tab retains ownership until it releases the connection", async () => {
  const f = await fixture();
  await f.clients[0].onDisconnect({ code: 1006 });
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  await f.runNext();
  assert.equal(f.clients.length, 1);
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.values.delete("ws_connection_alpha");
  await f.runNext();
  assert.equal(f.clients.length, 2);
});

test("重复创建不会关闭当前账号已经建立的连接", async () => {
  const f = await fixture();
  const first = f.clients[0];
  const result = await f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  assert.equal(result, null);
  assert.equal(f.clients.length, 1);
  assert.equal(vue.toRaw(f.store.wsConnections.alpha.client), first);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.deepEqual(f.sent, ["role_getroleinfo"]);
});

test("连接进行中再次创建不会取代正在握手的客户端", async () => {
  const f = await fixture({ skipInitial: true, deferClient: () => true });
  const first = await f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  assert.equal(f.store.getWebSocketStatus("alpha"), "connecting");
  const duplicate = f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  f.clients[0].onConnect();
  assert.equal(await duplicate, null);
  assert.equal(f.clients.length, 1);
  assert.equal(vue.toRaw(f.store.wsConnections.alpha.client), first);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
});

test("首个请求等待标签页锁时，后来的请求不会重建已连接的客户端", async () => {
  let release;
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const locks = {
    request(_name, _options, callback) {
      if (++calls === 1) {
        entered();
        return new Promise((resolve) => {
          release = () => resolve(callback({}));
        });
      }
      return Promise.resolve().then(() => callback({}));
    },
  };
  const f = await fixture({ locks, skipInitial: true });
  const first = f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  await ready;
  const second = f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  release();
  await first;
  assert.equal(await second, null);
  assert.equal(f.clients.length, 1);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
});

function controlledLeaseTimers() {
  const timers = new Map();
  let nextId = 100000;
  return {
    setTimeout(fn, delay) {
      if (delay !== 10000) return setTimeout(fn, delay);
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      if (timers.has(id)) timers.delete(id);
      else clearTimeout(id);
    },
    expire() {
      const [id, fn] = timers.entries().next().value || [];
      assert.ok(fn, "应存在连接协调超时");
      timers.delete(id);
      fn();
    },
  };
}

test("等待跨标签页锁超时后会重试，迟到的锁回调不会创建连接", async () => {
  const timers = controlledLeaseTimers();
  let release;
  let signal;
  const locks = {
    request(_name, options, callback) {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        release = () => Promise.resolve().then(callback).then(resolve, reject);
      });
    },
  };
  const f = await fixture({ locks, skipInitial: true, ...timers });
  const attempt = f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  await Promise.resolve();
  timers.expire();
  assert.equal(await attempt, null);
  assert.equal(signal.aborted, true);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.clients.length, 0);
});

test("握手后等待标签页锁超时不会一直显示连接中", async () => {
  const timers = controlledLeaseTimers();
  let count = 0;
  let releaseHandshake;
  const locks = {
    request(_name, _options, callback) {
      if (++count === 1) return Promise.resolve().then(callback);
      return new Promise((resolve, reject) => {
        releaseHandshake = () =>
          Promise.resolve().then(callback).then(resolve, reject);
      });
    },
  };
  const f = await fixture({ locks, skipInitial: true, ...timers });
  await f.store.createWebSocketConnection("alpha", "test-token-alpha-long");
  assert.equal(f.store.getWebSocketStatus("alpha"), "connecting");
  timers.expire();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.deepEqual(f.sent, []);
  releaseHandshake();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.deepEqual(f.sent, []);
});

test("锁超时后旧连接关闭才完成时，会恢复重试而不继续过期请求", async () => {
  const lease = controlledLeaseTimers();
  const pendingCloseTimers = new Map();
  let nextCloseTimer = 200000;
  let disconnectStarted;
  const started = new Promise((resolve) => {
    disconnectStarted = resolve;
  });
  const locks = {
    request(_name, _options, callback) {
      return Promise.resolve().then(callback);
    },
  };
  const f = await fixture({
    locks,
    skipInitial: true,
    setTimeout(fn, delay) {
      if (delay === 100 || delay === 5000) {
        const id = ++nextCloseTimer;
        pendingCloseTimers.set(id, { fn, delay });
        return id;
      }
      return lease.setTimeout(fn, delay);
    },
    clearTimeout(id) {
      if (pendingCloseTimers.has(id)) pendingCloseTimers.delete(id);
      else lease.clearTimeout(id);
    },
  });
  const oldSocket = { readyState: 1 };
  f.store.wsConnections.alpha = {
    status: "disconnected",
    client: {
      socket: oldSocket,
      disconnect: () => disconnectStarted(),
    },
  };
  const attempt = f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  await started;
  lease.expire();
  assert.equal(await attempt, null);
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnecting");
  oldSocket.readyState = 3;
  const [id, poll] = [...pendingCloseTimers.entries()].find(
    ([, timer]) => timer.delay === 100,
  );
  pendingCloseTimers.delete(id);
  poll.fn();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal([...f.timers.values()][0].delay, 0);
  assert.equal(f.clients.length, 0);
});

test("首次连接被其他标签页占用时等待释放并自动重试", async () => {
  const f = await fixture({ skipInitial: true });
  f.store.initConnectionCoordination();
  assert.equal(f.module.gameTokens.value.length, 2);
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  assert.equal(
    await f.store.createWebSocketConnection("alpha", "test-token-alpha-long"),
    null,
  );
  assert.equal(f.store.isConnectionActiveInAnotherTab("alpha"), true);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal([...f.timers.values()][0].delay, 60000);
  assert.equal(f.clients.length, 0);

  f.values.delete("ws_connection_alpha");
  f.listeners.storage({ key: "ws_connection_alpha", newValue: null });
  assert.equal([...f.timers.values()][0].delay, 0);
  await f.runNext();
  assert.equal(f.clients.length, 1);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
});

test("其他标签页主动断开并广播状态时立即重试", async () => {
  const f = await fixture({ skipInitial: true });
  const state = {
    sessionId: "other-tab",
    action: "connected",
    timestamp: Date.now(),
  };
  f.values.set("ws_connection_alpha", JSON.stringify(state));
  await f.store.createWebSocketConnection("alpha", "test-token-alpha-long");
  assert.equal([...f.timers.values()][0].delay, 60000);
  state.action = "disconnected";
  const newValue = JSON.stringify(state);
  f.values.set("ws_connection_alpha", newValue);
  f.listeners.storage({ key: "ws_connection_alpha", newValue });
  assert.equal([...f.timers.values()][0].delay, 0);
  await f.runNext();
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(f.clients.length, 1);
});

test("用户手动断开后其他页面释放连接也不会自动重连", async () => {
  const f = await fixture({ skipInitial: true });
  f.store.initConnectionCoordination();
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  await f.store.createWebSocketConnection("alpha", "test-token-alpha-long");
  f.store.closeWebSocketConnection("alpha");
  f.values.delete("ws_connection_alpha");
  f.listeners.storage({ key: "ws_connection_alpha", newValue: null });
  assert.equal(f.timers.size, 0);
  assert.equal(f.clients.length, 0);
});

test("heartbeats renew only the current tab's lease", async () => {
  const f = await fixture();
  const state = JSON.parse(f.values.get("ws_connection_alpha"));
  state.timestamp = Date.now() - 20000;
  f.values.set("ws_connection_alpha", JSON.stringify(state));
  f.clients[0].onHeartbeat();
  assert.ok(
    JSON.parse(f.values.get("ws_connection_alpha")).timestamp > state.timestamp,
  );
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now() - 20000,
    }),
  );
  f.clients[0].onHeartbeat();
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).sessionId,
    "other-tab",
  );
});

test("a different browser tab's connected state is not overwritten when closing locally", async () => {
  const f = await fixture();
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  f.store.closeWebSocketConnection("alpha");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).sessionId,
    "other-tab",
  );
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).action,
    "connected",
  );
});

test("connection records and errors redact WebSocket query credentials", async () => {
  const f = await fixture();
  assert.equal(
    f.store.wsConnections.alpha.wsUrl,
    "wss://xxz-xyzw.hortorgames.com/agent",
  );
  assert.equal(f.store.wsConnections.alpha.wsUrl.includes("?"), false);
  f.clients[0].onError(new Error("boom"));
  assert.equal(
    f.store.wsConnections.alpha.lastError.url,
    "wss://xxz-xyzw.hortorgames.com/agent",
  );
});

test("removeToken resets selectedTokenId to empty string and cleans group and recovery state", async () => {
  const f = await fixture();
  const group = f.store.createTokenGroup("Group 1");
  f.store.addTokenToGroup(group.id, "alpha");
  await f.clients[0].onDisconnect({ code: 1006 });
  assert.equal(f.timers.size, 1);

  await f.store.removeToken("alpha");

  assert.equal(f.module.selectedTokenId.value, "");
  assert.deepEqual(Array.from(f.store.getGroupTokenIds(group.id)), []);
  assert.equal(f.timers.size, 0);
  assert.equal(f.values.has("ws_connection_alpha"), false);
});

test("initTokenStore cleans up monitor interval and storage listener on scope dispose", async () => {
  const f = await fixture();
  f.store.initTokenStore();
  assert.equal(f.intervals.size, 1);
  assert.equal(typeof f.listeners.storage, "function");

  await f.store.devTools.forceCleanup();
  assert.deepEqual(Array.from(f.store.devTools.showConnectionLocks()), []);
  assert.deepEqual(Array.from(f.store.devTools.showCrossTabStates()), []);

  f.pinia._e.stop();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.listeners.storage, undefined);
  assert.ok(f.removedListeners.some(([name]) => name === "storage"));
});

test("首次握手异常先用原 Token 重试，成功后不刷新凭据", async () => {
  let refreshes = 0;
  const f = await fixture({
    deferClient: (count) => count === 1,
    fetchTokenPayloadFromUrl: async () => {
      refreshes++;
      return { token: "test-token-refreshed-long" };
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";

  await f.clients[0].onDisconnect({ code: 1006, reason: "连接握手超时" });
  assert.equal(refreshes, 0);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.clients[1].url, f.clients[0].url);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(refreshes, 0);
});

test("业务回包或模糊的过期文字不会中断正常连接", async () => {
  let refreshes = 0;
  const f = await fixture({
    fetchTokenPayloadFromUrl: async () => {
      refreshes++;
      return { token: "test-token-refreshed-long" };
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  for (const packet of [
    { error: "Token has not expired" },
    { error: "activity reward token expired" },
    { cmd: "apex_getguesslistresp", error: "token expired" },
    { resp: 2, error: "token expired" },
  ]) {
    await f.clients[0].listener(packet);
    assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  }
  assert.equal(refreshes, 0);
  assert.equal(f.store.connectionRecoveryStatus.alpha, undefined);
});

test("连续握手失败后可刷新 Token，创建被另一页阻挡后仍会重试", async () => {
  const f = await fixture({ deferClient: (count) => count <= 2 });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  await f.clients[0].onDisconnect({ code: 1006 });
  await f.runNext();
  await f.clients[1].onDisconnect({ code: 1006 });
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.module.gameTokens.value[0].token, "test-token-refreshed-long");
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.values.delete("ws_connection_alpha");
  await f.runNext();
  assert.equal(f.clients.length, 3);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
});

test("刷新来源不可用时握手兜底只尝试一次，仍按断线继续重连", async () => {
  let refreshes = 0;
  const f = await fixture({
    deferClient: (count) => count <= 3,
    fetchTokenPayloadFromUrl: async () => {
      refreshes++;
      throw Object.assign(new Error("HTTP 状态码：401"), { status: 401 });
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";

  for (let i = 0; i < 3; i++) {
    await f.clients[i].onDisconnect({ code: 1006 });
    assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);
    assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
    await f.runNext();
  }
  assert.equal(refreshes, 1);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
});

test("Token 刷新长时间无响应时仍安排恢复重试", async () => {
  let resolveRefresh;
  const f = await fixture({
    fetchTokenPayloadFromUrl: () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  const pending = f.clients[0].listener({ error: "token expired" });
  await Promise.resolve();
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal([...f.timers.values()][0].delay, 15000);
  await f.runNext();
  assert.equal(f.clients.length, 2);
  resolveRefresh({ token: "test-token-refreshed-long" });
  await pending;
});

test("扫码账号明确被拒后，BIN 换取凭据暂时超时会继续恢复", async () => {
  let now = Date.now();
  let refreshes = 0;
  const f = await fixture({
    now: () => now,
    getArrayBuffer: async () => new ArrayBuffer(8),
    transformToken: async () => {
      if (++refreshes === 1) {
        throw Object.assign(new Error("请求超时"), {
          isAxiosError: true,
          code: "ECONNABORTED",
        });
      }
      return "test-token-refreshed-long";
    },
  });
  f.module.gameTokens.value[0].importMethod = "wxQrcode";
  const rejection = { error: "token expired" };
  await f.clients[0].listener(rejection);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);

  now += 15000;
  await f.runNext();
  await f.clients[1].listener(rejection);
  await f.runNext();
  assert.equal(refreshes, 2);
  assert.ok(f.clients[2].url.includes("test-token-refreshed-long"));
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
});

test("自定义刷新来源的 HTTP 401 只提示查看账号管理", async () => {
  const f = await fixture({
    fetchTokenPayloadFromUrl: async () => {
      throw Object.assign(new Error("HTTP 状态码：401"), { status: 401 });
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(
    f.store.getConnectionCredentialRecovery("alpha"),
    "refresh-unavailable",
  );
  assert.equal(f.timers.size, 0);
});

test("无法确认的刷新响应保留自动恢复，不提示重新登录", async () => {
  const f = await fixture({ fetchTokenPayloadFromUrl: async () => ({}) });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.timers.size, 1);
});

test("本地 BIN 缺失时只提示查看账号管理", async () => {
  const f = await fixture();
  f.module.gameTokens.value[0].importMethod = "wxQrcode";
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(
    f.store.getConnectionCredentialRecovery("alpha"),
    "refresh-unavailable",
  );
  assert.equal(f.timers.size, 0);
  assert.equal(f.module.gameTokens.value.length, 2);
});

test("本地数据库读取暂时失败时继续自动恢复", async () => {
  const f = await fixture({ idbError: vue.ref("暂时无法读取数据库") });
  f.module.gameTokens.value[0].importMethod = "wxQrcode";
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.timers.size, 1);
});

test("游戏登录接口明确返回登录凭据过期时提示重新登录", async () => {
  const f = await fixture({
    getArrayBuffer: async () => new ArrayBuffer(8),
    transformToken: async () => {
      throw Object.assign(new Error("登录凭据校验失败：token expired"), {
        loginErrorReason: "token expired",
      });
    },
  });
  f.module.gameTokens.value[0].importMethod = "wxQrcode";
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(
    f.store.getConnectionCredentialRecovery("alpha"),
    "relogin-required",
  );
  assert.equal(f.timers.size, 0);
  assert.equal(f.module.gameTokens.value.length, 2);
});

test("连续握手失败时，暂时无法换取凭据后还能再次刷新", async () => {
  let now = Date.now();
  let refreshes = 0;
  const f = await fixture({
    now: () => now,
    deferClient: (count) => count <= 3,
    fetchTokenPayloadFromUrl: async () => {
      if (++refreshes === 1) {
        throw Object.assign(new Error("HTTP 状态码：503"), { status: 503 });
      }
      return { token: "test-token-refreshed-long" };
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  for (let i = 0; i < 3; i++) {
    await f.clients[i].onDisconnect({ code: 1006 });
    assert.notEqual(
      f.store.getConnectionCredentialRecovery("alpha"),
      "relogin-required",
    );
    now += 15000;
    await f.runNext();
  }
  assert.equal(refreshes, 2);
  assert.ok(f.clients[3].url.includes("test-token-refreshed-long"));
});

test("新连接再次遭拒时，冷却期保留恢复而不要求重新登录", async () => {
  let now = Date.now();
  let refreshes = 0;
  const f = await fixture({
    now: () => now,
    fetchTokenPayloadFromUrl: async () => ({
      token: `test-token-refreshed-long-${++refreshes}`,
    }),
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  const rejection = { error: "token expired" };
  await f.clients[0].listener(rejection);
  await f.runNext();
  await f.clients[1].listener(rejection);
  assert.equal(refreshes, 1);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);

  now += 15000;
  await f.runNext();
  await f.clients[2].listener(rejection);
  await f.runNext();
  assert.equal(refreshes, 2);
  assert.ok(f.clients[3].url.includes("test-token-refreshed-long-2"));
});

test("刷新等待期间手动断开不会在刷新完成后恢复连接", async () => {
  let resolveRefresh;
  const f = await fixture({
    fetchTokenPayloadFromUrl: () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  const pending = f.clients[0].listener({ error: "token expired" });
  await Promise.resolve();
  f.store.closeWebSocketConnection("alpha");
  resolveRefresh({ token: "test-token-refreshed-long" });
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.timers.size, 0);
  assert.equal(f.clients.length, 1);
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
});

test("收到 Token 过期消息后的自动刷新同样标记恢复并等待新连接", async () => {
  const f = await fixture();
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.clients.length, 1);
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
  assert.deepEqual(f.sent, ["role_getroleinfo", "role_getroleinfo"]);
});

test("重复认证拒绝和重连后的同一凭据只发起一次在途刷新", async () => {
  let refreshes = 0;
  let resolveRefresh;
  const f = await fixture({
    fetchTokenPayloadFromUrl: () => {
      refreshes++;
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  const rejection = { error: "Token has expired." };
  const first = f.clients[0].listener(rejection);
  await f.clients[0].listener(rejection);
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), "refreshing");
  assert.equal(refreshes, 1);
  assert.equal(f.timers.size, 1);

  await f.runNext();
  const afterWatchdog = f.clients[1].listener(rejection);
  assert.equal(refreshes, 1);
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), "refreshing");
  resolveRefresh({ token: "test-token-refreshed-long" });
  await Promise.all([first, afterWatchdog]);
  await f.runNext();
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);
  assert.notEqual(f.clients[2].url, f.clients[0].url);
});

test("手动账号无自动来源时显示中性提示，更新凭据后提示消失", async () => {
  const f = await fixture();
  await f.clients[0].onDisconnect({ code: 1008, reason: "Token has expired." });
  assert.equal(
    f.store.getConnectionCredentialRecovery("alpha"),
    "refresh-unavailable",
  );
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  f.listeners.visibilitychange();
  assert.equal(f.timers.size, 0);

  f.store.updateToken("alpha", { token: "test-token-refreshed-long" });
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);
  f.listeners.visibilitychange();
  await f.runNext();
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
});

test("旧凭据被拒绝时用已更新的凭据重连，不会再刷新新凭据", async () => {
  let refreshes = 0;
  const f = await fixture({
    fetchTokenPayloadFromUrl: async () => {
      refreshes++;
      return { token: "unexpected-token-refreshed-long" };
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  f.store.updateToken("alpha", { token: "new-imported-token-long" });
  await f.clients[0].listener({ error: "token expired" });
  assert.equal(refreshes, 0);
  assert.equal(f.store.getConnectionCredentialRecovery("alpha"), undefined);
  await f.runNext();
  assert.ok(f.clients[1].url.includes("new-imported-token-long"));
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
});

test("多个标签页通过跨标签锁原子领取连接，只有一个创建客户端", async () => {
  const values = new Map();
  const lockNames = [];
  let tail = Promise.resolve();
  const locks = {
    request(name, _options, callback) {
      lockNames.push(name);
      const result = tail.then(() => callback({}));
      tail = result.then(() => {});
      return result;
    },
  };
  const a = await fixture({ values, locks, skipInitial: true });
  const b = await fixture({ values, locks, skipInitial: true });
  await Promise.all([
    a.store.createWebSocketConnection("alpha", "test-token-alpha-long"),
    b.store.createWebSocketConnection("alpha", "test-token-alpha-long"),
  ]);
  assert.equal(a.clients.length + b.clients.length, 1);
  assert.equal(lockNames.length, 3); // two claims, then the winner's handshake
  assert.ok(lockNames.every((name) => name === lockNames[0]));
});

test("后台页面恢复后发现租约被其他标签页接管时关闭旧连接", async () => {
  const f = await fixture();
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  f.clients[0].onHeartbeat();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).sessionId,
    "other-tab",
  );
});

test("用户断开时，等待跨标签锁的连接不能随后启动", async () => {
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const locks = {
    request: async (_name, _options, callback) => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      return callback({});
    },
  };
  const f = await fixture({ locks, skipInitial: true });
  const attempt = f.store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  await waiting;
  f.store.closeWebSocketConnection("alpha");
  release();
  await attempt;
  assert.equal(f.clients.length, 0);
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
});

test("自动恢复等待跨标签锁期间 A→B→A，旧请求失效且不影响新的恢复", async () => {
  const f = await fixture();
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  let count = 0;
  f.network.locks = {
    request: async (_name, _options, callback) => {
      if (++count === 1) {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return callback({});
    },
  };
  await f.clients[0].onDisconnect({ code: 1006 });
  const oldAttempt = f.runNext();
  await waiting;
  f.module.selectedTokenId.value = "beta";
  f.module.selectedTokenId.value = "alpha";
  f.listeners.visibilitychange();
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  release();
  await oldAttempt;
  assert.equal(f.clients.length, 1);
  assert.equal(f.timers.size, 1);
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
  assert.deepEqual(f.sent, ["role_getroleinfo", "role_getroleinfo"]);
});

test("自动恢复已创建客户端后 A→B→A，迟到的连接回调不能恢复旧请求", async () => {
  const f = await fixture({ deferClient: (count) => count === 2 });
  await f.clients[0].onDisconnect({ code: 1006 });
  await f.runNext();
  assert.equal(f.store.getWebSocketStatus("alpha"), "connecting");
  f.module.selectedTokenId.value = "beta";
  f.module.selectedTokenId.value = "alpha";
  f.listeners.visibilitychange();
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  f.clients[1].onConnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.notEqual(f.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.deepEqual(f.sent, ["role_getroleinfo"]);
  await f.runNext();
  assert.equal(f.clients.length, 3);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
  assert.deepEqual(f.sent, ["role_getroleinfo", "role_getroleinfo"]);
});

test("过期连接的迟到断线回调不会刷新 Token 或扰乱新的恢复", async () => {
  let refreshes = 0;
  const f = await fixture({
    deferClient: (count) => count === 2,
    fetchTokenPayloadFromUrl: async () => {
      refreshes++;
      return { token: "test-token-refreshed-long" };
    },
  });
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  await f.clients[0].onDisconnect({ code: 1006 });
  await f.runNext();
  f.module.selectedTokenId.value = "beta";
  f.module.selectedTokenId.value = "alpha";
  f.listeners.visibilitychange();
  await f.clients[1].onDisconnect({ code: 1006 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshes, 0);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  await f.runNext();
  assert.equal(f.clients.length, 3);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
});

test("握手期间租约已被其他页面接管时，迟到连接不能覆盖租约或初始化", async () => {
  const f = await fixture({ skipInitial: true, deferClient: () => true });
  await f.store.createWebSocketConnection("alpha", "test-token-alpha-long");
  assert.equal(f.store.getWebSocketStatus("alpha"), "connecting");
  f.values.set(
    "ws_connection_alpha",
    JSON.stringify({
      sessionId: "other-tab",
      action: "connected",
      timestamp: Date.now(),
    }),
  );
  f.clients[0].onConnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).sessionId,
    "other-tab",
  );
  assert.deepEqual(f.sent, []);
});

test("两页用同一跨标签锁：过期租约被 B 接管后 A 的迟到握手不能覆盖 B", async () => {
  const values = new Map();
  let tail = Promise.resolve();
  const locks = {
    request(_name, _options, callback) {
      const result = tail.then(() => callback({}));
      tail = result.then(() => {});
      return result;
    },
  };
  const a = await fixture({
    values,
    locks,
    skipInitial: true,
    deferClient: () => true,
  });
  const b = await fixture({ values, locks, skipInitial: true });
  await a.store.createWebSocketConnection("alpha", "test-token-alpha-long");
  const original = JSON.parse(values.get("ws_connection_alpha"));
  original.timestamp = Date.now() - 121000;
  values.set("ws_connection_alpha", JSON.stringify(original));
  await b.store.createWebSocketConnection("alpha", "test-token-alpha-long");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const active = JSON.parse(values.get("ws_connection_alpha"));
  assert.notEqual(active.sessionId, original.sessionId);
  assert.equal(active.action, "connected");
  a.clients[0].onConnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(a.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(b.store.getWebSocketStatus("alpha"), "connected");
  assert.equal(
    JSON.parse(values.get("ws_connection_alpha")).sessionId,
    active.sessionId,
  );
  assert.deepEqual(a.sent, []);
  assert.deepEqual(b.sent, ["role_getroleinfo"]);
});
