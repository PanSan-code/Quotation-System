// 无binding的纯Hello worker - 验证运行时本身
export default {
  fetch(request) {
    return new Response(JSON.stringify({
      hello: "world",
      url: request.url
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
