import {
  ApexAction,
  isApexRateLimited,
  runApexAction,
} from "./apexRateLimit.js";
import {
  ApexScheduleStatus,
  calibrateServerTime,
  canGuessRow,
  getAdvanceNum,
  getCurrentRounds,
  getCurrentSeason,
  getGuessTabs,
  getNextApexGuessWindow,
} from "./apexRules.js";

const TIMEOUT_READ = 10000;
const TIMEOUT_GUESS = 10000;
const MAX_PAGES = 12;
const runningAccounts = new Set();

/** Prevent simultaneous manual, single-account and batch guesses in this page. */
export async function withApexGuessLock(tokenId, action) {
  if (runningAccounts.has(tokenId))
    throw new Error("该账号已有竞猜操作正在进行");
  runningAccounts.add(tokenId);
  try {
    return await action();
  } finally {
    runningAccounts.delete(tokenId);
  }
}

export function resolveOpenGuesses(nowMs) {
  const season = getCurrentSeason(nowMs);
  if (season <= 0) return [];
  const openRounds = [];
  for (const round of getCurrentRounds(season, nowMs)) {
    const tabs = getGuessTabs(round, season, nowMs).filter(
      (tab) =>
        tab.state === ApexScheduleStatus.Unlocked ||
        tab.state === ApexScheduleStatus.Locked,
    );
    if (tabs.length) openRounds.push({ season, round, tabs });
  }
  return openRounds;
}

const validTeamId = (id) =>
  (typeof id === "string" && id.trim() !== "") ||
  (typeof id === "number" && Number.isFinite(id));

function guessedIds(guessMap, scheduleId) {
  const value = guessMap?.[scheduleId];
  if (value == null) return new Set();
  if (!Array.isArray(value) || !value.every(validTeamId)) {
    throw new Error("竞猜记录格式异常，无法确认已选队伍");
  }
  return new Set(value.map(String));
}

function validateApexInfo(response) {
  const info = response?.apexRoleInfo;
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    throw new Error("未获取到逐鹿盐山角色信息");
  }
  if (
    info.guessMap != null &&
    (typeof info.guessMap !== "object" || Array.isArray(info.guessMap))
  ) {
    throw new Error("竞猜记录格式异常，无法确认已选队伍");
  }
  return info;
}

async function fetchApexInfo(tokenStore, tokenId, checkInterrupted = () => {}) {
  checkInterrupted();
  const response = await runApexAction(
    ApexAction.READ,
    (queuedMs) => {
      checkInterrupted();
      return tokenStore.sendMessageWithPromise(
        tokenId,
        "apex_getroleinfo",
        {},
        TIMEOUT_READ + queuedMs,
      );
    },
    { maxRetry: 1 },
  );
  checkInterrupted();
  return validateApexInfo(response);
}

/** Calculate status only from a response belonging to the requested account. */
export function buildApexGuessStatus(apexInfo, nowMs = Date.now()) {
  const serverNow = calibrateServerTime(nowMs, apexInfo?.resetTime?.day);
  const season = getCurrentSeason(serverNow);
  const reportedSeason = Number(apexInfo?.resetTime?.season) || 0;
  const scheduleMismatch = reportedSeason > 0 && reportedSeason !== season;
  const openRounds = resolveOpenGuesses(serverNow);
  const details = [];
  let pendingStagesCount = 0;
  let remainingSlots = 0;
  let uncertainStagesCount = 0;

  for (const open of openRounds) {
    for (const tab of open.tabs) {
      const advanceNum = getAdvanceNum(open.round, open.season, tab.stage);
      let guessedCount = 0;
      let uncertain = !Number.isInteger(advanceNum) || advanceNum <= 0;
      try {
        guessedCount = guessedIds(apexInfo?.guessMap, tab.scheduleId).size;
      } catch {
        uncertain = true;
      }
      const isFull = !uncertain && guessedCount >= advanceNum;
      if (uncertain) uncertainStagesCount++;
      else if (!isFull) {
        pendingStagesCount++;
        remainingSlots += advanceNum - guessedCount;
      }
      details.push({
        season: open.season,
        round: open.round,
        scheduleId: tab.scheduleId,
        stage: tab.stage,
        title: tab.title,
        advanceNum,
        guessedCount,
        isFull,
        uncertain,
      });
    }
  }

  let summaryText = "当前赛程内暂无开放的逐鹿盐山竞猜";
  if (uncertainStagesCount) {
    summaryText = "部分竞猜状态无法确认，请查看对阵详情";
  } else if (pendingStagesCount) {
    summaryText = `有 ${pendingStagesCount} 个阶段待竞猜，还可选 ${remainingSlots} 支队伍`;
  } else if (details.length) {
    summaryText = "当前开放阶段已全部竞猜";
  }
  return {
    hasOpenGuesses: details.length > 0,
    season: openRounds[0]?.season ?? season,
    serverNowMs: serverNow,
    scheduleMismatch,
    nextGuess: scheduleMismatch ? null : getNextApexGuessWindow(serverNow),
    openRoundsCount: openRounds.length,
    openStagesCount: details.length,
    pendingStagesCount,
    remainingSlots,
    uncertainStagesCount,
    summaryText,
    details,
  };
}

