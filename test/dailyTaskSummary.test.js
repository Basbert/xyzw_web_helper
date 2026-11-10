import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { computed, effectScope, reactive, ref } from "vue";
import { useDailyTaskSettings } from "../src/utils/dailyTaskSettings.js";
import { isDungeonOpen } from "../src/utils/dreamConstants.js";

const component = await readFile(
  new URL("../src/components/Daily/DailyTaskStatus.vue", import.meta.url),
  "utf8",
);
const setup = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(setup);
const parsed = ts.createSourceFile(
  "DailyTaskStatus.js",
  setup,
  ts.ScriptTarget.Latest,
  true,
);
const summaryDeclarations = parsed.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        ["shanghaiNow", "showDreamShopSummary"].includes(
          declaration.name.getText(parsed),
        ),
      ),
  )
  .map((statement) => statement.getText(parsed))
  .join("\n");

function fixture(initialTime) {
  const values = new Map();
  const oldStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  });
  const now = ref(initialTime);
  const store = reactive({
    selectedToken: { id: "a", roleId: 101 },
    gameTokens: [
      { id: "a", roleId: 101 },
      { id: "b", roleId: 102 },
    ],
  });
  const scope = effectScope();
  const settings = scope.run(() => useDailyTaskSettings(store));
  const sandbox = {
    computed,
    tokenStore: store,
    settings,
    isDungeonOpen,
    useShanghaiClock: () => now,
  };
  vm.createContext(sandbox);
  scope.run(() =>
    vm.runInContext(
      `${summaryDeclarations}\nglobalThis.visible = showDreamShopSummary;`,
      sandbox,
    ),
  );
  return {
    now,
    store,
    settings,
    visible: sandbox.visible,
    close() {
      scope.stop();
      if (oldStorage)
        Object.defineProperty(globalThis, "localStorage", oldStorage);
      else delete globalThis.localStorage;
    },
  };
}

test("摘要保留阵容和 BOSS，并仅使用开关与开放日展示梦境商店", () => {
  assert.match(
    component,
    /竞技场阵容\s*\{\{\s*settings\.arenaFormation\s*\}\}/,
  );
  assert.match(component, /settings\.bossTimes/);
  assert.match(component, /v-if="showDreamShopSummary"[^>]*>\s*· 含梦境商店/);
  const f = fixture(Date.parse("2026-11-11T04:00:00+08:00"));
  try {
    assert.equal(f.visible.value, true);
    f.settings.dreamShopPurchase = false;
    assert.equal(f.visible.value, false);
    f.settings.dreamShopPurchase = true;
    assert.equal(f.visible.value, true);
    f.store.selectedToken = null;
    assert.equal(f.visible.value, false);
  } finally {
    f.close();
  }
});

test("切换角色后显示该角色保存的开关，并随北京时间跨日更新", () => {
  const f = fixture(Date.parse("2026-11-10T15:59:00Z"));
  try {
    assert.equal(f.visible.value, false);
    f.now.value = Date.parse("2026-11-10T16:00:00Z");
    assert.equal(f.visible.value, true);
    f.settings.dreamShopPurchase = false;
    f.store.selectedToken = { id: "b", roleId: 102 };
    assert.equal(f.visible.value, true);
    f.store.selectedToken = { id: "a", roleId: 101 };
    assert.equal(f.visible.value, false);
    f.settings.dreamShopPurchase = true;
    f.now.value = Date.parse("2026-11-12T16:00:00Z");
    assert.equal(f.visible.value, false);
  } finally {
    f.close();
  }
});
