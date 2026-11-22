/**
 * Monotonic server-time estimation helper shared by Dashboard and status cards.
 * Anchors the last observed server timestamp to a monotonic local clock so
 * countdowns keep advancing smoothly between network heartbeats and remain
 * immune to wall-clock adjustments.
 */

export function readMonotonicMs() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

export function createServerTimeSample(
  serverTimeMs,
  monotonicMs = readMonotonicMs(),
) {
  const numeric = Number(serverTimeMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return {
    serverTimeMs: numeric,
    sampledAtMs: monotonicMs,
  };
}

export function updateServerTimeSample(
  previousSample,
  serverTimeMs,
  monotonicMs = readMonotonicMs(),
) {
  const numeric = Number(serverTimeMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (
    previousSample &&
    previousSample.serverTimeMs === numeric &&
    Number.isFinite(previousSample.sampledAtMs)
  ) {
    return previousSample;
  }
  return {
    serverTimeMs: numeric,
    sampledAtMs: monotonicMs,
  };
}

export function getEstimatedServerNowSec(
  sample,
  fallbackWallClockMs = Date.now(),
  monotonicMs = readMonotonicMs(),
) {
  if (
    sample &&
    Number.isFinite(sample.serverTimeMs) &&
    sample.serverTimeMs > 0 &&
    Number.isFinite(sample.sampledAtMs)
  ) {
    const elapsedMs = Math.max(0, monotonicMs - sample.sampledAtMs);
    return (sample.serverTimeMs + elapsedMs) / 1000;
  }
  return Number(fallbackWallClockMs) / 1000;
}
