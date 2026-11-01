import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

const { createTasksDungeon } = await loadModule(
  new URL("../src/utils/batch/tasksDungeon.js", import.meta.url),
  {
    "@/utils/dreamConstants": { isDungeonOpen: () => true, merchantConfig: {} },
  },
  {
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    console: { error() {} },
  },
);

function fixture() {
  const calls = [];
  const closed = [];
  const notices = [];
  const logs = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: ["existing", "owned"] },
    tokens: {
      value: [
        { id: "existing", name: "已有连接" },
        { id: "owned", name: "新连接" },
      ],
    },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async (id, _retries, report) => {
      if (id === "owned") report(true);
    },
    releaseConnectionSlot: () => {
      released++;
    },
    connectionQueue: { active: 1 },
    batchSettings: { maxActive: 2, dreamPurchaseList: ["1-11", "1-12"] },
    tokenStore: {
      closeWebSocketConnection: (id) => closed.push(id),
      async sendMessageWithPromise(id, cmd, params) {
        calls.push({ id, cmd, params });
        if (cmd === "bosstower_getinfo") return { bossTower: { towerId: 4 } };
        if (cmd === "role_getroleinfo")
          return {
            role: { levelId: 5000, dungeon: { merchant: { 1: [11, 12] } } },
          };
        if (cmd === "dungeon_buymerchant") return { reward: [] };
        return {};
      },
    },
    addLog: (entry) => logs.push(entry),
    message: {
      success: (text) => notices.push(["success", text]),
      warning: (text) => notices.push(["warning", text]),
    },
    currentRunningTokenId: { value: null },
  };
  return {
    deps,
    calls,
    closed,
    notices,
    logs,
    get released() {
      return released;
    },
  };
}

test("batch vault reuses an existing connection and only releases its own slot", async () => {
  const f = fixture();
  await createTasksDungeon(f.deps).batchbaoku45();
  assert.deepEqual(f.closed, ["owned"]);
  assert.equal(f.released, 1);
  assert.equal(f.deps.tokenStatus.value.existing, "completed");
  assert.equal(f.deps.tokenStatus.value.owned, "completed");
  assert.equal(f.notices.at(-1)[0], "success");
});

test("failed connection without a slot does not close another connection or release its slot", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["existing"];
  f.deps.ensureConnection = async () => {
    throw new Error("连接失败");
  };
  await createTasksDungeon(f.deps).batchbaoku45();
  assert.deepEqual(f.closed, []);
  assert.equal(f.released, 0);
  assert.equal(f.deps.tokenStatus.value.existing, "failed");
  assert.equal(f.notices.at(-1)[0], "warning");
});

test("connection cleanup follows the ownership callback on failed setup", async () => {
  const owned = fixture();
  owned.deps.selectedTokens.value = ["owned"];
  owned.deps.ensureConnection = async (_id, _retry, report) => {
    report(true);
    throw new Error("初始化失败");
  };
  await createTasksDungeon(owned.deps).batchbaoku45();
  assert.deepEqual(owned.closed, ["owned"]);
  assert.equal(owned.released, 1);
  const alreadyReleased = fixture();
  alreadyReleased.deps.selectedTokens.value = ["owned"];
  alreadyReleased.deps.ensureConnection = async (_id, _retry, report) => {
    report(true);
    report(false);
    throw new Error("连接已释放");
  };
  await createTasksDungeon(alreadyReleased.deps).batchbaoku45();
  assert.deepEqual(alreadyReleased.closed, []);
  assert.equal(alreadyReleased.released, 0);
});

test("stopping during vault actions never reports the account as completed", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["existing"];
  const send = f.deps.tokenStore.sendMessageWithPromise;
  f.deps.tokenStore.sendMessageWithPromise = async (...args) => {
    const response = await send(...args);
    if (args[1] === "bosstower_startboss") f.deps.shouldStop.value = true;
    return response;
  };
  await createTasksDungeon(f.deps).batchbaoku45();
  assert.equal(
    f.calls.filter((call) => call.cmd === "bosstower_startboss").length,
    1,
  );
  assert.equal(f.deps.tokenStatus.value.existing, "stopped");
  assert.equal(f.notices.at(-1)[0], "warning");
});

test("a vault account on the wrong floor is reported as skipped", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["existing"];
  await createTasksDungeon(f.deps).batchbaoku13();
  assert.equal(f.deps.tokenStatus.value.existing, "skipped");
  assert.equal(
    f.calls.some((call) => call.cmd === "bosstower_startboss"),
    false,
  );
  assert.equal(f.notices.at(-1)[0], "warning");
});

test("an unconfirmed dream-shop purchase stops later purchases and reports failure", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["existing"];
  const send = f.deps.tokenStore.sendMessageWithPromise;
  f.deps.tokenStore.sendMessageWithPromise = async (...args) => {
    if (args[1] === "dungeon_buymerchant") {
      f.calls.push({ id: args[0], cmd: args[1], params: args[2] });
      throw new Error("请求超时");
    }
    return send(...args);
  };
  await createTasksDungeon(f.deps).batchBuyDreamItems();
  assert.equal(
    f.calls.filter((call) => call.cmd === "dungeon_buymerchant").length,
    1,
  );
  assert.equal(f.deps.tokenStatus.value.existing, "failed");
  assert.equal(f.notices.at(-1)[0], "warning");
  assert.ok(f.logs.some((entry) => entry.message.includes("未确认")));
});

test("missing accounts are reported without opening or closing a connection", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["removed"];
  await createTasksDungeon(f.deps).batchbaoku45();
  assert.equal(f.deps.tokenStatus.value.removed, "failed");
  assert.deepEqual(f.closed, []);
  assert.equal(f.released, 0);
  assert.equal(f.notices.at(-1)[0], "warning");
});

test("an empty dream shop match is shown as skipped", async () => {
  const f = fixture();
  f.deps.selectedTokens.value = ["existing"];
  f.deps.batchSettings.dreamPurchaseList = ["1-99"];
  await createTasksDungeon(f.deps).batchBuyDreamItems();
  assert.equal(f.deps.tokenStatus.value.existing, "skipped");
  assert.equal(
    f.calls.some((call) => call.cmd === "dungeon_buymerchant"),
    false,
  );
  assert.equal(f.notices.at(-1)[0], "warning");
});
