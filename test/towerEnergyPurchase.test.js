import assert from "node:assert/strict";
import test from "node:test";
import {
  createTowerPurchaseSession,
  purchaseTowerEnergy,
} from "../src/utils/towerEnergyPurchase.js";

function fixture({
  failPurchase = false,
  failRefresh = false,
  switchAfterPurchase = false,
  missingEnergy = false,
} = {}) {
  const calls = [];
  let active = true;
  const tokenStore = {
    async sendMessageWithPromise(id, command, params) {
      calls.push({ id, command, params });
      if (command === "tower_buyenergy" || command === "evotower_buyenergy") {
        if (failPurchase) throw new Error("timeout");
        if (switchAfterPurchase) active = false;
        return {};
      }
      if (failRefresh) throw new Error("timeout");
      if (missingEnergy) return {};
      if (command === "role_getroleinfo")
        return { role: { tower: { energy: 7 } } };
      if (command === "evotower_getinfo") return { evoTower: { energy: 9 } };
      throw new Error(`unexpected ${command}`);
    },
  };
  const checkSession = () => {
    if (!active) throw new Error("账号已切换");
  };
  return {
    calls,
    tokenStore,
    checkSession,
    switchAccount() {
      active = false;
    },
  };
}
const run = (f, kind, quantity = 2) =>
  purchaseTowerEnergy({
    tokenStore: f.tokenStore,
    tokenId: "old-account",
    kind,
    quantity,
    checkSession: f.checkSession,
  });

test("normal and weird tower purchase with the right parameters and refresh the same account", async () => {
  for (const [kind, command, params, read, energy] of [
    ["normal", "tower_buyenergy", { buyNum: 2 }, "role_getroleinfo", 7],
    ["weird", "evotower_buyenergy", { energy: 2 }, "evotower_getinfo", 9],
  ]) {
    const f = fixture();
    assert.deepEqual(await run(f, kind), { status: "confirmed", energy });
    assert.deepEqual(
      f.calls.map((call) => call.command),
      [command, read],
    );
    assert.deepEqual(f.calls[0].params, params);
    assert.ok(f.calls.every((call) => call.id === "old-account"));
  }
});

test("a timed-out purchase is uncertain and is never automatically retried", async () => {
  const f = fixture({ failPurchase: true });
  const result = await run(f, "normal");
  assert.equal(result.status, "uncertain");
  assert.equal(f.calls.length, 1);
});

test("switching before purchase sends nothing; switching after acknowledgement cannot refresh the new account", async () => {
  const before = fixture();
  before.switchAccount();
  await assert.rejects(run(before, "normal"), /账号已切换/);
  assert.equal(before.calls.length, 0);
  const after = fixture({ switchAfterPurchase: true });
  assert.deepEqual(await run(after, "weird"), {
    status: "confirmed-unrefreshed",
  });
  assert.equal(after.calls.length, 1);
});

test("a failed or incomplete refresh never fabricates the amount", async () => {
  for (const options of [{ failRefresh: true }, { missingEnergy: true }]) {
    const f = fixture(options);
    assert.deepEqual(await run(f, "normal"), {
      status: "confirmed-unrefreshed",
    });
  }
});

test("invalid quantities are rejected before sending", async () => {
  const f = fixture();
  for (const amount of [0, 101, 1.5, Number.NaN])
    await assert.rejects(run(f, "normal", amount), /整数/);
  assert.equal(f.calls.length, 0);
});

test("reconnecting the same account after opening the dialog invalidates confirmation", async () => {
  const calls = [];
  const store = {
    selectedToken: { id: "account" },
    wsConnections: { account: { client: {} } },
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(...args) {
      calls.push(args);
    },
  };
  const session = createTowerPurchaseSession(store);
  store.wsConnections.account.client = {};
  await assert.rejects(
    purchaseTowerEnergy({
      tokenStore: store,
      ...session,
      kind: "normal",
      quantity: 1,
    }),
    /账号或连接已变化/,
  );
  assert.equal(calls.length, 0);
});
