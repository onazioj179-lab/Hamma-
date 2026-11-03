param([ValidateRange(1024,65535)][int]$Port = 5014, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workspace = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
Set-Location -LiteralPath $workspace
$launchLock = $null
try {
  New-Item -ItemType Directory -Force -Path '.hamma-data' | Out-Null
  $lockPath = Join-Path $workspace '.hamma-data/launcher.lock'
  $lockDeadline = [DateTime]::UtcNow.AddSeconds(45)
  while (-not $launchLock) {
    try { $launchLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch [IO.IOException] {
      if ([DateTime]::UtcNow -ge $lockDeadline) { throw 'Another HAMMA launch is still building or starting. Try again when it finishes.' }
      Start-Sleep -Milliseconds 250
    }
  }
  $python = (Get-Command python -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }
  $built = Get-Item -LiteralPath 'web/dist/index.html' -ErrorAction SilentlyContinue
  $buildInputs = @(Get-ChildItem -LiteralPath 'web/src' -File -Recurse) + @(Get-ChildItem -LiteralPath 'web/public' -File -Recurse -ErrorAction SilentlyContinue) + @(Get-Item 'package-lock.json','web/package.json','web/vite.config.ts','web/index.html','web/tsconfig.json','web/tsconfig.node.json','web/tailwind.config.js','web/postcss.config.js' -ErrorAction SilentlyContinue)
  if (-not $built -or ($buildInputs | Where-Object { $_.LastWriteTimeUtc -gt $built.LastWriteTimeUtc })) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'App build failed.' }
  }
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  } | Select-Object -ExpandProperty IPAddress -Unique | Sort-Object)
  $revision = (@(Get-FileHash -Algorithm SHA256 -LiteralPath 'processor/server.py','processor/engine.py') | ForEach-Object { $_.Hash.ToLowerInvariant() }) -join ':'
  $manifestPath = Join-Path $workspace '.hamma-data/launcher.json'
  $localUrl = "http://127.0.0.1:$Port"
  $health = $null
  try { $health = Invoke-RestMethod "$localUrl/api/process/health" -TimeoutSec 2 } catch {}
  if ($health -and ($health.processing -ne 'local' -or $health.version -ne 1)) { throw "Port $Port belongs to an incompatible service." }
  if ($health) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Port $Port already runs another processor. Close it before starting HAMMA here." }
    $saved = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.processId)"
    $started = if ($process) { (Get-Process -Id $saved.processId).StartTime.ToUniversalTime().Ticks.ToString() } else { '' }
    if (-not $process -or $process.CommandLine -notmatch ' -m processor\.server ' -or $saved.workspace -ne $workspace -or $saved.port -ne $Port -or $health.pid -ne $saved.processId -or $saved.instance -ne $health.instance -or $saved.started -ne $started) {
      throw "Port $Port is occupied by a processor that this launcher cannot verify."
    }
    if (($addresses -join ',') -ne (@($saved.addresses) -join ',') -or $health.revision -ne $revision) {
      if ($health.activeJobs -gt 0) { throw 'Finish or cancel active jobs, then reopen HAMMA to apply processor or network changes.' }
      $prepared = Invoke-RestMethod "$localUrl/api/process/prepare-restart" -Method Post -Headers @{ 'X-Hamma-Request' = '1'; 'X-Hamma-Instance' = $health.instance } -TimeoutSec 3
      if (-not $prepared.ready -or $prepared.instance -ne $health.instance) { throw 'Processor restart preparation failed.' }
      Stop-Process -Id $saved.processId
      Wait-Process -Id $saved.processId -Timeout 10 -ErrorAction SilentlyContinue
      $health = $null
    }
  }
  if (-not $health) {
    # Detect older or unrelated listeners before writing a new ownership manifest.
    $occupied = $false
    try { $null = Invoke-WebRequest "$localUrl/" -UseBasicParsing -TimeoutSec 2; $occupied = $true } catch { if ($_.Exception.Response) { $occupied = $true } }
    if ($occupied) { throw "Port $Port is occupied. Close the previous HAMMA processor before restarting this launcher." }
    $serverArgs = @('-m', 'processor.server', '--port', "$Port", '--data', '.hamma-data/lan-test', '--web', 'web/dist')
    if ($addresses.Count) {
      $serverArgs += @('--lan', '--host', '0.0.0.0')
      foreach ($address in $addresses) { $serverArgs += @('--allow-host', $address) }
    }
    $server = Start-Process -FilePath $python -ArgumentList $serverArgs -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput '.hamma-data/server.out.log' -RedirectStandardError '.hamma-data/server.err.log'
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      try { $health = Invoke-RestMethod "$localUrl/api/process/health" -TimeoutSec 1; if ($health.revision -eq $revision -and $health.processing -eq 'local') { break }; $health = $null } catch {}
      if ($server.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    if (-not $health) { throw 'HAMMA did not start. See .hamma-data/server.err.log.' }
    $started = (Get-Process -Id $health.pid).StartTime.ToUniversalTime().Ticks.ToString()
    @{ processId = $health.pid; instance = $health.instance; started = $started; workspace = $workspace; port = $Port; addresses = $addresses; revision = $revision } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath
  }
  $links = @("This computer: $localUrl") + @($addresses | ForEach-Object { "Phone / LAN: http://${_}:$Port" })
  $links | Set-Content -LiteralPath (Join-Path $workspace '.hamma-data/connection-links.txt')
  $links | ForEach-Object { Write-Host $_ }
  if (Test-Path -LiteralPath '.hamma-data/launcher.err.log') { Remove-Item -LiteralPath '.hamma-data/launcher.err.log' }
  if (-not $NoBrowser) { Start-Process $localUrl }
} catch {
  $failure = "HAMMA could not start: $($_.Exception.Message)"
  $failure | Set-Content -LiteralPath (Join-Path $workspace '.hamma-data/launcher.err.log') -ErrorAction SilentlyContinue
  Write-Host $failure -ForegroundColor Red
  if (-not $NoBrowser) { Read-Host 'Press Enter to close' }
  exit 1
} finally {
  if ($launchLock) { $launchLock.Dispose() }
}
