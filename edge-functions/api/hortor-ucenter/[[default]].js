// 把 /api/hortor-ucenter/* 转发到 https://comb-platform.hortorgames.com/*
// 对应原 nginx: location /api/hortor-ucenter/ { proxy_pass https://comb-platform.hortorgames.com/;
//                proxy_set_header Host ucenter-app-server.hortorgames.com; }
//
// 注意: nginx 里 TLS 握手目标是 comb-platform.hortorgames.com, 但 Host 头写的是
//       ucenter-app-server.hortorgames.com, 属于 HOST 头与目标域名不一致的用法。
//       标准 Fetch 规范下 Host 是受限请求头, EdgeOne Functions 默认随目标 URL 自动生成 Host；
//       共享代理已主动剥离来路 Cookie / Authorization，并在未启用自定义 Host 时保持标准 Host。

import { createEdgeProxyHandler } from "../../_lib/proxy.js";

const UA =
  "Mozilla/5.0 (Linux; Android 12; ALN-AL80 Build/HUAWEIALN-AL80; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36";

export const onRequest = createEdgeProxyHandler({
  prefix: "/api/hortor-ucenter",
  target: "https://comb-platform.hortorgames.com",
  allowedMethods: ["POST"],
  allowedPathPrefixes: ["/ucenter-app-server/api/v1/login/"],
  extraHeaders: {
    "User-Agent": UA,
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    Host: "ucenter-app-server.hortorgames.com",
  },
});
