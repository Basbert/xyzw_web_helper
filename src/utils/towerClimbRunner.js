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
    if (shouldStop()) return { attempts, reason: "stopped" };
    checkSession();
    const role = await send("role_getroleinfo");
    checkSession();
    if (shouldStop()) return { attempts, reason: "stopped" };
    const tower = role?.role?.tower;
    const energy = tower?.energy;
    if (!Number.isFinite(energy)) throw new Error("服务器未返回当前爬塔体力");
    // The existing tower parser treats tower.id as the last completed stage.
    const rawStage = tower?.id;
    const stage =
      (typeof rawStage === "number" ||
        (typeof rawStage === "string" && rawStage.trim() !== "")) &&
      Number.isSafeInteger(Number(rawStage)) &&
      Number(rawStage) >= 0
        ? Number(rawStage)
        : null;
    if (energy <= 0) return { attempts, reason: "energy" };
    // A confirmed loss can be retried on the same floor. A missing result
    // requires evidence of progress before starting another fight.
    if (
      previousStage !== null &&
      (stage === null ||
        stage < previousStage ||
        (!previousDefeat && stage === previousStage))
    ) {
      return { attempts, reason: "uncertain" };
    }
    if (stage === null) throw new Error("服务器未返回当前咸将塔层数");
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
