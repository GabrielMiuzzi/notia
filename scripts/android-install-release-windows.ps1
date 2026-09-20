$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$apkPath = Join-Path $projectRoot 'builds\android\notia-release.apk'

function Get-AdbPath {
  $command = Get-Command adb -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    (Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk')
  ) | Where-Object { $_ }

  foreach ($sdkRoot in $sdkCandidates) {
    $candidate = Join-Path $sdkRoot 'platform-tools\adb.exe'
    if (Test-Path $candidate) { return $candidate }
  }

  return $null
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'android-build-release-windows.ps1') @args

$adbPath = Get-AdbPath
if (-not $adbPath) {
  throw '[notia] adb is required to install the Android APK.'
}

$devices = @(& $adbPath devices | Select-Object -Skip 1 | ForEach-Object {
  $parts = $_ -split '\s+'
  if ($parts.Length -ge 2 -and $parts[1] -eq 'device') { $parts[0] }
} | Where-Object { $_ })

if (-not $devices -or $devices.Count -eq 0) {
  throw '[notia] No Android device detected. Connect a device with USB debugging enabled.'
}

if (-not (Test-Path $apkPath)) {
  throw "[notia] APK not found: $apkPath"
}

$device = if ($env:ANDROID_SERIAL -and $devices -contains $env:ANDROID_SERIAL) {
  $env:ANDROID_SERIAL
} else {
  $devices[0]
}

Write-Host "[notia] Installing on $device using $adbPath"
& $adbPath -s $device install -r $apkPath
if ($LASTEXITCODE -ne 0) {
  throw "[notia] adb install failed with exit code $LASTEXITCODE."
}
Write-Host "[notia] Installed APK on device from $apkPath"
