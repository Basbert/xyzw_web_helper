import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const component = await readFile(
  new URL("../src/components/Tower/WeirdTowerStatus.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "WeirdTowerStatus.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set([
  "createSessionCheck",
  "startTowerClimb",
  "stopClimbing",
]);
const declarationsFor = (realFollowups) =>
  source.statements
    .filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (item) =>
            names.has(item.name.getText(source)) ||
            (realFollowups &&
              ["startUseItems", "autoMergeItems"].includes(
                item.name.getText(source),
              )),
        ),
    )
    .map((statement) => statement.getText(source))
    .join("\n");

function fixture({
  ready = async () => {},
  tokenSwitch = false,
  realFollowups = false,
  serverEnergy = 1,
} = {}) {
  const calls = [];
  const messages = [];
  const tokenStore = {
    selectedToken: { id: "A" },
    wsConnections: { A: { client: {} } },
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(id, cmd) {
      calls.push([cmd, id]);
      if (cmd === "evotower_readyfight") {
        await ready();
        if (tokenSwitch) tokenStore.selectedToken = { id: "B" };
      }
      if (cmd === "mergebox_getinfo")
        return { mergeBox: { freeEnergy: 0, costTotalCnt: 0, gridMap: {} } };
      if (cmd === "evotower_getinfo")
        return { evoTower: { energy: serverEnergy, lotteryLeftCnt: 2 } };
      return {};
    },
  };
  const ref = (value) => ({ value });
  const context = {
    tokenStore,
    componentDisposed: false,
    stopFlag: false,
    stopItemFlag: false,
    stopMergeFlag: false,
    isClimbing: ref(false),
    isClimbSequence: ref(false),
    isUsingItems: ref(false),
    isMerging: ref(false),
    climbTimeout: ref(null),
    itemTimeout: ref(null),
    mergeTimeout: ref(null),
    maxClimbInput: ref(1),
    isWeirdTowerActivityOpen: ref(true),
    towerEnergy: ref(1),
    evoTowerInfo: ref({ evoTower: {} }),
    normalizeWeirdTowerMaxClimb: (value) => value,
    isSameGameValue: (a, b) => a === b,
    claimPendingChapterRewards: async () => {},
    getTowerInfo: async () => {},
    startUseItems: async ({ tokenId, checkSession }) => {
      checkSession();
      calls.push(["use", tokenId]);
    },
    autoMergeItems: async ({ tokenId, checkSession }) => {
      checkSession();
      calls.push(["merge", tokenId]);
    },
    message: new Proxy({}, { get: () => (text) => messages.push(text) }),
    setTimeout: (callback, ms) => {
      if (ms !== 60000) callback();
      return 1;
    },
    clearTimeout() {},
  };
  context.canClimb = {
    get value() {
      return !context.isClimbSequence.value;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declarationsFor(realFollowups)}\nglobalThis.api = { startTowerClimb, stopClimbing };`,
    context,
  );
  return { context, calls, messages, ...context.api };
}

test("climb then use items then merge, once and on the same account", async () => {
  const f = fixture();
  await f.startTowerClimb();
  assert.deepEqual(
    f.calls.filter(([cmd]) => ["evotower_fight", "use", "merge"].includes(cmd)),
    [
      ["evotower_fight", "A"],
      ["use", "A"],
      ["merge", "A"],
    ],
  );
  assert.equal(f.context.isClimbSequence.value, false);
});

test("actual follow-ups use server items before checking for merges", async () => {
  const f = fixture({ realFollowups: true });
  await f.startTowerClimb();
  const commands = f.calls.map(([cmd]) => cmd);
  assert.equal(commands.filter((cmd) => cmd === "mergebox_openbox").length, 2);
  assert.ok(
    commands.indexOf("evotower_fight") < commands.indexOf("mergebox_openbox"),
  );
  assert.ok(
    commands.lastIndexOf("mergebox_getinfo") >
      commands.lastIndexOf("mergebox_openbox"),
  );
});

test("when climbing fails the two follow-up operations are still attempted", async () => {
  const f = fixture({
    ready: async () => {
      throw new Error("fight failed");
    },
  });
  await f.startTowerClimb();
  assert.deepEqual(
    f.calls.filter(([cmd]) => ["use", "merge"].includes(cmd)),
    [
      ["use", "A"],
      ["merge", "A"],
    ],
  );
});

test("missing server energy does not trigger a fight, but still attempts both follow-ups", async () => {
  const f = fixture({ serverEnergy: null });
  await f.startTowerClimb();
  assert.equal(
    f.calls.some(([cmd]) => cmd === "evotower_fight"),
    false,
  );
  assert.deepEqual(
    f.calls.filter(([cmd]) => ["use", "merge"].includes(cmd)),
    [
      ["use", "A"],
      ["merge", "A"],
    ],
  );
});

test("stopping the climb avoids the next fight but still performs both follow-ups", async () => {
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    ready: async () => {
      entered();
      await gate;
    },
  });
  const pending = f.startTowerClimb();
  await started;
  f.stopClimbing();
  release();
  await pending;
  assert.equal(
    f.calls.some(([cmd]) => cmd === "evotower_fight"),
    false,
  );
  assert.deepEqual(
    f.calls.filter(([cmd]) => ["use", "merge"].includes(cmd)),
    [
      ["use", "A"],
      ["merge", "A"],
    ],
  );
});

test("switching account before follow-ups prevents actions on the newly selected account", async () => {
  const f = fixture({ tokenSwitch: true });
  await f.startTowerClimb();
  assert.equal(
    f.calls.some(([cmd]) => ["evotower_fight", "use", "merge"].includes(cmd)),
    false,
  );
  assert.ok(f.messages.some((text) => text.includes("后续操作未完成")));
});

test("a second click cannot start an overlapping sequence", async () => {
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    ready: async () => {
      entered();
      await gate;
    },
  });
  const first = f.startTowerClimb();
  await started;
  await f.startTowerClimb();
  release();
  await first;
  assert.equal(f.calls.filter(([cmd]) => cmd === "use").length, 1);
  assert.equal(f.calls.filter(([cmd]) => cmd === "merge").length, 1);
});
