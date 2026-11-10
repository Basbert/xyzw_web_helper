/** Run one tower challenge at a time, always reading the original account's energy. */
export async function runTowerClimb({
  send,
  checkSession,
  shouldStop,
  onProgress,
  delay,
  maxClimb = 100,
}) {
  let attempts = 0;
  let previousStage = null;
  for (let i = 0; i < maxClimb; i++) {
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
    // A surviving sponsor is not proof of victory: only a server-confirmed
    // increase in completed stages allows the next fight to start.
    if (previousStage !== null && (stage === null || stage <= previousStage)) {
      return { attempts, reason: "uncertain" };
    }
    if (energy <= 0) return { attempts, reason: "energy" };
    if (stage === null) throw new Error("服务器未返回当前咸将塔层数");
    const battle = await send("fight_starttower");
    attempts++;
    checkSession();
    onProgress(attempts);
    const result = battle?.battleData?.result;
    const hp = result?.sponsor?.ext?.curHP;
    // The game's other battle parsers interpret false as sponsor defeat. Do
    // not infer victory from remaining health or an absent result field.
    if (result?.isWin === false || (Number.isFinite(hp) && hp <= 0)) {
      return { attempts, reason: "defeat" };
    }
    if (shouldStop()) return { attempts, reason: "stopped" };
    previousStage = stage;
    await delay();
  }
  return { attempts, reason: "limit" };
}
