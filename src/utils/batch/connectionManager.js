import {
  getAccountClient,
  trackAccountConnection,
} from "../accountConnection.js";

/**
 * WebSocket连接管理器
 */

// 全局连接队列控制 - 限制并发连接数
export const connectionQueue = { active: 0 };

const unwrapRaw = (value) => {
  let current = value;
  while (current && typeof current === "object" && current.__v_raw) {
    current = current.__v_raw;
  }
  return current;
};

/** Request closure only for the client and socket owned by this task. */
export function closeOwnedConnection(tokenStore, tokenId, client, socket) {
  if (!client) return;
  if (typeof tokenStore.closeWebSocketConnectionIfCurrent === "function") {
    tokenStore.closeWebSocketConnectionIfCurrent(tokenId, client, socket);
  } else {
    tokenStore.closeWebSocketConnection(tokenId);
  }
}

/**
 * Acquire or reuse an account WebSocket connection and guarantee slot/socket
 * cleanup matches ownership even when tasks stop, fail, or get replaced.
 * @param {object} options Connection and logging dependencies.
 * @param {string} options.tokenId Target account identifier.
 * @param {string} [options.tokenName] Display name used in logs.
 * @param {Function} options.ensureConnection Slot/connection acquirer from caller.
 * @param {Function} [options.releaseConnectionSlot] Slot release callback.
 * @param {{ active: number }} [options.connectionQueue] Queue counter for logs.
 * @param {{ maxActive?: number }} [options.batchSettings] Batch concurrency settings.
 * @param {object} options.tokenStore Pinia token store instance.
 * @param {{ value?: boolean } | null} [options.shouldStop] Stop signal ref.
 * @param {Function | null} [options.addLog] Task log callback.
 * @param {number} [options.maxRetries] Maximum connection retries.
 * @param {boolean} [options.logOnClose] Whether closing logs queue occupancy.
 * @param {object} [options.connectionOptions] Extra options forwarded to ensureConnection.
 * @param {Function} handler Async callback receiving `{ check, ownsSlot }`.
 * @returns {Promise<unknown>} Result from `handler`.
 */
