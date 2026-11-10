import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as vue from "vue";
import {
  describeCampProgress,
  getReminderDays,
} from "../src/utils/dailyReminders.js";
import {
  isDreamShopChecked,
  markDreamShopChecked,
  subscribeDreamShopChecks,
} from "../src/utils/dreamShopCheckState.js";

const component = await readFile(
  new URL("../src/components/DailyActivityReminders.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "DailyActivityReminders.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const body = source.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(source))
  .join("\n");

test("提醒随当天成功检查、角色切换、北京时间跨日和跨标签更新", async () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const target = new EventTarget();
  const now = vue.ref(Date.parse("2026-11-11T11:00:00+08:00"));
  const store = vue.reactive({
    selectedToken: { id: "a", roleId: 101 },
    getWebSocketStatus: () => "disconnected",
  });
  const mounts = [];
  const unmounts = [];
  const context = {
    ...vue,
    onMounted: (fn) => mounts.push(fn),
    onUnmounted: (fn) => unmounts.push(fn),
    defineEmits: () => () => {},
    useTokenStore: () => store,
    useShanghaiClock: () => now,
    getReminderDays,
    describeCampProgress,
    isDreamShopChecked: (args) => isDreamShopChecked(args, { storage }),
    subscribeDreamShopChecks: (fn) => subscribeDreamShopChecks(fn, target),
    document: {
      visibilityState: "hidden",
      addEventListener() {},
      removeEventListener() {},
    },
    window: { setInterval: () => 1, clearInterval() {} },
    Date,
  };
  vm.createContext(context);
  const scope = vue.effectScope();
  scope.run(() =>
    vm.runInContext(`${body}\nglobalThis.api={dreamChecked};`, context),
  );
  mounts.forEach((fn) => fn());
  assert.equal(context.api.dreamChecked.value, false);
  const day1 = Date.parse("2026-11-11T00:00:00+08:00") / 1000;
  markDreamShopChecked({ roleId: 101, taskDay: day1 }, { storage, target });
  assert.equal(context.api.dreamChecked.value, true);
  store.selectedToken = { id: "b", roleId: 202 };
  await vue.nextTick();
  assert.equal(context.api.dreamChecked.value, false);
  markDreamShopChecked({ roleId: 202, taskDay: day1 }, { storage });
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: "dream-shop-checked:v1:202" });
  target.dispatchEvent(event);
  assert.equal(context.api.dreamChecked.value, true);
  now.value = Date.parse("2026-11-12T00:00:00+08:00");
  await vue.nextTick();
  assert.equal(context.api.dreamChecked.value, false);
  unmounts.forEach((fn) => fn());
  scope.stop();
});
