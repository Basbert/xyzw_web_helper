import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const component = await readFile(
  new URL("../src/components/Tower/TowerStatus.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "TowerStatus.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((item) =>
        ["startTowerClimb", "stopClimbing"].includes(item.name.getText(source)),
      ),
  )
  .map((statement) => statement.getText(source))
  .join("\n");

function fixture({ energy = [1, 0], read = async () => {} } = {}) {
  const calls = [];
  const tokenStore = {
    selectedToken: { id: "A" },
    wsConnections: { A: { client: {} } },
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(id, cmd) {
      calls.push([id, cmd]);
      if (cmd === "role_getroleinfo") {
        await read();
        return { role: { tower: { energy: energy.shift() } } };
      }
      return {};
    },
  };
  const context = {
    tokenStore,
    stopFlag: false,
    isClimbing: { value: false },
    climbTimeout: { value: null },
    canClimb: { value: true },
    message: { warning() {}, info() {}, success() {}, error() {} },
    setTimeout: (fn, ms) => {
      if (ms !== 60000) fn();
      return 1;
    },
    clearTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(
    `${declarations}\nglobalThis.api = { startTowerClimb, stopClimbing };`,
    context,
  );
  return { context, calls, ...context.api };
}

test("regular tower reads each fresh server energy value before fighting", async () => {
  const f = fixture({ energy: [1, 0] });
  await f.startTowerClimb();
  assert.deepEqual(
    f.calls.map(([, cmd]) => cmd),
    ["role_getroleinfo", "fight_starttower", "role_getroleinfo"],
  );
  assert.equal(f.context.isClimbing.value, false);
});

test("stopping during the energy read prevents the next fight", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const f = fixture({
    read: async () => {
      started();
      await gate;
    },
  });
  const pending = f.startTowerClimb();
  await waiting;
  f.stopClimbing();
  assert.equal(f.context.isClimbing.value, true);
  release();
  await pending;
  assert.equal(
    f.calls.some(([, cmd]) => cmd === "fight_starttower"),
    false,
  );
  assert.equal(f.context.isClimbing.value, false);
});

test("switching account during the energy read never fights on the new account", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const f = fixture({
    read: async () => {
      started();
      await gate;
    },
  });
  const pending = f.startTowerClimb();
  await waiting;
  f.context.tokenStore.selectedToken = { id: "B" };
  release();
  await pending;
  assert.equal(
    f.calls.some(([, cmd]) => cmd === "fight_starttower"),
    false,
  );
});
