/** Run one tower challenge at a time, always reading the original account's energy. */
export async function runTowerClimb({
  send,
  checkSession,
  shouldStop,
  onProgress,
  delay,
}) {
  let attempts = 0;
  let previousStage = null;
  let previousDefeat = false;
  while (true) {
    let stage = null;
    let detail = "";
    // A missing or stale snapshot gets at most one extra read. Never retry a
    // consuming fight request, even if it timed out or its result was unclear.
    for (let read = 0; read < 2; read++) {
      if (shouldStop()) return { attempts, reason: "stopped" };
      checkSession();
      let role;
      try {
        role = await send("role_getroleinfo");
      } catch {
        checkSession();
        if (shouldStop()) return { attempts, reason: "stopped" };
        detail = "读取咸将塔状态失败，请检查连接后再试";
      }
      checkSession();
      if (shouldStop()) return { attempts, reason: "stopped" };
      const tower = role?.role?.tower;
      const energy = tower?.energy;
      if (!role) {
        detail ||= "服务器未返回咸将塔状态";
      } else if (!Number.isFinite(energy)) {
        detail = "服务器未返回当前咸将塔体力";
      } else if (Number.isFinite(energy) && energy <= 0) {
        return { attempts, reason: "energy" };
      } else if (role) {
        // The existing tower parser treats tower.id as the last completed stage.
        const rawStage = tower?.id;
        stage =
          (typeof rawStage === "number" ||
            (typeof rawStage === "string" && rawStage.trim() !== "")) &&
          Number.isSafeInteger(Number(rawStage)) &&
          Number(rawStage) >= 0
            ? Number(rawStage)
            : null;
        if (stage === null) {
          detail = "服务器未返回当前咸将塔层数";
        } else if (previousStage !== null && stage < previousStage) {
          detail = "服务器返回的层数发生回退，无法确认当前状态";
        } else if (
          previousStage !== null &&
          !previousDefeat &&
          stage === previousStage
        ) {
          detail = "战斗结果未确认，服务器的层数尚未推进";
        } else {
          detail = "";
          break;
        }
      }
      if (read === 0) await delay();
    }
    if (detail) return { attempts, reason: "uncertain", detail };
    const battle = await send("fight_starttower");
    attempts++;
    checkSession();
    onProgress(attempts);
    const result = battle?.battleData?.result;
    const hp = result?.sponsor?.ext?.curHP;
    // Explicit losses may be retried, but success is never inferred from HP.
    previousDefeat =
      result?.isWin === false || (Number.isFinite(hp) && hp <= 0);
    if (shouldStop()) return { attempts, reason: "stopped" };
    previousStage = stage;
    await delay();
  }
}
