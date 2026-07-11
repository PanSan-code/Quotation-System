try {
  $response = Invoke-WebRequest -Uri 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates' -Method Get -UseBasicParsing
  Write-Host "Status:" $response.StatusCode
  Write-Host "Content-Length:" $response.Headers["Content-Length"]
  Write-Host "Content-Type:" $response.Headers["Content-Type"]
  Write-Host "Body:"
  Write-Host $response.Content
  Write-Host "---END---"
} catch {
  $ex = $_.Exception
  if ($ex.Response) {
    Write-Host "Status:" $ex.Response.StatusCode
    $raw = $ex.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($raw)
    $body = $reader.ReadToEnd()
    Write-Host "Content-Length:" $ex.Response.Headers["Content-Length"]
    Write-Host "Content-Type:" $ex.Response.Headers["Content-Type"]
    Write-Host "Body:[$body]"
    Write-Host "Body-Length:" $body.Length
  } else {
    Write-Host "No response object"
  }
}
