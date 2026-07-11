-- 动态运费费率管理 - 增量迁移（仅创建新表，不重复添加已存在的列）
-- 适用于已经应用过 schema.sql 但缺少动态费率相关表的场景

-- 动态运费费率表
CREATE TABLE IF NOT EXISTS shipping_rates (
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
  updated_at TEXT NOT NULL,
  UNIQUE(channel, zone, tier_index)
);

CREATE INDEX IF NOT EXISTS idx_shipping_rates_channel_zone
ON shipping_rates (channel, zone);

-- 运费费率变更历史
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
  action TEXT NOT NULL,
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
