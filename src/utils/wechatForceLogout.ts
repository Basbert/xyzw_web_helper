import { getServerList, transformToken } from "@/utils/token";
import { encodeCombUserBin } from "@/utils/xyzwRuntime";

export interface SavedCombUser {
  encryptCombUser: string;
  timestamp: number;
  sign: string;
  [key: string]: unknown;
}

export interface RoleMatchConfig {
  serverId?: string | number;
  roleIndex?: string | number;
  roleId?: string | number;
}

/** 使用服务端返回的 combUser 重新生成登录 bin。 */
export async function generateBinFromCombUser(
  combUser: SavedCombUser,
  serverId: string | number | null = null,
): Promise<ArrayBuffer> {
  if (!combUser?.encryptCombUser || !combUser.timestamp || !combUser.sign) {
    throw new Error("保存的 combUser 数据不完整");
  }

  return await encodeCombUserBin(combUser, serverId);
}

export function roleIndexFromServerId(serverId: unknown): number {
  const sid = Number(serverId);
  if (sid >= 2000000) return 2;
  if (sid >= 1000000) return 1;
  return 0;
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (expected === undefined || expected === null || expected === "")
    return true;
  return String(actual) === String(expected);
}

/**
 * 用 combUser 重新生成 bin，刷新服务器角色列表，并按账号保存的配置匹配角色。
 */
export async function refreshTokenFromCombUser(
  combUser: SavedCombUser,
  config: RoleMatchConfig,
) {
  const baseBin = await generateBinFromCombUser(combUser);
  const listStr = await getServerList(baseBin);
  const roles = JSON.parse(listStr || "{}");
  const roleList = Object.values(roles || {}) as any[];

  const matched = roleList.find((role) => {
    const serverMatches = sameValue(role.serverId, config.serverId);
    const indexMatches = sameValue(
      roleIndexFromServerId(role.serverId),
      config.roleIndex,
    );
    const roleMatches = sameValue(role.roleId, config.roleId);
    return serverMatches && indexMatches && roleMatches;
  });

  if (!matched) {
    throw new Error(
      `未找到匹配角色（区服 ${config.serverId ?? "未配置"}，序号 ${config.roleIndex ?? "未配置"}，角色ID ${config.roleId ?? "未配置"}）`,
    );
  }

  const roleBin = await generateBinFromCombUser(combUser, matched.serverId);
  const token = await transformToken(roleBin);
  return { token, bin: roleBin, role: matched };
}
