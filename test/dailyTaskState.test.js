import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getClaimablePointRewards,
  getDailyTaskStates,
  loadDailyTaskConfig,
  validateDailyTaskConfig,
} from "../src/utils/dailyTaskState.js";

function officialConfig() {
  return {
    DailyTaskConf: {
      1: { id: 1, completeCondition: 6, completeValue: 3 },
      8: { id: 8, completeCondition: 13, completeValue: 1 },
      9: { id: 9, completeCondition: 12, completeValue: 1 },
    },
    DayLimitConf: { 1: { id: 1, limit: 20 }, 2: { id: 2, limit: 40 } },
    WeekLimitConf: { 1: { id: 1, limit: 100 }, 2: { id: 2, limit: 200 } },
  };
}
function officialBundle() {
  const uuids = Array.from({ length: 10 }, () => null);
  uuids[9] = "7cuVHMuxpM/41XwmFGubmZ";
  return {
    name: "config",
    paths: { 9: ["config", 0] },
    types: ["cc.JsonAsset"],
    uuids,
    versions: { import: [9, "1c043"] },
  };
}
function officialAsset(config = officialConfig()) {
  return [null, null, null, null, null, [[0, "config", config]]];
}
const assetUrl =
  "https://xxz-xyzw-res.hortorgames.com/remote/config/import/7c/7cb951cc-bb1a-4cff-8d57-c26146b9b999.1c043.json";
function role(complete = {}) {
  return { dailyTask: { dailyTime: 1700000000, complete } };
}

test("server counters distinguish unfinished, completed-unclaimed and claimed", () => {
  const config = validateDailyTaskConfig(officialConfig());
  const states = getDailyTaskStates(role({ 6: 2, 13: 1, 12: -1 }), config);
  assert.equal(states[0].status, "pending");
  assert.equal(states[0].remaining, 1);
  assert.equal(states[1].status, "claimable");
  assert.equal(states[1].id, 8);
  assert.equal(states[2].status, "claimed");
  assert.equal(states[2].id, 9);
});

test("progress above target requires claiming, not repeating the action", () => {
  const states = getDailyTaskStates(
    role({ 6: 20 }),
    validateDailyTaskConfig(officialConfig()),
  );
  assert.equal(states[0].status, "claimable");
  assert.equal(states[0].remaining, 0);
});

test("an absent counter in a valid server map means zero; null does not", () => {
  const config = validateDailyTaskConfig(officialConfig());
  assert.equal(getDailyTaskStates(role(), config)[0].remaining, 3);
  assert.throws(
    () => getDailyTaskStates(role({ 6: null }), config),
    /进度无效/,
  );
});

test("missing or malformed server task data cannot be treated as completed", () => {
  const config = validateDailyTaskConfig(officialConfig());
  for (const input of [
    {},
    { dailyTask: {} },
    { dailyTask: { dailyTime: 1, complete: [] } },
  ]) {
    assert.throws(() => getDailyTaskStates(input, config), /列表不完整/);
  }
  for (const count of [-2, "3", 1.5])
    assert.throws(
      () => getDailyTaskStates(role({ 6: count }), config),
      /进度无效/,
    );
});

test("official targets are used instead of client hardcoded thresholds", () => {
  const raw = officialConfig();
  raw.DailyTaskConf[1].completeValue = 5;
  assert.equal(
    getDailyTaskStates(role({ 6: 3 }), validateDailyTaskConfig(raw))[0]
      .remaining,
    2,
  );
});

test("invalid or duplicate configuration stops execution", () => {
  const raw = officialConfig();
  raw.DailyTaskConf[8].completeCondition = 6;
  assert.throws(() => validateDailyTaskConfig(raw), /配置无效/);
  assert.throws(() => validateDailyTaskConfig({}), /配置无效/);
});

