# backend/migrate.ps1 —— 幂等迁移助手
$ErrorActionPreference = "Stop"
cd $PSScriptRoot

function Exec-D1($sql) {
  npx wrangler d1 execute quote-system --remote --command $sql
  if ($LASTEXITCODE -ne 0) { throw "D1 执行失败: $sql" }
}

Write-Host "== 校验 verification_codes 表列 =="
Exec-D1 "SELECT name FROM pragma_table_info('verification_codes') WHERE name IN ('ip','created_at');"

Write-Host "== 校验 inquiries 表列 =="
Exec-D1 "SELECT name FROM pragma_table_info('inquiries') WHERE name IN ('email','payment_method','rate_snapshot_json','reminder_count');"

Write-Host "== 校验 orders 表列 =="
Exec-D1 "SELECT name FROM pragma_table_info('orders') WHERE name = 'email';"

Write-Host "== 校验 shipping_rates / site_announcement 表存在 =="
Exec-D1 "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('shipping_rates','site_announcement');"

Write-Host "完成。缺失的列按 migrations/ 下对应文件补 ALTER TABLE。"