// 最小诊断Worker
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // 收集环境信息
      const info = {
        ok: true,
        path,
        method: request.method,
        timestamp: new Date().toISOString(),
        bindings: {
          DB: typeof env.DB,
          QUOTE_IMAGES: typeof env.QUOTE_IMAGES,
          ALLOWED_ORIGINS: env.ALLOWED_ORIGINS || null,
          ADMIN_EMAIL: env.ADMIN_EMAIL || null,
          MAX_IMAGES: env.MAX_IMAGES || null
        }
      };

      return new Response(JSON.stringify(info, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({
        ok: false,
        error: err.message,
        stack: err.stack,
        name: err.name
      }, null, 2), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  }
};
