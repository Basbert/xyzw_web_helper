import assert from "node:assert/strict";
import test from "node:test";
import {
  runTenHallSeries,
  summarizeTenHallResults,
} from "../src/utils/tenHallSeries.js";

const verifiedLoadout = {
  heroes: "matched",
  weapon: { status: "matched" },
  pet: { status: "matched" },
};
const battle = (other = {}) => ({
  isWin: true,
  rounds: 11,
  downCount: 0,
  loadout: verifiedLoadout,
  loadoutSignature: "same-team",
  ...other,
});

test("runs sequentially, asks for confirmation once and checks the same configuration", async () => {
  let active = false;
  let confirms = 0;
  const expected = [];
  const snapshots = [];
  const result = await runTenHallSeries({
    count: 3,
    wait: async () => {},
    confirmLoadout: async () => {
      confirms++;
      return true;
    },
    onResult: (items) => snapshots.push(items.length),
    runSimulation: async ({ confirmLoadout, expectedLoadout }) => {
      assert.equal(active, false);
      active = true;
      expected.push(expectedLoadout);
      if (confirmLoadout) assert.equal(await confirmLoadout(), true);
      await Promise.resolve();
      active = false;
      return battle();
    },
  });
  assert.equal(confirms, 1);
  assert.deepEqual(expected, [undefined, "same-team", "same-team"]);
  assert.deepEqual(snapshots, [1, 2, 3]);
  assert.equal(result.results.length, 3);
  assert.equal(result.error, null);
});

test("keeps completed samples and stops on a server error without retrying", async () => {
  let calls = 0;
  const run = await runTenHallSeries({
    count: 10,
    wait: async () => {},
    runSimulation: async () => {
      calls++;
      if (calls === 3) throw new Error("服务器限流");
      return battle();
    },
  });
  assert.equal(calls, 3);
  assert.equal(run.results.length, 2);
  assert.match(run.error.message, /服务器限流/);
});

test("does not continue when actual battle equipment cannot be verified", async () => {
  let calls = 0;
  const run = await runTenHallSeries({
    count: 20,
    wait: async () => {},
    runSimulation: async () => {
      calls++;
      return battle({
        loadout: { ...verifiedLoadout, pet: { status: "unknown" } },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(run.results.length, 1);
  assert.match(run.error.message, /配置未能全部确认/);
});

test("cancellation between rooms preserves the results already returned", async () => {
  const controller = new AbortController();
  let calls = 0;
  const run = await runTenHallSeries({
    count: 10,
    signal: controller.signal,
    wait: async () => controller.abort(),
    runSimulation: async () => {
      calls++;
      return battle();
    },
  });
  assert.equal(calls, 1);
  assert.equal(run.results.length, 1);
  assert.equal(run.error.name, "AbortError");
});

test("keeps a battle report if waiting for that room to close fails", async () => {
  let calls = 0;
  const run = await runTenHallSeries({
    count: 10,
    wait: async () => {},
    runSimulation: async ({ onBattleResult, waitForRoomEnd }) => {
      calls++;
      assert.equal(waitForRoomEnd, true);
      onBattleResult(battle());
      throw new Error("未收到房间结束通知");
    },
  });
  assert.equal(calls, 1);
  assert.equal(run.results.length, 1);
  assert.match(run.error.message, /房间结束/);
});

test("reports unknown results separately and picks a winning sample by deaths then rounds", () => {
  const summary = summarizeTenHallResults([
    battle({ rounds: 7, downCount: 1 }),
    battle({ rounds: 12, downCount: 0 }),
    battle({ isWin: false, rounds: 3, downCount: 5 }),
    battle({ isWin: null, rounds: null, downCount: null }),
    battle({ rounds: 9, downCount: 0 }),
  ]);
  assert.equal(summary.wins, 3);
  assert.equal(summary.losses, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.averageRounds, 9.3);
  assert.equal(summary.noDownWins, 2);
  assert.equal(summary.best.index, 5);
});

test("rejects out-of-range counts before running a battle", async () => {
  for (const count of [0, 21, 1.5]) {
    await assert.rejects(runTenHallSeries({ count }), /1 至 20/);
  }
});
