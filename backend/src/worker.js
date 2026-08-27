const DEFAULT_MAX_IMAGES = 5;

// === Dynamic Shipping Rate Management ===
let shippingRatesCache = null;
const SHIPPING_RATES_TTL = 60_000; // 60 seconds

// === JWT helpers (Web Crypto HMAC-SHA256) ===
function base64UrlEncode(bytes) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return new Uint8Array(
    atob(padded).split("").map((c) => c.charCodeAt(0))
  );
}

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

const JWT_ISSUER = "pansan-request";
const JWT_AUDIENCE = "pansan-api";

async function signJwt(payload, secret) {
  const key = await importJwtKey(secret);
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    nbf: now - 60, // 允许 60 秒时钟偏差
    iat: now
  };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

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
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (payload.iss !== JWT_ISSUER) return null;
    if (payload.aud !== JWT_AUDIENCE) return null;
    if (payload.nbf && payload.nbf * 1000 > Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

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

// 可选登录：有有效 token 则返回用户，否则返回 null（不阻断匿名流程）
async function getOptionalUser(request, env) {
  if (!env.JWT_SECRET) return null;
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !payload.email) return null;
  return payload;
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // Skip rate limiting for health check
      if (path !== "/health") {
        await checkRateLimit(request, env);
      }

      // Enforce request body size limit for POST/PUT/PATCH
      const contentLength = request.headers.get("Content-Length");
      if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
        throw error("Request body too large.", 413);
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
        const user = await requireUser(request, env);
        return handleCreateOrder(user, request, env);
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
        const user = await requireUser(request, env);
        return handleGetOrder(user, request, env);
      }

      if (path === "/api/orders" && request.method === "PUT") {
        const user = await requireUser(request, env);
        return handleAddTrackingToOrder(user, request, env);
      }

      if (path === "/api/orders/tracking" && request.method === "DELETE") {
        const user = await requireUser(request, env);
        return handleRemoveTrackingFromOrder(user, request, env);
      }

      if (path === "/api/orders/check-tracking" && request.method === "POST") {
        const user = await requireUser(request, env);
        return handleCheckTrackingConflict(user, request, env);
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

      // === Auth ===
      if (path === "/api/auth/send-code" && request.method === "POST") {
        return handleAuthSendCode(request, env);
      }

      if (path === "/api/auth/verify" && request.method === "POST") {
        return handleAuthVerify(request, env);
      }

      // === User pages ===
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

      // === Shipping Rate Management ===
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

      // === Announcement Management ===
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

function json(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCorsHeaders(request, env)
    }
  });
}

