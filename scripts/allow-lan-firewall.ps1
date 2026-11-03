param([int]$Port = 5014, [string]$Address = '', [string]$Interface = '')
$ErrorActionPreference = 'Stop'
# Run in Administrator PowerShell. Restrict this port to local-subnet clients.
$interfaces = if ($Interface) { @($Interface) } else {
  @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } | Select-Object -ExpandProperty InterfaceAlias -Unique)
}
if (-not $interfaces.Count) { throw 'No private LAN interface was found. Connect to your network and try again.' }
$localAddress = if ($Address) { $Address } else { 'Any' }
$ruleName = "HAMMA LAN Test $Port"
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($rule) {
  $rule | Set-NetFirewallRule -Enabled True -Profile Any -InterfaceAlias $interfaces
  $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
  $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress $localAddress -RemoteAddress LocalSubnet
} else {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress $localAddress -RemoteAddress LocalSubnet -InterfaceAlias $interfaces -Profile Any | Out-Null
}
Write-Host "Allowed local-subnet clients to HAMMA port $Port on $($interfaces -join ', ')."
Write-Host "Remove later: Remove-NetFirewallRule -DisplayName '$ruleName'"
