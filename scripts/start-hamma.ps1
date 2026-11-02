param([int]$Port = 5014, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspace
try {
  $python = (Get-Command python -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }
  $built = Get-Item -LiteralPath 'web/dist/index.html' -ErrorAction SilentlyContinue
  $newest = Get-ChildItem -LiteralPath 'web/src' -File -Recurse | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $buildInputs = @($newest, (Get-Item 'package-lock.json'), (Get-Item 'web/vite.config.ts'), (Get-Item 'web/index.html'))
  if (-not $built -or ($buildInputs | Where-Object { $_.LastWriteTimeUtc -gt $built.LastWriteTimeUtc })) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'App build failed.' }
  }
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  } | Select-Object -ExpandProperty IPAddress -Unique | Sort-Object)
  New-Item -ItemType Directory -Force -Path '.hamma-data' | Out-Null
  $manifestPath = Join-Path $workspace '.hamma-data/launcher.json'
  $localUrl = "http://127.0.0.1:$Port"
  $running = $false
  try {
    $health = Invoke-RestMethod "$localUrl/api/process/capabilities" -TimeoutSec 2
    $running = $health.processing -eq 'local' -and $health.version -eq 1
  } catch {}
  if ($running) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Port $Port already runs another processor. Close it before starting HAMMA here." }
    $saved = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.processId)"
    if (-not $process -or $process.CommandLine -notmatch 'processor.server' -or $saved.workspace -ne $workspace -or $saved.port -ne $Port) {
      throw "Port $Port is occupied by another service."
    }
    if (($addresses -join ',') -ne (@($saved.addresses) -join ',')) {
      Stop-Process -Id $saved.processId
      $running = $false
    }
  }
  if (-not $running) {
    $serverArgs = @('-m', 'processor.server', '--port', "$Port", '--data', '.hamma-data/lan-test', '--web', 'web/dist')
    if ($addresses.Count) {
      $serverArgs += @('--lan', '--host', '0.0.0.0')
      foreach ($address in $addresses) { $serverArgs += @('--allow-host', $address) }
    }
    $server = Start-Process -FilePath $python -ArgumentList $serverArgs -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput '.hamma-data/server.out.log' -RedirectStandardError '.hamma-data/server.err.log'
    @{ processId = $server.Id; workspace = $workspace; port = $Port; addresses = $addresses } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      try { $health = Invoke-RestMethod "$localUrl/api/process/capabilities" -TimeoutSec 1; $ready = $health.processing -eq 'local'; if ($ready) { break } } catch {}
      Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'HAMMA did not start. See .hamma-data/server.err.log.' }
  }
  $links = @("This computer: $localUrl") + @($addresses | ForEach-Object { "Phone / LAN: http://${_}:$Port" })
  $links | Set-Content -LiteralPath (Join-Path $workspace '.hamma-data/connection-links.txt')
  $links | ForEach-Object { Write-Host $_ }
  if (-not $NoBrowser) { Start-Process $localUrl }
} catch {
  Write-Host "HAMMA could not start: $($_.Exception.Message)" -ForegroundColor Red
  if (-not $NoBrowser) { Read-Host 'Press Enter to close' }
  exit 1
}
