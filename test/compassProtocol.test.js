import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPASS_COMMANDS,
  isCompassAccountUncertain,
  parseChaosSnapshot,
  parseStarSnapshot,
  runCompassDraw,
} from "../src/utils/compassProtocol.js";

const active = () => {};
const star = (white) => ({ roleNMExt: { hasKeyCntMap: { 36997: white } } });
const reward = { type: 1, itemId: 456, value: 3 };

test("罗盘次数仅使用可确认的服务端字段", () => {
  assert.deepEqual(
    parseChaosSnapshot({
      weekAward: { turntableLeftCnt: 7 },
      nightMare: { bookScore: 12, turnRewardTime: 10 },
    }),
    { left: 7, bonusProgress: 2 },
  );
  assert.deepEqual(
    parseStarSnapshot({
      roleNMExt: {
        hasKeyCntMap: new Map([
          [36997, 2],
          ["36999", 4],
        ]),
      },
    }),
    { white: 2, green: 0, blue: 4 },
  );
  assert.throws(() => parseChaosSnapshot({}), /未确认/);
  assert.throws(() => parseStarSnapshot({}), /未确认/);
});

test("混沌抽奖只发一次请求，保留所有奖励", async () => {
  const calls = [];
  const result = await runCompassDraw({
    accountId: "chaos",
    kind: "chaos",
    roleId: 123,
    count: 3,
    assertActive: active,
    send: async (command, params) => {
      calls.push([command, params]);
      return command === COMPASS_COMMANDS.chaosInfo
        ? { weekAward: { turntableLeftCnt: 3 } }
        : {
            weekAward: { turntableLeftCnt: 0 },
            reward: [reward, { type: 8, itemId: 789, value: 1 }],
          };
    },
  });
  assert.deepEqual(calls, [
    [COMPASS_COMMANDS.chaosInfo, { roleId: 123 }],
    [COMPASS_COMMANDS.chaosDraw, {}],
  ]);
  assert.equal(result.rewards.length, 2);
});

test("星级罗盘逐次抽取，余额异常时中止并保留已确认奖励", async () => {
  let draws = 0;
  const observed = [];
  await assert.rejects(
    runCompassDraw({
      accountId: "star",
      kind: "white",
      count: 3,
      assertActive: active,
      onDraw: ({ rewards }) => observed.push(...rewards),
      send: async (command, params) => {
        if (command === COMPASS_COMMANDS.starInfo) return star(3);
        assert.deepEqual(params, { itemId: 36997 });
        draws++;
        return { ...star(draws === 1 ? 2 : 2), reward: [reward] };
      },
    }),
    (error) =>
      error.compassCompleted === 2 && error.compassRewards.length === 2,
  );
  assert.equal(draws, 2);
  assert.equal(observed.length, 2);
});

test("抽奖过程中连接或角色变化后不会继续", async () => {
  let valid = true;
  let draws = 0;
  await assert.rejects(
    runCompassDraw({
      accountId: "switch",
      kind: "white",
      count: 2,
      assertActive() {
        if (!valid) throw new Error("角色已切换");
      },
      send: async (command) => {
        if (command === COMPASS_COMMANDS.starInfo) return star(2);
        draws++;
        valid = false;
        return { ...star(1), reward: [reward] };
      },
    }),
    /角色已切换/,
  );
  assert.equal(draws, 1);
});

test("超过余额时拒绝发送抽奖命令", async () => {
  let calls = 0;
  await assert.rejects(
    runCompassDraw({
      accountId: "limited",
      kind: "white",
      count: 2,
      assertActive: active,
      send: async () => {
        calls++;
        return star(1);
      },
    }),
    /超过剩余次数/,
  );
  assert.equal(calls, 1);
});

test("混沌罗盘次数变动后不发起抽奖", async () => {
  let calls = 0;
  await assert.rejects(
    runCompassDraw({
      accountId: "chaos-stale",
      kind: "chaos",
      roleId: 123,
      count: 2,
      assertActive: active,
      send: async () => {
        calls++;
        return { weekAward: { turntableLeftCnt: 3 } };
      },
    }),
    /剩余次数已变化/,
  );
  assert.equal(calls, 1);
  assert.equal(isCompassAccountUncertain("chaos-stale"), false);
});

test("抽奖请求失败后本页阻止此角色的所有罗盘再次抽取", async () => {
  let calls = 0;
  const send = async (command) => {
    calls++;
    if (command === COMPASS_COMMANDS.starInfo) return star(1);
    throw new Error("超时");
  };
  await assert.rejects(
    runCompassDraw({
      accountId: "timeout",
      kind: "white",
      count: 1,
      assertActive: active,
      send,
    }),
    (error) => error.compassUncertain === true && error.compassCompleted === 0,
  );
  assert.equal(isCompassAccountUncertain("timeout"), true);
  await assert.rejects(
    runCompassDraw({
      accountId: "timeout",
      kind: "chaos",
      roleId: 123,
      count: 1,
      assertActive: active,
      send,
    }),
    /未确认/,
  );
  assert.equal(calls, 2);
});

