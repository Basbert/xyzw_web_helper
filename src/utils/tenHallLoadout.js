/** Compare the selected formation to the values returned by the game server. */
function entries(value) {
  if (value instanceof Map) return [...value.entries()];
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : null;
}

function lookup(value, key) {
  if (value instanceof Map) return value.get(key) ?? value.get(String(key));
  return value?.[key];
}

function compareHeroes(expectedTeam, actualTeam) {
  const expected = entries(expectedTeam);
  const actual = entries(actualTeam);
  if (!expected?.length || !actual?.length) return "unknown";
  const slots = new Map();
  for (const [slot, member] of actual) {
    const id = Number(member?.heroId ?? member?.id ?? member);
    if (!Number.isInteger(id) || id <= 0) return "unknown";
    slots.set(String(slot), id);
  }
  if (slots.size !== expected.length) return "mismatch";
  return expected.every(([slot, id]) => slots.get(String(slot)) === Number(id))
    ? "matched"
    : "mismatch";
}

function compareWeapon(expectedId, actualId) {
  const expected = Number(expectedId) || 0;
  if (actualId === undefined || actualId === null || actualId === "") {
    return { status: expected ? "unknown" : "none", actualId: null };
  }
  const actual = Number(actualId);
  if (!Number.isInteger(actual) || actual < 0) {
    return { status: "unknown", actualId: null };
  }
  return {
    status: actual !== expected ? "mismatch" : actual ? "matched" : "none",
    actualId: actual || null,
  };
}

function comparePet(expectedUid, actualUid, actualId, expectedId) {
  const expected = expectedUid == null ? "" : String(expectedUid);
  const actual = actualUid == null ? "" : String(actualUid);
  const petId = Number(actualId) || null;
  const wantedPetId = Number(expectedId) || null;
  if (!actual) {
    return {
      status: expected ? "unknown" : petId ? "mismatch" : "none",
      actualId: petId,
    };
  }
  return {
    status:
      expected === actual && (!petId || !wantedPetId || petId === wantedPetId)
        ? "matched"
        : "mismatch",
    actualId: petId || (expected === actual ? wantedPetId : null),
  };
}

/** The room must confirm the selected team before a battle is started. */
export function inspectRoomLoadout(room, roleId, expectedTeam) {
  const member = lookup(room?.watchRoles, roleId);
  const heroes = compareHeroes(expectedTeam.battleTeam, member?.battleTeam);
  const weapon = compareWeapon(expectedTeam.lordWeaponId, member?.lordWeaponId);
  const pet = comparePet(expectedTeam.petUId, member?.petUId);
  const issues = [];
  if (heroes !== "matched") issues.push("武将阵容");
  if (!["matched", "none"].includes(weapon.status)) issues.push("玩具");
  if (!["matched", "none"].includes(pet.status)) issues.push("宠物");
  return { heroes, weapon, pet, issues };
}

/** Report what the actual battle input contains, even if some fields are absent. */
export function inspectBattleLoadout(
  battleData,
  ownSide,
  expectedTeam,
  expectedPetId,
) {
  const actual =
    ownSide === "sponsor"
      ? battleData?.leftTeam
      : ownSide === "accept"
        ? battleData?.rightTeam
        : null;
  if (!actual || typeof actual !== "object") {
    return {
      heroes: "unknown",
      weapon: { status: "unknown", actualId: null },
      pet: { status: "unknown", actualId: null },
    };
  }
  return {
    heroes: compareHeroes(expectedTeam.battleTeam, actual?.team),
    weapon: compareWeapon(expectedTeam.lordWeaponId, actual?.weaponId),
    pet: comparePet(
      expectedTeam.petUId,
      actual?.petUId,
      actual?.petId,
      expectedPetId,
    ),
  };
}
