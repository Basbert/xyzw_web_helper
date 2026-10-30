import { isSameGameValue } from "./gameValue.js";

/** Count only the quench records actually present in an equipment response. */
export function countQuenchRecords(equipment) {
  if (!equipment || typeof equipment !== "object") {
    return { redCount: 0, recordCount: 0, hasRecords: false, complete: false };
  }

  const pieces = Object.values(equipment);
  let redCount = 0;
  let recordCount = 0;
  let hasRecords = false;
  let complete = pieces.length === 4;

  for (const piece of pieces) {
    const quenches = piece?.quenches;
    if (!quenches || typeof quenches !== "object") {
      complete = false;
      continue;
    }
    hasRecords = true;
    for (const record of Object.values(quenches)) {
      if (!record || typeof record !== "object") {
        complete = false;
        continue;
      }
      recordCount += 1;
      if (isSameGameValue(record.colorId, 6)) redCount += 1;
    }
  }

  return { redCount, recordCount, hasRecords, complete };
}

/**
 * Use detailed account data only for the same role and hero. A player lookup
 * does not guarantee that its quench records include every opened slot.
 */
export function findOwnHeroEquipment(targetRoleId, ownRole, heroId) {
  const validId = (id) =>
    (typeof id === "number" || typeof id === "string") &&
    String(id).trim() !== "" &&
    String(id) !== "0";

  if (
    !validId(targetRoleId) ||
    !validId(ownRole?.roleId) ||
    !validId(heroId) ||
    String(targetRoleId) !== String(ownRole.roleId) ||
    !ownRole.heroes ||
    typeof ownRole.heroes !== "object"
  ) {
    return null;
  }

  const byKey = Array.isArray(ownRole.heroes) ? null : ownRole.heroes[heroId];
  const keyHeroId = byKey?.heroId ?? byKey?.id;
  const hero =
    (byKey &&
      (keyHeroId == null || String(keyHeroId) === String(heroId)) &&
      byKey) ||
    Object.values(ownRole.heroes).find(
      (item) => String(item?.heroId ?? item?.id ?? "") === String(heroId),
    );
  const equipment = hero?.equipment;
  return countQuenchRecords(equipment).complete ? equipment : null;
}
