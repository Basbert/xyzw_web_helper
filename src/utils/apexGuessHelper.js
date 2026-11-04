import {
  ApexAction,
  isApexRateLimited,
  runApexAction,
} from "./apexRateLimit.js";
/**
 * 逐鹿盐山（APEX）竞猜辅助逻辑
 */
import {
  ApexScheduleStatus,
  calibrateServerTime,
  getAdvanceNum,
  getCurrentRounds,
  getCurrentSeason,
  getGuessTabs,
} from "./apexRules.js";

const TIMEOUT_READ = 10000;
const TIMEOUT_GUESS = 10000;
const MAX_PAGES = 12;

export function resolveOpenGuesses(nowMs) {
  const season = getCurrentSeason(nowMs);
  if (season <= 0) return [];
  const openRounds = [];
  for (const round of getCurrentRounds(season, nowMs)) {
    const tabs = getGuessTabs(round, season, nowMs).filter(
      (t) =>
        t.state === ApexScheduleStatus.Unlocked ||
        t.state === ApexScheduleStatus.Locked,
    );
    if (tabs.length) openRounds.push({ season, round, tabs });
  }
  return openRounds;
}

export async function getApexGuessStatus(tokenStore, tokenId, options = {}) {
  const fetchRole = options.fetchRole ?? true;
  let apexInfo = tokenStore.gameData?.roleInfo?.role?.apexRoleInfo;

  if (fetchRole || !apexInfo) {
    try {
      const res = await runApexAction(
        ApexAction.READ,
        (queuedMs) =>
          tokenStore.sendMessageWithPromise(
            tokenId,
            "apex_getroleinfo",
            {},
            TIMEOUT_READ + queuedMs,
          ),
        { maxRetry: 1 },
      );
      if (res?.apexRoleInfo) {
        apexInfo = res.apexRoleInfo;
        if (tokenStore.gameData?.roleInfo) {
          if (!tokenStore.gameData.roleInfo.role)
            tokenStore.gameData.roleInfo.role = {};
          tokenStore.gameData.roleInfo.role.apexRoleInfo = apexInfo;
        }
      }
    } catch {
      // 忽略或使用本地缓存
    }
  }

  const guessMap = apexInfo?.guessMap || {};
  const serverNow = calibrateServerTime(Date.now(), apexInfo?.resetTime?.day);
  const openRounds = resolveOpenGuesses(serverNow);

  if (!openRounds.length) {
    return {
      hasOpenGuesses: false,
      season: getCurrentSeason(serverNow),
      openRoundsCount: 0,
      openStagesCount: 0,
      pendingStagesCount: 0,
      summaryText: "当前暂无开放的逐鹿盐山竞猜",
      details: [],
    };
  }

  let totalAvailableStages = 0;
  let totalPendingStages = 0;
  const details = [];

  for (const open of openRounds) {
    for (const tab of open.tabs) {
      totalAvailableStages++;
      const advanceNum = getAdvanceNum(open.round, open.season, tab.stage);
      const guessedTeamIds = new Set(guessMap[tab.scheduleId] || []);
      const isFull = advanceNum > 0 && guessedTeamIds.size >= advanceNum;
      if (!isFull) {
        totalPendingStages++;
      }
      details.push({
        season: open.season,
        round: open.round,
        scheduleId: tab.scheduleId,
        stage: tab.stage,
        title: tab.title,
        advanceNum,
        guessedCount: guessedTeamIds.size,
        isFull,
      });
    }
  }

  let summaryText = "";
  if (totalPendingStages === 0) {
    summaryText = "当前开放阶段已全部竞猜";
  } else {
    summaryText = `当前有 ${totalPendingStages} 个阶段待竞猜`;
  }

  return {
    hasOpenGuesses: true,
    season: openRounds[0].season,
    openRoundsCount: openRounds.length,
    openStagesCount: totalAvailableStages,
    pendingStagesCount: totalPendingStages,
    summaryText,
    details,
  };
}

