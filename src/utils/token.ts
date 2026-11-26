import axios from "axios";
import { enc, lib, MD5 } from "crypto-js";
import { g_utils } from "@/utils/bonProtocol";

/**
 * Derive the existing storage identity from the exact credential bytes.
 * @param {string|ArrayBuffer|Uint8Array} token Credential data used by the token store.
 * @returns {string} Hexadecimal digest used as the stable local token key.
 */
export const getTokenId = (token: string | ArrayBuffer | Uint8Array) => {
  const binHash = MD5(
    lib.WordArray.create(token as Parameters<typeof lib.WordArray.create>[0]),
  ).toString(enc.Hex);
  return binHash;
};

type WaitCallback = (waitTimeMs: number, queueSize: number) => void;

class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private requests: number[] = [];
  private queueSize: number = 0;
  private onWaitCallback: WaitCallback | null = null;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  onWait(callback: WaitCallback): void {
    this.onWaitCallback = callback;
  }

  private cleanOldRequests(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((time) => time > cutoff);
  }

  private async waitForSlot(): Promise<void> {
    this.cleanOldRequests();

    if (this.requests.length < this.maxRequests) {
      this.requests.push(Date.now());
      return;
    }

    const oldestRequest = this.requests[0] ?? Date.now();
    const waitTime = oldestRequest + this.windowMs - Date.now();

    if (waitTime > 0) {
      // 每秒更新一次剩余时间
      const updateInterval = 1000;
      const totalWaitTime = waitTime + 100;
      const startTime = Date.now();

      const updateCallback = () => {
        if (this.onWaitCallback) {
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, totalWaitTime - elapsed);
          this.onWaitCallback(remaining, this.queueSize);
        }
      };

      // 初始通知
      updateCallback();

      // 设置定时更新
      const intervalId = setInterval(updateCallback, updateInterval);

      try {
        await new Promise((resolve) => setTimeout(resolve, totalWaitTime));
      } finally {
        clearInterval(intervalId);
      }
    }

    return this.waitForSlot();
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    this.queueSize++;
    try {
      await this.waitForSlot();
      return fn();
    } finally {
      this.queueSize--;
    }
  }
}

const authUserRateLimiter = new RateLimiter(25, 60000);

export const setAuthUserRateLimiterCallback = (
  callback: WaitCallback,
): void => {
  authUserRateLimiter.onWait(callback);
};

/**
 * Schedule a login operation within the shared authentication rate window.
 * @template T
 * @param {Function} fn Asynchronous login operation.
 * @returns {Promise<T>} Resolves with the operation result, or rejects with its error.
 */
export const scheduleAuthUserRequest = <T>(
  fn: () => Promise<T>,
): Promise<T> => {
  return authUserRateLimiter.schedule(fn);
};

const BLOCKED_TOKEN_URL_HOSTS = new Set([
  "0.0.0.0",
  "[::]",
  "metadata.google.internal",
]);
const LINK_LOCAL_HOST_RE = /^169\.254\./;
const DEFAULT_TOKEN_HTTP_TIMEOUT_MS = 15000;

/**
 * Validate a user-supplied URL used for fetching token payloads.
 * @param {string} rawUrl Candidate URL string.
 * @returns {URL} Parsed and validated HTTP(S) URL.
 */
export const validateTokenSourceUrl = (rawUrl: string): URL => {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    throw new Error("请输入 Token 源 URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("请输入有效的 HTTP(S) URL 地址");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 http 或 https 协议的 URL");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URL 不允许包含内嵌账号或密码");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    BLOCKED_TOKEN_URL_HOSTS.has(host) ||
    LINK_LOCAL_HOST_RE.test(host)
  ) {
    throw new Error("不支持访问该目标主机地址");
  }

  return parsed;
};

