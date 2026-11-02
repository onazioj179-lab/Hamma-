#!/usr/bin/env pwsh
# Singularity Pack - Dev Server Startup Script

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Singularity Pack - Dev Server" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Starting server on all network interfaces...`n" -ForegroundColor Yellow

# Change to script directory
Set-Location $PSScriptRoot

# Get local IP address
$localIP = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*","Ethernet*" | Where-Object {$_.IPAddress -notlike "169.*"} | Select-Object -First 1).IPAddress

Write-Host "Server will be accessible at:" -ForegroundColor White
Write-Host "  Local:   http://localhost:5009/" -ForegroundColor Cyan
Write-Host "  Network: http://${localIP}:5009/`n" -ForegroundColor Cyan

Write-Host "Press Ctrl+C to stop the server`n" -ForegroundColor Gray

# Start the dev server
npm run dev
