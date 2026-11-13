interface LegacyGameCrypto {
  encMsg: (
    payload: Record<string, unknown>,
    codec: { decrypt: unknown; encrypt: unknown },
  ) => ArrayBuffer | ArrayBufferView;
  lz4XorDecode: unknown;
  lz4XorEncode: unknown;
}

let runtimePromise: Promise<void> | null = null;

/**
 * Lazily loads the XYZW Cocos runtime and game crypto registry on demand
 * so initial page startup does not parse legacy game scripts eagerly.
 */
export async function ensureXyzwRuntime(): Promise<void> {
  if (typeof (globalThis as { __require?: unknown }).__require === "function") {
    return;
  }
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await import("../xyzw/cocos2d-js-min.js");
      await import("../xyzw/game-defines.js");
      await import("../xyzw/index.js");
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  await runtimePromise;
}

/** Loads the legacy Cocos module `"13"` crypto helpers on demand. */
export async function getGameCrypto(): Promise<LegacyGameCrypto> {
  await ensureXyzwRuntime();
  const requireFn = (
    globalThis as { __require?: (id: string) => LegacyGameCrypto | undefined }
  ).__require;
  const dm = requireFn?.("13");
  if (!dm?.encMsg || !dm?.lz4XorEncode || !dm?.lz4XorDecode) {
    throw new Error("游戏加密模块未加载，无法生成登录 BIN");
  }
  return dm;
}

/** Encodes a Hortor `combUser` payload into an encrypted login BIN buffer. */
export async function encodeCombUserBin(
  combUser: unknown,
  serverId: string | number | null = null,
): Promise<ArrayBuffer> {
  const dm = await getGameCrypto();
  const encrypted = dm.encMsg(
    {
      platform: "hortor",
      platformExt: "mix",
      info: combUser,
      serverId: serverId == null ? null : Number(serverId),
      scene: 0,
      referrerInfo: "",
    },
    { decrypt: dm.lz4XorDecode, encrypt: dm.lz4XorEncode },
  );
  if (encrypted instanceof ArrayBuffer) {
    return encrypted.slice(0);
  }
  const bytes = new Uint8Array(
    encrypted.buffer,
    encrypted.byteOffset,
    encrypted.byteLength,
  );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
