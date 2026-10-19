param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$profileRoot = Join-Path $env:APPDATA 'PangzhuNotes'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) '烛光笔记 Candlelight.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) '烛光笔记 Candlelight.lnk'
$prior = @(Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -in @('烛光笔记', '烛光笔记 Candlelight', '旁烛笔记', '旁烛笔记 Candlelight', 'Candlelight Notes') })
$legacyLinks = @(foreach ($location in @('Desktop', 'Programs')) { foreach ($name in @('旁烛笔记.lnk', '旁烛笔记 Candlelight.lnk')) { Join-Path ([Environment]::GetFolderPath($location)) $name } })
if (@($legacyLinks | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or $prior.Count -gt 0 -or (Test-Path -LiteralPath $profileRoot) -or (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $startLink)) {
    throw 'Installer verification requires no existing Pangzhu installation, shortcuts or default user data. Existing user state was left untouched.'
}
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$scratch = Join-Path $temporaryRoot ('pangzhu-install-' + [Guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $scratch '烛光 安装验收'
$marker = Join-Path $profileRoot 'installer-verification.txt'
$markerText = [Guid]::NewGuid().ToString('N')
$checks = [Collections.Generic.List[string]]::new()
$installed = $false
New-Item -ItemType Directory -Path $scratch,$profileRoot | Out-Null
Set-Content -LiteralPath $marker -Value $markerText -Encoding UTF8
function Invoke-Installer {
    $process = Start-Process -FilePath $installerPath -ArgumentList "/S /D=$installDirectory" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
function Invoke-Uninstaller {
    $uninstallers = @(Get-ChildItem -LiteralPath $installDirectory -File -Filter '*Uninstall*.exe' -ErrorAction SilentlyContinue)
    if ($uninstallers.Count -ne 1) { throw 'Expected exactly one generated uninstaller' }
    $process = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList "/S _?=$installDirectory" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
}
try {
    Invoke-Installer
    $installed = $true
    $application = Join-Path $installDirectory 'PangzhuNotes.exe'
    if (-not (Test-Path -LiteralPath $application)) { throw 'Application executable missing after install' }
    $shortcuts = New-Object -ComObject WScript.Shell
    foreach ($shortcut in @($desktopLink,$startLink)) {
        if (-not (Test-Path -LiteralPath $shortcut)) { throw "Missing shortcut: $shortcut" }
        if ($shortcuts.CreateShortcut($shortcut).TargetPath -ne $application) { throw 'Shortcut does not point to installed application' }
    }
    $checks.Add('Silent per-user installation succeeds in a Unicode/spaced directory; desktop and start-menu shortcuts target the installed executable')
    & node (Join-Path $workspace 'scripts/test-desktop.mjs') $application
    if ($LASTEXITCODE -ne 0) { throw 'Installed desktop application failed functional verification' }
    $checks.Add('Installed binary passes native reading, PDF export, single-instance and close/restart verification')
    $credentialFile = Join-Path $profileRoot '.env'
    Set-Content -LiteralPath $credentialFile -Value 'DEEPSEEK_API_KEY=INSTALLER_TEST_ONLY' -Encoding UTF8
    $retainedLibrary = Join-Path $scratch 'retained-user-library'
    New-Item -ItemType Directory -Path $retainedLibrary | Out-Null
    Set-Content -LiteralPath (Join-Path $retainedLibrary 'note.json') -Value '{"test":"retained note"}' -Encoding UTF8
    Invoke-Installer
    if (-not (Test-Path -LiteralPath $application)) { throw 'Application missing after reinstall' }
    if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $markerText) { throw 'Reinstall modified user data' }
    if (-not (Test-Path -LiteralPath $credentialFile)) { throw 'Upgrade incorrectly cleared credentials' }
    $checks.Add('Reinstall preserves separate user data')
    Invoke-Uninstaller
    $installed = $false
    if (Test-Path -LiteralPath $application) { throw 'Uninstall left the application executable' }
    if ((Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $startLink)) { throw 'Uninstall left application shortcuts' }
    if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $markerText) { throw 'Uninstall deleted user data' }
    if (Test-Path -LiteralPath $credentialFile) { throw 'Uninstall left saved credentials' }
    if (-not (Test-Path -LiteralPath (Join-Path $retainedLibrary 'note.json'))) { throw 'Uninstall removed user note file' }
    $checks.Add('Uninstall removes application, shortcuts and Key while retaining external notes and lightweight records')
    $report = @{ status='pass'; checkedAt=[DateTime]::UtcNow.ToString('o'); installer=[IO.Path]::GetFileName($installerPath); sha256=(Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant(); modelCalls=0; checks=@($checks) }
    $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workspace 'artifacts/desktop/installer-report.json') -Encoding UTF8
    Write-Output 'PASS: installation, native application, reinstall, shortcuts, uninstall and data retention'
} finally {
    if ($installed) { Invoke-Uninstaller }
    # Only remove this run's known temporary paths. Never recursively remove user data.
    if (([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($scratch)) -ne $temporaryRoot) -or -not ([IO.Path]::GetFileName($scratch).StartsWith('pangzhu-install-'))) { throw 'Unsafe cleanup target' }
    Remove-Item -LiteralPath $scratch -Recurse -Force
    if (Test-Path -LiteralPath $marker) {
        if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $markerText) { throw 'Unexpected data marker; preserved' }
        Remove-Item -LiteralPath $marker
    }
    if ((Test-Path -LiteralPath $profileRoot) -and @(Get-ChildItem -LiteralPath $profileRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $profileRoot }
}