export async function withManagedConnection(
  {
    tokenId,
    tokenName = tokenId,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue: queue = connectionQueue,
    batchSettings = {},
    tokenStore,
    shouldStop = null,
    addLog = null,
    maxRetries = 2,
    logOnClose = false,
    connectionOptions = {},
  },
  handler,
) {
  let ownsSlot = false;
  let ownedClient = null;
  let ownedSocket = null;
  let clientTrackingProvided = false;
  let connection = null;

  const initialClient =
    tokenStore.getWebSocketStatus?.(tokenId) === "connected"
      ? getAccountClient(tokenStore, tokenId)
      : null;
  if (initialClient)
    connection = trackAccountConnection(tokenStore, tokenId, initialClient);

  const isConnectionIntact = () =>
    (!tokenStore.getWebSocketStatus ||
      tokenStore.getWebSocketStatus(tokenId) === "connected") &&
    (!clientTrackingProvided || Boolean(ownedClient)) &&
    (connection?.isIntact() ?? true);

  const check = () => {
    if (shouldStop?.value || !isConnectionIntact()) {
      const error = new Error("任务已停止或连接已断开");
      error.interrupted = true;
      throw error;
    }
  };

  const checkReadyConnection = () => {
    if (!ownedClient && !clientTrackingProvided && !ownsSlot)
      ownedClient = getAccountClient(tokenStore, tokenId);
    if (ownedClient) ownedSocket ??= unwrapRaw(ownedClient.socket) ?? null;
    if (!connection && ownedClient)
      connection = trackAccountConnection(
        tokenStore,
        tokenId,
        ownedClient,
        ownedSocket,
      );
    check();
  };

  try {
    await ensureConnection(
      tokenId,
      maxRetries,
      (owned) => {
        ownsSlot = owned;
      },
      (client, socket) => {
        clientTrackingProvided = true;
        ownedClient = client ? unwrapRaw(client) : null;
        ownedSocket = socket
          ? unwrapRaw(socket)
          : client?.socket
            ? unwrapRaw(client.socket)
            : null;
      },
      checkReadyConnection,
      connectionOptions,
    );
    checkReadyConnection();
    return await handler({ check, ownsSlot, isConnectionIntact });
  } finally {
    connection?.stop();
    if (ownsSlot) {
      let closeRequested = false;
      try {
        const current = unwrapRaw(tokenStore.wsConnections?.[tokenId]?.client);
        const currentSocket = unwrapRaw(current?.socket);
        if (
          ownedClient &&
          current === ownedClient &&
          (!ownedSocket || currentSocket === ownedSocket)
        ) {
          closeOwnedConnection(tokenStore, tokenId, ownedClient, ownedSocket);
          closeRequested = true;
        }
      } finally {
        releaseConnectionSlot?.();
      }
      if (logOnClose && addLog) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${closeRequested ? "已请求关闭本次连接" : "连接已变化或不可确认，保留当前连接"}  (队列: ${queue?.active ?? 0}/${batchSettings?.maxActive ?? 0})`,
          type: "info",
        });
      }
    }
  }
}

/**
 * Validate and switch preset team formation, recording original team id for restoration.
 * The caller's check must run after reading the current team and before writing.
 */
export async function switchPresetFormation({
  tokenStore,
  tokenId,
  targetFormation,
  check,
  addLog,
  errorMessage = "服务器未提供有效阵容，停止当前任务",
  state,
}) {
  check();
  const teamInfo = await tokenStore.sendMessageWithPromise(
    tokenId,
    "presetteam_getinfo",
    {},
    5000,
  );
  check();
  if (!teamInfo || !teamInfo.presetTeamInfo) {
    addLog?.({
      time: new Date().toLocaleTimeString(),
      message: `阵容信息异常: ${JSON.stringify(teamInfo)}`,
      type: "warning",
    });
  }

  const currentFormation = teamInfo?.presetTeamInfo?.useTeamId;
  const hasValidFormation = Number.isInteger(currentFormation);
  if (!hasValidFormation) {
    throw new Error(errorMessage);
  }
  state.originalFormation = currentFormation;

  if (currentFormation === targetFormation) {
    addLog?.({
      time: new Date().toLocaleTimeString(),
      message: `当前已是阵容${targetFormation}，无需切换`,
      type: "info",
    });
    return state;
  }

  // An acknowledgement can be lost after the server changes teams.
  state.changed = true;
  await tokenStore.sendMessageWithPromise(
    tokenId,
    "presetteam_saveteam",
    { teamId: targetFormation },
    5000,
  );
  addLog?.({
    time: new Date().toLocaleTimeString(),
    message: `成功切换到阵容${targetFormation}`,
    type: "info",
  });
  return state;
}

/**
 * Restore the original preset team only on the connection that switched it,
 * downgrading completed status to pending if restoration cannot be verified.
 */
export async function restorePresetFormation({
  tokenStore,
  tokenId,
  tokenName,
  tokenStatus,
  addLog,
  state,
  isConnectionIntact = () => true,
}) {
  if (!state?.changed || !Number.isInteger(state.originalFormation)) return;

  if (!isConnectionIntact()) {
    if (tokenStatus?.value?.[tokenId] === "completed") {
      tokenStatus.value[tokenId] = "pending";
    }
    addLog?.({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 连接已断开或被替换，跳过原阵容恢复，请手动检查`,
      type: "warning",
    });
    return;
  }

  try {
    await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_saveteam",
      { teamId: state.originalFormation },
      5000,
    );
  } catch (error) {
    if (tokenStatus?.value?.[tokenId] === "completed") {
      tokenStatus.value[tokenId] = "pending";
    }
    addLog?.({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 原阵容恢复失败，请手动检查: ${error.message}`,
      type: "warning",
    });
  }
}

/**
 * 创建连接管理器
 * @param {object} options - 配置选项
 * @param {object} options.tokenStore - Token存储
 * @param {object} options.batchSettings - 批量设置
 * @param {function} options.addLog - 日志添加函数
 * @param {object} [options.shouldStop] - 可选停止标志 ref
 * @param {object} [options.connectionQueue] - 当前批量运行页面的槽位计数
 * @returns {object} - 连接管理器对象
 */
export function createConnectionManager({
  tokenStore,
  batchSettings,
  addLog,
  shouldStop = null,
  connectionQueue = { active: 0 },
}) {
  /**
   * 等待连接槽位
   */
  const waitForConnectionSlot = async () => {
    while (connectionQueue.active >= batchSettings.maxActive) {
      if (shouldStop?.value) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (shouldStop?.value) {
      const error = new Error("批量任务已停止，取消等待连接槽位");
      error.interrupted = true;
      throw error;
    }
    connectionQueue.active++;
  };

  /**
   * 释放连接槽位
   */
  const releaseConnectionSlot = () => {
    if (connectionQueue.active > 0) {
      connectionQueue.active--;
    }
  };

  /**
   * 等待连接建立
   * @param {string} tokenId - Token ID
   * @param {number} timeout - 超时时间
   */
  const waitForConnection = async (
    tokenId,
    timeout = batchSettings.connectionTimeout,
  ) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldStop?.value) return false;
      const status = tokenStore.getWebSocketStatus(tokenId);
      if (status === "connected") return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  /**
   * 确保连接建立
   * @param {string} tokenId - Token ID
   * @param {object} tokens - Tokens列表
   * @param {number} maxRetries - 最大重试次数
   * @param {Function|null} onSlotChange - 槽位归属回调
   * @param {Function|null} onClientCreated - 客户端创建回调
   * @param {Function|null} onConnectionReady - 初始化前后校验回调
   * @param {object} options - 连接选项
   */
  const ensureConnection = async (
    tokenId,
    tokens,
    maxRetries = 2,
    onSlotChange = null,
    onClientCreated = null,
    onConnectionReady = null,
    options = {},
  ) => {
    const latestToken = tokens.find((t) => t.id === tokenId);
    if (!latestToken) {
      throw new Error(`Token not found: ${tokenId}`);
    }

    const status = tokenStore.getWebSocketStatus(tokenId);
    let connected = status === "connected";

    if (!connected) {
      await waitForConnectionSlot();
      connected = tokenStore.getWebSocketStatus(tokenId) === "connected";
      if (connected) releaseConnectionSlot();
    }
    if (!connected) {
      onSlotChange?.(true);
      onClientCreated?.(null, null);

      let slotReleased = false;
      const releaseOwnedSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        releaseConnectionSlot();
        onSlotChange?.(false);
      };

      let createdClient = null;
      let createdSocket = null;
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `正在连接... (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });

        createdClient = await tokenStore.createWebSocketConnection(
          tokenId,
          latestToken.token,
          latestToken.wsUrl,
        );
        createdSocket = unwrapRaw(createdClient?.socket);
        onClientCreated?.(createdClient, createdSocket);
        connected =
          createdClient || !onClientCreated
            ? await waitForConnection(tokenId)
            : false;

        if (!connected && maxRetries > 0 && !shouldStop?.value) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `连接超时，尝试重连...`,
            type: "warning",
          });

          const current = unwrapRaw(
            tokenStore.wsConnections?.[tokenId]?.client,
          );
          if (
            onClientCreated &&
            current &&
            (!createdClient ||
              current !== unwrapRaw(createdClient) ||
              (createdSocket && unwrapRaw(current.socket) !== createdSocket))
          ) {
            const error = new Error("连接已被替换，停止批量任务");
            error.interrupted = true;
            throw error;
          }
          if (
            !onClientCreated ||
            (createdClient &&
              current &&
              unwrapRaw(createdClient) === current &&
              (!createdSocket || unwrapRaw(current.socket) === createdSocket))
          ) {
            if (onClientCreated) {
              closeOwnedConnection(
                tokenStore,
                tokenId,
                createdClient,
                createdSocket ?? null,
              );
            } else {
              tokenStore.closeWebSocketConnection(tokenId);
            }
          }
          await new Promise((r) => setTimeout(r, batchSettings.reconnectDelay));

          if (!shouldStop?.value) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `正在重连...`,
              type: "info",
            });

            const refreshedToken = tokens.find((t) => t.id === tokenId);
            if (!refreshedToken) {
              throw new Error(`Token not found: ${tokenId}`);
            }
            createdClient = await tokenStore.createWebSocketConnection(
              tokenId,
              refreshedToken.token,
              refreshedToken.wsUrl,
            );
            createdSocket = unwrapRaw(createdClient?.socket);
            onClientCreated?.(createdClient, createdSocket);

            connected =
              createdClient || !onClientCreated
                ? await waitForConnection(tokenId)
                : false;
          }
        }

        if (!connected) {
          const current = unwrapRaw(
            tokenStore.wsConnections?.[tokenId]?.client,
          );
          if (
            !onClientCreated ||
            (createdClient &&
              current &&
              unwrapRaw(createdClient) === current &&
              (!createdSocket || unwrapRaw(current.socket) === createdSocket))
          ) {
            if (onClientCreated) {
              closeOwnedConnection(
                tokenStore,
                tokenId,
                createdClient,
                createdSocket ?? null,
              );
            } else {
              tokenStore.closeWebSocketConnection(tokenId);
            }
          }
          const error = new Error(
            shouldStop?.value ? "任务已停止" : "连接失败 (重试后仍超时)",
          );
          if (shouldStop?.value) {
            error.interrupted = true;
          }
          throw error;
        }
      } catch (err) {
        releaseOwnedSlot();
        throw err;
      }
    }

    onConnectionReady?.();
    if (options.skipInitialization) return true;

    try {
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        5000,
      );
      onConnectionReady?.();

      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "fight_startlevel",
        {},
        5000,
      );
      onConnectionReady?.();
      if (res?.battleData?.version) {
        tokenStore.setBattleVersion(res.battleData.version, tokenId);
      }
    } catch (e) {
      if (e?.interrupted) throw e;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `初始化数据失败: ${e.message}`,
        type: "warning",
      });
    }

    return true;
  };

  return {
    connectionQueue,
    waitForConnectionSlot,
    releaseConnectionSlot,
    waitForConnection,
    ensureConnection,
  };
}

