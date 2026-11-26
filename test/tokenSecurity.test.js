import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

async function loadTokenModule(axiosMock) {
  return loadModule(
    new URL("../src/utils/token.ts", import.meta.url),
    {
      axios: { default: axiosMock },
      "crypto-js": {
        enc: { Hex: "hex" },
        lib: { WordArray: { create: () => ({}) } },
        MD5: () => ({ toString: () => "id" }),
      },
      "@/utils/bonProtocol": {
        g_utils: {
          parse: (data) => ({
            getData: () => data,
          }),
        },
      },
    },
    {
      AbortController,
      setTimeout,
      clearTimeout,
    },
  );
}

test("validateTokenSourceUrl accepts http(s) URLs and rejects unsafe schemes, credentials, and metadata hosts", async () => {
  const { validateTokenSourceUrl } = await loadTokenModule({
    post: async () => ({}),
  });

  assert.equal(
    validateTokenSourceUrl("  https://example.com/token.json  ").toString(),
    "https://example.com/token.json",
  );
  assert.equal(
    validateTokenSourceUrl("http://127.0.0.1:8080/token").hostname,
    "127.0.0.1",
  );

  for (const invalidUrl of [
    "",
    "not-a-url",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pass@example.com/token",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0:3000/token",
    "http://metadata.google.internal/computeMetadata/v1/",
  ]) {
    assert.throws(() => validateTokenSourceUrl(invalidUrl), invalidUrl);
  }
});

test("fetchTokenPayloadFromUrl enforces timeout, safe fetch options, and JSON validation", async () => {
  const { fetchTokenPayloadFromUrl } = await loadTokenModule({
    post: async () => ({}),
  });

  const calls = [];
  const data = await fetchTokenPayloadFromUrl("https://example.com/t.json", {
    timeoutMs: 2500,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "abc" }),
      };
    },
  });
  assert.deepEqual(data, { token: "abc" });
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  assert.ok(calls[0].init.signal);

  await assert.rejects(
    fetchTokenPayloadFromUrl("https://example.com/slow.json", {
      timeoutMs: 15,
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    }),
    /请求超时/,
  );

  await assert.rejects(
    fetchTokenPayloadFromUrl("https://example.com/unavailable.json", {
      fetcher: async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
    /暂时无法访问 Token 来源/,
  );

  await assert.rejects(
    fetchTokenPayloadFromUrl("https://example.com/limited.json", {
      fetcher: async () => ({ ok: false, status: 429 }),
    }),
    { message: "HTTP 状态码：429", status: 429 },
  );

  await assert.rejects(
    fetchTokenPayloadFromUrl("https://example.com/bad.json", {
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ["not-an-object"],
      }),
    }),
    /返回数据格式无效/,
  );
});

test("transformToken and getServerList configure timeouts and omit invalid referrerPolicy header", async () => {
  const requests = [];
  const { transformToken, getServerList } = await loadTokenModule({
    post: async (url, _body, config) => {
      requests.push({ url, config });
      return {
        data: {
          roleId: "1",
          roleToken: "synthetic-role-token",
          roles: { 1001: {} },
        },
      };
    },
  });

  await transformToken(new ArrayBuffer(8));
  await getServerList(new ArrayBuffer(8));

  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.equal(typeof req.config.timeout, "number");
    assert.ok(req.config.timeout > 0);
    assert.equal(req.config.headers.referrerPolicy, undefined);
  }
});

test("game login and role-list exchanges preserve explicit protocol rejection", async () => {
  const { transformToken, getServerList } = await loadModule(
    new URL("../src/utils/token.ts", import.meta.url),
    {
      axios: {
        default: {
          post: async () => ({
            data: { error: "token expired", code: 401 },
          }),
        },
      },
      "crypto-js": {
        enc: { Hex: "hex" },
        lib: { WordArray: { create: () => ({}) } },
        MD5: () => ({ toString: () => "id" }),
      },
      "@/utils/bonProtocol": {
        g_utils: {
          parse: (data) => ({
            error: data.error,
            code: data.code,
            getData: () => null,
          }),
        },
      },
    },
    { AbortController, setTimeout, clearTimeout },
  );

  for (const exchange of [transformToken, getServerList]) {
    await assert.rejects(exchange(new ArrayBuffer(8)), {
      message: "登录凭据校验失败：token expired",
      loginErrorReason: "token expired",
    });
  }
});

test("transformToken rejects empty objects and payloads without credential fields", async () => {
  for (const payload of [
    {},
    { roleToken: "" },
    { roleToken: "   " },
    { roleId: "123456" },
    { uid: "u1", openId: "o1" },
    { foo: "bar" },
  ]) {
    const { transformToken } = await loadTokenModule({
      post: async () => ({ data: payload }),
    });
    await assert.rejects(
      transformToken(new ArrayBuffer(8)),
      /登录接口响应缺少凭据字段/,
    );
  }
});
