/** Bind the confirmation dialog to the connection active when it was opened. */
export function createTowerPurchaseSession(tokenStore) {
  const tokenId = tokenStore.selectedToken?.id;
  const client = tokenStore.wsConnections?.[tokenId]?.client;
  const checkSession = () => {
    if (
      !tokenId ||
      !client ||
      tokenStore.selectedToken?.id !== tokenId ||
      tokenStore.getWebSocketStatus(tokenId) !== "connected" ||
      tokenStore.wsConnections?.[tokenId]?.client !== client
    ) {
      throw new Error("账号或连接已变化，请重新确认购买");
    }
  };
  checkSession();
  return { tokenId, checkSession };
}

/** Purchase once, then read that same account's server-reported tower energy. */
export async function purchaseTowerEnergy({
  tokenStore,
  tokenId,
  kind,
  quantity,
  checkSession,
}) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error("购买数量必须是 1-100 的整数");
  }
  if (kind !== "normal" && kind !== "weird") throw new Error("无法识别塔类型");
  checkSession();
  const command = kind === "normal" ? "tower_buyenergy" : "evotower_buyenergy";
  const params =
    kind === "normal" ? { buyNum: quantity } : { energy: quantity };
  try {
    await tokenStore.sendMessageWithPromise(tokenId, command, params, 8000);
  } catch (error) {
    // A missing response does not prove that the server rejected the purchase.
    return { status: "uncertain", error };
  }
  try {
    checkSession();
    const response = await tokenStore.sendMessageWithPromise(
      tokenId,
      kind === "normal" ? "role_getroleinfo" : "evotower_getinfo",
      {},
      5000,
    );
    checkSession();
    const energy =
      kind === "normal"
        ? response?.role?.tower?.energy
        : response?.evoTower?.energy;
    return Number.isFinite(energy) && energy >= 0
      ? { status: "confirmed", energy }
      : { status: "confirmed-unrefreshed" };
  } catch {
    return { status: "confirmed-unrefreshed" };
  }
}
