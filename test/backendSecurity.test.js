import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionMutex,
  isOriginAllowed,
  isValidRecordId,
  sanitizeTaskPayload,
  sanitizeTokenInsert,
} from "../render-backend/lib/security.js";
import { loadModule } from "./helpers/loadModule.js";

async function loadBackendClient(env = {}) {
  return loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {},
      ws: { default: class {} },
    },
    {
      process: { env },
    },
  );
}

test("render-backend CORS allow-list permits localhost and configured origins while denying others", () => {
  assert.equal(isOriginAllowed(undefined, ""), true);
  assert.equal(isOriginAllowed("http://localhost:5173", ""), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:4173", ""), true);
  assert.equal(isOriginAllowed("https://evil.example.com", ""), false);
  assert.equal(
    isOriginAllowed(
      "https://panel.example.com",
      "https://panel.example.com, https://admin.example.com",
    ),
    true,
  );
});

test("render-backend WebSocket URL validator blocks untrusted protocols, credentials, and unknown hosts", async () => {
  const { GameClient, validateWebSocketUrl } = await loadBackendClient();

  assert.equal(
    validateWebSocketUrl("wss://xxz-xyzw.hortorgames.com/agent?e=x"),
    "wss://xxz-xyzw.hortorgames.com/agent?e=x",
  );
  assert.equal(
    validateWebSocketUrl("ws://127.0.0.1:8080/ws"),
    "ws://127.0.0.1:8080/ws",
  );
  assert.equal(
    validateWebSocketUrl("wss://relay.example.com/ws", "relay.example.com"),
    "wss://relay.example.com/ws",
  );

  for (const bad of [
    "",
    "http://xxz-xyzw.hortorgames.com/agent",
    "wss://user:pass@xxz-xyzw.hortorgames.com/agent",
    "wss://evil.example.com/agent",
  ]) {
    assert.throws(() => validateWebSocketUrl(bad), bad);
  }
  assert.throws(
    () =>
      new GameClient(
        { roleToken: "t", roleId: 1 },
        "wss://evil.example.com/ws",
      ),
  );
});

test("render-backend token and task payload sanitizers enforce allow-lists", async () => {
  const { validateWebSocketUrl } = await loadBackendClient();

  assert.equal(isValidRecordId("task_123-abc"), true);
  assert.equal(isValidRecordId("../etc/passwd"), false);

  const tokenPayload = sanitizeTokenInsert(
    {
      name: " 主号 ",
      token: "abc",
      ws_url: "wss://xxz-xyzw.hortorgames.com/agent",
      unexpectedAdminFlag: true,
    },
    (u) => validateWebSocketUrl(u),
  );
  assert.deepEqual(tokenPayload, {
    name: "主号",
    token: "abc",
    ws_url: "wss://xxz-xyzw.hortorgames.com/agent",
  });
  assert.throws(() =>
    sanitizeTokenInsert(
      { name: "主号", token: "abc", ws_url: "http://169.254.169.254/" },
      (u) => validateWebSocketUrl(u),
    ),
  );

  const taskPayload = sanitizeTaskPayload(
    {
      name: "每日",
      cron_expr: "0 8 * * *",
      selected_tokens: ["tok-1"],
      selected_tasks: ["signIn"],
      last_run_at: "tampered",
    },
    { partial: false, validTaskKeys: ["signIn", "claimHangup"] },
  );
  assert.equal("last_run_at" in taskPayload, false);
  assert.throws(() =>
    sanitizeTaskPayload(
      {
        name: "每日",
        cron_expr: "0 8 * * *",
        selected_tokens: ["tok-1"],
        selected_tasks: ["unknownTask"],
      },
      { partial: false, validTaskKeys: ["signIn"] },
    ),
  );
  assert.throws(() =>
    sanitizeTaskPayload(
      {
        name: "每日",
        cron_expr: "0 8 * * *",
        selected_tokens: [123],
        selected_tasks: ["signIn"],
      },
      { partial: false, validTaskKeys: ["signIn"] },
    ),
  );
  assert.throws(() =>
    sanitizeTaskPayload({}, { partial: true, validTaskKeys: ["signIn"] }),
  );
});

test("ExecutionMutex blocks duplicate task runs and serializes per-token execution", async () => {
  const mutex = new ExecutionMutex();
  let releaseFirst;
  const firstHold = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const firstRun = mutex.runTaskExclusive("task-1", () => firstHold);
  assert.equal(mutex.isTaskRunning("task-1"), true);

  const duplicateRun = await mutex.runTaskExclusive(
    "task-1",
    async () => "should-not-run",
  );
  assert.deepEqual(duplicateRun, { skipped: true, reason: "already_running" });

  releaseFirst("done");
  assert.deepEqual(await firstRun, { skipped: false, value: "done" });
  assert.equal(mutex.isTaskRunning("task-1"), false);

  const trace = [];
  await Promise.all([
    mutex.withTokenLock("tok-a", async () => {
      trace.push("start-1");
      await new Promise((r) => setTimeout(r, 20));
      trace.push("end-1");
    }),
    mutex.withTokenLock("tok-a", async () => {
      trace.push("start-2");
      trace.push("end-2");
    }),
  ]);
  assert.deepEqual(trace, ["start-1", "end-1", "start-2", "end-2"]);
});
