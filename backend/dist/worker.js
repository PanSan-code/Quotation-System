var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var DEFAULT_MAX_IMAGES = 5;
var shippingRatesCache = null;
var SHIPPING_RATES_TTL = 6e4;
function base64UrlEncode(bytes) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return new Uint8Array(
    atob(padded).split("").map((c) => c.charCodeAt(0))
  );
}
__name(base64UrlDecode, "base64UrlDecode");
async function importJwtKey(secret) {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
__name(importJwtKey, "importJwtKey");
async function signJwt(payload, secret) {
  const key = await importJwtKey(secret);
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
__name(signJwt, "signJwt");
async function verifyJwt(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = await importJwtKey(secret);
    const encoder = new TextEncoder();
    const signature = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payloadBytes = base64UrlDecode(parts[1]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!payload.exp || payload.exp * 1e3 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}
__name(verifyJwt, "verifyJwt");
async function requireUser(request, env) {
  if (!env.JWT_SECRET) {
    throw error("JWT_SECRET is not configured.", 503);
  }
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !payload.email) {
    throw error("Unauthorized", 401);
  }
  return payload;
}
__name(requireUser, "requireUser");
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
      }
      const url = new URL(request.url);
      const path = url.pathname;
      if (path !== "/health") {
        await checkRateLimit(request, env);
      }
      if (request.method === "GET" && path === "/health") {
        return json({ ok: true }, 200, request, env);
      }
      if (request.method === "GET" && path.startsWith("/files/")) {
        return handleFileRequest(path, request, env);
      }
      if (request.method === "POST" && path === "/api/inquiries") {
        return handleCreateInquiry(request, env, ctx);
      }
      if (request.method === "GET" && path === "/api/test-email") {
        return handleTestEmail(request, env);
      }
      if (request.method === "GET" && path === "/api/diag") {
        return handleDiag(request, env);
      }
      if (request.method === "GET" && path.startsWith("/api/inquiries/")) {
        const code = normalizeCode(path.split("/").pop() || "");
        return handlePublicInquiry(code, request, env);
      }
      if (path === "/api/admin/inquiries" && request.method === "GET") {
        await requireAdmin(request, env);
        return handleAdminList(request, env);
      }
      if (path.startsWith("/api/admin/inquiries/") && request.method === "GET") {
        await requireAdmin(request, env);
        const code = normalizeCode(path.split("/").pop() || "");
        return handleAdminDetail(code, request, env);
      }
      if (path.startsWith("/api/admin/inquiries/") && path.endsWith("/quote") && request.method === "PUT") {
        await requireAdmin(request, env);
        const parts = path.split("/");
        const code = normalizeCode(parts[4] || "");
        return handleSaveQuote(code, request, env);
      }
      if (path === "/api/admin/cleanup" && request.method === "POST") {
        await requireAdmin(request, env);
        return handleCleanupOldInquiries(request, env);
      }
      if (path === "/api/orders" && request.method === "POST") {
        return handleCreateOrder(request, env);
      }
      if (path === "/api/admin/orders" && request.method === "GET") {
        await requireAdmin(request, env);
        return handleAdminOrders(request, env);
      }
      if (path === "/api/admin/orders/search" && request.method === "GET") {
        await requireAdmin(request, env);
        return handleSearchOrders(request, env);
      }
      if (path.startsWith("/api/admin/orders/") && path.endsWith("/confirm") && request.method === "PUT") {
        await requireAdmin(request, env);
        const code = normalizeCode(path.split("/")[4] || "");
        return handleConfirmOrder(code, request, env);
      }
      if (path === "/api/orders" && request.method === "GET") {
        return handleGetOrder(request, env);
      }
      if (path === "/api/orders" && request.method === "PUT") {
        return handleAddTrackingToOrder(request, env);
      }
      if (path === "/api/orders/tracking" && request.method === "DELETE") {
        return handleRemoveTrackingFromOrder(request, env);
      }
      if (path === "/api/orders/check-tracking" && request.method === "POST") {
        return handleCheckTrackingConflict(request, env);
      }
      if (path === "/api/admin/tracking-whitelist" && request.method === "GET") {
        await requireAdmin(request, env);
        return handleGetTrackingWhitelist(request, env);
      }
      if (path === "/api/admin/tracking-whitelist" && request.method === "POST") {
        await requireAdmin(request, env);
        return handleAddTrackingWhitelist(request, env);
      }
      if (path.startsWith("/api/admin/tracking-whitelist/") && request.method === "DELETE") {
        await requireAdmin(request, env);
        const id = path.split("/")[4] || "";
        return handleDeleteTrackingWhitelist(id, request, env);
      }
      if (path === "/api/settings/address" && request.method === "GET") {
        return handleGetAddress(request, env);
      }
      if (path === "/api/settings/address" && request.method === "PUT") {
        await requireAdmin(request, env);
        return handleUpdateAddress(request, env);
      }
      if (path === "/api/auth/send-code" && request.method === "POST") {
        return handleAuthSendCode(request, env);
      }
      if (path === "/api/auth/verify" && request.method === "POST") {
        return handleAuthVerify(request, env);
      }
      if (path === "/api/my-inquiries" && request.method === "GET") {
        const user = await requireUser(request, env);
        return handleMyInquiries(user, request, env);
      }
      if (path === "/api/my-forwarding" && request.method === "GET") {
        const user = await requireUser(request, env);
        return handleMyForwarding(user, request, env);
      }
      if (path === "/api/cart" && request.method === "GET") {
        const user = await requireUser(request, env);
        return handleGetCart(user, request, env);
      }
      if (path === "/api/cart" && request.method === "POST") {
        const user = await requireUser(request, env);
        return handleAddToCart(user, request, env);
      }
      if (path === "/api/cart" && request.method === "DELETE") {
        const user = await requireUser(request, env);
        return handleRemoveFromCart(user, request, env);
      }
      if (path === "/api/shipping-rates" && request.method === "GET") {
        return handleGetShippingRates(request, env);
      }
      if (path === "/api/shipping/estimate" && request.method === "POST") {
        return handleEstimateShipping(request, env);
      }
      if (path === "/api/admin/shipping-rates" && request.method === "GET") {
        await requireAdmin(request, env);
        return handleAdminGetShippingRates(request, env);
      }
      if (path === "/api/admin/shipping-rates" && request.method === "PUT") {
        await requireAdmin(request, env);
        return handleAdminUpdateShippingRates(request, env);
      }
      if (path === "/api/admin/shipping-rates/reset" && request.method === "POST") {
        await requireAdmin(request, env);
        return handleAdminResetShippingRates(request, env);
      }
      if (path === "/api/announcement" && request.method === "GET") {
        return handleGetAnnouncement(request, env);
      }
      if (path === "/api/admin/announcement" && request.method === "PUT") {
        await requireAdmin(request, env);
        return handleAdminUpdateAnnouncement(request, env);
      }
      return json({ error: "Not found." }, 404, request, env);
    } catch (err) {
      const status = err.status || 500;
      const message = status >= 500 ? "Internal server error." : err.message;
      return json({ error: message }, status, request, env);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledCleanup(env));
    ctx.waitUntil(handleReminderCheck(env));
  }
};
function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] || "";
  if (!allowOrigin) {
    return {
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,Cache-Control",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    };
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Cache-Control",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(buildCorsHeaders, "buildCorsHeaders");
function json(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCorsHeaders(request, env)
    }
  });
}
__name(json, "json");
function error(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
__name(error, "error");
async function checkRateLimit(request, env) {
  const RATE_LIMIT_WINDOW_MS = 60 * 1e3;
  const RATE_LIMIT_MAX = 30;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const url = new URL(request.url);
  const routeKey = `${ip}:${url.pathname}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE expires_at < ?1"
  ).bind(now).run();
  const record = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE route_key = ?1 AND expires_at > ?2"
  ).bind(routeKey, now).first();
  const currentCount = record ? record.count : 0;
  if (currentCount >= RATE_LIMIT_MAX) {
    throw error("Too many requests. Please try again later.", 429);
  }
  if (record) {
    await env.DB.prepare(
      "UPDATE rate_limits SET count = count + 1, expires_at = ?2 WHERE route_key = ?1"
    ).bind(routeKey, windowStart + RATE_LIMIT_WINDOW_MS).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO rate_limits (route_key, count, expires_at) VALUES (?1, 1, ?2)"
    ).bind(routeKey, windowStart + RATE_LIMIT_WINDOW_MS).run();
  }
}
__name(checkRateLimit, "checkRateLimit");
function parseAllowedOrigins(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter((item) => item && item !== "*");
}
__name(parseAllowedOrigins, "parseAllowedOrigins");
function getMaxImages(env) {
  const value = Number(env.MAX_IMAGES || DEFAULT_MAX_IMAGES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_IMAGES;
}
__name(getMaxImages, "getMaxImages");
function cleanString(value, { max = 2e3, empty = true } = {}) {
  const text = String(value ?? "").trim();
  if (!empty && !text) {
    throw error("Missing required field.");
  }
  if (text.length > max) {
    throw error(`Field exceeds ${max} characters.`);
  }
  return text.replace(/<[^>]*>/g, "");
}
__name(cleanString, "cleanString");
function normalizeShipping(value) {
  const shipping = String(value || "").trim().toLowerCase();
  if (!["sea", "air"].includes(shipping)) {
    throw error("Shipping must be either 'sea' or 'air'.");
  }
  return shipping;
}
__name(normalizeShipping, "normalizeShipping");
function normalizePayment(value) {
  const payment = String(value || "").trim().toLowerCase();
  if (!["gcash", "shopee"].includes(payment)) {
    throw error("Payment method must be either 'gcash' or 'shopee'.");
  }
  return payment;
}
__name(normalizePayment, "normalizePayment");
function normalizeWeight(value) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 500) {
    throw error("Weight must be a number between 0 and 500.");
  }
  return Math.round(weight * 100) / 100;
}
__name(normalizeWeight, "normalizeWeight");
function normalizeImages(value, env) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw error("Images must be an array.");
  }
  const maxImages = getMaxImages(env);
  if (value.length > maxImages) {
    throw error(`A maximum of ${maxImages} images is allowed.`);
  }
  return value.map((item) => cleanString(item, { max: 12e6, empty: false }));
}
__name(normalizeImages, "normalizeImages");
function normalizeMoney(value, fieldName) {
  if (value == null || value === "") {
    return null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw error(`${fieldName} must be a non-negative number.`);
  }
  return Math.round(amount * 100) / 100;
}
__name(normalizeMoney, "normalizeMoney");
function calculateTotal(finalFreight, serviceFee, totalPrice) {
  if (totalPrice != null) {
    return totalPrice;
  }
  return Math.round(((finalFreight || 0) + (serviceFee || 0)) * 100) / 100;
}
__name(calculateTotal, "calculateTotal");
function normalizeCode(value) {
  const code = cleanString(value, { max: 8, empty: false }).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw error("Invalid inquiry code.");
  }
  return code;
}
__name(normalizeCode, "normalizeCode");
function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}
__name(generateCode, "generateCode");
async function generateUniqueCode(env) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateCode();
    const existing = await env.DB.prepare("SELECT code FROM inquiries WHERE code = ?1").bind(code).first();
    if (!existing) {
      return code;
    }
  }
  throw error("Unable to generate a unique inquiry code.", 500);
}
__name(generateUniqueCode, "generateUniqueCode");
function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let result = 0;
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
async function requireAdmin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!env.ADMIN_TOKEN) {
    throw error("ADMIN_TOKEN is not configured.", 503);
  }
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    throw error("Unauthorized", 401);
  }
}
__name(requireAdmin, "requireAdmin");
var MAX_BASE64_SIZE = 10 * 1024 * 1024;
var MAGIC_BYTES = {
  "image/jpeg": [[255, 216, 255]],
  "image/png": [[137, 80, 78, 71]],
  "image/webp": [[82, 73, 70, 70]],
  "image/gif": [[71, 73, 70, 56]],
  "image/heic": [[0, 0, 0]]
  // HEIC encapsulated in ftyp box; relaxed check
};
function validateMagicBytes(bytes, mimeType) {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return true;
  return signatures.some((sig) => {
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) return false;
    }
    return true;
  });
}
__name(validateMagicBytes, "validateMagicBytes");
function parseDataUri(dataUri) {
  if (String(dataUri || "").length > MAX_BASE64_SIZE * 1.4) {
    throw error(`Image payload exceeds maximum allowed size of ${MAX_BASE64_SIZE / 1024 / 1024}MB.`);
  }
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUri || ""));
  if (!match) {
    throw error("Invalid image payload. Expected a base64 data URI.");
  }
  const mimeType = match[1].toLowerCase();
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic"
  }[mimeType];
  if (!extension) {
    throw error(`Unsupported image type: ${mimeType}`);
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  if (bytes.byteLength > MAX_BASE64_SIZE) {
    throw error(`Decoded image exceeds maximum allowed size of ${MAX_BASE64_SIZE / 1024 / 1024}MB.`);
  }
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (!validateMagicBytes(bytes, mimeType)) {
    throw error(`File content does not match declared MIME type: ${mimeType}`);
  }
  return { bytes, mimeType, extension };
}
__name(parseDataUri, "parseDataUri");
function buildImageKey(code, extension) {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `inquiries/${code}/${Date.now()}-${random}.${extension}`;
}
__name(buildImageKey, "buildImageKey");
function buildImageUrl(request, key) {
  const url = new URL(request.url);
  return `${url.origin}/files/${key}`;
}
__name(buildImageUrl, "buildImageUrl");
async function saveBase64Image(dataUri, code, request, env) {
  const parsed = parseDataUri(dataUri);
  const key = buildImageKey(code, parsed.extension);
  await env.QUOTE_IMAGES.put(key, parsed.bytes, {
    httpMetadata: {
      contentType: parsed.mimeType
    }
  });
  return {
    key,
    url: buildImageUrl(request, key),
    contentType: parsed.mimeType,
    size: parsed.bytes.byteLength
  };
}
__name(saveBase64Image, "saveBase64Image");
function mapRow(row) {
  return {
    code: row.code,
    product_url: row.product_url,
    images: JSON.parse(row.images_json || "[]"),
    remark: row.remark,
    shipping: row.shipping,
    payment_method: row.payment_method,
    weight_estimate: row.weight_estimate,
    status: row.status,
    final_freight: row.final_freight,
    freight2: row.freight2,
    service_fee: row.service_fee,
    total_price: row.total_price,
    shopee_after_tax: row.shopee_after_tax,
    admin_note: row.admin_note,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(mapRow, "mapRow");
async function getInquiryByCode(code, env) {
  const row = await env.DB.prepare("SELECT * FROM inquiries WHERE code = ?1").bind(code).first();
  return row ? mapRow(row) : null;
}
__name(getInquiryByCode, "getInquiryByCode");
async function handleCreateInquiry(request, env, ctx) {
  const body = await request.json();
  const productUrl = cleanString(body.product_url, { max: 2e3, empty: false });
  try {
    const parsedUrl = new URL(productUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw error("product_url must be an http(s) URL.");
  }
  const remark = cleanString(body.remark, { max: 3e3 });
  const shipping = normalizeShipping(body.shipping);
  const paymentMethod = body.payment_method ? normalizePayment(body.payment_method) : "gcash";
  const weightEstimate = normalizeWeight(body.weight_estimate);
  const images = normalizeImages(body.images, env);
  const code = await generateUniqueCode(env);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const uploadedImages = [];
  for (const image of images) {
    uploadedImages.push(await saveBase64Image(image, code, request, env));
  }
  await env.DB.prepare(
    `INSERT INTO inquiries
      (code, product_url, remark, shipping, payment_method, weight_estimate, status, final_freight, freight2, service_fee, total_price, admin_note, images_json, notified_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, NULL, NULL, '', ?7, ?8, ?9, ?9)`
  ).bind(code, productUrl, remark, shipping, paymentMethod, weightEstimate, JSON.stringify(uploadedImages), createdAt, createdAt).run();
  const inquiryForEmail = {
    code,
    product_url: productUrl,
    remark,
    shipping,
    weight_estimate: weightEstimate,
    created_at: createdAt
  };
  await sendAdminNewInquiryNotification(env, inquiryForEmail);
  return json(
    {
      code,
      status: "pending",
      created_at: createdAt
    },
    201,
    request,
    env
  );
}
__name(handleCreateInquiry, "handleCreateInquiry");
async function handlePublicInquiry(code, request, env) {
  const inquiry = await getInquiryByCode(code, env);
  if (!inquiry) {
    return json({ error: "Inquiry not found." }, 404, request, env);
  }
  return json(inquiry, 200, request, env);
}
__name(handlePublicInquiry, "handlePublicInquiry");
async function handleAdminList(request, env) {
  const url = new URL(request.url);
  const status = cleanString(url.searchParams.get("status") || "", { max: 20 });
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("page_size") || 20), 1), 100);
  const offset = (page - 1) * pageSize;
  let listQuery, countQuery;
  let listResult, countResult;
  if (status) {
    listQuery = env.DB.prepare(
      "SELECT * FROM inquiries WHERE status = ?1 ORDER BY datetime(created_at) DESC LIMIT ?2 OFFSET ?3"
    ).bind(status, pageSize, offset);
    countQuery = env.DB.prepare(
      "SELECT COUNT(*) AS total FROM inquiries WHERE status = ?1"
    ).bind(status);
  } else {
    listQuery = env.DB.prepare(
      "SELECT * FROM inquiries ORDER BY datetime(created_at) DESC LIMIT ?1 OFFSET ?2"
    ).bind(pageSize, offset);
    countQuery = env.DB.prepare(
      "SELECT COUNT(*) AS total FROM inquiries"
    );
  }
  const [listR, countR] = await Promise.all([listQuery.all(), countQuery.first()]);
  listResult = listR;
  countResult = countR;
  return json(
    {
      total: Number(countResult?.total || 0),
      page,
      pageSize,
      items: (listResult.results || []).map(mapRow)
    },
    200,
    request,
    env
  );
}
__name(handleAdminList, "handleAdminList");
async function handleAdminDetail(code, request, env) {
  const inquiry = await getInquiryByCode(code, env);
  if (!inquiry) {
    return json({ error: "Inquiry not found." }, 404, request, env);
  }
  return json(inquiry, 200, request, env);
}
__name(handleAdminDetail, "handleAdminDetail");
async function handleSaveQuote(code, request, env) {
  const current = await getInquiryByCode(code, env);
  if (!current) {
    return json({ error: "Inquiry not found." }, 404, request, env);
  }
  const body = await request.json();
  const nextStatus = cleanString(body.status || "quoted", { max: 20, empty: false }).toLowerCase();
  if (!["pending", "quoted"].includes(nextStatus)) {
    throw error("status must be either 'pending' or 'quoted'.");
  }
  const finalFreight = normalizeMoney(body.final_freight, "final_freight");
  const freight2 = normalizeMoney(body.freight2, "freight2");
  const serviceFee = normalizeMoney(body.service_fee, "service_fee");
  const totalPrice = normalizeMoney(body.total_price, "total_price");
  const shopeeAfterTax = body.shopee_after_tax ? normalizeMoney(body.shopee_after_tax, "shopee_after_tax") : null;
  const adminNote = cleanString(body.admin_note, { max: 3e3 });
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const nextFreight = nextStatus === "pending" ? null : finalFreight;
  const nextFreight2 = nextStatus === "pending" ? null : freight2;
  const nextServiceFee = nextStatus === "pending" ? null : serviceFee;
  const nextTotal = nextStatus === "pending" ? null : calculateTotal(finalFreight, serviceFee, totalPrice);
  const nextShopeeAfterTax = nextStatus === "pending" ? null : shopeeAfterTax;
  await env.DB.prepare(
    `UPDATE inquiries
     SET status = ?2,
         final_freight = ?3,
         freight2 = ?4,
         service_fee = ?5,
         total_price = ?6,
         shopee_after_tax = ?7,
         admin_note = ?8,
         updated_at = ?9
     WHERE code = ?1`
  ).bind(code, nextStatus, nextFreight, nextFreight2, nextServiceFee, nextTotal, nextShopeeAfterTax, adminNote, updatedAt).run();
  const updated = await getInquiryByCode(code, env);
  return json(updated, 200, request, env);
}
__name(handleSaveQuote, "handleSaveQuote");
var SAFE_PATH_RE = /^inquiries\/[A-Z0-9]{8}\/[a-zA-Z0-9_-]+\.(jpg|png|webp|gif|heic)$/;
async function handleFileRequest(path, request, env) {
  const rawKey = decodeURIComponent(path.slice("/files/".length));
  if (rawKey.includes("\0") || rawKey.includes("%00")) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }
  if (!SAFE_PATH_RE.test(rawKey)) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }
  const object = await env.QUOTE_IMAGES.get(rawKey);
  if (!object) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }
  const headers = new Headers(buildCorsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
__name(handleFileRequest, "handleFileRequest");
async function handleCleanupOldInquiries(request, env) {
  const body = await request.json().catch(() => ({}));
  const months = body.months == null ? 6 : Number(body.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    throw error("months must be an integer between 1 and 60.");
  }
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoffIso = cutoffDate.toISOString();
  const oldInquiries = await env.DB.prepare(
    "SELECT code, images_json FROM inquiries WHERE created_at < ?1"
  ).bind(cutoffIso).all();
  const deletedCodes = [];
  for (const row of oldInquiries.results || []) {
    const code = row.code;
    const images = JSON.parse(row.images_json || "[]");
    for (const image of images) {
      if (image.key) {
        try {
          await env.QUOTE_IMAGES.delete(image.key);
        } catch (err) {
          console.error(`Failed to delete image ${image.key}:`, err);
        }
      }
    }
    await env.DB.prepare("DELETE FROM inquiries WHERE code = ?1").bind(code).run();
    deletedCodes.push(code);
  }
  return json(
    {
      success: true,
      deleted_count: deletedCodes.length,
      deleted_codes: deletedCodes,
      cutoff_date: cutoffIso
    },
    200,
    request,
    env
  );
}
__name(handleCleanupOldInquiries, "handleCleanupOldInquiries");
async function handleScheduledCleanup(env) {
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 6);
  const cutoffIso = cutoffDate.toISOString();
  const oldInquiries = await env.DB.prepare(
    "SELECT code, images_json FROM inquiries WHERE created_at < ?1"
  ).bind(cutoffIso).all();
  for (const row of oldInquiries.results || []) {
    const code = row.code;
    const images = JSON.parse(row.images_json || "[]");
    for (const image of images) {
      if (image.key) {
        try {
          await env.QUOTE_IMAGES.delete(image.key);
        } catch (err) {
          console.error(`Failed to delete image ${image.key}:`, err);
        }
      }
    }
    await env.DB.prepare("DELETE FROM inquiries WHERE code = ?1").bind(code).run();
  }
  console.log(`Scheduled cleanup completed. Deleted ${oldInquiries.results?.length || 0} old inquiries.`);
}
__name(handleScheduledCleanup, "handleScheduledCleanup");
async function handleCreateOrder(request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw error("Invalid order code.");
  }
  const existing = await env.DB.prepare("SELECT code FROM orders WHERE code = ?1").bind(code).first();
  if (existing) {
    throw error("Order code already exists.");
  }
  const trackingNumbers = Array.isArray(body.tracking_numbers) ? body.tracking_numbers : [];
  const validTrackings = trackingNumbers.filter((t) => typeof t === "string" && t.trim());
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const confirmedTrackings = [];
  for (const tracking of validTrackings) {
    const match = await env.DB.prepare(
      "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(tracking).first();
    if (match) {
      confirmedTrackings.push(tracking);
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO orders (code, tracking_numbers_json, created_at) VALUES (?1, ?2, ?3)"
    ).bind(code, JSON.stringify(validTrackings), createdAt)
  ]);
  return json({
    code,
    tracking_numbers: validTrackings,
    confirmed_trackings: confirmedTrackings,
    created_at: createdAt
  }, 201, request, env);
}
__name(handleCreateOrder, "handleCreateOrder");
async function handleAdminOrders(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const listResult = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, created_at FROM orders ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
  ).bind(limit, offset).all();
  const whitelistResult = await env.DB.prepare(
    "SELECT tracking_number FROM tracking_whitelist"
  ).all();
  const whitelist = new Set((whitelistResult.results || []).map((r) => r.tracking_number));
  const orders = (listResult.results || []).map((row) => {
    const trackingNumbers = JSON.parse(row.tracking_numbers_json || "[]");
    return {
      code: row.code,
      tracking_numbers: trackingNumbers,
      confirmed_trackings: trackingNumbers.filter((t) => whitelist.has(t)),
      created_at: row.created_at
    };
  });
  return json({ orders, total: orders.length }, 200, request, env);
}
__name(handleAdminOrders, "handleAdminOrders");
async function handleSearchOrders(request, env) {
  const url = new URL(request.url);
  const keyword = (url.searchParams.get("keyword") || "").trim();
  if (!keyword) {
    throw error("Search keyword is required.");
  }
  const listResult = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, created_at FROM orders WHERE tracking_numbers_json LIKE ?1 ORDER BY created_at DESC"
  ).bind(`%${keyword}%`).all();
  const whitelistResult = await env.DB.prepare(
    "SELECT tracking_number FROM tracking_whitelist"
  ).all();
  const whitelist = new Set((whitelistResult.results || []).map((r) => r.tracking_number));
  const orders = (listResult.results || []).map((row) => {
    const trackingNumbers = JSON.parse(row.tracking_numbers_json || "[]");
    return {
      code: row.code,
      tracking_numbers: trackingNumbers,
      confirmed_trackings: trackingNumbers.filter((t) => whitelist.has(t)),
      created_at: row.created_at
    };
  });
  return json({ orders, keyword, total: orders.length }, 200, request, env);
}
__name(handleSearchOrders, "handleSearchOrders");
async function handleConfirmOrder(code, request, env) {
  const existing = await env.DB.prepare(
    "SELECT code, tracking_numbers_json FROM orders WHERE code = ?1"
  ).bind(code).first();
  if (!existing) {
    throw error("Order not found.");
  }
  const body = await request.json().catch(() => ({}));
  const trackingNumber = (body.tracking_number || "").trim();
  if (!trackingNumber) {
    throw error("Tracking number is required.");
  }
  const trackingNumbers = JSON.parse(existing.tracking_numbers_json || "[]");
  if (!trackingNumbers.includes(trackingNumber)) {
    throw error("Tracking number not found in this order.");
  }
  const whitelistEntry = await env.DB.prepare(
    "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
  ).bind(trackingNumber).first();
  if (whitelistEntry) {
    await env.DB.prepare(
      "DELETE FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(trackingNumber).run();
    return json({ code, tracking_number: trackingNumber, confirmed: false }, 200, request, env);
  } else {
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(
      "INSERT INTO tracking_whitelist (tracking_number, note, created_at) VALUES (?1, '', ?2)"
    ).bind(trackingNumber, createdAt).run();
    return json({ code, tracking_number: trackingNumber, confirmed: true }, 200, request, env);
  }
}
__name(handleConfirmOrder, "handleConfirmOrder");
async function handleGetOrder(request, env) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) {
    throw error("Order code is required.");
  }
  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, created_at FROM orders WHERE code = ?1"
  ).bind(code).first();
  if (!order) {
    return json({ error: "Order not found." }, 404, request, env);
  }
  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");
  const confirmedTrackings = [];
  for (const tracking of trackingNumbers) {
    const match = await env.DB.prepare(
      "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(tracking).first();
    if (match) {
      confirmedTrackings.push(tracking);
    }
  }
  return json({
    code: order.code,
    tracking_numbers: trackingNumbers,
    confirmed_trackings: confirmedTrackings,
    created_at: order.created_at
  }, 200, request, env);
}
__name(handleGetOrder, "handleGetOrder");
async function handleAddTrackingToOrder(request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw error("Invalid order code.");
  }
  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json FROM orders WHERE code = ?1"
  ).bind(code).first();
  if (!order) {
    throw error("Order not found.");
  }
  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");
  const newTrackings = Array.isArray(body.tracking_numbers) ? body.tracking_numbers : [];
  const validNewTrackings = newTrackings.filter((t) => typeof t === "string" && t.trim());
  const addedTrackings = [];
  for (const tracking of validNewTrackings) {
    if (!trackingNumbers.includes(tracking)) {
      trackingNumbers.push(tracking);
      addedTrackings.push(tracking);
    }
  }
  const batch = [env.DB.prepare(
    "UPDATE orders SET tracking_numbers_json = ?1 WHERE code = ?2"
  ).bind(JSON.stringify(trackingNumbers), code)];
  await env.DB.batch(batch);
  const confirmedTrackings = [];
  for (const tracking of trackingNumbers) {
    const match = await env.DB.prepare(
      "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(tracking).first();
    if (match) {
      confirmedTrackings.push(tracking);
    }
  }
  return json({
    code,
    tracking_numbers: trackingNumbers,
    confirmed_trackings: confirmedTrackings
  }, 200, request, env);
}
__name(handleAddTrackingToOrder, "handleAddTrackingToOrder");
async function handleRemoveTrackingFromOrder(request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  const trackingNumber = cleanString(body.tracking_number, { max: 100, empty: false });
  if (!code || !trackingNumber) {
    throw error("Invalid request.");
  }
  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json FROM orders WHERE code = ?1"
  ).bind(code).first();
  if (!order) {
    throw error("Order not found.");
  }
  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");
  const idx = trackingNumbers.indexOf(trackingNumber);
  if (idx === -1) {
    throw error("Tracking number not found.");
  }
  trackingNumbers.splice(idx, 1);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE orders SET tracking_numbers_json = ?1 WHERE code = ?2"
    ).bind(JSON.stringify(trackingNumbers), code)
  ]);
  const confirmedTrackings = [];
  for (const tracking of trackingNumbers) {
    const match = await env.DB.prepare(
      "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(tracking).first();
    if (match) {
      confirmedTrackings.push(tracking);
    }
  }
  return json({
    code,
    tracking_numbers: trackingNumbers,
    confirmed_trackings: confirmedTrackings
  }, 200, request, env);
}
__name(handleRemoveTrackingFromOrder, "handleRemoveTrackingFromOrder");
async function handleCheckTrackingConflict(request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  const trackingNumbers = Array.isArray(body.tracking_numbers) ? body.tracking_numbers : [];
  if (!code || !trackingNumbers.length) {
    return json({ conflicts: [] }, 200, request, env);
  }
  const allOrders = await env.DB.prepare(
    "SELECT code, tracking_numbers_json FROM orders WHERE code != ?1"
  ).bind(code).all();
  const conflicts = [];
  for (const row of allOrders.results || []) {
    const orderTrackings = JSON.parse(row.tracking_numbers_json || "[]");
    for (const t of trackingNumbers) {
      if (orderTrackings.includes(t) && !conflicts.includes(t)) {
        conflicts.push(t);
      }
    }
  }
  return json({ conflicts }, 200, request, env);
}
__name(handleCheckTrackingConflict, "handleCheckTrackingConflict");
async function handleGetTrackingWhitelist(request, env) {
  const result = await env.DB.prepare(
    "SELECT id, tracking_number, note, created_at FROM tracking_whitelist ORDER BY created_at DESC"
  ).all();
  const items = (result.results || []).map((row) => ({
    id: row.id,
    tracking_number: row.tracking_number,
    note: row.note,
    created_at: row.created_at
  }));
  return json({ items, total: items.length }, 200, request, env);
}
__name(handleGetTrackingWhitelist, "handleGetTrackingWhitelist");
async function handleAddTrackingWhitelist(request, env) {
  const body = await request.json();
  const trackingNumber = (body.tracking_number || "").trim();
  if (!trackingNumber) {
    throw error("Tracking number is required.");
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
  ).bind(trackingNumber).first();
  if (existing) {
    throw error("Tracking number already exists.");
  }
  const note = (body.note || "").trim();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    "INSERT INTO tracking_whitelist (tracking_number, note, created_at) VALUES (?1, ?2, ?3)"
  ).bind(trackingNumber, note, createdAt).run();
  return json({ tracking_number: trackingNumber, note, created_at: createdAt }, 201, request, env);
}
__name(handleAddTrackingWhitelist, "handleAddTrackingWhitelist");
async function handleDeleteTrackingWhitelist(id, request, env) {
  const numericId = Number(id);
  if (!numericId) {
    throw error("Invalid ID.");
  }
  await env.DB.prepare(
    "DELETE FROM tracking_whitelist WHERE id = ?1"
  ).bind(numericId).run();
  return json({ deleted: true }, 200, request, env);
}
__name(handleDeleteTrackingWhitelist, "handleDeleteTrackingWhitelist");
async function handleGetAddress(request, env) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'shipping_address'"
  ).first();
  return json({ address: row ? row.value : "" }, 200, request, env);
}
__name(handleGetAddress, "handleGetAddress");
async function handleUpdateAddress(request, env) {
  const body = await request.json();
  const address = (body.address || "").trim();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('shipping_address', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1"
  ).bind(address).run();
  return json({ address, updated: true }, 200, request, env);
}
__name(handleUpdateAddress, "handleUpdateAddress");
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}
__name(isValidEmail, "isValidEmail");
function generateVerificationCode() {
  return Math.floor(1e5 + Math.random() * 9e5).toString();
}
__name(generateVerificationCode, "generateVerificationCode");
async function sendVerificationEmail(env, toEmail, code) {
  const fromEmail = env.FROM_EMAIL || env.ADMIN_EMAIL || "noreply@pansan.cc";
  const subject = "\u60A8\u7684 PanSan \u767B\u5F55\u9A8C\u8BC1\u7801";
  const html = `<p>\u60A8\u597D\uFF0C</p><p>\u60A8\u7684\u767B\u5F55\u9A8C\u8BC1\u7801\u662F\uFF1A<strong style="font-size:1.2rem;">${code}</strong></p><p>\u8BE5\u9A8C\u8BC1\u7801 30 \u5206\u949F\u5185\u6709\u6548\uFF0C\u8BF7\u52FF\u6CC4\u9732\u7ED9\u4ED6\u4EBA\u3002</p>`;
  if (env.RESEND_API_KEY) {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject,
        html
      })
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Email send failed: ${resp.status} ${text}`);
    }
    return { sent: true, via: "resend" };
  }
  console.log(`[DEV] Verification code for ${toEmail}: ${code}`);
  return { sent: false, via: "console" };
}
__name(sendVerificationEmail, "sendVerificationEmail");
function isNightTime() {
  const hour = (/* @__PURE__ */ new Date()).getHours();
  return hour >= 22 || hour < 8;
}
__name(isNightTime, "isNightTime");
async function sendEmail(env, { to, subject, html, text }) {
  const fromEmail = env.FROM_EMAIL || env.ADMIN_EMAIL || "noreply@pansan.cc";
  const recipients = Array.isArray(to) ? to : [to];
  console.log(`[EMAIL] Sending email via=${env.RESEND_API_KEY ? "resend" : "console"} to=${recipients.join(", ")} subject=${subject}`);
  if (env.RESEND_API_KEY) {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject,
        html,
        text
      })
    });
    const respText = await resp.text().catch(() => "");
    console.log(`[EMAIL] Resend response status=${resp.status} body=${respText.slice(0, 500)}`);
    if (!resp.ok) {
      throw new Error(`Email send failed: ${resp.status} ${respText}`);
    }
    return { sent: true, via: "resend", response: respText };
  }
  console.log(`[DEV] Email to ${recipients.join(", ")}: ${subject}`);
  return { sent: false, via: "console" };
}
__name(sendEmail, "sendEmail");
async function sendAdminNewInquiryNotification(env, inquiry) {
  console.log(`[EMAIL] sendAdminNewInquiryNotification called for inquiry #${inquiry.code}, ADMIN_EMAIL=${env.ADMIN_EMAIL || "<unset>"}, night=${isNightTime()}`);
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log("[WARN] ADMIN_EMAIL not configured, skipping admin notification.");
    return { sent: false, reason: "ADMIN_EMAIL not configured" };
  }
  if (isNightTime()) {
    console.log(`[INFO] Night time, skipping notification for inquiry #${inquiry.code}`);
    return { sent: false, reason: "night_time" };
  }
  const subject = `\u3010PanSan\u3011\u65B0\u8BE2\u4EF7 #${inquiry.code}`;
  const html = `<p>\u5F85\u5904\u7406\u8BE2\u4EF7\u7801\uFF1A<strong>${inquiry.code}</strong></p><p>\u8BF7\u767B\u5F55\u540E\u53F0\u5904\u7406\uFF1A<a href="https://pansanrequest.ccwu.cc/admin">https://pansanrequest.ccwu.cc/admin</a></p>`;
  try {
    return await sendEmail(env, { to: adminEmail, subject, html });
  } catch (e) {
    console.error("[ERROR] Failed to send admin notification:", e.message);
    return { sent: false, error: e.message };
  }
}
__name(sendAdminNewInquiryNotification, "sendAdminNewInquiryNotification");
async function sendAdminReminderNotification(env, codes) {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log("[WARN] ADMIN_EMAIL not configured, skipping reminder.");
    return { sent: false, reason: "ADMIN_EMAIL not configured" };
  }
  if (codes.length === 0) return { sent: false, reason: "no_pending" };
  const codeList = codes.map((c) => `<li><strong>${c}</strong></li>`).join("");
  const subject = `\u3010PanSan\u3011\u5F85\u5904\u7406\u8BE2\u4EF7\u63D0\u9192\uFF08${codes.length}\u6761\uFF09`;
  const html = `<p>\u4EE5\u4E0B\u8BE2\u4EF7\u5F85\u5904\u7406\uFF1A</p><ul>${codeList}</ul><p>\u8BF7\u767B\u5F55\u540E\u53F0\u5904\u7406\uFF1A<a href="https://pansanrequest.ccwu.cc/admin">https://pansanrequest.ccwu.cc/admin</a></p>`;
  try {
    return await sendEmail(env, { to: adminEmail, subject, html });
  } catch (e) {
    console.error("[ERROR] Failed to send reminder:", e.message);
    return { sent: false, error: e.message };
  }
}
__name(sendAdminReminderNotification, "sendAdminReminderNotification");
async function handleReminderCheck(env) {
  if (isNightTime()) {
    console.log("[INFO] Night time, skipping reminder check.");
    return;
  }
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1e3).toISOString();
  const pending = await env.DB.prepare(
    "SELECT code FROM inquiries WHERE status = 'pending' AND reminder_count < 3 AND created_at < ?1"
  ).bind(fifteenMinAgo).all();
  const codes = (pending.results || []).map((r) => r.code);
  if (codes.length === 0) {
    console.log("[INFO] No pending inquiries need reminder.");
    return;
  }
  console.log(`[INFO] Sending reminder for ${codes.length} pending inquiries: ${codes.join(", ")}`);
  await sendAdminReminderNotification(env, codes);
  await env.DB.prepare(
    `UPDATE inquiries SET reminder_count = reminder_count + 1 WHERE code IN (${codes.map(() => "?").join(",")})`
  ).bind(...codes).run();
}
__name(handleReminderCheck, "handleReminderCheck");
async function handleTestEmail(request, env) {
  try {
    const result = await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: "\u3010PanSan\u3011\u90AE\u4EF6\u6D4B\u8BD5",
      html: "<p>\u8FD9\u662F\u4E00\u5C01\u6D4B\u8BD5\u90AE\u4EF6\u3002</p>"
    });
    return json({ ok: true, result, resendConfigured: !!env.RESEND_API_KEY }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: e.message, resendConfigured: !!env.RESEND_API_KEY }, 500, request, env);
  }
}
__name(handleTestEmail, "handleTestEmail");
async function handleDiag(request, env) {
  return json({
    ok: true,
    adminEmail: env.ADMIN_EMAIL || null,
    resendConfigured: !!env.RESEND_API_KEY,
    fromEmail: env.FROM_EMAIL || env.ADMIN_EMAIL || null,
    isNight: isNightTime(),
    hasSendEmail: typeof sendEmail === "function"
  }, 200, request, env);
}
__name(handleDiag, "handleDiag");
async function handleAuthSendCode(request, env) {
  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw error("Invalid email address.", 400);
  }
  const code = generateVerificationCode();
  const expiresAt = Math.floor(Date.now() / 1e3) + 30 * 60;
  await env.DB.prepare(
    "INSERT INTO verification_codes (email, code, expires_at, used) VALUES (?1, ?2, ?3, 0)"
  ).bind(email, code, expiresAt).run();
  const result = await sendVerificationEmail(env, email, code);
  return json({
    sent: result.sent,
    via: result.via,
    // 未配置邮件服务时返回验证码，方便测试
    ...result.via === "console" ? { code } : {}
  }, 200, request, env);
}
__name(handleAuthSendCode, "handleAuthSendCode");
async function handleAuthVerify(request, env) {
  if (!env.JWT_SECRET) {
    throw error("JWT_SECRET is not configured.", 503);
  }
  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  if (!isValidEmail(email)) {
    throw error("Invalid email address.", 400);
  }
  if (!code) {
    throw error("Verification code is required.", 400);
  }
  const now = Math.floor(Date.now() / 1e3);
  const row = await env.DB.prepare(
    "SELECT id, email, code, used FROM verification_codes WHERE email = ?1 AND code = ?2 AND expires_at > ?3 ORDER BY id DESC LIMIT 1"
  ).bind(email, code, now).first();
  if (!row || row.used) {
    throw error("Invalid or expired verification code.", 400);
  }
  await env.DB.prepare("UPDATE verification_codes SET used = 1 WHERE id = ?1").bind(row.id).run();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    "INSERT INTO users (email, created_at) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET email = email"
  ).bind(email, nowIso).run();
  const token = await signJwt(
    { email, iat: now, exp: now + 30 * 24 * 60 * 60 },
    // 30 days
    env.JWT_SECRET
  );
  return json({ token, email }, 200, request, env);
}
__name(handleAuthVerify, "handleAuthVerify");
async function handleMyInquiries(user, request, env) {
  const result = await env.DB.prepare(
    "SELECT code, product_url, remark, shipping, payment_method, weight_estimate, status, final_freight, freight2, service_fee, total_price, admin_note, images_json, created_at, updated_at, rate_snapshot_json FROM inquiries WHERE email = ?1 ORDER BY created_at DESC"
  ).bind(user.email).all();
  const inquiries = (result.results || []).map((row) => ({
    code: row.code,
    product_url: row.product_url,
    remark: row.remark,
    shipping: row.shipping,
    payment_method: row.payment_method,
    weight_estimate: row.weight_estimate,
    status: row.status,
    final_freight: row.final_freight,
    freight2: row.freight2,
    service_fee: row.service_fee,
    total_price: row.total_price,
    admin_note: row.admin_note,
    images_json: row.images_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
    rate_snapshot_json: row.rate_snapshot_json
  }));
  return json({ inquiries }, 200, request, env);
}
__name(handleMyInquiries, "handleMyInquiries");
async function handleMyForwarding(user, request, env) {
  const result = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json, created_at FROM orders WHERE email = ?1 ORDER BY created_at DESC"
  ).bind(user.email).all();
  const orders = (result.results || []).map((row) => ({
    code: row.code,
    tracking_numbers_json: row.tracking_numbers_json,
    confirmed_trackings_json: row.confirmed_trackings_json,
    created_at: row.created_at
  }));
  return json({ orders }, 200, request, env);
}
__name(handleMyForwarding, "handleMyForwarding");
async function handleGetCart(user, request, env) {
  const result = await env.DB.prepare(
    "SELECT c.id, c.inquiry_code, c.added_at, i.product_url, i.status, i.total_price, i.images_json FROM cart_items c LEFT JOIN inquiries i ON c.inquiry_code = i.code WHERE c.email = ?1 ORDER BY c.added_at DESC"
  ).bind(user.email).all();
  const items = (result.results || []).map((row) => ({
    id: row.id,
    inquiry_code: row.inquiry_code,
    added_at: row.added_at,
    product_url: row.product_url,
    status: row.status,
    total_price: row.total_price,
    images_json: row.images_json
  }));
  return json({ items }, 200, request, env);
}
__name(handleGetCart, "handleGetCart");
async function handleAddToCart(user, request, env) {
  const body = await request.json();
  const inquiryCode = String(body.inquiry_code || "").trim().toUpperCase();
  if (!inquiryCode) {
    throw error("inquiry_code is required.", 400);
  }
  const inquiry = await env.DB.prepare("SELECT code FROM inquiries WHERE code = ?1").bind(inquiryCode).first();
  if (!inquiry) {
    throw error("Inquiry not found.", 404);
  }
  const addedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO cart_items (email, inquiry_code, added_at) VALUES (?1, ?2, ?3)"
    ).bind(user.email, inquiryCode, addedAt).run();
  } catch (e) {
  }
  return json({ success: true }, 200, request, env);
}
__name(handleAddToCart, "handleAddToCart");
async function handleRemoveFromCart(user, request, env) {
  const body = await request.json();
  const inquiryCode = String(body.inquiry_code || "").trim().toUpperCase();
  if (!inquiryCode) {
    throw error("inquiry_code is required.", 400);
  }
  await env.DB.prepare(
    "DELETE FROM cart_items WHERE email = ?1 AND inquiry_code = ?2"
  ).bind(user.email, inquiryCode).run();
  return json({ success: true }, 200, request, env);
}
__name(handleRemoveFromCart, "handleRemoveFromCart");
async function loadShippingRates(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && shippingRatesCache && now - shippingRatesCache.timestamp < SHIPPING_RATES_TTL) {
    return shippingRatesCache.data;
  }
  const result = await env.DB.prepare(
    "SELECT channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment FROM shipping_rates ORDER BY channel, zone, tier_index"
  ).all();
  const data = /* @__PURE__ */ new Map();
  for (const row of result.results || []) {
    const key = `${row.channel}:${row.zone}`;
    if (!data.has(key)) {
      data.set(key, {
        channel: row.channel,
        zone: row.zone,
        buyer_pays: row.buyer_pays,
        tiers: []
      });
    }
    data.get(key).tiers.push({
      tier_index: row.tier_index,
      min_weight_g: row.min_weight_g,
      max_weight_g: row.max_weight_g,
      cost_type: row.cost_type,
      flat_cost: row.flat_cost,
      increment_g: row.increment_g,
      rate_per_increment: row.rate_per_increment
    });
  }
  shippingRatesCache = { data, timestamp: now };
  return data;
}
__name(loadShippingRates, "loadShippingRates");
function calculateFreight(rule, weightG) {
  let hiddenCost = 0;
  for (const tier of rule.tiers) {
    if (weightG < tier.min_weight_g) continue;
    const tierMax = tier.max_weight_g != null ? tier.max_weight_g : Infinity;
    const applicableWeight = Math.min(weightG, tierMax);
    if (tier.cost_type === "flat") {
      hiddenCost = tier.flat_cost;
    } else if (tier.cost_type === "per_increment") {
      const extraWeight = Math.max(0, applicableWeight - tier.min_weight_g);
      const increments = Math.ceil(extraWeight / (tier.increment_g || 10));
      hiddenCost += increments * (tier.rate_per_increment || 0);
    }
  }
  return {
    hidden_cost: hiddenCost,
    buyer_pays: rule.buyer_pays,
    seller_pays: hiddenCost + rule.buyer_pays
  };
}
__name(calculateFreight, "calculateFreight");
async function handleGetShippingRates(request, env) {
  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ rates: result }, 200, request, env);
}
__name(handleGetShippingRates, "handleGetShippingRates");
async function handleEstimateShipping(request, env) {
  const body = await request.json();
  const channel = String(body.channel || "").trim().toLowerCase();
  const zone = String(body.zone || "").trim().toUpperCase();
  const weightKg = Number(body.weight_kg);
  if (!["standard", "economy"].includes(channel)) {
    throw error("Invalid channel.", 400);
  }
  if (!["A", "B", "C", "D"].includes(zone)) {
    throw error("Invalid zone.", 400);
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw error("Invalid weight.", 400);
  }
  const rates = await loadShippingRates(env);
  const rule = rates.get(`${channel}:${zone}`);
  if (!rule) {
    throw error("Shipping rate not found.", 404);
  }
  const weightG = weightKg * 1e3;
  const cost = calculateFreight(rule, weightG);
  return json({
    channel,
    zone,
    weight_kg: weightKg,
    weight_g: weightG,
    ...cost
  }, 200, request, env);
}
__name(handleEstimateShipping, "handleEstimateShipping");
async function handleAdminGetShippingRates(request, env) {
  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ rates: result }, 200, request, env);
}
__name(handleAdminGetShippingRates, "handleAdminGetShippingRates");
async function handleAdminUpdateShippingRates(request, env) {
  const body = await request.json();
  const list = Array.isArray(body) ? body : Array.isArray(body?.rates) ? body.rates : null;
  if (!list) {
    throw error("Request body must be an array of rate definitions, or { rates: [...] }.", 400);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const insertStatements = [];
  for (const item of list) {
    const channel = cleanString(item.channel, { max: 20, empty: false }).toLowerCase();
    if (!["standard", "economy"].includes(channel)) {
      throw error(`Invalid channel: ${item.channel}`, 400);
    }
    const zone = cleanString(item.zone, { max: 1, empty: false }).toUpperCase();
    if (!["A", "B", "C", "D"].includes(zone)) {
      throw error(`Invalid zone: ${item.zone}`, 400);
    }
    const buyerPays = Number(item.buyer_pays);
    if (!Number.isFinite(buyerPays) || buyerPays < 0) {
      throw error(`Invalid buyer_pays for ${channel}/${zone}`, 400);
    }
    const tiers = item.tiers || [];
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const costType = cleanString(tier.cost_type, { max: 20, empty: false });
      if (!["flat", "per_increment"].includes(costType)) {
        throw error(`Invalid cost_type in tier ${i} for ${channel}/${zone}`, 400);
      }
      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rates (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      ).bind(
        channel,
        zone,
        buyerPays,
        i,
        Number(tier.min_weight_g) || 0,
        tier.max_weight_g != null ? Number(tier.max_weight_g) : null,
        costType,
        costType === "flat" ? Number(tier.flat_cost) || 0 : null,
        costType === "per_increment" ? Number(tier.increment_g) || 10 : null,
        costType === "per_increment" ? Number(tier.rate_per_increment) || 0 : null,
        now
      ));
      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rate_history (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, action, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'update', ?11)`
      ).bind(
        channel,
        zone,
        buyerPays,
        i,
        Number(tier.min_weight_g) || 0,
        tier.max_weight_g != null ? Number(tier.max_weight_g) : null,
        costType,
        costType === "flat" ? Number(tier.flat_cost) || 0 : null,
        costType === "per_increment" ? Number(tier.increment_g) || 10 : null,
        costType === "per_increment" ? Number(tier.rate_per_increment) || 0 : null,
        now
      ));
    }
  }
  await env.DB.batch(insertStatements);
  await env.DB.prepare("DELETE FROM shipping_rates WHERE updated_at < ?").bind(now).run();
  shippingRatesCache = null;
  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ success: true, rates: result }, 200, request, env);
}
__name(handleAdminUpdateShippingRates, "handleAdminUpdateShippingRates");
async function handleAdminResetShippingRates(request, env) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const defaults = [
    { channel: "standard", zone: "A", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.85 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.9 }
    ] },
    { channel: "standard", zone: "B", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.25 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.29 }
    ] },
    { channel: "standard", zone: "C", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.5 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.55 }
    ] },
    { channel: "standard", zone: "D", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 3.2 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 3.25 }
    ] },
    { channel: "economy", zone: "A", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.2 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.25 }
    ] },
    { channel: "economy", zone: "B", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.5 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.55 }
    ] },
    { channel: "economy", zone: "C", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.8 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.85 }
    ] },
    { channel: "economy", zone: "D", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.05 }
    ] }
  ];
  const insertStatements = [];
  for (const item of defaults) {
    for (let i = 0; i < item.tiers.length; i++) {
      const tier = item.tiers[i];
      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rates (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      ).bind(
        item.channel,
        item.zone,
        item.buyer_pays,
        i,
        tier.min_weight_g,
        tier.max_weight_g != null ? tier.max_weight_g : null,
        tier.cost_type,
        tier.cost_type === "flat" ? tier.flat_cost : null,
        tier.cost_type === "per_increment" ? tier.increment_g || 10 : null,
        tier.cost_type === "per_increment" ? tier.rate_per_increment : null,
        now
      ));
      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rate_history (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, action, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'reset', ?11)`
      ).bind(
        item.channel,
        item.zone,
        item.buyer_pays,
        i,
        tier.min_weight_g,
        tier.max_weight_g != null ? tier.max_weight_g : null,
        tier.cost_type,
        tier.cost_type === "flat" ? tier.flat_cost : null,
        tier.cost_type === "per_increment" ? tier.increment_g || 10 : null,
        tier.cost_type === "per_increment" ? tier.rate_per_increment : null,
        now
      ));
    }
  }
  await env.DB.batch(insertStatements);
  await env.DB.prepare("DELETE FROM shipping_rates WHERE updated_at < ?").bind(now).run();
  shippingRatesCache = null;
  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ success: true, rates: result }, 200, request, env);
}
__name(handleAdminResetShippingRates, "handleAdminResetShippingRates");
async function handleGetAnnouncement(request, env) {
  const row = await env.DB.prepare(
    "SELECT id, content, is_enabled, updated_at FROM site_announcement WHERE is_enabled = 1 ORDER BY updated_at DESC LIMIT 1"
  ).first();
  if (!row) {
    return json({ content: "", is_enabled: false }, 200, request, env);
  }
  return json({ content: row.content, is_enabled: true, updated_at: row.updated_at }, 200, request, env);
}
__name(handleGetAnnouncement, "handleGetAnnouncement");
async function handleAdminUpdateAnnouncement(request, env) {
  const body = await request.json();
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const isEnabled = body.is_enabled === false ? 0 : 1;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await env.DB.prepare("SELECT id FROM site_announcement LIMIT 1").first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE site_announcement SET content = ?, is_enabled = ?, updated_at = ? WHERE id = ?"
    ).bind(content, isEnabled, now, existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO site_announcement (content, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(content, isEnabled, now, now).run();
  }
  return json({ success: true, content, is_enabled: !!isEnabled, updated_at: now }, 200, request, env);
}
__name(handleAdminUpdateAnnouncement, "handleAdminUpdateAnnouncement");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
