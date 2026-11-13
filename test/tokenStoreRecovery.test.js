import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";
import { loadModule } from "./helpers/loadModule.js";

async function fixture() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const logger = new Proxy({}, { get: () => () => {} });
  const values = new Map();
  const timers = new Map();
  const intervals = new Map();
  const clients = [];
  const sent = [];
  const listeners = {};
  const removedListeners = [];
  const network = { onLine: true };
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
      "@/router": { default: {} },
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
        scheduleAuthUserRequest() {},
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
          setMessageListener() {}
          init() {
            this.onConnect();
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
