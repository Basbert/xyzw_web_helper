/** Execute the existing vault sequence one confirmed command at a time. */
export async function runBossTower({
  tokenStore,
  tokenId,
  checkActive,
  now = () => new Date(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  checkActive();
  const day = now().getDay();
  if (day === 1 || day === 2) throw new Error("未到宝库开放时间");
  const info = await tokenStore.sendMessageWithPromise(
    tokenId,
    "bosstower_getinfo",
    {},
    10000,
  );
  checkActive();
  const towerId = Number(info?.bossTower?.towerId);
  if (!Number.isInteger(towerId) || towerId < 1 || towerId > 5)
    throw new Error("无法确认当前宝库层数，请刷新后重试");
  const commands = [
    "bosstower_startboss",
    "bosstower_startboss",
    ...Array.from({ length: towerId <= 3 ? 9 : 0 }, () => "bosstower_startbox"),
  ];
  for (const command of commands) {
    checkActive();
    try {
      await tokenStore.sendMessageWithPromise(tokenId, command, {}, 10000);
    } catch (cause) {
      throw new Error("宝库操作结果未确认，请刷新战况后再决定是否重试", {
        cause,
      });
    }
    checkActive();
    await wait(500);
  }
  checkActive();
  try {
    await tokenStore.sendMessageWithPromise(
      tokenId,
      "bosstower_getinfo",
      {},
      10000,
    );
    checkActive();
    return { towerId, refreshed: true };
  } catch (error) {
    if (error.interrupted) throw error;
    return { towerId, refreshed: false };
  }
}
