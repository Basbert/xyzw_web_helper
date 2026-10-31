import assert from "node:assert/strict";
import test from "node:test";
import {
  makeTenHallRoomRequest,
  makeTenHallTeam,
  runTenHallSimulation,
} from "../src/utils/tenHallSimulation.js";

const role = {
  roleId: 123,
  name: "小鱼",
  lordWeaponId: 2,
  pet: { petUId: "pet-1", petId: 501 },
  battleTeam: { 0: { heroId: 104 }, 1: { heroId: 105 } },
  heroes: {
    104: { level: 6000, artifactId: 20, pearlId: 3 },
    105: { level: 5500, artifactId: 30, pearlId: 0 },
  },
};

function mockGame({
  queued = false,
  wrongRoom = false,
  abortOnQueue = false,
  abortAfterCreate = false,
  unavailable = false,
  roomChange = {},
  battleChange = {},
} = {}) {
  const calls = [];
  const listeners = new Set();
  const controller = new AbortController();
  const client = {
    subscribeMessages(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(cmd, body) {
      for (const fn of listeners) fn({ cmd, rawData: body, code: 0 });
    },
  };
  let ready = false;
  let activeHall = 1;
  const room = () => ({
    roomId: "test-room",
    leaderId: role.roleId,
    rule: { roleNum: 2, clientRoleNum: wrongRoom ? 2 : 201, nM: activeHall },
    watchRoles: {
      123: {
        battleTeam: { 0: 104, 1: 105 },
        lordWeaponId: 2,
        petUId: "pet-1",
        ...roomChange,
      },
    },
    fightRoleBase: [
      { roleId: 123, state: ready ? 1 : 0 },
      { roleId: 1, state: 1 },
    ],
  });
  const tokenStore = {
    selectedToken: { id: "a" },
    gameData: { battleVersion: 240521 },
    getWebSocketClient: () => client,
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(_id, command, params) {
      calls.push({ command, params });
      if (command === "role_getroleinfo") return { role };
      if (command === "pkroom_create") {
        if (unavailable) throw new Error("服务器错误: 7300008 - 未知错误");
        activeHall = params.roomRule.nM;
        if (queued && !params.notifyCreate) {
          client.emit("pkroom_queuenotify", {
            roomType: 0,
            queueIndex: 1,
            queueNum: 2,
          });
          if (!abortOnQueue)
            client.emit("pkroom_queuecreatenotify", { roomType: 0 });
          if (abortOnQueue) controller.abort();
          throw new Error("排队中");
        }
        if (abortAfterCreate) controller.abort();
        return { roomInfo: room() };
      }
      if (command === "pkroom_calcteam")
        return { roomInfo: { watchRoles: {} } };
      if (command === "pkroom_setpkteam") {
        ready = true;
        return { roomInfo: {} };
      }
      if (command === "pkroom_getroominfo") return { roomInfo: room() };
      if (command === "pkroom_startbattle") {
        client.emit("pkroom_fightnotify", {
          battleData: {
            leftTeam: {
              roleId: 123,
              team: { 0: { id: 104 }, 1: { id: 105 } },
              weaponId: 2,
              petUId: "pet-1",
              petId: 501,
              ...battleChange,
            },
            result: {
              isWin: true,
              round: 12,
              sponsor: {
                roleId: 123,
                teamInfo: [
                  { heroId: 104, hp: 100 },
                  { heroId: 105, hp: 0 },
                ],
              },
              accept: { teamInfo: [{ hp: 0 }] },
            },
          },
        });
        return { roomInfo: {} };
      }
      if (command === "pkroom_cancelqueue" || command === "pkroom_dismiss")
        return {};
      throw new Error(`unexpected ${command}`);
    },
  };
  return { tokenStore, client, calls, controller, listeners };
}

const run = (mock, options = {}) =>
  runTenHallSimulation({
    tokenStore: mock.tokenStore,
    tokenId: "a",
    hall: 1,
    signal: mock.controller.signal,
    ...options,
  });

test("uses only the normal free room and a valid hall", () => {
  const request = makeTenHallRoomRequest("小鱼", 8);
  assert.equal(request.roomType, 0);
  assert.equal(request.roomRule.roleNum, 201);
  assert.equal(request.roomRule.nM, 8);
  assert.equal(request.notifyCreate, false);
  assert.throws(() => makeTenHallRoomRequest("小鱼", 9), /第一至第八殿/);
});

test("maps the current formation, hero equipment and pet into the room format", () => {
  const team = makeTenHallTeam(role, "room");
  assert.deepEqual(
    [...team.battleTeam],
    [
      [0, 104],
      [1, 105],
    ],
  );
  assert.deepEqual(
    [...team.heroLevel],
    [
      [0, 6000],
      [1, 5500],
    ],
  );
  assert.deepEqual(team.newHeroArtifact.get(0), { artifactId: 20, pearlId: 3 });
  assert.equal(team.petUId, "pet-1");
  assert.throws(
    () => makeTenHallTeam({ ...role, heroes: {} }, "room"),
    /阵容信息不完整/,
  );
  assert.throws(
    () => makeTenHallTeam({ ...role, pet: { petId: 501 } }, "room"),
    /宠物信息不完整/,
  );
});

test("captures an early fight notification and interprets the actual result", async () => {
  const game = mockGame();
  const result = await run(game);
  assert.equal(result.isWin, true);
  assert.equal(result.rounds, 12);
  assert.equal(result.downCount, 1);
  assert.equal(result.loadout.heroes, "matched");
  assert.deepEqual(result.loadout.weapon, { status: "matched", actualId: 2 });
  assert.deepEqual(result.loadout.pet, { status: "matched", actualId: 501 });
  assert.equal(game.listeners.size, 0);
  assert.deepEqual(
    game.calls.map((c) => c.command),
    [
      "role_getroleinfo",
      "pkroom_create",
      "pkroom_calcteam",
      "pkroom_getroominfo",
      "pkroom_setpkteam",
      "pkroom_getroominfo",
      "pkroom_startbattle",
    ],
  );
  assert.equal(game.calls.at(-1).params.battleVersion, 240521);
});

test("does not start if the room did not apply the selected heroes, toy or pet", async (t) => {
  for (const [change, label] of [
    [{ battleTeam: { 0: 105, 1: 104 } }, "武将阵容"],
    [{ lordWeaponId: 3 }, "玩具"],
    [{ petUId: "other-pet" }, "宠物"],
    [{ petUId: undefined }, "宠物"],
  ]) {
    await t.test(label, async () => {
      const game = mockGame({ roomChange: change });
      await assert.rejects(run(game), new RegExp(label));
      assert.ok(!game.calls.some((c) => c.command === "pkroom_startbattle"));
      assert.ok(game.calls.some((c) => c.command === "pkroom_dismiss"));
    });
  }
});

test("reports an actual battle mismatch or missing fields instead of confirming them", async () => {
  const game = mockGame({
    battleChange: {
      team: { 0: { id: 105 }, 1: { id: 104 } },
      weaponId: 3,
      petUId: undefined,
    },
  });
  const result = await run(game);
  assert.equal(result.loadout.heroes, "mismatch");
  assert.equal(result.loadout.weapon.status, "mismatch");
  assert.equal(result.loadout.pet.status, "unknown");
});

test("waits for the server's queue-ready push and creates once with notifyCreate", async () => {
  const game = mockGame({ queued: true });
  assert.equal((await run(game)).isWin, true);
  const creates = game.calls.filter((c) => c.command === "pkroom_create");
  assert.deepEqual(
    creates.map((c) => c.params.notifyCreate),
    [false, true],
  );
  assert.equal(game.listeners.size, 0);
});

test("cancelling a queue sends a cancellation and never starts a battle", async () => {
  const game = mockGame({ queued: true, abortOnQueue: true });
  await assert.rejects(run(game), { name: "AbortError" });
  assert.ok(game.calls.some((c) => c.command === "pkroom_cancelqueue"));
  assert.ok(!game.calls.some((c) => c.command === "pkroom_startbattle"));
  assert.equal(game.listeners.size, 0);
});

test("does not fight in a room whose returned rule is not a ten-hall simulation", async () => {
  const game = mockGame({ wrongRoom: true });
  await assert.rejects(run(game), /免费模拟设置不一致/);
  assert.ok(!game.calls.some((c) => c.command === "pkroom_startbattle"));
  assert.ok(!game.calls.some((c) => c.command === "pkroom_dismiss"));
});

test("cancelling after room creation closes only the confirmed owned simulation room", async () => {
  const game = mockGame({ abortAfterCreate: true });
  await assert.rejects(run(game), { name: "AbortError" });
  assert.ok(game.calls.some((c) => c.command === "pkroom_dismiss"));
  assert.ok(!game.calls.some((c) => c.command === "pkroom_startbattle"));
});

test("explains that the free room may be unavailable outside its opening hours", async () => {
  const game = mockGame({ unavailable: true });
  await assert.rejects(run(game), /检查免费房间的开放时间/);
  assert.ok(!game.calls.some((c) => c.command === "pkroom_startbattle"));
});
