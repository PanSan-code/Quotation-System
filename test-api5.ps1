try {
  $response = Invoke-WebRequest -Uri 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates' -Method Get -UseBasicParsing
  Write-Host "Status:" $response.StatusCode
  Write-Host "RawContent-Type:" $response.Headers["Content-Type"]
  $raw = $response.RawContentStream
  $reader = New-Object System.IO.StreamReader($raw)
  $body = $reader.ReadToEnd()
  Write-Host "RawBody:[$body]"
  Write-Host "RawBodyLength:" $body.Length
} catch {
  $ex = $_.Exception
  if ($ex.Response) {
    Write-Host "Status:" $ex.Response.StatusCode
    $raw = $ex.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($raw)
    $body = $reader.ReadToEnd()
    Write-Host "RawBody:[$body]"
    Write-Host "RawBodyLength:" $body.Length
  } else {
    Write-Host "No response object"
  }
}
