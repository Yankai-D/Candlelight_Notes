param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
& (Join-Path $Directory 'Start.cmd') --no-browser
exit $LASTEXITCODE
