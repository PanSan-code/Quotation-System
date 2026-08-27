export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Allowed CORS origins
    const ALLOWED_ORIGINS = [
      "https://pansanrequest.ccwu.cc",
      "https://pansanrequest.pages.dev",
      "https://www.pansanrequest.ccwu.cc"
    ];
    const requestOrigin = request.headers.get("Origin");
    const isAllowedOrigin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin);

    // 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      const resHeaders = new Headers();
      if (isAllowedOrigin) {
        resHeaders.set("Access-Control-Allow-Origin", requestOrigin);
        resHeaders.set("Access-Control-Allow-Credentials", "true");
      } else {
        resHeaders.set("Access-Control-Allow-Origin", "*");
      }
      resHeaders.set("Vary", "Origin");
      resHeaders.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      resHeaders.set("Access-Control-Allow-Headers", "Content-Type,Authorization,Cache-Control");
      resHeaders.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers: resHeaders });
    }

    // 只代理 /api/* 和 /files/* 请求，其他请求走静态资源
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/files/")) {
      return env.ASSETS.fetch(request);
    }

    // 清理请求头
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (["host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"].includes(lower)) {
        continue;
      }
      headers.set(key, value);
    }
    headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    headers.set("X-Forwarded-Host", url.hostname);

    let response;
    const body = request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined;

    // 优先使用 Service Binding
    if (env.API && typeof env.API.fetch === "function") {
      const workerUrl = new URL(`https://dummy${url.pathname}${url.search}`);
      const workerRequest = new Request(workerUrl, {
        method: request.method,
        headers,
        body
      });
      response = await env.API.fetch(workerRequest);
    } else {
      // 降级：直接 HTTP 调用
      const targetUrl = `https://api.pansanrequest.ccwu.cc${url.pathname}${url.search}`;
      response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body
      });
    }

    const resHeaders = new Headers(response.headers);
    if (isAllowedOrigin) {
      resHeaders.set("Access-Control-Allow-Origin", requestOrigin);
      resHeaders.set("Access-Control-Allow-Credentials", "true");
    } else {
      resHeaders.set("Access-Control-Allow-Origin", "*");
    }
    resHeaders.set("Vary", "Origin");
    resHeaders.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "Content-Type,Authorization,Cache-Control");
    resHeaders.set("Access-Control-Max-Age", "86400");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders
    });
  }
};