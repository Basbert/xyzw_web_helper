import { reactive, watch } from "vue";

export const DAILY_TASK_DEFAULTS = Object.freeze({
  arenaFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimLegacy: true,
  claimEmail: true,
  blackMarketPurchase: true,
  dreamShopPurchase: true,
  commandDelay: 500,
  taskDelay: 500,
});

const roleIdentity = (roleId) => {
  if (roleId === undefined || roleId === null) return null;
  const id = String(roleId).trim();
  return id && id !== "0" ? id : null;
};
const tokenKey = (token) => `daily-settings:${token.id}`;
const roleKey = (token) => {
  const roleId = roleIdentity(token?.roleId);
  return roleId ? `daily-role-settings:${encodeURIComponent(roleId)}` : null;
};
const parseSettings = (value) => {
  if (!value) return null;
  try {
    const result = JSON.parse(value);
    return result && typeof result === "object" && !Array.isArray(result)
      ? result
      : null;
  } catch {
    return null;
  }
};

// Used only when existing settings cannot be trusted. First-time users keep
// the established defaults; a damaged record must not enable paid actions.
export const SAFE_DAILY_TASK_DEFAULTS = Object.freeze({
  ...DAILY_TASK_DEFAULTS,
  payRecruit: false,
  blackMarketPurchase: false,
  dreamShopPurchase: false,
});

const executionDefaults = {
  ...DAILY_TASK_DEFAULTS,
  towerFormation: 1,
  freeGachaEnable: true,
};
const settingsConflict = (left, right) =>
  Object.entries(executionDefaults).some(
    ([key, fallback]) => (left[key] ?? fallback) !== (right[key] ?? fallback),
  );

/** Refuse damaged or ambiguous records before an execution can spend resources. */
export function readDailyTaskSettingsForExecution(
  token,
  tokens = [],
  storage = globalThis.localStorage,
) {
  if (!token?.id) throw new Error("无法识别角色，请检查每日任务设置");
  const inspect = (key) => {
    if (!key) return null;
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed = parseSettings(raw);
    if (!parsed) throw new Error("每日任务设置记录损坏，请前往日常页核对设置");
    for (const [name, fallback] of Object.entries(executionDefaults)) {
      if (!Object.prototype.hasOwnProperty.call(parsed, name)) continue;
      const value = parsed[name];
      if (
        (typeof fallback === "boolean" && typeof value !== "boolean") ||
        (typeof fallback === "number" &&
          (!Number.isSafeInteger(value) || value < 0))
      )
        throw new Error("每日任务设置值无效，请前往日常页核对设置");
    }
    return parsed;
  };
  const stableKey = roleKey(token);
  const stable = inspect(stableKey);
  const current = inspect(tokenKey(token));
  if (stable && current && settingsConflict(stable, current))
    throw new Error("每日任务设置存在冲突，请前往日常页核对设置");
  if (!stable && !current && stableKey) {
    const candidates = tokens
      .filter(
        (other) =>
          other.id !== token.id &&
          roleIdentity(other.roleId) === roleIdentity(token.roleId),
      )
      .map((other) => inspect(tokenKey(other)))
      .filter(Boolean);
    if (candidates.some((value) => settingsConflict(value, candidates[0])))
      throw new Error("每日任务设置存在冲突，请前往日常页核对设置");
  }
  return readDailyTaskSettings(token, tokens, storage);
}

/** Read a role's settings, migrating the previous token-specific format. */
export function readDailyTaskSettings(
  token,
  tokens = [],
  storage = globalThis.localStorage,
) {
  if (!token?.id) return null;
  const stableKey = roleKey(token);
  const stable = stableKey && parseSettings(storage.getItem(stableKey));
  const current = parseSettings(storage.getItem(tokenKey(token)));
  let saved = stable || current;

  if (!saved && stableKey) {
    const candidates = tokens
      .filter(
        (other) =>
          other.id !== token.id &&
          roleIdentity(other.roleId) === roleIdentity(token.roleId),
      )
      .map((other) => parseSettings(storage.getItem(tokenKey(other))))
      .filter(Boolean);
    if (
      candidates.length &&
      candidates.every((value) => !settingsConflict(value, candidates[0]))
    )
      saved = candidates[0];
  }

  if (!saved) return null;
  const serialized = JSON.stringify(saved);
  if (stableKey && !stable) storage.setItem(stableKey, serialized);
  if (!current) {
    storage.setItem(tokenKey(token), serialized);
  }
  return saved;
}

/** Keep the role-based and existing token-based keys in sync. */
export function writeDailyTaskSettings(
  token,
  values,
  storage = globalThis.localStorage,
) {
  if (!token?.id) throw new Error("无法识别当前角色，设置未保存");
  const stableKey = roleKey(token);
  const existing =
    (stableKey && parseSettings(storage.getItem(stableKey))) ||
    parseSettings(storage.getItem(tokenKey(token))) ||
    {};
  const serialized = JSON.stringify({ ...existing, ...values });
  storage.setItem(tokenKey(token), serialized);
  if (stableKey) storage.setItem(stableKey, serialized);
}

/** Explicit user action: replace damaged records with conservative defaults. */
export function resetDailyTaskSettings(
  token,
  storage = globalThis.localStorage,
) {
  if (!token?.id) throw new Error("无法识别当前角色，设置未保存");
  const serialized = JSON.stringify(SAFE_DAILY_TASK_DEFAULTS);
  storage.setItem(tokenKey(token), serialized);
  const stableKey = roleKey(token);
  if (stableKey) storage.setItem(stableKey, serialized);
}

/** Bind the settings form to the currently selected role without cross-role writes. */
export function useDailyTaskSettings(
  tokenStore,
  onError = () => {},
  controls = {},
) {
  const settings = reactive({ ...DAILY_TASK_DEFAULTS });
  let owner = null;
  let restoring = false;

  controls.reset = () => {
    if (!owner) throw new Error("请先选择角色");
    restoring = true;
    try {
      resetDailyTaskSettings(owner);
      Object.assign(settings, SAFE_DAILY_TASK_DEFAULTS);
    } finally {
      restoring = false;
    }
  };

  watch(
    settings,
    (values) => {
      if (restoring || !owner) return;
      try {
        writeDailyTaskSettings(owner, values);
      } catch (error) {
        onError(error);
      }
    },
    { deep: true, flush: "sync" },
  );

  watch(
    [
      () => tokenStore.selectedToken?.id,
      () => tokenStore.selectedToken?.roleId,
    ],
    ([tokenId, roleId]) => {
      restoring = true;
      owner = tokenId ? { id: tokenId, roleId } : null;
      try {
        const saved = owner
          ? readDailyTaskSettingsForExecution(
              owner,
              tokenStore.gameTokens || [],
            )
          : null;
        for (const key of Object.keys(DAILY_TASK_DEFAULTS)) {
          settings[key] = saved?.[key] ?? DAILY_TASK_DEFAULTS[key];
        }
      } catch (error) {
        Object.assign(settings, SAFE_DAILY_TASK_DEFAULTS);
        onError(error);
      } finally {
        restoring = false;
      }
    },
    { immediate: true, flush: "sync" },
  );

  return settings;
}