test("point reward selection uses server points and claimed map for daily and weekly rewards", () => {
  const config = validateDailyTaskConfig(officialConfig());
  const daily = {
    dailyPoint: 40,
    dailyReward: { 1: true },
    weekPoint: 150,
    weekReward: {},
  };
  assert.deepEqual(getClaimablePointRewards(daily, config.dailyRewards), [2]);
  assert.deepEqual(
    getClaimablePointRewards(daily, config.weeklyRewards, true),
    [1],
  );
  assert.throws(
    () => getClaimablePointRewards({ dailyPoint: 40 }, config.dailyRewards),
    /不完整/,
  );
  assert.throws(
    () =>
      getClaimablePointRewards(
        { dailyPoint: 40, dailyReward: { 1: "true" } },
        config.dailyRewards,
      ),
    /不完整/,
  );
});

test("config version is verified each run while immutable configuration requests are merged", async () => {
  let reads = 0;
  let versions = 0;
  const store = {
    async sendMessageWithPromise() {
      versions++;
      return { dataBundleVer: "test-config-merge" };
    },
  };
  const fetchConfig = async (url) => {
    reads++;
    return {
      ok: true,
      json: async () => (url === assetUrl ? officialAsset() : officialBundle()),
    };
  };
  const [a, b] = await Promise.all([
    loadDailyTaskConfig(store, "a", fetchConfig),
    loadDailyTaskConfig(store, "b", fetchConfig),
  ]);
  assert.equal(a, b);
  assert.equal(reads, 2);
  assert.equal(versions, 2);
});

test("使用账号服务器的数据版本，解析官方配置包和资源哈希", async () => {
  const requests = [];
  const commands = [];
  const store = {
    async sendMessageWithPromise(id, cmd) {
      commands.push([id, cmd]);
      return { dataBundleVer: "152261a3c8" };
    },
  };
  const fetchConfig = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => (url === assetUrl ? officialAsset() : officialBundle()),
    };
  };
  const config = await loadDailyTaskConfig(store, "account", fetchConfig);
  assert.deepEqual(commands, [["account", "system_getdatabundlever"]]);
  assert.deepEqual(requests, [
    "https://xxz-xyzw-res.hortorgames.com/remote/config/config.152261a3c8.json",
    assetUrl,
  ]);
  assert.equal(config.tasks[0].completeValue, 3);
  assert.equal(config.dailyRewards[1].limit, 40);
});

test("版本化配置包不存在时，只能回退到同一版本的旧地址", async () => {
  const requests = [];
  const version = "legacy-version-404";
  const config = await loadDailyTaskConfig(
    { sendMessageWithPromise: async () => ({ dataBundleVer: version }) },
    "account",
    async (url) => {
      requests.push(url);
      if (url.includes("/remote/config/config."))
        return { ok: false, status: 404 };
      return { ok: true, json: async () => officialConfig() };
    },
  );
  assert.equal(config.tasks.length, 3);
  assert.deepEqual(requests, [
    `https://xxz-xyzw-res.hortorgames.com/remote/config/config.${version}.json`,
    `https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`,
  ]);
});

test("配置包或任务表无法确认时停止，不使用其他版本", async () => {
  for (const problem of [
    "bundle",
    "type",
    "asset",
    "asset-format",
    "invalid-json",
    "task-table",
    "http",
  ]) {
    const requests = [];
    const bundle = officialBundle();
    if (problem === "bundle") bundle.versions.import = [];
    if (problem === "type") bundle.types = ["cc.BufferAsset"];
    const config = officialConfig();
    if (problem === "task-table") delete config.DailyTaskConf;
    await assert.rejects(
      loadDailyTaskConfig(
        {
          sendMessageWithPromise: async () => ({
            dataBundleVer: `invalid-official-${problem}`,
          }),
        },
        "account",
        async (url) => {
          requests.push(url);
          if (problem === "http") return { ok: false, status: 404 };
          if (url === assetUrl) {
            if (problem === "asset") return { ok: false, status: 503 };
            return {
              ok: true,
              json: async () => {
                if (problem === "invalid-json") throw new SyntaxError("bad");
                const asset = officialAsset(config);
                if (problem === "asset-format") asset[5][0][1] = "other";
                return asset;
              },
            };
          }
          return { ok: true, json: async () => bundle };
        },
      ),
      /无效|读取失败/,
      problem,
    );
    assert.ok(
      requests.every((url) => !url.includes("78fbc")),
      problem,
    );
    if (["bundle", "type"].includes(problem)) assert.equal(requests.length, 1);
    if (problem === "asset") assert.equal(requests.length, 2);
  }
});

