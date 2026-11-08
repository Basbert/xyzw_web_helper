import { withApexGuessLock } from "./apexGuessHelper.js";
import { ApexAction, runApexAction } from "./apexRateLimit.js";
import {
  apexRewardClaimState,
  parseApexClaimableRewards,
} from "./apexRewardState.js";

export { parseApexClaimableRewards } from "./apexRewardState.js";

// A timed-out write may still arrive. Keep it blocked until the user reloads
// after checking the account; fresh reads during this run never repeat writes.
const uncertainAccounts = new Set();
const TIMEOUT = 10000;
export const isApexRewardClaimUncertain = (tokenId) =>
  uncertainAccounts.has(tokenId);

/** Claim server-listed eligible rewards only, once each, with no write retry. */
export async function runApexRewardClaims({
  tokenStore,
  tokenId,
  checkInterrupted = () => {},
  onProgress = () => {},
  runAction = runApexAction,
}) {
  if (
    !tokenId ||
    !tokenStore ||
    typeof tokenStore.sendMessageWithPromise !== "function" ||
    typeof checkInterrupted !== "function" ||
    typeof onProgress !== "function" ||
    typeof runAction !== "function"
  )
    throw new Error("竞猜奖励领取上下文不完整");
  return withApexGuessLock(tokenId, async () => {
    const result = {
      outcome: "partial",
      successCount: 0,
      entries: [],
      reason: "",
      message: "",
    };
    if (uncertainAccounts.has(tokenId)) {
      result.reason = "上次领取结果未确认，请先到游戏内核对，再重新加载页面";
      result.message = result.reason;
      return result;
    }
    const progress = (text) => {
      try {
        onProgress(text);
      } catch {
        /* display only */
      }
    };
    const read = async () => {
      checkInterrupted();
      const response = await runAction(
        ApexAction.READ,
        (queuedMs = 0) => {
          checkInterrupted();
          return tokenStore.sendMessageWithPromise(
            tokenId,
            "apex_getroleinfo",
            {},
            TIMEOUT + queuedMs,
          );
        },
        { maxRetry: 1 },
      );
      checkInterrupted();
      if (!response?.apexRoleInfo || typeof response.apexRoleInfo !== "object")
        throw new Error("无法读取逐鹿盐山角色信息");
      return response.apexRoleInfo;
    };
    let info;
    try {
      progress("正在检查竞猜奖励…");
      info = await read();
      const entries = parseApexClaimableRewards(info);
      if (!entries.length) {
        result.outcome = "completed";
        result.message = "当前没有可领取的竞猜奖励";
        return result;
      }
      for (const entry of entries) {
        checkInterrupted();
        if (apexRewardClaimState(info, entry) !== "pending") continue;
        progress(`已确认领取 ${result.successCount}/${entries.length} 项…`);
        const shown = { ...entry, status: "unconfirmed" };
        let sent = false;
        let acknowledgment;
        try {
          acknowledgment = await runAction(
            ApexAction.GUESS,
            (queuedMs = 0) => {
              checkInterrupted();
              sent = true;
              return tokenStore.sendMessageWithPromise(
                tokenId,
                "apex_guessclaim",
                entry,
                TIMEOUT + queuedMs,
              );
            },
            {
              maxRetry: 0,
              onWait: (ms) =>
                progress(`等待 ${Math.ceil(ms / 1000)} 秒后继续领取…`),
            },
          );
        } catch (error) {
          const rejected = /^服务器错误:\s*\d+\s*-/.test(error?.message || "");
          if (sent && !rejected) {
            uncertainAccounts.add(tokenId);
            result.entries.push(shown);
            result.reason =
              "本次领取结果未确认，请先到游戏内核对，再重新加载页面";
          } else {
            result.reason = error?.message || "领取未完成";
          }
          if (error?.interrupted) result.outcome = "stopped";
          break;
        }
        // Acknowledged is not the same as verified: only the server's updated
        // claim map can identify whether this exact reward is claimed.
        uncertainAccounts.add(tokenId);
        try {
          const updated = acknowledgment?.apexRoleInfo;
          let responseConfirmed = false;
          if (updated) {
            try {
              responseConfirmed =
                apexRewardClaimState(updated, entry) === "claimed";
            } catch {
              // Missing or partial response data needs a fresh role read.
            }
          }
          if (!responseConfirmed) info = await read();
          const state = responseConfirmed
            ? "claimed"
            : apexRewardClaimState(info, entry);
          if (state !== "claimed") throw new Error("服务器尚未确认领取状态");
        } catch (error) {
          result.entries.push(shown);
          result.reason = `已发送领取，但未能核对结果：${error.message || "请检查游戏"}；请先核对后重新加载页面`;
          if (error?.interrupted) result.outcome = "stopped";
          break;
        }
        uncertainAccounts.delete(tokenId);
        shown.status = "claimed";
        result.entries.push(shown);
        result.successCount++;
      }
      if (!result.reason) {
        result.outcome = "completed";
        result.message = `已确认领取 ${result.successCount} 项竞猜奖励`;
      }
    } catch (error) {
      result.outcome = error?.interrupted ? "stopped" : "partial";
      result.reason = error?.message || "领取未完成";
    }
    result.message ||= `已确认领取 ${result.successCount} 项；${result.reason || "领取未完成"}`;
    return result;
  });
}
