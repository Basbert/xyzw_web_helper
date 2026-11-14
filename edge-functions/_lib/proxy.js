/**
 * 边缘函数统一反向代理安全封装
 * 提供来源校验（CORS）、路径前缀白名单、请求头净化、超时控制与脱敏错误响应。
 */

const SAFE_REQUEST_HEADERS = [
  "accept-language",
  "content-length",
  "content-type",
];

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const DEFAULT_TIMEOUT_MS = 15000;
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

export function parseAllowedOrigins(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin, requestUrl, env = {}) {
  if (!origin) return true;
  if (origin === requestUrl.origin) return true;
  if (LOCALHOST_ORIGIN_RE.test(origin)) return true;

  const configured = parseAllowedOrigins(env?.ALLOWED_ORIGINS);
  if (configured.includes("*")) return true;
  return configured.includes(origin);
}

export function buildCorsHeaders(origin, allowedMethods) {
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": [...allowedMethods, "OPTIONS"].join(", "),
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonError(status, message, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isAllowedUpstreamPath(upstreamPath, allowedPathPrefixes) {
  if (!Array.isArray(allowedPathPrefixes) || allowedPathPrefixes.length === 0) {
    return false;
  }
  return allowedPathPrefixes.some((prefix) =>
    prefix.endsWith("/")
      ? upstreamPath.startsWith(prefix)
      : upstreamPath === prefix || upstreamPath.startsWith(`${prefix}/`),
  );
}

export function resolveSafeUpstreamUrl(requestUrl, route) {
  const normalizedPrefix = route.prefix.replace(/\/+$/, "");
  const pathname = requestUrl.pathname;
  if (
    pathname !== normalizedPrefix &&
    !pathname.startsWith(`${normalizedPrefix}/`)
  ) {
    return { error: "Invalid proxy route", status: 404 };
  }

  const suffix = pathname.slice(normalizedPrefix.length + 1);
  if (!suffix || suffix.includes("\\") || suffix.startsWith("/")) {
    return { error: "Path not allowed", status: 403 };
  }

  let decoded;
  try {
    decoded = decodeURIComponent(suffix);
  } catch {
    return { error: "Invalid request path", status: 400 };
  }

  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    /(?:^|\/)\.\.(?:\/|$)/.test(decoded)
  ) {
    return { error: "Path not allowed", status: 403 };
  }

  const upstreamPath = `/${suffix}`;
  if (!isAllowedUpstreamPath(upstreamPath, route.allowedPathPrefixes)) {
    return { error: "Path not allowed", status: 403 };
  }

  const baseUrl = new URL(route.target);
  const resolved = new URL(`${upstreamPath}${requestUrl.search}`, baseUrl);
  if (resolved.origin !== baseUrl.origin) {
    return { error: "Path not allowed", status: 403 };
  }

  return { url: resolved.toString() };
}

export async function forwardProxyRequest(request, route, env = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowedMethods = route.allowedMethods || ["GET", "POST"];
  const corsHeaders = buildCorsHeaders(origin, allowedMethods);

  if (!isOriginAllowed(origin, url, env)) {
    return jsonError(403, "Origin not allowed", { Vary: "Origin" });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!allowedMethods.includes(request.method)) {
    return jsonError(405, "Method not allowed", {
      ...corsHeaders,
      Allow: [...allowedMethods, "OPTIONS"].join(", "),
    });
  }

  const resolved = resolveSafeUpstreamUrl(url, route);
  if (resolved.error) {
    return jsonError(resolved.status, resolved.error, corsHeaders);
  }

  const headers = new Headers();
  for (const name of SAFE_REQUEST_HEADERS) {
    const val = request.headers.get(name);
    if (val) headers.set(name, val);
  }
  for (const [key, value] of Object.entries(route.extraHeaders || {})) {
    headers.set(key, value);
  }

  const controller = new AbortController();
  const timeoutMs = route.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init = {
      method: request.method,
      headers,
      redirect: "follow",
      signal: controller.signal,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const response = await fetch(resolved.url, init);
    const responseHeaders = new Headers(response.headers);
    for (const hopHeader of HOP_BY_HOP_HEADERS) {
      responseHeaders.delete(hopHeader);
    }
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Cache-Control", "no-store");
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const isTimeout = err?.name === "AbortError";
    return jsonError(
      isTimeout ? 504 : 502,
      isTimeout ? "Upstream request timeout" : "Upstream request failed",
      corsHeaders,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createEdgeProxyHandler(route) {
  return async function onRequest(context) {
    const request = context?.request ?? context;
    const env = context?.env ?? {};
    return forwardProxyRequest(request, route, env);
  };
}
