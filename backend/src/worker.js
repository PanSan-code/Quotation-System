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

      return json({ error: "Not found." }, 404, request, env);
    } catch (err) {
      const status = err.status || 500;
      const message = status >= 500 ? "Internal server error." : err.message;
      return json({ error: message }, status, request, env);
    }
  }
};

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const allowOrigin = allowedOrigins.includes("*")
    ? "*"
    : (allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] || "*");

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
    weight_estimate: row.weight_estimate,
    status: row.status,
    final_freight: row.final_freight,
    service_fee: row.service_fee,
    total_price: row.total_price,
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
    new URL(productUrl);
  } catch {
    throw error("product_url must be a valid URL.");
  }

  const remark = cleanString(body.remark, { max: 3000 });
  const shipping = normalizeShipping(body.shipping);
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
      (code, product_url, remark, shipping, weight_estimate, status, final_freight, service_fee, total_price, admin_note, images_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', NULL, NULL, NULL, '', ?6, ?7, ?7)`
  )
    .bind(code, productUrl, remark, shipping, weightEstimate, JSON.stringify(uploadedImages), createdAt)
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
  const serviceFee = normalizeMoney(body.service_fee, "service_fee");
  const totalPrice = normalizeMoney(body.total_price, "total_price");
  const adminNote = cleanString(body.admin_note, { max: 3000 });
  const updatedAt = new Date().toISOString();

  const nextFreight = nextStatus === "pending" ? null : finalFreight;
  const nextServiceFee = nextStatus === "pending" ? null : serviceFee;
  const nextTotal = nextStatus === "pending" ? null : calculateTotal(finalFreight, serviceFee, totalPrice);

  await env.DB.prepare(
    `UPDATE inquiries
     SET status = ?2,
         final_freight = ?3,
         service_fee = ?4,
         total_price = ?5,
         admin_note = ?6,
         updated_at = ?7
     WHERE code = ?1`
  )
    .bind(code, nextStatus, nextFreight, nextServiceFee, nextTotal, adminNote, updatedAt)
    .run();

  const updated = await getInquiryByCode(code, env);
  return json(updated, 200, request, env);
}

async function handleFileRequest(path, request, env) {
  const key = decodeURIComponent(path.slice("/files/".length));
  if (!key) {
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
