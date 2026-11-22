import { normalizeRoleId } from "./accountIdentity.js";

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

/**
 * Insert new imported roles or update existing matching characters in place,
 * preserving local token IDs, groups, remarks, and daily settings.
 */
export async function upsertImportedRoleTokens({
  roles = [],
  tokenStore,
  getArrayBuffer,
  storeArrayBuffer,
  deleteArrayBuffer,
}) {
  let addedCount = 0;
  let updatedCount = 0;
  const tokenIds = [];

  for (const role of roles) {
    const needsBin = requiresBinRefreshSource(role);
    const existing = findExistingTokenForRole(
      tokenStore.gameTokens || [],
      role,
      tokenStore.selectedTokenId,
    );

    if (existing) {
      let binMigrated = false;
      let previousBin = null;
      let tempBinKey = null;

      if (needsBin) {
        if (
          !role.id ||
          typeof getArrayBuffer !== "function" ||
          typeof storeArrayBuffer !== "function"
        ) {
          throw new Error("导入失败：本地 BIN 凭据存储不可用，已保留原有账号");
        }
        const freshBin = await getArrayBuffer(role.id);
        if (
          !freshBin ||
          (freshBin instanceof ArrayBuffer && freshBin.byteLength === 0)
        ) {
          throw new Error("导入失败：未找到新的 BIN 凭据数据，已保留原有账号");
        }
        if (existing.id !== role.id) {
          previousBin = await getArrayBuffer(existing.id);
          const moved = await storeArrayBuffer(existing.id, freshBin);
          if (!moved) {
            throw new Error(
              "导入失败：写入账号 BIN 凭据失败，已保留原有账号与连接",
            );
          }
          binMigrated = true;
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

      const updated = tokenStore.updateToken(existing.id, updates);
      if (updated === false) {
        if (binMigrated) {
          if (previousBin) {
            await storeArrayBuffer(existing.id, previousBin);
          } else if (typeof deleteArrayBuffer === "function") {
            await deleteArrayBuffer(existing.id);
          }
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

      updatedCount++;
      tokenIds.push(existing.id);
    } else {
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
      const added = tokenStore.addToken({ ...role });
      addedCount++;
      tokenIds.push(added?.id || role.id);
    }
  }

  return { addedCount, updatedCount, tokenIds };
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
