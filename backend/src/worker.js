const DEFAULT_MAX_IMAGES = 5;

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && path === "/health") {
        return json(
          {
            ok: true,
            runtime: "cloudflare-workers",
            storage: "r2",
            database: "d1"
          },
          200,
          request,
          env
        );
      }

      if (request.method === "GET" && path.startsWith("/files/")) {
        return handleFileRequest(path, request, env);
      }

      if (request.method === "POST" && path === "/api/inquiries") {
        return handleCreateInquiry(request, env);
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

      return json({ error: "Not found." }, 404, request, env);
    } catch (err) {
      const status = err.status || 500;
      const message = status >= 500 ? "Internal server error." : err.message;
      return json({ error: message }, status, request, env);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledCleanup(env));
  }
};

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const allowOrigin = allowedOrigins.includes("*")
    ? "*"
    : requestOrigin === "null"
      ? "null"
      : (allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] || "*");

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

function parseAllowedOrigins(value) {
  return String(value || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

  return text;
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

async function requireAdmin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!env.ADMIN_TOKEN) {
    throw error("ADMIN_TOKEN is not configured.", 503);
  }

  if (token !== env.ADMIN_TOKEN) {
    throw error("Unauthorized", 401);
  }
}

function parseDataUri(dataUri) {
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
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
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

async function handleCreateInquiry(request, env) {
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

  const uploadedImages = [];
  for (const image of images) {
    uploadedImages.push(await saveBase64Image(image, code, request, env));
  }

  await env.DB.prepare(
    `INSERT INTO inquiries
      (code, product_url, remark, shipping, payment_method, weight_estimate, status, final_freight, freight2, service_fee, total_price, admin_note, images_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, NULL, NULL, '', ?7, ?8, ?8)`
  )
    .bind(code, productUrl, remark, shipping, paymentMethod, weightEstimate, JSON.stringify(uploadedImages), createdAt)
    .run();

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
  return json(inquiry, 200, request, env);
}

async function handleAdminList(request, env) {
  const url = new URL(request.url);
  const status = cleanString(url.searchParams.get("status") || "", { max: 20 });
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("page_size") || 20), 1), 100);
  const offset = (page - 1) * pageSize;

  let listQuery = "SELECT * FROM inquiries";
  let countQuery = "SELECT COUNT(*) AS total FROM inquiries";
  const bindings = [];

  if (status) {
    listQuery += " WHERE status = ?1";
    countQuery += " WHERE status = ?1";
    bindings.push(status);
  }

  listQuery += ` ORDER BY datetime(created_at) DESC LIMIT ${pageSize} OFFSET ${offset}`;

  const listStmt = env.DB.prepare(listQuery).bind(...bindings);
  const countStmt = env.DB.prepare(countQuery).bind(...bindings);
  const [listResult, countResult] = await Promise.all([listStmt.all(), countStmt.first()]);

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

async function handleFileRequest(path, request, env) {
  const key = decodeURIComponent(path.slice("/files/".length));
  if (!key || !key.startsWith("inquiries/") || key.includes("..") || key.includes("\\")) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }

  const object = await env.QUOTE_IMAGES.get(key);
  if (!object) {
    return new Response("Not found.", { status: 404, headers: buildCorsHeaders(request, env) });
  }

  const headers = new Headers(buildCorsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
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
  const validTrackings = trackingNumbers.filter(t => typeof t === "string" && t.trim());
  const createdAt = new Date().toISOString();

  const confirmedTrackings = [];
  for (const tracking of validTrackings) {
    const match = await env.DB.prepare(
      "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
    ).bind(tracking).first();
    if (match) {
      confirmedTrackings.push(tracking);
    }
  }

  await env.DB.prepare(
    "INSERT INTO orders (code, tracking_numbers_json, confirmed_trackings_json, created_at) VALUES (?1, ?2, ?3, ?4)"
  ).bind(code, JSON.stringify(validTrackings), JSON.stringify(confirmedTrackings), createdAt).run();

  return json({ code, tracking_numbers: validTrackings, confirmed_trackings: confirmedTrackings, created_at: createdAt }, 201, request, env);
}

async function handleAdminOrders(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const offset = Number(url.searchParams.get("offset")) || 0;

  const result = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json, created_at FROM orders ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
  ).bind(limit, offset).all();

  const orders = (result.results || []).map(row => ({
    code: row.code,
    tracking_numbers: JSON.parse(row.tracking_numbers_json || "[]"),
    confirmed_trackings: JSON.parse(row.confirmed_trackings_json || "[]"),
    created_at: row.created_at
  }));

  return json({ orders, total: orders.length }, 200, request, env);
}

async function handleSearchOrders(request, env) {
  const url = new URL(request.url);
  const keyword = (url.searchParams.get("keyword") || "").trim();

  if (!keyword) {
    throw error("Search keyword is required.");
  }

  const result = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json, created_at FROM orders WHERE tracking_numbers_json LIKE ?1 ORDER BY created_at DESC"
  ).bind(`%${keyword}%`).all();

  const orders = (result.results || []).map(row => ({
    code: row.code,
    tracking_numbers: JSON.parse(row.tracking_numbers_json || "[]"),
    confirmed_trackings: JSON.parse(row.confirmed_trackings_json || "[]"),
    created_at: row.created_at
  }));

  return json({ orders, keyword, total: orders.length }, 200, request, env);
}

