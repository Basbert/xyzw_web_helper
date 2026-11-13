const MINUTE = 60_000;
const GRACE = 30 * MINUTE;
const SEARCH_LIMIT = 24 * 60 * MINUTE;

const fingerprint = (task) => JSON.stringify(task);
const minuteStart = (value) => Math.floor(value / MINUTE) * MINUTE;

function matchesTask(task, value, matchesCron) {
  const date = new Date(value);
  if (task.runType === "cron") return matchesCron(task.cronExpression, date);
  if (task.runType !== "daily") return false;
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}` === task.runTime;
}

/** Observe only while this page is alive; never reconstruct older page sessions. */
export function createScheduledTaskClock({ tasks = [], now, matchesCron }) {
  const states = new Map();
  let highWater = now;

  function observe(items, at) {
    const live = new Set();
    for (const task of items) {
      if (!task?.id) continue;
      live.add(task.id);
      const signature = fingerprint(task);
      if (states.get(task.id)?.signature !== signature) {
        states.set(task.id, { signature, checkedAt: Math.max(at, highWater) });
      }
    }
    for (const id of states.keys()) if (!live.has(id)) states.delete(id);
  }

  observe(tasks, now);
  function poll(items, at) {
    observe(items, at);
    if (at < highWater) {
      // Do not replay earlier minutes after the system clock was moved back.
      for (const state of states.values()) state.checkedAt = highWater;
      return { due: [], missed: [], errors: [] };
    }
    highWater = at;
    const due = [];
    const missed = [];
    const errors = [];
    for (const task of items) {
      const state = states.get(task.id);
      if (!state) continue;
      const previous = state.checkedAt;
      state.checkedAt = at;
      if (!task.enabled || previous >= at) continue;
      const first = minuteStart(previous) + MINUTE;
      const last = minuteStart(at);
      const oldest = Math.max(first, last - SEARCH_LIMIT);
      let latest = null;
      let old = false;
      try {
        for (let minute = last; minute >= oldest; minute -= MINUTE) {
          if (!matchesTask(task, minute, matchesCron)) continue;
          if (at - minute <= GRACE && latest === null) latest = minute;
          if (at - minute > GRACE) {
            old = true;
            break;
          }
        }
      } catch (error) {
        errors.push({ task, error });
        continue;
      }
      const snapshot = JSON.parse(fingerprint(task));
      if (latest !== null) due.push({ task: snapshot, time: latest });
      if (old || first < oldest) missed.push({ task: snapshot, unknown: !old });
    }
    return { due, missed, errors };
  }
  return { observe, poll };
}

function executionKey(task, value) {
  const date = new Date(value);
  return `${task.id}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}_${date.getHours()}_${date.getMinutes()}`;
}

function lastExecutionTime(task, value) {
  if (value === null) return null;
  const prefix = `${task.id}_`;
  if (!value.startsWith(prefix)) return Number.NaN;
  const parts = value.slice(prefix.length).split("_");
  if (parts.length !== 5 || parts.some((part) => !/^\d+$/.test(part)))
    return Number.NaN;
  const [year, month, day, hour, minute] = parts.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute
    ? date.getTime()
    : Number.NaN;
}

/** Check again immediately before a delayed plan is allowed to execute. */
export function validateScheduledOccurrence({
  storage,
  task,
  time,
  now = Date.now(),
}) {
  if (!Number.isFinite(time) || now - time > GRACE || now < time)
    return { status: "expired" };
  try {
    const stored = JSON.parse(storage.getItem("scheduledTasks") || "null");
    const current =
      Array.isArray(stored) && stored.find((item) => item.id === task.id);
    if (!current?.enabled || fingerprint(current) !== fingerprint(task))
      return { status: "stale" };
    return { status: "valid" };
  } catch (error) {
    return { status: "error", error };
  }
}

/** Serialize scheduled execution across tabs, then revalidate after waiting. */
export async function runScheduledOccurrence({
  locks,
  storage,
  task,
  time,
  execute,
  isActive = () => true,
  now = Date.now,
}) {
  if (!locks || typeof locks.request !== "function")
    return { status: "stopped", reason: "unsupported" };
  return locks.request("xyzw-scheduled-batch-run", async () => {
    if (!isActive()) return { status: "stopped", reason: "closed" };
    const validation = validateScheduledOccurrence({
      storage,
      task,
      time,
      now: now(),
    });
    if (validation.status !== "valid")
      return { status: "stopped", reason: validation.status };
    return execute();
  });
}

/** A cross-tab lock and shared storage marker must both succeed before enqueue. */
export async function claimScheduledOccurrence({
  locks,
  storage,
  task,
  time,
  enqueue,
  onError = () => {},
  now = Date.now,
  isActive = () => true,
  canEnqueue = () => true,
}) {
  if (!locks || typeof locks.request !== "function")
    return { status: "unsupported" };
  try {
    return await locks.request(`xyzw-scheduled-task:${task.id}`, (lock) => {
      if (!lock) return { status: "busy" };
      if (!isActive()) return { status: "closed" };
      const validation = validateScheduledOccurrence({
        storage,
        task,
        time,
        now: now(),
      });
      if (validation.status !== "valid") return validation;
      if (!canEnqueue()) return { status: "already-pending" };
      const key = `lastTaskExecution_${task.id}`;
      const value = executionKey(task, time);
      const previousRaw = storage.getItem(key);
      const previous = lastExecutionTime(task, previousRaw);
      if (Number.isNaN(previous)) return { status: "unknown-marker" };
      if (previous !== null && previous >= time) return { status: "duplicate" };
      storage.setItem(key, value);
      const rollbackMarker = () => {
        if (storage.getItem(key) !== value) return;
        if (previousRaw === null) {
          if (typeof storage.removeItem === "function") storage.removeItem(key);
        } else {
          storage.setItem(key, previousRaw);
        }
      };
      try {
        Promise.resolve(enqueue(JSON.parse(fingerprint(task))))
          .then((result) => {
            if (
              result?.status === "stopped" &&
              (!result.reason || result.reason === "closed")
            ) {
              rollbackMarker();
            }
          })
          .catch((error) => {
            rollbackMarker();
            onError(error);
          });
      } catch (error) {
        rollbackMarker();
        onError(error);
      }
      return { status: "queued" };
    });
  } catch (error) {
    return { status: "error", error };
  }
}