/**
 * 活动状态辅助函数
 * @returns {object} - 活动状态
 */
/**
 * Run a per-account batch workflow with snapshotted account IDs, guaranteed
 * running-flag cleanup, missing-token guards, and optional completion summary.
 */
export async function runBatchForAccounts(
  {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    currentRunningTokenId,
    addLog,
    message,
    label,
    notifyOnFinish = false,
    notifyMessage,
  },
  runAccount,
) {
  if (isRunning.value || selectedTokens.value.length === 0) return null;
  const tokenIds = [...selectedTokens.value];
  isRunning.value = true;
  shouldStop.value = false;
  tokenIds.forEach((id) => {
    tokenStatus.value[id] = "waiting";
  });

  try {
    await Promise.allSettled(
      tokenIds.map(async (tokenId) => {
        if (shouldStop.value) {
          tokenStatus.value[tokenId] = "stopped";
          return;
        }
        tokenStatus.value[tokenId] = "running";
        const token = tokens.value.find((item) => item.id === tokenId);
        if (!token) {
          tokenStatus.value[tokenId] = "failed";
          addLog?.({
            time: new Date().toLocaleTimeString(),
            message: `账号已不存在，跳过${label}`,
            type: "error",
          });
          return;
        }
        try {
          await runAccount({ tokenId, token });
        } catch (error) {
          tokenStatus.value[tokenId] = error?.interrupted
            ? "stopped"
            : "failed";
          addLog?.({
            time: new Date().toLocaleTimeString(),
            message: `[${token.name || tokenId}] ${label}异常: ${error?.message || "未知错误"}`,
            type: error?.interrupted ? "warning" : "error",
          });
        }
      }),
    );
  } finally {
    isRunning.value = false;
    currentRunningTokenId.value = null;
  }

  const hasIncomplete =
    shouldStop.value ||
    tokenIds.some((id) => tokenStatus.value[id] !== "completed");
  if (notifyOnFinish && message) {
    if (typeof notifyMessage === "function") {
      notifyMessage({ tokenIds, hasIncomplete });
    } else if (hasIncomplete) {
      message.warning(`批量${label}已结束，部分账号未完成，请查看日志`);
    } else {
      message.success(`批量${label}完成`);
    }
  }
  return { tokenIds, hasIncomplete };
}

