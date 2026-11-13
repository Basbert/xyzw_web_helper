// 把 /api/hortor/* 转发到 https://comb-platform.hortorgames.com/*
// 对应原 nginx: location /api/hortor/ { proxy_pass https://comb-platform.hortorgames.com/; }

import { createEdgeProxyHandler } from "../../_lib/proxy.js";

const UA =
  "Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36";

export const onRequest = createEdgeProxyHandler({
  prefix: "/api/hortor",
  target: "https://comb-platform.hortorgames.com",
  allowedMethods: ["POST"],
  allowedPathPrefixes: ["/comb-login-server/api/v1/login"],
  extraHeaders: {
    "User-Agent": UA,
    Accept: "*/*",
    "Content-Type": "text/plain; charset=utf-8",
    Origin: "https://open.weixin.qq.com",
    Referer: "https://open.weixin.qq.com/",
  },
});
