import type { ProtoMsg } from "@/utils/bonProtocol";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, toRaw, watch } from "vue";

import useIndexedDB from "@/hooks/useIndexedDB";
import router from "@/router";
import { createAccountGameData } from "@/utils/accountGameData";
import { normalizeRoleId } from "@/utils/accountIdentity.js";
import { g_utils } from "@/utils/bonProtocol";
import { createConnectionRecovery } from "@/utils/connectionRecovery";

import { gameLogger, tokenLogger, wsLogger } from "@/utils/logger";
import { generateRandomSeed } from "@/utils/randomSeed";
import {
  fetchTokenPayloadFromUrl,
  scheduleAuthUserRequest,
  setAuthUserRateLimiterCallback,
  transformToken,
} from "@/utils/token";
import {
  refreshTokenFromCombUser,
  roleIndexFromServerId,
} from "@/utils/wechatForceLogout";
import { XyzwWebSocketClient } from "@/utils/xyzwWebSocket";
import { $emit, emitPlus } from "./events/index.js";

const { getArrayBuffer, storeArrayBuffer, deleteArrayBuffer, clearAll } =
  useIndexedDB();

declare interface TokenData {
  id: string;
  name: string;
  token: string; // 原始Base64 token
  wsUrl: string | null; // 可选的自定义WebSocket URL
  server: string;
  remark?: string; // 备注信息
  level?: number;
  profession?: string;
  createdAt?: string;
  lastUsed?: string;
  isActive?: boolean;
  importMethod?:
    "manual" | "bin" | "url" | "wxQrcode" | "mobile" | "wxForceLogout";
  sourceUrl?: string | null; // 当importMethod为url时，存储url链接
  avatar?: string; // 用户头像URL
  upgradedToPermanent?: boolean; // 是否升级为长期有效
  upgradedAt?: string; // 升级时间
  updatedAt?: string; // 更新时间
  lastRefreshed?: number;
  combUser?: Record<string, unknown> | null;
  serverId?: string | number | null;
  roleId?: string | number | null;
  roleIndex?: number | null;
  credentialVersion?: number;
}

declare interface WebSocketConnection {
  status:
    "connecting" | "connected" | "disconnecting" | "disconnected" | "error";
  client: XyzwWebSocketClient | null;
  lastError: { timestamp: string; error: string; url?: string } | null;
  tokenId: string;
  wsUrl?: string;
  actualToken?: string;
  sessionId: string;
  createdAt: string;
  connectedAt?: string | null;
  lastMessageAt: string | null;
  lastMessage?: { timestamp: string; data: unknown; cmd?: string } | null;
  reconnectAttempts?: number;
  randomSeedSynced?: boolean;
  lastRandomSeedSource?: number | null;
  lastRandomSeed?: number | null;
}

declare type WebCtx = Record<string, Partial<WebSocketConnection>>;

declare interface ConnectLock {
  tokenId: string;
  operation: "connect" | "disconnect";
  timestamp: number;
  sessionId: string;
}
declare type LockCtx = Record<string, Partial<ConnectLock>>;

declare interface CrossTabConnectionState {
  action: string;
  sessionId: string;
  timestamp: number;
}

const getErrorMessage = (error: unknown, fallback = "未知错误") =>
  error instanceof Error ? error.message : String(error || fallback);

class ConnectionLeaseTimeoutError extends Error {
  constructor() {
    super("等待跨标签页连接协调超时");
  }
}

// 分组接口定义
declare interface TokenGroup {
  id: string;
  name: string;
  color: string; // 分组颜色，用于UI显示
  tokenIds: string[]; // 属于该分组的token ID列表
  createdAt?: string;
  updatedAt?: string;
}

let isVueUseGameTokensStorage = false;
export const gameTokens = useLocalStorage<TokenData[]>("gameTokens", [], {
  flush: "sync",
  listenToStorageChanges: false,
  serializer: {
    read: (value: string) => {
      isVueUseGameTokensStorage = true;
      return value ? JSON.parse(value) : [];
    },
    write: (value: TokenData[]) => {
      isVueUseGameTokensStorage = true;
      return JSON.stringify(value);
    },
  },
  onError: () => {
    isVueUseGameTokensStorage = true;
  },
});
const readRawGameTokensJson = (): string | null => {
  if (typeof localStorage === "undefined" || !localStorage?.getItem) {
    return null;
  }
  try {
    return localStorage.getItem("gameTokens");
  } catch {
    return null;
  }
};
const storageBackedGameTokens =
  isVueUseGameTokensStorage || readRawGameTokensJson() !== null;
let lastKnownPersistedGameTokensJson: string | null = readRawGameTokensJson();

