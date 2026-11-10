import assert from "node:assert/strict";
import test from "node:test";
import {
  activePresetId,
  presetSwitchFailure,
  readTenHallPreset,
  setTenHallPreset,
} from "../src/utils/tenHallFormation.js";

test("reads only a confirmed preset id, never a guessed default", () => {
  assert.equal(activePresetId({ presetTeamInfo: { useTeamId: 3 } }), 3);
  assert.equal(
    activePresetId({ presetTeamInfo: { presetTeamInfo: { useTeamId: 4 } } }),
    4,
  );
  assert.equal(activePresetId({ presetTeamInfo: {} }), null);
  assert.equal(activePresetId({ useTeamId: 5 }), null);
});

function mockStore(info = 2) {
  const calls = [];
  const client = {};
  const store = {
    selectedToken: { id: "a" },
    getWebSocketClient: () => client,
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(_id, command, params) {
      calls.push([command, params]);
      return command === "presetteam_getinfo"
        ? { presetTeamInfo: { useTeamId: info } }
        : {};
    },
  };
  return { store, calls };
}

test("switches and reads the server's confirmed preset", async () => {
  const { store, calls } = mockStore();
  assert.equal(
    await setTenHallPreset({ tokenStore: store, tokenId: "a", teamId: 2 }),
    2,
  );
  assert.deepEqual(calls, [
    ["presetteam_saveteam", { teamId: 2 }],
    ["presetteam_getinfo", {}],
  ]);
});

test("does not report success when the server cannot confirm the chosen preset", async () => {
  const { store } = mockStore(1);
  await assert.rejects(
    setTenHallPreset({ tokenStore: store, tokenId: "a", teamId: 2 }),
    /服务器未确认/,
  );
});

test("stops before reading another account if selection changes during the switch", async () => {
  const { store, calls } = mockStore();
  const send = store.sendMessageWithPromise;
  store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    store.selectedToken = { id: "b" };
    return result;
  };
  await assert.rejects(
    setTenHallPreset({ tokenStore: store, tokenId: "a", teamId: 2 }),
    /角色已切换/,
  );
  assert.deepEqual(
    calls.map(([command]) => command),
    ["presetteam_saveteam"],
  );
});

test("a timed-out switch is presented as potentially applied", async () => {
  const { store, calls } = mockStore();
  store.sendMessageWithPromise = async (_id, command, params) => {
    calls.push([command, params]);
    throw new Error("请求超时");
  };
  await assert.rejects(
    setTenHallPreset({ tokenStore: store, tokenId: "a", teamId: 2 }),
    (error) => {
      assert.match(presetSwitchFailure(error), /请求超时/);
      assert.match(
        presetSwitchFailure(error),
        /可能已生效.*可能已变化.*刷新预览/,
      );
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("a stale refresh never returns a previous account's preset", async () => {
  const { store } = mockStore();
  let finish;
  store.sendMessageWithPromise = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = readTenHallPreset({ tokenStore: store, tokenId: "a" });
  store.selectedToken = { id: "b" };
  finish({ presetTeamInfo: { useTeamId: 2 } });
  assert.equal(await pending, null);
});
