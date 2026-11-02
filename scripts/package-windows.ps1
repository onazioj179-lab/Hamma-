param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
$profileArgs = @('--release')
$profileName = 'release'
if ($DebugBuild) { $profileArgs = @(); $profileName = 'debug' }
cargo build --locked -p spk-backend --bin spk-server @profileArgs
if ($LASTEXITCODE -ne 0) { throw 'Native Rust build failed' }
$bundle = Join-Path $PWD 'dist/HAMMA-Windows'
New-Item -ItemType Directory -Force -Path $bundle | Out-Null
Copy-Item -LiteralPath "target/$profileName/spk-server.exe" -Destination (Join-Path $bundle 'HAMMA.exe') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $bundle 'web') | Out-Null
Copy-Item -Path 'web/dist/*' -Destination (Join-Path $bundle 'web') -Recurse -Force
@'
@echo off
cd /d "%~dp0"
set SPK_BIND_HOST=127.0.0.1
set PORT=3000
start "HAMMA" HAMMA.exe
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3000
'@ | Set-Content -LiteralPath (Join-Path $bundle 'Start HAMMA.cmd') -Encoding ascii
@'
HAMMA — Created by Onazi Treasure Oj
Run Start HAMMA.cmd, or run HAMMA.exe and open http://127.0.0.1:3000.
Keep the web folder beside HAMMA.exe. No Python runtime is required.
This is a portable Rust server + browser UI, not a native desktop installer.
Account and server file storage are temporary and do not survive restart.
'@ | Set-Content -LiteralPath (Join-Path $bundle 'README.txt') -Encoding utf8
Compress-Archive -Path "$bundle/*" -DestinationPath 'dist/HAMMA-Windows.zip' -Force
Write-Output 'Created dist/HAMMA-Windows.zip'
