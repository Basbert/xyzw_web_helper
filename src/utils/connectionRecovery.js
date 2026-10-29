/** Retry an intended connection without replaying any game commands. */
export function createConnectionRecovery({
  canRecover,
  reconnect,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delays = [1000, 2000, 4000, 8000, 16000],
  stableMs = 30000,
}) {
  const states = new Map();
  let disposed = false;
  const getState = (id) => {
    if (!states.has(id))
      states.set(id, { attempts: 0, retry: null, stable: null });
    return states.get(id);
  };
  const cancel = (id) => {
    const state = states.get(id);
    if (!state) return;
    if (state.retry !== null) clearTimer(state.retry);
    if (state.stable !== null) clearTimer(state.stable);
    states.delete(id);
  };
  const schedule = (id, { reset = false, immediate = false } = {}) => {
    if (disposed || !canRecover(id)) return false;
    const state = getState(id);
    if (state.stable !== null) clearTimer(state.stable);
    state.stable = null;
    if (reset) state.attempts = 0;
    if (reset && immediate && state.retry !== null) {
      clearTimer(state.retry);
      state.retry = null;
    }
    if (state.retry !== null || state.attempts >= delays.length) return false;
    const delay = immediate ? 0 : delays[state.attempts];
    state.retry = setTimer(async () => {
      if (disposed || states.get(id) !== state) return;
      state.retry = null;
      if (!canRecover(id)) return;
      state.attempts++;
      try {
        const started = await reconnect(id);
        if (!started && canRecover(id)) schedule(id);
      } catch {
        if (canRecover(id)) schedule(id);
      }
    }, delay);
    return true;
  };
  const markConnected = (id) => {
    const state = getState(id);
    if (state.retry !== null) clearTimer(state.retry);
    if (state.stable !== null) clearTimer(state.stable);
    state.retry = null;
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
