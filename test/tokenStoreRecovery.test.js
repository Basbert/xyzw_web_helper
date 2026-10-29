import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
import { createConnectionRecovery } from "../src/utils/connectionRecovery.js";
import { loadModule } from "./helpers/loadModule.js";

async function fixture() {
  setActivePinia(createPinia());
  const logger = new Proxy({}, { get: () => () => {} });
  const values = new Map();
  const timers = new Map();
  const clients = [];
  const sent = [];
  const listeners = {};
  let nextTimer = 0;
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
      window: {
        location: { href: "http://127.0.0.1/" },
        addEventListener: (name, fn) => {
          listeners[name] = fn;
        },
        removeEventListener() {},
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
  return { module, store, clients, sent, values, timers, listeners, runNext };
}

test("an unexpected close reconnects only the selected account without replaying game actions", async () => {
  const f = await fixture();
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).action,
    "connected",
  );
  await f.clients[0].onDisconnect({ code: 1006 });
  assert.equal(f.store.getWebSocketStatus("alpha"), "disconnected");
  assert.equal(
    JSON.parse(f.values.get("ws_connection_alpha")).action,
    "disconnected",
  );
  await f.runNext();
  assert.equal(f.clients.length, 2);
  assert.equal(f.store.getWebSocketStatus("alpha"), "connected");
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
  await f.runNext();
  assert.equal(f.clients.length, 1);
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
