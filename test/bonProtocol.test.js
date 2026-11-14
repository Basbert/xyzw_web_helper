import assert from "node:assert/strict";
import test from "node:test";
import { bon as backendBon } from "../render-backend/lib/bonProtocol.js";
import * as bonProtocolModule from "../src/utils/bonProtocol.js";
import { loadModule } from "./helpers/loadModule.js";

const { bon, getEnc } = bonProtocolModule;

for (const [name, codec] of [
  ["browser", bon],
  ["backend", backendBon],
]) {
  test(`${name} BON preserves nested arrays, repeated strings, and dates`, () => {
    const original = {
      values: ["repeated", "repeated", [0, false, null]],
      created: new Date("2026-01-01T00:00:00.000Z"),
    };
    assert.deepEqual(codec.decode(codec.encode(original)), original);
  });
}

test("encodeCombUserBin generates an lx-encrypted login BIN via bonProtocol without legacy Cocos bundle", async () => {
  const { encodeCombUserBin } = await loadModule(
    new URL("../src/utils/xyzwRuntime.ts", import.meta.url),
    {
      "@/utils/bonProtocol.js": bonProtocolModule,
    },
  );
  const combUser = { uid: 998877, token: "wx-token-xyz" };
  const binBuffer = await encodeCombUserBin(combUser, "1024");
  assert.ok(binBuffer && binBuffer.byteLength > 4);
  const bytes = new Uint8Array(binBuffer);
  assert.equal(bytes[0], 112);
  assert.equal(bytes[1], 108);

  const decrypted = getEnc("lx").decrypt(new Uint8Array(binBuffer));
  const decoded = bon.decode(decrypted);
  assert.deepEqual(decoded, {
    platform: "hortor",
    platformExt: "mix",
    info: combUser,
    serverId: 1024,
    scene: 0,
    referrerInfo: "",
  });
});
