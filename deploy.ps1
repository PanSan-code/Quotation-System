# deploy.ps1 —— PanSan 一键部署（前端 Pages + 后端 Worker）
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "===== 1/4 部署后端 Worker ====="
Push-Location "$root\backend"
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "后端部署失败" }
Pop-Location

Write-Host "===== 2/4 部署前端 Pages（跳过缓存） ====="
Push-Location "$root\frontend"
npx wrangler pages deploy . --project-name=quote-system-frontend --branch=main --commit-dirty=true --skip-caching
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "前端部署失败" }
Pop-Location

Write-Host "===== 3/4 部署后必做：Dashboard 手动操作 ====="
Write-Host "① 打开 https://dash.cloudflare.com → Workers & Pages → quote-system-frontend"
Write-Host "② Deployments 标签 → 最新部署 → ⋯ → Rollback to this deployment（强制自定义域名指向新版）"
Write-Host "③ Caching → Configuration → Purge Everything（清除 CDN 缓存）"
Write-Host "④ 若国内打不开：DNS → Records → pansanrequest → 代理状态改为【仅 DNS】(灰云)"

Write-Host "===== 4/4 部署后自检 ====="
Write-Host "前端:  https://pansanrequest.ccwu.cc"
Write-Host "后端:  https://quote-system-api.zp1364625224.workers.dev/health"

Write-Host "===== 完成 ====="