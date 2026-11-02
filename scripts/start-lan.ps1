param([int]$Port = 5014, [string]$Address = '')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not $Address) {
  $Address = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.InterfaceAlias -like '*Wi-Fi*' -and $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  } | Select-Object -First 1 -ExpandProperty IPAddress
}
if (-not $Address) { throw 'Pass -Address with this computer''s private Wi-Fi IPv4 address.' }
Write-Host "Phones on the same Wi-Fi: http://${Address}:$Port"
Write-Host 'Keep this terminal and computer running. No router port forwarding is needed.'
python -m processor.server --lan --host 0.0.0.0 --allow-host $Address --port $Port --data .hamma-data/lan-test