function error(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function checkRateLimit(request, env) {
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
  const RATE_LIMIT_MAX = 30; // max requests per window

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const url = new URL(request.url);
  const routeKey = `${ip}:${url.pathname}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Clean expired entries first
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE expires_at < ?1"
  ).bind(now).run();

  // Check current count
  const record = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE route_key = ?1 AND expires_at > ?2"
  ).bind(routeKey, now).first();

  const currentCount = record ? record.count : 0;

  if (currentCount >= RATE_LIMIT_MAX) {
    throw error("Too many requests. Please try again later.", 429);
  }

  // Upsert count
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

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "*");
}

function getMaxImages(env) {
  const value = Number(env.MAX_IMAGES || DEFAULT_MAX_IMAGES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_IMAGES;
}

function cleanString(value, { max = 2000, empty = true } = {}) {
  const text = String(value ?? "").trim();

  if (!empty && !text) {
    throw error("Missing required field.");
  }

  if (text.length > max) {
    throw error(`Field exceeds ${max} characters.`);
  }

  return text.replace(/<[^>]*>/g, "");
}

function normalizeShipping(value) {
  const shipping = String(value || "").trim().toLowerCase();
  if (!["sea", "air"].includes(shipping)) {
    throw error("Shipping must be either 'sea' or 'air'.");
  }
  return shipping;
}

function normalizePayment(value) {
  const payment = String(value || "").trim().toLowerCase();
  if (!["gcash", "shopee"].includes(payment)) {
    throw error("Payment method must be either 'gcash' or 'shopee'.");
  }
  return payment;
}

function normalizeWeight(value) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 500) {
    throw error("Weight must be a number between 0 and 500.");
  }
  return Math.round(weight * 100) / 100;
}

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

  return value.map((item) => cleanString(item, { max: 12_000_000, empty: false }));
}

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

function calculateTotal(finalFreight, serviceFee, totalPrice) {
  if (totalPrice != null) {
    return totalPrice;
  }
  return Math.round(((finalFreight || 0) + (serviceFee || 0)) * 100) / 100;
}

function normalizeCode(value) {
  const code = cleanString(value, { max: 8, empty: false }).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw error("Invalid inquiry code.");
  }
  return code;
}

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

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let result = 0;
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

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

const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB max request body

const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38]],
  "image/heic": [[0x00, 0x00, 0x00, -1, 0x66, 0x74, 0x79, 0x70]] // ISOBMFF: 4-byte size + "ftyp" (4th byte is variable)
};

function validateMagicBytes(bytes, mimeType) {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return true; // unknown type, skip

  return signatures.some((sig) => {
    for (let i = 0; i < sig.length; i++) {
      if (sig[i] === -1) continue; // wildcard: match any byte
      if (bytes[i] !== sig[i]) return false;
    }
    return true;
  });
}

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

function buildImageKey(code, extension) {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `inquiries/${code}/${Date.now()}-${random}.${extension}`;
}

function buildImageUrl(request, key) {
  const url = new URL(request.url);
  return `${url.origin}/files/${key}`;
}

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

async function getInquiryByCode(code, env) {
  const row = await env.DB.prepare("SELECT * FROM inquiries WHERE code = ?1").bind(code).first();
  return row ? mapRow(row) : null;
}

async function handleCreateInquiry(request, env, ctx) {
  const body = await request.json();
  const productUrl = cleanString(body.product_url, { max: 2000, empty: false });

  try {
    const parsedUrl = new URL(productUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw error("product_url must be an http(s) URL.");
  }

  const remark = cleanString(body.remark, { max: 3000 });
  const shipping = normalizeShipping(body.shipping);
  const paymentMethod = body.payment_method ? normalizePayment(body.payment_method) : "gcash";
  const weightEstimate = normalizeWeight(body.weight_estimate);
  const images = normalizeImages(body.images, env);
  const code = await generateUniqueCode(env);
  const createdAt = new Date().toISOString();
  const user = await getOptionalUser(request, env);
  const inquiryEmail = user ? user.email : "";

  const uploadedImages = [];
  for (const image of images) {
    uploadedImages.push(await saveBase64Image(image, code, request, env));
  }

  await env.DB.prepare(
    `INSERT INTO inquiries
      (code, product_url, remark, shipping, payment_method, weight_estimate, status, final_freight, freight2, service_fee, total_price, admin_note, images_json, email, notified_at, reminder_count, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, NULL, NULL, '', ?7, ?8, NULL, 0, ?9, ?9)`
  )
    .bind(code, productUrl, remark, shipping, paymentMethod, weightEstimate, JSON.stringify(uploadedImages), inquiryEmail, createdAt)
    .run();

  // 异步发送邮件通知管理员，不阻塞主请求
  const inquiryForEmail = {
    code,
    product_url: productUrl,
    remark,
    shipping,
    weight_estimate: weightEstimate,
    created_at: createdAt
  };
  ctx.waitUntil(
    sendAdminNewInquiryNotification(env, inquiryForEmail).catch(err => {
      console.error(`[ERROR] Background notification failed for #${code}:`, err.message);
    })
  );

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

async function handlePublicInquiry(code, request, env) {
  const inquiry = await getInquiryByCode(code, env);
  if (!inquiry) {
    return json({ error: "Inquiry not found." }, 404, request, env);
  }
  // Sign image URLs for secure file access
  inquiry.images = await signImageUrls(inquiry.images, env);
  return json(inquiry, 200, request, env);
}

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

async function handleAdminDetail(code, request, env) {
  const inquiry = await getInquiryByCode(code, env);
  if (!inquiry) {
    return json({ error: "Inquiry not found." }, 404, request, env);
  }
  return json(inquiry, 200, request, env);
}

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
  const adminNote = cleanString(body.admin_note, { max: 3000 });
  const updatedAt = new Date().toISOString();

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
  )
    .bind(code, nextStatus, nextFreight, nextFreight2, nextServiceFee, nextTotal, nextShopeeAfterTax, adminNote, updatedAt)
    .run();

  const updated = await getInquiryByCode(code, env);
  return json(updated, 200, request, env);
}

