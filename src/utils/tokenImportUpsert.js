import { normalizeRoleId } from "./accountIdentity.js";

/**
 * Extract a verified game roleId from authenticated server responses (never
 * trusting an unverified local filename).
 */
export function extractAuthenticatedRoleId(
  roleTokenJson,
  { binData = null, serverRoles = null } = {},
) {
  if (typeof roleTokenJson === "string" && roleTokenJson.trim()) {
    try {
      const parsed = JSON.parse(roleTokenJson);
      const direct = normalizeRoleId(parsed?.roleId ?? parsed?.role?.roleId);
      if (direct) return direct;
    } catch {
      // Non-JSON token strings do not carry a verified roleId.
    }
  } else if (roleTokenJson && typeof roleTokenJson === "object") {
    const direct = normalizeRoleId(
      roleTokenJson.roleId ?? roleTokenJson.role?.roleId,
    );
    if (direct) return direct;
  }

  const binServerId = binData?.serverId ?? binData?.body?.serverId;
  if (
    binServerId !== undefined &&
    binServerId !== null &&
    serverRoles &&
    typeof serverRoles === "object"
  ) {
    const roleEntries = Array.isArray(serverRoles)
      ? serverRoles
      : Object.values(serverRoles);
    const matched = roleEntries.filter(
      (entry) =>
        entry &&
        entry.serverId !== undefined &&
        entry.serverId !== null &&
        String(entry.serverId) === String(binServerId),
    );
    if (matched.length === 1) {
      const verified = normalizeRoleId(matched[0].roleId);
      if (verified) return verified;
    }
  }

  return null;
}

/**
 * Find an existing stored account matching an imported role by token ID or stable game roleId.
 */
export function findExistingTokenForRole(
  tokens = [],
  role = {},
  selectedTokenId = "",
) {
  if (!Array.isArray(tokens) || !tokens.length) return null;

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
  if (sameRoleTokens.length === 1) return sameRoleTokens[0];

  const selectedMatch = sameRoleTokens.find(
    (token) => selectedTokenId && token.id === selectedTokenId,
  );
  if (selectedMatch) return selectedMatch;

  const serverMatch = sameRoleTokens.find(
    (token) => role.server && token.server === role.server,
  );
  return serverMatch || sameRoleTokens[0];
}

const BIN_REFRESH_METHODS = new Set(["bin", "wxQrcode", "mobile"]);

function hasValidCombUser(role) {
  return Boolean(
    role?.combUser &&
    typeof role.combUser === "object" &&
    !Array.isArray(role.combUser) &&
    Object.keys(role.combUser).length > 0,
  );
}

function requiresBinRefreshSource(role) {
  return !hasValidCombUser(role) && BIN_REFRESH_METHODS.has(role?.importMethod);
}

