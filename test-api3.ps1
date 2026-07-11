try {
  $response = Invoke-WebRequest -Uri 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates' -Method Get -UseBasicParsing -Headers @{"Accept"="*/*"}
  Write-Host "Status:" $response.StatusCode
  Write-Host "Headers:"
  $response.Headers | Format-List
  Write-Host "Body:"
  Write-Host $response.Content
} catch {
  Write-Host "ERROR Status:" $_.Exception.Response.StatusCode.value__
  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  Write-Host "Body:"
  Write-Host $reader.ReadToEnd()
  Write-Host "Headers:"
  $_.Exception.Response.Headers | Format-List
}
