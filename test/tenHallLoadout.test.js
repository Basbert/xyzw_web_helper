import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectBattleLoadout,
  inspectRoomLoadout,
} from "../src/utils/tenHallLoadout.js";

const selected = {
  battleTeam: new Map([
    [0, 110],
    [1, 109],
  ]),
  lordWeaponId: 2,
  petUId: "pet-1",
};

test("compares the server room's heroes by position and verifies toy and pet", () => {
  const room = {
    watchRoles: new Map([
      [
        123,
        {
          battleTeam: { 0: 110, 1: 109 },
          lordWeaponId: 2,
          petUId: "pet-1",
        },
      ],
    ]),
  };
  assert.deepEqual(inspectRoomLoadout(room, 123, selected).issues, []);
  room.watchRoles.get(123).battleTeam = { 0: 109, 1: 110 };
  assert.deepEqual(inspectRoomLoadout(room, 123, selected).issues, [
    "武将阵容",
  ]);
  assert.ok(inspectRoomLoadout({}, 123, selected).issues.includes("武将阵容"));
});

test("reads the actual right-hand team and refuses to confirm a conflicting pet ID", () => {
  const battle = {
    rightTeam: {
      team: { 0: { id: 110 }, 1: { id: 109 } },
      weaponId: 2,
      petUId: "pet-1",
      petId: 501,
    },
  };
  const actual = inspectBattleLoadout(battle, "accept", selected, 501);
  assert.equal(actual.heroes, "matched");
  assert.equal(actual.weapon.status, "matched");
  assert.equal(actual.pet.status, "matched");
  battle.rightTeam.petId = 502;
  assert.equal(
    inspectBattleLoadout(battle, "accept", selected, 501).pet.status,
    "mismatch",
  );
});

test("does not claim missing battle data is confirmed", () => {
  const result = inspectBattleLoadout({}, "sponsor", {
    battleTeam: selected.battleTeam,
    lordWeaponId: 0,
    petUId: "",
  });
  assert.equal(result.heroes, "unknown");
  assert.equal(result.weapon.status, "unknown");
  assert.equal(result.pet.status, "unknown");
});

test("allows an empty toy and pet when the room confirms the formation", () => {
  const noEquipment = { ...selected, lordWeaponId: 0, petUId: "" };
  const room = { watchRoles: { 123: { battleTeam: { 0: 110, 1: 109 } } } };
  const roomResult = inspectRoomLoadout(room, 123, noEquipment);
  assert.deepEqual(roomResult.issues, []);
  assert.equal(roomResult.weapon.status, "none");
  assert.equal(roomResult.pet.status, "none");
  const battle = { leftTeam: { team: { 0: { id: 110 }, 1: { id: 109 } } } };
  const battleResult = inspectBattleLoadout(battle, "sponsor", noEquipment);
  assert.equal(battleResult.weapon.status, "none");
  assert.equal(battleResult.pet.status, "none");
});
