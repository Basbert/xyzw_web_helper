// tokenId is a local imported account entry. roleId comes from the game server.
export function normalizeRoleId(roleId) {
  if (typeof roleId !== "string" && typeof roleId !== "number") return null;
  if (
    typeof roleId === "number" &&
    (!Number.isSafeInteger(roleId) || roleId <= 0)
  )
    return null;
  const id = String(roleId).trim();
  return id && id !== "0" ? id : null;
}
