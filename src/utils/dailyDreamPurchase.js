import { goldItemsConfig } from "./dreamConstants.js";

const activeAccounts = new Set();
const uncertainAccounts = new Set();
const MAX_PURCHASES = 100;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Shared by daily and manual entry points. A lost purchase reply blocks retries. */
export async function withDreamPurchaseLock(accountId, operation) {
  if (!accountId || typeof operation !== "function")
    throw new Error("梦境购买上下文不完整");
  if (activeAccounts.has(accountId))
    throw new Error("该角色已有梦境购买正在进行");
  if (uncertainAccounts.has(accountId))
    throw new Error("上次梦境购买结果未确认，请在游戏中核对后重新加载页面");
  activeAccounts.add(accountId);
  try {
    return await operation();
  } catch (error) {
    if (error?.uncertain) uncertainAccounts.add(accountId);
    throw error;
  } finally {
    activeAccounts.delete(accountId);
  }
}

function storeSnapshot(response) {
  const role = response?.role;
  const level = Number(role?.levelId);
  if (!Number.isSafeInteger(level) || level < 4000)
    throw new Error("未达到 4000 关或无法确认关卡，已停止梦境购买");
  const source = role?.dungeon?.merchant;
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new Error("未能确认梦境商店，请先完成梦境后再试");
  const stores = {};
  for (const id of [1, 2, 3]) {
    const items =
      source instanceof Map
        ? (source.get(id) ?? source.get(String(id)))
        : source[id];
    if (items == null) continue;
    if (!Array.isArray(items) || items.some((item) => !Number.isInteger(item)))
      throw new Error("梦境商品数据不完整，已停止购买");
    stores[id] = items.slice();
  }
  if (!Object.keys(stores).length)
    throw new Error("未能确认梦境商店，请先完成梦境后再试");
  return stores;
}

/** Exact union of the two existing buttons; descending positions per merchant. */
export function buildDreamPurchasePlan(stores) {
  const plan = [];
  for (const id of [1, 2, 3]) {
    const items = stores[id] || [];
    for (let pos = items.length - 1; pos >= 0; pos--) {
      const index = items[pos];
      if (goldItemsConfig[id].includes(index) || (id === 3 && index === 2))
        plan.push({ id, index, pos });
    }
  }
  if (plan.length > MAX_PURCHASES)
    throw new Error("梦境商品数量异常，已停止购买");
  return plan;
}

/**
 * Buy the exact union of the two manual dream-shop actions.
 * `isOpen` is a required, caller-verified game-day decision; no shop request
 * occurs on closed days. `checkActive` must throw on account/connection change.
 * Calls are serialized, positions checked against fresh role info and every
 * confirmed purchase must be reflected in a subsequent read-only snapshot.
 */
export async function runDailyDreamPurchase({
  accountId,
  isOpen,
  send,
  checkActive,
  onProgress = () => {},
  pause = wait,
}) {
  if (
    typeof isOpen !== "boolean" ||
    typeof send !== "function" ||
    typeof checkActive !== "function" ||
    typeof onProgress !== "function" ||
    typeof pause !== "function"
  )
    throw new Error("梦境购买状态不完整");
  if (!isOpen)
    return { status: "skipped", purchases: [], message: "今日梦境未开放" };
  return withDreamPurchaseLock(accountId, async () => {
    const purchases = [];
    const read = async () => {
      checkActive();
      // The role-info endpoint has its own rate limit, independent of purchases.
      await pause(1000);
      checkActive();
      const response = await send("role_getroleinfo", {});
      checkActive();
      return storeSnapshot(response);
    };
    try {
      let stores = await read();
      const plan = buildDreamPurchasePlan(stores);
      for (const item of plan) {
        checkActive();
        const before = stores[item.id];
        if (!before || before[item.pos] !== item.index)
          throw new Error("梦境商品位置已变化，后续购买已停止");
        const beforeCount = before.filter(
          (index) => index === item.index,
        ).length;
        let response;
        try {
          response = await send("dungeon_buymerchant", item);
        } catch (cause) {
          if (/^服务器错误:\s*\d+\s*-/.test(cause?.message || ""))
            throw new Error(`服务器拒绝购买：${cause.message}`, { cause });
          const error = new Error(
            "购买结果未确认，请核对原账号商品和资源后重新加载页面",
            { cause },
          );
          error.uncertain = true;
          throw error;
        }
        if (
          !response ||
          typeof response !== "object" ||
          !Array.isArray(response.reward)
        ) {
          const error = new Error(
            "购买结果未确认，请核对原账号商品和资源后重新加载页面",
          );
          error.uncertain = true;
          throw error;
        }
        purchases.push({ ...item, reward: response.reward });
        try {
          onProgress({ confirmed: purchases.length, total: plan.length, item });
        } catch {
          /* observer only */
        }
        checkActive();
        stores = await read();
        const after = stores[item.id];
        if (
          !after ||
          after.filter((index) => index === item.index).length !==
            beforeCount - 1
        )
          throw new Error("购买已确认，但商品余量未能核对，后续购买已停止");
      }
      return {
        status: "completed",
        purchases,
        message: `梦境商店已确认购买 ${purchases.length} 件`,
      };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      error.purchases = purchases.slice();
      error.confirmed = purchases.length;
      throw error;
    }
  });
}
