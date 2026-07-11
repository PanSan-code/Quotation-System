// 超简化Worker - 主动throw以查看错误信息是否被传递
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // 故意throw一个详细错误
  throw new Error("DIAG_ERROR_MARKER_42: url=" + request.url + " ts=" + Date.now());
}
