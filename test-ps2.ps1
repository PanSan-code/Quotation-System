$urls = @(
  'https://quote-system-api.zp1364625224.workers.dev/health',
  'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates'
)

foreach ($url in $urls) {
  Write-Host "=== $url ===" -ForegroundColor Cyan
  try {
    $resp = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 30 -UseBasicParsing -Headers @{'User-Agent'='ps-test/1.0'}
    Write-Host "Status: $($resp.StatusCode)"
    Write-Host "Content-Type: $($resp.Headers['Content-Type'])"
    Write-Host "Content-Length: $($resp.Headers['Content-Length'])"
    Write-Host "Body-Length: $($resp.RawContentLength)"
    Write-Host "Body:"
    Write-Host $resp.Content
  } catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
      Write-Host "Status: $($_.Exception.Response.StatusCode)"
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      Write-Host "Body: $($reader.ReadToEnd())"
    }
  }
  Write-Host ""
}