test("配置文件超时会提示重试且不使用缓存的错误结果", async () => {
  const store = {
    sendMessageWithPromise: async () => ({
      dataBundleVer: "timeout-config-retry",
    }),
  };
  await assert.rejects(
    loadDailyTaskConfig(store, "account", async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }),
    /请求超时/,
  );
  const config = await loadDailyTaskConfig(store, "account", async (url) => ({
    ok: true,
    json: async () => (url === assetUrl ? officialAsset() : officialBundle()),
  }));
  assert.equal(config.tasks.length, 3);
});

test("两种配置地址均不可用时提示各自的 HTTP 状态", async () => {
  await assert.rejects(
    loadDailyTaskConfig(
      {
        sendMessageWithPromise: async () => ({
          dataBundleVer: "both-sources-unavailable",
        }),
      },
      "account",
      async (url) => ({
        ok: false,
        status: url.includes("/remote/config/") ? 404 : 503,
      }),
    ),
    /配置包 HTTP 404，旧地址 HTTP 503/,
  );
});

test("failed config reads can be retried and unsafe versions are rejected", async () => {
  let attempt = 0;
  const store = {
    async sendMessageWithPromise() {
      return { dataBundleVer: "test-config-retry" };
    },
  };
  const fetchConfig = async (url) =>
    url.includes("/remote/config/config.")
      ? { ok: false, status: 404 }
      : { ok: ++attempt > 1, status: 404, json: async () => officialConfig() };
  await assert.rejects(
    loadDailyTaskConfig(store, "a", fetchConfig),
    /读取失败/,
  );
  await loadDailyTaskConfig(store, "a", fetchConfig);
  assert.equal(attempt, 2);
  await assert.rejects(
    loadDailyTaskConfig(
      {
        async sendMessageWithPromise() {
          return { dataBundleVer: "../invalid" };
        },
      },
      "a",
      fetchConfig,
    ),
    /有效/,
  );
});

test("duplicate point-reward IDs are rejected before duplicate claims can be scheduled", () => {
  for (const name of ["DayLimitConf", "WeekLimitConf"]) {
    const config = officialConfig();
    config[name][2].id = config[name][1].id;
    assert.throws(() => validateDailyTaskConfig(config), /无效/);
  }
});

test("an evicted failed config request cannot remove a newer cached request for the same version", async () => {
  let rejectFirst;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let readsA = 0;
  const store = {
    sendMessageWithPromise: async (id) => ({ dataBundleVer: id }),
  };
  const fetchConfig = async (url) => {
    if (url.includes("cache-race-a") && ++readsA === 1) {
      entered();
      return new Promise((resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return {
      ok: true,
      json: async () => (url === assetUrl ? officialAsset() : officialBundle()),
    };
  };
  const first = loadDailyTaskConfig(store, "cache-race-a", fetchConfig);
  const rejected = assert.rejects(first, /网络异常/);
  await started;
  await loadDailyTaskConfig(store, "cache-race-b", fetchConfig);
  await loadDailyTaskConfig(store, "cache-race-a", fetchConfig);
  rejectFirst(new Error("first request failed"));
  await rejected;
  await loadDailyTaskConfig(store, "cache-race-a", fetchConfig);
  assert.equal(readsA, 2);
});
