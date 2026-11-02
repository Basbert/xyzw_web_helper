export const TOWER_MANIFEST_URL =
  "https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.32.0-android";

/** The server's tower ID is the last completed stage, not the next one. */
export function nextTowerStageId(completedTowerId) {
  if (
    (typeof completedTowerId !== "number" &&
      typeof completedTowerId !== "string") ||
    (typeof completedTowerId === "string" && !completedTowerId.trim())
  )
    return null;
  const value = Number(completedTowerId);
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value < Number.MAX_SAFE_INTEGER
    ? value + 1
    : null;
}

export function getTowerEnemyLineup(completedTowerId, data, heroDictionary) {
  const stageId = nextTowerStageId(completedTowerId);
  if (!stageId || !Array.isArray(data?.lineups)) return null;
  const row = data.lineups[stageId - 1];
  if (!Array.isArray(row) || row.length !== 5) return null;
  const heroes = row.map((heroId) => {
    const hero = heroDictionary?.[heroId];
    if (!Number.isSafeInteger(heroId) || !hero?.name) return null;
    return { heroId, name: hero.name, avatar: hero.avatar || "" };
  });
  return heroes.every(Boolean) ? { stageId, heroes } : null;
}

/** Checks public game configuration metadata only; no account data is sent. */
export async function checkTowerConfigVersion(
  expectedVersion,
  { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {},
) {
  if (!expectedVersion || typeof fetchImpl !== "function") return "unknown";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(TOWER_MANIFEST_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: "",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return "unknown";
    let body = (await response.json())?.body;
    if (typeof body === "string") body = JSON.parse(body);
    let versions = body?.bundleVers;
    if (typeof versions === "string") versions = JSON.parse(versions);
    if (typeof versions?.config !== "string" || !versions.config)
      return "unknown";
    return versions.config === expectedVersion ? "current" : "outdated";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
