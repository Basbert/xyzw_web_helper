/**
 * Interpret a room battle without assuming that the logged-in player is on
 * the left. Missing or incomplete server fields remain unknown.
 */
export function parseTenHallBattleResult(battleData, ownRoleId, winningRoleId) {
  const result = battleData?.result;
  const isId = (value) =>
    (typeof value === "number" || typeof value === "string") &&
    String(value).trim() !== "" &&
    String(value) !== "0";
  const sameId = (a, b) => isId(a) && isId(b) && String(a) === String(b);

  const sponsorId = isId(result?.sponsor?.roleId)
    ? result.sponsor.roleId
    : battleData?.leftTeam?.roleId;
  const acceptId = isId(result?.accept?.roleId)
    ? result.accept.roleId
    : battleData?.rightTeam?.roleId;
  const ownSide = sameId(ownRoleId, sponsorId)
    ? "sponsor"
    : sameId(ownRoleId, acceptId)
      ? "accept"
      : null;
  const isWin =
    ownSide && typeof result?.isWin === "boolean"
      ? ownSide === "sponsor"
        ? result.isWin
        : !result.isWin
      : ownSide && isId(winningRoleId)
        ? sameId(ownRoleId, winningRoleId)
        : null;
  const round = Number(result?.round);
  const rounds = Number.isInteger(round) && round > 0 ? round : null;
  const teamInfo = ownSide ? result?.[ownSide]?.teamInfo : null;
  const team = Array.isArray(teamInfo) && teamInfo.length ? teamInfo : null;
  const heroes = team?.map((member) => {
    const value = member?.hp;
    const hp =
      (typeof value === "number" ||
        (typeof value === "string" && value.trim() !== "")) &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0
        ? Number(value)
        : null;
    return {
      heroId: member?.heroId ?? null,
      slot: member?.slot ?? member?.index ?? null,
      isDown: hp === null ? null : hp === 0,
    };
  });
  const downCount =
    heroes && heroes.every((hero) => hero.isDown !== null)
      ? heroes.filter((hero) => hero.isDown).length
      : null;

  return { ownSide, isWin, rounds, heroes: heroes ?? null, downCount };
}
