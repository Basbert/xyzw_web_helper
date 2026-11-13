// 把 /api/weixin/* 转发到 https://open.weixin.qq.com/*
// 对应原 nginx: location /api/weixin/ { proxy_pass https://open.weixin.qq.com/; }
// 注意: 这条必须排在 /api/weixin-long/ 之后匹配, 文件系统的长路径天然满足

import { createEdgeProxyHandler } from "../../_lib/proxy.js";

const UA =
  "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 " +
  "Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN";

export const onRequest = createEdgeProxyHandler({
  prefix: "/api/weixin",
  target: "https://open.weixin.qq.com",
  allowedMethods: ["GET", "HEAD"],
  allowedPathPrefixes: ["/connect/app/qrconnect", "/connect/l/qrconnect"],
  extraHeaders: {
    "User-Agent": UA,
    Referer: "https://open.weixin.qq.com/",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  },
});
