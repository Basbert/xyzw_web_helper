import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

/** Load either real client with deterministic timers and no network access. */
async function createClient(file, exportName, extraGlobals = {}, options = {}) {
  let nextId = 0;
  const timers = new Map();
  const intervals = new Map();
  const errors = [];
  const cacheKeys = [];
  const deletedCacheKeys = [];
  const logger = {
    info() {},
    debug() {},
    verbose() {},
    wsMessage() {},
    warn() {},
    error(...args) {
      errors.push(args);
    },
  };
  const utils = {
    bon: {
      encode(value) {
        return value;
      },
    },
  };
  const dependencies = {
    "@/stores/cache": {
      $CacheManager: {
        getCache(name) {
          cacheKeys.push(name);
          return {};
        },
        delCache(name) {
          deletedCacheKeys.push(name);
        },
      },
    },
    "./bonProtocol.js": { g_utils: utils },
    "./logger.js": { gameLogger: logger, wsLogger: logger },
    "./helperTaskRunner.js": {
      sleep: options.sleep || (async () => {}),
    },
  };
  const globals = {
    WebSocket: { OPEN: 1 },
    setTimeout(callback) {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      const id = ++nextId;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    ...extraGlobals,
  };
  const exports = await loadModule(
    new URL(`../src/utils/${file}`, import.meta.url),
    dependencies,
    globals,
  );
  const client = new exports[exportName]({
    url: options.url || "ws://example.invalid",
    utils,
  });
  client.connected = true;
  client.socket = { readyState: 1, send() {}, close() {} };
  return { client, timers, intervals, errors, cacheKeys, deletedCacheKeys };
}

for (const [file, name] of [
  ["xyzwWebSocket.js", "XyzwWebSocketClient"],
  ["xyzwLegionWarWebSocket.js", "XyzwLegionWarWebSocketClient"],
]) {
  test(`${name} clears request timers for sequence and legacy command responses`, async () => {
    const { client, timers } = await createClient(file, name);
    const first = client.sendWithPromise("role_getroleinfo");
    assert.equal(timers.size, 1);
    client._handlePromiseResponse({ resp: client.seq, code: 0, body: "first" });
    assert.equal(await first, "first");
    assert.equal(timers.size, 0);
    const second = client.sendWithPromise("role_getroleinfo");
    client._handlePromiseResponse({
      cmd: "role_getroleinforesp",
      code: 0,
      body: "second",
    });
    assert.equal(await second, "second");
    assert.equal(timers.size, 0);
  });

  test(`${name} rejects outstanding requests and clears timers on connection cleanup`, async () => {
    const { client, timers } = await createClient(file, name);
    const pending = client.sendWithPromise("role_getroleinfo");
    const rejected = assert.rejects(pending, /连接已关闭/);
    client._clearTimers();
    await rejected;
    assert.equal(timers.size, 0);
    assert.equal(Object.keys(client.promises).length, 0);
  });

  test(`${name} processes a delayed queue entry without an undefined sleep`, async () => {
    const { client, timers, errors } = await createClient(file, name);
    client.send("heart_beat", {}, { sleep: 1 });
    client._processQueueLoop();
    await timers.get(client.sendQueueTimer)();
    assert.equal(client.sendQueue.length, 0);
    assert.deepEqual(errors, []);
    client._clearTimers();
  });

  test(`${name} waits for delayed send sleep before scheduling the next queue tick`, async () => {
    let releaseSleep;
    const { client, timers } = await createClient(
      file,
      name,
      {},
      {
        sleep: () =>
          new Promise((resolve) => {
            releaseSleep = resolve;
          }),
      },
    );
    const sent = [];
    const secondCmd =
      file === "xyzwWebSocket.js"
        ? "role_getroleinfo"
        : "war_getbattlefieldinfo";
    client.socket.send = (packet) => sent.push(packet);
    client.send("heart_beat", {}, { sleep: 50 });
    client.send(secondCmd);
    client._processQueueLoop();

    const firstTimerId = client.sendQueueTimer;
    const firstTick = timers.get(firstTimerId)();
    await Promise.resolve();
    assert.equal(sent.length, 1);
    assert.equal(client.sendQueue.length, 1);
    // Next tick must not run while sleep is suspended.
    assert.equal(client.sendQueueTimer, firstTimerId);

    releaseSleep();
    await firstTick;
    assert.notEqual(client.sendQueueTimer, firstTimerId);

    await timers.get(client.sendQueueTimer)();
    assert.equal(sent.length, 2);
    assert.equal(client.sendQueue.length, 0);
    client._clearTimers();
  });
}

test("game client notifies additional subscribers without replacing the store listener", async () => {
  const { client } = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
  );
  const received = [];
  client.setMessageListener((packet) => received.push(`store:${packet.cmd}`));
  const unsubscribe = client.subscribeMessages((packet) =>
    received.push(`extra:${packet.cmd}`),
  );
  client._dispatchMessage({ cmd: "pkroom_fightnotify" });
  unsubscribe();
  client._dispatchMessage({ cmd: "other" });
  assert.deepEqual(received, [
    "store:pkroom_fightnotify",
    "extra:pkroom_fightnotify",
    "store:other",
  ]);
});

