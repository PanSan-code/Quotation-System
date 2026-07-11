$urls = @(
  'https://quote-system-api.zp1364625224.workers.dev/health',
  'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates',
  'https://quote-system-api.zp1364625224.workers.dev/api/shipping/estimate'
)

foreach ($url in $urls) {
  Write-Host "=== $url ===" -ForegroundColor Cyan
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'GET'
    $req.Timeout = 30000
    $req.UserAgent = 'ps-test/1.0'
    $resp = $req.GetResponse()
    Write-Host "Status: $($resp.StatusCode)"
    Write-Host "Content-Type: $($resp.ContentType)"
    Write-Host "Content-Length: $($resp.ContentLength)"
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Host "Body-Length: $($body.Length)"
    Write-Host "Body: $body"
  } catch {
    $ex = $_.Exception
    if ($ex.Response) {
      Write-Host "Status: $($ex.Response.StatusCode)"
      Write-Host "Content-Type: $($ex.Response.ContentType)"
      Write-Host "Content-Length: $($ex.Response.ContentLength)"
      $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
      $body = $reader.ReadToEnd()
      Write-Host "Body-Length: $($body.Length)"
      Write-Host "Body: $body"
    } else {
      Write-Host "No response. Error: $($ex.Message)"
    }
  }
  Write-Host ""
}
