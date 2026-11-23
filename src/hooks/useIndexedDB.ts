import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";
import { ref } from "vue";

// 数据库结构定义
interface ArrayBufferDB extends DBSchema {
  tokens: {
    key: string;
    value: {
      id: string;
      data: ArrayBuffer;
      createdAt: Date;
      updatedAt: Date;
      metadata?: Record<string, any>;
    };
    indexes: { "by-created": Date };
  };
}

export interface ArrayBufferRecord {
  data: ArrayBuffer;
  updatedAtMs: number | null;
  credentialVersion: number | null;
  binVersion: number | null;
  binWriteToken: string | null;
}

export interface ConditionalDeleteExpected {
  expectedData?: ArrayBuffer | null;
  expectedUpdatedAtMs?: number | null;
  expectedCredentialVersion?: number | null;
  maxExpectedCredentialVersion?: number | null;
  expectedBinVersion?: number | null;
  maxExpectedBinVersion?: number | null;
  expectedBinWriteToken?: string | null;
}

export type ConditionalDeleteResult =
  "deleted" | "changed" | "missing" | "error";

export type ConditionalStoreResult = "stored" | "exists" | "error";

const arrayBuffersEqual = (
  a: ArrayBuffer | null | undefined,
  b: ArrayBuffer | null | undefined,
): boolean => {
  if (!a || !b) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  const viewA = new Uint8Array(a);
  const viewB = new Uint8Array(b);
  for (let i = 0; i < viewA.length; i += 1) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
};

// Hook 返回类型
interface UseIndexedDBReturn {
  // 状态
  isReady: Ref<boolean>;
  error: Ref<string | null>;

  // 操作方法
  storeArrayBuffer: (
    key: string,
    data: ArrayBuffer,
    metadata?: Record<string, any>,
  ) => Promise<boolean>;
  storeArrayBufferIfMissing: (
    key: string,
    data: ArrayBuffer,
    metadata?: Record<string, any>,
  ) => Promise<ConditionalStoreResult>;
  getArrayBuffer: (key: string) => Promise<ArrayBuffer | null>;
  getArrayBufferRecord: (key: string) => Promise<ArrayBufferRecord | null>;
  getAllKeys: () => Promise<string[]>;
  deleteArrayBuffer: (key: string) => Promise<boolean>;
  deleteArrayBufferIfUnchanged: (
    key: string,
    expected?: ConditionalDeleteExpected,
  ) => Promise<ConditionalDeleteResult>;
  clearAll: () => Promise<boolean>;
  getStorageInfo: () => Promise<{ totalSize: number; keyCount: number }>;
}

// 配置接口
interface DBConfig {
  dbName?: string;
  version?: number;
  storeName?: "tokens";
  openTimeoutMs?: number;
}

const DEFAULT_DB_OPEN_TIMEOUT_MS = 8000;

/**
 * Vue3 Hook for IndexedDB ArrayBuffer storage
 */
