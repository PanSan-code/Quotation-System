try {
  $response = Invoke-RestMethod -Uri 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates' -Method Get
  Write-Host "SUCCESS:"
  $response | ConvertTo-Json -Depth 5
} catch {
  Write-Host "ERROR:" $_.Exception.Message
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host "Body:" $reader.ReadToEnd()
  }
}
