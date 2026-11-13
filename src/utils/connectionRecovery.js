/** Retry an intended connection without replaying any game commands. */
export function createConnectionRecovery({
  canRecover,
  shouldKeepTrying = canRecover,
  reconnect,
  onState = /** @type {(id: string, state: string) => void} */ (() => {}),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delays = [1000, 2000, 4000, 8000, 16000],
  slowRetryMs = 60000,
  stableMs = 30000,
}) {
  const states = new Map();
  let disposed = false;
  const getState = (id) => {
    if (!states.has(id))
      states.set(id, {
        attempts: 0,
        retry: null,
        stable: null,
        recovering: false,
      });
    return states.get(id);
  };
  const cancel = (id) => {
    const state = states.get(id);
    if (!state) return;
    if (state.retry !== null) clearTimer(state.retry);
    if (state.stable !== null) clearTimer(state.stable);
    states.delete(id);
    onState(id, "stopped");
  };
  const schedule = (id, { reset = false, immediate = false } = {}) => {
    if (disposed || !shouldKeepTrying(id)) return false;
    const state = getState(id);
    if (!state.recovering) {
      state.recovering = true;
      onState(id, "waiting");
    }
    if (state.stable !== null) clearTimer(state.stable);
    state.stable = null;
    if (reset) state.attempts = 0;
    if (reset && immediate && state.retry !== null) {
      clearTimer(state.retry);
      state.retry = null;
    }
    if (state.retry !== null) return false;
    const available = canRecover(id);
    const delay = !available
      ? slowRetryMs
      : immediate
        ? 0
        : (delays[state.attempts] ?? slowRetryMs);
    state.retry = setTimer(async () => {
      if (disposed || states.get(id) !== state) return;
      state.retry = null;
      if (!shouldKeepTrying(id)) {
        cancel(id);
        return;
      }
      if (!canRecover(id)) {
        schedule(id);
        return;
      }
      state.attempts = Math.min(state.attempts + 1, delays.length);
      try {
        const started = await reconnect(id);
        if (!started && states.get(id) === state && shouldKeepTrying(id))
          schedule(id);
      } catch {
        if (states.get(id) === state && shouldKeepTrying(id)) schedule(id);
      }
    }, delay);
    return true;
  };
  const markConnected = (id) => {
    const state = getState(id);
    if (state.retry !== null) clearTimer(state.retry);
    if (state.stable !== null) clearTimer(state.stable);
    state.retry = null;
    if (state.recovering) {
      state.recovering = false;
      onState(id, "restored");
    }
    state.stable = setTimer(() => {
      if (states.get(id) !== state) return;
      state.stable = null;
      state.attempts = 0;
    }, stableMs);
  };
  const dispose = () => {
    disposed = true;
    for (const id of states.keys()) cancel(id);
  };
  return { schedule, markConnected, cancel, dispose };
}
