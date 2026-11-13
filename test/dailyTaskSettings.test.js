import assert from "node:assert/strict";
import { test } from "node:test";
import { effectScope, reactive } from "vue";
import {
  readDailyTaskSettings,
  readDailyTaskSettingsForExecution,
  useDailyTaskSettings,
  writeDailyTaskSettings,
} from "../src/utils/dailyTaskSettings.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function bind(store, storage, onError = () => {}) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const scope = effectScope();
  const settings = scope.run(() => useDailyTaskSettings(store, onError));
  return { settings, stop: () => scope.stop() };
}

test("settings survive a page reload and preserve batch-only fields", () => {
  const storage = memoryStorage();
  const token = { id: "token-a", roleId: "role-a" };
  storage.setItem(
    "daily-settings:token-a",
    JSON.stringify({ towerFormation: 3 }),
  );
  const store = reactive({ selectedToken: token, gameTokens: [token] });
  const first = bind(store, storage);
  first.settings.arenaFormation = 4;
  first.settings.payRecruit = false;
  first.settings.commandDelay = 900;
  first.stop();

  const second = bind(store, storage);
  assert.equal(second.settings.arenaFormation, 4);
  assert.equal(second.settings.payRecruit, false);
  assert.equal(second.settings.commandDelay, 900);
  assert.equal(
    JSON.parse(storage.getItem("daily-settings:token-a")).towerFormation,
    3,
  );
  second.stop();
});

test("a reimported token for the same role restores the role's settings", () => {
  const storage = memoryStorage();
  const oldToken = { id: "old-token", roleId: 123 };
  const store = reactive({ selectedToken: oldToken, gameTokens: [oldToken] });
  const binding = bind(store, storage);
  binding.settings.bossTimes = 0;
  binding.settings.claimLegacy = false;

  const newToken = { id: "new-token", roleId: "123" };
  store.gameTokens = [newToken];
  store.selectedToken = newToken;
  assert.equal(binding.settings.bossTimes, 0);
  assert.equal(binding.settings.claimLegacy, false);
  assert.equal(
    JSON.parse(storage.getItem("daily-settings:new-token")).bossTimes,
    0,
  );
  binding.stop();
});

test("switching roles never writes the old role's choices over the new role", () => {
  const storage = memoryStorage();
  const a = { id: "token-a", roleId: "role-a" };
  const b = { id: "token-b", roleId: "role-b" };
  const store = reactive({ selectedToken: a, gameTokens: [a, b] });
  const binding = bind(store, storage);
  binding.settings.claimEmail = false;
  store.selectedToken = b;
  assert.equal(binding.settings.claimEmail, true);
  binding.settings.arenaFormation = 2;
  store.selectedToken = a;
  assert.equal(binding.settings.claimEmail, false);
  assert.equal(binding.settings.arenaFormation, 1);
  store.selectedToken = b;
  assert.equal(binding.settings.arenaFormation, 2);
  assert.equal(binding.settings.claimEmail, true);
  binding.stop();
});

test("settings restore when a role ID is discovered after connecting", () => {
  const storage = memoryStorage();
  writeDailyTaskSettings(
    { id: "old", roleId: "role-a" },
    { openBox: false },
    storage,
  );
  const pending = { id: "new", roleId: null };
  const store = reactive({ selectedToken: pending, gameTokens: [pending] });
  const binding = bind(store, storage);
  assert.equal(binding.settings.openBox, true);
  store.selectedToken.roleId = "role-a";
  assert.equal(binding.settings.openBox, false);
  binding.stop();
});

test("legacy token settings are migrated to the stable role identity", () => {
  const storage = memoryStorage();
  const oldToken = { id: "old", roleId: "role-a" };
  storage.setItem("daily-settings:old", JSON.stringify({ claimBottle: false }));
  assert.equal(
    readDailyTaskSettings(oldToken, [oldToken], storage).claimBottle,
    false,
  );
  const newToken = { id: "new", roleId: "role-a" };
  assert.equal(
    readDailyTaskSettings(newToken, [newToken], storage).claimBottle,
    false,
  );
});

test("conflicting legacy entries are not guessed for a new token", () => {
  const storage = memoryStorage();
  const oldA = { id: "old-a", roleId: "role-a" };
  const oldB = { id: "old-b", roleId: "role-a" };
  const newer = { id: "new", roleId: "role-a" };
  storage.setItem("daily-settings:old-a", JSON.stringify({ bossTimes: 1 }));
  storage.setItem("daily-settings:old-b", JSON.stringify({ bossTimes: 2 }));
  assert.equal(
    readDailyTaskSettings(newer, [oldA, oldB, newer], storage),
    null,
  );
});

test("a browser storage failure is surfaced to the settings view", () => {
  const storage = memoryStorage();
  storage.setItem = () => {
    throw new Error("storage unavailable");
  };
  const token = { id: "token-a", roleId: "role-a" };
  const store = reactive({ selectedToken: token, gameTokens: [token] });
  const errors = [];
  const binding = bind(store, storage, (error) => errors.push(error.message));
  binding.settings.claimEmail = false;
  assert.deepEqual(errors, ["storage unavailable"]);
  binding.stop();
});

test("梦境购买开关按角色保存且支持关闭", () => {
  const storage = memoryStorage();
  const a = { id: "a", roleId: "role-a" };
  const b = { id: "b", roleId: "role-b" };
  const store = reactive({ selectedToken: a, gameTokens: [a, b] });
  const binding = bind(store, storage);
  assert.equal(binding.settings.dreamShopPurchase, true);
  binding.settings.dreamShopPurchase = false;
  store.selectedToken = b;
  assert.equal(binding.settings.dreamShopPurchase, true);
  store.selectedToken = a;
  assert.equal(binding.settings.dreamShopPurchase, false);
  binding.stop();
});

test("首页区分首次无记录与损坏的设置，不静默开启默认付费选项", () => {
  const storage = memoryStorage();
  const token = { id: "a", roleId: "role-a" };
  assert.equal(
    readDailyTaskSettingsForExecution(token, [token], storage),
    null,
  );
  for (const invalid of [
    "",
    "{",
    "null",
    "[]",
    '{"dreamShopPurchase":"false"}',
    '{"payRecruit":null}',
  ]) {
    storage.setItem("daily-settings:a", invalid);
    assert.throws(
      () => readDailyTaskSettingsForExecution(token, [token], storage),
      /设置.*损坏|设置.*无效/,
    );
    storage.removeItem("daily-settings:a");
  }
  storage.setItem(
    "daily-role-settings:role-a",
    JSON.stringify({ dreamShopPurchase: false }),
  );
  storage.setItem("daily-settings:a", "{");
  assert.throws(
    () => readDailyTaskSettingsForExecution(token, [token], storage),
    /设置.*损坏/,
  );
});

test("首页不会将不同旧账号的冲突设置当作首次设置", () => {
  const storage = memoryStorage();
  const token = { id: "new", roleId: "r" };
  const oldA = { id: "old-a", roleId: "r" };
  const oldB = { id: "old-b", roleId: "r" };
  storage.setItem("daily-settings:old-a", JSON.stringify({ payRecruit: true }));
  storage.setItem(
    "daily-settings:old-b",
    JSON.stringify({ payRecruit: false }),
  );
  assert.throws(
    () =>
      readDailyTaskSettingsForExecution(token, [token, oldA, oldB], storage),
    /设置.*冲突/,
  );
});
