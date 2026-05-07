CREATE TABLE IF NOT EXISTS inquiries (
  code TEXT PRIMARY KEY,
  product_url TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  shipping TEXT NOT NULL,
  weight_estimate REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  final_freight REAL,
  service_fee REAL,
  total_price REAL,
  admin_note TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status_created_at
ON inquiries (status, created_at DESC);

