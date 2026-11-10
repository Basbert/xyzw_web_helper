import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as vue from "vue";
import * as rewardTools from "../src/utils/compassRewards.js";

const component = await readFile(
  new URL("../src/components/cards/CompassCard.vue", import.meta.url),
  "utf8",
);
const scripts = [
  ...component.matchAll(/<script(?:\s+setup)?>([\s\S]*?)<\/script>/g),
];
assert.equal(scripts.length, 2);
const body = scripts
  .map((match) => {
    const ast = ts.createSourceFile(
      "CompassCard.js",
      match[1],
      ts.ScriptTarget.Latest,
      true,
    );
    return ast.statements
      .filter((node) => !ts.isImportDeclaration(node))
      .map((node) => node.getText(ast))
      .join("\n");
  })
  .join("\n");

test("中途失败时保留已确认的原始回包、奖励汇总和准确次数", async () => {
  const client = {};
  const store = vue.reactive({
    selectedToken: { id: "a" },
    wsConnections: { a: { client } },
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(_id, command) {
      if (command === "role_getroleinfo") return { role: { roleId: 123 } };
      return {};
    },
  });
  const first = { type: 3, itemId: 10002, value: 2 };
  const second = { type: 3, itemId: 10002, value: 3 };
  const context = {
    ...vue,
    ...rewardTools,
    defineProps: () => ({ active: false }),
    useTokenStore: () => store,
    onUnmounted() {},
    CHAOS_BONUS_THRESHOLD: 5,
    MAX_STAR_DRAWS: 200,
    COMPASS_COMMANDS: {
      chaosInfo: "nightmare_getroleinfo",
      starInfo: "nmext_getinfo",
    },
    parseChaosSnapshot: () => ({ left: 0, bonusProgress: 0 }),
    parseStarSnapshot: () => ({ white: 0, green: 0, blue: 0 }),
    isCompassAccountUncertain: () => false,
    runCompassDraw: async ({ onDraw }) => {
      onDraw({
        kind: "white",
        rewards: [first],
        response: { confIdList: [11] },
      });
      onDraw({
        kind: "green",
        rewards: [second],
        response: { confIdList: [12] },
      });
      const error = new Error("服务器暂时不可用");
      error.compassRewards = [first, second];
      error.compassCompleted = 2;
      throw error;
    },
  };
  vm.createContext(context);
  const scope = vue.effectScope();
  scope.run(() =>
    vm.runInContext(
      `${body}\nglobalThis.api={draw,state,result,rewardSummary,rewardBatches};`,
      context,
    ),
  );
  context.api.state.value = { chaos: 0, star: { white: 1, green: 1, blue: 0 } };
  await context.api.draw("star");
  assert.match(context.api.result.value.message, /已确认 2 次/);
  assert.match(context.api.result.value.message, /服务器暂时不可用/);
  assert.equal(context.api.result.value.batches.length, 2);
  assert.deepEqual(
    Array.from(context.api.result.value.batches[0].confIdList),
    [11],
  );
  assert.equal(context.api.result.value.rewards.length, 2);
  assert.equal(context.api.rewardSummary.value[0].text, "蓝玉 × 5");
  assert.equal(context.api.rewardBatches.value.confirmedDraws, 2);
  scope.stop();
});