const SAFE_PATH_RE = /^inquiries\/[A-Z0-9]{8}\/[a-zA-Z0-9_-]+\.(jpg|png|webp|gif|heic)$/;

async function handleFileRequest(path, request, env) {
  const url = new URL(request.url);
  const rawKey = decodeURIComponent(path.slice("/files/".length));

  // Reject null bytes and other dangerous characters
  if (rawKey.includes("\0") || rawKey.includes("%00")) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }

  if (!SAFE_PATH_RE.test(rawKey)) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }

  // Verify signed token (short-lived, 10 minutes) to prevent enumeration
  const token = url.searchParams.get("token");
  if (!token || !(await verifyFileToken(rawKey, token, env))) {
    // Fallback: allow authenticated users
    try {
      await requireUser(request, env);
    } catch {
      return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
    }
  }

  const object = await env.QUOTE_IMAGES.get(rawKey);
  if (!object) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }

  const headers = new Headers(buildCorsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
}

// Sign a file URL with a short-lived token (10 minutes)
async function signFileUrl(key, env) {
  const encoder = new TextEncoder();
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error("File URL signing is unavailable: JWT_SECRET is not set.");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${key}:${now + 3600}`; // 1 hour expiry
  const keyData = await crypto.subtle.importKey(
    "raw", encoder.encode(secret).slice(0, 32),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", keyData, encoder.encode(payload));
  const token = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `/files/${key}?token=${encodeURIComponent(token)}`;
}

async function verifyFileToken(key, token, env) {
  try {
    const encoder = new TextEncoder();
    const secret = env.JWT_SECRET;
    if (!secret) return false;
    const keyData = await crypto.subtle.importKey(
      "raw", encoder.encode(secret).slice(0, 32),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
    );
    const now = Math.floor(Date.now() / 1000);
    const window = 3600; // 1 hour
    for (let offset = 0; offset <= window; offset++) {
      const testPayload = `${key}:${now - offset}`;
      const sig = await crypto.subtle.sign("HMAC", keyData, encoder.encode(testPayload));
      const testToken = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      if (testToken === token) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Sign all image URLs in an images array for secure file access
async function signImageUrls(imagesJson, env) {
  if (!imagesJson) return [];
  const images = typeof imagesJson === "string" ? JSON.parse(imagesJson) : imagesJson;
  if (!Array.isArray(images)) return [];
  const signed = [];
  for (const img of images) {
    const url = img.url || img;
    if (typeof url !== "string" || !url.startsWith("/files/")) {
      signed.push(img.url ? { url: img.url } : { url: String(url) });
      continue;
    }
    const key = url.slice("/files/".length);
    try {
      signed.push({ url: await signFileUrl(key, env) });
    } catch {
      // Signing unavailable (e.g. JWT_SECRET not set): leave the URL unsignable rather than crash.
      signed.push({ url: String(url) });
    }
  }
  return signed;
}

async function handleCleanupOldInquiries(request, env) {
  const body = await request.json().catch(() => ({}));
  const months = body.months == null ? 6 : Number(body.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    throw error("months must be an integer between 1 and 60.");
  }

  const cutoffDate = new Date();
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

async function handleScheduledCleanup(env) {
  const cutoffDate = new Date();
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

async function handleCreateOrder(user, request, env) {
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
  const validTrackings = trackingNumbers.filter(t => typeof t === "string" && t.trim() && t.length <= 100);
  const createdAt = new Date().toISOString();

  // Derive confirmed list from whitelist
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
      "INSERT INTO orders (code, tracking_numbers_json, email, created_at) VALUES (?1, ?2, ?3, ?4)"
    ).bind(code, JSON.stringify(validTrackings), user.email, createdAt)
  ]);

  return json({
    code,
    tracking_numbers: validTrackings,
    confirmed_trackings: confirmedTrackings,
    created_at: createdAt
  }, 201, request, env);
}

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
  const whitelist = new Set((whitelistResult.results || []).map(r => r.tracking_number));

  const orders = (listResult.results || []).map(row => {
    const trackingNumbers = JSON.parse(row.tracking_numbers_json || "[]");
    return {
      code: row.code,
      tracking_numbers: trackingNumbers,
      confirmed_trackings: trackingNumbers.filter(t => whitelist.has(t)),
      created_at: row.created_at
    };
  });

  return json({ orders, total: orders.length }, 200, request, env);
}

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
  const whitelist = new Set((whitelistResult.results || []).map(r => r.tracking_number));

  const orders = (listResult.results || []).map(row => {
    const trackingNumbers = JSON.parse(row.tracking_numbers_json || "[]");
    return {
      code: row.code,
      tracking_numbers: trackingNumbers,
      confirmed_trackings: trackingNumbers.filter(t => whitelist.has(t)),
      created_at: row.created_at
    };
  });

  return json({ orders, keyword, total: orders.length }, 200, request, env);
}

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

  // Check if already in whitelist
  const whitelistEntry = await env.DB.prepare(
    "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
  ).bind(trackingNumber).first();

  if (whitelistEntry) {
    // Remove from whitelist
    await env.DB.prepare(
      "DELETE FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(trackingNumber).run();
    return json({ code, tracking_number: trackingNumber, confirmed: false }, 200, request, env);
  } else {
    // Add to whitelist
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO tracking_whitelist (tracking_number, note, created_at) VALUES (?1, '', ?2)"
    ).bind(trackingNumber, createdAt).run();
    return json({ code, tracking_number: trackingNumber, confirmed: true }, 200, request, env);
  }
}

async function handleGetOrder(user, request, env) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();

  if (!code) {
    throw error("Order code is required.");
  }

  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, email, created_at FROM orders WHERE code = ?1"
  ).bind(code).first();

  if (!order) {
    return json({ error: "Order not found." }, 404, request, env);
  }

  // Verify ownership
  if (order.email && order.email !== user.email) {
    return json({ error: "Order not found." }, 404, request, env);
  }

  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");

  // Derive confirmed list from whitelist
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

async function handleAddTrackingToOrder(user, request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw error("Invalid order code.");
  }

  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, email FROM orders WHERE code = ?1"
  ).bind(code).first();

  if (!order) {
    throw error("Order not found.");
  }

  if (order.email && order.email !== user.email) {
    throw error("Order not found.");
  }

  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");
  const newTrackings = Array.isArray(body.tracking_numbers) ? body.tracking_numbers : [];
  const validNewTrackings = newTrackings.filter(t => typeof t === "string" && t.trim() && t.length <= 100);
  const addedTrackings = [];

  for (const tracking of validNewTrackings) {
    if (!trackingNumbers.includes(tracking)) {
      trackingNumbers.push(tracking);
      addedTrackings.push(tracking);
    }
  }

  // Use batch for atomic update
  const batch = [env.DB.prepare(
    "UPDATE orders SET tracking_numbers_json = ?1 WHERE code = ?2"
  ).bind(JSON.stringify(trackingNumbers), code)];

  await env.DB.batch(batch);

  // Derive confirmed list from whitelist
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

async function handleRemoveTrackingFromOrder(user, request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  const trackingNumber = cleanString(body.tracking_number, { max: 100, empty: false });

  if (!code || !trackingNumber) {
    throw error("Invalid request.");
  }

  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, email FROM orders WHERE code = ?1"
  ).bind(code).first();

  if (!order) {
    throw error("Order not found.");
  }

  if (order.email && order.email !== user.email) {
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

  // Derive confirmed list from whitelist
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

async function handleCheckTrackingConflict(user, request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  const trackingNumbers = Array.isArray(body.tracking_numbers) ? body.tracking_numbers : [];

  if (!code || !trackingNumbers.length) {
    return json({ conflicts: [] }, 200, request, env);
  }

  const allOrders = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, email FROM orders WHERE code != ?1 AND email = ?2"
  ).bind(code, user.email).all();

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

async function handleGetTrackingWhitelist(request, env) {
  const result = await env.DB.prepare(
    "SELECT id, tracking_number, note, created_at FROM tracking_whitelist ORDER BY created_at DESC"
  ).all();

  const items = (result.results || []).map(row => ({
    id: row.id,
    tracking_number: row.tracking_number,
    note: row.note,
    created_at: row.created_at
  }));

  return json({ items, total: items.length }, 200, request, env);
}

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
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO tracking_whitelist (tracking_number, note, created_at) VALUES (?1, ?2, ?3)"
  ).bind(trackingNumber, note, createdAt).run();

  // Confirmed status is now derived from whitelist at read time — no need to update orders

  return json({ tracking_number: trackingNumber, note, created_at: createdAt }, 201, request, env);
}

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

async function handleGetAddress(request, env) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'shipping_address'"
  ).first();

  return json({ address: row ? row.value : "" }, 200, request, env);
}

async function handleUpdateAddress(request, env) {
  const body = await request.json();
  const address = (body.address || "").trim();

  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('shipping_address', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1"
  ).bind(address).run();

  return json({ address, updated: true }, 200, request, env);
}

// === Auth Handlers ===

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function generateVerificationCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

async function sendVerificationEmail(env, toEmail, code) {
  const fromEmail = env.FROM_EMAIL || "noreply@pansanrequest.ccwu.cc";
  const subject = "您的 PanSan 登录验证码";
  const html = `<p>您好，</p><p>您的登录验证码是：<strong style="font-size:1.2rem;">${code}</strong></p><p>该验证码 30 分钟内有效，请勿泄露给他人。</p>`;

  // 优先使用 Resend
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

  // 没有配置邮件服务，仅记录日志（开发测试时可通过日志查看验证码）
  console.log(`[DEV] Verification code requested for ${toEmail} (no RESEND_API_KEY configured)`);
  return { sent: false, via: "console" };
}

// 判断当前是否在夜间时段（北京时间 22:00 ~ 08:00），夜间不发送邮件通知
// Worker 服务器在 UTC，需要用 toLocaleString 转成北京时间再判断
function isNightTime() {
  const beijingHour = Number(
    new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" })
  );
  return beijingHour >= 22 || beijingHour < 8;
}

async function sendEmail(env, { to, subject, html, text }) {
  // 使用已验证的自定义域名（FROM_EMAIL 配置项）作为发件地址
  // 默认回退到 pansanrequest.ccwu.cc（已通过 Resend 域名验证）
  // 注意：不要以 ADMIN_EMAIL（如 163.com）作为发件人，Resend 要求发件域名必须已验证
  const fromEmail = env.FROM_EMAIL || "noreply@pansanrequest.ccwu.cc";
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

async function sendAdminNewInquiryNotification(env, inquiry) {
  console.log(`[EMAIL] sendAdminNewInquiryNotification called for inquiry #${inquiry.code}, ADMIN_EMAIL=${env.ADMIN_EMAIL || "<unset>"}, night=${isNightTime()}`);
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log("[WARN] ADMIN_EMAIL not configured, skipping admin notification.");
    return { sent: false, reason: "ADMIN_EMAIL not configured" };
  }

  // 夜间不通知
  if (isNightTime()) {
    console.log(`[INFO] Night time, skipping notification for inquiry #${inquiry.code}`);
    return { sent: false, reason: "night_time" };
  }

  const subject = `【PanSan】新询价 #${inquiry.code}`;
  const html = `<p>待处理询价码：<strong>${inquiry.code}</strong></p><p>请登录后台处理：<a href="https://pansanrequest.ccwu.cc/admin">https://pansanrequest.ccwu.cc/admin</a></p>`;

  try {
    return await sendEmail(env, { to: adminEmail, subject, html });
  } catch (e) {
    console.error("[ERROR] Failed to send admin notification:", e.message);
    return { sent: false, error: e.message };
  }
}

