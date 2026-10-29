import { fillHangUpTime, runWithDailyTaskLock } from "./dailyTaskState.js";

/** Run one card action on a stable connection and verify the resulting role state. */
export async function runStandaloneDailyAction({
  tokenStore,
  tokenId,
  action,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!["bottle", "claim", "extend"].includes(action)) {
    throw new TypeError("不支持的日常操作");
  }
  return runWithDailyTaskLock(tokenId, async () => {
    const client = tokenStore.wsConnections?.[tokenId]?.client;
    const checkConnection = () => {
      if (
        !client ||
        tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
        tokenStore.wsConnections?.[tokenId]?.client !== client
      ) {
        throw new Error("账号或连接已变化，请重新检查状态");
      }
    };
    const check = () => {
      checkConnection();
      if (tokenStore.selectedToken?.id !== tokenId) {
        throw new Error("账号或连接已变化，请重新检查状态");
      }
    };
    const readRole = async () => {
      check();
      const response = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        15000,
      );
      check();
      if (!response?.role) throw new Error("服务器未返回角色状态");
      if (tokenStore.gameData) tokenStore.gameData.roleInfo = response;
      return response;
    };
    const send = async (command) => {
      check();
      await tokenStore.sendMessageWithPromise(tokenId, command, {}, 8000);
      check();
    };

    check();
    if (action === "claim") {
      await send("system_claimhangupreward");
      try {
        await sleep(500);
        await readRole();
        return { refreshed: true };
      } catch {
        return { refreshed: false };
      }
    }
    if (action === "extend") {
      return fillHangUpTime({ tokenStore, tokenId, readRole, check, sleep });
    }

    const before = await readRole();
    const stopTime = before.role.bottleHelpers?.helperStopTime;
    if (
      !Number.isFinite(stopTime) ||
      !Number.isFinite(client.serverTime) ||
      client.serverTime <= 0
    ) {
      throw new TypeError("服务器未提供盐罐状态或时间，请刷新后重试");
    }
    const wasRunning = stopTime > client.serverTime / 1000;
    if (wasRunning) {
      check();
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_stop",
        {},
        8000,
      );
      await sleep(500);
    }
    try {
      // Once stop is acknowledged, try to restart that same connection even if
      // the user selected another account in the meantime.
      if (wasRunning) {
        checkConnection();
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "bottlehelper_start",
          {},
          8000,
        );
      } else {
        await send("bottlehelper_start");
      }
    } catch (error) {
      if (wasRunning)
        throw new Error(`盐罐已停止，但启动未确认：${error.message}`);
      throw error;
    }
    check();
    await sleep(500);
    const after = await readRole();
    const confirmedStopTime = after.role.bottleHelpers?.helperStopTime;
    if (
      !Number.isFinite(confirmedStopTime) ||
      confirmedStopTime <= client.serverTime / 1000
    ) {
      throw new Error("启动请求已发送，但服务器尚未确认盐罐运行");
    }
    return { wasRunning };
  });
}
