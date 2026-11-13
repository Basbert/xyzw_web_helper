// This worker only schedules heartbeats. It never receives credentials or game commands.
globalThis.onmessage = ({ data }) => {
  const interval = Number(data?.interval);
  if (!Number.isFinite(interval) || interval < 1000) return;
  setTimeout(() => globalThis.postMessage("tick"), 3000);
  setInterval(() => globalThis.postMessage("tick"), interval);
};
