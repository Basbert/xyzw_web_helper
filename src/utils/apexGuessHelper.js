import {
  ApexAction,
  isApexRateLimited,
  runApexAction,
} from "./apexRateLimit.js";
import { parseApexClaimableRewards } from "./apexRewardState.js";
import {
  ApexScheduleStatus,
  calibrateServerTime,
  canGuessRow,
  getAdvanceNum,
  getCurrentRounds,
  getCurrentSeason,
  getGuessTabs,
  getNextApexGuessWindow,
  getTodayApexGuessSchedule,
  toChinaWallClockMs,
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

const emptyTodaySchedule = () => ({
  isGuessDay: false,
  season: -1,
  stages: [],
  openStages: [],
  upcomingStages: [],
  endedStages: [],
});

const safeToChinaWallClockMs = (utcNowMs) => {
  if (typeof toChinaWallClockMs === "function") {
    return toChinaWallClockMs(utcNowMs);
  }
  if (!Number.isFinite(utcNowMs)) return Number.NaN;
  const china = new Date(utcNowMs + 8 * 3600000);
  return new Date(
    china.getUTCFullYear(),
    china.getUTCMonth(),
    china.getUTCDate(),
    china.getUTCHours(),
    china.getUTCMinutes(),
    china.getUTCSeconds(),
    china.getUTCMilliseconds(),
  ).getTime();
};

const safeTodaySchedule = (nowMs) =>
  typeof getTodayApexGuessSchedule === "function"
    ? getTodayApexGuessSchedule(nowMs)
    : emptyTodaySchedule();

function readMonotonicMs() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

/**
 * Shared live China (UTC+8) wall-clock reader backed by the WebSocket client's
 * monotonic server-time sample (matching serverClock.js semantics).
 * Every call re-reads the latest serverTime / serverTimeSampledAt so updates
 * from apex_getroleinfo or heartbeats take effect immediately before sending.
 */
function createLiveChinaClock(tokenStore, tokenId, options = {}) {
  if (typeof options.getNowMs === "function") {
    return options.getNowMs;
  }
  if (Number.isFinite(options.nowMs)) {
    return () => safeToChinaWallClockMs(options.nowMs);
  }
  let sample = null;
  let sampledClient = null;
  return () => {
    const monotonicNow = readMonotonicMs();
    const client = tokenStore?.wsConnections?.[tokenId]?.client || null;
    if (client !== sampledClient) {
      sampledClient = client;
      sample = null;
    }
    const rawServerTime = Number(client?.serverTime);
    if (Number.isFinite(rawServerTime) && rawServerTime > 0) {
      const rawSampledAt = Number(client?.serverTimeSampledAt);
      if (
        Number.isFinite(rawSampledAt) &&
        (!sample ||
          sample.serverTimeMs === rawServerTime ||
          rawSampledAt !== sample.sampledAtMs)
      ) {
        sample = {
          serverTimeMs: rawServerTime,
          sampledAtMs: rawSampledAt,
        };
      } else if (!sample || sample.serverTimeMs !== rawServerTime) {
        sample = {
          serverTimeMs: rawServerTime,
          sampledAtMs: monotonicNow,
        };
      }
    }
    const estimatedUtcMs =
      sample &&
      Number.isFinite(sample.serverTimeMs) &&
      sample.serverTimeMs > 0 &&
      Number.isFinite(sample.sampledAtMs)
        ? sample.serverTimeMs + Math.max(0, monotonicNow - sample.sampledAtMs)
        : Date.now();
    return safeToChinaWallClockMs(estimatedUtcMs);
  };
}

/** Calculate status only from a response belonging to the requested account. */
export function buildApexGuessStatus(
  apexInfo,
  nowMs = safeToChinaWallClockMs(Date.now()),
) {
  let claimableRewards = [];
  let claimState = "ready";
  try {
    claimableRewards = parseApexClaimableRewards(apexInfo);
  } catch {
    claimState = "unknown";
  }
  const serverNow = calibrateServerTime(nowMs, apexInfo?.resetTime?.day);
  const season = getCurrentSeason(serverNow);
  const reportedSeason = Number(apexInfo?.resetTime?.season) || 0;
  const scheduleMismatch = reportedSeason > 0 && reportedSeason !== season;
  const openRounds = scheduleMismatch ? [] : resolveOpenGuesses(serverNow);
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
  if (scheduleMismatch) {
    summaryText = "服务器逐鹿盐山赛季与本地赛程配置不一致，赛程待核对";
  } else if (uncertainStagesCount) {
    summaryText = "部分竞猜状态无法确认，请查看对阵详情";
  } else if (pendingStagesCount) {
    summaryText = `有 ${pendingStagesCount} 个阶段待竞猜，还可选 ${remainingSlots} 支队伍`;
  } else if (details.length) {
    summaryText = "当前开放阶段已全部竞猜";
  }
  return {
    claimableRewards,
    claimState,
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
export function formatNextApexGuess(
  nextGuess,
  referenceMs = safeToChinaWallClockMs(Date.now()),
) {
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
  const rewards =
    status.claimState === "ready" && Array.isArray(status.claimableRewards)
      ? status.claimableRewards.length
      : 0;
  if (rewards > 0) {
    const claim = `待领奖 ${rewards} 项`;
    if (status.scheduleMismatch) return `${claim} · 赛程待核对`;
    if (status.uncertainStagesCount) return `${claim} · 竞猜状态待确认`;
    return status.pendingStagesCount
      ? `待竞猜 ${status.pendingStagesCount} 阶段 · ${claim}`
      : claim;
  }
  if (status.uncertainStagesCount) return "状态待确认";
  if (!status.hasOpenGuesses) {
    if (status.scheduleMismatch) return "赛程待核对";
    return next ? `下次预计 ${next}` : "暂无开放，后续赛程待确认";
  }
  if (status.pendingStagesCount)
    return `待竞猜 ${status.pendingStagesCount} 阶段`;
  return next ? `已竞猜 · 下次预计 ${next}` : "已竞猜";
}

export async function getApexGuessStatus(tokenStore, tokenId, options = {}) {
  const getNowMs = createLiveChinaClock(tokenStore, tokenId, options);
  const info = await fetchApexInfo(
    tokenStore,
    tokenId,
    options.checkInterrupted,
  );
  return buildApexGuessStatus(info, getNowMs());
}

function openTabNow(
  info,
  open,
  tab,
  nowMs = safeToChinaWallClockMs(Date.now()),
) {
  const now = calibrateServerTime(nowMs, info.resetTime?.day);
  const season = getCurrentSeason(now);
  const reportedSeason = Number(info?.resetTime?.season) || 0;
  if (reportedSeason > 0 && reportedSeason !== season) return false;
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
  nowMs = null,
  getNowMs: customGetNowMs = null,
}) {
  const getNowMs = createLiveChinaClock(tokenStore, tokenId, {
    nowMs,
    getNowMs: customGetNowMs,
  });
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
      const initial = buildApexGuessStatus(info, getNowMs());
      if (initial.scheduleMismatch) {
        result.outcome = "partial";
        result.reason =
          "服务器赛季与本地赛程不一致，赛程待核对，已停止自动竞猜";
        result.verifiedStatus = initial;
        result.message = resultMessage(result);
        return result;
      }
      const openRounds = resolveOpenGuesses(
        calibrateServerTime(getNowMs(), info.resetTime?.day),
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
                  if (!openTabNow(info, open, tab, getNowMs())) {
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
          result.verifiedStatus = buildApexGuessStatus(after, getNowMs());
        } catch (error) {
          if (error?.interrupted) throw error;
          issue ||= "最终竞猜状态未能核实，请刷新后查看";
        }
      }
      if (result.verifiedStatus?.scheduleMismatch) {
        issue ||= "服务器赛季与本地赛程不一致，赛程待核对";
      } else if (result.verifiedStatus?.uncertainStagesCount) {
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

function formatLaterStageReminder(todaySchedule) {
  const nextStage = todaySchedule?.upcomingStages?.[0];
  if (!nextStage) return "";
  return `逐鹿盐山竞猜提醒：今日后续 ${nextStage.title} 将于 ${nextStage.timeRange} 开放竞猜`;
}

function formatOutsideWindowReminder(todaySchedule, nextGuess, nowMs) {
  const nextStage = todaySchedule?.upcomingStages?.[0];
  if (nextStage) {
    return `逐鹿盐山竞猜提醒：今日有竞猜，当前不在开放时段；下场 ${nextStage.title} 将于 ${nextStage.timeRange} 开放竞猜`;
  }
  const ranges = (todaySchedule?.stages || [])
    .map((stage) => `${stage.title} ${stage.timeRange}`)
    .join("、");
  const nextText = formatNextApexGuess(nextGuess, nowMs);
  return `逐鹿盐山竞猜提醒：今日竞猜时段已结束${ranges ? `（${ranges}）` : ""}${nextText ? `，下次预计 ${nextText}` : ""}`;
}

/**
 * 每日任务中的逐鹿盐山竞猜核查：
 * - 非竞猜日：直接跳过，避免无谓消耗 apex_* 频控配额；
 * - 竞猜日且处于开放时段内：自动完成待竞猜场次，若同日后续还有场次一并给出提醒；
 * - 竞猜日但当前不在开放时段内：给出明确时段提醒，不将每日任务判为失败；
 * - 服务器赛季与本地赛程不符：禁止发包并明确提示赛程待核对；
 * - 非中断类请求异常（限流、超时、未解锁逐鹿等）：降级为告警并保留基于本地赛程的时段提醒，不中断整轮每日任务。
 */
export async function runDailyApexGuessCheck({
  tokenStore,
  tokenId,
  checkInterrupted = () => {},
  log = () => {},
  nowMs = null,
}) {
  checkInterrupted();
  // Always evaluate in China (UTC+8) wall-clock coordinates backed by the
  // monotonic WebSocket server clock, re-reading updated serverTime samples on
  // every status check and before every guess submission.
  const getChinaNowMs = createLiveChinaClock(tokenStore, tokenId, { nowMs });

  const initialChinaNowMs = getChinaNowMs();
  const localToday = safeTodaySchedule(initialChinaNowMs);
  const localOpen = resolveOpenGuesses(initialChinaNowMs);

  if (!localToday.isGuessDay && localOpen.length === 0) {
    log("逐鹿盐山：今日无竞猜赛程，跳过", "info");
    return { status: "not-guess-day", ok: true, reminder: "" };
  }

  try {
    log("正在检查今日逐鹿盐山竞猜状态…", "info");
    const status = await getApexGuessStatus(tokenStore, tokenId, {
      checkInterrupted,
      getNowMs: getChinaNowMs,
    });
    if (status.scheduleMismatch) {
      const reminder =
        "逐鹿盐山赛程待核对：服务器赛季与本地配置不一致，已停止自动竞猜，请前往逐鹿盐山卡片核对";
      log(reminder, "warning");
      return { status: "schedule-mismatch", ok: false, reminder };
    }
    const serverNowMs = status.serverNowMs ?? getChinaNowMs();
    const serverToday = safeTodaySchedule(serverNowMs);

    if (status.hasOpenGuesses) {
      if (status.pendingStagesCount > 0) {
        const result = await runApexAutoGuess({
          tokenStore,
          tokenId,
          checkInterrupted,
          getNowMs: getChinaNowMs,
          onProgress: (text) => log(`逐鹿盐山：${text}`, "info"),
        });
        if (result.outcome === "completed") {
          log(`逐鹿盐山竞猜：${result.message}`, "success");
          const laterReminder = formatLaterStageReminder(
            safeTodaySchedule(
              result.verifiedStatus?.serverNowMs ?? getChinaNowMs(),
            ),
          );
          if (laterReminder) log(laterReminder, "info");
          return {
            status: "completed",
            ok: true,
            reminder: laterReminder,
            result,
          };
        }
        if (result.outcome !== "no-open") {
          const mismatch = Boolean(result.verifiedStatus?.scheduleMismatch);
          const reminder = mismatch
            ? "逐鹿盐山赛程待核对：服务器赛季与本地配置不一致，已停止自动竞猜，请前往逐鹿盐山卡片核对"
            : formatLaterStageReminder(
                safeTodaySchedule(
                  result.verifiedStatus?.serverNowMs ?? getChinaNowMs(),
                ),
              );
          log(`逐鹿盐山竞猜：${result.message}`, "warning");
          if (reminder) log(reminder, mismatch ? "warning" : "info");
          return {
            status: mismatch ? "schedule-mismatch" : result.outcome,
            ok: false,
            reminder,
            result,
          };
        }
        // Fall through to outside-window reminder when window closed mid-check.
        const latestNow = result.verifiedStatus?.serverNowMs ?? getChinaNowMs();
        const latestToday = safeTodaySchedule(latestNow);
        if (latestToday.isGuessDay) {
          const reminder = formatOutsideWindowReminder(
            latestToday,
            result.verifiedStatus?.scheduleMismatch
              ? null
              : result.verifiedStatus?.nextGuess,
            latestNow,
          );
          log(reminder, "warning");
          return { status: "outside-window", ok: true, reminder, result };
        }
        log("逐鹿盐山：当前已无开放竞猜，跳过", "info");
        return { status: "not-guess-day", ok: true, reminder: "", result };
      }

      if (status.uncertainStagesCount > 0) {
        log(
          "逐鹿盐山竞猜：部分竞猜状态无法确认，请前往逐鹿盐山卡片核对",
          "warning",
        );
        return { status: "partial", ok: false, reminder: "" };
      }

      log("逐鹿盐山竞猜：当前开放阶段已全部竞猜，跳过", "success");
      const laterReminder = formatLaterStageReminder(serverToday);
      if (laterReminder) log(laterReminder, "info");
      return { status: "already-done", ok: true, reminder: laterReminder };
    }

    if (serverToday.isGuessDay) {
      const reminder = formatOutsideWindowReminder(
        serverToday,
        status.nextGuess,
        serverNowMs,
      );
      log(reminder, "warning");
      return { status: "outside-window", ok: true, reminder };
    }

    log("逐鹿盐山：服务器日期暂无开放竞猜，跳过", "info");
    return { status: "not-guess-day", ok: true, reminder: "" };
  } catch (error) {
    if (error?.interrupted) throw error;
    const fallbackNow = getChinaNowMs();
    const fallbackToday = safeTodaySchedule(fallbackNow);
    let fallbackReminder = "";
    if (fallbackToday.isGuessDay) {
      if (fallbackToday.openStages.length > 0) {
        const openText = fallbackToday.openStages
          .map((stage) => `${stage.title}（${stage.timeRange}）`)
          .join("、");
        const laterStage = fallbackToday.upcomingStages[0];
        const laterSuffix = laterStage
          ? `；同日 ${laterStage.title} 将于 ${laterStage.timeRange} 开放`
          : "";
        fallbackReminder = `逐鹿盐山竞猜提醒：当前未能核实账号状态，按赛程 ${openText} 正在开放${laterSuffix}，请前往逐鹿盐山卡片核对`;
      } else {
        fallbackReminder = formatOutsideWindowReminder(
          fallbackToday,
          getNextApexGuessWindow(fallbackNow),
          fallbackNow,
        );
      }
    }
    log(
      `逐鹿盐山竞猜检查未完成：${error?.message || "请求失败"}（不影响其他每日任务）`,
      "warning",
    );
    if (fallbackReminder) {
      log(fallbackReminder, "info");
    }
    return { status: "partial", ok: false, reminder: fallbackReminder };
  }
}

/**
 * Describe today's Apex (逐鹿盐山) guessing reminder when today is a knockout
 * guessing day — noting active open windows, upcoming same-day windows when
 * currently outside the betting period, or ended windows with the next date.
 */
export function describeApexGuessReminder({
  nowMs = Date.now(),
  apexGuessEnabled = true,
} = {}) {
  const chinaNowMs = safeToChinaWallClockMs(nowMs);
  const today = safeTodaySchedule(chinaNowMs);
  if (!today.isGuessDay) return "";
  const autoEnabled = apexGuessEnabled !== false;

  if (today.openStages.length > 0) {
    const openText = today.openStages
      .map((stage) => `${stage.title}（${stage.timeRange}）`)
      .join("、");
    const laterStage = today.upcomingStages[0];
    const laterSuffix = laterStage
      ? `；同日 ${laterStage.title} 将于 ${laterStage.timeRange} 开放`
      : "";
    return autoEnabled
      ? `今日为逐鹿盐山竞猜日，${openText} 正在开放，执行每日任务时可自动竞猜${laterSuffix}。`
      : `今日为逐鹿盐山竞猜日，${openText} 正在开放（当前已关闭日常自动竞猜，可前往竞猜卡片手动一键完成${laterSuffix}）。`;
  }

  if (today.upcomingStages.length > 0) {
    const nextStage = today.upcomingStages[0];
    return `今日为逐鹿盐山竞猜日，当前不在竞猜时段；下场 ${nextStage.title} 将于 ${nextStage.timeRange} 开放竞猜。`;
  }

  const nextWindow = getNextApexGuessWindow(chinaNowMs);
  const nextText = formatNextApexGuess(nextWindow, chinaNowMs);
  return `今日逐鹿盐山竞猜时段已结束${nextText ? `，下次预计 ${nextText}` : ""}，可前往查看对阵或领取竞猜奖励。`;
}
