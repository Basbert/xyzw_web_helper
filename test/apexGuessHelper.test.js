
import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

const mockRules = {
  ApexScheduleStatus: { None: 0, Unlocked: 1, Locked: 2, Fighting: 3, Completed: 4 },
  calibrateServerTime: (now) => now,
  getCurrentSeason: () => 1,
  getCurrentRounds: () => [6],
  getGuessTabs: () => [
    { stage: 4, scheduleId: 150, title: "64强赛", state: 1 },
    { stage: 5, scheduleId: 151, title: "32强赛", state: 2 },
    { stage: 6, scheduleId: 152, title: "16强赛", state: 4 },
  ],
  getAdvanceNum: (round, season, stage) => {
    if (stage === 4) return 2;
    if (stage === 5) return 1;
    return 1;
  },
};

const mockRateLimit = {
  ApexAction: { READ: "read", GUESS: "guess" },
  isApexRateLimited: (e) => /200400|限流/.test(e?.message || ""),
  runApexAction: async (_action, task) => task(0),
};

const { resolveOpenGuesses, getApexGuessStatus, runApexAutoGuess } = await loadModule(
  new URL("../src/utils/apexGuessHelper.js", import.meta.url),
  {
    "./apexRules.js": mockRules,
    "./apexRateLimit.js": mockRateLimit,
  },
);

test("resolveOpenGuesses filters only unlocked and locked stages", () => {
  const open = resolveOpenGuesses(Date.now());
  assert.equal(open.length, 1);
  assert.equal(open[0].tabs.length, 2);
  assert.equal(open[0].tabs[0].stage, 4);
  assert.equal(open[0].tabs[1].stage, 5);
});

test("getApexGuessStatus calculates pending stages accurately", async () => {
  const tokenStore = {
    gameData: {
      roleInfo: {
        role: {
          apexRoleInfo: {
            guessMap: {
              150: ["team_1"],
              151: ["team_a"],
            },
          },
        },
      },
    },
    async sendMessageWithPromise() {
      return {};
    },
  };

  const status = await getApexGuessStatus(tokenStore, "t1", { fetchRole: false });
  assert.equal(status.hasOpenGuesses, true);
  assert.equal(status.openStagesCount, 2);
  assert.equal(status.pendingStagesCount, 1);
  assert.match(status.summaryText, /1 个阶段待竞猜/);
});

test("runApexAutoGuess picks team with higher cheerCnt and completes betting", async () => {
  const guesses = [];
  const tokenStore = {
    gameData: {
      roleInfo: {
        role: {
          apexRoleInfo: {
            guessMap: {
              151: ["team_x"],
            },
          },
        },
      },
    },
    async sendMessageWithPromise(tokenId, cmd, params) {
      if (cmd === "apex_getroleinfo") {
        return {
          apexRoleInfo: {
            guessMap: { 151: ["team_x"] },
          },
        };
      }
      if (cmd === "apex_getguesslist") {
        assert.equal(params.scheduleId, 150);
        return {
          apexGuessList: [
            [
              { teamId: "t1", name: "战队1", cheerCnt: 100 },
              { teamId: "t2", name: "战队2", cheerCnt: 500 },
            ],
            [
              { teamId: "t3", name: "战队3", cheerCnt: 800 },
              { teamId: "t4", name: "战队4", cheerCnt: 200 },
            ],
          ],
          last: true,
        };
      }
      if (cmd === "apex_guess") {
        guesses.push(params.teamId);
        return {};
      }
      throw new Error(`Unexpected command: ${  cmd}`);
    },
  };

  const res = await runApexAutoGuess({
    tokenStore,
    tokenId: "t1",
  });

  assert.equal(res.successCount, 2);
  assert.deepEqual(guesses, ["t2", "t3"]);
});
