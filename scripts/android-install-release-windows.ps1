$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$apkPath = Join-Path $projectRoot 'builds\android\notia-release.apk'

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'android-build-release-windows.ps1') @args

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
  throw '[notia] adb is required to install the Android APK.'
}

$devices = & $adb.Source devices | Select-Object -Skip 1 | ForEach-Object {
  $parts = $_ -split '\s+'
  if ($parts.Length -ge 2 -and $parts[1] -eq 'device') { $parts[0] }
} | Where-Object { $_ }

if (-not $devices -or $devices.Count -eq 0) {
  throw '[notia] No Android device detected. Connect a device with USB debugging enabled.'
}

if (-not (Test-Path $apkPath)) {
  throw "[notia] APK not found: $apkPath"
}

& $adb.Source -s $devices[0] install -r $apkPath
Write-Host "[notia] Installed APK on device from $apkPath"
