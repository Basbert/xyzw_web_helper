export const TEN_HALL_HISTORY_PREFIX = "ten-hall-history:v1:";
export const TEN_HALL_HISTORY_LIMIT = 20;
const statuses = new Set(["running", "completed", "stopped", "incomplete"]);
const loadoutStatuses = new Set(["matched", "none", "mismatch", "unknown"]);

function roleKey(roleId) {
  if (!["string", "number"].includes(typeof roleId)) return null;
  const id = String(roleId).trim();
  return id && id !== "0"
    ? `${TEN_HALL_HISTORY_PREFIX}${encodeURIComponent(id)}`
    : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeHeroes(heroes) {
  if (!Array.isArray(heroes)) return [];
  return heroes.slice(0, 5).flatMap((hero) => {
    const heroId = positiveInteger(hero?.heroId);
    const slot = Number(hero?.slot);
    if (
      hero?.slot == null ||
      !heroId ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 4
    )
      return [];
    return [{ slot, heroId }];
  });
}

function normalizeLoadoutItem(item) {
  return {
    status: loadoutStatuses.has(item?.status) ? item.status : "unknown",
    actualId: positiveInteger(item?.actualId),
  };
}

function normalizeBattle(item) {
  const downCount = Number(item?.downCount);
  return {
    isWin: typeof item?.isWin === "boolean" ? item.isWin : null,
    rounds: positiveInteger(item?.rounds),
    downCount:
      item?.downCount !== null &&
      item?.downCount !== undefined &&
      Number.isInteger(downCount) &&
      downCount >= 0 &&
      downCount <= 5
        ? downCount
        : null,
    heroes: Array.isArray(item?.heroes)
      ? item.heroes.slice(0, 5).map((hero) => ({
          heroId: positiveInteger(hero?.heroId),
          slot: Number.isInteger(hero?.slot) ? hero.slot : null,
          isDown: typeof hero?.isDown === "boolean" ? hero.isDown : null,
        }))
      : null,
    loadout: {
      heroes: ["matched", "mismatch", "unknown"].includes(item?.loadout?.heroes)
        ? item.loadout.heroes
        : "unknown",
      weapon: normalizeLoadoutItem(item?.loadout?.weapon),
      pet: normalizeLoadoutItem(item?.loadout?.pet),
    },
  };
}

/** Only save display data; never persist account tokens, pet UIDs or battle payloads. */
export function normalizeTenHallHistoryEntry(entry) {
  const hall = positiveInteger(entry?.hall);
  const requestedCount = positiveInteger(entry?.requestedCount);
  const time = positiveInteger(entry?.time);
  if (
    !entry?.id ||
    !time ||
    !hall ||
    hall > 8 ||
    !requestedCount ||
    requestedCount > 20
  )
    return null;
  const results = Array.isArray(entry.results)
    ? entry.results.slice(0, requestedCount).map(normalizeBattle)
    : [];
  if (!results.length) return null;
  return {
    id: String(entry.id).slice(0, 100),
    time,
    hall,
    requestedCount,
    status: statuses.has(entry.status) ? entry.status : "incomplete",
    setup: {
      heroes: normalizeHeroes(entry.setup?.heroes),
      weaponId: positiveInteger(entry.setup?.weaponId),
      petId: positiveInteger(entry.setup?.petId),
      hasPet: !!entry.setup?.hasPet,
    },
    results,
  };
}

export function readTenHallHistory(roleId, storage = globalThis.localStorage) {
  const key = roleKey(roleId);
  if (!key) return [];
  const stored = storage.getItem(key);
  if (!stored) return [];
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list)
      ? list
          .map(normalizeTenHallHistoryEntry)
          .filter(Boolean)
          .slice(0, TEN_HALL_HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function saveTenHallHistory(
  roleId,
  entry,
  storage = globalThis.localStorage,
) {
  const key = roleKey(roleId);
  const clean = normalizeTenHallHistoryEntry(entry);
  if (!key || !clean) throw new Error("模拟记录缺少角色或战报信息");
  const list = [
    clean,
    ...readTenHallHistory(roleId, storage).filter(
      (item) => item.id !== clean.id,
    ),
  ].slice(0, TEN_HALL_HISTORY_LIMIT);
  storage.setItem(key, JSON.stringify(list));
  return list;
}

export function removeTenHallHistory(
  roleId,
  id,
  storage = globalThis.localStorage,
) {
  const key = roleKey(roleId);
  if (!key) return [];
  const list = readTenHallHistory(roleId, storage).filter(
    (item) => item.id !== id,
  );
  if (list.length) storage.setItem(key, JSON.stringify(list));
  else storage.removeItem(key);
  return list;
}
