param([int]$Port = 5014, [string]$Address = '192.168.0.103', [string]$Interface = 'Wi-Fi')
$ErrorActionPreference = 'Stop'
# Run once in an Administrator PowerShell. This changes no global firewall policy.
$ruleName = "HAMMA LAN Test $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $Port -LocalAddress $Address -RemoteAddress LocalSubnet -InterfaceAlias $Interface -Profile Any | Out-Null
}
Write-Host "Allowed local Wi-Fi clients to ${Address}:$Port only."
Write-Host "Remove later: Remove-NetFirewallRule -DisplayName '$ruleName'"
