import { encode, getEnc } from "@/utils/bonProtocol.js";

export interface LegacyGameCrypto {
  encMsg: (
    payload: Record<string, unknown>,
    codec: {
      decrypt?: unknown;
      encrypt: (bytes: Uint8Array) => Uint8Array;
    },
  ) => ArrayBuffer | ArrayBufferView;
  lz4XorDecode: (bytes: Uint8Array) => Uint8Array;
  lz4XorEncode: (bytes: Uint8Array) => Uint8Array;
}

const lxCodec = getEnc("lx");

/**
 * Compatibility no-op kept for callers expecting the runtime initializer.
 * Using `bonProtocol` directly avoids loading the legacy 4MB Cocos bundle.
 */
export async function ensureXyzwRuntime(): Promise<void> {}

/** Returns the BON + LZ4-XOR ("lx") crypto helpers for encoding login BIN payloads. */
export async function getGameCrypto(): Promise<LegacyGameCrypto> {
  const requireFn = (
    globalThis as {
      __require?: (id: string) => Partial<LegacyGameCrypto> | undefined;
    }
  ).__require;
  const legacyDm =
    typeof requireFn === "function" ? requireFn("13") : undefined;
  if (
    typeof legacyDm?.encMsg === "function" &&
    typeof legacyDm.lz4XorEncode === "function" &&
    typeof legacyDm.lz4XorDecode === "function"
  ) {
    return legacyDm as LegacyGameCrypto;
  }
  return {
    encMsg: (payload, codec) =>
      encode(payload, {
        encrypt: codec?.encrypt ?? lxCodec.encrypt,
        decrypt: codec?.decrypt ?? lxCodec.decrypt,
      }),
    lz4XorDecode: lxCodec.decrypt,
    lz4XorEncode: lxCodec.encrypt,
  };
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
  if (ArrayBuffer.isView(encrypted)) {
    const bytes = new Uint8Array(
      encrypted.buffer,
      encrypted.byteOffset,
      encrypted.byteLength,
    );
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
  const copy = new Uint8Array(encrypted.byteLength);
  copy.set(new Uint8Array(encrypted));
  return copy.buffer;
}
