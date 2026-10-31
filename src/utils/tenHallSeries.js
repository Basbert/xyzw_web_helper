import { runTenHallSimulation } from "./tenHallSimulation.js";

function abortError() {
  const error = new Error("已取消模拟");
  error.name = "AbortError";
  return error;
}

function waitBeforeNext(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 10000);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function loadoutIsConfirmed(loadout) {
  return (
    loadout?.heroes === "matched" &&
    ["matched", "none"].includes(loadout.weapon?.status) &&
    ["matched", "none"].includes(loadout.pet?.status)
  );
}

/** Run free rooms sequentially; keep completed results if a later run stops. */
export async function runTenHallSeries({
  count,
  signal,
  onProgress = () => {},
  onResult = () => {},
  confirmLoadout,
  runSimulation = runTenHallSimulation,
  wait = waitBeforeNext,
  ...options
}) {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("模拟次数需为 1 至 20 次");
  }
  const results = [];
  let expectedLoadout;
  for (let index = 0; index < count; index++) {
    try {
      if (index) {
        onProgress(`已完成 ${index} / ${count} 场，等待开始下一场`);
        await wait(signal);
      }
      if (signal?.aborted) throw abortError();
      let recorded = false;
      const recordResult = (result) => {
        if (recorded) return;
        recorded = true;
        results.push(result);
        onResult([...results]);
        if (!loadoutIsConfirmed(result.loadout)) {
          throw new Error("实际出战配置未能全部确认，已停止后续模拟");
        }
        if (index < count - 1 && !result.loadoutSignature) {
          throw new Error("无法核对后续场次的阵容，已停止后续模拟");
        }
      };
      const result = await runSimulation({
        ...options,
        signal,
        expectedLoadout,
        waitForRoomEnd: index < count - 1,
        onBattleResult: recordResult,
        confirmLoadout: index === 0 ? confirmLoadout : undefined,
        onProgress: (message) =>
          onProgress(`第 ${index + 1} / ${count} 场 · ${message}`),
      });
      recordResult(result);
      expectedLoadout = result.loadoutSignature;
    } catch (error) {
      if (!results.length) throw error;
      return { results, error };
    }
  }
  return { results, error: null };
}

/** Unknown outcomes remain separate from the confirmed win rate. */
export function summarizeTenHallResults(results) {
  const wins = results.filter((item) => item.isWin === true).length;
  const losses = results.filter((item) => item.isWin === false).length;
  const unknown = results.length - wins - losses;
  const winRounds = results
    .filter(
      (item) =>
        item.isWin === true && Number.isInteger(item.rounds) && item.rounds > 0,
    )
    .map((item) => item.rounds);
  const averageRounds = winRounds.length
    ? Math.round(
        (winRounds.reduce((sum, value) => sum + value, 0) / winRounds.length) *
          10,
      ) / 10
    : null;
  const noDownWins = results.filter(
    (item) => item.isWin === true && item.downCount === 0,
  ).length;
  const candidates = results
    .map((item, index) => ({ ...item, index: index + 1 }))
    .filter(
      (item) =>
        item.isWin === true &&
        Number.isInteger(item.downCount) &&
        item.downCount >= 0 &&
        Number.isInteger(item.rounds) &&
        item.rounds > 0,
    )
    .sort((a, b) => a.downCount - b.downCount || a.rounds - b.rounds);
  return {
    wins,
    losses,
    unknown,
    averageRounds,
    roundSamples: winRounds.length,
    noDownWins,
    best: candidates[0] || null,
  };
}
