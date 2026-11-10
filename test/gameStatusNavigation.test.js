import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { computed, effectScope, ref, watch } from "vue";

const component = await readFile(
  new URL("../src/components/GameStatus.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "GameStatus.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set([
  "ENABLE_TOOLS_TAB",
  "activeSection",
  "navigationGroups",
  "lastVisitedSections",
  "activeNavigationGroup",
  "activeNavigationSections",
  "tenHallVisited",
]);
const statements = source.statements.filter((node) => {
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.some((decl) =>
      names.has(decl.name.getText(source)),
    );
  return (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(source) === "watch" &&
    node.expression.arguments[0]?.getText(source) === "activeSection"
  );
});
assert.equal(statements.length, names.size + 1);

function fixture() {
  const context = { computed, ref, watch };
  const scope = effectScope();
  vm.createContext(context);
  scope.run(() =>
    vm.runInContext(
      `${statements.map((node) => node.getText(source)).join("\n")}\nglobalThis.nav = { activeSection, navigationGroups, activeNavigationGroup, activeNavigationSections, tenHallVisited };`,
      context,
    ),
  );
  return { ...context.nav, stop: () => scope.stop() };
}

test("导航分为六组，保留每个已有功能入口", () => {
  const nav = fixture();
  const groups = nav.navigationGroups.value;
  assert.equal(
    groups.map((group) => group.label).join("、"),
    "日常、十殿与切磋、赛事与排行、俱乐部、活动、工具",
  );
  const all = groups.flatMap((group) =>
    group.sections.map((section) => section.value),
  );
  assert.equal(new Set(all).size, 11);
  for (const id of [
    "daily",
    "tenHall",
    "fightPvp",
    "apexChallengeGroup",
    "campChallengeGroup",
    "saltFieldGroup",
    "peachGroup",
    "rankGroup",
    "club",
    "activity",
    "tools",
  ])
    assert.ok(all.includes(id), id);
  nav.stop();
});

test("切换分组时记住各组最近的子页", () => {
  const nav = fixture();
  nav.activeNavigationGroup.value = "battle";
  assert.equal(nav.activeSection.value, "tenHall");
  nav.activeSection.value = "fightPvp";
  nav.activeNavigationGroup.value = "events";
  assert.equal(nav.activeSection.value, "apexChallengeGroup");
  nav.activeSection.value = "campChallengeGroup";
  nav.activeNavigationGroup.value = "daily";
  nav.activeNavigationGroup.value = "battle";
  assert.equal(nav.activeSection.value, "fightPvp");
  nav.activeNavigationGroup.value = "events";
  assert.equal(nav.activeSection.value, "campChallengeGroup");
  nav.stop();
});

test("提醒与竞猜跳转直接切换原有 section 时同步导航分组", () => {
  const nav = fixture();
  nav.activeSection.value = "campChallengeGroup";
  assert.equal(nav.activeNavigationGroup.value, "events");
  nav.activeSection.value = "tools";
  assert.equal(nav.activeNavigationGroup.value, "tools");
  nav.activeSection.value = "apexChallengeGroup";
  assert.equal(nav.activeNavigationGroup.value, "events");
  assert.equal(nav.activeNavigationSections.value.length, 5);
  nav.stop();
});

test("访问模拟十殿之后切换分组仍保留已访问状态", () => {
  const nav = fixture();
  assert.equal(nav.tenHallVisited.value, false);
  nav.activeSection.value = "tenHall";
  nav.activeSection.value = "daily";
  assert.equal(nav.tenHallVisited.value, true);
  nav.stop();
});

test("导航使用原生按钮及可见焦点，支持键盘操作", () => {
  const template = component.slice(0, component.indexOf("<script setup>"));
  const start = template.indexOf('<nav class="section-navigation"');
  const end = template.indexOf("</nav>", start);
  const nav = template.slice(start, end);
  assert.match(nav, /aria-label="游戏功能分类"/);
  assert.equal((nav.match(/<button/g) || []).length, 2);
  assert.equal((nav.match(/type="button"/g) || []).length, 2);
  assert.equal((nav.match(/:aria-pressed=/g) || []).length, 2);
  assert.match(component, /\.section-navigation button:focus-visible/);
});
