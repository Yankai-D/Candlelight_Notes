param()
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$release = Join-Path $root "output/releases/pangzhu-desktop-$version"
$payload = Join-Path $release 'payload'
$installer = Join-Path $release "installer/Candlelight-Notes-$version-Setup-x64.exe"
$zipPath = Join-Path $release "Candlelight-Notes-$version-Windows-x64.zip"
if (Test-Path -LiteralPath $zipPath) { throw 'Download archive already exists; refusing overwrite.' }
$files = @(
  @{ Path = $installer; Name = "Candlelight-Notes-$version-Setup-x64.exe" },
  @{ Path = "$installer.sha256"; Name = "Candlelight-Notes-$version-Setup-x64.exe.sha256" },
  @{ Path = (Join-Path $payload '使用说明.txt'); Name = '使用说明.txt' },
  @{ Path = (Join-Path $payload 'ACKNOWLEDGEMENTS.md'); Name = 'ACKNOWLEDGEMENTS.md' },
  @{ Path = (Join-Path $payload 'THIRD-PARTY-NOTICES.txt'); Name = 'THIRD-PARTY-NOTICES.txt' },
  @{ Path = (Join-Path $payload 'materials/ATTRIBUTION.txt'); Name = 'materials/ATTRIBUTION.txt' },
  @{ Path = (Join-Path $payload 'materials/SOURCES.json'); Name = 'materials/SOURCES.json' }
)
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file.Path -PathType Leaf)) { throw "Missing release file: $($file.Name)" }
  $file.Hash = (Get-FileHash -LiteralPath $file.Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.Path, $file.Name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
$zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if ($zip.Entries.Count -ne $files.Count) { throw 'Unexpected archive entry count.' }
  foreach ($file in $files) {
    $entry = $zip.GetEntry($file.Name)
    if ($null -eq $entry) { throw "Missing archive entry: $($file.Name)" }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($actual -ne $file.Hash) { throw "Archive checksum mismatch: $($file.Name)" }
  }
} finally { $zip.Dispose() }
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $([IO.Path]::GetFileName($zipPath))`n", [Text.UTF8Encoding]::new($false))
$report = [ordered]@{ status = 'pass'; archive = $zipPath; bytes = (Get-Item -LiteralPath $zipPath).Length; sha256 = $zipHash; verifiedEntries = @($files | ForEach-Object { [ordered]@{ name = $_.Name; sha256 = $_.Hash } }) }
$json = $report | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $root "artifacts/release-$version-archive.json"), "$json`n", [Text.UTF8Encoding]::new($false))
$json
