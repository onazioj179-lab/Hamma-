param([ValidateRange(1,16)][int]$Jobs = 2, [string]$Generator = 'Ninja')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$cacheDirectory = Join-Path $PWD '.hamma-data/shante-deps'
$archivePath = Join-Path $cacheDirectory 'zstd-1.5.7.tar.gz'
New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -Uri 'https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-1.5.7.tar.gz' -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne 'EB33E51F49A15E023950CD7825CA74A4A2B43DB8354825AC24FC1B7EE09E6FA3') {
    throw 'Zstandard archive checksum mismatch; refusing to build'
}
python native/bootstrap.py $archivePath
if ($LASTEXITCODE -ne 0) { throw 'Verified dependency extraction failed' }
$sourceDirectory = Join-Path $cacheDirectory 'zstd-1.5.7'
$configureArguments = @('-S', 'native', '-B', 'native/build', '-G', $Generator, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=ON', "-DFETCHCONTENT_SOURCE_DIR_ZSTD=$sourceDirectory")
if ($Generator -like 'Visual Studio*') { $configureArguments += @('-A', 'x64') }
cmake @configureArguments
if ($LASTEXITCODE -ne 0) { throw 'Native configuration failed' }
cmake --build native/build --config Release -j $Jobs
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
ctest --test-dir native/build -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'Native tests failed' }