// 发送管理员提醒邮件（未处理询价汇总）
async function sendAdminReminderNotification(env, codes) {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log("[WARN] ADMIN_EMAIL not configured, skipping reminder.");
    return { sent: false, reason: "ADMIN_EMAIL not configured" };
  }

  if (codes.length === 0) return { sent: false, reason: "no_pending" };

  const codeList = codes.map(c => `<li><strong>${c}</strong></li>`).join("");
  const subject = `【PanSan】待处理询价提醒（${codes.length}条）`;
  const html = `<p>以下询价待处理：</p><ul>${codeList}</ul><p>请登录后台处理：<a href="https://pansanrequest.ccwu.cc/admin">https://pansanrequest.ccwu.cc/admin</a></p>`;

  try {
    return await sendEmail(env, { to: adminEmail, subject, html });
  } catch (e) {
    console.error("[ERROR] Failed to send reminder:", e.message);
    return { sent: false, error: e.message };
  }
}

// 定时检查未处理询价，超过15分钟发送提醒（最多3次）
async function handleReminderCheck(env) {
  // 夜间不发送提醒
  if (isNightTime()) {
    console.log("[INFO] Night time, skipping reminder check.");
    return;
  }

  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // 查找未处理且超过15分钟、提醒次数未达上限的询价
  const pending = await env.DB.prepare(
    "SELECT code FROM inquiries WHERE status = 'pending' AND reminder_count < 3 AND created_at < ?1"
  ).bind(fifteenMinAgo).all();

  const codes = (pending.results || []).map(r => r.code);
  if (codes.length === 0) {
    console.log("[INFO] No pending inquiries need reminder.");
    return;
  }

  console.log(`[INFO] Sending reminder for ${codes.length} pending inquiries: ${codes.join(", ")}`);

  // 发送提醒邮件
  await sendAdminReminderNotification(env, codes);

  // 批量递增提醒次数
  await env.DB.prepare(
    `UPDATE inquiries SET reminder_count = reminder_count + 1 WHERE code IN (${codes.map(() => "?").join(",")})`
  ).bind(...codes).run();
}