export async function runApexAutoGuess({
  tokenStore,
  tokenId,
  onProgress = () => {},
  checkInterrupted = () => {},
}) {
  checkInterrupted();
  onProgress("正在检查逐鹿盐山状态...");

  const res = await runApexAction(
    ApexAction.READ,
    (queuedMs) =>
      tokenStore.sendMessageWithPromise(
        tokenId,
        "apex_getroleinfo",
        {},
        TIMEOUT_READ + queuedMs,
      ),
    { maxRetry: 1 },
  );
  const apexInfo = res?.apexRoleInfo || {};
  if (tokenStore.gameData?.roleInfo) {
    if (!tokenStore.gameData.roleInfo.role)
      tokenStore.gameData.roleInfo.role = {};
    tokenStore.gameData.roleInfo.role.apexRoleInfo = apexInfo;
  }

  const guessMap = apexInfo.guessMap || {};
  const serverNow = calibrateServerTime(Date.now(), apexInfo.resetTime?.day);
  const openRounds = resolveOpenGuesses(serverNow);

  if (!openRounds.length) {
    return {
      successCount: 0,
      skipCount: 0,
      failCount: 0,
      message: "当前暂无开放的逐鹿盐山竞猜阶段",
    };
  }

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let abortedByRateLimit = false;

  for (const open of openRounds) {
    checkInterrupted();
    if (abortedByRateLimit) break;

    for (const tab of open.tabs) {
      checkInterrupted();
      if (abortedByRateLimit) break;

      const advanceNum = getAdvanceNum(open.round, open.season, tab.stage);
      const guessedTeamIds = new Set(guessMap[tab.scheduleId] || []);

      if (advanceNum > 0 && guessedTeamIds.size >= advanceNum) {
        skipCount++;
        continue;
      }

      onProgress(`正在获取 ${tab.title} 对阵数据...`);
      const allGroups = [];
      let last = false;

      for (let p = 0; p < MAX_PAGES && !last; p++) {
        checkInterrupted();
        let resp;
        try {
          resp = await runApexAction(
            ApexAction.READ,
            (queuedMs) =>
              tokenStore.sendMessageWithPromise(
                tokenId,
                "apex_getguesslist",
                { scheduleId: tab.scheduleId, idx: allGroups.length },
                TIMEOUT_READ + queuedMs,
              ),
            { maxRetry: 1 },
          );
        } catch (e) {
          if (isApexRateLimited(e)) {
            abortedByRateLimit = true;
            break;
          }
          throw e;
        }

        const groups = resp?.apexGuessList || [];
        if (groups.length === 0) break;
        allGroups.push(...groups);
        last = resp?.last === true;
      }

      if (abortedByRateLimit) break;
      if (allGroups.length === 0) continue;

      for (const group of allGroups) {
        checkInterrupted();
        if (abortedByRateLimit) break;
        if (advanceNum > 0 && guessedTeamIds.size >= advanceNum) break;

        const [team0, team1] = group;
        if (!team0 || !team1) continue;

        if (
          guessedTeamIds.has(team0.teamId) &&
          guessedTeamIds.has(team1.teamId)
        ) {
          skipCount++;
          continue;
        }

        let pick;
        if (guessedTeamIds.has(team0.teamId)) {
          pick = team1;
        } else if (guessedTeamIds.has(team1.teamId)) {
          pick = team0;
        } else {
          const cheer0 = Number(team0.cheerCnt) || 0;
          const cheer1 = Number(team1.cheerCnt) || 0;
          pick = cheer0 >= cheer1 ? team0 : team1;
        }

        onProgress(`正在竞猜 ${tab.title}：${pick.name}...`);
        try {
          await runApexAction(
            ApexAction.GUESS,
            (queuedMs) =>
              tokenStore.sendMessageWithPromise(
                tokenId,
                "apex_guess",
                { teamId: pick.teamId },
                TIMEOUT_GUESS + queuedMs,
              ),
            {
              onWait: (ms) =>
                onProgress(`遭遇频控，等待 ${Math.ceil(ms / 1000)} 秒后重试...`),
            },
          );
          guessedTeamIds.add(pick.teamId);
          if (!guessMap[tab.scheduleId]) {
            guessMap[tab.scheduleId] = [];
          }
          guessMap[tab.scheduleId].push(pick.teamId);
          successCount++;
        } catch (err) {
          failCount++;
          if (isApexRateLimited(err)) {
            abortedByRateLimit = true;
            break;
          }
        }
      }
    }
  }

  try {
    const resAfter = await runApexAction(
      ApexAction.READ,
      (queuedMs) =>
        tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getroleinfo",
          {},
          TIMEOUT_READ + queuedMs,
        ),
      { maxRetry: 1 },
    );
    if (resAfter?.apexRoleInfo && tokenStore.gameData?.roleInfo?.role) {
      tokenStore.gameData.roleInfo.role.apexRoleInfo = resAfter.apexRoleInfo;
    }
  } catch {
    // 忽略
  }

  let finalMessage = "";
  if (successCount > 0) {
    finalMessage =
      `成功竞猜 ${successCount} 场${ 
      failCount > 0 ? `，失败 ${failCount} 场` : ""}`;
  } else if (failCount > 0) {
    finalMessage =
      `竞猜未完成，失败 ${failCount} 场${ 
      abortedByRateLimit ? "（触发服务器频控）" : ""}`;
  } else {
    finalMessage = "当前开放阶段已全部竞猜完毕";
  }

  return {
    successCount,
    skipCount,
    failCount,
    message: finalMessage,
    abortedByRateLimit,
  };
}
