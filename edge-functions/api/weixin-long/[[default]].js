// 把 /api/weixin-long/* 转发到 https://long.open.weixin.qq.com/*
// 对应原 nginx: location /api/weixin-long/ { proxy_pass https://long.open.weixin.qq.com/; }

import { createEdgeProxyHandler } from "../../_lib/proxy.js";

const UA =
  "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 " +
  "Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN";

export const onRequest = createEdgeProxyHandler({
  prefix: "/api/weixin-long",
  target: "https://long.open.weixin.qq.com",
  allowedMethods: ["GET", "HEAD"],
  allowedPathPrefixes: ["/connect/l/qrconnect"],
  timeoutMs: 30000,
  extraHeaders: {
    "User-Agent": UA,
    Referer: "https://open.weixin.qq.com/",
    Accept: "*/*",
  },
});
