import assert from "node:assert/strict";
import test from "node:test";
import * as rewardState from "../src/utils/apexRewardState.js";
import { loadModule } from "./helpers/loadModule.js";

const running = new Set();
const { parseApexClaimableRewards, runApexRewardClaims } = await loadModule(
  new URL("../src/utils/apexRewardHelper.js", import.meta.url),
  {
    "./apexGuessHelper.js": {
      async withApexGuessLock(id, operation) {
        if (running.has(id)) throw new Error("already running");
        running.add(id);
        try {
          return await operation();
        } finally {
          running.delete(id);
        }
      },
    },
    "./apexRateLimit.js": {
      ApexAction: { READ: "read", GUESS: "guess" },
      runApexAction: () => {},
    },
    "./apexRewardState.js": rewardState,
  },
);

const action = async (_type, task, options) => {
  if (_type === "guess") assert.equal(options.maxRetry, 0);
  return task(0);
};

const fixture = (map) => {
  const claims = structuredClone(map);
  const calls = [];
  const store = {
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ id, cmd, params });
      if (cmd === "apex_getroleinfo")
        return { apexRoleInfo: { guessClaimMap: structuredClone(claims) } };
      if (cmd === "apex_guessclaim") {
        claims[params.scheduleId][params.teamId] = true;
        return {};
      }
      throw new Error("unexpected command");
    },
  };
  return { claims, calls, store };
};

test("只从服务器的领取状态提取未领取队伍，跳过内部标记", () => {
  assert.deepEqual(
    parseApexClaimableRewards({
      guessClaimMap: {
        150: { a: false, b: true, _marker: false },
        151: { c: 0, d: 1 },
      },
    }),
    [
      { scheduleId: 150, teamId: "a" },
      { scheduleId: 151, teamId: "c" },
    ],
  );
  assert.deepEqual(
    parseApexClaimableRewards({
      guessClaimMap: new Map([
        [
          150,
          new Map([
            ["x", false],
            ["y", true],
          ]),
        ],
      ]),
    }),
    [{ scheduleId: 150, teamId: "x" }],
  );
});

test("不完整及畸形状态不能伪装成无奖励", () => {
  for (const info of [
    {},
    { guessClaimMap: null },
    { guessClaimMap: { bad: { a: false } } },
    { guessClaimMap: { 150: { a: null } } },
    { guessClaimMap: { 150: [false] } },
  ])
    assert.throws(() => parseApexClaimableRewards(info));
});

test("一次领取所有待领并逐项核对，不领取已领取记录", async () => {
  const f = fixture({ 150: { a: false, b: true }, 151: { c: false } });
  const result = await runApexRewardClaims({
    tokenStore: f.store,
    tokenId: "claim-success",
    runAction: action,
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.successCount, 2);
  assert.deepEqual(
    f.calls.filter((x) => x.cmd === "apex_guessclaim").map((x) => x.params),
    [
      { scheduleId: 150, teamId: "a" },
      { scheduleId: 151, teamId: "c" },
    ],
  );
  assert.equal(f.calls.filter((x) => x.cmd === "apex_getroleinfo").length, 3);
});

test("没有可领取奖励时不会发送领取请求", async () => {
  const f = fixture({ 150: { a: true } });
  const result = await runApexRewardClaims({
    tokenStore: f.store,
    tokenId: "claim-none",
    runAction: action,
  });
  assert.equal(result.successCount, 0);
  assert.match(result.message, /没有可领取/);
  assert.equal(f.calls.filter((x) => x.cmd === "apex_guessclaim").length, 0);
});

test("领取超时停止且后续调用在本页内禁止重复发送", async () => {
  let writes = 0;
  const tokenStore = {
    async sendMessageWithPromise(_id, cmd) {
      if (cmd === "apex_getroleinfo")
        return {
          apexRoleInfo: { guessClaimMap: { 150: { a: false, b: false } } },
        };
      writes++;
      throw new Error("timeout");
    },
  };
  const options = { tokenStore, tokenId: "claim-timeout", runAction: action };
  const result = await runApexRewardClaims(options);
  assert.equal(result.outcome, "partial");
  assert.match(result.message, /未确认/);
  const again = await runApexRewardClaims(options);
  assert.match(again.message, /未确认/);
  assert.equal(writes, 1);
});

test("服务器明确拒绝保留已确认结果并停止后续领取", async () => {
  const f = fixture({ 150: { a: false, b: false, c: false } });
  const original = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "apex_guessclaim" && args[2].teamId === "b")
      throw new Error("服务器错误: 123 - 拒绝");
    return original(...args);
  };
  const result = await runApexRewardClaims({
    tokenStore: f.store,
    tokenId: "claim-rejected",
    runAction: action,
  });
  assert.equal(result.successCount, 1);
  assert.match(result.message, /拒绝/);
  assert.equal(f.calls.filter((x) => x.cmd === "apex_guessclaim").length, 1);
});