async function upsertSingleRole({
  role,
  tokenStore,
  getArrayBuffer,
  getArrayBufferRecord,
  storeArrayBuffer,
  storeArrayBufferIfMissing,
  storeArrayBufferIfUnchanged,
  deleteArrayBuffer,
  deleteArrayBufferIfUnchanged,
}) {
  const needsBin = requiresBinRefreshSource(role);

  if (typeof tokenStore.commitRoleUpsert === "function") {
    const commit = await tokenStore.commitRoleUpsert({
      role,
      needsBin,
      hasValidCombUser: hasValidCombUser(role),
      findExisting: (tokens, selectedId) =>
        findExistingTokenForRole(tokens, role, selectedId),
      binStorage: {
        getArrayBuffer,
        getArrayBufferRecord,
        storeArrayBuffer,
        storeArrayBufferIfMissing,
        storeArrayBufferIfUnchanged,
        deleteArrayBuffer,
        deleteArrayBufferIfUnchanged,
      },
    });
    if (!commit?.committed) {
      if (commit?.reason === "bin_storage_unavailable") {
        throw new Error(
          commit?.status === "updated"
            ? "导入失败：本地 BIN 凭据存储不可用，已保留原有账号"
            : "导入失败：本地 BIN 凭据存储不可用",
        );
      }
      if (commit?.reason === "bin_missing") {
        throw new Error(
          commit?.status === "updated"
            ? "导入失败：未找到新的 BIN 凭据数据，已保留原有账号"
            : "导入失败：未找到新的 BIN 凭据数据，请重新选择角色",
        );
      }
      if (commit?.binRolledBack === false) {
        if (commit?.reason === "storage_write_failed") {
          throw new Error(
            "导入失败：保存账号列表到本地存储失败，且恢复原账号 BIN 凭据失败（本地可能残留新 BIN 与旧 Token 不一致），已保留暂存凭据，请释放存储空间后重试或重新登录",
          );
        }
        throw new Error(
          "导入失败：更新已有账号记录失败，且恢复原账号 BIN 凭据失败（本地凭据可能不一致），已保留暂存凭据，请重试或重新登录",
        );
      }
      if (commit?.reason === "bin_write_failed") {
        throw new Error(
          "导入失败：写入账号 BIN 凭据失败，已保留原有账号与连接",
        );
      }
      if (commit?.reason === "storage_write_failed") {
        throw new Error(
          "导入失败：保存账号列表到本地存储失败（可能存储空间不足），已保留原有账号与暂存凭据",
        );
      }
      throw new Error("导入失败：更新已有账号记录失败，已保留原有凭据");
    }
    return {
      status: commit.status || "updated",
      tokenId: commit.tokenId || role.id,
    };
  }

  tokenStore.syncGameTokensFromStorage?.();
  const existing = findExistingTokenForRole(
    tokenStore.gameTokens || [],
    role,
    tokenStore.selectedTokenId,
  );

  if (existing) {
    let freshBin = null;
    let tempBinKey = null;
    let tempBinWriteToken;

    if (needsBin) {
      if (
        !role.id ||
        (typeof getArrayBuffer !== "function" &&
          typeof getArrayBufferRecord !== "function") ||
        typeof storeArrayBuffer !== "function"
      ) {
        throw new Error("导入失败：本地 BIN 凭据存储不可用，已保留原有账号");
      }
      if (typeof getArrayBufferRecord === "function") {
        const tempRecord = await getArrayBufferRecord(role.id);
        freshBin = tempRecord?.data ?? null;
        tempBinWriteToken = tempRecord?.binWriteToken ?? null;
      } else {
        freshBin = await getArrayBuffer(role.id);
      }
      if (
        !freshBin ||
        (freshBin instanceof ArrayBuffer && freshBin.byteLength === 0)
      ) {
        throw new Error("导入失败：未找到新的 BIN 凭据数据，已保留原有账号");
      }
      if (existing.id !== role.id) {
        tempBinKey = role.id;
      }
    }

    const updates = {
      token: role.token,
      name: existing.name || role.name,
      server: role.server || existing.server,
      roleId: role.roleId ?? existing.roleId,
      serverId: role.serverId ?? existing.serverId,
      roleIndex: role.roleIndex ?? existing.roleIndex,
      wsUrl: role.wsUrl || existing.wsUrl,
      importMethod: role.importMethod || existing.importMethod,
      combUser: hasValidCombUser(role) ? role.combUser : null,
      lastRefreshed: Date.now(),
      upgradedToPermanent: true,
    };

    if (typeof tokenStore.commitCredentialUpdate === "function") {
      const commit = await tokenStore.commitCredentialUpdate(existing.id, {
        updates,
        binData: existing.id !== role.id ? freshBin : null,
        binStorage: {
          getArrayBuffer,
          getArrayBufferRecord,
          storeArrayBuffer,
          storeArrayBufferIfMissing,
          storeArrayBufferIfUnchanged,
          deleteArrayBuffer,
          deleteArrayBufferIfUnchanged,
        },
        deleteOldBinKey: tempBinKey,
        deleteOldBinWriteToken: tempBinWriteToken,
        closeActiveConnection: true,
      });
      if (!commit?.committed) {
        if (commit?.binRolledBack === false) {
          if (commit?.reason === "storage_write_failed") {
            throw new Error(
              "导入失败：保存账号列表到本地存储失败，且恢复原账号 BIN 凭据失败（本地可能残留新 BIN 与旧 Token 不一致），已保留暂存凭据，请释放存储空间后重试或重新登录",
            );
          }
          throw new Error(
            "导入失败：更新已有账号记录失败，且恢复原账号 BIN 凭据失败（本地凭据可能不一致），已保留暂存凭据，请重试或重新登录",
          );
        }
        if (commit?.reason === "bin_write_failed") {
          throw new Error(
            "导入失败：写入账号 BIN 凭据失败，已保留原有账号与连接",
          );
        }
        if (commit?.reason === "storage_write_failed") {
          throw new Error(
            "导入失败：保存账号列表到本地存储失败（可能存储空间不足），已保留原有账号与暂存凭据",
          );
        }
        throw new Error("导入失败：更新已有账号记录失败，已保留原有凭据");
      }
      return { status: "updated", tokenId: existing.id };
    }

    let binMigrated = false;
    let previousBin = null;
    let fallbackWriteToken = null;
    if (needsBin && existing.id !== role.id && freshBin) {
      previousBin = await getArrayBuffer(existing.id);
      fallbackWriteToken = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const moved = await storeArrayBuffer(existing.id, freshBin, {
        binWriteToken: fallbackWriteToken,
      });
      if (!moved) {
        throw new Error(
          "导入失败：写入账号 BIN 凭据失败，已保留原有账号与连接",
        );
      }
      binMigrated = true;
    }

    const updated = tokenStore.updateToken(existing.id, updates);
    if (updated === false) {
      let binRolledBack = true;
      if (binMigrated) {
        try {
          if (previousBin) {
            if (typeof storeArrayBufferIfUnchanged === "function") {
              const status = await storeArrayBufferIfUnchanged(
                existing.id,
                previousBin,
                { expectedBinWriteToken: fallbackWriteToken },
              );
              binRolledBack =
                status === "stored" ||
                status === "changed" ||
                status === "missing";
            } else {
              binRolledBack = Boolean(
                await storeArrayBuffer(existing.id, previousBin),
              );
            }
          } else if (typeof deleteArrayBufferIfUnchanged === "function") {
            const status = await deleteArrayBufferIfUnchanged(existing.id, {
              expectedBinWriteToken: fallbackWriteToken,
            });
            binRolledBack =
              status === "deleted" ||
              status === "changed" ||
              status === "missing";
          } else if (typeof deleteArrayBuffer === "function") {
            binRolledBack = (await deleteArrayBuffer(existing.id)) !== false;
          } else {
            binRolledBack = false;
          }
        } catch {
          binRolledBack = false;
        }
      }
      if (!binRolledBack) {
        throw new Error(
          "导入失败：更新已有账号记录失败，且恢复原账号 BIN 凭据失败（本地凭据可能不一致），已保留暂存凭据，请重试或重新登录",
        );
      }
      throw new Error("导入失败：更新已有账号记录失败，已保留原有凭据");
    }

    if (tempBinKey && typeof deleteArrayBuffer === "function") {
      await deleteArrayBuffer(tempBinKey);
    }

    const status = tokenStore.getWebSocketStatus?.(existing.id);
    if (status && status !== "disconnected") {
      tokenStore.closeWebSocketConnection?.(existing.id);
    }

    return { status: "updated", tokenId: existing.id };
  }

  if (needsBin) {
    if (!role.id || typeof getArrayBuffer !== "function") {
      throw new Error("导入失败：本地 BIN 凭据存储不可用");
    }
    const freshBin = await getArrayBuffer(role.id);
    if (
      !freshBin ||
      (freshBin instanceof ArrayBuffer && freshBin.byteLength === 0)
    ) {
      throw new Error("导入失败：未找到新的 BIN 凭据数据，请重新选择角色");
    }
  }
  const added =
    typeof tokenStore.commitNewToken === "function"
      ? await tokenStore.commitNewToken({ ...role })
      : tokenStore.addToken({ ...role });
  return { status: "added", tokenId: added?.id || role.id };
}

