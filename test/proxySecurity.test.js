import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as onHortorUcenterRequest } from "../edge-functions/api/hortor-ucenter/[[default]].js";
import { onRequest as onHortorRequest } from "../edge-functions/api/hortor/[[default]].js";
import { onRequest as onWeixinLongRequest } from "../edge-functions/api/weixin-long/[[default]].js";
import { onRequest as onWeixinRequest } from "../edge-functions/api/weixin/[[default]].js";
import worker from "../worker.js";

function withMockedFetch(impl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("worker enforces origin allow-list, method allow-list, path allow-list, and strips sensitive headers", async () => {
  const calls = [];
  await withMockedFetch(
    async (url, init) => {
      calls.push({ url, headers: init.headers, method: init.method });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async () => {
      // Disallowed cross-origin fails closed.
      const forbiddenOriginRes = await worker.fetch(
        new Request(
          "https://app.example.com/api/weixin/connect/app/qrconnect?appid=1",
          {
            method: "GET",
            headers: { Origin: "https://evil.example.com" },
          },
        ),
        {},
      );
      assert.equal(forbiddenOriginRes.status, 403);
      assert.equal(
        forbiddenOriginRes.headers.get("Access-Control-Allow-Origin"),
        null,
      );

      // Disallowed upstream path & traversal are blocked before calling fetch.
      for (const badPath of [
        "/api/weixin/cgi-bin/login",
        "/api/weixin/connect/app/qrconnect/../../secret",
        "/api/weixin/connect/%2e%2e/app/qrconnect",
        "/api/hortor/comb-login-server/api/v1/other",
      ]) {
        const badRes = await worker.fetch(
          new Request(`https://app.example.com${badPath}`, {
            method: badPath.includes("hortor") ? "POST" : "GET",
          }),
          {},
        );
        assert.equal(badRes.status, 403, `expected 403 for ${badPath}`);
      }

      // Raw un-normalized traversal & backslash paths are also rejected directly.
      for (const rawBadUrl of [
        "https://app.example.com/api/weixin/connect/app/qrconnect/%2e%2e/secret",
        "https://app.example.com/api/weixin/connect/app%5cqrconnect",
      ]) {
        const rawRes = await worker.fetch(
          {
            url: rawBadUrl,
            method: "GET",
            headers: new Headers(),
          },
          {},
        );
        assert.equal(rawRes.status, 403, `expected 403 for ${rawBadUrl}`);
      }

      // Disallowed HTTP method is rejected cleanly.
      const badMethodRes = await worker.fetch(
        new Request(
          "https://app.example.com/api/hortor/comb-login-server/api/v1/login",
          { method: "GET" },
        ),
        {},
      );
      assert.equal(badMethodRes.status, 405);
      assert.equal(calls.length, 0);

      // Allowed custom ALLOWED_ORIGINS + header stripping.
      const okRes = await worker.fetch(
        new Request(
          "https://app.example.com/api/hortor/comb-login-server/api/v1/login?foo=1",
          {
            method: "POST",
            headers: {
              Origin: "https://custom.example.com",
              Cookie: "session=secret",
              Authorization: "Bearer secret",
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: "payload",
          },
        ),
        { ALLOWED_ORIGINS: "https://custom.example.com" },
      );
      assert.equal(okRes.status, 200);
      assert.equal(
        okRes.headers.get("Access-Control-Allow-Origin"),
        "https://custom.example.com",
      );
      assert.equal(okRes.headers.get("Vary"), "Origin");
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "https://comb-platform.hortorgames.com/comb-login-server/api/v1/login?foo=1",
      );
      assert.equal(calls[0].headers.get("cookie"), null);
      assert.equal(calls[0].headers.get("authorization"), null);
      assert.equal(
        calls[0].headers.get("origin"),
        "https://open.weixin.qq.com",
      );
    },
  );
});

test("worker sanitizes upstream failures and delegates static routes to ASSETS", async () => {
  await withMockedFetch(
    async (_url, init) => {
      if (init.signal) {
        const abortErr = new Error("aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      throw new Error("internal upstream secret details");
    },
    async () => {
      const timeoutRes = await worker.fetch(
        new Request(
          "http://localhost:5173/api/weixin/connect/app/qrconnect?appid=1",
          {
            method: "GET",
            headers: { Origin: "http://localhost:5173" },
          },
        ),
        {},
      );
      assert.equal(timeoutRes.status, 504);
      const body = await timeoutRes.json();
      assert.deepEqual(body, { error: "Upstream request timeout" });

      let assetCalled = false;
      const assetRes = await worker.fetch(
        new Request("https://app.example.com/index.html"),
        {
          ASSETS: {
            fetch: async () => {
              assetCalled = true;
              return new Response("<html></html>", { status: 200 });
            },
          },
        },
      );
      assert.equal(assetCalled, true);
      assert.equal(assetRes.status, 200);
    },
  );
});

test("edge-functions share unified path/CORS/header hardening rules", async () => {
  const requests = [];
  await withMockedFetch(
    async (url, init) => {
      requests.push({ url, headers: init.headers });
      return new Response("ok", { status: 200 });
    },
    async () => {
      const weixinRes = await onWeixinRequest({
        request: new Request(
          "https://edge.example.com/api/weixin/connect/l/qrconnect?uuid=123",
          {
            method: "GET",
            headers: {
              Origin: "https://edge.example.com",
              Cookie: "secret=1",
            },
          },
        ),
        env: {},
      });
      assert.equal(weixinRes.status, 200);
      assert.equal(
        requests[0].url,
        "https://open.weixin.qq.com/connect/l/qrconnect?uuid=123",
      );
      assert.equal(requests[0].headers.get("cookie"), null);

      const ucenterOk = await onHortorUcenterRequest({
        request: new Request(
          "https://edge.example.com/api/hortor-ucenter/ucenter-app-server/api/v1/login/verify/code",
          {
            method: "POST",
            headers: { Authorization: "Bearer dropme" },
            body: "{}",
          },
        ),
        env: {},
      });
      assert.equal(ucenterOk.status, 200);
      assert.equal(requests[1].headers.get("authorization"), null);

      const blockedWeixinLong = await onWeixinLongRequest({
        request: new Request(
          "https://edge.example.com/api/weixin-long/connect/app/qrconnect",
          { method: "GET" },
        ),
        env: {},
      });
      assert.equal(blockedWeixinLong.status, 403);

      const badOriginHortor = await onHortorRequest({
        request: new Request(
          "https://edge.example.com/api/hortor/comb-login-server/api/v1/login",
          {
            method: "POST",
            headers: { Origin: "https://attacker.invalid" },
          },
        ),
        env: {},
      });
      assert.equal(badOriginHortor.status, 403);
    },
  );
});