test("回包不完整后保留已确认的奖励并禁止重试", async () => {
  const send = async (command) =>
    command === COMPASS_COMMANDS.starInfo ? star(1) : { reward: [reward] };
  await assert.rejects(
    runCompassDraw({
      accountId: "bad-response",
      kind: "white",
      count: 1,
      assertActive: active,
      send,
    }),
    (error) =>
      error.compassUncertain &&
      error.compassCompleted === 1 &&
      error.compassRewards[0].itemId === 456,
  );
  await assert.rejects(
    runCompassDraw({
      accountId: "bad-response",
      kind: "white",
      count: 1,
      assertActive: active,
      send,
    }),
    /未确认/,
  );
});

test("观察者抛错也能返回已确认奖励，不重复抽奖", async () => {
  let draws = 0;
  const result = await runCompassDraw({
    accountId: "observer",
    kind: "white",
    count: 1,
    assertActive: active,
    onDraw() {
      throw new Error("observer failed");
    },
    send: async (command) => {
      if (command === COMPASS_COMMANDS.starInfo) return star(1);
      draws++;
      return { ...star(0), reward: [reward] };
    },
  });
  assert.equal(draws, 1);
  assert.deepEqual(result.rewards, [reward]);
  assert.equal(isCompassAccountUncertain("observer"), false);
});

test("必须提供已确认的有效混沌次数", async () => {
  let calls = 0;
  for (const count of [undefined, 0, -1, 1.1, true]) {
    await assert.rejects(
      runCompassDraw({
        accountId: "invalid",
        kind: "chaos",
        roleId: 123,
        count,
        assertActive: active,
        send: async () => {
          calls++;
        },
      }),
    );
  }
  assert.equal(calls, 0);
});

const allColors = (white, green, blue) => ({
  roleNMExt: { hasKeyCntMap: { 36997: white, 36998: green, 36999: blue } },
});

test("一键按白绿蓝顺序抽完三色钥匙，跳过没有钥匙的颜色", async () => {
  let balance = { white: 2, green: 0, blue: 1 };
  const ids = [];
  const observed = [];
  const result = await runCompassDraw({
    accountId: "all-star",
    kind: "allStar",
    count: { ...balance },
    assertActive: active,
    onDraw: (event) => observed.push(event.kind),
    send: async (command, { itemId }) => {
      if (command === COMPASS_COMMANDS.starInfo)
        return allColors(balance.white, balance.green, balance.blue);
      ids.push(itemId);
      const key = { 36997: "white", 36998: "green", 36999: "blue" }[itemId];
      balance = { ...balance, [key]: balance[key] - 1 };
      return {
        ...allColors(balance.white, balance.green, balance.blue),
        reward: [reward],
      };
    },
  });
  assert.deepEqual(ids, [36997, 36997, 36999]);
  assert.deepEqual(observed, ["white", "white", "blue"]);
  assert.equal(result.completed, 3);
  assert.equal(result.rewards.length, 3);
});

test("三色余额任一变化时不发起抽奖", async () => {
  let calls = 0;
  await assert.rejects(
    runCompassDraw({
      accountId: "all-stale",
      kind: "allStar",
      count: { white: 1, green: 0, blue: 1 },
      assertActive: active,
      send: async () => {
        calls++;
        return allColors(1, 1, 1);
      },
    }),
    /剩余次数已变化/,
  );
  assert.equal(calls, 1);
});

test("另一种钥匙余额发生异常变化时中止并保留奖励", async () => {
  let calls = 0;
  await assert.rejects(
    runCompassDraw({
      accountId: "all-unexpected",
      kind: "allStar",
      count: { white: 1, green: 1, blue: 1 },
      assertActive: active,
      send: async (command) => {
        calls++;
        return command === COMPASS_COMMANDS.starInfo
          ? allColors(1, 1, 1)
          : { ...allColors(0, 0, 1), reward: [reward] };
      },
    }),
    (error) =>
      error.compassCompleted === 1 &&
      error.compassUncertain &&
      error.compassRewards.length === 1,
  );
  assert.equal(calls, 2);
});

test("一键抽奖期间切换角色会中止后续颜色", async () => {
  let valid = true;
  let draws = 0;
  await assert.rejects(
    runCompassDraw({
      accountId: "all-interrupted",
      kind: "allStar",
      count: { white: 1, green: 1, blue: 1 },
      assertActive() {
        if (!valid) throw new Error("角色已切换");
      },
      send: async (command) => {
        if (command === COMPASS_COMMANDS.starInfo) return allColors(1, 1, 1);
        draws++;
        valid = false;
        return { ...allColors(0, 1, 1), reward: [reward] };
      },
    }),
    (error) =>
      error.compassCompleted === 1 && error.compassRewards.length === 1,
  );
  assert.equal(draws, 1);
});

test("三色全空、未提供颜色或超过上限均不发送请求", async () => {
  let calls = 0;
  for (const count of [
    { white: 0, green: 0, blue: 0 },
    { white: 1, green: 0 },
    { white: 201, green: 0, blue: 0 },
  ]) {
    await assert.rejects(
      runCompassDraw({
        accountId: "all-invalid",
        kind: "allStar",
        count,
        assertActive: active,
        send: async () => {
          calls++;
        },
      }),
    );
  }
  assert.equal(calls, 0);
});

test("读取本人十殿信息时传入角色 ID 并识别 nightMareData", () => {
  assert.equal(
    parseChaosSnapshot({
      weekAward: { turntableLeftCnt: 2 },
      nightMareData: { bookScore: 11, turnRewardTime: 5 },
    }).bonusProgress,
    6,
  );
});