test("heartbeat worker sends directly while the normal command queue is delayed and is cleaned up", async () => {
  const workers = [];
  class WorkerStub {
    constructor(path) {
      this.path = path;
      workers.push(this);
    }
    postMessage(value) {
      this.settings = value;
    }
    terminate() {
      this.terminated = true;
    }
  }
  const { client, intervals, timers } = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    { Worker: WorkerStub },
  );
  const sent = [];
  let heartbeatCount = 0;
  client.socket.send = (packet) => sent.push(packet);
  client.onHeartbeat = () => {
    heartbeatCount++;
  };
  client.send("role_getroleinfo");
  client._setupHeartbeat();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].settings.interval, 5000);
  workers[0].onmessage({ data: "tick" });
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0]).cmd, "_sys/ack");
  assert.equal(JSON.parse(sent[0]).seq, 0);
  assert.equal(heartbeatCount, 1);
  // Backlogged Worker events must not cause a burst of heartbeats on resume.
  workers[0].onmessage({ data: "tick" });
  assert.equal(sent.length, 1);
  assert.equal(client.sendQueue.length, 1);
  assert.equal(intervals.size, 0);
  client._clearTimers();
  assert.equal(workers[0].terminated, true);
  assert.equal(timers.size, 0);
  workers[0].onmessage?.({ data: "tick" });
  assert.equal(sent.length, 1);
  assert.equal(heartbeatCount, 1);
});

test("a handshake without browser callbacks times out and becomes recoverable", async () => {
  class StalledSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
    }
    close() {
      this.closed = true;
    }
  }
  const { client, timers } = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    { WebSocket: StalledSocket },
  );
  client.socket = null;
  client.connected = false;
  let disconnects = 0;
  client.onDisconnect = () => {
    disconnects++;
  };
  client.init();
  const socket = client.socket;
  const handshake = timers.get(client.handshakeTimer);
  assert.ok(handshake);
  handshake();
  assert.equal(socket.closed, true);
  assert.equal(client.socket, null);
  assert.equal(disconnects, 1);
  assert.equal(timers.size, 0);
  socket.onclose({ code: 1006 });
  assert.equal(disconnects, 1);
});

test("a WebSocket error closes and reports the connection even if no close event arrives", async () => {
  class ErrorSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
    }
    close() {
      this.closed = true;
    }
  }
  const { client, timers } = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    { WebSocket: ErrorSocket },
  );
  client.socket = null;
  client.connected = false;
  let disconnects = 0;
  client.onDisconnect = () => {
    disconnects++;
  };
  client.init();
  const socket = client.socket;
  socket.onerror(new Error("network"));
  assert.equal(socket.closed, true);
  assert.equal(client.socket, null);
  assert.equal(disconnects, 1);
  assert.equal(timers.size, 0);
  socket.onclose({ code: 1006 });
  assert.equal(disconnects, 1);
});

test("a successful handshake cancels the watchdog and cannot be closed by an old timeout", async () => {
  class OpenSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
    }
    close() {
      this.closed = true;
    }
    send() {}
  }
  const { client, timers } = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    { WebSocket: OpenSocket },
  );
  client.socket = null;
  client.connected = false;
  let disconnects = 0;
  client.onDisconnect = () => {
    disconnects++;
  };
  client.init();
  const socket = client.socket;
  const watchdog = timers.get(client.handshakeTimer);
  const watchdogId = client.handshakeTimer;
  socket.readyState = 1;
  socket.onopen();
  assert.equal(timers.has(watchdogId), false);
  watchdog();
  assert.equal(client.connected, true);
  assert.equal(socket.closed, undefined);
  assert.equal(disconnects, 0);
  client._clearTimers();
});

test("heartbeat falls back to timers if worker creation or startup fails", async () => {
  class BrokenWorker {
    constructor() {
      throw new Error("blocked");
    }
  }
  const unavailable = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    { Worker: BrokenWorker },
  );
  unavailable.client._setupHeartbeat();
  assert.equal(unavailable.timers.size, 1);
  assert.equal(unavailable.intervals.size, 1);
  unavailable.client._clearTimers();
  assert.equal(unavailable.timers.size, 0);
  assert.equal(unavailable.intervals.size, 0);

  let worker;
  class AsyncBrokenWorker {
    constructor() {
      worker = this;
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  const fallback = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    { Worker: AsyncBrokenWorker },
  );
  fallback.client._setupHeartbeat();
  worker.onerror({ preventDefault() {} });
  assert.equal(worker.terminated, true);
  assert.equal(fallback.timers.size, 1);
  assert.equal(fallback.intervals.size, 1);
  fallback.client._clearTimers();
});

test("game WebSocket cache key omits URL credentials and releases on disconnect", async () => {
  const { client, cacheKeys, deletedCacheKeys } = await createClient(
    "xyzwWebSocket.js",
    "XyzwWebSocketClient",
    {},
    { url: "wss://game.example.invalid/?p=secret-token" },
  );
  assert.equal(cacheKeys.length, 1);
  assert.equal(cacheKeys[0].includes("secret-token"), false);
  assert.equal(cacheKeys[0].includes("wss://"), false);
  client.disconnect();
  assert.deepEqual(deletedCacheKeys, [cacheKeys[0]]);
});

test("legion war WebSocket closes socket and reports disconnect on error without close", async () => {
  class ErrorSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
    }
    close() {
      this.closed = true;
    }
  }
  const { client, timers } = await createClient(
    "xyzwLegionWarWebSocket.js",
    "XyzwLegionWarWebSocketClient",
    { WebSocket: ErrorSocket },
  );
  client.socket = null;
  client.connected = false;
  let disconnects = 0;
  client.onDisconnect = () => {
    disconnects++;
  };
  client.init();
  const socket = client.socket;
  socket.onerror(new Error("network"));
  assert.equal(socket.closed, true);
  assert.equal(client.socket, null);
  assert.equal(disconnects, 1);
  assert.equal(timers.size, 0);
  socket.onclose({ code: 1006 });
  assert.equal(disconnects, 1);
});
