-- 初始化默认运费费率（仅在 shipping_rates 表为空时执行）
-- 每个 (channel, zone) 组合包含若干重量阶梯
-- 首阶梯使用 'flat' 模式（首重固定价），后续阶梯使用 'per_increment' 模式

INSERT OR IGNORE INTO shipping_rates
  (channel, zone, buyer_pays, tier_index, min_weight_g, max_weight_g, cost_type, flat_cost, increment_g, rate_per_increment, updated_at)
VALUES
  -- Standard (空运) Zone A: 23 base + 4.5/10g + 买家支付 40
  ('standard', 'A', 40, 0, 0,   50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('standard', 'A', 40, 1, 50,   NULL,  'per_increment', NULL,  10,   4.5,  datetime('now')),
  -- Standard (空运) Zone B: 23 base + 4.5/10g + 买家支付 60
  ('standard', 'B', 60, 0, 0,   50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('standard', 'B', 60, 1, 50,   NULL,  'per_increment', NULL,  10,   4.5,  datetime('now')),
  -- Standard (空运) Zone C: 23 base + 4.5/10g + 买家支付 60
  ('standard', 'C', 60, 0, 0,   50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('standard', 'C', 60, 1, 50,   NULL,  'per_increment', NULL,  10,   4.5,  datetime('now')),
  -- Standard (空运) Zone D: 23 base + 4.5/10g + 买家支付 60
  ('standard', 'D', 60, 0, 0,   50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('standard', 'D', 60, 1, 50,   NULL,  'per_increment', NULL,  10,   4.5,  datetime('now')),

  -- Economy (海运) Zone A: 23 base + 4.5/10g (≤140g) + 1.9/10g (>140g) + 买家支付 20
  ('economy', 'A', 20, 0, 0,    50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('economy', 'A', 20, 1, 50,   140,   'per_increment', NULL,  10,   4.5,  datetime('now')),
  ('economy', 'A', 20, 2, 140,  NULL,  'per_increment', NULL,  10,   1.9,  datetime('now')),
  -- Economy (海运) Zone B: 22.99 base + 4.5/10g (≤140g) + 1.9/10g (>140g) + 买家支付 20
  ('economy', 'B', 20, 0, 0,    50,    'flat',          22.99, NULL, NULL, datetime('now')),
  ('economy', 'B', 20, 1, 50,   140,   'per_increment', NULL,  10,   4.5,  datetime('now')),
  ('economy', 'B', 20, 2, 140,  NULL,  'per_increment', NULL,  10,   1.9,  datetime('now')),
  -- Economy (海运) Zone C: 23 base + 4.5/10g (≤140g) + 1.9/10g (>140g) + 买家支付 45
  ('economy', 'C', 45, 0, 0,    50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('economy', 'C', 45, 1, 50,   140,   'per_increment', NULL,  10,   4.5,  datetime('now')),
  ('economy', 'C', 45, 2, 140,  NULL,  'per_increment', NULL,  10,   1.9,  datetime('now')),
  -- Economy (海运) Zone D: 23 base + 4.5/10g (≤140g) + 1.9/10g (>140g) + 买家支付 45
  ('economy', 'D', 45, 0, 0,    50,    'flat',          23,    NULL, NULL, datetime('now')),
  ('economy', 'D', 45, 1, 50,   140,   'per_increment', NULL,  10,   4.5,  datetime('now')),
  ('economy', 'D', 45, 2, 140,  NULL,  'per_increment', NULL,  10,   1.9,  datetime('now'));