async function handleConfirmOrder(code, request, env) {
  const existing = await env.DB.prepare("SELECT code, tracking_numbers_json, confirmed_trackings_json FROM orders WHERE code = ?1").bind(code).first();
  if (!existing) {
    throw error("Order not found.");
  }

  const body = await request.json().catch(() => ({}));
  const trackingNumber = (body.tracking_number || "").trim();
  if (!trackingNumber) {
    throw error("Tracking number is required.");
  }

  const trackingNumbers = JSON.parse(existing.tracking_numbers_json || "[]");
  const confirmedTrackings = JSON.parse(existing.confirmed_trackings_json || "[]");

  const isConfirmed = confirmedTrackings.includes(trackingNumber);
  if (isConfirmed) {
    const updated = confirmedTrackings.filter(t => t !== trackingNumber);
    await env.DB.prepare(
      "UPDATE orders SET confirmed_trackings_json = ?2 WHERE code = ?1"
    ).bind(code, JSON.stringify(updated)).run();
    return json({ code, tracking_number: trackingNumber, confirmed: false }, 200, request, env);
  } else {
    confirmedTrackings.push(trackingNumber);
    await env.DB.prepare(
      "UPDATE orders SET confirmed_trackings_json = ?2 WHERE code = ?1"
    ).bind(code, JSON.stringify(confirmedTrackings)).run();
    return json({ code, tracking_number: trackingNumber, confirmed: true }, 200, request, env);
  }
}

async function handleGetOrder(request, env) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();

  if (!code) {
    throw error("Order code is required.");
  }

  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json, created_at FROM orders WHERE code = ?1"
  ).bind(code).first();

  if (!order) {
    return json({ error: "Order not found." }, 404, request, env);
  }

  return json({
    code: order.code,
    tracking_numbers: JSON.parse(order.tracking_numbers_json || "[]"),
    confirmed_trackings: JSON.parse(order.confirmed_trackings_json || "[]"),
    created_at: order.created_at
  }, 200, request, env);
}

async function handleAddTrackingToOrder(request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw error("Invalid order code.");
  }

  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json FROM orders WHERE code = ?1"
  ).bind(code).first();

  if (!order) {
    throw error("Order not found.");
  }

  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");
  const confirmedTrackings = JSON.parse(order.confirmed_trackings_json || "[]");

  const newTrackings = Array.isArray(body.tracking_numbers) ? body.tracking_numbers : [];
  const validNewTrackings = newTrackings.filter(t => typeof t === "string" && t.trim());

  for (const tracking of validNewTrackings) {
    if (!trackingNumbers.includes(tracking)) {
      trackingNumbers.push(tracking);
      const match = await env.DB.prepare(
        "SELECT id FROM tracking_whitelist WHERE tracking_number = ?1"
      ).bind(tracking).first();
      if (match) {
        confirmedTrackings.push(tracking);
      }
    }
  }

  await env.DB.prepare(
    "UPDATE orders SET tracking_numbers_json = ?2, confirmed_trackings_json = ?3 WHERE code = ?1"
  ).bind(code, JSON.stringify(trackingNumbers), JSON.stringify(confirmedTrackings)).run();

  return json({
    code,
    tracking_numbers: trackingNumbers,
    confirmed_trackings: confirmedTrackings
  }, 200, request, env);
}

async function handleRemoveTrackingFromOrder(request, env) {
  const body = await request.json();
  const code = cleanString(body.code, { max: 8, empty: false }).toUpperCase();
  const trackingNumber = cleanString(body.tracking_number, { max: 100, empty: false });

  if (!code || !trackingNumber) {
    throw error("Invalid request.");
  }

  const order = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json FROM orders WHERE code = ?1"
  ).bind(code).first();

  if (!order) {
    throw error("Order not found.");
  }

  const trackingNumbers = JSON.parse(order.tracking_numbers_json || "[]");
  const confirmedTrackings = JSON.parse(order.confirmed_trackings_json || "[]");

  const idx = trackingNumbers.indexOf(trackingNumber);
  if (idx === -1) {
    throw error("Tracking number not found.");
  }

  trackingNumbers.splice(idx, 1);
  const confirmedIdx = confirmedTrackings.indexOf(trackingNumber);
  if (confirmedIdx !== -1) {
    confirmedTrackings.splice(confirmedIdx, 1);
  }

  await env.DB.prepare(
    "UPDATE orders SET tracking_numbers_json = ?2, confirmed_trackings_json = ?3 WHERE code = ?1"
  ).bind(code, JSON.stringify(trackingNumbers), JSON.stringify(confirmedTrackings)).run();

  return json({
    code,
    tracking_numbers: trackingNumbers,
    confirmed_trackings: confirmedTrackings
  }, 200, request, env);
}

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

  const orders = await env.DB.prepare(
    "SELECT code, tracking_numbers_json, confirmed_trackings_json FROM orders WHERE tracking_numbers_json LIKE ?1"
  ).bind(`%${trackingNumber}%`).all();

  for (const row of orders.results || []) {
    const trackingNumbers = JSON.parse(row.tracking_numbers_json || "[]");
    const confirmedTrackings = JSON.parse(row.confirmed_trackings_json || "[]");

    if (trackingNumbers.includes(trackingNumber) && !confirmedTrackings.includes(trackingNumber)) {
      confirmedTrackings.push(trackingNumber);
      await env.DB.prepare(
        "UPDATE orders SET confirmed_trackings_json = ?2 WHERE code = ?1"
      ).bind(row.code, JSON.stringify(confirmedTrackings)).run();
    }
  }

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