/**
 * Insert new imported roles or update existing matching characters in place,
 * preserving local token IDs, groups, remarks, and daily settings.
 * When `allowPartial` is true, processes every role independently and returns
 * per-role outcomes so callers can retain only failed roles for retry.
 */
export async function upsertImportedRoleTokens({
  roles = [],
  tokenStore,
  getArrayBuffer,
  getArrayBufferRecord,
  storeArrayBuffer,
  storeArrayBufferIfMissing,
  storeArrayBufferIfUnchanged,
  deleteArrayBuffer,
  deleteArrayBufferIfUnchanged,
  allowPartial = false,
}) {
  // Snapshot the list before async awaits so mutating the caller's array
  // mid-import can never shift indices and silently skip roles.
  const roleSnapshot = Array.isArray(roles) ? [...roles] : [];
  let addedCount = 0;
  let updatedCount = 0;
  const tokenIds = [];
  const succeededIndices = [];
  const failedRoles = [];
  const results = [];

  for (let index = 0; index < roleSnapshot.length; index++) {
    const role = roleSnapshot[index];
    try {
      const outcome = await upsertSingleRole({
        role,
        tokenStore,
        getArrayBuffer,
        getArrayBufferRecord,
        storeArrayBuffer,
        storeArrayBufferIfMissing,
        storeArrayBufferIfUnchanged,
        deleteArrayBuffer,
        deleteArrayBufferIfUnchanged,
      });
      if (outcome.status === "updated") updatedCount++;
      else addedCount++;
      tokenIds.push(outcome.tokenId);
      succeededIndices.push(index);
      results.push({ index, role, ...outcome });
    } catch (error) {
      failedRoles.push({ index, role, error });
      results.push({ index, role, status: "failed", error });
      if (!allowPartial) {
        error.partialResult = {
          addedCount,
          updatedCount,
          tokenIds,
          succeededIndices,
          failedRoles,
          results,
        };
        throw error;
      }
    }
  }

  return {
    addedCount,
    updatedCount,
    tokenIds,
    succeededIndices,
    failedRoles,
    results,
  };
}

