$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path

function Get-AndroidSdkRoot {
  $candidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    (Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk')
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw '[notia] Android SDK not found. Define ANDROID_HOME or ANDROID_SDK_ROOT.'
}

function Get-AndroidNdkDir([string]$sdkRoot) {
  foreach ($candidate in @($env:ANDROID_NDK_HOME, $env:NDK_HOME)) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  $ndkRoot = Join-Path $sdkRoot 'ndk'
  if (-not (Test-Path $ndkRoot)) {
    throw '[notia] Android NDK not found. Install it from Android Studio or define NDK_HOME.'
  }

  $latest = Get-ChildItem $ndkRoot -Directory | Sort-Object Name | Select-Object -Last 1
  if (-not $latest) {
    throw '[notia] Android NDK not found. Install it from Android Studio or define NDK_HOME.'
  }

  return $latest.FullName
}

function Get-JavaHome {
  if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    return $env:JAVA_HOME
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jre'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jre')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'bin\java.exe'))) {
      return $candidate
    }
  }

  throw '[notia] No compatible JDK found for Android dev. Install JDK 17/21 or Android Studio and define JAVA_HOME.'
}

$sdkRoot = Get-AndroidSdkRoot
$ndkDir = Get-AndroidNdkDir $sdkRoot
$javaHome = Get-JavaHome
$toolchainBin = Join-Path $ndkDir 'toolchains\llvm\prebuilt\windows-x86_64\bin'

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:NDK_HOME = $ndkDir
$env:ANDROID_NDK_HOME = $ndkDir
$env:JAVA_HOME = $javaHome
$env:CARGO_BUILD_TARGET = 'aarch64-linux-android'
$env:CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER = $null
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER = $null
$env:CARGO_TARGET_I686_LINUX_ANDROID_LINKER = $null
$env:PATH = "$javaHome\bin;$sdkRoot\platform-tools;$sdkRoot\cmdline-tools\latest\bin;$toolchainBin;$env:PATH"

if (-not $env:TAURI_DEV_HOST) {
  $env:TAURI_DEV_HOST = '192.168.1.41'
}

Push-Location $projectRoot
try {
  & npx.cmd tauri android dev --open @args
} finally {
  Pop-Location
}