/**
 * Fetch and validate a JSON token payload from a remote or local URL with timeout protection.
 * @param {string} rawUrl Candidate URL string.
 * @param {object} [options] Optional timeout and fetch implementation overrides.
 * @param {number} [options.timeoutMs] Request timeout in milliseconds.
 * @param {Function} [options.fetcher] Custom fetch implementation for testing.
 * @returns {Promise<Record<string, unknown>>} Parsed JSON object payload.
 */
export const fetchTokenPayloadFromUrl = async (
  rawUrl: string,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<Record<string, unknown>> => {
  const parsed = validateTokenSourceUrl(rawUrl);
  const timeoutMs = options.timeoutMs ?? 10000;
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(parsed.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    }).catch((error: unknown) => {
      const timedOut =
        controller.signal.aborted ||
        (typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "AbortError");
      throw new Error(
        timedOut ? `请求超时（${timeoutMs}ms）` : "暂时无法访问 Token 来源",
      );
    });

    if (!response.ok) {
      throw Object.assign(new Error(`HTTP 状态码：${response.status}`), {
        status: response.status,
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error("返回数据不是有效的 JSON 格式");
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("返回数据格式无效");
    }

    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timeoutId);
  }
};

const assertLoginResponseOk = (message: {
  error?: unknown;
  code?: unknown;
}) => {
  if (
    !message?.error &&
    !(Number.isInteger(message?.code) && Number(message.code) !== 0)
  )
    return;
  const loginErrorReason =
    typeof message.error === "string" ? message.error.trim() : "";
  const detail = loginErrorReason || `错误码 ${String(message.code)}`;
  throw Object.assign(new Error(`登录凭据校验失败：${detail}`), {
    loginErrorReason,
  });
};

/**
 * Exchange credential bytes through the shared login limiter and create session metadata.
 * @param {ArrayBuffer} arrayBuffer Imported credential bytes.
 * @returns {Promise<string>} Serialized role token for the WebSocket connection.
 */
export const transformToken = async (arrayBuffer: ArrayBuffer) => {
  return authUserRateLimiter.schedule(async () => {
    const res = await axios.post(
      "https://xxz-xyzw.hortorgames.com/login/authuser",
      arrayBuffer,
      {
        params: {
          _seq: 1,
        },
        timeout: DEFAULT_TOKEN_HTTP_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/octet-stream",
        },
        responseType: "arraybuffer",
      },
    );
    const msg = g_utils.parse(res.data) as {
      error?: unknown;
      code?: unknown;
      getData: () => unknown;
    };
    assertLoginResponseOk(msg);
    const rawData = msg?.getData();
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      throw new Error("登录接口响应格式无法识别");
    }
    const data = rawData as Record<string, unknown>;
    const credentialKeys = ["roleToken", "token", "gameToken"];
    const hasCredentialField = credentialKeys.some((key) => {
      const value = data[key];
      return typeof value === "string" && value.trim().length > 0;
    });
    if (!hasCredentialField) {
      throw new Error("登录接口响应缺少凭据字段");
    }
    const currentTime = Date.now();
    const sessId = currentTime * 100 + Math.floor(Math.random() * 100);
    const connId = currentTime + Math.floor(Math.random() * 10);

    return JSON.stringify({
      ...data,
      sessId,
      connId,
      isRestore: 0,
    });
  });
};

export const getServerList = async (arrayBuffer: ArrayBuffer) => {
  // 如果是data URL格式，提取base64部分
  const res = await axios.post(
    "https://xxz-xyzw.hortorgames.com/login/serverlist",
    arrayBuffer,
    {
      params: {
        _seq: 3,
      },
      timeout: DEFAULT_TOKEN_HTTP_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/octet-stream",
      },
      responseType: "arraybuffer",
    },
  );
  // console.log("res:", res);

  const msg = g_utils.parse(res.data);
  // console.log("解析结果:", msg);
  if (msg?.error) assertLoginResponseOk(msg);

  const data = (msg.getData() ?? {}) as { roles?: Record<string, unknown> };
  return JSON.stringify({
    ...(data.roles ?? {}),
  });
};
