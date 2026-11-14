import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
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
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const module = await loadModule(
    new URL("../src/stores/tokenStore.ts", import.meta.url),
    {
      "@vueuse/core": { useLocalStorage: (_key, value) => vue.ref(value) },
      pinia: { defineStore },
      vue,
      "@/hooks/useIndexedDB": {
        default: () => ({
          getArrayBuffer() {},
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
        transformToken() {},
      },
      "@/utils/wechatForceLogout": {
        refreshTokenFromCombUser() {},
        roleIndexFromServerId() {},
      },
      "@/utils/xyzwWebSocket": {
        XyzwWebSocketClient: class {
          constructor() {
            this.socket = null;
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
      localStorage: storage,
      navigator: network,
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

test("握手失败后刷新 Token 先标记恢复，创建被另一页阻挡后仍会重试", async () => {
  const f = await fixture();
  f.module.gameTokens.value[0].importMethod = "url";
  f.module.gameTokens.value[0].sourceUrl = "https://example.invalid/token";
  f.store.wsConnections.alpha.connectedAt = null;
  await f.clients[0].onDisconnect({ code: 1006 });
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
  assert.equal(f.clients.length, 1);
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.values.delete("ws_connection_alpha");
  await f.runNext();
  assert.equal(f.clients.length, 2);
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
  f.store.wsConnections.alpha.connectedAt = null;
  const pending = f.clients[0].onDisconnect({ code: 1006 });
  await Promise.resolve();
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal([...f.timers.values()][0].delay, 15000);
  await f.runNext();
  assert.equal(f.clients.length, 2);
  resolveRefresh({ token: "test-token-refreshed-long" });
  await pending;
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
  f.store.wsConnections.alpha.connectedAt = null;
  const pending = f.clients[0].onDisconnect({ code: 1006 });
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
  f.clients[0].listener({ error: "token expired" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.store.connectionRecoveryStatus.alpha, "waiting");
  assert.equal(f.clients.length, 1);
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.store.connectionRecoveryStatus.alpha, "restored");
  assert.deepEqual(f.sent, ["role_getroleinfo", "role_getroleinfo"]);
});

test("多个标签页通过跨标签锁原子领取连接，只有一个创建客户端", async () => {
  const values = new Map();
  const lockNames = [];
  let tail = Promise.resolve();
  const locks = {
    request(name, callback) {
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
    request: async (_name, callback) => {
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
    request: async (_name, callback) => {
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
    request(_name, callback) {
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