/**
 * 活动开放时间检查（统一按北京时间 UTC+8 计算）
 */
export const getActivityStatus = (nowMs = Date.now()) => {
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  const shanghai = new Date(Number(nowMs) + shanghaiOffsetMs);
  const day = shanghai.getUTCDay();
  const hour = shanghai.getUTCHours();

  // 计算当前活动周
  const startMs = Date.parse("2025-12-12T12:00:00+08:00"); // 起始时间：黑市周开始
  const weekDuration = 7 * 24 * 60 * 60 * 1000; // 一周毫秒数
  const cycleDuration = 3 * weekDuration; // 三周期毫秒数

  const elapsed = Number(nowMs) - startMs;
  let currentActivityWeek = null;

  if (elapsed >= 0) {
    const cyclePosition = elapsed % cycleDuration;
    if (cyclePosition < weekDuration) {
      currentActivityWeek = "黑市周";
    } else if (cyclePosition < 2 * weekDuration) {
      currentActivityWeek = "招募周";
    } else {
      currentActivityWeek = "宝箱周";
    }
  }

  return {
    // 梦境活动开放 (周日、周一、周三、周四)
    ismengjingActivityOpen: day === 0 || day === 1 || day === 3 || day === 4,
    // 宝库活动开放 (非周一、周二)
    isbaokuActivityOpen: day !== 1 && day !== 2,
    // 竞技场活动开放 (6点到22点)
    isarenaActivityOpen: hour >= 6 && hour < 22,
    // 当前活动周
    currentActivityWeek,
    // 怪异塔活动开放 (黑市周)
    isWeirdTowerActivityOpen: currentActivityWeek === "黑市周",
  };
};

/**
 * 日期辅助函数
 * @returns {number} - 今日开始时间戳（秒）
 */
export const getTodayStartSec = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

/**
 * 检查今日是否可用
 * @param {number} lastTimeSec - 上次使用时间戳（秒）
 * @returns {boolean} - 今日是否可用
 */
export const isTodayAvailable = (lastTimeSec) => {
  if (!lastTimeSec || typeof lastTimeSec !== "number") return true;
  return lastTimeSec < getTodayStartSec();
};

/**
 * 计算月度任务进度
 * @returns {number} - 进度百分比（0-1）
 */
export const calculateMonthProgress = () => {
  const now = new Date();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dayOfMonth = now.getDate();
  return Math.min(1, Math.max(0, dayOfMonth / daysInMonth));
};

/**
 * 竞技场目标ID选择
 * @param {object} targets - 目标列表
 * @returns {number|null} - 目标ID
 */
export const pickArenaTargetId = (targets) => {
  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];

  if (candidate?.roleId) return candidate.roleId;
  if (candidate?.id) return candidate.id;
  return targets?.roleId || targets?.id;
};
