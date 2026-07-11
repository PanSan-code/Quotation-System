$url = 'https://quote-system-api.zp1364625224.workers.dev/api/shipping-rates'
$req = [System.Net.HttpWebRequest]::Create($url)
$req.Method = 'GET'
$req.AllowAutoRedirect = $false
try {
  $resp = $req.GetResponse()
  Write-Host "Status:" $resp.StatusCode
  Write-Host "Headers:"
  $resp.Headers | Format-List
  $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
  $body = $reader.ReadToEnd()
  Write-Host "Body:[$body]"
  Write-Host "BodyLength:" $body.Length
} catch {
  $ex = $_.Exception
  if ($ex.Response) {
    Write-Host "Status:" $ex.Response.StatusCode
    Write-Host "Headers:"
    $ex.Response.Headers | Format-List
    $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Host "Body:[$body]"
    Write-Host "BodyLength:" $body.Length
    Write-Host "BodyBytes:"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Write-Host ($bytes | ForEach-Object { $_.ToString('X2') }) -Separator ' '
  }
}