/** Format an upcoming configured window in the same timezone as the rules. */
export function formatNextApexGuess(nextGuess, referenceMs = Date.now()) {
  if (!Number.isFinite(nextGuess?.startsAt)) return "";
  const date = new Date(nextGuess.startsAt);
  const reference = new Date(referenceMs);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(reference.getTime()))
    return "";
  const year =
    date.getFullYear() === reference.getFullYear()
      ? ""
      : `${date.getFullYear()}年`;
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}（${nextGuess.title || "竞猜"}）`;
}

/** Short text shared by the dashboard and the collapsed daily entry. */
export function compactApexGuessStatus(status) {
  const next = formatNextApexGuess(status.nextGuess, status.serverNowMs);
  if (!status.hasOpenGuesses) {
    if (status.scheduleMismatch) return "赛程待核对";
    return next ? `下次预计 ${next}` : "暂无开放，后续赛程待确认";
  }
  if (status.pendingStagesCount)
    return `待竞猜 ${status.pendingStagesCount} 阶段`;
  return next ? `已竞猜 · 下次预计 ${next}` : "已竞猜";
}

export async function getApexGuessStatus(tokenStore, tokenId, options = {}) {
  const info = await fetchApexInfo(
    tokenStore,
    tokenId,
    options.checkInterrupted,
  );
  return buildApexGuessStatus(info);
}

function openTabNow(info, open, tab) {
  const now = calibrateServerTime(Date.now(), info.resetTime?.day);
  return resolveOpenGuesses(now).some(
    (entry) =>
      entry.season === open.season &&
      entry.round === open.round &&
      entry.tabs.some((candidate) => candidate.scheduleId === tab.scheduleId),
  );
}

function teamVotes(team) {
  if (team?.cheerCnt == null || team.cheerCnt === "") return null;
  const value = Number(team.cheerCnt);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function resultMessage(result) {
  const prefix = result.successCount
    ? `已竞猜 ${result.successCount} 场`
    : "本次未新增竞猜";
  if (result.outcome === "no-open") return "当前赛程内暂无开放竞猜";
  if (result.outcome === "stopped")
    return `${prefix}；${result.reason || "已停止"}`;
  if (result.outcome === "partial")
    return `${prefix}；${result.reason || "仍有场次未完成"}`;
  if (!result.verifiedStatus?.hasOpenGuesses) {
    return result.successCount
      ? `${prefix}；当前已无开放阶段`
      : "当前赛程内暂无开放竞猜";
  }
  return result.successCount
    ? `${prefix}，当前开放阶段已完成`
    : "当前开放阶段已全部竞猜";
}

/** Submit at most one selection per matchup, and report only verified completion. */
export async function runApexAutoGuess({
  tokenStore,
  tokenId,
  onProgress = () => {},
  checkInterrupted = () => {},
}) {
  return withApexGuessLock(tokenId, async () => {
    const result = {
      outcome: "partial",
      successCount: 0,
      skipCount: 0,
      failCount: 0,
      abortedByRateLimit: false,
      reason: "",
      entries: [],
      verifiedStatus: null,
    };
    let info;
    let issue = "";
    let stopSending = false;

    try {
      onProgress("正在检查逐鹿盐山状态…");
      info = await fetchApexInfo(tokenStore, tokenId, checkInterrupted);
      const initial = buildApexGuessStatus(info);
      const openRounds = resolveOpenGuesses(
        calibrateServerTime(Date.now(), info.resetTime?.day),
      );
      if (!openRounds.length) {
        result.outcome = "no-open";
        result.verifiedStatus = initial;
        result.message = resultMessage(result);
        return result;
      }

      for (const open of openRounds) {
        for (const tab of open.tabs) {
          checkInterrupted();
          if (stopSending) break;
          const limit = getAdvanceNum(open.round, open.season, tab.stage);
          if (!Number.isInteger(limit) || limit <= 0) {
            issue ||= `${tab.title}的可选数量无法确认`;
            continue;
          }
          let chosen;
          try {
            chosen = guessedIds(info.guessMap, tab.scheduleId);
          } catch {
            issue ||= `${tab.title}的竞猜记录无法确认`;
            continue;
          }
          if (chosen.size >= limit) {
            result.skipCount++;
            continue;
          }

          onProgress(`正在获取 ${tab.title} 对阵…`);
          const groups = [];
          const seen = new Set();
          let cursor = 0;
          for (
            let page = 0;
            page < MAX_PAGES && groups.length < limit;
            page++
          ) {
            checkInterrupted();
            const response = await runApexAction(
              ApexAction.READ,
              (queuedMs) => {
                checkInterrupted();
                return tokenStore.sendMessageWithPromise(
                  tokenId,
                  "apex_getguesslist",
                  { scheduleId: tab.scheduleId, idx: cursor },
                  TIMEOUT_READ + queuedMs,
                );
              },
              { maxRetry: 1 },
            );
            checkInterrupted();
            if (!Array.isArray(response?.apexGuessList)) {
              issue ||= `${tab.title}的对阵数据无法确认`;
              break;
            }
            const rows = response.apexGuessList;
            if (!rows.length) break;
            cursor += rows.length;
            let repeated = false;
            for (const group of rows) {
              if (
                !Array.isArray(group) ||
                group.length < 2 ||
                !validTeamId(group[0]?.teamId) ||
                !validTeamId(group[1]?.teamId) ||
                String(group[0].teamId) === String(group[1].teamId)
              ) {
                issue ||= `${tab.title}的对阵数据不完整`;
                continue;
              }
              const key = [String(group[0].teamId), String(group[1].teamId)]
                .sort()
                .join("\u0000");
              if (seen.has(key)) {
                repeated = true;
                continue;
              }
              seen.add(key);
              groups.push(group);
            }
            if (repeated) {
              issue ||= `${tab.title}的分页数据重复，请刷新后检查`;
              break;
            }
            if (!rows.length || groups.length === 0) break;
            // Some responses report last=true before all matchups have arrived.
          }
          if (groups.length < limit) issue ||= `${tab.title}的对阵尚未全部获取`;

          for (const group of groups) {
            checkInterrupted();
            if (stopSending || chosen.size >= limit) break;
            const [first, second] = group;
            if (
              chosen.has(String(first.teamId)) ||
              chosen.has(String(second.teamId))
            ) {
              result.skipCount++;
              continue;
            }
            if (
              !canGuessRow(tab.state, tab.stage, {
                team1Win: first.isWin === true,
                team2Win: second.isWin === true,
              })
            ) {
              issue ||= `${tab.title}有已结束的对阵`;
              continue;
            }
            const firstVotes = teamVotes(first);
            const secondVotes = teamVotes(second);
            if (firstVotes == null || secondVotes == null) {
              issue ||= `${tab.title}有队伍的助威数缺失`;
              continue;
            }
            const pick = firstVotes >= secondVotes ? first : second;
            const other = pick === first ? second : first;
            const entry = {
              title: tab.title,
              round: open.round,
              name: pick.name || "未命名队伍",
              opponent: other.name || "未命名队伍",
              votes: teamVotes(pick),
              opponentVotes: teamVotes(other),
              status: "submitted",
            };
            onProgress(
              `已竞猜 ${result.successCount} 场，正在处理 ${tab.title}：${entry.name}…`,
            );
            try {
              await runApexAction(
                ApexAction.GUESS,
                (queuedMs) => {
                  checkInterrupted();
                  if (!openTabNow(info, open, tab)) {
                    const error = new Error("该阶段已结束，停止竞猜");
                    error.notSent = true;
                    throw error;
                  }
                  return tokenStore.sendMessageWithPromise(
                    tokenId,
                    "apex_guess",
                    { teamId: pick.teamId },
                    TIMEOUT_GUESS + queuedMs,
                  );
                },
                {
                  onWait: (ms) =>
                    onProgress(`等待 ${Math.ceil(ms / 1000)} 秒后继续竞猜…`),
                },
              );
              chosen.add(String(pick.teamId));
              result.successCount++;
              result.entries.push(entry);
            } catch (error) {
              if (error?.interrupted) throw error;
              result.failCount++;
              result.abortedByRateLimit = isApexRateLimited(error);
              entry.status = error?.notSent ? "not-sent" : "unconfirmed";
              result.entries.push(entry);
              issue = error?.notSent
                ? error.message
                : result.abortedByRateLimit
                  ? "服务器限流，稍后刷新状态再试"
                  : "请求结果未确认，已停止；刷新状态后再试";
              stopSending = true;
            }
          }
        }
        if (stopSending) break;
      }

      checkInterrupted();
      if (!stopSending) {
        try {
          const after = await fetchApexInfo(
            tokenStore,
            tokenId,
            checkInterrupted,
          );
          result.verifiedStatus = buildApexGuessStatus(after);
        } catch (error) {
          if (error?.interrupted) throw error;
          issue ||= "最终竞猜状态未能核实，请刷新后查看";
        }
      }
      if (result.verifiedStatus?.uncertainStagesCount) {
        issue ||= "部分竞猜状态无法确认";
      } else if (result.verifiedStatus?.pendingStagesCount) {
        issue ||= `还有 ${result.verifiedStatus.remainingSlots} 个名额待处理`;
      }
      result.reason = issue;
      result.outcome = issue ? "partial" : "completed";
    } catch (error) {
      if (error?.interrupted) {
        result.outcome = "stopped";
        result.reason = error.message || "操作已停止";
      } else {
        result.outcome = "partial";
        result.reason = info
          ? `未能完成：${error?.message || "请求失败"}`
          : `未能读取竞猜状态：${error?.message || "请求失败"}`;
      }
    }
    result.message = resultMessage(result);
    return result;
  });
}
