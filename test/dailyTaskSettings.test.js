import assert from "node:assert/strict";
import { test } from "node:test";
import { effectScope, reactive } from "vue";
import {
  readDailyTaskSettings,
  readDailyTaskSettingsForExecution,
  resetDailyTaskSettings,
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

function bind(store, storage, onError = () => {}, controls = {}) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const scope = effectScope();
  const settings = scope.run(() =>
    useDailyTaskSettings(store, onError, controls),
  );
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

test("用户明确重置后清除损坏的隐藏字段，消费开关保持关闭", () => {
  const storage = memoryStorage();
  const token = { id: "a", roleId: "r" };
  const invalid = JSON.stringify({
    payRecruit: false,
    freeGachaEnable: "false",
    towerFormation: "wrong",
  });
  storage.setItem("daily-role-settings:r", invalid);
  storage.setItem("daily-settings:a", invalid);
  assert.throws(
    () => readDailyTaskSettingsForExecution(token, [token], storage),
    /设置.*无效/,
  );
  assert.equal(storage.getItem("daily-settings:a"), invalid);
  resetDailyTaskSettings(token, storage);
  const saved = readDailyTaskSettingsForExecution(token, [token], storage);
  assert.equal(saved.payRecruit, false);
  assert.equal(saved.blackMarketPurchase, false);
  assert.equal(saved.dreamShopPurchase, false);
  assert.equal(Object.hasOwn(saved, "freeGachaEnable"), false);
  assert.equal(Object.hasOwn(saved, "towerFormation"), false);
  assert.equal(
    storage.getItem("daily-settings:a"),
    storage.getItem("daily-role-settings:r"),
  );
});

test("用户点击修复后表单与两份记录一致，不因逐项同步写入旧付费值", () => {
  const storage = memoryStorage();
  const token = { id: "a", roleId: "r" };
  storage.setItem(
    "daily-settings:a",
    JSON.stringify({ freeGachaEnable: "false" }),
  );
  const controls = {};
  const binding = bind(
    reactive({ selectedToken: token, gameTokens: [token] }),
    storage,
    () => {},
    controls,
  );
  controls.reset();
  assert.equal(binding.settings.payRecruit, false);
  assert.equal(binding.settings.blackMarketPurchase, false);
  assert.equal(binding.settings.dreamShopPurchase, false);
  assert.equal(
    readDailyTaskSettingsForExecution(token, [token], storage).payRecruit,
    false,
  );
  binding.stop();
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

test("执行前不覆盖互相冲突的角色和当前 Token 设置", () => {
  const storage = memoryStorage();
  const token = { id: "a", roleId: "r" };
  const stable = JSON.stringify({ payRecruit: true });
  const current = JSON.stringify({ payRecruit: false });
  storage.setItem("daily-role-settings:r", stable);
  storage.setItem("daily-settings:a", current);
  assert.throws(
    () => readDailyTaskSettingsForExecution(token, [token], storage),
    /设置.*冲突/,
  );
  assert.equal(storage.getItem("daily-role-settings:r"), stable);
  assert.equal(storage.getItem("daily-settings:a"), current);
});

test("打开日常设置遇到损坏或冲突时不覆盖原记录，也不默认开启消费选项", () => {
  for (const [stable, current] of [
    [null, "{"],
    [
      JSON.stringify({ payRecruit: true }),
      JSON.stringify({ payRecruit: false }),
    ],
  ]) {
    const storage = memoryStorage();
    if (stable) storage.setItem("daily-role-settings:r", stable);
    storage.setItem("daily-settings:a", current);
    const token = { id: "a", roleId: "r" };
    const errors = [];
    const binding = bind(
      reactive({ selectedToken: token, gameTokens: [token] }),
      storage,
      (error) => errors.push(error.message),
    );
    assert.equal(binding.settings.payRecruit, false);
    assert.equal(binding.settings.blackMarketPurchase, false);
    assert.equal(binding.settings.dreamShopPurchase, false);
    assert.equal(storage.getItem("daily-role-settings:r"), stable);
    assert.equal(storage.getItem("daily-settings:a"), current);
    assert.equal(errors.length, 1);
    binding.stop();
  }
});
