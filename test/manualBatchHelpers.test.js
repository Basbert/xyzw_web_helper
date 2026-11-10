import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readItemCount,
  runArenaBatch,
  runFishBatch,
} from "../src/utils/manualBatchHelpers.js";

const items = (id, quantity) => ({ role: { items: { [id]: { quantity } } } });

test("鱼竿只使用服务器确认的现有库存，并按批次记录回包", async () => {
  const calls = [];
  const progress = [];
  const delays = [];
  const result = await runFishBatch({
    type: 2,
    requested: 50,
    shouldContinue: () => true,
    onProgress: (p) => progress.push(p.completed),
    sleep: async (ms) => delays.push(ms),
    send: async (cmd, params) => {
      calls.push([cmd, params]);
      return cmd === "role_getroleinfo" ? items(1012, 13) : {};
    },
  });
  assert.deepEqual(result, {
    status: "completed",
    completed: 13,
    total: 13,
    available: 13,
  });
  assert.deepEqual(
    calls.slice(1).map(([, p]) => p.lotteryNumber),
    [10, 3],
  );
  assert.deepEqual(progress, [0, 10, 13]);
  assert.deepEqual(delays, [300]);
});

test("库存响应不完整时拒绝消耗，不把未知数量当成零", async () => {
  const calls = [];
  const result = await runFishBatch({
    type: 1,
    requested: 10,
    shouldContinue: () => true,
    onProgress: () => {},
    send: async (cmd) => {
      calls.push(cmd);
      return { role: {} };
    },
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, ["role_getroleinfo"]);
  assert.throws(() => readItemCount(items(1011, null), 1011));
  assert.equal(readItemCount({ role: { items: {} } }, 1011), 0);
});

test("停止请求等待当前批次响应，不再提交后续批次", async () => {
  const calls = [];
  let continuing = true;
  const result = await runFishBatch({
    type: 1,
    requested: 30,
    shouldContinue: () => continuing,
    onProgress: () => {},
    send: async (cmd) => {
      calls.push(cmd);
      if (cmd === "role_getroleinfo") return items(1011, 30);
      continuing = false;
      return {};
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.completed, 10);
  assert.deepEqual(calls, ["role_getroleinfo", "artifact_lottery"]);
});

test("消费请求结果未知时不重试，也不计为收到回包", async () => {
  const calls = [];
  const result = await runFishBatch({
    type: 1,
    requested: 20,
    shouldContinue: () => true,
    onProgress: () => {},
    send: async (cmd) => {
      calls.push(cmd);
      if (cmd === "role_getroleinfo") return items(1011, 20);
      throw new Error("timeout");
    },
  });
  assert.equal(result.status, "unconfirmed");
  assert.equal(result.completed, 0);
  assert.deepEqual(calls, ["role_getroleinfo", "artifact_lottery"]);
});

test("竞技场每场先获取对手，且最多使用确认的门票", async () => {
  const calls = [];
  const delays = [];
  const result = await runArenaBatch({
    requested: 10,
    shouldContinue: () => true,
    onProgress: () => {},
    sleep: async (ms) => delays.push(ms),
    send: async (cmd, params) => {
      calls.push([cmd, params]);
      if (cmd === "role_getroleinfo") return items(1007, 2);
      if (cmd === "arena_getareatarget") return { rankList: [{ roleId: 12 }] };
      return {};
    },
  });
  assert.equal(result.completed, 2);
  assert.deepEqual(
    calls.map(([cmd]) => cmd),
    [
      "role_getroleinfo",
      "arena_startarea",
      "arena_getareatarget",
      "fight_startareaarena",
      "arena_startarea",
      "arena_getareatarget",
      "fight_startareaarena",
    ],
  );
  assert.deepEqual(calls.at(-1)[1], { targetId: 12 });
  assert.deepEqual(delays, [500]);
});

test("等待间隔期间停止或切换账号时不发送下一批请求", async () => {
  for (const kind of ["fish", "arena"]) {
    let continuing = true;
    const calls = [];
    const delays = [];
    const options = {
      requested: 20,
      shouldContinue: () => continuing,
      onProgress: () => {},
      sleep: async (ms) => {
        delays.push(ms);
        continuing = false;
      },
      send: async (cmd) => {
        calls.push(cmd);
        if (cmd === "role_getroleinfo")
          return items(kind === "fish" ? 1011 : 1007, 20);
        if (cmd === "arena_getareatarget")
          return { rankList: [{ roleId: 12 }] };
        return {};
      },
    };
    const result =
      kind === "fish"
        ? await runFishBatch({ ...options, type: 1 })
        : await runArenaBatch(options);
    assert.equal(result.status, "stopped");
    assert.deepEqual(delays, [kind === "fish" ? 300 : 500]);
    assert.equal(
      calls.filter(
        (cmd) =>
          cmd ===
          (kind === "fish" ? "artifact_lottery" : "fight_startareaarena"),
      ).length,
      1,
    );
  }
});

test("账号或连接变化后不再发起战斗；目标缺失时也停止", async () => {
  let continuing = true;
  const calls = [];
  const result = await runArenaBatch({
    requested: 10,
    shouldContinue: () => continuing,
    onProgress: () => {},
    send: async (cmd) => {
      calls.push(cmd);
      if (cmd === "role_getroleinfo") return items(1007, 3);
      if (cmd === "arena_getareatarget") {
        continuing = false;
        return { rankList: [{ roleId: 1 }] };
      }
      return {};
    },
  });
  assert.equal(result.status, "stopped");
  assert.deepEqual(calls, [
    "role_getroleinfo",
    "arena_startarea",
    "arena_getareatarget",
  ]);
  const missing = await runArenaBatch({
    requested: 1,
    shouldContinue: () => true,
    onProgress: () => {},
    send: async (cmd) => (cmd === "role_getroleinfo" ? items(1007, 1) : {}),
  });
  assert.equal(missing.status, "failed");
  assert.match(missing.error, /未找到/);
});
