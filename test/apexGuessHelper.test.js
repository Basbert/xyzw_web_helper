import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

const rules = {
  ApexScheduleStatus: {
    None: 0,
    Unlocked: 1,
    Locked: 2,
    Fighting: 3,
    Completed: 4,
  },
  calibrateServerTime: (now) => now,
  getCurrentSeason: () => 1,
  getCurrentRounds: () => [6],
  getGuessTabs: () => [
    { stage: 4, scheduleId: 150, title: "64强赛", state: 1 },
    { stage: 5, scheduleId: 151, title: "32强赛", state: 2 },
    { stage: 6, scheduleId: 152, title: "16强赛", state: 4 },
  ],
  getAdvanceNum: (_round, _season, stage) => (stage === 4 ? 2 : 1),
  canGuessRow: (_state, stage, row) =>
    stage !== 10 || !(row.team1Win || row.team2Win),
};
const rateLimit = {
  ApexAction: { READ: "read", GUESS: "guess" },
  isApexRateLimited: (error) => /200400|限流/.test(error?.message || ""),
  runApexAction: async (_action, task) => task(0),
};
const createHelper = (overrides = {}) =>
  loadModule(new URL("../src/utils/apexGuessHelper.js", import.meta.url), {
    "./apexRules.js": overrides.rules || rules,
    "./apexRateLimit.js": overrides.rateLimit || rateLimit,
  });
const {
  resolveOpenGuesses,
  getApexGuessStatus,
  runApexAutoGuess,
  withApexGuessLock,
} = await createHelper();

function fixture({ record = { 151: ["old"] }, pages, onGuess } = {}) {
  const guessMap = structuredClone(record);
  const calls = [];
  const pageData = pages || {
    150: [
      [
        { teamId: "a", name: "甲", cheerCnt: 10 },
        { teamId: "b", name: "乙", cheerCnt: 90 },
      ],
      [
        { teamId: "c", name: "丙", cheerCnt: 80 },
        { teamId: "d", name: "丁", cheerCnt: 20 },
      ],
    ],
  };
  const tokenStore = {
    gameData: {
      roleInfo: { role: { apexRoleInfo: { guessMap: { 150: ["stale"] } } } },
    },
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ id, cmd, params });
      if (cmd === "apex_getroleinfo")
        return { apexRoleInfo: { guessMap: structuredClone(guessMap) } };
      if (cmd === "apex_getguesslist") {
        const all = pageData[params.scheduleId] || [];
        return {
          apexGuessList: all.slice(params.idx, params.idx + 1),
          last: true,
        };
      }
      if (cmd === "apex_guess") {
        if (onGuess) await onGuess(params.teamId);
        const stage = Object.entries(pageData).find(([, groups]) =>
          groups.some((group) =>
            group.some((team) => team.teamId === params.teamId),
          ),
        )?.[0];
        (guessMap[stage] ||= []).push(params.teamId);
        return {};
      }
      throw new Error(`Unexpected command ${cmd}`);
    },
  };
  return { tokenStore, calls, guessMap };
}

test("open stages exclude completed stages", () => {
  const open = resolveOpenGuesses(Date.now());
  assert.equal(open[0].tabs.length, 2);
  assert.equal(open[0].tabs[1].stage, 5);
});

test("status uses a fresh account response instead of the shared role cache", async () => {
  const f = fixture({ record: { 150: ["a"], 151: ["old"] } });
  const status = await getApexGuessStatus(f.tokenStore, "account");
  assert.equal(status.pendingStagesCount, 1);
  assert.equal(status.remainingSlots, 1);
  assert.equal(f.calls[0].id, "account");
  assert.equal(
    f.tokenStore.gameData.roleInfo.role.apexRoleInfo.guessMap[150][0],
    "stale",
  );
});

test("missing role response cannot be reported as no open guesses or completion", async () => {
  const tokenStore = {
    async sendMessageWithPromise() {
      return {};
    },
  };
  await assert.rejects(getApexGuessStatus(tokenStore, "account"), /未获取到/);
  const result = await runApexAutoGuess({ tokenStore, tokenId: "account" });
  assert.equal(result.outcome, "partial");
  assert.match(result.message, /未能读取/);
});

