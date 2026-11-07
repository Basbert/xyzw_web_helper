// Commands and fields match the official game client (TEST_REMOTE_MODULE).
export const COMPASS_COMMANDS = Object.freeze({
  chaosInfo: "nightmare_getroleinfo",
  chaosDraw: "nightmare_clickturntable",
  chaosClaim: "nightmare_claimturnrewardtimes",
  starInfo: "nmext_getinfo",
  starDraw: "nmext_drawturntable",
});

export const STAR_WHEELS = Object.freeze([
  { key: "white", name: "白色", itemId: 36997 },
  { key: "green", name: "绿色", itemId: 36998 },
  { key: "blue", name: "蓝色", itemId: 36999 },
]);

const activeAccounts = new Set();
// A draw request may have reached the server even if its reply was lost.
// Never clear this during the lifetime of this page; reloading requires the
// player to re-check their game account before starting a new run.
const uncertainAccounts = new Set();
export const isCompassAccountUncertain = (accountId) =>
  uncertainAccounts.has(accountId);
const integer = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    typeof value === "boolean"
  )
    return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const mapGet = (map, key) =>
  map instanceof Map ? (map.get(key) ?? map.get(String(key))) : map?.[key];

/** Interpret the current weekly chaos state; unknown is not zero. */
export function parseChaosSnapshot(response, { full = false } = {}) {
  const week = response?.weekAward;
  const left = integer(
    full && week && week.turntableLeftCnt === undefined
      ? 0
      : week?.turntableLeftCnt,
  );
  if (!week || left === null) throw new Error("混沌罗盘次数未确认，请重新刷新");
  const data = response?.nightMareData ?? response?.nightMare;
  // The game's typed full role response defaults omitted numeric fields to 0.
  // A mutation response may be partial, so do not apply defaults to it.
  const bookScore = integer(
    full && data && data.bookScore === undefined ? 0 : data?.bookScore,
  );
  const turnRewardTime = integer(
    full && data && data.turnRewardTime === undefined
      ? 0
      : data?.turnRewardTime,
  );
  return {
    left,
    bonusProgress:
      bookScore !== null &&
      turnRewardTime !== null &&
      bookScore >= turnRewardTime
        ? bookScore - turnRewardTime
        : null,
  };
}

/** Missing keys in a present key-count map mean zero, as in the game client. */
export function parseStarSnapshot(response) {
  const map = response?.roleNMExt?.hasKeyCntMap;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("星级罗盘次数未确认，请重新刷新");
  }
  const counts = {};
  for (const wheel of STAR_WHEELS) {
    const raw = mapGet(map, wheel.itemId);
    const count = raw == null ? 0 : integer(raw);
    if (count === null) throw new Error("星级罗盘次数无效，请重新刷新");
    counts[wheel.key] = count;
  }
  return counts;
}

/** Keep unknown rewards intact so callers can show the original IDs/values. */
export function parseCompassRewards(response) {
  if (!Array.isArray(response?.reward) || !response.reward.length) {
    throw new Error("服务器未返回可识别的抽奖奖励，请到游戏中核对");
  }
  return response.reward.map((reward) => {
    if (!reward || typeof reward !== "object" || Array.isArray(reward)) {
      throw new Error("服务器返回了无法识别的奖励，请到游戏中核对");
    }
    return { ...reward };
  });
}

// Bound one operation even if a malformed or unexpectedly large balance is sent.
export const MAX_STAR_DRAWS = 200;
export const MAX_CHAOS_REQUESTS = 200;
export const CHAOS_BONUS_THRESHOLD = 5;

/**
 * Run only after the player clicks an explicit action. Chaos draws until the
 * remaining attempts and earned bonus attempts are exhausted. allStar uses all the displayed keys
 * in white/green/blue order. The balance object is copied before awaiting.
 * send returns the decoded body; assertActive throws on connection/account/page
 * changes. onDraw is notified immediately for every confirmed reward.
 */
