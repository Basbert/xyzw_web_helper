import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "vue/compiler-sfc";

const component = await readFile(
  new URL("../src/views/Dashboard.vue", import.meta.url),
  "utf8",
);
const { descriptor } = parse(component);
const setup = descriptor.scriptSetup?.content;
assert.ok(setup && descriptor.template?.ast);
const source = ts.createSourceFile(
  "Dashboard.js",
  setup,
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

function elementNodes(node, output = []) {
  if (node?.type === 1) output.push(node);
  for (const child of node?.children || []) elementNodes(child, output);
  return output;
}

const nodes = elementNodes(descriptor.template.ast);
const items = nodes.filter((node) =>
  node.props.some(
    (prop) =>
      prop.type === 6 &&
      prop.name === "class" &&
      prop.value?.content === "today-item",
  ),
);

test("首页三个日常入口是可键盘使用的按钮，并保留普通入口", () => {
  assert.equal(items.length, 3);
  const clicks = items.map((item) => {
    assert.equal(item.tag, "button");
    assert.ok(
      item.props.some(
        (prop) =>
          prop.type === 6 &&
          prop.name === "type" &&
          prop.value?.content === "button",
      ),
    );
    return item.props.find(
      (prop) =>
        prop.type === 7 && prop.name === "on" && prop.arg?.content === "click",
    )?.exp?.content;
  });
  assert.deepEqual(clicks, [
    "openDailyTarget('tasks')",
    "openDailyTarget('maintenance')",
    "openDailyTarget('apex')",
  ]);
  assert.ok(
    nodes.some(
      (node) =>
        node.tag === "n-button" &&
        node.props.some(
          (prop) =>
            prop.type === 7 &&
            prop.name === "on" &&
            prop.arg?.content === "click" &&
            prop.exp?.content === "router.push('/admin/game-features')",
        ),
    ),
  );
  assert.match(descriptor.styles[0].content, /button:focus-visible/);
});

test("日常入口只导航到指定区域，不触发游戏操作", () => {
  const destinations = [];
  const context = { router: { push: (route) => destinations.push(route) } };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.open = openDailyTarget;`,
    context,
  );
  for (const target of ["tasks", "maintenance", "apex", "unknown"])
    context.open(target);
  assert.equal(destinations.length, 3);
  for (const [i, target] of ["tasks", "maintenance", "apex"].entries()) {
    assert.equal(destinations[i].path, "/admin/game-features");
    assert.equal(destinations[i].query.daily, target);
  }
});

const routerSource = ts.createSourceFile(
  "router.js",
  await readFile(new URL("../src/router/index.js", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let scrollMethod;
function findScroll(node) {
  if (
    ts.isMethodDeclaration(node) &&
    node.name?.getText(routerSource) === "scrollBehavior"
  )
    scrollMethod = node.getText(routerSource);
  ts.forEachChild(node, findScroll);
}
findScroll(routerSource);
assert.ok(scrollMethod);
const scrollBehavior = vm.runInNewContext(`({${scrollMethod}}).scrollBehavior`);

test("仅合法日常区域保留组件定位，非法查询恢复通常滚动行为", () => {
  const saved = { left: 2, top: 88 };
  for (const daily of ["tasks", "maintenance", "apex"])
    assert.equal(
      scrollBehavior(
        { path: "/admin/game-features", query: { daily } },
        {},
        saved,
      ),
      false,
    );
  assert.equal(
    scrollBehavior(
      { path: "/admin/game-features", query: { daily: "invalid" } },
      {},
      saved,
    ),
    saved,
  );
  assert.equal(
    scrollBehavior(
      { path: "/admin/game-features", query: { daily: ["tasks", "apex"] } },
      {},
      null,
    ).top,
    0,
  );
  assert.equal(
    scrollBehavior(
      { path: "/admin/dashboard", query: { daily: "tasks" } },
      {},
      null,
    ).top,
    0,
  );
  assert.equal(
    scrollBehavior({ query: { reminder: "dream" } }, {}, null),
    false,
  );
});
