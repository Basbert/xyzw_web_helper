import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDreamPurchasePlan,
  runDailyDreamPurchase,
  withDreamPurchaseLock,
} from "../src/utils/dailyDreamPurchase.js";

const active = () => {};
const pause = async () => {};
const response = (merchant, levelId = 5000) => ({
  role: { levelId, dungeon: { merchant } },
});

test("只选择两项原有操作的商品，按商人从后往前执行", () => {
  assert.deepEqual(
    buildDreamPurchasePlan({
      1: [6, 0, 5],
      2: [4, 7, 6],
      3: [2, 7, 5, 4, 6],
    }),
    [
      { id: 1, index: 5, pos: 2 },
      { id: 1, index: 6, pos: 0 },
      { id: 2, index: 6, pos: 2 },
      { id: 2, index: 7, pos: 1 },
      { id: 3, index: 6, pos: 4 },
      { id: 3, index: 5, pos: 2 },
      { id: 3, index: 7, pos: 1 },
      { id: 3, index: 2, pos: 0 },
    ],
  );
});

test("非开放日不读取、不购买", async () => {
  let calls = 0;
  const result = await runDailyDreamPurchase({
    accountId: "closed",
    isOpen: false,
    checkActive: active,
    pause,
    send: async () => {
      calls++;
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(calls, 0);
});

test("从最新角色库存开始，串行购买并核对每件商品减少", async () => {
  const merchant = { 1: [5, 6], 2: [4], 3: [2, 7] };
  const calls = [];
  const result = await runDailyDreamPurchase({
    accountId: "complete",
    isOpen: true,
    checkActive: active,
    pause,
    send: async (command, args) => {
      calls.push([command, args]);
      if (command === "role_getroleinfo") return response(merchant);
      assert.equal(merchant[args.id][args.pos], args.index);
      merchant[args.id].splice(args.pos, 1);
      return { reward: [{ itemId: 123 }] };
    },
  });
  assert.equal(result.purchases.length, 4);
  assert.deepEqual(
    calls
      .filter(([name]) => name === "dungeon_buymerchant")
      .map(([, args]) => args),
    [
      { id: 1, index: 6, pos: 1 },
      { id: 1, index: 5, pos: 0 },
      { id: 3, index: 7, pos: 1 },
      { id: 3, index: 2, pos: 0 },
    ],
  );
  assert.equal(calls.filter(([name]) => name === "role_getroleinfo").length, 5);
});

test("商店未知或者未到关卡 4000 不发送购买", async () => {
  for (const data of [
    { role: {} },
    response({ 1: [5] }, 3999),
    response({ 1: "bad" }),
  ]) {
    let count = 0;
    await assert.rejects(
      runDailyDreamPurchase({
        accountId: "invalid",
        isOpen: true,
        checkActive: active,
        pause,
        send: async () => {
          count++;
          return data;
        },
      }),
    );
    assert.equal(count, 1);
  }
});

test("成功回包后库存未改变，保留已确认结果并终止", async () => {
  let buys = 0;
  await assert.rejects(
    runDailyDreamPurchase({
      accountId: "stale",
      isOpen: true,
      checkActive: active,
      pause,
      send: async (command) => {
        if (command === "role_getroleinfo") return response({ 1: [5, 6] });
        buys++;
        return { reward: [] };
      },
    }),
    (error) => error.confirmed === 1 && /余量/.test(error.message),
  );
  assert.equal(buys, 1);
});

test("购买超时保留原有结果并锁定账号，避免重复购买", async () => {
  let buys = 0;
  const options = {
    accountId: "timeout",
    isOpen: true,
    checkActive: active,
    pause,
    send: async (command) => {
      if (command === "role_getroleinfo") return response({ 1: [5] });
      buys++;
      throw new Error("超时");
    },
  };
  await assert.rejects(
    runDailyDreamPurchase(options),
    (error) => error.uncertain && error.confirmed === 0,
  );
  await assert.rejects(runDailyDreamPurchase(options), /未确认/);
  await assert.rejects(
    withDreamPurchaseLock("timeout", async () => {}),
    /未确认/,
  );
  assert.equal(buys, 1);
});

test("同时运行的手动和日常购买互斥", async () => {
  let release;
  const pending = withDreamPurchaseLock(
    "shared",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    withDreamPurchaseLock("shared", async () => {}),
    /正在进行/,
  );
  release();
  await pending;
  assert.equal(await withDreamPurchaseLock("shared", async () => 42), 42);
});

test("角色切换后停止并保留已经确认购买", async () => {
  let activeNow = true;
  let buys = 0;
  await assert.rejects(
    runDailyDreamPurchase({
      accountId: "switch",
      isOpen: true,
      pause,
      checkActive() {
        if (!activeNow) throw new Error("账号变化");
      },
      send: async (command) => {
        if (command === "role_getroleinfo") return response({ 1: [5, 6] });
        buys++;
        activeNow = false;
        return { reward: [] };
      },
    }),
    (error) => error.confirmed === 1 && /账号变化/.test(error.message),
  );
  assert.equal(buys, 1);
});

test("每次读取角色前间隔一秒，避免角色信息接口限流", async () => {
  const merchant = { 1: [5, 6] };
  const events = [];
  await runDailyDreamPurchase({
    accountId: "read-spacing",
    isOpen: true,
    checkActive: active,
    pause: async (ms) => events.push(`wait:${ms}`),
    send: async (command, args) => {
      events.push(command);
      if (command === "role_getroleinfo") return response(merchant);
      merchant[args.id].splice(args.pos, 1);
      return { reward: [] };
    },
  });
  for (let i = 0; i < events.length; i++) {
    if (events[i] === "role_getroleinfo")
      assert.equal(events[i - 1], "wait:1000");
  }
});
