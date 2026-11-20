export const CONFIG_BUNDLE_BASE =
  "https://xxz-xyzw-res.hortorgames.com/remote/config/";

// Cocos Creator stores most asset UUIDs in a compact 22-character form.
function decodeUuid(value) {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  )
    return value.toLowerCase();
  if (
    typeof value !== "string" ||
    value.length !== 22 ||
    !/^[0-9a-f]{2}/i.test(value)
  )
    throw new Error("官方配置资源标识无效");
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let hex = value.slice(0, 2);
  for (let i = 2; i < value.length; i += 2) {
    const first = chars.indexOf(value[i]);
    const second = chars.indexOf(value[i + 1]);
    if (first < 0 || second < 0) throw new Error("官方配置资源标识无效");
    hex += (first >> 2).toString(16);
    hex += (((first & 3) << 2) | (second >> 4)).toString(16);
    hex += (second & 15).toString(16);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Resolve a named JSON asset using the game bundle's own UUID and hash. */
export function getAssetInfo(bundle, name) {
  const entries = Object.entries(bundle?.paths || {}).filter(
    ([, path]) => Array.isArray(path) && path[0] === name,
  );
  if (entries.length !== 1)
    throw new Error(`官方配置包缺少有效的 ${name} 资源`);
  if (!/^(?:0|[1-9]\d*)$/.test(entries[0][0]))
    throw new Error("官方配置资源索引无效");
  const index = Number(entries[0][0]);
  if (!Number.isSafeInteger(index) || index < 0)
    throw new Error("官方配置资源索引无效");
  const typeIndex = entries[0][1][1];
  if (
    !Array.isArray(bundle?.types) ||
    bundle.types[typeIndex] !== "cc.JsonAsset"
  )
    throw new Error(`官方配置资源 ${name} 的类型无效`);
  const uuid = decodeUuid(bundle?.uuids?.[index]);
  const versions = bundle?.versions?.import;
  if (!Array.isArray(versions) || versions.length % 2 !== 0)
    throw new Error("官方配置资源版本列表无效");
  const matches = [];
  for (let i = 0; i < versions.length; i += 2) {
    if (versions[i] === index) matches.push(versions[i + 1]);
  }
  const version = matches[0];
  if (
    matches.length !== 1 ||
    typeof version !== "string" ||
    !/^[a-z\d]+$/i.test(version)
  )
    throw new Error(`官方配置资源 ${name} 的版本无效`);
  return {
    version,
    url: `${CONFIG_BUNDLE_BASE}import/${uuid.slice(0, 2)}/${uuid}.${version}.json`,
  };
}

/** Extract the named object from a Cocos JSON asset. */
export function unpackAsset(asset, name) {
  const entries = Array.isArray(asset?.[5]) ? asset[5] : [];
  const matching = entries.filter((entry) => entry?.[1] === name);
  const payload = matching[0]?.[2];
  if (
    matching.length !== 1 ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  )
    throw new Error(`官方配置资源 ${name} 的内容无效`);
  return payload;
}
