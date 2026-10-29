import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia, defineStore, setActivePinia } from "pinia";
import * as vue from "vue";
import * as accountData from "../src/utils/accountGameData.js";
import * as connectionRecovery from "../src/utils/connectionRecovery.js";
import { loadModule } from "./helpers/loadModule.js";

test("token store keeps role responses and battle versions with their own account", async () => {
  setActivePinia(createPinia());
  const logger = new Proxy({}, { get: () => () => {} });
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
      "@/utils/connectionRecovery": connectionRecovery,
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
          setMessageListener(listener) {
            this.listener = listener;
          }
          init() {}
        },
      },
      "./events/index.js": {
        $emit: { emit() {} },
        emitPlus(cmd, data) {
          if (cmd === "role_getroleinforesp")
            data.gameData.value.roleInfo = data.body;
        },
      },
    },
    {
      window: { location: { href: "http://127.0.0.1/" } },
      localStorage: { getItem: () => null },
    },
  );
  module.gameTokens.value = [
    { id: "alpha", roleId: "alpha" },
    { id: "beta", roleId: "beta" },
  ];
  module.selectedTokenId.value = "alpha";
  const store = module.useTokenStore();
  const calls = [];
  const client = (id) => ({
    async sendWithPromise(cmd, params) {
      calls.push({ id, cmd, params });
      return cmd === "role_getroleinfo" ? { role: { roleId: id } } : {};
    },
  });
  store.wsConnections = {
    alpha: { status: "connected", client: client("alpha") },
    beta: { status: "connected", client: client("beta") },
  };

  await store.sendGetRoleInfo("alpha", {}, 2);
  await store.sendGetRoleInfo("beta", {}, 2);
  assert.equal(store.gameData.roleInfo.role.roleId, "alpha");
  store.$patch((state) => {
    state.gameData = { ...state.gameData, presetTeam: { team: 3 } };
  });
  module.selectedTokenId.value = "beta";
  assert.equal(store.gameData.roleInfo.role.roleId, "beta");
  assert.equal(store.gameData.presetTeam, null);
  module.selectedTokenId.value = "alpha";
  assert.equal(store.gameData.presetTeam.team, 3);

  store.setBattleVersion(11, "alpha");
  store.setBattleVersion(22, "beta");
  await store.sendMessageWithPromise("alpha", "fight_starttower");
  await store.sendMessageWithPromise("beta", "fight_starttower");
  assert.equal(
    calls.find((call) => call.id === "alpha" && call.cmd === "fight_starttower")
      .params.battleVersion,
    11,
  );
  assert.equal(
    calls.find((call) => call.id === "beta" && call.cmd === "fight_starttower")
      .params.battleVersion,
    22,
  );

  store.wsConnections = {};
  const alpha = await store.createWebSocketConnection(
    "alpha",
    "test-token-alpha-long",
  );
  const beta = await store.createWebSocketConnection(
    "beta",
    "test-token-beta-long",
  );
  assert.ok(alpha && beta);
  alpha.listener({
    cmd: "role_getroleinforesp",
    getData: () => ({ role: { roleId: "alpha", power: 10 } }),
  });
  beta.listener({
    cmd: "role_getroleinforesp",
    getData: () => ({ role: { roleId: "beta", power: 20 } }),
  });
  assert.equal(store.gameData.roleInfo.role.power, 10);
  module.selectedTokenId.value = "beta";
  assert.equal(store.gameData.roleInfo.role.power, 20);
});
