import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "vue/compiler-sfc";

const component = await readFile(
  new URL("../src/views/GameFeatures.vue", import.meta.url),
  "utf8",
);
const { descriptor } = parse(component);
const source = ts.createSourceFile(
  "GameFeatures.js",
  descriptor.scriptSetup.content,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === "initializeGameData",
    ),
);
assert.ok(declaration);

async function run(state) {
  const calls = [];
  const tokenStore = {
    selectedToken: { id: "a" },
    connectionRecoveryStatus: { a: state },
    sendMessage: (id, cmd) => calls.push([id, cmd]),
    sendMessageWithPromise: async (id, cmd) => {
      calls.push([id, cmd]);
      return { battleData: { version: 123 } };
    },
    setBattleVersion: (version, id) => calls.push([id, "set-version", version]),
  };
  const context = { tokenStore };
  vm.createContext(context);
  vm.runInContext(
    `${declaration.getText(source)}\nglobalThis.initialize = initializeGameData;`,
    context,
  );
  await context.initialize();
  return calls;
}

test("automatic connection recovery refreshes read-only data without sending fight_startlevel", async () => {
  const calls = await run("restored");
  assert.deepEqual(
    calls.map((call) => call[1]),
    [
      "role_getroleinfo",
      "tower_getinfo",
      "evotower_getinfo",
      "presetteam_getinfo",
    ],
  );
});

test("first connection keeps the existing battle version initialization", async () => {
  const calls = await run(undefined);
  assert.deepEqual(
    calls.map((call) => call[1]),
    [
      "role_getroleinfo",
      "tower_getinfo",
      "evotower_getinfo",
      "presetteam_getinfo",
      "fight_startlevel",
      "set-version",
    ],
  );
});
