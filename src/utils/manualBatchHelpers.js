// These helpers only operate on an explicitly selected number of existing items.
// A lost response to a consuming command is never retried automatically.
const STOP = Symbol("stop");

export function readItemCount(response, itemId) {
  const items = (response?.role || response?.data?.role)?.items;
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    throw new Error("无法确认当前角色的物品数量");
  }
  const item = items[itemId];
  if (item == null) return 0;
  if (item.quantity == null || item.quantity === "") {
    throw new Error("服务器未提供物品数量");
  }
  const count = Number(item.quantity);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("服务器返回的物品数量无效");
  }
  return count;
}

export function pickArenaTargetId(targets) {
  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];
  return candidate?.roleId || candidate?.id || targets?.roleId || targets?.id;
}

async function runBatch({
  send,
  shouldContinue,
  onProgress,
  requested,
  itemId,
  action,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let completed = 0;
  let total = 0;
  let available = 0;
  let consuming = false;
  const check = () => {
    if (!shouldContinue()) throw STOP;
  };
  const request = async (command, params = {}, isConsuming = false) => {
    check();
    consuming = isConsuming;
    const response = await send(command, params);
    consuming = false;
    return response;
  };
  try {
    if (!Number.isSafeInteger(requested) || requested <= 0)
      throw new Error("请选择有效次数");
    const role = await request("role_getroleinfo");
    check();
    available = readItemCount(role, itemId);
    total = Math.min(requested, available);
    onProgress({ completed, total, available });
    if (!total) return { status: "empty", completed, total, available };
    await action({
      request,
      check,
      total,
      async pause(ms) {
        check();
        await sleep(ms);
        check();
      },
      advance(count) {
        completed += count;
        onProgress({ completed, total, available });
      },
    });
    check();
    return { status: "completed", completed, total, available };
  } catch (error) {
    if (error === STOP)
      return { status: "stopped", completed, total, available };
    return {
      status: consuming ? "unconfirmed" : "failed",
      completed,
      total,
      available,
      error: error?.message || "请求失败",
    };
  }
}

export function runFishBatch({ type, ...options }) {
  if (type !== 1 && type !== 2) throw new Error("无效的鱼竿类型");
  return runBatch({
    ...options,
    itemId: type === 1 ? 1011 : 1012,
    async action({ request, total, advance, pause }) {
      for (let remaining = total; remaining > 0;) {
        const count = Math.min(10, remaining);
        await request(
          "artifact_lottery",
          { type, lotteryNumber: count, newFree: true },
          true,
        );
        advance(count);
        remaining -= count;
        if (remaining > 0) await pause(300);
      }
    },
  });
}

export function runArenaBatch(options) {
  return runBatch({
    ...options,
    itemId: 1007,
    async action({ request, check, total, advance, pause }) {
      for (let i = 0; i < total; i++) {
        await request("arena_startarea");
        const targets = await request("arena_getareatarget");
        check();
        const targetId = pickArenaTargetId(targets);
        if (!targetId) throw new Error("未找到可用的竞技场目标");
        await request("fight_startareaarena", { targetId }, true);
        advance(1);
        if (i + 1 < total) await pause(500);
      }
    },
  });
}
