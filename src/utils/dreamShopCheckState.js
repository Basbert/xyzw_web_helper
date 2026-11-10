import { campClock } from "./campChallenge.js";

export const DREAM_SHOP_CHECK_EVENT = "dream-shop-check-updated";
const KEY_PREFIX = "dream-shop-checked:v1:";

function roleKey(roleId) {
  if (typeof roleId !== "string" && typeof roleId !== "number") return null;
  if (
    typeof roleId === "number" &&
    (!Number.isSafeInteger(roleId) || roleId <= 0)
  )
    return null;
  const id = String(roleId).trim();
  return id && id !== "0" ? `${KEY_PREFIX}${encodeURIComponent(id)}` : null;
}

/** Record only a verified server task day and server-confirmed role ID. */
export function markDreamShopChecked({ roleId, taskDay }, options = {}) {
  try {
    const key = roleKey(roleId);
    if (!key || !Number.isSafeInteger(taskDay) || taskDay <= 0) return false;
    const dayKey = campClock(taskDay * 1000).dayKey;
    const storage = options.storage ?? globalThis.localStorage;
    storage.setItem(key, JSON.stringify({ dayKey }));
    const target = options.target ?? globalThis.window;
    if (target?.dispatchEvent && typeof Event === "function")
      target.dispatchEvent(new Event(DREAM_SHOP_CHECK_EVENT));
    return true;
  } catch {
    // A storage or notification failure must never alter a successful purchase.
    return false;
  }
}

/** Compare against the caller's current Shanghai calendar day. */
export function isDreamShopChecked({ roleId, dayKey }, options = {}) {
  try {
    const key = roleKey(roleId);
    if (!key || typeof dayKey !== "string" || !/^\d{6}$/.test(dayKey))
      return false;
    const storage = options.storage ?? globalThis.localStorage;
    const value = JSON.parse(storage.getItem(key) || "null");
    return value?.dayKey === dayKey;
  } catch {
    return false;
  }
}

/** Same-tab event plus native cross-tab storage notifications. */
export function subscribeDreamShopChecks(listener, target = globalThis.window) {
  if (!target?.addEventListener || typeof listener !== "function")
    return () => {};
  const onStorage = (event) => {
    if (event.key === null || event.key?.startsWith(KEY_PREFIX)) listener();
  };
  target.addEventListener(DREAM_SHOP_CHECK_EVENT, listener);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(DREAM_SHOP_CHECK_EVENT, listener);
    target.removeEventListener("storage", onStorage);
  };
}