export function formatUpsertImportMessage({
  addedCount = 0,
  updatedCount = 0,
}) {
  if (updatedCount > 0 && addedCount > 0) {
    return `新增 ${addedCount} 个账号，并已原地更新 ${updatedCount} 个已有账号的登录凭据`;
  }
  if (updatedCount > 0) {
    return `已原地更新 ${updatedCount} 个已有账号的登录凭据（保留原有设置与分组）`;
  }
  return "Token添加成功";
}

/**
 * Compute minimal diff updates from an edit-modal snapshot so editing
 * non-credential fields (like remark) never overwrites a freshly refreshed
 * Token, while explicit Token edits include credential-version guards.
 */
export function buildTokenEditCommitPayload(snapshot, form) {
  const editableFields = ["name", "token", "server", "wsUrl", "remark"];
  const updates = {};
  for (const field of editableFields) {
    const nextVal = form?.[field] ?? "";
    const prevVal = snapshot ? (snapshot[field] ?? "") : undefined;
    if (!snapshot || nextVal !== prevVal) {
      updates[field] = form?.[field];
    }
  }
  const hasChanges = Object.keys(updates).length > 0;
  const editsCredential = Object.prototype.hasOwnProperty.call(
    updates,
    "token",
  );
  return {
    hasChanges,
    editsCredential,
    updates,
    ...(editsCredential && snapshot
      ? {
          expectedVersion: snapshot.credentialVersion,
          expectedToken: snapshot.token,
          expectedCreatedAt: snapshot.createdAt,
        }
      : {}),
  };
}

/**
 * Remove only the role entries that succeeded in the imported batch snapshot,
 * preserving both failed roles from this batch and any roles appended to the
 * list outside the snapshot while the import was running.
 */
export function pruneSucceededImportRoles(
  currentRoles = [],
  batchSnapshot = [],
  succeededIndices = [],
) {
  const succeededRefs = new Set();
  for (const index of succeededIndices) {
    if (index >= 0 && index < batchSnapshot.length) {
      succeededRefs.add(batchSnapshot[index]);
    }
  }
  return currentRoles.filter((role) => !succeededRefs.has(role));
}