export function useIndexedDB(config: DBConfig = {}): UseIndexedDBReturn {
  const {
    dbName = "xyzw",
    version = 1,
    storeName = "tokens",
    openTimeoutMs = DEFAULT_DB_OPEN_TIMEOUT_MS,
  } = config;

  // 响应式状态
  const isReady = ref(false);
  const error = ref<string | null>(null);
  const db = ref<IDBPDatabase<ArrayBufferDB> | null>(null);
  let readyPromise: Promise<void> | null = null;

  /**
   * 初始化数据库
   */
  const initDB = async (): Promise<void> => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      error.value = null;

      const database = await new Promise<IDBPDatabase<ArrayBufferDB>>(
        (resolve, reject) => {
          const failOnce = (reason: Error) => {
            if (settled) return;
            settled = true;
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            reject(reason);
          };

          if (Number.isFinite(openTimeoutMs) && openTimeoutMs > 0) {
            timeoutId = setTimeout(() => {
              failOnce(
                new Error(
                  "打开本地数据库超时，请刷新页面或关闭其他标签页后重试",
                ),
              );
            }, openTimeoutMs);
          }

          openDB<ArrayBufferDB>(dbName, version, {
            upgrade(db) {
              // 创建对象存储空间（如果不存在）
              if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, {
                  keyPath: "id",
                });
                // 创建创建时间索引
                store.createIndex("by-created", "createdAt");
                console.log(`✅ IndexedDB 存储空间 "${storeName}" 创建成功`);
              }
            },
            blocked() {
              const blockedMessage =
                "数据库被其他标签页阻塞，请关闭其他使用相同数据库的标签页";
              error.value = blockedMessage;
              failOnce(new Error(blockedMessage));
            },
            blocking() {
              error.value = "数据库需要升级，请关闭所有标签页后重试";
            },
            terminated() {
              db.value = null;
              isReady.value = false;
              readyPromise = null;
              error.value = "数据库连接意外终止";
            },
          }).then(
            (opened) => {
              if (settled) {
                try {
                  opened.close?.();
                } catch {
                  // Ignore cleanup error for late open after timeout/blocked.
                }
                return;
              }
              settled = true;
              if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              resolve(opened);
            },
            (openErr) => {
              failOnce(
                openErr instanceof Error
                  ? openErr
                  : new Error(String(openErr || "未知错误")),
              );
            },
          );
        },
      );

      db.value = database;
      isReady.value = true;
      console.log(`✅ IndexedDB "${dbName}" 初始化成功`);
    } catch (err) {
      db.value = null;
      isReady.value = false;
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `初始化数据库失败: ${errorMessage}`;
      console.error("❌ IndexedDB 初始化错误:", err);
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  };

  const startInit = () => {
    const pending = initDB().finally(() => {
      if (readyPromise === pending && !db.value) {
        readyPromise = null;
      }
    });
    readyPromise = pending;
    return pending;
  };

  const ensureReady = async (): Promise<IDBPDatabase<ArrayBufferDB> | null> => {
    if (!db.value) {
      const pending = readyPromise || startInit();
      await pending;
    }
    if (!db.value) {
      error.value = error.value || "数据库未初始化";
      return null;
    }
    return db.value;
  };

  /**
   * 存储 ArrayBuffer 数据
   */
  const storeArrayBuffer = async (
    key: string,
    data: ArrayBuffer,
    metadata?: Record<string, any>,
  ): Promise<boolean> => {
    const database = await ensureReady();
    if (!database) {
      return false;
    }

    try {
      const binWriteToken =
        typeof metadata?.binWriteToken === "string" && metadata.binWriteToken
          ? metadata.binWriteToken
          : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const item = {
        id: key,
        data,
        metadata: {
          ...(metadata || {}),
          binWriteToken,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await database.put(storeName, item);
      console.log(
        `✅ ArrayBuffer 存储成功，键: ${key}, 大小: ${data.byteLength} 字节`,
      );
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `存储数据失败: ${errorMessage}`;
      console.error("❌ 存储 ArrayBuffer 错误:", err);
      return false;
    }
  };

  /**
   * 在单个 IndexedDB 读写事务内仅当键缺失时写入 ArrayBuffer，
   * 避免无 Web Locks 环境下旧 BIN 恢复覆盖另一标签页刚写入的新 BIN。
   */
  const storeArrayBufferIfMissing = async (
    key: string,
    data: ArrayBuffer,
    metadata?: Record<string, any>,
  ): Promise<ConditionalStoreResult> => {
    const database = await ensureReady();
    if (!database) {
      return "error";
    }

    try {
      const tx = database.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const existing = await store.get(key);
      if (existing) {
        await tx.done;
        return "exists";
      }

      const binWriteToken =
        typeof metadata?.binWriteToken === "string" && metadata.binWriteToken
          ? metadata.binWriteToken
          : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const item = {
        id: key,
        data,
        metadata: {
          ...(metadata || {}),
          binWriteToken,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await store.put(item);
      await tx.done;
      console.log(
        `✅ ArrayBuffer 条件恢复成功，键: ${key}, 大小: ${data.byteLength} 字节`,
      );
      return "stored";
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `条件存储数据失败: ${errorMessage}`;
      console.error("❌ 条件存储 ArrayBuffer 错误:", err);
      return "error";
    }
  };

  /**
   * 获取 ArrayBuffer 数据及其元数据快照（用于跨标签页条件删除校验）
   */
  const getArrayBufferRecord = async (
    key: string,
  ): Promise<ArrayBufferRecord | null> => {
    const database = await ensureReady();
    if (!database) {
      return null;
    }

    try {
      const result = await database.get(storeName, key);

      if (!result) {
        console.warn(`⚠️ 未找到键为 "${key}" 的数据`);
        return null;
      }

      const meta = result.metadata || {};
      const updatedAtMs =
        result.updatedAt instanceof Date
          ? result.updatedAt.getTime()
          : typeof result.updatedAt === "number"
            ? result.updatedAt
            : null;
      const credentialVersion =
        typeof meta.credentialVersion === "number" &&
        Number.isFinite(meta.credentialVersion)
          ? meta.credentialVersion
          : null;
      const binVersion =
        typeof meta.binVersion === "number" && Number.isFinite(meta.binVersion)
          ? meta.binVersion
          : null;
      const binWriteToken =
        typeof meta.binWriteToken === "string" && meta.binWriteToken
          ? meta.binWriteToken
          : null;

      console.log(
        `✅ ArrayBuffer 读取成功，键: ${key}, 大小: ${result.data.byteLength} 字节`,
      );
      return {
        data: result.data,
        updatedAtMs,
        credentialVersion,
        binVersion,
        binWriteToken,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `读取数据失败: ${errorMessage}`;
      console.error("❌ 读取 ArrayBuffer 错误:", err);
      return null;
    }
  };

  /**
   * 获取 ArrayBuffer 数据
   */
  const getArrayBuffer = async (key: string): Promise<ArrayBuffer | null> => {
    const record = await getArrayBufferRecord(key);
    return record ? record.data : null;
  };

  /**
   * 获取所有存储的键
   */
  const getAllKeys = async (): Promise<string[]> => {
    const database = await ensureReady();
    if (!database) {
      return [];
    }

    try {
      return await database.getAllKeys(storeName);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `获取键列表失败: ${errorMessage}`;
      console.error("❌ 获取键列表错误:", err);
      return [];
    }
  };

  /**
   * 删除指定的 ArrayBuffer 数据
   */
  const deleteArrayBuffer = async (key: string): Promise<boolean> => {
    const database = await ensureReady();
    if (!database) {
      return false;
    }

    try {
      await database.delete(storeName, key);
      console.log(`✅ ArrayBuffer 删除成功，键: ${key}`);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `删除数据失败: ${errorMessage}`;
      console.error("❌ 删除 ArrayBuffer 错误:", err);
      return false;
    }
  };

  /**
   * 在单个 IndexedDB 读写事务内按凭据版本、写入标记与字节快照做原子条件删除，
   * 避免无 Web Locks 环境下误删另一标签页刚重登写入的新 BIN。
   */
  const deleteArrayBufferIfUnchanged = async (
    key: string,
    expected: ConditionalDeleteExpected = {},
  ): Promise<ConditionalDeleteResult> => {
    const database = await ensureReady();
    if (!database) {
      return "error";
    }

    try {
      const tx = database.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const current = await store.get(key);
      if (!current) {
        await tx.done;
        return "missing";
      }

      const currentMeta = current.metadata || {};
      const currentMetaVer =
        typeof currentMeta.credentialVersion === "number" &&
        Number.isFinite(currentMeta.credentialVersion)
          ? currentMeta.credentialVersion
          : null;
      const currentBinVer =
        typeof currentMeta.binVersion === "number" &&
        Number.isFinite(currentMeta.binVersion)
          ? currentMeta.binVersion
          : null;
      const currentWriteToken =
        typeof currentMeta.binWriteToken === "string" &&
        currentMeta.binWriteToken
          ? currentMeta.binWriteToken
          : null;
      const currentUpdatedAtMs =
        current.updatedAt instanceof Date
          ? current.updatedAt.getTime()
          : typeof current.updatedAt === "number"
            ? current.updatedAt
            : null;

      const changed =
        expected.expectedData === null ||
        (expected.expectedBinWriteToken !== undefined &&
          currentWriteToken !== expected.expectedBinWriteToken) ||
        (expected.expectedCredentialVersion !== undefined &&
          expected.expectedCredentialVersion !== null &&
          currentMetaVer !== null &&
          currentMetaVer !== expected.expectedCredentialVersion) ||
        (expected.maxExpectedCredentialVersion !== undefined &&
          expected.maxExpectedCredentialVersion !== null &&
          currentMetaVer !== null &&
          currentMetaVer > expected.maxExpectedCredentialVersion) ||
        (expected.expectedBinVersion !== undefined &&
          expected.expectedBinVersion !== null &&
          currentBinVer !== null &&
          currentBinVer !== expected.expectedBinVersion) ||
        (expected.maxExpectedBinVersion !== undefined &&
          expected.maxExpectedBinVersion !== null &&
          currentBinVer !== null &&
          currentBinVer > expected.maxExpectedBinVersion) ||
        (expected.expectedUpdatedAtMs !== undefined &&
          expected.expectedUpdatedAtMs !== null &&
          currentUpdatedAtMs !== expected.expectedUpdatedAtMs) ||
        (expected.expectedData !== undefined &&
          !arrayBuffersEqual(current.data, expected.expectedData));

      if (changed) {
        await tx.done;
        return "changed";
      }

      await store.delete(key);
      await tx.done;
      console.log(`✅ ArrayBuffer 条件删除成功，键: ${key}`);
      return "deleted";
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `条件删除数据失败: ${errorMessage}`;
      console.error("❌ 条件删除 ArrayBuffer 错误:", err);
      return "error";
    }
  };

  /**
   * 清空所有数据
   */
  const clearAll = async (): Promise<boolean> => {
    const database = await ensureReady();
    if (!database) {
      return false;
    }

    try {
      await database.clear(storeName);
      console.log("✅ 所有 ArrayBuffer 数据已清空");
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      error.value = `清空数据失败: ${errorMessage}`;
      console.error("❌ 清空数据错误:", err);
      return false;
    }
  };

  /**
   * 获取存储信息
   */
  const getStorageInfo = async (): Promise<{
    totalSize: number;
    keyCount: number;
  }> => {
    const database = await ensureReady();
    if (!database) {
      return { totalSize: 0, keyCount: 0 };
    }

    try {
      const allItems = await database.getAll(storeName);
      const totalSize = allItems.reduce(
        (size, item) => size + item.data.byteLength,
        0,
      );
      const keyCount = allItems.length;

      return { totalSize, keyCount };
    } catch (err) {
      console.error("❌ 获取存储信息错误:", err);
      return { totalSize: 0, keyCount: 0 };
    }
  };

  startInit();

  return {
    // 状态
    isReady,
    error,

    // 方法
    storeArrayBuffer,
    storeArrayBufferIfMissing,
    getArrayBuffer,
    getArrayBufferRecord,
    getAllKeys,
    deleteArrayBuffer,
    deleteArrayBufferIfUnchanged,
    clearAll,
    getStorageInfo,
  };
}

export default useIndexedDB;
