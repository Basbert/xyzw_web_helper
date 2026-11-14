import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosError } from "axios";
import { loadModule } from "./helpers/loadModule.js";

// The real Axios request/response pipeline runs with an adapter that never
// performs network I/O. All credentials and responses below are synthetic.
async function loadTokenModule(client, parse) {
  return loadModule(new URL("../src/utils/token.ts", import.meta.url), {
    axios: { default: client },
    "crypto-js": {
      enc: { Hex: "hex" },
      lib: { WordArray: { create: () => ({}) } },
      MD5: () => ({ toString: () => "fixture" }),
    },
    "@/utils/bonProtocol": { g_utils: { parse } },
  });
}

test("real Axios preserves binary login bodies, arraybuffer responses and sequence parameters", async () => {
  const calls = [];
  const decodedResponses = [];
  const client = axios.create({
    adapter: async (config) => {
      calls.push({
        url: axios.getUri(config),
        bytes: [...new Uint8Array(config.data)],
        method: config.method,
        contentType: config.headers.get("Content-Type"),
        responseType: config.responseType,
        timeout: config.timeout,
      });
      const responseBytes = Uint8Array.from([config.params._seq, 99]).buffer;
      return {
        data: responseBytes,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/octet-stream" },
        config,
      };
    },
  });
  const { transformToken, getServerList } = await loadTokenModule(
    client,
    (data) => {
      assert.ok(data instanceof ArrayBuffer);
      const bytes = [...new Uint8Array(data)];
      decodedResponses.push(bytes);
      return {
        getData: () =>
          bytes[0] === 1
            ? { roleId: "synthetic-role" }
            : { roles: { server1: { name: "synthetic" } } },
      };
    },
  );

  const fixture = Uint8Array.from([0, 127, 128, 255]).buffer;
  const token = JSON.parse(await transformToken(fixture));
  const servers = JSON.parse(await getServerList(fixture));

  assert.equal(token.roleId, "synthetic-role");
  assert.equal(typeof token.sessId, "number");
  assert.deepEqual(servers, { server1: { name: "synthetic" } });
  assert.deepEqual(decodedResponses, [
    [1, 99],
    [3, 99],
  ]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/login\/authuser\?_seq=1$/);
  assert.match(calls[1].url, /\/login\/serverlist\?_seq=3$/);
  for (const call of calls) {
    assert.equal(call.method, "post");
    assert.deepEqual(call.bytes, [0, 127, 128, 255]);
    assert.equal(call.contentType, "application/octet-stream");
    assert.equal(call.responseType, "arraybuffer");
    assert.ok(Number.isFinite(call.timeout) && call.timeout > 0);
  }
});

test("real Axios timeout and server errors propagate without an automatic login retry", async () => {
  for (const code of [AxiosError.ECONNABORTED, AxiosError.ERR_BAD_RESPONSE]) {
    let attempts = 0;
    let parsed = false;
    const client = axios.create({
      adapter: async (config) => {
        attempts++;
        assert.ok(config.timeout > 0);
        throw new AxiosError("synthetic transport failure", code, config);
      },
    });
    const { transformToken, getServerList } = await loadTokenModule(
      client,
      () => {
        parsed = true;
      },
    );
    const request =
      code === AxiosError.ECONNABORTED ? transformToken : getServerList;
    await assert.rejects(request(new ArrayBuffer(2)), (error) => {
      assert.equal(error.code, code);
      return true;
    });
    assert.equal(attempts, 1);
    assert.equal(parsed, false);
  }
});