test("账号切换后停止后续领取并保留已确认奖励", async () => {
  const f = fixture({ 150: { a: false, b: false } });
  let checks = 0;
  const result = await runApexRewardClaims({
    tokenStore: f.store,
    tokenId: "claim-switch",
    runAction: action,
    checkInterrupted() {
      if (++checks >= 8) {
        const e = new Error("账号切换");
        e.interrupted = true;
        throw e;
      }
    },
  });
  assert.equal(result.outcome, "stopped");
  assert.ok(f.calls.filter((x) => x.cmd === "apex_guessclaim").length <= 1);
});

test("等待期间发生切换不会发送领取", async () => {
  const f = fixture({ 150: { a: false } });
  let valid = true;
  const runAction = async (kind, task) => {
    if (kind === "guess") valid = false;
    return task(0);
  };
  const result = await runApexRewardClaims({
    tokenStore: f.store,
    tokenId: "claim-queued",
    runAction,
    checkInterrupted() {
      if (!valid) {
        const e = new Error("账号切换");
        e.interrupted = true;
        throw e;
      }
    },
  });
  assert.equal(result.outcome, "stopped");
  assert.equal(f.calls.filter((x) => x.cmd === "apex_guessclaim").length, 0);
});

test("领取返回后无法核对时，不继续请求", async () => {
  let reads = 0;
  let writes = 0;
  const tokenStore = {
    async sendMessageWithPromise(_id, cmd) {
      if (cmd === "apex_getroleinfo") {
        if (++reads > 1) throw new Error("read failed");
        return {
          apexRoleInfo: { guessClaimMap: { 150: { a: false, b: false } } },
        };
      }
      writes++;
      return {};
    },
  };
  const result = await runApexRewardClaims({
    tokenStore,
    tokenId: "claim-unverified",
    runAction: action,
  });
  assert.equal(result.successCount, 0);
  assert.equal(writes, 1);
  assert.match(result.message, /未能核对/);
});

test("领取回包直接确认时无需额外读取，也不会丢失其他待领项", async () => {
  const calls = [];
  const tokenStore = {
    async sendMessageWithPromise(_id, cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "apex_getroleinfo")
        return {
          apexRoleInfo: { guessClaimMap: { 150: { a: false, b: false } } },
        };
      return {
        apexRoleInfo: { guessClaimMap: { 150: { [params.teamId]: true } } },
      };
    },
  };
  const result = await runApexRewardClaims({
    tokenStore,
    tokenId: "claim-verified-ack",
    runAction: action,
  });
  assert.equal(result.successCount, 2);
  assert.equal(calls.filter((x) => x.cmd === "apex_getroleinfo").length, 1);
});

test("同一账号已经有竞猜任务时不会开始第二次领取", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const tokenStore = {
    async sendMessageWithPromise() {
      await pending;
      return { apexRoleInfo: { guessClaimMap: {} } };
    },
  };
  const options = { tokenStore, tokenId: "claim-lock", runAction: action };
  const first = runApexRewardClaims(options);
  await assert.rejects(runApexRewardClaims(options), /already running/);
  release();
  assert.equal((await first).outcome, "completed");
});
