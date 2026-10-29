import { fillHangUpTime, runWithDailyTaskLock } from "./dailyTaskState.js";

/** Restart the bottle helper, then claim hang-up rewards and fill its help slots. */
export async function runBottleAndHangUp({
  tokenStore,
  tokenId,
  onProgress = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  return runWithDailyTaskLock(tokenId, async () => {
    const client = tokenStore.wsConnections?.[tokenId]?.client;
    const checkConnection = () => {
      if (
        !client ||
        tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
        tokenStore.wsConnections?.[tokenId]?.client !== client
      ) {
        throw new Error("账号或连接已变化，请重新检查两项状态");
      }
    };
    const check = () => {
      checkConnection();
      if (tokenStore.selectedToken?.id !== tokenId)
        throw new Error("账号或连接已变化，请重新检查两项状态");
    };
    let lastRole;
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
      lastRole = response.role;
      if (tokenStore.gameData) tokenStore.gameData.roleInfo = response;
      return response;
    };
    const send = async (cmd, failure) => {
      check();
      try {
        await tokenStore.sendMessageWithPromise(tokenId, cmd, {}, 8000);
      } catch (error) {
        throw new Error(`${failure}：${error.message || "未知错误"}`);
      }
      check();
      await sleep(500);
      check();
    };

    onProgress("检查盐罐状态...");
    await readRole();
    const stopTime = lastRole.bottleHelpers?.helperStopTime;
    if (
      !Number.isFinite(stopTime) ||
      !Number.isFinite(client.serverTime) ||
      client.serverTime <= 0
    ) {
      throw new TypeError("服务器未提供盐罐状态或时间，请刷新后重试");
    }
    const wasRunning = stopTime > client.serverTime / 1000;
    if (wasRunning) {
      onProgress("正在重启盐罐机器人...");
      check();
      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "bottlehelper_stop",
          {},
          8000,
        );
      } catch (error) {
        throw new Error(
          `盐罐停止请求未确认，请检查运行状态：${error.message || "未知错误"}`,
        );
      }
      await sleep(500);
    } else {
      onProgress("正在启动盐罐机器人...");
    }
    if (wasRunning) {
      try {
        // Recover the same salt helper even if selection changed after stop.
        checkConnection();
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "bottlehelper_start",
          {},
          8000,
        );
      } catch (error) {
        throw new Error(
          `盐罐启动失败，请检查运行状态：${error.message || "未知错误"}`,
        );
      }
      check();
      await sleep(500);
      check();
    } else {
      await send("bottlehelper_start", "盐罐启动失败，请检查运行状态");
    }

    onProgress("正在领取挂机奖励...");
    await send("system_claimhangupreward", "盐罐已处理，但挂机奖励领取失败");
    onProgress("正在补足挂机加钟...");
    let result;
    try {
      result = await fillHangUpTime({
        tokenStore,
        tokenId,
        readRole,
        check,
        sleep,
      });
    } catch (error) {
      throw new Error(
        `盐罐已启动，挂机奖励已领取，但加钟未完成：${error.message || "未知错误"}`,
      );
    }
    if (
      !Number.isFinite(lastRole.bottleHelpers?.helperStopTime) ||
      lastRole.bottleHelpers.helperStopTime <= client.serverTime / 1000
    ) {
      throw new Error("挂机已处理，但服务器未确认盐罐运行，请检查盐罐状态");
    }
    return result;
  });
}
