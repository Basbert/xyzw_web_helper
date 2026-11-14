import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadScriptStatements(relPath) {
  const sfc = await readFile(new URL(relPath, import.meta.url), "utf8");
  const script = sfc.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, `Expected <script setup> in ${relPath}`);
  const source = ts.createSourceFile(
    relPath,
    script,
    ts.ScriptTarget.Latest,
    true,
  );
  return { source, script };
}

function extractDeclarationText(source, name) {
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return stmt.getText(source);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return stmt.getText(source);
        }
      }
    }
  }
  throw new Error(`Declaration not found: ${name}`);
}

test("StarUpgradeCard treats unwrapped rawData responses as success and aborts on account switch", async () => {
  const { source } = await loadScriptStatements(
    "../src/components/cards/StarUpgradeCard.vue",
  );
  const code = [
    extractDeclarationText(source, "isSuccessResponse"),
    extractDeclarationText(source, "runHeroUpgrade"),
  ].join("\n\n");

  const calls = [];
  const logs = [];
  const ctx = {
    Boolean,
    Promise,
    Error,
    isUnmounted: false,
    state: {
      value: {
        isRunning: false,
        stopRequested: false,
        total: 1,
        done: 0,
      },
    },
    heroIds: { value: [101] },
    sleep: async () => {},
    addLog(msg, type) {
      logs.push({ msg, type });
    },
    message: { warning() {}, info() {}, success() {}, error() {} },
    tokenStore: {
      selectedToken: { id: "acc-1" },
      getWebSocketStatus: () => "connected",
      async sendMessageWithPromise(tokenId, cmd, body) {
        calls.push({ tokenId, cmd, body });
        if (calls.length === 2) {
          // Switch account during the second step
          ctx.tokenStore.selectedToken = { id: "acc-2" };
        }
        // Unwrapped rawData has no .code / .success / .result
        return { role: { heroes: { 101: { star: calls.length } } } };
      },
      sendMessage() {},
    },
  };

  vm.createContext(ctx);
  vm.runInContext(
    `${code}\nglobalThis.isSuccessResponse = isSuccessResponse;\nglobalThis.runHeroUpgrade = runHeroUpgrade;`,
    ctx,
  );

  assert.equal(ctx.isSuccessResponse({ hero: { star: 1 } }), true);
  assert.equal(ctx.isSuccessResponse({ code: 0 }), true);
  assert.equal(ctx.isSuccessResponse({ code: 1001 }), false);
  assert.equal(ctx.isSuccessResponse(null), false);

  await ctx.runHeroUpgrade({ delay: 0 });
  // Step 1 succeeded (logged as success), Step 2 triggered account switch -> loop aborted before Step 3..10
  assert.equal(calls.length, 2);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].type, "success");
  assert.equal(ctx.state.value.stopRequested, true);
  assert.ok(calls.every((c) => c.tokenId === "acc-1"));
});

test("MonthlyTasksCard sends newFree: false for batch normal fishing rods and guards fetchMonthlyActivity across account switch", async () => {
  const { source } = await loadScriptStatements(
    "../src/components/cards/MonthlyTasksCard.vue",
  );
  const code = [
    extractDeclarationText(source, "fetchMonthlyActivity"),
    extractDeclarationText(source, "readMonthlyProgress"),
    extractDeclarationText(source, "autoTopUpFish"),
  ].join("\n\n");

  const calls = [];
  const ctx = {
    Number,
    Math,
    Promise,
    setTimeout: (fn) => fn(),
    isUnmounted: false,
    monthlyRequestId: 0,
    isConnected: { value: true },
    fishToppingUp: { value: false },
    monthLoading: { value: false },
    monthActivity: { value: { myMonthInfo: { 2: { num: 15 } } } },
    fishNum: { value: 15 },
    isTodayAvailable: () => true,
    message: { warning() {}, info() {}, success() {}, error() {} },
    tokenStore: {
      selectedToken: { id: "acc-1" },
      gameData: {
        roleInfo: {
          role: {
            statisticsTime: { "artifact:normal:lottery:time": 0 },
          },
        },
      },
      getWebSocketStatus: () => "connected",
      async sendMessageWithPromise(tokenId, cmd, body) {
        calls.push({ tokenId, cmd, body });
        if (cmd === "activity_get") {
          return { activity: { myMonthInfo: { 2: { num: 15 } } } };
        }
        return {};
      },
      sendMessage() {},
    },
  };

  vm.createContext(ctx);
  vm.runInContext(
    `${code}\nglobalThis.autoTopUpFish = autoTopUpFish;\nglobalThis.fetchMonthlyActivity = fetchMonthlyActivity;`,
    ctx,
  );

  await ctx.autoTopUpFish(5, 20, 160);
  const lotteryCalls = calls.filter((c) => c.cmd === "artifact_lottery");
  // 3 free rod calls + 1 batch normal rod call (remaining = 20 - 15 = 5)
  assert.equal(lotteryCalls.length, 4);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(
      { ...lotteryCalls[i].body },
      {
        lotteryNumber: 1,
        newFree: true,
        type: 1,
      },
    );
  }
  assert.deepEqual(
    { ...lotteryCalls[3].body },
    {
      lotteryNumber: 5,
      newFree: false,
      type: 1,
    },
  );

  // Verify stale fetchMonthlyActivity response does not overwrite new account state
  ctx.monthActivity.value = { 103: 5 };
  ctx.tokenStore.sendMessageWithPromise = async () => {
    ctx.tokenStore.selectedToken = { id: "acc-2" };
    return { activity: { 103: 99 } };
  };
  await ctx.fetchMonthlyActivity("acc-1");
  assert.deepEqual(ctx.monthActivity.value, { 103: 5 });
});