async function handleTestEmail(request, env) {
  try {
    const result = await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: "【PanSan】邮件测试",
      html: "<p>这是一封测试邮件。</p>"
    });
    return json({ ok: true, result, resendConfigured: !!env.RESEND_API_KEY }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: e.message, resendConfigured: !!env.RESEND_API_KEY }, 500, request, env);
  }
}

async function handleAuthSendCode(request, env) {
  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw error("Invalid email address.", 400);
  }

  // Rate limit: per email (60s cooldown, 10 per day), per IP (60s cooldown, 20 per day)
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const cooldown = 60; // 60 seconds
  const dayStart = now - (now % 86400);

  const [emailRecentCount, ipRecentCount] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM verification_codes WHERE email = ?1 AND created_at > ?2"
    ).bind(email, dayStart).first(),
    env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM verification_codes WHERE ip = ?1 AND created_at > ?2"
    ).bind(ip, dayStart).first()
  ]);

  if (emailRecentCount && emailRecentCount.cnt >= 10) {
    throw error("Too many verification codes sent to this email today. Please try again tomorrow.", 429);
  }
  if (ipRecentCount && ipRecentCount.cnt >= 20) {
    throw error("Too many verification codes sent from this IP today. Please try again tomorrow.", 429);
  }

  // Check cooldown
  const lastCode = await env.DB.prepare(
    "SELECT created_at FROM verification_codes WHERE email = ?1 ORDER BY created_at DESC LIMIT 1"
  ).bind(email).first();
  if (lastCode && lastCode.created_at && (now - lastCode.created_at) < cooldown) {
    throw error(`Please wait ${cooldown - (now - lastCode.created_at)} seconds before requesting another code.`, 429);
  }

  const code = generateVerificationCode();
  const expiresAt = now + 30 * 60; // 30 minutes

  await env.DB.prepare(
    "INSERT INTO verification_codes (email, code, expires_at, ip, created_at, used) VALUES (?1, ?2, ?3, ?4, ?5, 0)"
  ).bind(email, code, expiresAt, ip, now).run();

  const result = await sendVerificationEmail(env, email, code);

  // Never return the code in production response
  return json({ sent: result.sent }, 200, request, env);
}

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

  // Check brute force: max 5 failed attempts per email in 15 minutes
  const now = Math.floor(Date.now() / 1000);
  const window15min = now - 15 * 60;
  const [failCount] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM verification_codes WHERE email = ?1 AND used = -1 AND created_at > ?2"
    ).bind(email, window15min).first()
  ]);

  if (failCount && failCount.cnt >= 5) {
    throw error("Too many failed attempts. Please wait 15 minutes before trying again.", 429);
  }

  const row = await env.DB.prepare(
    "SELECT id, email, code, used FROM verification_codes WHERE email = ?1 AND code = ?2 AND expires_at > ?3 AND used = 0 ORDER BY id DESC LIMIT 1"
  ).bind(email, code, now).first();

  if (!row) {
    // Record failed attempt
    await env.DB.prepare(
      "INSERT INTO verification_codes (email, code, expires_at, ip, created_at, used) VALUES (?1, ?2, ?3, ?4, ?5, -1)"
    ).bind(email, code, now, request.headers.get("CF-Connecting-IP") || "unknown", now).run();
    throw error("Invalid or expired verification code.", 400);
  }

  await env.DB.prepare("UPDATE verification_codes SET used = 1 WHERE id = ?1").bind(row.id).run();

  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (email, created_at) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET email = email"
  ).bind(email, nowIso).run();

  const token = await signJwt(
    { email, exp: now + 7 * 24 * 60 * 60 }, // 7 days
    env.JWT_SECRET
  );

  return json({ token, email }, 200, request, env);
}

