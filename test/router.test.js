import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./helpers/loadModule.js";

async function createNavigationGuard(hasTokens = true) {
  let guard;
  const router = {
    beforeEach(callback) {
      guard = callback;
    },
  };
  await loadModule(
    new URL("../src/router/index.js", import.meta.url),
    {
      "vue-router": {
        createRouter: () => router,
        createWebHistory: () => ({}),
      },
      "vue-router/auto-routes": { routes: [] },
      "@/stores/tokenStore": {
        useTokenStore: () => ({ hasTokens, selectedToken: null }),
      },
      "@/utils/clubBattleUtils": { isNowInLegionWarTime: () => true },
    },
    { document: { title: "" } },
  );
  return guard;
}

test("legacy mock task routes open the real daily-task screen", async () => {
  const guard = await createNavigationGuard();
  for (const name of ["DailyTasks", "/DailyTasks"]) {
    let destination;
    guard({ name, path: "/admin/daily-tasks", meta: {} }, {}, (value) => {
      destination = value;
    });
    assert.equal(destination.name, "GameFeatures");
  }
});

test("game features still require an imported account", async () => {
  const guard = await createNavigationGuard(false);
  let destination;
  guard(
    {
      name: "GameFeatures",
      path: "/admin/game-features",
      meta: { requiresToken: true },
    },
    {},
    (value) => {
      destination = value;
    },
  );
  assert.equal(destination, "/tokens");
});
