/** A failed request can still have changed the game state. */
export function presetSwitchFailure(error) {
  const detail = error?.message || "服务器未返回确认结果";
  return `切换未确认：${detail}。请求可能已生效，当前阵容可能已变化；请刷新预览并检查后再操作。`;
}

/** Read the server's active preset without falling back to a guessed team. */
export function activePresetId(value) {
  let current = value;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    const id = Number(current.useTeamId);
    if (Number.isInteger(id) && id >= 1 && id <= 4) return id;
    current = current.presetTeamInfo;
  }
  return null;
}

/** Each operation binds to one connection and verifies the server's active preset. */
export async function setTenHallPreset({
  tokenStore,
  tokenId,
  teamId,
  signal,
}) {
  if (!Number.isInteger(teamId) || teamId < 1 || teamId > 4)
    throw new Error("阵容编号无效");
  const client = tokenStore.getWebSocketClient(tokenId);
  const check = () => {
    if (
      signal?.aborted ||
      !client ||
      tokenStore.selectedToken?.id !== tokenId ||
      tokenStore.getWebSocketClient(tokenId) !== client ||
      tokenStore.getWebSocketStatus(tokenId) !== "connected"
    ) {
      throw new Error("角色已切换或连接已断开，请重新连接并检查当前阵容");
    }
  };
  const send = async (cmd, params = {}) => {
    check();
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      cmd,
      params,
      8000,
    );
    check();
    return result;
  };
  await send("presetteam_saveteam", { teamId });
  const info = await send("presetteam_getinfo");
  if (activePresetId(info) !== teamId)
    throw new Error("服务器未确认所选阵容，请检查游戏中的当前阵容");
  return teamId;
}

export async function readTenHallPreset({ tokenStore, tokenId }) {
  const client = tokenStore.getWebSocketClient(tokenId);
  if (
    !client ||
    tokenStore.selectedToken?.id !== tokenId ||
    tokenStore.getWebSocketStatus(tokenId) !== "connected"
  )
    return null;
  const result = await tokenStore.sendMessageWithPromise(
    tokenId,
    "presetteam_getinfo",
    {},
    8000,
  );
  if (
    tokenStore.selectedToken?.id !== tokenId ||
    tokenStore.getWebSocketClient(tokenId) !== client ||
    tokenStore.getWebSocketStatus(tokenId) !== "connected"
  )
    return null;
  return activePresetId(result);
}
