try {
  $response = Invoke-WebRequest -Uri 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates' -Method Get -UseBasicParsing
  Write-Host "Status:" $response.StatusCode
  Write-Host "Body:"
  Write-Host $response.Content
} catch {
  Write-Host "ERROR Status:" $_.Exception.Response.StatusCode.value__
  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  Write-Host "Body:"
  Write-Host $reader.ReadToEnd()
}
