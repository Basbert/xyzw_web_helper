import assert from "node:assert/strict";
import test from "node:test";
import {
  getWeeklyQuizProgress,
  readWeeklyQuizConfig,
  runWeeklyQuiz,
} from "../src/utils/weeklyQuiz.js";

const monday = Date.parse("2026-11-16T00:00:00+08:00") / 1000;
const tuesday = monday + 86400;
const config = readWeeklyQuizConfig({
  ConstantConf: {
    studyQuestionNum: 2,
    studyDailyChance: 3,
    studyEnergyCost: 10,
  },
  StudyActConf: {
    1: { id: 1, actType: 1, startTime: 1, endTime: monday + 864000 },
  },
  StudyRewardConf: {
    1: { id: 1, actId: 1, periodType: 2, correctNum: 1 },
    3: { id: 3, actId: 1, periodType: 2, correctNum: 2 },
    8: { id: 8, actId: 5, periodType: 2, correctNum: 1 },
  },
  StudyConf: {
    100: { id: 100, correctOption: 2 },
    200: { id: 200, correctOption: 1 },
  },
});

function fixture({
  beginTime = monday - 1,
  taskDay = monday,
  maxCorrectNum = 2,
  taskComplete = { 1: "claimed", 3: "claimed" },
} = {}) {
  const calls = [];
  let client = { socket: {}, serverTime: (taskDay + 36000) * 1000 };
  const account = { value: {} };
  const role = {
    dailyTask: { dailyTime: taskDay },
    hallEnergy: 12,
    studyTime: 0,
    study: { beginTime, maxCorrectNum, taskComplete },
  };
  const store = {
    getAccountGameData: () => account,
    getWebSocketClient: () => client,
    getWebSocketStatus: () => "connected",
    sendGetRoleInfo: async () => ({ role }),
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ id, cmd, params });
      if (cmd === "study_startgame") {
        role.study = {
          beginTime: taskDay + 60,
          maxCorrectNum: 0,
          taskComplete: {},
        };
        const questions = [{ id: 100 }, { id: 200 }];
        return {
          role: { study: { id: 11, question: [...questions].reverse() } },
          questionList: questions,
        };
      }
      if (cmd === "study_answer") {
        role.study.maxCorrectNum++;
        role.study.taskComplete[role.study.maxCorrectNum === 1 ? 1 : 3] = "yes";
      }
      if (cmd === "study_claimreward")
        role.study.taskComplete[params.rewardId] = "claimed";
      return {};
    },
  };
  return {
    role,
    calls,
    account,
    store,
    swapConnection: () => {
      client = { ...client, socket: {} };
    },
    run: (overrides) =>
      runWeeklyQuiz({
        tokenStore: store,
        tokenId: "a",
        loadConfig: () => config,
        sleep: async () => {},
        daily: true,
        ...overrides,
      }),
  };
}

test("北京时间周一零点重置，上周成绩和领奖记录不阻挡本周", async () => {
  const f = fixture();
  assert.equal(getWeeklyQuizProgress(f.role, config).correct, 0);
  assert.equal((await f.run()).status, "completed");
  assert.deepEqual(
    f.calls.map(({ cmd }) => cmd),
    [
      "study_startgame",
      "study_answer",
      "study_answer",
      "study_claimreward",
      "study_claimreward",
    ],
  );
  assert.deepEqual(
    f.calls.slice(1, 3).map(({ params }) => params),
    [
      { id: 11, questionId: [200], option: [1] },
      { id: 11, questionId: [100], option: [2] },
    ],
  );
  assert.deepEqual(
    f.calls.slice(3).map(({ params }) => params.rewardId),
    [1, 3],
  );
  assert.equal((await f.run()).status, "skipped");
  assert.equal(f.calls.length, 5);
});

test("周一未运行，周二的一键每日仍可补做", async () => {
  const f = fixture({ taskDay: tuesday });
  assert.equal((await f.run()).status, "completed");
  assert.equal(f.calls[0].cmd, "study_startgame");
});

test("本周答满只补领，服务器未确认时仍显示待核对", async () => {
  const f = fixture({
    taskDay: tuesday,
    beginTime: monday,
    taskComplete: { 1: "claimed", 3: "yes" },
  });
  f.store.sendMessageWithPromise = async (_id, cmd) => {
    f.calls.push(cmd);
    return {};
  };
  assert.equal((await f.run()).status, "pending");
  assert.deepEqual(f.calls, ["study_claimreward"]);
});

test("今日已答过一局只补领，到了下一天可补做", async () => {
  const f = fixture({
    beginTime: monday + 120,
    maxCorrectNum: 1,
    taskComplete: { 1: "yes" },
  });
  assert.equal((await f.run()).status, "pending");
  assert.deepEqual(
    f.calls.map(({ cmd }) => cmd),
    ["study_claimreward"],
  );
  f.role.dailyTask.dailyTime = tuesday;
  assert.equal((await f.run()).status, "completed");
});

test("连接替换会停止后续写入并释放状态", async () => {
  const f = fixture();
  await assert.rejects(f.run({ sleep: async () => f.swapConnection() }), {
    interrupted: true,
  });
  assert.deepEqual(
    f.calls.map(({ cmd }) => cmd),
    ["study_startgame", "study_answer"],
  );
  assert.equal(f.account.value.weeklyQuizPhase, "");
});

test("无法核对服务器题目时不猜答案，不二次开局", async () => {
  const f = fixture();
  f.store.sendMessageWithPromise = async (_id, cmd) => {
    f.calls.push(cmd);
    return {
      role: { study: { id: 11 } },
      questionList: [{ id: 100 }, { id: 999 }],
    };
  };
  assert.equal((await f.run()).status, "pending");
  assert.deepEqual(f.calls, ["study_startgame"]);
});

test("同一角色的手动、批量和每日调用共用正在运行状态", async () => {
  const f = fixture();
  let release;
  const first = f.run({
    loadConfig: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  assert.equal((await f.run({ daily: false })).status, "pending");
  release(config);
  assert.equal((await first).status, "completed");
  assert.equal(
    f.calls.filter(({ cmd }) => cmd === "study_startgame").length,
    1,
  );
});

test("次数用尽或客厅电量不足时，自动流程不开始新一局", async () => {
  const f = fixture();
  f.role.studyTime = 3;
  assert.match((await f.run()).message, /次数已用完/);
  f.role.studyTime = 0;
  f.role.hallEnergy = 9;
  assert.match((await f.run()).message, /电量不足/);
  assert.deepEqual(f.calls, []);
});
