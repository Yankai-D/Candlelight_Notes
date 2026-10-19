param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceDirectory = (Resolve-Path -LiteralPath $Source).Path
$destinationFile = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationFile) { throw 'Refusing to overwrite an existing distribution archive.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($sourceDirectory, $destinationFile, [System.IO.Compression.CompressionLevel]::Optimal, $true, [System.Text.Encoding]::UTF8)
