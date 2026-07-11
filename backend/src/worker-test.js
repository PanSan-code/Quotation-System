export default {
  async fetch(request, env) {
    return new Response(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};