export async function runCompassDraw({
  accountId,
  roleId,
  kind,
  count,
  send,
  assertActive,
  onDraw = () => {},
}) {
  if (
    !accountId ||
    typeof send !== "function" ||
    typeof assertActive !== "function" ||
    typeof onDraw !== "function"
  ) {
    throw new Error("抽奖上下文不完整");
  }
  if (activeAccounts.has(accountId))
    throw new Error("当前角色已有罗盘抽奖进行中");
  if (uncertainAccounts.has(accountId))
    throw new Error("上次抽奖结果未确认，请先到游戏中核对，然后重新加载页面");
  const wheel = STAR_WHEELS.find((entry) => entry.key === kind);
  const allStar = kind === "allStar";
  const chaos = kind === "chaos";
  if (!chaos && !allStar && !wheel) throw new Error("未知的罗盘");

  const confirmedRole = chaos ? integer(roleId) : null;
  if (chaos && !confirmedRole) throw new Error("未确认当前游戏角色");
  let confirmedCount = null;
  let confirmedCounts = null;
  if (allStar) {
    if (!count || typeof count !== "object" || Array.isArray(count))
      throw new Error("请先确认三色星级罗盘剩余次数");
    confirmedCounts = {};
    for (const entry of STAR_WHEELS) {
      const value = integer(count[entry.key]);
      if (value === null) throw new Error("请先确认三色星级罗盘剩余次数");
      confirmedCounts[entry.key] = value;
    }
    const total = STAR_WHEELS.reduce(
      (sum, entry) => sum + confirmedCounts[entry.key],
      0,
    );
    if (!total || total > MAX_STAR_DRAWS)
      throw new Error(`星级罗盘总次数须为 1 至 ${MAX_STAR_DRAWS}`);
  } else {
    confirmedCount = integer(count);
    if (
      confirmedCount === null ||
      (wheel && (!confirmedCount || confirmedCount > MAX_STAR_DRAWS))
    )
      throw new Error(
        wheel
          ? `抽取次数须为 1 至 ${MAX_STAR_DRAWS}`
          : "请先确认混沌罗盘剩余次数",
      );
  }

  activeAccounts.add(accountId);
  const rewards = [];
  let completed = 0;
  try {
    assertActive();
    const initial = await send(
      chaos ? COMPASS_COMMANDS.chaosInfo : COMPASS_COMMANDS.starInfo,
      chaos ? { roleId: confirmedRole } : {},
    );
    assertActive();
    const initialCounts = chaos ? null : parseStarSnapshot(initial);
    if (chaos) {
      let current = parseChaosSnapshot(initial, { full: true });
      if (confirmedCount !== current.left)
        throw new Error("混沌罗盘剩余次数已变化，请刷新并重新确认");
      if (!current.left && !(current.bonusProgress >= CHAOS_BONUS_THRESHOLD))
        throw new Error("当前没有可用次数");

      const readAfterMutation = async (response) => {
        let snapshot;
        try {
          snapshot = parseChaosSnapshot(response);
        } catch {
          // A successful response can contain only a partial state update.
        }
        if (
          !snapshot ||
          (snapshot.left === 0 && snapshot.bonusProgress === null)
        ) {
          assertActive();
          snapshot = parseChaosSnapshot(
            await send(COMPASS_COMMANDS.chaosInfo, { roleId: confirmedRole }),
            { full: true },
          );
        }
        return snapshot;
      };
      let operations = 0;
      while (true) {
        assertActive();
        if (!current.left) {
          if (current.bonusProgress === null)
            throw new Error("赠送次数进度无法确认，请刷新后检查");
          if (current.bonusProgress < CHAOS_BONUS_THRESHOLD) break;
        }
        if (++operations > MAX_CHAOS_REQUESTS)
          throw new Error("已达到本次操作上限，请刷新后继续");

        const before = current;
        const claiming = before.left === 0;
        uncertainAccounts.add(accountId);
        let response;
        try {
          response = await send(
            claiming ? COMPASS_COMMANDS.chaosClaim : COMPASS_COMMANDS.chaosDraw,
            {},
          );
        } catch (error) {
          if (/^服务器错误:\s*\d+/.test(error?.message || ""))
            uncertainAccounts.delete(accountId);
          throw error;
        }
        if (!claiming) {
          const drawn = parseCompassRewards(response);
          rewards.push(...drawn);
          completed +=
            Array.isArray(response?.confIdList) && response.confIdList.length
              ? response.confIdList.length
              : drawn.length;
          try {
            onDraw({ completed, kind: "chaos", rewards: drawn, response });
          } catch {
            // A UI observer cannot undo confirmed rewards.
          }
        }
        // The server has replied. A missing balance requires a read-only check,
        // not another draw or an assumption about how many times were used.
        uncertainAccounts.delete(accountId);
        try {
          current = await readAfterMutation(response);
        } catch (error) {
          throw new Error(
            `已收到${claiming ? "领取" : "抽奖"}回包，但无法确认剩余次数：${error.message}`,
          );
        }
        if (claiming) {
          if (
            current.left <= before.left ||
            (current.bonusProgress !== null &&
              current.bonusProgress >= before.bonusProgress)
          )
            throw new Error("赠送次数领取后的状态异常，已停止并保留奖励");
        } else if (current.left >= before.left) {
          throw new Error("抽奖后的剩余次数未减少，已停止并保留奖励");
        }
      }
      return { completed, rewards };
    } else if (allStar) {
      if (
        STAR_WHEELS.some(
          (entry) => initialCounts[entry.key] !== confirmedCounts[entry.key],
        )
      )
        throw new Error("星级罗盘剩余次数已变化，请刷新并重新确认");
    } else if (confirmedCount > initialCounts[kind]) {
      throw new Error("抽取次数超过剩余次数，请刷新");
    }

    const plan = allStar
      ? STAR_WHEELS.flatMap((entry) =>
          Array.from({ length: confirmedCounts[entry.key] }, () => entry),
        )
      : Array.from({ length: confirmedCount }, () => wheel);
    let currentCounts = initialCounts;
    for (const entry of plan) {
      assertActive();
      uncertainAccounts.add(accountId);
      let response;
      try {
        response = await send(COMPASS_COMMANDS.starDraw, {
          itemId: entry.itemId,
        });
      } catch (error) {
        if (/^服务器错误:\s*\d+/.test(error?.message || ""))
          uncertainAccounts.delete(accountId);
        throw error;
      }
      const drawn = parseCompassRewards(response);
      rewards.push(...drawn);
      completed += 1;
      try {
        onDraw({
          completed,
          kind: entry.key,
          rewards: drawn,
          response,
        });
      } catch {
        // Observers cannot discard or duplicate a successful draw.
      }
      uncertainAccounts.delete(accountId);
      {
        let nextCounts;
        try {
          nextCounts = parseStarSnapshot(response);
        } catch {
          assertActive();
          try {
            nextCounts = parseStarSnapshot(
              await send(COMPASS_COMMANDS.starInfo, {}),
            );
          } catch (error) {
            throw new Error(
              `已收到抽奖回包，但无法确认剩余次数：${error.message}`,
            );
          }
        }
        if (
          STAR_WHEELS.some(
            (other) =>
              nextCounts[other.key] !==
              currentCounts[other.key] - (other.key === entry.key ? 1 : 0),
          )
        ) {
          throw new Error("剩余次数与预期不符，已停止，请到游戏中核对");
        }
        currentCounts = nextCounts;
      }
      uncertainAccounts.delete(accountId);
      assertActive();
    }
    return { completed, rewards };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    error.compassCompleted = completed;
    error.compassRewards = rewards;
    error.compassUncertain = uncertainAccounts.has(accountId);
    throw error;
  } finally {
    activeAccounts.delete(accountId);
  }
}