async function handleMyInquiries(user, request, env) {
  const result = await env.DB.prepare(
    "SELECT code, product_url, remark, shipping, payment_method, weight_estimate, status, final_freight, freight2, service_fee, total_price, admin_note, images_json, created_at, updated_at, rate_snapshot_json FROM inquiries WHERE email = ?1 ORDER BY created_at DESC"
  ).bind(user.email).all();

  const inquiries = (result.results || []).map(row => ({
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

async function handleMyForwarding(user, request, env) {
  const result = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json, created_at FROM orders WHERE email = ?1 ORDER BY created_at DESC"
  ).bind(user.email).all();

  const orders = (result.results || []).map(row => ({
    code: row.code,
    tracking_numbers: JSON.parse(row.tracking_numbers_json || "[]"),
    confirmed_trackings: JSON.parse(row.confirmed_trackings_json || "[]"),
    created_at: row.created_at
  }));

  return json({ orders }, 200, request, env);
}

async function handleGetCart(user, request, env) {
  const result = await env.DB.prepare(
    "SELECT c.id, c.inquiry_code, c.added_at, i.product_url, i.status, i.total_price, i.images_json FROM cart_items c LEFT JOIN inquiries i ON c.inquiry_code = i.code WHERE c.email = ?1 ORDER BY c.added_at DESC"
  ).bind(user.email).all();

  const items = (result.results || []).map(row => ({
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

  const addedAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO cart_items (email, inquiry_code, added_at) VALUES (?1, ?2, ?3)"
    ).bind(user.email, inquiryCode, addedAt).run();
  } catch (e) {
    // 可能已经存在
  }

  return json({ success: true }, 200, request, env);
}

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

// === Shipping Rate Management ===

async function loadShippingRates(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && shippingRatesCache && (now - shippingRatesCache.timestamp) < SHIPPING_RATES_TTL) {
    return shippingRatesCache.data;
  }

  const result = await env.DB.prepare(
    "SELECT channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment FROM shipping_rates ORDER BY channel, zone, tier_index"
  ).all();

  const data = new Map();
  for (const row of (result.results || [])) {
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

async function handleGetShippingRates(request, env) {
  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ rates: result }, 200, request, env);
}

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

  const weightG = weightKg * 1000;
  const cost = calculateFreight(rule, weightG);
  return json({
    channel,
    zone,
    weight_kg: weightKg,
    weight_g: weightG,
    ...cost
  }, 200, request, env);
}

async function handleAdminGetShippingRates(request, env) {
  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ rates: result }, 200, request, env);
}

