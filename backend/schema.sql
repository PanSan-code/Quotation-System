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
  notified_at TEXT,
  email TEXT NOT NULL DEFAULT '',
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status_created_at
ON inquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  code TEXT PRIMARY KEY,
  tracking_numbers_json TEXT NOT NULL DEFAULT '[]',
  confirmed_trackings_json TEXT NOT NULL DEFAULT '[]',
  email TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_email_code
ON verification_codes (email, code);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  inquiry_code TEXT NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE(email, inquiry_code)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_email
ON cart_items (email);

-- 为已有的 inquiries 表增加 email 字段（如果不存在）
ALTER TABLE inquiries ADD COLUMN email TEXT DEFAULT '';

-- 为已有的 inquiries 表增加费率快照字段（如果不存在）
-- 用于在报价时锁定当时的费率，防止后续费率变更影响历史报价
ALTER TABLE inquiries ADD COLUMN rate_snapshot_json TEXT NOT NULL DEFAULT '{}';

-- 为已有的 inquiries 表增加提醒次数字段（如果不存在）
-- 用于邮件提醒功能：未处理询价超过15分钟发送提醒，最多3次
ALTER TABLE inquiries ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;

-- 动态运费费率表（每条记录是一个重量阶梯）
-- cost_type:
--   'flat'            -> 首重固定价，使用 flat_cost
--   'per_increment'   -> 超过 min_weight_g 后每 increment_g 收 rate_per_increment PHP
CREATE TABLE IF NOT EXISTS shipping_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,            -- 'standard' (空运) | 'economy' (海运)
  zone TEXT NOT NULL,               -- 'A' | 'B' | 'C' | 'D'
  buyer_pays REAL NOT NULL,         -- 买家支付价（最终运费 = 各阶梯费用合计 + buyer_pays）
  tier_index INTEGER NOT NULL,      -- 阶梯顺序（0, 1, 2...）
  min_weight_g REAL NOT NULL,       -- 起始重量 (g)
  max_weight_g REAL,                -- 结束重量 (g)，NULL 表示无上限
  cost_type TEXT NOT NULL,          -- 'flat' | 'per_increment'
  flat_cost REAL,                   -- cost_type=flat 时的固定值
  increment_g REAL,                 -- cost_type=per_increment 时的步长 (g)
  rate_per_increment REAL,          -- cost_type=per_increment 时的单价 (PHP)
  updated_at TEXT NOT NULL,
  UNIQUE(channel, zone, tier_index)
);

CREATE INDEX IF NOT EXISTS idx_shipping_rates_channel_zone
ON shipping_rates (channel, zone);

-- 运费费率变更历史（审计）
CREATE TABLE IF NOT EXISTS shipping_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  zone TEXT NOT NULL,
  buyer_pays REAL NOT NULL,
  tier_index INTEGER NOT NULL,
  min_weight_g REAL NOT NULL,
  max_weight_g REAL,
  cost_type TEXT NOT NULL,
  flat_cost REAL,
  increment_g REAL,
  rate_per_increment REAL,
  action TEXT NOT NULL,            -- 'create' | 'update' | 'delete'
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipping_rate_history_changed_at
ON shipping_rate_history (changed_at DESC);

-- 公告/温馨提示管理（前台首页弹窗）
CREATE TABLE IF NOT EXISTS site_announcement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,           -- HTML 内容
  is_enabled INTEGER NOT NULL DEFAULT 1, -- 1=启用 0=禁用
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 单条公告即可，最多一条生效

-- 为已有的 orders 表增加 email 字段（如果不存在）
ALTER TABLE orders ADD COLUMN email TEXT DEFAULT '';