test("RefineHelperCard locks runTokenId and stops continuous refine when account changes", async () => {
  const { source } = await loadScriptStatements(
    "../src/components/cards/RefineHelperCard.vue",
  );
  const code = [
    extractDeclarationText(source, "isSessionActive"),
    extractDeclarationText(source, "stopQuench"),
    extractDeclarationText(source, "executeQuench"),
    extractDeclarationText(source, "quenchContinuous"),
  ].join("\n\n");

  const calls = [];
  const scheduledCallbacks = [];
  const ctx = {
    Number,
    String,
    Object,
    Array,
    Math,
    JSON,
    Promise,
    console: { log() {}, error() {} },
    setTimeout: (fn) => {
      scheduledCallbacks.push(fn);
      return scheduledCallbacks.length;
    },
    clearTimeout() {},
    isUnmounted: false,
    continuousTimer: null,
    autoTimer: null,
    state: {
      value: {
        continuousQuenching: false,
        autoQuenching: false,
        isRunning: false,
      },
    },
    delay: { value: 200 },
    selectedHeroId: { value: 101 },
    selectedPart: { value: 1 },
    heroEquipment: {
      value: {
        1: {
          level: 5000,
          quenches: {
            1: { attrNum: 10, isLocked: false },
          },
        },
      },
    },
    quenchCount: { value: 0 },
    quenchTimes: { value: 0 },
    equipBonusValue: { value: 0 },
    jadeCount: { value: 1000 },
    colorJadeCount: { value: 100 },
    updateSlots() {},
    checkHighQualityAttr: () => false,
    message: { warning() {}, info() {}, success() {}, error() {} },
    tokenStore: {
      selectedToken: { id: "acc-1" },
      getWebSocketStatus: () => "connected",
      async sendMessageWithPromise(tokenId, cmd, body) {
        calls.push({ tokenId, cmd, body });
        return {
          equipment: {
            level: 5000,
            quenches: { 1: { attrNum: 10, isLocked: false } },
          },
        };
      },
    },
  };

  vm.createContext(ctx);
  vm.runInContext(
    `${code}\nglobalThis.quenchContinuous = quenchContinuous;`,
    ctx,
  );

  ctx.quenchContinuous();
  // Let the first async executeQuench finish
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tokenId, "acc-1");
  assert.equal(ctx.state.value.continuousQuenching, true);
  assert.equal(scheduledCallbacks.length, 1);

  // Switch account before the timer callback fires
  ctx.tokenStore.selectedToken = { id: "acc-2" };
  scheduledCallbacks[0]();
  await new Promise((r) => setImmediate(r));

  // Must not have refined on acc-2, and continuous quench must be stopped
  assert.equal(calls.length, 1);
  assert.equal(ctx.state.value.continuousQuenching, false);
  assert.equal(ctx.state.value.isRunning, false);
});

test("DreamHelperCard stops continuous battle when account switches mid-loop", async () => {
  const { source } = await loadScriptStatements(
    "../src/components/cards/DreamHelperCard.vue",
  );
  const code = [
    extractDeclarationText(source, "startSingleBattle"),
    extractDeclarationText(source, "startContinuousBattle"),
  ].join("\n\n");

  const calls = [];
  const ctx = {
    Number,
    Promise,
    console: { log() {}, error() {} },
    componentDisposed: false,
    heroData: { 101: { name: "吕布" } },
    continuousBattles: { value: {} },
    stopContinuousBattle(id) {
      ctx.continuousBattles.value[id] = false;
    },
    delay: async () => {},
    message: { warning() {}, info() {}, success() {}, error() {} },
    tokenStore: {
      selectedToken: { id: "acc-1" },
      getWebSocketStatus: () => "connected",
      async sendMessageWithPromise(tokenId, cmd, body) {
        calls.push({ tokenId, cmd, body });
        // Switch account during first fight
        ctx.tokenStore.selectedToken = { id: "acc-2" };
        return { isWin: true };
      },
    },
  };

  vm.createContext(ctx);
  vm.runInContext(
    `${code}\nglobalThis.startContinuousBattle = startContinuousBattle;`,
    ctx,
  );

  await ctx.startContinuousBattle(101);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tokenId, "acc-1");
  assert.equal(ctx.continuousBattles.value[101], false);
});
