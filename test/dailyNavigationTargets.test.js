import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const component = await readFile(
  new URL("../src/components/GameStatus.vue", import.meta.url),
  "utf8",
);
const source = ts.createSourceFile(
  "GameStatus.js",
  component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1],
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "openDailyTarget",
    ),
);
assert.ok(declaration);

function fixture(kind, nextTick = async () => {}) {
  const calls = [];
  const target = {
    open: false,
    focus: () => calls.push("focus"),
    scrollIntoView: () => calls.push("scroll"),
  };
  const context = {
    activeSection: { value: "tools" },
    route: { query: { daily: kind } },
    nextTick,
    document: {
      getElementById: (id) => {
        calls.push(id);
        return target;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.run = openDailyTarget;`,
    context,
  );
  return { context, target, calls };
}

test("首页三个快捷入口定位到日常区域，竞猜入口自动展开", async () => {
  for (const [kind, id] of [
    ["tasks", "daily-task-target"],
    ["maintenance", "daily-maintenance-target"],
    ["apex", "daily-apex-target"],
  ]) {
    const f = fixture(kind);
    await f.context.run(kind);
    assert.equal(f.context.activeSection.value, "daily");
    assert.equal(f.target.open, kind === "apex");
    assert.deepEqual(f.calls, [id, "focus", "scroll"]);
  }
});

test("无效入口与用户已切离页面时不会跳转定位", async () => {
  const invalid = fixture("__proto__");
  await invalid.context.run("__proto__");
  assert.equal(invalid.context.activeSection.value, "tools");
  assert.deepEqual(invalid.calls, []);
  let resume;
  const nextTick = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  const f = fixture("apex", nextTick);
  const pending = f.context.run("apex");
  f.context.activeSection.value = "tools";
  resume();
  await pending;
  assert.deepEqual(f.calls, []);
});
