$urls = @(
  'https://quote-system-api.zp1364625224.workers.dev/health',
  'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates'
)

foreach ($url in $urls) {
  Write-Host "=== $url ===" -ForegroundColor Cyan
  try {
    $response = Invoke-WebRequest -Uri $url -Method Get -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Body:"
    Write-Host $response.Content
  } catch {
    $ex = $_.Exception
    Write-Host "ERROR Status: $($ex.Response.StatusCode.value__)"
    if ($ex.Response) {
      $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
      Write-Host "Body: $($reader.ReadToEnd())"
    }
  }
  Write-Host ""
}
