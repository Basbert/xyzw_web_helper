import { onMounted, onUnmounted, ref } from "vue";
import { listenForThemeChanges } from "@/utils/themeListener.js";

const THEME_STORAGE_KEY = "theme";
const VALID_THEME_MODES = new Set(["auto", "light", "dark"]);

// 全局响应式主题状态
const isDark = ref(false);
const themeMode = ref("auto");

/**
 * Normalize a persisted or user-selected theme value.
 * @param {string | null | undefined} value Raw mode string.
 * @returns {"auto" | "light" | "dark"} Normalized mode.
 */
export function normalizeThemeMode(value) {
  return VALID_THEME_MODES.has(value) ? value : "auto";
}

/**
 * Read the stored theme preference without mutating storage.
 * @returns {"auto" | "light" | "dark"} Stored theme mode or `"auto"`.
 */
export function getStoredThemeMode() {
  if (typeof localStorage === "undefined") {
    return "auto";
  }
  return normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
}

const getSystemPrefersDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

// 检查当前主题状态
const checkCurrentTheme = () => {
  if (typeof document === "undefined") {
    return false;
  }
  return (
    document.documentElement.classList.contains("dark") ||
    document.documentElement.getAttribute("data-theme") === "dark"
  );
};

// 更新响应式状态
const updateReactiveState = () => {
  isDark.value = checkCurrentTheme();
};

/**
 * Apply a theme mode consistently to `html`, `body`, and reactive refs.
 * @param {string | null | undefined} [mode] Requested theme mode.
 * @param {{ persist?: boolean }} [options] Whether to persist mode to localStorage.
 * @returns {boolean} Whether dark mode is active after application.
 */
export function applyThemeMode(
  mode = getStoredThemeMode(),
  { persist = false } = {},
) {
  const nextMode = normalizeThemeMode(mode);
  const dark =
    nextMode === "dark" || (nextMode === "auto" && getSystemPrefersDark());

  if (typeof document !== "undefined") {
    const { documentElement, body } = document;
    documentElement.classList.toggle("dark", dark);
    documentElement.style.colorScheme = dark ? "dark" : "light";
    if (dark) {
      documentElement.setAttribute("data-theme", "dark");
    } else {
      documentElement.removeAttribute("data-theme");
    }
    if (body) {
      body.classList.toggle("dark", dark);
      if (dark) {
        body.setAttribute("data-theme", "dark");
      } else {
        body.removeAttribute("data-theme");
      }
    }
  }

  if (persist && typeof localStorage !== "undefined") {
    localStorage.setItem(THEME_STORAGE_KEY, nextMode);
  }

  const changed = isDark.value !== dark || themeMode.value !== nextMode;
  themeMode.value = nextMode;
  isDark.value = dark;

  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("theme-change", {
        detail: { isDark: dark, mode: nextMode },
      }),
    );
  }

  return dark;
}

/**
 * Initialize DOM theme classes and attributes from stored preference.
 * @returns {boolean} Whether dark mode is active.
 */
export function initTheme() {
  return applyThemeMode(getStoredThemeMode(), { persist: false });
}

/**
 * Share reactive theme state while owning each instance's media listeners.
 * @returns {object} Theme state, setters, initialization and listener setup functions.
 */
export function useTheme() {
  let removeSystemThemeListener = null;

  // 设置深色主题
  const setDarkTheme = () => applyThemeMode("dark", { persist: true });

  // 设置浅色主题
  const setLightTheme = () => applyThemeMode("light", { persist: true });

  // 设置主题模式（支持 auto / light / dark）
  const setThemeMode = (mode) => applyThemeMode(mode, { persist: true });

  // 切换主题
  const toggleTheme = () => {
    if (isDark.value) {
      setLightTheme();
    } else {
      setDarkTheme();
    }
  };

  // 监听系统主题变化
  /** Register one system-theme listener per composable instance. */
  const setupSystemThemeListener = () => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    removeSystemThemeListener?.();
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredThemeMode() === "auto") {
        applyThemeMode("auto", { persist: false });
      }
    };
    removeSystemThemeListener = listenForThemeChanges(mediaQuery, onChange);
  };

  // 清理监听器
  const cleanup = () => {
    removeSystemThemeListener?.();
    removeSystemThemeListener = null;
  };

  // 获取当前主题
  const getCurrentTheme = () => {
    return isDark.value ? "dark" : "light";
  };

  // 组件挂载时同步状态
  onMounted(() => {
    updateReactiveState();
    themeMode.value = getStoredThemeMode();
  });

  // 组件卸载时清理
  onUnmounted(() => {
    cleanup();
  });

  return {
    isDark,
    themeMode,
    initTheme,
    toggleTheme,
    setDarkTheme,
    setLightTheme,
    setThemeMode,
    setupSystemThemeListener,
    getCurrentTheme,
    updateReactiveState,
  };
}