test("already selected matchups are skipped and later pages are read despite last=true", async () => {
  const f = fixture({ record: { 150: ["a"], 151: ["old"] } });
  const result = await runApexAutoGuess({
    tokenStore: f.tokenStore,
    tokenId: "account",
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.successCount, 1);
  assert.deepEqual(
    f.calls.filter((x) => x.cmd === "apex_guess").map((x) => x.params.teamId),
    ["c"],
  );
  assert.deepEqual(
    f.calls
      .filter((x) => x.cmd === "apex_getguesslist")
      .map((x) => x.params.idx),
    [0, 1],
  );
  assert.equal(result.verifiedStatus.pendingStagesCount, 0);
});

test("empty match data is reported as incomplete instead of completed", async () => {
  const f = fixture({ pages: { 150: [] } });
  const result = await runApexAutoGuess({
    tokenStore: f.tokenStore,
    tokenId: "account",
  });
  assert.equal(result.outcome, "partial");
  assert.match(result.message, /未全部获取/);
  assert.equal(
    f.calls.some((x) => x.cmd === "apex_guess"),
    false,
  );
});

test("missing vote counts skip the matchup and leave a partial result", async () => {
  const f = fixture({
    pages: {
      150: [
        [
          { teamId: "a", cheerCnt: null },
          { teamId: "b", cheerCnt: 5 },
        ],
        [
          { teamId: "c", cheerCnt: 10 },
          { teamId: "d", cheerCnt: 3 },
        ],
      ],
    },
  });
  const result = await runApexAutoGuess({
    tokenStore: f.tokenStore,
    tokenId: "account",
  });
  assert.equal(result.outcome, "partial");
  assert.match(result.message, /助威数缺失/);
  assert.deepEqual(
    f.calls.filter((x) => x.cmd === "apex_guess").map((x) => x.params.teamId),
    ["c"],
  );
});

test("an unconfirmed guess stops further writes and retains the result", async () => {
  const f = fixture({
    onGuess: async () => {
      throw new Error("请求超时");
    },
  });
  const result = await runApexAutoGuess({
    tokenStore: f.tokenStore,
    tokenId: "account",
  });
  assert.equal(result.outcome, "partial");
  assert.match(result.message, /结果未确认/);
  assert.equal(result.entries[0].status, "unconfirmed");
  assert.equal(f.calls.filter((x) => x.cmd === "apex_guess").length, 1);
});

test("account interruption during queue wait prevents the queued guess", async () => {
  let release;
  let queued;
  const waiting = new Promise((resolve) => {
    queued = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const helper = await createHelper({
    rateLimit: {
      ...rateLimit,
      async runApexAction(action, task) {
        if (action === "guess") {
          queued();
          await gate;
        }
        return task(0);
      },
    },
  });
  const f = fixture();
  let interrupted = false;
  const running = helper.runApexAutoGuess({
    tokenStore: f.tokenStore,
    tokenId: "account",
    checkInterrupted() {
      if (interrupted)
        throw Object.assign(new Error("账号已切换"), { interrupted: true });
    },
  });
  await waiting;
  interrupted = true;
  release();
  const result = await running;
  assert.equal(result.outcome, "stopped");
  assert.match(result.message, /账号已切换/);
  assert.equal(
    f.calls.some((x) => x.cmd === "apex_guess"),
    false,
  );
});

test("a lock blocks overlapping guesses for the same account and releases afterwards", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = withApexGuessLock("account", () => gate);
  await assert.rejects(
    withApexGuessLock("account", async () => {}),
    /已有竞猜/,
  );
  assert.equal(await withApexGuessLock("other", async () => "ok"), "ok");
  release();
  await first;
  assert.equal(
    await withApexGuessLock("account", async () => "again"),
    "again",
  );
});

test("a stage that closes during queueing sends no guess", async () => {
  let open = true;
  const changingRules = {
    ...rules,
    getGuessTabs: () =>
      open ? [{ stage: 5, scheduleId: 151, title: "32强赛", state: 1 }] : [],
  };
  const helper = await createHelper({ rules: changingRules });
  const calls = [];
  const tokenStore = {
    async sendMessageWithPromise(_id, cmd) {
      calls.push(cmd);
      if (cmd === "apex_getroleinfo") return { apexRoleInfo: { guessMap: {} } };
      if (cmd === "apex_getguesslist") {
        open = false;
        return {
          apexGuessList: [
            [
              { teamId: "a", cheerCnt: 5 },
              { teamId: "b", cheerCnt: 1 },
            ],
          ],
          last: true,
        };
      }
      throw new Error("A guess should not be sent");
    },
  };
  const result = await helper.runApexAutoGuess({
    tokenStore,
    tokenId: "account",
  });
  assert.equal(result.outcome, "partial");
  assert.equal(result.entries[0].status, "not-sent");
  assert.match(result.message, /已结束/);
  assert.equal(calls.includes("apex_guess"), false);
});

test("acknowledgement alone cannot claim completion without refreshed server state", async () => {
  const f = fixture({ record: { 150: ["a"], 151: ["old"] } });
  const original = f.tokenStore.sendMessageWithPromise;
  f.tokenStore.sendMessageWithPromise = async (...args) => {
    if (args[1] === "apex_guess") {
      f.calls.push({ id: args[0], cmd: args[1], params: args[2] });
      return {};
    }
    return original(...args);
  };
  const result = await runApexAutoGuess({
    tokenStore: f.tokenStore,
    tokenId: "account",
  });
  assert.equal(result.successCount, 1);
  assert.equal(result.outcome, "partial");
  assert.match(result.message, /待处理/);
});

test("a stage closing before the final refresh is not labelled fully guessed", async () => {
  let open = true;
  let reads = 0;
  const changingRules = {
    ...rules,
    getGuessTabs: () =>
      open ? [{ stage: 5, scheduleId: 151, title: "32强赛", state: 1 }] : [],
  };
  const helper = await createHelper({ rules: changingRules });
  const tokenStore = {
    async sendMessageWithPromise(_id, cmd) {
      assert.equal(cmd, "apex_getroleinfo");
      reads++;
      if (reads === 2) open = false;
      return { apexRoleInfo: { guessMap: { 151: ["old"] } } };
    },
  };
  const result = await helper.runApexAutoGuess({
    tokenStore,
    tokenId: "account",
  });
  assert.equal(result.successCount, 0);
  assert.equal(result.message, "当前赛程内暂无开放竞猜");
});