const syncGameTokensFromStorage = (): boolean => {
  const raw = readRawGameTokensJson();
  if (!raw) {
    if (storageBackedGameTokens && gameTokens.value.length > 0) {
      lastKnownPersistedGameTokensJson = null;
      gameTokens.value = [];
      return true;
    }
    return false;
  }
  // For real storage-backed stores, always reconcile memory against the live
  // localStorage payload even if raw === lastKnown, so a late storage event
  // that reverted in-memory state can never write stale tokens back to disk.
  if (!storageBackedGameTokens && raw === lastKnownPersistedGameTokensJson) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    let currentJson = "";
    try {
      currentJson = JSON.stringify(gameTokens.value);
    } catch {
      currentJson = "";
    }
    lastKnownPersistedGameTokensJson = raw;
    if (currentJson !== raw) {
      gameTokens.value = parsed;
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

if (
  storageBackedGameTokens &&
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener(
    "storage",
    (event: StorageEvent) => {
      if (
        event?.storageArea &&
        typeof localStorage !== "undefined" &&
        event.storageArea !== localStorage
      ) {
        return;
      }
      if (event?.key != null && event.key !== "gameTokens") {
        return;
      }
      // Read live localStorage rather than trusting a possibly stale
      // event.newValue from an earlier cross-tab write.
      syncGameTokensFromStorage();
    },
    { passive: true },
  );
}

const persistGameTokensToStorage = (): { ok: boolean; error?: unknown } => {
  if (typeof localStorage === "undefined" || !localStorage?.setItem) {
    return { ok: true };
  }
  const shouldPersist =
    storageBackedGameTokens || readRawGameTokensJson() !== null;
  if (!shouldPersist) {
    return { ok: true };
  }
  try {
    const serialized = JSON.stringify(gameTokens.value);
    if (localStorage.getItem("gameTokens") !== serialized) {
      localStorage.setItem("gameTokens", serialized);
    }
    const verified = localStorage.getItem("gameTokens");
    if (verified !== serialized) {
      return {
        ok: false,
        error: new Error("保存账号列表到本地存储失败，写入校验不一致"),
      };
    }
    lastKnownPersistedGameTokensJson = serialized;
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};

export const hasTokens = computed(() => gameTokens.value.length > 0);
export const selectedTokenId = useLocalStorage("selectedTokenId", "");
export const selectedToken = computed(() => {
  return gameTokens.value?.find((token) => token.id === selectedTokenId.value);
});

// 跨标签页连接协调
const activeConnections = useLocalStorage<
  Record<string, CrossTabConnectionState>
>("activeConnections", {});

// Token分组管理
export const tokenGroups = useLocalStorage<TokenGroup[]>("tokenGroups", []);

/**
 * 重构后的Token管理存储
 * 以名称-token列表形式管理多个游戏角色
 */
export const useTokenStore = defineStore("tokens", () => {
  const wsConnections = ref<WebCtx>({}); // WebSocket连接状态
  const connectionLocks = ref<LockCtx>({}); // 连接操作锁，防止竞态条件

  // 游戏数据存储
  const createInitialGameData = () => ({
    roleInfo: null,
    legionInfo: null,
    commonActivityInfo: null, // 消耗活动进度
    bossTowerInfo: null, //宝库
    evoTowerInfo: null, //怪异塔
    presetTeam: null,
    battleVersion: null as number | null, // 战斗版本号
    weeklyQuizPhase: "",
    lastUpdated: null as string | null,
  });
  const accountGameData = createAccountGameData(
    selectedTokenId,
    createInitialGameData,
  );
  const gameData = accountGameData.gameData;

  // 获取当前选中token的角色信息
  const selectedTokenRoleInfo = computed(() => {
    return gameData.value.roleInfo;
  });

  const readStatisticsValue = (stats: any, key: string) => {
    if (!stats) return undefined;
    try {
      if (typeof stats.get === "function") {
        return stats.get(key);
      }
      if (Object.prototype.hasOwnProperty.call(stats, key)) {
        return stats[key];
      }
    } catch (error) {
      gameLogger.warn("读取统计数据失败:", error);
    }
    return undefined;
  };

  const extractLastLoginTimestamp = (payload: any) => {
    if (!payload) return null;

    const candidateSources = [
      payload?.role?.statistics,
      payload?.statistics,
      payload?.role?.statisticsTime,
      payload?.statisticsTime,
    ];

    const candidateKeys = [
      "last:login:time",
      "lastLoginTime",
      "last_login_time",
    ];

    for (const stats of candidateSources) {
      if (!stats) continue;
      for (const key of candidateKeys) {
        const value = readStatisticsValue(stats, key);
        if (value !== undefined && value !== null) {
          const numeric = Number(value);
          if (!Number.isNaN(numeric) && numeric > 0) {
            return numeric;
          }
        }
      }
    }
    return null;
  };

  const syncRandomSeedFromStatistics = (
    tokenId: string,
    rolePayload: any,
    client: XyzwWebSocketClient | null,
  ) => {
    if (!client) return;
    const connection = wsConnections.value[tokenId];
    if (!connection || connection.status !== "connected") {
      return;
    }

    const lastLoginTime = extractLastLoginTimestamp(rolePayload);
    if (!lastLoginTime) {
      return;
    }

    if (
      connection.randomSeedSynced &&
      connection.lastRandomSeedSource === lastLoginTime
    ) {
      return;
    }

    const randomSeed = generateRandomSeed(lastLoginTime);

    try {
      client.send("system_custom", {
        key: "randomSeed",
        value: randomSeed,
      });
      connection.randomSeedSynced = true;
      connection.lastRandomSeedSource = lastLoginTime;
      connection.lastRandomSeed = randomSeed;
      wsLogger.info(`同步 randomSeed [${tokenId}]`, {
        lastLoginTime,
        randomSeed,
      });
    } catch (error) {
      wsLogger.error(`发送 randomSeed 失败 [${tokenId}]`, error);
    }
  };

  // Token管理
  const applyAddToken = (
    tokenData: Partial<TokenData> & Pick<TokenData, "name" | "token">,
  ):
    | { ok: true; token: TokenData }
    | { ok: false; reason: "storage_write_failed"; error?: unknown } => {
    syncGameTokensFromStorage();
    const previousTokens = [...gameTokens.value];
    const id =
      tokenData.id ||
      `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newToken: TokenData = {
      id,
      name: tokenData.name,
      token: tokenData.token, // 保存原始Base64 token
      wsUrl: tokenData.wsUrl || null, // 可选的自定义WebSocket URL
      server: tokenData.server || "",
      remark: tokenData.remark || "", // 备注信息
      level: tokenData.level || 1,
      profession: tokenData.profession || "",
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      isActive: true,
      // URL获取相关信息
      sourceUrl: tokenData.sourceUrl || null, // Token来源URL（用于刷新）
      importMethod: tokenData.importMethod || "manual", // 导入方式：manual 或 url
      avatar: tokenData.avatar || "", // 用户头像
      combUser: tokenData.combUser || null,
      serverId: tokenData.serverId ?? null,
      roleId: tokenData.roleId ?? null,
      roleIndex: tokenData.roleIndex ?? null,
    };

    gameTokens.value.push(newToken);
    const persisted = persistGameTokensToStorage();
    if (!persisted.ok) {
      gameTokens.value = previousTokens;
      return {
        ok: false,
        reason: "storage_write_failed",
        error: persisted.error,
      };
    }
    return { ok: true, token: newToken };
  };

  /**
   * Persist a token record under its existing byte-derived identity.
   * @param {Partial<TokenData> & Pick<TokenData, "name" | "token">} tokenData Imported credential and role metadata.
   * @returns {TokenData} Stored token record.
   */
  const addToken = (
    tokenData: Partial<TokenData> & Pick<TokenData, "name" | "token">,
  ) => {
    const result = applyAddToken(tokenData);
    if (!result.ok) {
      throw new Error("保存账号列表到本地存储失败（可能存储空间不足）");
    }
    return result.token;
  };

  const CREDENTIAL_UPDATE_KEYS = new Set([
    "token",
    "combUser",
    "importMethod",
    "sourceUrl",
    "lastRefreshed",
    "serverId",
    "roleIndex",
  ]);
  const CRED_VERSION_KEY_PREFIX = "xyzw_cred_ver_";
  const STORE_WRITE_LOCK_NAME = "xyzw-gameTokens";
  const STORE_WRITE_LOCK_WAIT_MS = 10000;
  let credentialVersionSeed = 0;
  const tokenCredentialVersions = new Map<string, number>();
  let storeWriteQueue: Promise<unknown> = Promise.resolve();
  const inFlightBattleVersion = new Map<
    string,
    { client: unknown; socket: unknown; promise: Promise<number | null> }
  >();

  const readPersistedTokenState = (
    tokenId: string,
  ): { hasList: boolean; token: TokenData | null } => {
    if (typeof localStorage === "undefined" || !localStorage?.getItem) {
      return { hasList: false, token: null };
    }
    try {
      const raw = localStorage.getItem("gameTokens");
      if (!raw) return { hasList: false, token: null };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { hasList: false, token: null };
      const token =
        parsed.find((entry): entry is TokenData =>
          Boolean(entry && typeof entry === "object" && entry.id === tokenId),
        ) || null;
      return { hasList: true, token };
    } catch {
      return { hasList: false, token: null };
    }
  };

  const getCredentialVersion = (tokenId: string): number => {
    let version = tokenCredentialVersions.get(tokenId) || 0;
    const inMem = gameTokens.value.find((t) => t.id === tokenId);
    if (
      typeof inMem?.credentialVersion === "number" &&
      Number.isFinite(inMem.credentialVersion)
    ) {
      version = Math.max(version, inMem.credentialVersion);
    }
    const { token: persisted } = readPersistedTokenState(tokenId);
    if (
      typeof persisted?.credentialVersion === "number" &&
      Number.isFinite(persisted.credentialVersion)
    ) {
      version = Math.max(version, persisted.credentialVersion);
    }
    if (typeof localStorage !== "undefined" && localStorage?.getItem) {
      try {
        const rawVer = localStorage.getItem(
          `${CRED_VERSION_KEY_PREFIX}${tokenId}`,
        );
        const numeric = Number(rawVer);
        if (Number.isFinite(numeric) && numeric > 0) {
          version = Math.max(version, numeric);
        }
      } catch {
        // Ignore storage read errors.
      }
    }
    return version;
  };

  const bumpCredentialVersion = (tokenId: string) => {
    const current = getCredentialVersion(tokenId);
    const next = Math.max(current, credentialVersionSeed) + 1;
    credentialVersionSeed = next;
    tokenCredentialVersions.set(tokenId, next);
    if (typeof localStorage !== "undefined" && localStorage?.setItem) {
      try {
        localStorage.setItem(
          `${CRED_VERSION_KEY_PREFIX}${tokenId}`,
          String(next),
        );
      } catch {
        // Ignore storage write errors.
      }
    }
    return next;
  };

  const extractRoleIdFromSessionToken = (
    sessionToken: string,
  ): string | null => {
    if (typeof sessionToken !== "string" || !sessionToken.trim()) return null;
    try {
      const parsed = JSON.parse(sessionToken);
      return normalizeRoleId(parsed?.roleId ?? parsed?.role?.roleId);
    } catch {
      return null;
    }
  };

  const runWithStoreWriteLock = <T>(task: () => Promise<T>): Promise<T> => {
    const previous = storeWriteQueue;
    const next = previous.then(task, task);
    storeWriteQueue = next.then(
      () => {},
      () => {},
    );
    return next;
  };

  const withStoreWriteLease = async <T>(
    operation: (isActive: () => boolean) => Promise<T>,
    waitTimeoutMs = STORE_WRITE_LOCK_WAIT_MS,
  ): Promise<T> => {
    return runWithStoreWriteLock(async () => {
      if (typeof navigator === "undefined" || !navigator.locks?.request) {
        return operation(() => true);
      }
      let granted = false;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = new AbortController();

      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const finishResolve = (value: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const finishReject = (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        };

        timer = setTimeout(() => {
          if (granted) return;
          timedOut = true;
          abort.abort();
          finishReject(new Error("等待跨标签页凭据提交锁超时"));
        }, waitTimeoutMs);

        Promise.resolve()
          .then(
            () =>
              navigator.locks.request(
                STORE_WRITE_LOCK_NAME,
                { signal: abort.signal },
                async () => {
                  if (timedOut) {
                    throw new Error("等待跨标签页凭据提交锁超时");
                  }
                  // Stop lock-wait timer immediately upon lock grant so slow I/O
                  // or post-commit BIN cleanup never falsely reports a wait timeout.
                  granted = true;
                  clearTimeout(timer);
                  return await operation(() => !timedOut);
                },
              ) as Promise<T>,
          )
          .then(finishResolve, (error) => {
            if (timedOut) {
              finishReject(new Error("等待跨标签页凭据提交锁超时"));
              return;
            }
            finishReject(error);
          });
      });
    });
  };

  interface CredentialBinStorage {
    getArrayBuffer?: (key: string) => Promise<ArrayBuffer | null>;
    storeArrayBuffer?: (key: string, data: ArrayBuffer) => Promise<boolean>;
    deleteArrayBuffer?: (key: string) => Promise<boolean>;
  }

  interface CommitCredentialOptions {
    updates: Partial<TokenData>;
    expectedVersion?: number;
    expectedToken?: string;
    expectedCreatedAt?: string;
    binData?: ArrayBuffer | null;
    binStorage?: CredentialBinStorage;
    deleteOldBinKey?: string | null;
    closeActiveConnection?: boolean;
    lockWaitTimeoutMs?: number;
  }

  interface CommitRoleUpsertOptions {
    role: Partial<TokenData> & Pick<TokenData, "name" | "token">;
    needsBin?: boolean;
    hasValidCombUser?: boolean;
    findExisting?: (
      tokens: TokenData[],
      selectedId: string,
    ) => TokenData | null;
    binStorage?: CredentialBinStorage;
    lockWaitTimeoutMs?: number;
  }

  const readStoredCredentialVersionRaw = (tokenId: string): string | null => {
    if (typeof localStorage === "undefined" || !localStorage?.getItem) {
      return null;
    }
    try {
      return localStorage.getItem(`${CRED_VERSION_KEY_PREFIX}${tokenId}`);
    } catch {
      return null;
    }
  };

  const restoreCredentialVersionState = (
    tokenId: string,
    previousMemVersion: number | undefined,
    previousSeed: number,
    previousStoredRaw: string | null,
  ) => {
    credentialVersionSeed = previousSeed;
    if (previousMemVersion === undefined) {
      tokenCredentialVersions.delete(tokenId);
    } else {
      tokenCredentialVersions.set(tokenId, previousMemVersion);
    }
    if (typeof localStorage !== "undefined") {
      try {
        const key = `${CRED_VERSION_KEY_PREFIX}${tokenId}`;
        if (previousStoredRaw === null) {
          localStorage.removeItem?.(key);
        } else {
          localStorage.setItem?.(key, previousStoredRaw);
        }
      } catch {
        // Ignore best-effort rollback errors on secondary version key.
      }
    }
  };

  const findMatchingTokenInList = (
    tokens: TokenData[],
    role: Partial<TokenData>,
    selectedId: string,
  ): TokenData | null => {
    if (role.id) {
      const byId = tokens.find((token) => token.id === role.id);
      if (byId) return byId;
    }
    const targetRoleId = normalizeRoleId(role.roleId);
    if (!targetRoleId) return null;
    const sameRoleTokens = tokens.filter(
      (token) => normalizeRoleId(token.roleId) === targetRoleId,
    );
    if (sameRoleTokens.length === 0) return null;
    if (sameRoleTokens.length === 1) return sameRoleTokens[0] || null;
    const selectedMatch = sameRoleTokens.find(
      (token) => selectedId && token.id === selectedId,
    );
    if (selectedMatch) return selectedMatch;
    const serverMatch = sameRoleTokens.find(
      (token) => role.server && token.server === role.server,
    );
    return serverMatch || sameRoleTokens[0] || null;
  };

  const applyTokenUpdate = (
    tokenId: string,
    updates: Partial<TokenData>,
  ):
    | { ok: true; token: TokenData }
    | {
        ok: false;
        reason: "token_missing" | "storage_write_failed";
        error?: unknown;
      } => {
    syncGameTokensFromStorage();
    const index = gameTokens.value.findIndex((token) => token.id === tokenId);
    const existing = gameTokens.value[index];
    if (index === -1 || !existing) {
      return { ok: false, reason: "token_missing" };
    }

    const previousExisting = { ...existing };
    const previousMemVersion = tokenCredentialVersions.get(tokenId);
    const previousSeed = credentialVersionSeed;
    const previousStoredVer = readStoredCredentialVersionRaw(tokenId);

    const touchesCredential = Object.keys(updates).some((key) =>
      CREDENTIAL_UPDATE_KEYS.has(key),
    );
    const nextCredentialVersion = touchesCredential
      ? bumpCredentialVersion(tokenId)
      : existing.credentialVersion;
    const nextToken: TokenData = {
      ...existing,
      ...updates,
      ...(nextCredentialVersion !== undefined
        ? { credentialVersion: nextCredentialVersion }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    gameTokens.value[index] = nextToken;

    const persisted = persistGameTokensToStorage();
    if (!persisted.ok) {
      gameTokens.value[index] = previousExisting;
      restoreCredentialVersionState(
        tokenId,
        previousMemVersion,
        previousSeed,
        previousStoredVer,
      );
      return {
        ok: false,
        reason: "storage_write_failed",
        error: persisted.error,
      };
    }
    return { ok: true, token: nextToken };
  };

  const executeCredentialUpdateLocked = async (
    tokenId: string,
    options: CommitCredentialOptions,
    isActive: () => boolean,
  ) => {
    const checkCommitValidity = () => {
      if (!isActive()) {
        return { ok: false as const, stale: true, reason: "stale" as const };
      }
      syncGameTokensFromStorage();
      const latest = gameTokens.value.find((t) => t.id === tokenId);
      if (!latest) {
        return {
          ok: false as const,
          stale: false,
          reason: "token_missing" as const,
        };
      }
      if (options.expectedVersion !== undefined) {
        const { hasList, token: persisted } = readPersistedTokenState(tokenId);
        if (hasList && !persisted) {
          return {
            ok: false as const,
            stale: true,
            reason: "token_missing" as const,
          };
        }
        const versionMismatch =
          getCredentialVersion(tokenId) !== options.expectedVersion;
        const tokenMismatch =
          options.expectedToken !== undefined &&
          (latest.token !== options.expectedToken ||
            (persisted !== null && persisted.token !== options.expectedToken));
        const createdAtMismatch =
          Boolean(options.expectedCreatedAt) &&
          (latest.createdAt !== options.expectedCreatedAt ||
            (persisted !== null &&
              persisted.createdAt !== options.expectedCreatedAt));
        if (versionMismatch || tokenMismatch || createdAtMismatch) {
          return {
            ok: false as const,
            stale: true,
            reason: "stale" as const,
          };
        }
      }
      return { ok: true as const };
    };

    const initialCheck = checkCommitValidity();
    if (!initialCheck.ok) {
      return {
        committed: false,
        stale: initialCheck.stale,
        reason: initialCheck.reason,
      };
    }

    const storage: CredentialBinStorage = options.binStorage ?? {
      getArrayBuffer,
      storeArrayBuffer,
      deleteArrayBuffer,
    };
    let binWritten = false;
    let previousBin: ArrayBuffer | null = null;

    const rollbackBin = async (): Promise<boolean> => {
      if (!binWritten) return true;
      syncGameTokensFromStorage();
      const { hasList, token: persisted } = readPersistedTokenState(tokenId);
      const stillExistsInMem = gameTokens.value.some((t) => t.id === tokenId);
      const stillExists = stillExistsInMem && (!hasList || persisted !== null);
      try {
        if (!stillExists) {
          if (typeof storage.deleteArrayBuffer === "function") {
            const deleted = await storage.deleteArrayBuffer(tokenId);
            return deleted !== false;
          }
          return false;
        }
        if (previousBin && typeof storage.storeArrayBuffer === "function") {
          const restored = await storage.storeArrayBuffer(tokenId, previousBin);
          return Boolean(restored);
        }
        if (typeof storage.deleteArrayBuffer === "function") {
          const deleted = await storage.deleteArrayBuffer(tokenId);
          return deleted !== false;
        }
        return false;
      } catch (rollbackError) {
        wsLogger.error(`回滚旧 BIN 凭据失败 [${tokenId}]:`, rollbackError);
        return false;
      }
    };

    if (options.binData) {
      if (
        typeof storage.getArrayBuffer !== "function" ||
        typeof storage.storeArrayBuffer !== "function"
      ) {
        return {
          committed: false,
          stale: false,
          reason: "bin_write_failed" as const,
          binRolledBack: true,
        };
      }
      previousBin = await storage.getArrayBuffer(tokenId);
      const beforeWriteCheck = checkCommitValidity();
      if (!beforeWriteCheck.ok) {
        return {
          committed: false,
          stale: beforeWriteCheck.stale,
          reason: beforeWriteCheck.reason,
          binRolledBack: true,
        };
      }
      const saved = await storage.storeArrayBuffer(tokenId, options.binData);
      if (!saved) {
        return {
          committed: false,
          stale: false,
          reason: "bin_write_failed" as const,
          binRolledBack: true,
        };
      }
      binWritten = true;

      // Re-verify credential version right before committing token metadata
      // in case a concurrent write updated or deleted the token during IndexedDB I/O.
      const afterWriteCheck = checkCommitValidity();
      if (!afterWriteCheck.ok) {
        const binRolledBack = await rollbackBin();
        return {
          committed: false,
          stale: afterWriteCheck.stale,
          reason: afterWriteCheck.reason,
          binRolledBack,
        };
      }
    }

    const applyResult = applyTokenUpdate(tokenId, options.updates);
    if (!applyResult.ok) {
      const binRolledBack = await rollbackBin();
      return {
        committed: false,
        stale: false,
        reason: applyResult.reason,
        binRolledBack,
        ...(applyResult.reason === "storage_write_failed"
          ? { error: applyResult.error }
          : {}),
      };
    }

    if (
      options.deleteOldBinKey &&
      options.deleteOldBinKey !== tokenId &&
      typeof storage.deleteArrayBuffer === "function"
    ) {
      try {
        await storage.deleteArrayBuffer(options.deleteOldBinKey);
      } catch (cleanupError) {
        wsLogger.warn(
          `清理旧 BIN 键失败 [${options.deleteOldBinKey}]:`,
          cleanupError,
        );
      }
    }

    if (options.closeActiveConnection) {
      const status = getWebSocketStatus(tokenId);
      if (status && status !== "disconnected") {
        closeWebSocketConnection(tokenId);
      }
    }

    return {
      committed: true,
      stale: false,
      reason: null,
      token: applyResult.token,
    };
  };

  /**
   * Atomically serialize BIN writes and whole-list token persistence across
   * tabs (store-wide Web Lock + sync-from-storage merge + persistent
   * credentialVersion), re-checking version before and after async IndexedDB
   * writes.
   */
  const commitCredentialUpdate = async (
    tokenId: string,
    options: CommitCredentialOptions,
  ) => {
    return withStoreWriteLease(
      (isActive) => executeCredentialUpdateLocked(tokenId, options, isActive),
      options.lockWaitTimeoutMs,
    );
  };

  /**
   * Atomically match an imported role against the latest persisted account list
   * and either update it in place or append a new account within a single
   * store-wide cross-tab Web Lock.
   */
  const commitRoleUpsert = async (options: CommitRoleUpsertOptions) => {
    return withStoreWriteLease(async (isActive) => {
      syncGameTokensFromStorage();
      const role = options.role;
      const needsBin = Boolean(options.needsBin);
      const storage: CredentialBinStorage = options.binStorage ?? {
        getArrayBuffer,
        storeArrayBuffer,
        deleteArrayBuffer,
      };
      const existing = options.findExisting
        ? options.findExisting(gameTokens.value, selectedTokenId.value)
        : findMatchingTokenInList(
            gameTokens.value,
            role,
            selectedTokenId.value,
          );

      if (existing) {
        let freshBin: ArrayBuffer | null = null;
        let tempBinKey: string | null = null;

        if (needsBin) {
          if (
            !role.id ||
            typeof storage.getArrayBuffer !== "function" ||
            typeof storage.storeArrayBuffer !== "function"
          ) {
            return {
              committed: false,
              stale: false,
              status: "updated" as const,
              reason: "bin_storage_unavailable" as const,
            };
          }
          freshBin = await storage.getArrayBuffer(role.id);
          if (
            !freshBin ||
            (freshBin instanceof ArrayBuffer && freshBin.byteLength === 0)
          ) {
            return {
              committed: false,
              stale: false,
              status: "updated" as const,
              reason: "bin_missing" as const,
            };
          }
          if (existing.id !== role.id) {
            tempBinKey = role.id;
          }
        }

        const updates: Partial<TokenData> = {
          token: role.token,
          name: existing.name || role.name,
          server: role.server || existing.server,
          roleId: role.roleId ?? existing.roleId,
          serverId: role.serverId ?? existing.serverId,
          roleIndex: role.roleIndex ?? existing.roleIndex,
          wsUrl: role.wsUrl || existing.wsUrl,
          importMethod: role.importMethod || existing.importMethod,
          combUser: options.hasValidCombUser ? (role.combUser ?? null) : null,
          lastRefreshed: Date.now(),
          upgradedToPermanent: true,
        };

        const commit = await executeCredentialUpdateLocked(
          existing.id,
          {
            updates,
            binData: existing.id !== role.id ? freshBin : null,
            binStorage: storage,
            deleteOldBinKey: tempBinKey,
            closeActiveConnection: true,
          },
          isActive,
        );
        return {
          ...commit,
          status: "updated" as const,
          tokenId: existing.id,
        };
      }

      if (needsBin) {
        if (!role.id || typeof storage.getArrayBuffer !== "function") {
          return {
            committed: false,
            stale: false,
            status: "added" as const,
            reason: "bin_storage_unavailable" as const,
          };
        }
        const freshBin = await storage.getArrayBuffer(role.id);
        if (
          !freshBin ||
          (freshBin instanceof ArrayBuffer && freshBin.byteLength === 0)
        ) {
          return {
            committed: false,
            stale: false,
            status: "added" as const,
            reason: "bin_missing" as const,
          };
        }
      }

      const added = applyAddToken({ ...role });
      if (!added.ok) {
        return {
          committed: false,
          stale: false,
          status: "added" as const,
          reason: added.reason,
          error: added.error,
        };
      }
      return {
        committed: true,
        stale: false,
        reason: null,
        status: "added" as const,
        tokenId: added.token.id,
        token: added.token,
      };
    }, options.lockWaitTimeoutMs);
  };

  const commitNewToken = async (
    tokenData: Partial<TokenData> & Pick<TokenData, "name" | "token">,
  ) => {
    return withStoreWriteLease(async () => {
      syncGameTokensFromStorage();
      if (tokenData.id) {
        const existing = gameTokens.value.find(
          (token) => token.id === tokenData.id,
        );
        if (existing) {
          const updated = applyTokenUpdate(existing.id, tokenData);
          if (!updated.ok) {
            throw new Error("保存账号列表到本地存储失败（可能存储空间不足）");
          }
          return updated.token;
        }
      }
      const created = applyAddToken(tokenData);
      if (!created.ok) {
        throw new Error("保存账号列表到本地存储失败（可能存储空间不足）");
      }
      return created.token;
    });
  };

  const reorderTokens = async (orderedIds: string[]) => {
    return withStoreWriteLease(async () => {
      syncGameTokensFromStorage();
      const previousTokens = [...gameTokens.value];
      const byId = new Map(gameTokens.value.map((token) => [token.id, token]));
      const reordered: TokenData[] = [];
      for (const id of orderedIds) {
        const found = byId.get(id);
        if (found) {
          reordered.push(found);
          byId.delete(id);
        }
      }
      for (const remaining of byId.values()) {
        reordered.push(remaining);
      }
      gameTokens.value = reordered;
      const persisted = persistGameTokensToStorage();
      if (!persisted.ok) {
        gameTokens.value = previousTokens;
        throw new Error("保存账号顺序失败：浏览器本地存储空间不足或不可写");
      }
      return reordered;
    });
  };

  /**
   * Merge token metadata without replacing unrelated stored fields.
   * @param {string} tokenId Existing token identity.
   * @param {Partial<TokenData>} updates Fields to merge.
   * @returns {boolean} Whether the token was found and updated.
   */
  const updateToken = (tokenId: string, updates: Partial<TokenData>) => {
    return applyTokenUpdate(tokenId, updates).ok;
  };

  // A newly imported token can change, but the game role ID remains stable.
  const rememberRoleId = (tokenId: string, role: any) => {
    const roleId = role?.roleId;
    const identity = normalizeRoleId(roleId);
    if (!identity) return;
    const token = gameTokens.value.find((item) => item.id === tokenId);
    if (token && normalizeRoleId(token.roleId) !== identity)
      updateToken(tokenId, { roleId });
  };

  interface TokenDeletionResult {
    ok: boolean;
    listCleared: boolean;
    binCleared: boolean;
    retryable: boolean;
    reason: "storage_write_failed" | "bin_delete_failed" | null;
    message?: string;
  }

  /**
   * Remove token metadata, its active connection and associated persisted BIN data.
   * @param {string} tokenId Token to remove.
   * @returns {Promise<TokenDeletionResult>} Structured deletion outcome across localStorage and IndexedDB.
   */
  const removeToken = async (tokenId: string): Promise<TokenDeletionResult> => {
    const previousSelectedTokenId = selectedTokenId.value;
    const previousMemVersion = tokenCredentialVersions.get(tokenId);
    const previousSeed = credentialVersionSeed;
    const previousStoredVer = readStoredCredentialVersionRaw(tokenId);

    bumpCredentialVersion(tokenId);
    inFlightBattleVersion.delete(tokenId);

    // 如果删除的是当前选中token，先清除选中状态防止恢复定时器重启连接
    if (selectedTokenId.value === tokenId) {
      selectedTokenId.value = "";
    }
    desiredConnections.delete(tokenId);
    connectionRecovery.cancel(tokenId);

    // 关闭对应的WebSocket连接（等待异步释放锁和跨标签页状态）
    if (wsConnections.value[tokenId]) {
      await closeWebSocketConnectionAsync(tokenId);
    }

    const deletionOutcome = await withStoreWriteLease<TokenDeletionResult>(
      async () => {
        syncGameTokensFromStorage();
        const previousTokens = [...gameTokens.value];
        bumpCredentialVersion(tokenId);
        gameTokens.value = gameTokens.value.filter(
          (token) => token.id !== tokenId,
        );
        const persisted = persistGameTokensToStorage();
        if (!persisted.ok) {
          gameTokens.value = previousTokens;
          selectedTokenId.value = previousSelectedTokenId;
          restoreCredentialVersionState(
            tokenId,
            previousMemVersion,
            previousSeed,
            previousStoredVer,
          );
          return {
            ok: false,
            listCleared: false,
            binCleared: false,
            retryable: true,
            reason: "storage_write_failed",
            message:
              "删除失败：写入浏览器本地存储失败，已保留原账号与 BIN 凭据，请重试",
          };
        }

        // 同时删除IndexedDB中的数据（与凭据提交串行执行，避免旧回滚写回已删账号BIN）
        let binCleared = true;
        try {
          const deleted = await deleteArrayBuffer(tokenId);
          if (deleted === false) {
            binCleared = false;
          }
        } catch (idbError) {
          wsLogger.error(`删除账号 BIN 凭据失败 [${tokenId}]:`, idbError);
          binCleared = false;
        }

        if (!binCleared) {
          gameTokens.value = previousTokens;
          const rolledBack = persistGameTokensToStorage();
          if (rolledBack.ok) {
            selectedTokenId.value = previousSelectedTokenId;
            restoreCredentialVersionState(
              tokenId,
              previousMemVersion,
              previousSeed,
              previousStoredVer,
            );
            return {
              ok: false,
              listCleared: false,
              binCleared: false,
              retryable: true,
              reason: "bin_delete_failed",
              message:
                "删除失败：清理本地 BIN 凭据失败，已保留原账号以便关闭其他标签页后重试",
            };
          }
          gameTokens.value = previousTokens.filter(
            (token) => token.id !== tokenId,
          );
          accountGameData.remove(tokenId);
          cleanupInvalidTokens();
          return {
            ok: false,
            listCleared: true,
            binCleared: false,
            retryable: true,
            reason: "bin_delete_failed",
            message:
              "账号已从列表移除，但本地 BIN 凭据清理失败，请关闭其他标签页后点击「清除所有Token」重试",
          };
        }

        accountGameData.remove(tokenId);
        cleanupInvalidTokens();
        return {
          ok: true,
          listCleared: true,
          binCleared: true,
          retryable: false,
          reason: null,
        };
      },
    );

    if (!deletionOutcome.ok) {
      return deletionOutcome;
    }

    delete activeConnections.value[tokenId];
    Object.keys(connectionLocks.value).forEach((lockKey) => {
      if (lockKey.startsWith(`${tokenId}_`)) {
        delete connectionLocks.value[lockKey];
      }
    });
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(`ws_connection_${tokenId}`);
    }

    return deletionOutcome;
  };

  const clearChatCache = () => {
    $emit.emit?.("chat:clear");
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem?.("xyzw_chat_msg_list");
    }
  };

  const selectToken = (tokenId: string, forceReconnect = false) => {
    const token = gameTokens.value.find((t) => t.id === tokenId);
    if (!token) {
      return null;
    }

    // 检查是否已经是当前选中的token
    const isAlreadySelected = selectedTokenId.value === tokenId;
    const existingConnection = wsConnections.value[tokenId];
    const isConnected = existingConnection?.status === "connected";
    const isConnecting = existingConnection?.status === "connecting";

    tokenLogger.debug(`选择Token: ${tokenId}`, {
      isAlreadySelected,
      isConnected,
      isConnecting,
      forceReconnect,
    });

    // 更新选中状态
    selectedTokenId.value = tokenId;
    if (!isAlreadySelected) {
      clearChatCache();
    }

    // 更新最后使用时间
    updateToken(tokenId, { lastUsed: new Date().toISOString() });
    //避免点击断开链接
    if (isConnected) {
      return token;
    }
    // 智能连接判断
    const shouldCreateConnection =
      forceReconnect || // 强制重连
      !isAlreadySelected || // 首次选择此token
      !existingConnection || // 没有现有连接
      existingConnection.status === "disconnected" || // 连接已断开
      existingConnection.status === "error"; // 连接出错

    if (shouldCreateConnection) {
      if (isAlreadySelected && !forceReconnect) {
        wsLogger.info(`Token已选中但无连接，创建新连接: ${tokenId}`);
      } else if (!isAlreadySelected) {
        wsLogger.info(`切换到新Token，创建连接: ${tokenId}`);
      } else if (forceReconnect) {
        wsLogger.info(`强制重连Token: ${tokenId}`);
      }

      // 创建WebSocket连接
      createWebSocketConnection(tokenId, token.token, token.wsUrl);
    } else {
      if (isConnected) {
        wsLogger.debug(`Token已连接，跳过连接创建: ${tokenId}`);
      } else if (isConnecting) {
        wsLogger.debug(`Token连接中，跳过连接创建: ${tokenId}`);
      } else {
        wsLogger.debug(`Token已选中且有连接，跳过连接创建: ${tokenId}`);
      }
    }

    return token;
  };

  // Token刷新尝试记录
  const tokenRefreshAttempts = ref<Record<string, number>>({});

  type CredentialRefreshOutcome =
    | {
        status: "refreshed";
        method: "url" | "combUser" | "bin";
        token: TokenData | null;
      }
    | { status: "stale" }
    | { status: "unsupported" }
    | { status: "cooldown" }
    | { status: "failed"; message: string };

  const executeCredentialRefresh = async (
    tokenId: string,
    options: { respectCooldown?: boolean } = {},
  ): Promise<CredentialRefreshOutcome> => {
    if (options.respectCooldown) {
      const lastAttempt = tokenRefreshAttempts.value[tokenId] || 0;
      const now = Date.now();
      if (now - lastAttempt < 10000) {
        wsLogger.warn(`Token刷新过于频繁，跳过 [${tokenId}]`);
        return { status: "cooldown" };
      }
      tokenRefreshAttempts.value[tokenId] = now;
    }

    const gameToken = gameTokens.value.find((t) => t.id === tokenId);
    if (!gameToken) {
      return { status: "failed", message: "账号不存在" };
    }

    const startVersion = getCredentialVersion(tokenId);
    const startToken = gameToken.token;
    const startCreatedAt = gameToken.createdAt;
    const refreshInput = {
      name: gameToken.name,
      server: gameToken.server,
      importMethod: gameToken.importMethod,
      sourceUrl: gameToken.sourceUrl,
      combUser: gameToken.combUser,
      serverId: gameToken.serverId,
      roleIndex: gameToken.roleIndex,
      roleId: gameToken.roleId,
    };
    const isRefreshStillCurrent = () => {
      const latest = gameTokens.value.find((t) => t.id === tokenId);
      if (!latest) return false;
      if (getCredentialVersion(tokenId) !== startVersion) return false;
      if (latest.token !== startToken) return false;
      if (startCreatedAt && latest.createdAt !== startCreatedAt) return false;
      const { hasList, token: persisted } = readPersistedTokenState(tokenId);
      if (hasList && !persisted) return false;
      if (persisted) {
        if (persisted.token !== startToken) return false;
        if (startCreatedAt && persisted.createdAt !== startCreatedAt)
          return false;
      }
      return true;
    };

    wsLogger.info(`尝试刷新Token [${tokenId}]`);

    try {
      let method: "url" | "combUser" | "bin" | null = null;
      let updates: Partial<TokenData> | null = null;
      let binData: ArrayBuffer | null = null;
      let deleteOldBinKey: string | null = null;

      if (refreshInput.importMethod === "url" && refreshInput.sourceUrl) {
        const data = await scheduleAuthUserRequest(async () => {
          return await fetchTokenPayloadFromUrl(refreshInput.sourceUrl!, {
            timeoutMs: 10000,
          });
        });
        if (!isRefreshStillCurrent()) {
          return { status: "stale" };
        }
        const token =
          typeof data?.token === "string" && data.token.trim()
            ? data.token
            : null;
        if (!token) {
          return { status: "failed", message: "返回数据中未找到有效的 token" };
        }
        method = "url";
        updates = {
          token,
          ...(typeof data.server === "string" && data.server.trim()
            ? { server: data.server }
            : {}),
          lastRefreshed: Date.now(),
        };
      } else if (
        refreshInput.combUser ||
        refreshInput.importMethod === "wxForceLogout"
      ) {
        if (!refreshInput.combUser) {
          wsLogger.error(`Token刷新失败: 未保存 combUser [${tokenId}]`);
          return {
            status: "failed",
            message: "该账号未保存 combUser，无法自动刷新",
          };
        }
        const refreshed = await refreshTokenFromCombUser(
          refreshInput.combUser as Parameters<
            typeof refreshTokenFromCombUser
          >[0],
          {
            serverId: refreshInput.serverId ?? undefined,
            roleIndex: refreshInput.roleIndex ?? undefined,
            roleId: refreshInput.roleId ?? undefined,
          },
        );
        if (!isRefreshStillCurrent()) {
          return { status: "stale" };
        }
        method = "combUser";
        updates = {
          token: refreshed.token,
          serverId: refreshed.role.serverId,
          roleId: refreshed.role.roleId,
          roleIndex: roleIndexFromServerId(refreshed.role.serverId),
          lastRefreshed: Date.now(),
        };
      } else if (
        refreshInput.importMethod === "bin" ||
        refreshInput.importMethod === "wxQrcode" ||
        refreshInput.importMethod === "mobile"
      ) {
        let userToken: ArrayBuffer | null = await getArrayBuffer(tokenId);
        let usedOldKey = false;

        if (!userToken && refreshInput.name) {
          const tokenByName = await getArrayBuffer(refreshInput.name);
          if (tokenByName) {
            userToken = tokenByName;
            usedOldKey = true;
          }
        }

        if (!userToken) {
          wsLogger.error(`Token刷新失败: 未找到BIN数据 [${tokenId}]`);
          return {
            status: "failed",
            message: "未找到该账号的本地 BIN 凭据，请重新登录",
          };
        }

        const token = await transformToken(userToken);
        if (!isRefreshStillCurrent()) {
          return { status: "stale" };
        }
        const expectedRoleId = normalizeRoleId(refreshInput.roleId);
        const authenticatedRoleId = extractRoleIdFromSessionToken(token);
        if (usedOldKey) {
          if (
            !expectedRoleId ||
            !authenticatedRoleId ||
            authenticatedRoleId !== expectedRoleId
          ) {
            wsLogger.error(
              `旧名称 BIN 角色身份核验失败 [${tokenId}] expected=${expectedRoleId ?? "unknown"} actual=${authenticatedRoleId ?? "unknown"}`,
            );
            return {
              status: "failed",
              message:
                "旧名称 BIN 与当前账号角色身份不一致或无法确认，已保留原数据，请重新登录",
            };
          }
        } else if (
          expectedRoleId &&
          authenticatedRoleId &&
          authenticatedRoleId !== expectedRoleId
        ) {
          wsLogger.error(
            `BIN 角色身份冲突 [${tokenId}] expected=${expectedRoleId} actual=${authenticatedRoleId}`,
          );
          return {
            status: "failed",
            message: "BIN 认证角色与当前账号不一致，已保留原数据，请重新登录",
          };
        }
        method = "bin";
        updates = { token, lastRefreshed: Date.now() };
        if (usedOldKey) {
          binData = userToken;
          deleteOldBinKey = refreshInput.name;
        }
      } else {
        return { status: "unsupported" };
      }

      const commit = await commitCredentialUpdate(tokenId, {
        expectedVersion: startVersion,
        expectedToken: startToken,
        expectedCreatedAt: startCreatedAt,
        updates: updates!,
        binData,
        deleteOldBinKey,
      });

      if (commit.stale) {
        wsLogger.info(
          `Token刷新结果已过期（账号凭据已更新），忽略旧结果 [${tokenId}]`,
        );
        return { status: "stale" };
      }
      if (!commit.committed) {
        if (commit.binRolledBack === false) {
          return {
            status: "failed",
            message:
              commit.reason === "storage_write_failed"
                ? "保存账号列表到本地存储失败，且恢复旧 BIN 凭据失败（本地凭据可能不一致），请重新登录"
                : "更新账号凭据失败，且恢复旧 BIN 凭据失败（本地凭据可能不一致），请重新登录",
          };
        }
        return {
          status: "failed",
          message:
            commit.reason === "bin_write_failed"
              ? "迁移本地 BIN 凭据失败，已保留原凭据"
              : commit.reason === "storage_write_failed"
                ? "保存账号列表到本地存储失败（可能存储空间不足），已保留原凭据"
                : "更新账号凭据失败",
        };
      }
      return {
        status: "refreshed",
        method: method!,
        token: commit.token ?? null,
      };
    } catch (error) {
      wsLogger.error(`Token刷新过程出错 [${tokenId}]:`, error);
      if (!isRefreshStillCurrent()) {
        return { status: "stale" };
      }
      return {
        status: "failed",
        message: getErrorMessage(error) || "Token刷新失败",
      };
    }
  };

  // 手动刷新入口（与自动刷新、扫码导入共用同一凭据版本校验与串行锁）
  const refreshTokenManually = async (tokenId: string) => {
    return executeCredentialRefresh(tokenId, { respectCooldown: false });
  };

  // 尝试自动刷新Token
  const attemptTokenRefresh = async (
    tokenId: string,
    forceReconnect = false,
    deferReconnect = false,
  ) => {
    const outcome = await executeCredentialRefresh(tokenId, {
      respectCooldown: true,
    });

    if (outcome.status === "cooldown" || outcome.status === "stale") {
      return false;
    }

    if (outcome.status === "refreshed") {
      wsLogger.info(`Token刷新成功 [${tokenId}]`);

      const currentPath = router.currentRoute.value.path;
      const shouldReconnect =
        forceReconnect ||
        currentPath === "/tokens" ||
        currentPath === "/admin/game-features";

      if (
        shouldReconnect &&
        !deferReconnect &&
        selectedTokenId.value === tokenId &&
        desiredConnections.has(tokenId) &&
        gameTokens.value.some((t) => t.id === tokenId)
      ) {
        wsLogger.info(`触发自动重连 [${tokenId}]`);
        if (wsConnections.value[tokenId]) {
          wsConnections.value[tokenId].reconnectAttempts = 0;
        }
        selectToken(tokenId, true);
      }
      return true;
    }

    if (wsConnections.value[tokenId]) {
      wsConnections.value[tokenId].lastError = {
        timestamp: new Date().toISOString(),
        error: "登录凭据已失效，请前往账号管理重新登录",
      };
    }
    wsLogger.error(`Token刷新失败，请手动重新导入 [${tokenId}]`);
    return false;
  };

  // 游戏消息处理
  const handleGameMessage = async (
    tokenId: string,
    message: ProtoMsg,
    client: any,
  ) => {
    try {
      if (!message) {
        gameLogger.warn(`消息处理跳过 [${tokenId}]: 无效消息`);
        return;
      }
      if (message.error) {
        const errText = String(message.error).toLowerCase();
        gameLogger.warn(`消息处理跳过 [${tokenId}]:`, message.error);
        if (errText.includes("token") && errText.includes("expired")) {
          const conn = wsConnections.value[tokenId];
          if (conn) {
            conn.status = "error";
            conn.lastError = {
              timestamp: new Date().toISOString(),
              error: "token expired",
            };
          }

          const gameToken = gameTokens.value.find((t) => t.id === tokenId);
          if (gameToken) {
            // Treat token refresh as recovery, including when the network
            // response hangs; never replay the interrupted game command.
            connectionRecovery.schedule(tokenId, { delayMs: 15000 });
            const refreshed = await attemptTokenRefresh(tokenId, true, true);
            if (
              wsConnections.value[tokenId] === conn &&
              shouldKeepRecovering(tokenId)
            ) {
              connectionRecovery.schedule(tokenId, {
                reset: true,
                immediate: true,
              });
            }
            if (!refreshed) {
              wsLogger.error(
                `Token 已过期且无法自动刷新，请重新导入 [${tokenId}]`,
              );
            }
          }
        }
        return;
      }

      const cmd = message.cmd?.toLowerCase();
      const body = message.getData() as
        { role?: { roleId?: string | number; headImg?: string } } | undefined;

      if (cmd === "role_getroleinforesp") {
        syncRandomSeedFromStatistics(tokenId, body, client);
        rememberRoleId(tokenId, body?.role);

        // 更新头像
        if (body?.role?.headImg) {
          const token = gameTokens.value.find((t) => t.id === tokenId);
          if (token && token.avatar !== body.role.headImg) {
            updateToken(tokenId, { avatar: body.role.headImg });
            wsLogger.debug(`更新头像 [${tokenId}]: ${body.role.headImg}`);
          }
        }
      }

      emitPlus(cmd, {
        tokenId,
        isSelectedAccount: tokenId === selectedTokenId.value,
        body,
        message,
        client,
        gameData: accountGameData.forToken(tokenId),
      });

      gameLogger.gameMessage(tokenId, cmd, !!body);
    } catch (error) {
      gameLogger.error(`处理消息失败 [${tokenId}]:`, error);
    }
  };

  // 验证token有效性
  const validateToken = (token: any) => {
    if (!token) return false;
    if (typeof token !== "string") return false;
    if (token.trim().length === 0) return false;
    // 简单检查：token应该至少有一定长度
    if (token.trim().length < 10) return false;
    return true;
  };

  // Base64解析功能（增强版）
  const parseBase64Token = (base64String: string) => {
    try {
      // 输入验证
      if (!base64String || typeof base64String !== "string") {
        throw new Error("Token字符串无效");
      }

      // 移除可能的前缀和空格
      const cleanBase64 = base64String.replace(/^data:.*base64,/, "").trim();

      if (cleanBase64.length === 0) {
        throw new Error("Token字符串为空");
      }

      // 解码base64
      let decoded;
      try {
        decoded = atob(cleanBase64);
      } catch (decodeError) {
        // 如果不是有效的Base64，作为纯文本token处理
        decoded = base64String.trim();
      }

      // 尝试解析为JSON
      let tokenData;
      try {
        tokenData = JSON.parse(decoded);
      } catch {
        // 不是JSON格式，作为纯token处理
        tokenData = { token: decoded };
      }

      // 提取实际token
      const actualToken = tokenData.token || tokenData.gameToken || decoded;

      // 验证token有效性
      if (!validateToken(actualToken)) {
        throw new Error("提取的Token无效");
      }

      return {
        success: true,
        data: {
          ...tokenData,
          actualToken, // 添加提取出的实际token
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `解析失败：${getErrorMessage(error)}`,
      };
    }
  };

  const importBase64Token = (
    name: string,
    base64String: string,
    additionalInfo = {},
  ) => {
    const parseResult = parseBase64Token(base64String);

    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error,
        message: `Token "${name}" 导入失败: ${parseResult.error}`,
      };
    }

    const tokenData = {
      name,
      token: parseResult.data.actualToken, // 使用验证过的实际token
      ...additionalInfo,
      ...parseResult.data, // 解析出的数据覆盖手动输入
    };

    try {
      const newToken = addToken(tokenData);

      // 添加更多验证信息到成功消息
      const tokenInfo = parseResult.data.actualToken;
      const displayToken =
        tokenInfo.length > 20
          ? `${tokenInfo.substring(0, 10)}...${tokenInfo.substring(tokenInfo.length - 6)}`
          : tokenInfo;

      return {
        success: true,
        token: newToken,
        tokenName: name,
        message: `Token "${name}" 导入成功`,
        details: `实际Token: ${displayToken}`,
      };
    } catch (error) {
      const messageText = getErrorMessage(error);
      return {
        success: false,
        error: messageText,
        message: `Token "${name}" 添加失败: ${messageText}`,
      };
    }
  };

  // 连接管理辅助函数
  const generateSessionId = () =>
    `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const currentSessionId = generateSessionId();

  // 获取连接锁
  const acquireConnectionLock = async (
    tokenId: string,
    operation: ConnectLock["operation"] = "connect",
  ) => {
    const lockKey = `${tokenId}_${operation}`;
    const connect = connectionLocks.value;
    if (connect[lockKey]) {
      wsLogger.debug(`等待连接锁释放: ${tokenId} (${operation})`);
      // 等待现有操作完成，最多等待10秒
      let attempts = 0;
      while (connect[lockKey] && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
      if (connect[lockKey]) {
        wsLogger.warn(`连接锁等待超时: ${tokenId} (${operation})`);
        return false;
      }
    }
    connect[lockKey] = {
      tokenId,
      operation,
      timestamp: Date.now(),
      sessionId: currentSessionId,
    };
    wsLogger.connectionLock(tokenId, operation, true);
    return true;
  };

  // 释放连接锁
  const releaseConnectionLock = (tokenId: string, operation = "connect") => {
    const lockKey = `${tokenId}_${operation}`;
    if (connectionLocks.value[lockKey]) {
      delete connectionLocks.value[lockKey];
      wsLogger.connectionLock(tokenId, operation, false);
    }
  };

  // 更新跨标签页连接状态
  const updateCrossTabConnectionState = (
    tokenId: string,
    action: string,
    sessionId: string = currentSessionId,
  ) => {
    const key = `ws_connection_${tokenId}`;
    try {
      const previous = JSON.parse(localStorage.getItem(key) || "null");
      if (
        ["disconnecting", "disconnected"].includes(action) &&
        previous &&
        previous.sessionId !== sessionId
      )
        return;
      const state = { action, sessionId, timestamp: Date.now() };
      localStorage.setItem(key, JSON.stringify(state));
      if (activeConnections.value) activeConnections.value[tokenId] = state;
    } catch (error) {
      wsLogger.warn("更新跨标签页连接状态失败", error);
    }
  };

  // 检查是否有其他标签页的活跃连接
  const checkCrossTabConnection = (tokenId: string) => {
    const storageKey = `ws_connection_${tokenId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const state = JSON.parse(stored);
        // Heartbeats renew the owner's lease; allow slack for background timer delays.
        const isRecent = Date.now() - state.timestamp < 120000;
        const isDifferentSession = state.sessionId !== currentSessionId;

        if (
          isRecent &&
          isDifferentSession &&
          (state.action === "connecting" || state.action === "connected")
        ) {
          wsLogger.debug(`检测到其他标签页的活跃连接: ${tokenId}`);
          return state;
        }
      }
    } catch (error) {
      wsLogger.warn("检查跨标签页连接状态失败:", error);
    }
    return null;
  };
  const isConnectionActiveInAnotherTab = (tokenId: string) =>
    Boolean(checkCrossTabConnection(tokenId));

  // A background tab can hold a Web Lock indefinitely. Stop waiting and
  // invalidate any callback that resumes after the deadline.
  const withConnectionLease = async <T>(
    tokenId: string,
    operation: (isActive: () => boolean) => T | Promise<T>,
  ): Promise<T> => {
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      return operation(() => true);
    }
    let active = true;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        active = false;
        timedOut = true;
        reject(new ConnectionLeaseTimeoutError());
        abort.abort();
      }, 10000);
    });
    try {
      return await Promise.race([
        navigator.locks.request(
          `xyzw-websocket:${tokenId}`,
          { signal: abort.signal },
          () => {
            if (!active) throw new ConnectionLeaseTimeoutError();
            return operation(() => active);
          },
        ),
        deadline,
      ]);
    } catch (error) {
      if (timedOut) throw new ConnectionLeaseTimeoutError();
      throw error;
    } finally {
      active = false;
      clearTimeout(timer);
    }
  };

  let monitorTimer: ReturnType<typeof setInterval> | null = null;
  let storageListener: ((event: StorageEvent) => void) | null = null;
  let tokenStoreInitialized = false;

  // Only the currently selected account is restored after an unexpected close.
  const desiredConnections = new Set<string>();
  const connectionGeneration = new Map<string, number>();
  const connectionRecoveryStatus = ref<Record<string, string>>({});
  const shouldKeepRecovering = (tokenId: string) => {
    const status = wsConnections.value[tokenId]?.status;
    return (
      desiredConnections.has(tokenId) &&
      selectedTokenId.value === tokenId &&
      gameTokens.value.some((token) => token.id === tokenId) &&
      status !== "connected" &&
      status !== "disconnecting"
    );
  };
  const connectionRecovery = createConnectionRecovery({
    shouldKeepTrying: shouldKeepRecovering,
    canRecover: (tokenId: string) => {
      const connection = wsConnections.value[tokenId];
      return (
        shouldKeepRecovering(tokenId) &&
        (typeof navigator === "undefined" || navigator.onLine !== false) &&
        !["connected", "connecting", "disconnecting"].includes(
          connection?.status || "",
        ) &&
        !checkCrossTabConnection(tokenId)
      );
    },
    reconnect: (tokenId: string) => {
      const token = gameTokens.value.find((entry) => entry.id === tokenId);
      if (!token) return null;
      return createWebSocketConnection(tokenId, token.token, token.wsUrl, true);
    },
    onState: (tokenId: string, state: string) => {
      if (state === "stopped") delete connectionRecoveryStatus.value[tokenId];
      else connectionRecoveryStatus.value[tokenId] = state;
    },
  });
  watch(
    selectedTokenId,
    (current, previous) => {
      if (previous && current !== previous) {
        connectionGeneration.set(
          previous,
          (connectionGeneration.get(previous) || 0) + 1,
        );
        connectionRecovery.cancel(previous);
      }
    },
    { flush: "sync" },
  );

  const restoreSelectedConnection = () => {
    const tokenId = selectedTokenId.value;
    if (!tokenId || !desiredConnections.has(tokenId)) return;
    const connection = wsConnections.value[tokenId];
    if (connection?.status === "connected") {
      try {
        connection.client?.sendHeartbeat();
      } catch (error) {
        wsLogger.warn("恢复页面时发送心跳失败", error);
      }
    } else {
      connectionRecovery.schedule(tokenId, { reset: true, immediate: true });
    }
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") restoreSelectedConnection();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", restoreSelectedConnection);
  }
  onScopeDispose(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("online", restoreSelectedConnection);
      if (storageListener) {
        window.removeEventListener("storage", storageListener);
        storageListener = null;
      }
    }
    connectionMonitor.stopMonitoring();
    connectionRecovery.dispose();
    tokenStoreInitialized = false;
    rateLimiterCallbackRegistered = false;
  });

  // WebSocket连接管理（重构版 - 防重连）
  const createWebSocketConnection = async (
    tokenId: string,
    base64Token: string,
    customWsUrl: string | null = null,
    fromRecovery = false,
  ) => {
    wsLogger.info(`开始创建连接: ${tokenId}`);
    const generation = connectionGeneration.get(tokenId) || 0;
    if (!fromRecovery && selectedTokenId.value === tokenId) {
      desiredConnections.add(tokenId);
    }

    // Another caller may already be creating or using this account's client.
    // Returning no client also prevents batch tasks from claiming ownership.
    const hasLiveClient = () =>
      Boolean(
        wsConnections.value[tokenId]?.client &&
        ["connected", "connecting"].includes(
          wsConnections.value[tokenId]?.status || "",
        ),
      );
    if (hasLiveClient()) return null;

    // 1. 获取连接锁，防止竞态条件
    const lockAcquired = await acquireConnectionLock(tokenId, "connect");
    if (!lockAcquired) {
      wsLogger.error(`无法获取连接锁: ${tokenId}`);
      return null;
    }

    try {
      // A previous request can finish while this caller waits for the lock.
      if (hasLiveClient()) {
        releaseConnectionLock(tokenId, "connect");
        return null;
      }
      if (
        fromRecovery &&
        (!desiredConnections.has(tokenId) || selectedTokenId.value !== tokenId)
      ) {
        releaseConnectionLock(tokenId, "connect");
        return null;
      }
      // Atomically claim the per-account lease across upgraded tabs. Keep the
      // existing fallback for browsers without Web Locks; those cannot offer
      // the same cross-tab guarantee.
      const claimConnection = async (isActive: () => boolean) => {
        if (
          !isActive() ||
          (connectionGeneration.get(tokenId) || 0) !== generation
        )
          return false;
        if (checkCrossTabConnection(tokenId)) return false;
        const previousConnection = wsConnections.value[tokenId];
        if (previousConnection) {
          wsLogger.debug(`优雅关闭现有连接: ${tokenId}`);
          await closeWebSocketConnectionAsync(
            tokenId,
            true,
            previousConnection,
          );
        }
        if (!isActive()) {
          if (
            (connectionGeneration.get(tokenId) || 0) === generation &&
            shouldKeepRecovering(tokenId)
          ) {
            connectionRecovery.schedule(tokenId, {
              reset: true,
              immediate: true,
            });
          }
          return false;
        }
        if (
          (connectionGeneration.get(tokenId) || 0) !== generation ||
          (fromRecovery &&
            (!desiredConnections.has(tokenId) ||
              selectedTokenId.value !== tokenId))
        )
          return false;
        if (checkCrossTabConnection(tokenId)) return false;
        updateCrossTabConnectionState(tokenId, "connecting");
        return true;
      };
      const claimed = await withConnectionLease(tokenId, claimConnection);
      if (
        !claimed ||
        (connectionGeneration.get(tokenId) || 0) !== generation ||
        (fromRecovery &&
          (!desiredConnections.has(tokenId) ||
            selectedTokenId.value !== tokenId))
      ) {
        if (claimed) updateCrossTabConnectionState(tokenId, "disconnected");
        wsLogger.debug(
          `跳过创建，其他标签页已有连接或本次恢复已取消: ${tokenId}`,
        );
        releaseConnectionLock(tokenId, "connect");
        if (
          !fromRecovery &&
          (connectionGeneration.get(tokenId) || 0) === generation &&
          checkCrossTabConnection(tokenId) &&
          shouldKeepRecovering(tokenId)
        ) {
          setupCrossTabListener();
          connectionRecovery.schedule(tokenId);
        }
        return null;
      }

      // 5. 解析token
      const parseResult = parseBase64Token(base64Token);
      let actualToken;
      if (parseResult.success) {
        actualToken = parseResult.data.actualToken;
      } else {
        if (validateToken(base64Token)) {
          actualToken = base64Token;
        } else {
          throw new Error(`Token无效: ${parseResult.error}`);
        }
      }
      // 6. 构建WebSocket URL
      const baseWsUrl = `wss://xxz-xyzw.hortorgames.com/agent?p=${encodeURIComponent(actualToken)}&e=x&lang=chinese`;

      const wsUrl = customWsUrl || baseWsUrl;
      const safeWsUrl = wsUrl.split("?")[0];

      // 7. 创建新的WebSocket客户端（增强版）
      const wsClient = new XyzwWebSocketClient({
        url: wsUrl,
        utils: g_utils,
        heartbeatMs: 5000,
      });

      // 8. 设置连接状态（带会话ID）
      wsConnections.value[tokenId] = {
        client: wsClient,
        status: "connecting",
        tokenId,
        wsUrl: safeWsUrl,
        actualToken,
        sessionId: currentSessionId,
        connectedAt: null,
        lastMessage: null,
        lastError: null,
        reconnectAttempts: 0,
        randomSeedSynced: false,
        lastRandomSeedSource: null,
        lastRandomSeed: null,
      };

      // Capture the reactive record: an older client's callbacks must not update its replacement.
      const connection = wsConnections.value[tokenId];
      const isCurrentConnection = () =>
        Boolean(connection && wsConnections.value[tokenId] === connection);
      let established = false;
      let discardingStale = false;
      const isStaleAttempt = () =>
        !established &&
        ((connectionGeneration.get(tokenId) || 0) !== generation ||
          (fromRecovery &&
            (!desiredConnections.has(tokenId) ||
              selectedTokenId.value !== tokenId)));
      const discardStaleConnection = () => {
        if (discardingStale) return;
        discardingStale = true;
        releaseConnectionLock(tokenId, "connect");
        closeWebSocketConnectionAsync(tokenId, true, connection).then(() => {
          if (!wsConnections.value[tokenId] && shouldKeepRecovering(tokenId))
            connectionRecovery.schedule(tokenId, {
              reset: true,
              immediate: true,
            });
        });
      };

      // 9. 设置事件监听（增强版）
      wsClient.onConnect = () => {
        const finishHandshake = () => {
          if (!isCurrentConnection() || connection?.status !== "connecting")
            return;
          if (isStaleAttempt() || discardingStale) {
            discardStaleConnection();
            return;
          }
          // A different tab may have taken over while this handshake was
          // frozen. Do not overwrite its lease or send initialization commands.
          let ownsLease = false;
          try {
            const owner = JSON.parse(
              localStorage.getItem(`ws_connection_${tokenId}`) || "null",
            );
            ownsLease =
              owner?.sessionId === currentSessionId &&
              owner.action === "connecting";
          } catch (error) {
            wsLogger.warn("无法核验跨标签页连接归属", error);
          }
          if (!ownsLease) {
            discardStaleConnection();
            return;
          }
          established = true;
          wsLogger.wsConnect(tokenId);
          if (wsConnections.value[tokenId]) {
            wsConnections.value[tokenId].status = "connected";
            wsConnections.value[tokenId].connectedAt = new Date().toISOString();
            wsConnections.value[tokenId].reconnectAttempts = 0;
            wsConnections.value[tokenId].randomSeedSynced = false;
            wsConnections.value[tokenId].lastRandomSeedSource = null;
            wsConnections.value[tokenId].lastRandomSeed = null;
          }
          updateCrossTabConnectionState(tokenId, "connected");
          if (desiredConnections.has(tokenId))
            connectionRecovery.markConnected(tokenId);
          releaseConnectionLock(tokenId, "connect");
          if (
            tokenId === selectedToken.value?.id ||
            tokenId === selectedTokenId.value
          ) {
            clearChatCache();
          }
          try {
            wsClient.send("role_getroleinfo");
          } catch (error) {
            wsLogger.warn(`初始化角色信息请求失败 [${tokenId}]`, error);
          }
        };
        // Serialize the final lease check/write with claims from other new tabs.
        withConnectionLease(tokenId, (isActive) => {
          if (isActive()) finishHandshake();
        }).catch(() => {
          if (isCurrentConnection()) discardStaleConnection();
        });
      };

      wsClient.onHeartbeat = () => {
        if (!isCurrentConnection() || connection?.status !== "connected")
          return;
        try {
          const key = `ws_connection_${tokenId}`;
          const owner = JSON.parse(localStorage.getItem(key) || "null");
          if (
            owner?.sessionId &&
            owner.sessionId !== currentSessionId &&
            owner.action === "connected" &&
            Date.now() - owner.timestamp < 120000
          ) {
            // A suspended page can miss a storage event while another tab
            // takes over. Relinquish the stale client without rewriting its lease.
            closeWebSocketConnection(tokenId);
            return;
          }
          if (
            owner?.sessionId === currentSessionId &&
            owner.action === "connected" &&
            Date.now() - owner.timestamp >= 10000
          )
            updateCrossTabConnectionState(tokenId, "connected");
        } catch (error) {
          wsLogger.warn("续期跨标签页连接状态失败", error);
        }
      };

      wsClient.onDisconnect = async (event: {
        code?: number;
        reason?: string;
      }) => {
        if (!isCurrentConnection()) return;
        if (isStaleAttempt() || discardingStale) {
          discardStaleConnection();
          return;
        }
        const reason = event.code === 1006 ? "异常断开" : event.reason || "";
        wsLogger.wsDisconnect(tokenId, reason);
        releaseConnectionLock(tokenId, "connect");
        if (wsConnections.value[tokenId]) {
          const conn = wsConnections.value[tokenId];
          const wasDisconnecting = conn.status === "disconnecting";
          conn.status = "disconnected";
          conn.randomSeedSynced = false;
          updateCrossTabConnectionState(tokenId, "disconnected");

          // 如果连接异常断开(1006)且从未连接成功(握手失败)，尝试刷新Token
          // connectedAt 为 null 表示 socket.onopen 还没触发就断开了，通常意味着握手失败（如403 Forbidden）
          if (
            event.code === 1006 &&
            !conn.connectedAt &&
            !wasDisconnecting &&
            desiredConnections.has(tokenId) &&
            selectedTokenId.value === tokenId
          ) {
            wsLogger.warn(`检测到握手失败(1006)，尝试刷新Token [${tokenId}]`);
            // Mark this as recovery before refreshing. If refresh hangs, the
            // watchdog resumes ordinary retry without replaying game actions.
            connectionRecovery.schedule(tokenId, { delayMs: 15000 });
            await attemptTokenRefresh(tokenId, true, true);
            if (isCurrentConnection() && shouldKeepRecovering(tokenId)) {
              connectionRecovery.schedule(tokenId, {
                reset: true,
                immediate: true,
              });
            }
            return;
          }
          if (!wasDisconnecting && isCurrentConnection()) {
            connectionRecovery.schedule(tokenId);
          }
        }
      };

      wsClient.onError = (error: unknown) => {
        if (!isCurrentConnection()) return;
        if (isStaleAttempt() || discardingStale) {
          discardStaleConnection();
          return;
        }
        wsLogger.wsError(tokenId, error);
        if (wsConnections.value[tokenId]) {
          wsConnections.value[tokenId].status = "error";
          wsConnections.value[tokenId].lastError = {
            timestamp: new Date().toISOString(),
            error: getErrorMessage(error),
            url: safeWsUrl,
          };
        }
        releaseConnectionLock(tokenId, "connect");
      };

      // 10. 设置消息监听
      wsClient.setMessageListener((message: ProtoMsg) => {
        if (!isCurrentConnection()) return;
        if (isStaleAttempt() || discardingStale) {
          discardStaleConnection();
          return;
        }
        const cmd = message?.cmd || "unknown";
        wsLogger.wsMessage(tokenId, cmd, true);

        if (wsConnections.value[tokenId]) {
          wsConnections.value[tokenId].lastMessage = {
            timestamp: new Date().toISOString(),
            data: message,
            cmd: message?.cmd,
          };
          handleGameMessage(tokenId, message, wsClient);
        }
      });

      // 11. 初始化连接
      wsClient.init();

      wsLogger.verbose(`WebSocket客户端创建成功: ${tokenId}`);
      return wsClient;
    } catch (error) {
      wsLogger.error(`创建连接失败 [${tokenId}]:`, error);
      updateCrossTabConnectionState(tokenId, "disconnected");
      releaseConnectionLock(tokenId, "connect");
      if (
        error instanceof ConnectionLeaseTimeoutError &&
        !fromRecovery &&
        (connectionGeneration.get(tokenId) || 0) === generation &&
        shouldKeepRecovering(tokenId)
      ) {
        connectionRecovery.schedule(tokenId);
      }
      return null;
    }
  };

  /**
   * Close the current transport before replacing its connection record.
   * @param {string} tokenId Account connection to close.
   * @returns {Promise<void>} Resolves after transport closure or the five-second limit.
   */
  const closeWebSocketConnectionAsync = async (
    tokenId: string,
    preserveRecovery = false,
    expectedConnection?: Partial<WebSocketConnection>,
    expectedSocket?: unknown,
  ) => {
    const cancelRecovery = () => {
      connectionGeneration.set(
        tokenId,
        (connectionGeneration.get(tokenId) || 0) + 1,
      );
      desiredConnections.delete(tokenId);
      connectionRecovery.cancel(tokenId);
    };
    if (!preserveRecovery && !expectedConnection) cancelRecovery();
    const lockAcquired = await acquireConnectionLock(tokenId, "disconnect");
    if (!lockAcquired) {
      wsLogger.warn(`无法获取断开连接锁: ${tokenId}`);
      return;
    }

    try {
      const connection = wsConnections.value[tokenId];
      if (
        expectedConnection &&
        (toRaw(connection) !== toRaw(expectedConnection) ||
          (expectedSocket !== undefined &&
            toRaw(connection?.client?.socket ?? null) !==
              toRaw(expectedSocket)))
      )
        return;
      if (!preserveRecovery && expectedConnection) cancelRecovery();
      if (connection && connection.client) {
        wsLogger.debug(`开始优雅关闭连接: ${tokenId}`);

        connection.status = "disconnecting";
        updateCrossTabConnectionState(tokenId, "disconnecting");

        // disconnect() clears client.socket immediately, before the native close event.
        const socket = connection.client.socket;
        connection.client.disconnect();

        // 等待连接完全关闭
        await new Promise<void>((resolve) => {
          let pollTimer: ReturnType<typeof setTimeout> | undefined;
          const finish = () => {
            clearTimeout(timeoutTimer);
            clearTimeout(pollTimer);
            resolve();
          };
          const timeoutTimer = setTimeout(finish, 5000);
          const checkDisconnected = () => {
            if (!socket || socket.readyState === WebSocket.CLOSED) {
              finish();
            } else {
              pollTimer = setTimeout(checkDisconnected, 100);
            }
          };
          checkDisconnected();
        });

        if (wsConnections.value[tokenId] === connection) {
          delete wsConnections.value[tokenId];
          inFlightBattleVersion.delete(tokenId);
          updateCrossTabConnectionState(tokenId, "disconnected");
        }
        wsLogger.info(`连接已优雅关闭: ${tokenId}`);
      }
    } catch (error) {
      wsLogger.error(`关闭连接失败 [${tokenId}]:`, error);
    } finally {
      releaseConnectionLock(tokenId, "disconnect");
    }
  };

  // 同步版本的关闭连接（保持向后兼容）
  const closeWebSocketConnection = (tokenId: string) => {
    closeWebSocketConnectionAsync(tokenId).catch((error) => {
      wsLogger.error(`关闭连接异步操作失败 [${tokenId}]:`, error);
    });
  };

  // A batch task may close only the transport it created, even after waiting
  // for another disconnect to finish.
  const closeWebSocketConnectionIfCurrent = (
    tokenId: string,
    expectedClient: XyzwWebSocketClient,
    expectedSocket: unknown,
  ) => {
    const connection = wsConnections.value[tokenId];
    if (
      !connection ||
      toRaw(connection.client) !== toRaw(expectedClient) ||
      toRaw(connection.client?.socket ?? null) !== toRaw(expectedSocket)
    )
      return;
    closeWebSocketConnectionAsync(
      tokenId,
      false,
      connection,
      expectedSocket,
    ).catch((error) => {
      wsLogger.error(`关闭连接异步操作失败 [${tokenId}]:`, error);
    });
  };

  const getWebSocketStatus = (tokenId: string) => {
    return wsConnections.value[tokenId]?.status || "disconnected";
  };

  // 获取WebSocket客户端
  const getWebSocketClient = (tokenId: string) => {
    return wsConnections.value[tokenId]?.client || null;
  };

  // 设置消息监听器
  const setMessageListener = (listener: any) => {
    if (selectedToken.value) {
      const connection = wsConnections.value[selectedToken.value.id];
      if (connection && connection.client) {
        connection.client.setMessageListener(listener);
      }
    }
  };

  // 设置是否显示消息
  const setShowMsg = (show: any) => {
    if (selectedToken.value) {
      const connection = wsConnections.value[selectedToken.value.id];
      if (connection && connection.client) {
        connection.client.setShowMsg(show);
      }
    }
  };

  // 发送消息到WebSocket
  const sendMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options = {},
  ) => {
    const connection = wsConnections.value[tokenId];
    if (!connection || connection.status !== "connected") {
      wsLogger.error(`WebSocket未连接，无法发送消息 [${tokenId}]`);
      return false;
    }

    try {
      const client = connection.client;
      if (!client) {
        wsLogger.error(`WebSocket客户端不存在 [${tokenId}]`);
        return false;
      }

      client.send(cmd, params, options);
      wsLogger.wsMessage(tokenId, cmd, false);

      return true;
    } catch (error) {
      wsLogger.error(`发送失败 [${tokenId}] ${cmd}:`, getErrorMessage(error));
      return false;
    }
  };

  // Promise版发送消息
  /**
   * Attach the current battle version where required and await a protocol response.
   * @param {string} tokenId Account connection to use.
   * @param {string} cmd Registered protocol command.
   * @param {object} params Command body supplied by the caller.
   * @param {number} timeout Request timeout in milliseconds.
   * @returns {Promise<unknown>} Server response; rejects for connection or command errors.
   */
  const sendMessageWithPromise = async (
    tokenId: string,
    cmd: string,
    params = {},
    timeout = 5000,
  ) => {
    const connection = wsConnections.value[tokenId];
    if (!connection || connection.status !== "connected") {
      return Promise.reject(new Error(`WebSocket未连接 [${tokenId}]`));
    }

    const client = connection.client;
    if (!client) {
      return Promise.reject(new Error(`WebSocket客户端不存在 [${tokenId}]`));
    }

    // 为战斗相关命令自动注入 battleVersion
    const battleCommands = [
      "fight_startareaarena",
      "fight_startpvp",
      "fight_starttower",
      "fight_startboss",
      "fight_startlegionboss",
      "fight_startdungeon",
      "fight_level",
    ];
    if (battleCommands.includes(cmd)) {
      const battleVersion =
        accountGameData.forToken(tokenId).value.battleVersion;
      params = { battleVersion, ...params };
      wsLogger.info(
        `⚔️ [战斗命令] 注入 battleVersion: ${battleVersion} [${cmd}]`,
      );
    }

    try {
      const result = await client.sendWithPromise(cmd, params, timeout);

      // 特殊日志：fight_starttower 响应
      if (cmd === "fight_starttower") {
        wsLogger.info(`🗼 [咸将塔] 收到爬塔响应 [${tokenId}]:`, result);
      }

      return result;
    } catch (error) {
      // 特殊日志：fight_starttower 错误
      if (cmd === "fight_starttower") {
        wsLogger.error(
          `🗼 [咸将塔] 爬塔请求失败 [${tokenId}]:`,
          getErrorMessage(error),
        );
      }
      return Promise.reject(error);
    }
  };

  // 发送心跳消息
  const sendHeartbeat = (tokenId: string) => {
    return sendMessage(tokenId, "heart_beat");
  };

  // 发送获取角色信息请求（异步处理）
  const sendGetRoleInfo = async (
    tokenId: string,
    params = {},
    retryCount = 0,
  ) => {
    try {
      // 增加超时时间到15秒，并添加重试机制
      const timeout = 15000;
      const roleInfo = (await sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        params,
        timeout,
      )) as { role?: unknown } | undefined;

      // 手动更新游戏数据（因为响应可能不会自动触发消息处理）
      if (roleInfo) {
        rememberRoleId(tokenId, roleInfo.role);
        const accountData = accountGameData.forToken(tokenId);
        accountData.value.roleInfo = roleInfo;
        accountData.value.lastUpdated = new Date().toISOString();
        gameLogger.verbose("角色信息已通过 Promise 更新");
      }

      return roleInfo;
    } catch (error) {
      gameLogger.error(
        `获取角色信息失败 [${tokenId}]:`,
        getErrorMessage(error),
      );

      // 重试机制：最多重试2次，每次间隔1秒
      if (retryCount < 2) {
        gameLogger.info(
          `正在重试获取角色信息 [${tokenId}]，重试次数: ${retryCount + 1}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return sendGetRoleInfo(tokenId, params, retryCount + 1);
      }

      throw error;
    }
  };

  // 发送获取数据版本请求
  const sendGetDataBundleVersion = (tokenId: string, params = {}) => {
    return sendMessageWithPromise(tokenId, "system_getdatabundlever", params);
  };

  // 发送签到请求
  const sendSignIn = (tokenId: string) => {
    return sendMessageWithPromise(tokenId, "system_signinreward");
  };

  // 发送领取日常任务奖励
  const sendClaimDailyReward = (tokenId: string, rewardId = 0) => {
    return sendMessageWithPromise(tokenId, "task_claimdailyreward", {
      rewardId,
    });
  };

  // 发送获取队伍信息
  const sendGetTeamInfo = (tokenId: string, params = {}) => {
    return sendMessageWithPromise(tokenId, "presetteam_getinfo", params);
  };

  //发送消息到世界
  const sendMessageToWorld = (tokenId: string, message: string) => {
    return sendMessageWithPromise(tokenId, "system_sendchatmessage", {
      channel: 1,
      emojiId: 0,
      extra: null,
      msg: message,
      msgType: 1,
    });
  };
  //发送消息到俱乐部
  const sendMessageToLegion = (tokenId: string, message: string) => {
    return sendMessageWithPromise(tokenId, "system_sendchatmessage", {
      channel: 2,
      emojiId: 0,
      extra: null,
      msg: message,
      msgType: 1,
    });
  };

  // 发送自定义游戏消息
  const sendGameMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options: { usePromise?: boolean; timeout?: number } & Record<
      string,
      unknown
    > = {},
  ) => {
    if (options.usePromise) {
      return sendMessageWithPromise(tokenId, cmd, params, options.timeout);
    } else {
      return sendMessage(tokenId, cmd, params, options);
    }
  };

  // 获取当前塔层数
  const getCurrentTowerLevel = () => {
    try {
      // 从游戏数据中获取塔信息
      const roleInfo = gameData.value.roleInfo;
      if (!roleInfo || !roleInfo.role) {
        gameLogger.warn("角色信息不存在");
        return null;
      }

      const tower = roleInfo.role.tower;
      if (!tower) {
        gameLogger.warn("塔信息不存在");
        return null;
      }

      // 可能的塔层数字段（根据实际数据结构调整）
      const level =
        tower.level || tower.currentLevel || tower.floor || tower.stage;

      // 当前塔层数
      return level;
    } catch (error) {
      gameLogger.error("获取塔层数失败:", error);
      return null;
    }
  };

  // 获取详细塔信息
  const getTowerInfo = () => {
    try {
      const roleInfo = gameData.value.roleInfo;
      if (!roleInfo || !roleInfo.role) {
        return null;
      }

      return roleInfo.role.tower || null;
    } catch (error) {
      gameLogger.error("获取塔信息失败:", error);
      return null;
    }
  };

  // 工具方法
  const exportTokens = () => {
    return {
      tokens: gameTokens.value,
      exportedAt: new Date().toISOString(),
      version: "2.0",
    };
  };

  const importTokens = (data: any) => {
    try {
      if (data.tokens && Array.isArray(data.tokens)) {
        syncGameTokensFromStorage();
        const previousTokens = [...gameTokens.value];
        const previousIds = previousTokens.map((token) => token.id);
        gameTokens.value = data.tokens;
        const persisted = persistGameTokensToStorage();
        if (!persisted.ok) {
          gameTokens.value = previousTokens;
          return {
            success: false,
            message: "导入失败：浏览器本地存储空间不足或不可写",
          };
        }
        previousIds.forEach((id) => bumpCredentialVersion(id));
        data.tokens.forEach((token: any) => {
          if (token?.id) bumpCredentialVersion(token.id);
        });
        return {
          success: true,
          message: `成功导入 ${data.tokens.length} 个Token`,
        };
      } else {
        return { success: false, message: "导入数据格式错误" };
      }
    } catch (error) {
      return { success: false, message: `导入失败：${getErrorMessage(error)}` };
    }
  };

  const commitImportTokens = async (data: any) => {
    return withStoreWriteLease(async () => importTokens(data));
  };

  const clearAllTokens = async (): Promise<TokenDeletionResult> => {
    const previousSelectedTokenId = selectedTokenId.value;
    const initialTokenIds = Array.from(
      new Set([
        ...Object.keys(wsConnections.value),
        ...gameTokens.value.map((token) => token.id),
      ]),
    );
    const previousSeed = credentialVersionSeed;
    const previousVersionSnapshots = new Map<
      string,
      { mem: number | undefined; stored: string | null }
    >();
    initialTokenIds.forEach((tokenId) => {
      previousVersionSnapshots.set(tokenId, {
        mem: tokenCredentialVersions.get(tokenId),
        stored: readStoredCredentialVersionRaw(tokenId),
      });
    });

    desiredConnections.clear();
    inFlightBattleVersion.clear();
    initialTokenIds.forEach((tokenId) => {
      bumpCredentialVersion(tokenId);
    });
    Object.keys(connectionRecoveryStatus.value).forEach((tokenId) => {
      connectionRecovery.cancel(tokenId);
    });
    initialTokenIds.forEach((tokenId) => {
      connectionRecovery.cancel(tokenId);
    });

    selectedTokenId.value = "";
    await Promise.all(
      Object.keys(wsConnections.value).map((tokenId) =>
        closeWebSocketConnectionAsync(tokenId),
      ),
    );

    let tokenIds = initialTokenIds;
    const clearOutcome = await withStoreWriteLease<TokenDeletionResult>(
      async () => {
        syncGameTokensFromStorage();
        const previousTokens = [...gameTokens.value];
        const previousGroups = tokenGroups.value.map((group) => ({
          ...group,
          tokenIds: [...group.tokenIds],
        }));
        tokenIds = Array.from(
          new Set([
            ...initialTokenIds,
            ...gameTokens.value.map((token) => token.id),
          ]),
        );
        tokenIds.forEach((tokenId) => {
          if (!previousVersionSnapshots.has(tokenId)) {
            previousVersionSnapshots.set(tokenId, {
              mem: tokenCredentialVersions.get(tokenId),
              stored: readStoredCredentialVersionRaw(tokenId),
            });
          }
          bumpCredentialVersion(tokenId);
        });
        const restoreAllVersions = () => {
          previousVersionSnapshots.forEach((snap, tokenId) => {
            restoreCredentialVersionState(
              tokenId,
              snap.mem,
              previousSeed,
              snap.stored,
            );
          });
        };

        gameTokens.value = [];
        const persisted = persistGameTokensToStorage();
        if (!persisted.ok) {
          gameTokens.value = previousTokens;
          tokenGroups.value = previousGroups;
          selectedTokenId.value = previousSelectedTokenId;
          restoreAllVersions();
          return {
            ok: false,
            listCleared: false,
            binCleared: false,
            retryable: true,
            reason: "storage_write_failed",
            message:
              "清除失败：写入浏览器本地存储失败，已保留原有账号与 BIN 凭据，请重试",
          };
        }

        // 清空IndexedDB（与凭据提交串行执行，且仅在账号列表成功清空后执行）
        let binCleared = true;
        try {
          const cleared = await clearAll();
          if (cleared === false) {
            binCleared = false;
          }
        } catch (idbError) {
          wsLogger.error("清空 IndexedDB BIN 凭据失败:", idbError);
          binCleared = false;
        }

        if (!binCleared) {
          gameTokens.value = previousTokens;
          const rolledBack = persistGameTokensToStorage();
          if (rolledBack.ok) {
            tokenGroups.value = previousGroups;
            selectedTokenId.value = previousSelectedTokenId;
            restoreAllVersions();
            return {
              ok: false,
              listCleared: false,
              binCleared: false,
              retryable: true,
              reason: "bin_delete_failed",
              message:
                "清除失败：清空本地 BIN 凭据失败，已保留原有账号列表，请关闭其他标签页后重试",
            };
          }
          gameTokens.value = [];
          tokenGroups.value = [];
          connectionLocks.value = {};
          activeConnections.value = {};
          accountGameData.clear();
          return {
            ok: false,
            listCleared: true,
            binCleared: false,
            retryable: true,
            reason: "bin_delete_failed",
            message:
              "账号列表已清空，但本地 BIN 凭据清理失败，请关闭其他标签页后重新点击「清除所有Token」重试",
          };
        }

        tokenGroups.value = [];
        connectionLocks.value = {};
        activeConnections.value = {};
        accountGameData.clear();
        return {
          ok: true,
          listCleared: true,
          binCleared: true,
          retryable: false,
          reason: null,
        };
      },
    );

    if (!clearOutcome.ok) {
      return clearOutcome;
    }

    if (typeof localStorage !== "undefined") {
      tokenIds.forEach((tokenId) => {
        localStorage.removeItem(`ws_connection_${tokenId}`);
      });
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("ws_connection_")) {
          localStorage.removeItem(key);
        }
      });
    }

    return clearOutcome;
  };

  const cleanExpiredTokens = async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 找出需要清理的token
    const tokensToRemove = gameTokens.value.filter((token) => {
      // URL和bin文件导入的token设为长期有效，不会过期
      // 升级为长期有效的token也不会过期
      if (
        token.importMethod === "url" ||
        token.importMethod === "bin" ||
        token.importMethod === "wxQrcode" ||
        token.importMethod === "mobile" ||
        token.importMethod === "wxForceLogout" ||
        token.upgradedToPermanent
      ) {
        return false;
      }
      // 手动导入的token按原逻辑处理（24小时过期）
      const lastUsed = new Date(token.lastUsed || token.createdAt || 0);
      return lastUsed <= oneDayAgo;
    });

    let cleanedCount = 0;

    // 逐个删除，触发清理逻辑（WebSocket断开、IndexedDB删除等）
    for (const token of tokensToRemove) {
      const outcome = await removeToken(token.id);
      if (outcome.ok) {
        cleanedCount += 1;
      }
    }

    return cleanedCount;
  };

  // 将现有token升级为长期有效
  const upgradeTokenToPermanent = (tokenId: string) => {
    const token = gameTokens.value.find((t) => t.id === tokenId);
    if (
      token &&
      !token.upgradedToPermanent &&
      token.importMethod !== "url" &&
      token.importMethod !== "bin" &&
      token.importMethod !== "wxQrcode" &&
      token.importMethod !== "mobile" &&
      token.importMethod !== "wxForceLogout"
    ) {
      updateToken(tokenId, {
        upgradedToPermanent: true,
        upgradedAt: new Date().toISOString(),
      });
      return true;
    }
    return false;
  };

  // 连接唯一性验证和监控
  const validateConnectionUniqueness = (tokenId: string) => {
    const connections = Object.values(wsConnections.value).filter(
      (conn) =>
        conn.tokenId === tokenId &&
        (conn.status === "connecting" || conn.status === "connected"),
    );

    if (connections.length > 1) {
      wsLogger.warn(
        `检测到重复连接: ${tokenId}, 连接数: ${connections.length}`,
      );
      // 保留最新的连接，关闭旧连接
      const sortedConnections = connections.sort(
        (a, b) =>
          new Date(b.connectedAt || 0).getTime() -
          new Date(a.connectedAt || 0).getTime(),
      );

      for (let i = 1; i < sortedConnections.length; i++) {
        const oldConnection = sortedConnections[i];
        wsLogger.debug(`关闭重复连接: ${tokenId}`);
        if (oldConnection?.tokenId) {
          closeWebSocketConnectionAsync(oldConnection.tokenId);
        }
      }

      return false; // 检测到重复连接
    }

    return true; // 连接唯一
  };

  // 连接监控和清理
  const connectionMonitor = {
    // 定期检查连接状态
    startMonitoring: () => {
      if (monitorTimer !== null) return;
      monitorTimer = setInterval(() => {
        const now = Date.now();

        // 检查连接超时（超过30秒未活动）
        Object.entries(wsConnections.value).forEach(([tokenId, connection]) => {
          const lastActivity =
            connection.lastMessage?.timestamp || connection.connectedAt;
          if (lastActivity) {
            const timeSinceActivity = now - new Date(lastActivity).getTime();
            if (
              timeSinceActivity > 30000 &&
              connection.status === "connected"
            ) {
              wsLogger.warn(`检测到连接可能已断开: ${tokenId}`);
              // 发送心跳检测
              if (connection.client) {
                connection.client.sendHeartbeat();
              }
            }
          }
        });

        // 清理过期的连接锁（超过10分钟）
        Object.entries(connectionLocks.value).forEach(([tokenId, lock]) => {
          if (now - (lock.timestamp || 0) > 600000) {
            delete connectionLocks.value[tokenId];
            wsLogger.debug(`清理过期连接锁: ${tokenId}`);
          }
        });

        // 清理过期的跨标签页状态（超过5分钟）
        Object.entries(activeConnections.value).forEach(([tokenId, state]) => {
          if (now - state.timestamp > 300000) {
            wsLogger.debug(`清理过期跨标签页状态: ${tokenId}`);
            delete activeConnections.value[tokenId];
            localStorage.removeItem(`ws_connection_${tokenId}`);
          }
        });
      }, 10000); // 每10秒检查一次
    },

    stopMonitoring: () => {
      if (monitorTimer !== null) {
        clearInterval(monitorTimer);
        monitorTimer = null;
      }
    },

    // 获取连接统计信息
    getStats: () => {
      const duplicateTokens: string[] = [];
      const stats = {
        totalConnections: Object.keys(wsConnections.value).length,
        connectedCount: 0,
        connectingCount: 0,
        disconnectingCount: 0,
        disconnectedCount: 0,
        errorCount: 0,
        duplicateTokens,
        activeLocks: Object.keys(connectionLocks.value).length,
        crossTabStates: Object.keys(activeConnections.value).length,
      };
      const statusCountMap: Record<
        WebSocketConnection["status"],
        keyof typeof stats
      > = {
        connected: "connectedCount",
        connecting: "connectingCount",
        disconnecting: "disconnectingCount",
        disconnected: "disconnectedCount",
        error: "errorCount",
      };

      // 统计连接状态
      const tokenCounts = new Map<string, number>();
      Object.values(wsConnections.value).forEach((connection) => {
        if (connection.status && connection.status in statusCountMap) {
          const statField = statusCountMap[connection.status];
          if (typeof stats[statField] === "number") {
            (stats[statField] as number)++;
          }
        }

        if (!connection.tokenId) return;
        // 检测重复token
        const count = tokenCounts.get(connection.tokenId) || 0;
        tokenCounts.set(connection.tokenId, count + 1);

        if (count > 0) {
          stats.duplicateTokens.push(connection.tokenId);
        }
      });

      return stats;
    },

    // 强制清理所有连接
    forceCleanup: async () => {
      wsLogger.info("开始强制清理所有连接...");

      const cleanupPromises = Object.keys(wsConnections.value).map((tokenId) =>
        closeWebSocketConnectionAsync(tokenId),
      );

      await Promise.all(cleanupPromises);

      // 清理所有锁和状态
      connectionLocks.value = {};
      activeConnections.value = {};
      desiredConnections.clear();
      Object.keys(connectionRecoveryStatus.value).forEach((id) => {
        connectionRecovery.cancel(id);
      });

      // 清理localStorage中的跨标签页状态
      if (typeof localStorage !== "undefined") {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("ws_connection_")) {
            localStorage.removeItem(key);
          }
        });
      }

      wsLogger.info("强制清理完成");
    },
  };

  // 监听localStorage变化（跨标签页通信）
  const setupCrossTabListener = () => {
    if (
      storageListener ||
      typeof window === "undefined" ||
      !window.addEventListener
    ) {
      return;
    }
    storageListener = (event: StorageEvent) => {
      if (event.key?.startsWith("ws_connection_")) {
        const tokenId = event.key.replace("ws_connection_", "");
        wsLogger.debug(
          `检测到跨标签页连接状态变化: ${tokenId}`,
          event.newValue,
        );

        // Wake a waiting selected account as soon as another tab releases it.
        if (!event.newValue && shouldKeepRecovering(tokenId)) {
          connectionRecovery.schedule(tokenId, {
            reset: true,
            immediate: true,
          });
        }
        // 如果其他标签页建立了连接，考虑关闭本标签页的连接
        if (event.newValue) {
          try {
            const newState = JSON.parse(event.newValue);
            const localConnection = wsConnections.value[tokenId];

            if (
              newState.action === "disconnected" &&
              newState.sessionId !== currentSessionId &&
              shouldKeepRecovering(tokenId)
            ) {
              connectionRecovery.schedule(tokenId, {
                reset: true,
                immediate: true,
              });
            }

            if (
              newState.action === "connected" &&
              newState.sessionId !== currentSessionId &&
              localConnection?.status === "connected"
            ) {
              wsLogger.info(
                `检测到其他标签页已连接同一token，关闭本地连接: ${tokenId}`,
              );
              closeWebSocketConnectionAsync(tokenId);
            }
          } catch (error) {
            wsLogger.warn("解析跨标签页状态失败:", error);
          }
        }
      }
    };
    window.addEventListener("storage", storageListener);
  };

  let rateLimiterCallbackRegistered = false;
  const registerRateLimiterCallback = () => {
    if (rateLimiterCallbackRegistered) return;
    rateLimiterCallbackRegistered = true;
    setAuthUserRateLimiterCallback((waitTimeMs: number, queueSize: number) => {
      const waitSeconds = Math.ceil(waitTimeMs / 1000);
      $emit.emit("token:refresh:waiting", {
        waitTimeMs,
        waitSeconds,
        queueSize,
        timestamp: Date.now(),
      });
    });
  };

  // Listen for other tabs and keep connection monitoring active without altering stored accounts.
  const initConnectionCoordination = () => {
    connectionMonitor.startMonitoring();
    setupCrossTabListener();
    registerRateLimiterCallback();
  };

  // 初始化
  const initTokenStore = () => {
    if (tokenStoreInitialized) return;
    tokenStoreInitialized = true;

    // 清理过期token
    cleanExpiredTokens();
    // 启动连接监控、跨标签页协调与限流通知
    initConnectionCoordination();

    tokenLogger.info("Token Store 初始化完成，连接监控已启动");
  };
  const hasValidBattleVersion = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

  const setBattleVersion = (
    version: number | null,
    tokenId: string | null = selectedTokenId.value,
  ) => {
    if (!tokenId) return;
    const accountData = accountGameData.forToken(tokenId);
    accountData.value.battleVersion = version;
    accountData.value.lastUpdated = new Date().toISOString();
  };

  const getBattleVersion = () => {
    return gameData.value.battleVersion;
  };

  /**
   * Ensure battleVersion is initialized at most once per active socket,
   * deduplicating concurrent callers across pages and rejecting responses from
   * replaced sockets.
   */
  const ensureBattleVersion = async (
    tokenId: string,
    options: { allowDuringRestored?: boolean } = {},
  ): Promise<number | null> => {
    if (!tokenId) return null;
    const connection = wsConnections.value[tokenId];
    if (
      !connection ||
      connection.status !== "connected" ||
      !connection.client
    ) {
      return null;
    }

    const existingVersion =
      accountGameData.forToken(tokenId).value.battleVersion;
    if (hasValidBattleVersion(existingVersion)) {
      return existingVersion;
    }

    if (
      !options.allowDuringRestored &&
      connectionRecoveryStatus.value[tokenId] === "restored"
    ) {
      return null;
    }

    const rawClient = toRaw(connection.client);
    const rawSocket = toRaw(connection.client.socket ?? null);
    const inFlight = inFlightBattleVersion.get(tokenId);
    if (
      inFlight &&
      inFlight.client === rawClient &&
      inFlight.socket === rawSocket
    ) {
      return inFlight.promise;
    }

    const entry: {
      client: unknown;
      socket: unknown;
      promise: Promise<number | null>;
    } = {
      client: rawClient,
      socket: rawSocket,
      promise: Promise.resolve(null),
    };
    entry.promise = (async () => {
      try {
        const response = (await sendMessageWithPromise(
          tokenId,
          "fight_startlevel",
        )) as { battleData?: { version?: unknown } } | null;
        const version = response?.battleData?.version;
        const latestConn = wsConnections.value[tokenId];
        const latestClient = latestConn?.client;
        const stillSameSocket =
          latestConn?.status === "connected" &&
          Boolean(latestClient) &&
          toRaw(latestClient) === rawClient &&
          toRaw(latestClient?.socket ?? null) === rawSocket;
        if (stillSameSocket && hasValidBattleVersion(version)) {
          setBattleVersion(version, tokenId);
          return version;
        }
        return null;
      } catch {
        return null;
      } finally {
        if (inFlightBattleVersion.get(tokenId) === entry) {
          inFlightBattleVersion.delete(tokenId);
        }
      }
    })();

    inFlightBattleVersion.set(tokenId, entry);
    return entry.promise;
  };

  // =====================
  // Token分组管理方法
  // =====================

  /**
   * 创建新的分组
   */
  const createTokenGroup = (name: string, color: string = "#1677ff") => {
    const group: TokenGroup = {
      id: `group_${Date.now()}${Math.random().toString(36).slice(2)}`,
      name,
      color,
      tokenIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tokenGroups.value.push(group);
    return group;
  };

  /**
   * 删除分组
   */
  const deleteTokenGroup = (groupId: string) => {
    const index = tokenGroups.value.findIndex((g) => g.id === groupId);
    if (index !== -1) {
      tokenGroups.value.splice(index, 1);
    }
  };

  /**
   * 更新分组信息
   */
  const updateTokenGroup = (groupId: string, updates: Partial<TokenGroup>) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group) {
      Object.assign(group, updates, {
        updatedAt: new Date().toISOString(),
      });
    }
  };

  /**
   * 添加token到分组
   */
  const addTokenToGroup = (groupId: string, tokenId: string) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group && !group.tokenIds.includes(tokenId)) {
      group.tokenIds.push(tokenId);
      group.updatedAt = new Date().toISOString();
    }
  };

  /**
   * 从分组移除token
   */
  const removeTokenFromGroup = (groupId: string, tokenId: string) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group) {
      const index = group.tokenIds.indexOf(tokenId);
      if (index !== -1) {
        group.tokenIds.splice(index, 1);
        group.updatedAt = new Date().toISOString();
      }
    }
  };

  /**
   * 获取token所属的分组
   */
  const getTokenGroups = (tokenId: string): TokenGroup[] => {
    return tokenGroups.value.filter((g) => g.tokenIds.includes(tokenId));
  };

  /**
   * 获取分组中的所有token ID
   */
  const getGroupTokenIds = (groupId: string): string[] => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    return group ? group.tokenIds : [];
  };

  /**
   * 获取分组中有效的（存在于gameTokens中的）token ID
   */
  const getValidGroupTokenIds = (groupId: string): string[] => {
    const tokenIds = getGroupTokenIds(groupId);
    const validTokenIds = gameTokens.value.map((t) => t.id);
    return tokenIds.filter((id) => validTokenIds.includes(id));
  };

  /**
   * 移除不存在的token从所有分组
   */
  const cleanupInvalidTokens = () => {
    const validTokenIds = new Set(gameTokens.value.map((t) => t.id));
    tokenGroups.value.forEach((group) => {
      group.tokenIds = group.tokenIds.filter((id) => validTokenIds.has(id));
    });
  };

  return {
    // 状态
    gameTokens,
    selectedTokenId,
    wsConnections,
    connectionRecoveryStatus,
    gameData,
    getAccountGameData: (tokenId: string) => accountGameData.forToken(tokenId),

    // 计算属性
    hasTokens,
    selectedToken,
    selectedTokenRoleInfo,

    // Token管理方法
    addToken,
    commitNewToken,
    commitRoleUpsert,
    updateToken,
    commitCredentialUpdate,
    getCredentialVersion,
    syncGameTokensFromStorage,
    reorderTokens,
    refreshTokenManually,
    removeToken,
    selectToken,

    // Base64解析方法
    parseBase64Token,
    importBase64Token,

    // WebSocket方法
    createWebSocketConnection,
    closeWebSocketConnection,
    closeWebSocketConnectionIfCurrent,
    getWebSocketStatus,
    isConnectionActiveInAnotherTab,
    getWebSocketClient,
    sendMessage,
    sendMessageWithPromise,
    setMessageListener,
    setShowMsg,
    sendHeartbeat,
    sendGetRoleInfo,
    sendGetDataBundleVersion,
    sendSignIn,
    sendClaimDailyReward,
    sendGetTeamInfo,
    sendGameMessage,

    // 工具方法
    exportTokens,
    importTokens,
    commitImportTokens,
    clearAllTokens,
    cleanExpiredTokens,
    upgradeTokenToPermanent,
    initConnectionCoordination,
    initTokenStore,

    //游戏内发送消息方法
    sendMessageToLegion,
    sendMessageToWorld,

    // 塔信息方法
    getCurrentTowerLevel,
    getTowerInfo,

    // battleVersion
    setBattleVersion,
    getBattleVersion,
    ensureBattleVersion,

    // 调试工具方法
    validateToken,
    debugToken: (tokenString: string) => parseBase64Token(tokenString),

    // 连接管理增强功能
    validateConnectionUniqueness,
    connectionMonitor,
    currentSessionId: () => currentSessionId,

    // Token分组管理方法
    tokenGroups,
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,

    // 开发者工具
    devTools: {
      getConnectionStats: () => connectionMonitor.getStats(),
      forceCleanup: () => connectionMonitor.forceCleanup(),
      showConnectionLocks: () => Object.keys(connectionLocks.value),
      showCrossTabStates: () => Object.keys(activeConnections.value),
      testDuplicateConnection: (tokenId: string) => {
        // 降噪
        const token = gameTokens.value.find((t) => t.id === tokenId);
        if (token) {
          // 故意创建第二个连接进行测试
          createWebSocketConnection(`${tokenId}_test`, token.token);
        }
      },
    },
  };
});
