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

const PROXIES = [
  {
    prefix: "/api/hortor-ucenter",
    target: "https://comb-platform.hortorgames.com",
    allowedMethods: ["POST"],
    allowedPathPrefixes: ["/ucenter-app-server/api/v1/login/"],
    // Note: Workers standard fetch may ignore overriding Host for third-party origins,
    // unlike nginx reverse proxy; keep explicit header intent documented here.
    hostHeader: "ucenter-app-server.hortorgames.com",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12; ALN-AL80 Build/HUAWEIALN-AL80; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36",
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
    },
  },
  {
    prefix: "/api/weixin-long",
    target: "https://long.open.weixin.qq.com",
    allowedMethods: ["GET", "HEAD"],
    allowedPathPrefixes: ["/connect/l/qrconnect"],
    timeoutMs: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN",
      Accept: "*/*",
      Referer: "https://open.weixin.qq.com/",
    },
  },
  {
    prefix: "/api/weixin",
    target: "https://open.weixin.qq.com",
    allowedMethods: ["GET", "HEAD"],
    allowedPathPrefixes: ["/connect/app/qrconnect", "/connect/l/qrconnect"],
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://open.weixin.qq.com/",
    },
  },
  {
    prefix: "/api/hortor",
    target: "https://comb-platform.hortorgames.com",
    allowedMethods: ["POST"],
    allowedPathPrefixes: ["/comb-login-server/api/v1/login"],
    hostHeader: "comb-platform.hortorgames.com",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36",
      Accept: "*/*",
      "Content-Type": "text/plain; charset=utf-8",
      Origin: "https://open.weixin.qq.com",
      Referer: "https://open.weixin.qq.com/",
    },
  },
].sort((a, b) => b.prefix.length - a.prefix.length);

function parseAllowedOrigins(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, requestUrl, env = {}) {
  if (!origin) return true;
  if (origin === requestUrl.origin) return true;
  if (LOCALHOST_ORIGIN_RE.test(origin)) return true;

  const configured = parseAllowedOrigins(env?.ALLOWED_ORIGINS);
  if (configured.includes("*")) return true;
  return configured.includes(origin);
}

function buildCorsHeaders(origin, allowedMethods = ["GET", "POST"]) {
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

function jsonError(status, message, extraHeaders = {}) {
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
  return allowedPathPrefixes.some((prefix) =>
    prefix.endsWith("/")
      ? upstreamPath.startsWith(prefix)
      : upstreamPath === prefix || upstreamPath.startsWith(`${prefix}/`),
  );
}

function resolveSafeUpstreamUrl(requestUrl, proxy) {
  const suffix = requestUrl.pathname.slice(proxy.prefix.length + 1);
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
  if (!isAllowedUpstreamPath(upstreamPath, proxy.allowedPathPrefixes)) {
    return { error: "Path not allowed", status: 403 };
  }

  const baseUrl = new URL(proxy.target);
  const resolved = new URL(`${upstreamPath}${requestUrl.search}`, baseUrl);
  if (resolved.origin !== baseUrl.origin) {
    return { error: "Path not allowed", status: 403 };
  }

  return { url: resolved.toString() };
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const proxy = PROXIES.find((p) => url.pathname.startsWith(`${p.prefix}/`));

    if (proxy) {
      const corsHeaders = buildCorsHeaders(origin, proxy.allowedMethods);
      if (!isOriginAllowed(origin, url, env)) {
        return jsonError(403, "Origin not allowed", { Vary: "Origin" });
      }

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (!proxy.allowedMethods.includes(request.method)) {
        return jsonError(405, "Method not allowed", {
          ...corsHeaders,
          Allow: [...proxy.allowedMethods, "OPTIONS"].join(", "),
        });
      }

      const resolved = resolveSafeUpstreamUrl(url, proxy);
      if (resolved.error) {
        return jsonError(resolved.status, resolved.error, corsHeaders);
      }

      // Copy only safe client headers to avoid leaking cookies or internal auth headers upstream.
      const newHeaders = new Headers();
      for (const name of SAFE_REQUEST_HEADERS) {
        const val = request.headers.get(name);
        if (val) newHeaders.set(name, val);
      }
      for (const [key, value] of Object.entries(proxy.headers)) {
        newHeaders.set(key, value);
      }
      if (proxy.hostHeader) {
        newHeaders.set("Host", proxy.hostHeader);
      }

      const controller = new AbortController();
      const timeoutMs = proxy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const init = {
          method: request.method,
          headers: newHeaders,
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

    if (url.pathname.startsWith("/api/")) {
      const corsHeaders = buildCorsHeaders(origin);
      if (!isOriginAllowed(origin, url, env)) {
        return jsonError(403, "Origin not allowed", { Vary: "Origin" });
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      return jsonError(404, "API route not found", corsHeaders);
    }

    // Serve static assets (Cloudflare Pages)
    // If env.ASSETS is available (e.g. in Cloudflare Pages Functions), use it to fetch static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Default response for non-proxy paths
    return new Response("Not Found", { status: 404 });
  },
};
