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
    const existing = findExistingTokenForRole(
      tokenStore.gameTokens || [],
      role,
      tokenStore.selectedTokenId,
    );

    if (existing) {
      if (
        existing.id !== role.id &&
        role.id &&
        typeof getArrayBuffer === "function" &&
        typeof storeArrayBuffer === "function"
      ) {
        const freshBin = await getArrayBuffer(role.id);
        if (freshBin) {
          const moved = await storeArrayBuffer(existing.id, freshBin);
          if (moved && typeof deleteArrayBuffer === "function") {
            await deleteArrayBuffer(role.id);
          }
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
        combUser: role.combUser ?? null,
        lastRefreshed: Date.now(),
        upgradedToPermanent: true,
      };

      tokenStore.updateToken(existing.id, updates);

      const status = tokenStore.getWebSocketStatus?.(existing.id);
      if (status && status !== "disconnected") {
        tokenStore.closeWebSocketConnection?.(existing.id);
      }

      updatedCount++;
      tokenIds.push(existing.id);
    } else {
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
