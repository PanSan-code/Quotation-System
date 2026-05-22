CREATE TABLE IF NOT EXISTS inquiries (
  code TEXT PRIMARY KEY,
  product_url TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  shipping TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'gcash',
  weight_estimate REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  final_freight REAL,
  freight2 REAL,
  service_fee REAL,
  total_price REAL,
  shopee_after_tax REAL,
  admin_note TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status_created_at
ON inquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  code TEXT PRIMARY KEY,
  tracking_numbers_json TEXT NOT NULL DEFAULT '[]',
  confirmed_trackings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS tracking_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_whitelist_number
ON tracking_whitelist (tracking_number);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS rate_limits (
  route_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
ON rate_limits (expires_at);

