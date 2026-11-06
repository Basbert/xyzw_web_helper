import assert from "node:assert/strict";
import test from "node:test";
import { runBossTower } from "../src/utils/bossTowerRunner.js";

function fixture({ floor = 1, failAt, changeAt, day = 3 } = {}) {
  const calls = [];
  let active = true;
  return {
    calls,
    args: {
      tokenId: "account",
      now: () => ({ getDay: () => day }),
      wait: async () => {},
      checkActive() {
        if (!active) {
          const error = new Error("账号已切换");
          error.interrupted = true;
          throw error;
        }
      },
      tokenStore: {
        async sendMessageWithPromise(_id, command) {
          calls.push(command);
          if (calls.length === changeAt) active = false;
          if (calls.length === failAt) throw new Error("timeout");
          if (command === "bosstower_getinfo")
            return { bossTower: { towerId: floor } };
          return {};
        },
      },
    },
  };
}
test("vault commands run sequentially after the server floor is confirmed", async () => {
  const f = fixture();
  const result = await runBossTower(f.args);
  assert.equal(result.refreshed, true);
  assert.equal(f.calls.filter((x) => x === "bosstower_startboss").length, 2);
  assert.equal(f.calls.filter((x) => x === "bosstower_startbox").length, 9);
  assert.equal(f.calls.at(-1), "bosstower_getinfo");
});
test("unsupported or unknown floor never starts a battle", async () => {
  const f = fixture({ floor: null });
  await assert.rejects(runBossTower(f.args), /无法确认/);
  assert.deepEqual(f.calls, ["bosstower_getinfo"]);
});
test("uncertain response or account switch stops all later commands", async () => {
  const timeout = fixture({ failAt: 3 });
  await assert.rejects(runBossTower(timeout.args), /结果未确认/);
  assert.equal(timeout.calls.length, 3);
  const switched = fixture({ changeAt: 2 });
  await assert.rejects(runBossTower(switched.args), /账号已切换/);
  assert.equal(switched.calls.length, 2);
});
test("closed-day check uses the time of the click", async () => {
  const f = fixture({ day: 1 });
  await assert.rejects(runBossTower(f.args), /未到宝库开放时间/);
  assert.deepEqual(f.calls, []);
});
