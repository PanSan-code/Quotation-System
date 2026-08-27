-- 修复：verification_codes 表补 ip / created_at 列（幂等：先查后加）

-- D1 不支持 IF NOT EXISTS ADD COLUMN，用两步：查列 → 缺则加
-- 1) 检查: SELECT name FROM pragma_table_info('verification_codes') WHERE name IN ('ip','created_at');
-- 2) 缺失时执行:
-- ALTER TABLE verification_codes ADD COLUMN ip TEXT NOT NULL DEFAULT '';
-- ALTER TABLE verification_codes ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;