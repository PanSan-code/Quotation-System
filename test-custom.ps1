$urls = @('https://api.pansanrequest.ccwu.cc/health', 'https://api.pansanrequest.ccwu.cc/api/shipping-rates')
foreach ($url in $urls) {
  Write-Host "=== $url ===" -ForegroundColor Cyan
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    Write-Host "Status: $($resp.StatusCode)"
    Write-Host "Body: $($resp.Content)"
  } catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
      Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
    }
  }
}