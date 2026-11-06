// Game configuration 78fbc: Tuesday–Thursday, 10:00–22:00 (UTC+8).
// These are the ordinary limits; the paid pass can increase both limits.
export const CAMP_ORDINARY_LIMITS = { attempts: 10, wins: 3 };
const REQUEST_TIMEOUT = 10000;
const ATTACK_TIMEOUT = 20000;
const DAY_MS = 86400000;
const runningAccounts = new Set();

const entriesOf = (value) =>
  value instanceof Map ? [...value.entries()] : Object.entries(value || {});
const getFrom = (value, key) =>
  value instanceof Map
    ? (value.get(key) ?? value.get(String(key)) ?? value.get(Number(key)))
    : value?.[key];
const sameId = (a, b) =>
  a != null && b != null && String(a).trim() !== "" && String(a) === String(b);
const wholeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};
const gameBoolean = (value) => {
  if (
    value == null ||
    value === false ||
    value === 0 ||
    value === "0" ||
    value === "false"
  )
    return false;
  if (value === true || value === 1 || value === "1" || value === "true")
    return true;
  return null;
};

export function campClock(nowMs = Date.now()) {
  const date = new Date(nowMs + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("设备时间无效");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  const dayStart = Date.UTC(year, month, day);
  const monday = dayStart - ((weekday + 6) % 7) * DAY_MS;
  const pad = (n) => String(n).padStart(2, "0");
  const keyFor = (ms) => {
    const d = new Date(ms);
    return `${String(d.getUTCFullYear()).slice(-2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  };
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return {
    weekday,
    dayKey: keyFor(dayStart),
    phaseKey: keyFor(monday),
    isOpen: weekday >= 2 && weekday <= 4 && minutes >= 600 && minutes < 1320,
  };
}

/** Only expose the current week's opponent for today's match. */
export function getCampSnapshot(response, nowMs = Date.now()) {
  const club = response?.club;
  const siege = response?.siege;
  if (
    !club ||
    typeof club !== "object" ||
    !siege ||
    typeof siege !== "object"
  ) {
    throw new Error("营地战况不完整，请刷新后重试");
  }
  const clock = campClock(nowMs);
  const phase = String(club.phase ?? "");
  const phaseConfirmed = /^\d{6}$/.test(phase) && phase === clock.phaseKey;
  const attackMap = siege.attackMap;
  const validAttackMap =
    attackMap == null ||
    (typeof attackMap === "object" && !Array.isArray(attackMap));
  const rawToday = validAttackMap ? getFrom(attackMap, clock.dayKey) : null;
  const validToday =
    rawToday == null ||
    (typeof rawToday === "object" && !Array.isArray(rawToday));
  const attempts =
    !validAttackMap || !validToday
      ? null
      : rawToday?.attackCnt == null
        ? 0
        : wholeNumber(rawToday.attackCnt);
  const wins =
    !validAttackMap || !validToday
      ? null
      : rawToday?.aSuccessCnt == null
        ? 0
        : wholeNumber(rawToday.aSuccessCnt);
  const opponent = getFrom(club.oppoMap, clock.weekday);
  const targets = entriesOf(opponent?.defenders)
    .map(([key, defender]) => {
      const nodeId = wholeNumber(key);
      const challengeCnt =
        defender?.challengeCnt == null ? 0 : wholeNumber(defender.challengeCnt);
      const failCnt =
        defender?.failCnt == null ? 0 : wholeNumber(defender.failCnt);
      const roleId = defender?.roleId;
      const mirror = gameBoolean(defender?.mirror);
      const defeated = gameBoolean(defender?.defeated);
      if (
        !nodeId ||
        nodeId > 30 ||
        !wholeNumber(roleId) ||
        challengeCnt == null ||
        failCnt == null ||
        failCnt > challengeCnt ||
        mirror == null ||
        defeated == null
      )
        return null;
      return {
        nodeId,
        roleId,
        name: defender.name || `据点 ${nodeId}`,
        mirror,
        defeated,
        challengeCnt,
        failCnt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.nodeId - b.nodeId);
  let reason = "";
  if (!phaseConfirmed) reason = "本周营地战况尚未确认，请刷新";
  else if (!clock.isOpen) reason = "挑战时间为周二至周四 10:00–22:00";
  else if (!opponent) reason = "今天没有可确认的对手";
  else if (attempts == null || wins == null || wins > attempts)
    reason = "今日挑战记录不完整，请刷新";
  else if (!targets.some((target) => !target.defeated))
    reason = "今天没有可挑战的据点";
  return {
    clock,
    phaseConfirmed,
    attempts,
    wins,
    opponentName: opponent?.name || "今日对手",
    targets,
    canAttack: !reason,
    reason,
  };
}

/** The game uses the current main-line team, weapon and pet for an attack. */
export function makeCampTeam(role) {
  if (!role || typeof role !== "object")
    throw new Error("未获取到当前角色阵容");
  const heroes = [];
  const seen = new Set();
  for (const [key, member] of entriesOf(role.battleTeam)) {
    const slot = wholeNumber(key);
    const heroId = wholeNumber(member?.heroId ?? member);
    if (slot == null || slot > 4 || !heroId || seen.has(heroId)) {
      throw new Error("当前阵容信息不完整，请刷新角色后重试");
    }
    seen.add(heroId);
    heroes.push({ slot, heroId });
  }
  heroes.sort((a, b) => a.slot - b.slot);
  if (!heroes.length) throw new Error("当前主线阵容为空，请先在游戏中布阵");
  const weaponId =
    role.lordWeaponId == null ? 0 : wholeNumber(role.lordWeaponId);
  if (weaponId == null) throw new Error("当前玩具信息不完整，请刷新角色后重试");
  const pet = role.pet ?? role.petData;
  const petId = pet?.petId == null ? 0 : wholeNumber(pet.petId);
  const petUId = pet?.petUId == null ? "" : String(pet.petUId);
  if (petId == null || (petId > 0 && !petUId)) {
    throw new Error("当前宠物信息不完整，请刷新角色后重试");
  }
  const signature = JSON.stringify({ heroes, weaponId, petId, petUId });
  return { heroes, weaponId, petId, petUId, signature };
}

function requireTarget(snapshot, requested) {
  if (!snapshot.canAttack) throw new Error(snapshot.reason);
  const target = snapshot.targets.find(
    (item) => item.nodeId === Number(requested?.nodeId),
  );
  if (
    !target ||
    !sameId(target.roleId, requested?.roleId) ||
    target.mirror !== !!requested?.mirror
  ) {
    throw new Error("目标据点已变化，请刷新后重新选择");
  }
  if (target.defeated) throw new Error("该据点已被击破，请选择其他目标");
  return target;
}

async function readCampContext({ tokenStore, tokenId, checkActive, now }) {
  checkActive();
  const roleResponse = await tokenStore.sendMessageWithPromise(
    tokenId,
    "role_getroleinfo",
    {},
    REQUEST_TIMEOUT,
  );
  checkActive();
  const role = roleResponse?.role;
  const team = makeCampTeam(role);
  const response = await tokenStore.sendMessageWithPromise(
    tokenId,
    "club_getinfo",
    {},
    REQUEST_TIMEOUT,
  );
  checkActive();
  const snapshot = getCampSnapshot(response, now());
  const resetDay = String(role?.resetTime?.day ?? "");
  if (/^\d{6}$/.test(resetDay) && resetDay !== snapshot.clock.dayKey) {
    throw new Error("设备日期与游戏数据不一致，请校准时间后重试");
  }
  const roleId = role?.roleId;
  const siegeRoleId = response?.siege?.roleId;
  if (roleId && siegeRoleId && !sameId(roleId, siegeRoleId)) {
    throw new Error("角色和营地数据不一致，请刷新后重试");
  }
  const ownerId = roleId || siegeRoleId;
  const members = entriesOf(response?.club?.members).map(([, value]) => value);
  if (
    ownerId &&
    members.length &&
    !members.some((member) => sameId(member?.roleId, ownerId))
  ) {
    throw new Error("当前角色不在本期营地名单中");
  }
  return { team, snapshot, response };
}

export async function prepareCampAttack({
  tokenStore,
  tokenId,
  target,
  checkActive = () => {},
  now = Date.now,
}) {
  const context = await readCampContext({
    tokenStore,
    tokenId,
    checkActive,
    now,
  });
  const freshTarget = requireTarget(context.snapshot, target);
  return {
    tokenId,
    target: freshTarget,
    team: context.team,
    snapshot: context.snapshot,
  };
}

/** A lost response is never retried automatically: the attack may have happened. */
export async function submitCampAttack({
  tokenStore,
  preview,
  checkActive = () => {},
  now = Date.now,
}) {
  const tokenId = preview?.tokenId;
  if (!tokenId) throw new Error("请先确认本次挑战");
  if (runningAccounts.has(tokenId))
    throw new Error("该账号已有营地挑战正在进行");
  runningAccounts.add(tokenId);
  try {
    const context = await readCampContext({
      tokenStore,
      tokenId,
      checkActive,
      now,
    });
    const target = requireTarget(context.snapshot, preview.target);
    if (context.team.signature !== preview.team.signature) {
      throw new Error("当前主线阵容、玩具或宠物已变化，请重新确认");
    }
    checkActive();
    const params = {
      nodeId: target.nodeId,
      targetId: target.roleId,
      targetIsMirror: target.mirror,
      challengeCnt: target.challengeCnt,
      failCnt: target.failCnt,
      useItem: false,
      teamSetParams: {
        battleTeam: new Map(
          context.team.heroes.map(({ slot, heroId }) => [slot, heroId]),
        ),
        lordWeaponId: context.team.weaponId,
        petUId: context.team.petUId,
      },
    };
    let response;
    try {
      response = await tokenStore.sendMessageWithPromise(
        tokenId,
        "club_attack",
        params,
        ATTACK_TIMEOUT,
      );
    } catch (error) {
      const uncertain = new Error(
        "挑战结果未确认，请先刷新战况，再决定是否重试",
      );
      uncertain.uncertain = true;
      uncertain.cause = error;
      throw uncertain;
    }
    const battle = response?.battleData?.result;
    const round = wholeNumber(battle?.round);
    const result = {
      outcome:
        typeof battle?.isWin === "boolean"
          ? battle.isWin
            ? "win"
            : "loss"
          : "unknown",
      rounds: round && round > 0 ? round : null,
      score: wholeNumber(response?.addScore),
      target,
      refreshed: null,
    };
    try {
      checkActive();
      const fresh = await tokenStore.sendMessageWithPromise(
        tokenId,
        "club_getinfo",
        {},
        REQUEST_TIMEOUT,
      );
      checkActive();
      getCampSnapshot(fresh, now());
      result.refreshed = fresh;
    } catch {
      // The battle response remains valid even if refreshing the board fails.
    }
    return result;
  } finally {
    runningAccounts.delete(tokenId);
  }
}
