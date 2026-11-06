import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const component = await readFile(
  new URL("../src/components/GameStatus.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
const source = ts.createSourceFile(
  "GameStatus.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "openReminder",
    ),
);
assert.ok(declaration);
function fixture() {
  let ready = false;
  let observer;
  const events = [];
  const target = {
    isConnected: true,
    querySelector: () => (ready ? {} : null),
    focus: () => events.push("focus"),
    scrollIntoView: () => events.push("scroll"),
  };
  const context = {
    activeSection: { value: "daily" },
    dreamInitialTab: { value: "battle" },
    dreamObserver: undefined,
    nextTick: async () => {},
    document: { getElementById: () => target },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observer = this;
      }
      observe() {}
      disconnect() {
        events.push("disconnect");
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.run = openReminder;`,
    context,
  );
  return {
    context,
    events,
    setReady: () => {
      ready = true;
    },
    notify: () => observer.callback(),
  };
}
test("dream navigation waits for the actual purchase controls before positioning", async () => {
  const f = fixture();
  await f.context.run("dream");
  assert.equal(f.context.activeSection.value, "tools");
  assert.equal(f.context.dreamInitialTab.value, "buy");
  assert.equal(f.events.includes("scroll"), false);
  f.setReady();
  f.notify();
  assert.deepEqual(f.events.slice(-2), ["focus", "scroll"]);
});
test("leaving tools before the async card loads cancels positioning", async () => {
  const f = fixture();
  await f.context.run("dream");
  f.context.activeSection.value = "daily";
  f.setReady();
  f.notify();
  assert.equal(f.events.includes("scroll"), false);
});

const router = await readFile(
  new URL("../src/router/index.js", import.meta.url),
  "utf8",
);
const routerSource = ts.createSourceFile(
  "router.js",
  router,
  ts.ScriptTarget.Latest,
  true,
);
let scrollMethod;
function find(node) {
  if (
    ts.isMethodDeclaration(node) &&
    node.name?.getText(routerSource) === "scrollBehavior"
  )
    scrollMethod = node.getText(routerSource);
  ts.forEachChild(node, find);
}
find(routerSource);
assert.ok(scrollMethod);
const scrollBehavior = vm.runInNewContext(`({${scrollMethod}}).scrollBehavior`);
test("router does not reset scroll for the dream reminder", () => {
  assert.equal(
    scrollBehavior({ query: { reminder: "dream" } }, {}, null),
    false,
  );
  assert.equal(scrollBehavior({ query: {} }, {}, null).top, 0);
});
