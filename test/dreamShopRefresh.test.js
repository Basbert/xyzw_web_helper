import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const component = await readFile(
  new URL("../src/components/cards/DreamHelperCard.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
const source = ts.createSourceFile(
  "DreamHelperCard.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "refreshMerchantList",
);
assert.ok(declaration);
function setup({ change = false } = {}) {
  const calls = [];
  const ctx = {
    isDungeonOpen: () => true,
    merchantDataLoaded: { value: true },
    merchantData: { value: {} },
    levelId: { value: 0 },
    message: { warning() {}, success() {} },
    tokenStore: {
      selectedToken: { id: "a" },
      getWebSocketStatus: () => "connected",
      async sendMessageWithPromise(id, command) {
        calls.push({ id, command });
        if (change) ctx.tokenStore.selectedToken = { id: "b" };
        return { role: { levelId: 99, dungeon: { merchant: { 1: [2] } } } };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.run = refreshMerchantList;`,
    ctx,
  );
  return { ctx, calls };
}
test("viewing dream shop uses a read-only request without selecting a formation", async () => {
  const f = setup();
  await f.ctx.run();
  assert.deepEqual(f.calls, [{ id: "a", command: "role_getroleinfo" }]);
  assert.equal(f.ctx.merchantDataLoaded.value, true);
});
test("a late response cannot show the previous account's shop", async () => {
  const f = setup({ change: true });
  await f.ctx.run();
  assert.equal(f.ctx.merchantDataLoaded.value, false);
});
