/** Serialize scheduled plans and wait for any manually started batch to finish. */
export function createScheduledRunQueue({
  isBusy,
  execute,
  onPendingChange = () => {},
  wait = () => new Promise((resolve) => setTimeout(resolve, 250)),
}) {
  let tail = Promise.resolve();
  let generation = 0;
  let pending = 0;
  let closed = false;
  const controllers = new Set();

  const enqueue = (run) => {
    const ticket = generation;
    const controller = new AbortController();
    controllers.add(controller);
    const isCancelled = () =>
      closed || ticket !== generation || controller.signal.aborted;
    pending++;
    onPendingChange(pending);
    const result = tail.then(async () => {
      while (isBusy()) {
        if (isCancelled()) return { status: "stopped", started: false };
        await wait();
      }
      if (isCancelled()) return { status: "stopped", started: false };
      return execute(run, { isCancelled, signal: controller.signal });
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    result.then(
      () => {
        controllers.delete(controller);
        onPendingChange(--pending);
      },
      () => {
        controllers.delete(controller);
        onPendingChange(--pending);
      },
    );
    return result;
  };

  const cancelPending = () => {
    generation++;
    for (const controller of controllers) controller.abort();
  };
  const close = () => {
    closed = true;
    cancelPending();
  };
  return { enqueue, cancelPending, close };
}

/** Convert per-step account statuses into a conservative plan result. */
export function summarizeScheduledRun(
  steps,
  { stopped = false, missing = 0 } = {},
) {
  if (stopped) return "stopped";
  const completed = steps.filter((step) => step.status === "completed").length;
  const failed = steps.some((step) => step.status === "failed");
  const unconfirmed = steps.some((step) => step.status !== "completed");
  if (!steps.length) return "pending";
  if (failed && completed === 0) return "failed";
  if (failed || unconfirmed || missing)
    return completed ? "partial" : "pending";
  return "completed";
}