async function handleAdminUpdateShippingRates(request, env) {
  const body = await request.json();
  const list = Array.isArray(body) ? body : (Array.isArray(body?.rates) ? body.rates : null);
  if (!list) {
    throw error("Request body must be an array of rate definitions, or { rates: [...] }.", 400);
  }

  const now = new Date().toISOString();
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
        channel, zone, buyerPays, i,
        Number(tier.min_weight_g) || 0,
        tier.max_weight_g != null ? Number(tier.max_weight_g) : null,
        costType,
        costType === "flat" ? (Number(tier.flat_cost) || 0) : null,
        costType === "per_increment" ? (Number(tier.increment_g) || 10) : null,
        costType === "per_increment" ? (Number(tier.rate_per_increment) || 0) : null,
        now
      ));

      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rate_history (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, action, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'update', ?11)`
      ).bind(
        channel, zone, buyerPays, i,
        Number(tier.min_weight_g) || 0,
        tier.max_weight_g != null ? Number(tier.max_weight_g) : null,
        costType,
        costType === "flat" ? (Number(tier.flat_cost) || 0) : null,
        costType === "per_increment" ? (Number(tier.increment_g) || 10) : null,
        costType === "per_increment" ? (Number(tier.rate_per_increment) || 0) : null,
        now
      ));
    }
  }

  // Insert new rates first; if this fails, old data is preserved
  await env.DB.batch(insertStatements);
  // Then delete old rates (those with updated_at before this batch)
  await env.DB.prepare("DELETE FROM shipping_rates WHERE updated_at < ?").bind(now).run();
  shippingRatesCache = null;

  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ success: true, rates: result }, 200, request, env);
}

async function handleAdminResetShippingRates(request, env) {
  const now = new Date().toISOString();

  const defaults = [
    { channel: "standard", zone: "A", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.85 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.9 }
    ]},
    { channel: "standard", zone: "B", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.25 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.29 }
    ]},
    { channel: "standard", zone: "C", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.5 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.55 }
    ]},
    { channel: "standard", zone: "D", buyer_pays: 23, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 20 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 3.2 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 3.25 }
    ]},
    { channel: "economy", zone: "A", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.2 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.25 }
    ]},
    { channel: "economy", zone: "B", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.5 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.55 }
    ]},
    { channel: "economy", zone: "C", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.8 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 1.85 }
    ]},
    { channel: "economy", zone: "D", buyer_pays: 10, tiers: [
      { min_weight_g: 0, max_weight_g: 100, cost_type: "flat", flat_cost: 15 },
      { min_weight_g: 100, max_weight_g: 140, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.0 },
      { min_weight_g: 140, max_weight_g: null, cost_type: "per_increment", increment_g: 10, rate_per_increment: 2.05 }
    ]}
  ];

  const insertStatements = [];

  for (const item of defaults) {
    for (let i = 0; i < item.tiers.length; i++) {
      const tier = item.tiers[i];
      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rates (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      ).bind(
        item.channel, item.zone, item.buyer_pays, i,
        tier.min_weight_g, tier.max_weight_g != null ? tier.max_weight_g : null,
        tier.cost_type,
        tier.cost_type === "flat" ? tier.flat_cost : null,
        tier.cost_type === "per_increment" ? (tier.increment_g || 10) : null,
        tier.cost_type === "per_increment" ? tier.rate_per_increment : null,
        now
      ));

      insertStatements.push(env.DB.prepare(
        `INSERT INTO shipping_rate_history (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, action, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'reset', ?11)`
      ).bind(
        item.channel, item.zone, item.buyer_pays, i,
        tier.min_weight_g, tier.max_weight_g != null ? tier.max_weight_g : null,
        tier.cost_type,
        tier.cost_type === "flat" ? tier.flat_cost : null,
        tier.cost_type === "per_increment" ? (tier.increment_g || 10) : null,
        tier.cost_type === "per_increment" ? tier.rate_per_increment : null,
        now
      ));
    }
  }

  // Insert new rates first; if this fails, old data is preserved
  await env.DB.batch(insertStatements);
  // Then delete old rates (those with updated_at before this batch)
  await env.DB.prepare("DELETE FROM shipping_rates WHERE updated_at < ?").bind(now).run();
  shippingRatesCache = null;

  const rates = await loadShippingRates(env, { force: true });
  const result = [];
  for (const [, rule] of rates) {
    result.push(rule);
  }
  return json({ success: true, rates: result }, 200, request, env);
}

// === Announcement Handlers ===

// HTML sanitizer: strip all tags except safe whitelist, strip all attributes except href
const SAFE_TAGS = new Set(["b", "i", "strong", "em", "u", "br", "p", "ul", "ol", "li", "a", "span", "div", "h3", "h4"]);
function sanitizeHtml(html) {
  if (typeof html !== "string") return "";
  // Strip all tags except safe ones, remove all attributes
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (_, slash, tag, attrs) => {
      const lower = tag.toLowerCase();
      if (!SAFE_TAGS.has(lower)) return "";
      if (lower === "a") {
        const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
        const href = hrefMatch && /^https?:\/\//i.test(hrefMatch[1]) ? ` href="${hrefMatch[1]}"` : "";
        return `<${slash}${lower}${href} rel="noopener noreferrer">`;
      }
      return `<${slash}${lower}>`;
    });
}

async function handleGetAnnouncement(request, env) {
  const row = await env.DB.prepare(
    "SELECT id, content, is_enabled, updated_at FROM site_announcement WHERE is_enabled = 1 ORDER BY updated_at DESC LIMIT 1"
  ).first();
  if (!row) {
    return json({ content: "", is_enabled: false }, 200, request, env);
  }
  return json({ content: row.content, is_enabled: true, updated_at: row.updated_at }, 200, request, env);
}

async function handleAdminUpdateAnnouncement(request, env) {
  const body = await request.json();
  const content = sanitizeHtml(typeof body.content === "string" ? body.content : "");
  const isEnabled = body.is_enabled === false ? 0 : 1;
  const now = new Date().toISOString();

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
