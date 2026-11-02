#!/usr/bin/env pwsh
# SPK Backend Server - Production Starter Script
# Singularity Pack Universal Compression Platform

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   SINGULARITY PACK (SPK) - Universal Compression Server" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Validate Rust installation
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force -Path 'buildlogs' | Out-Null

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust/Cargo not found" -ForegroundColor Red
    Write-Host "Install from: https://rustup.rs/" -ForegroundColor Yellow
    exit 1
}

Write-Host "[BUILD] Compiling SPK backend (release mode)..." -ForegroundColor Yellow
cargo build --release --bin spk-server 2>&1 | Out-File -FilePath "buildlogs/build-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed - check buildlogs/" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Build completed successfully" -ForegroundColor Green
Write-Host ""

# Configure environment
$env:RUST_LOG = "info,spk_backend=debug"
$env:PORT = "3000"

Write-Host "[START] Launching SPK Backend Server..." -ForegroundColor Green
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Port: $($env:PORT)" -ForegroundColor White
Write-Host "  Log Level: $($env:RUST_LOG)" -ForegroundColor White
Write-Host "  Build Logs: buildlogs/" -ForegroundColor White
Write-Host ""

Write-Host "Enabled Features:" -ForegroundColor Cyan
Write-Host "  [V1-V5]  Core Compression & Encryption" -ForegroundColor White
Write-Host "  [V6]     GPU Acceleration" -ForegroundColor White
Write-Host "  [V7]     Autonomous Optimization" -ForegroundColor White
Write-Host "  [V8]     Edge/Mobile Support" -ForegroundColor White
Write-Host "  [V9]     Health Monitoring" -ForegroundColor White
Write-Host "  [V10]    Universal Interoperability" -ForegroundColor White
Write-Host "  [V12]    Global Mesh Network" -ForegroundColor White
Write-Host "  [V13]    Semantic Compression" -ForegroundColor White
Write-Host "  [V14]    Heterogeneous Hardware" -ForegroundColor White
Write-Host "  [V15]    Self-Transforming Containers" -ForegroundColor White
Write-Host "  [V16]    Long-Term Resilience" -ForegroundColor White
Write-Host "  [V17]    Scientific Data Modes" -ForegroundColor White
Write-Host "  [V18]    Realtime Streaming" -ForegroundColor White
Write-Host "  [V19]    Virtual Data Layer" -ForegroundColor White
Write-Host "  [V20]    Compute Sandbox" -ForegroundColor White
Write-Host "  [V21]    Policy Engine" -ForegroundColor White
Write-Host "  [MEDIA]  Media-Safe Compression" -ForegroundColor White
Write-Host ""

Write-Host "API Endpoints:" -ForegroundColor Cyan
Write-Host "  http://localhost:3000/health" -ForegroundColor White
Write-Host "  http://localhost:3000/version" -ForegroundColor White
Write-Host "  http://localhost:3000/api/*" -ForegroundColor White
Write-Host "  http://localhost:3000/compute/*" -ForegroundColor White
Write-Host "  http://localhost:3000/policy/*" -ForegroundColor White
Write-Host "  http://localhost:3000/media/*" -ForegroundColor White
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Server running - Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Launch server
cargo run --release --bin spk-server
