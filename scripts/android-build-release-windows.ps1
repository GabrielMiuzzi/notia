$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$artifactDir = Join-Path $projectRoot 'builds\android'
$signingFile = Join-Path $projectRoot 'android-signing.properties'
$defaultStoreRelative = '.secrets\android\notia-upload.jks'

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

  throw '[notia] No compatible JDK found for Android builds. Install JDK 17/21 or Android Studio and define JAVA_HOME.'
}

function Read-SigningProperties([string]$filePath) {
  $map = @{}
  if (-not (Test-Path $filePath)) {
    return $map
  }

  foreach ($line in Get-Content $filePath) {
    if ($line -match '^\s*([^=]+)=(.*)$') {
      $map[$matches[1].Trim()] = $matches[2].Trim()
    }
  }

  return $map
}

function Ensure-SigningConfig {
  $props = Read-SigningProperties $signingFile
  $storeFile = if ($env:NOTIA_ANDROID_KEYSTORE_PATH) { $env:NOTIA_ANDROID_KEYSTORE_PATH } else { $props['storeFile'] }
  $storePassword = if ($env:NOTIA_ANDROID_KEYSTORE_PASSWORD) { $env:NOTIA_ANDROID_KEYSTORE_PASSWORD } else { $props['storePassword'] }
  $keyAlias = if ($env:NOTIA_ANDROID_KEY_ALIAS) { $env:NOTIA_ANDROID_KEY_ALIAS } else { $props['keyAlias'] }
  $keyPassword = if ($env:NOTIA_ANDROID_KEY_PASSWORD) { $env:NOTIA_ANDROID_KEY_PASSWORD } else { $props['keyPassword'] }

  if ($storeFile -and $storePassword -and $keyAlias -and $keyPassword) {
    return @{
      storeFile = $storeFile
      storePassword = $storePassword
      keyAlias = $keyAlias
      keyPassword = $keyPassword
    }
  }

  $storeFile = $defaultStoreRelative
  $storePassword = 'notia-dev-password'
  $keyAlias = 'notia'
  $keyPassword = $storePassword

  $absoluteStore = Join-Path $projectRoot $storeFile
  $storeDir = Split-Path -Parent $absoluteStore
  if (-not (Test-Path $storeDir)) {
    New-Item -ItemType Directory -Path $storeDir -Force | Out-Null
  }

  if (-not (Test-Path $absoluteStore)) {
    $keytool = Get-Command keytool -ErrorAction SilentlyContinue
    if (-not $keytool) {
      throw '[notia] keytool is required to generate the Android signing keystore.'
    }

    & $keytool.Source -genkeypair `
      -keystore $absoluteStore `
      -storepass $storePassword `
      -alias $keyAlias `
      -keypass $keyPassword `
      -keyalg RSA `
      -keysize 2048 `
      -validity 10000 `
      -dname 'CN=Notia, OU=Development, O=Notia, L=Local, S=Local, C=AR' `
      -noprompt | Out-Null
  }

  @(
    "storeFile=$storeFile"
    "storePassword=$storePassword"
    "keyAlias=$keyAlias"
    "keyPassword=$keyPassword"
  ) | Set-Content -Path $signingFile

  Write-Host "[notia] Generated local Android signing config at $signingFile"

  return @{
    storeFile = $storeFile
    storePassword = $storePassword
    keyAlias = $keyAlias
    keyPassword = $keyPassword
  }
}

function Ensure-AndroidProjectInitialized {
  $androidProjectDir = Join-Path $projectRoot 'src-tauri\gen\android'
  if (Test-Path $androidProjectDir) {
    return
  }

  Write-Host '[notia] Android project not initialized. Running `npx tauri android init`...'
  Push-Location $projectRoot
  try {
    & npx.cmd tauri android init
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $androidProjectDir)) {
    throw '[notia] Android Studio project directory was not generated.'
  }
}

function Repair-TauriAndroidBuildTask {
  $buildTaskPath = Join-Path $projectRoot 'src-tauri\gen\android\buildSrc\src\main\java\com\gabriel\notia\kotlin\BuildTask.kt'
  if (-not (Test-Path $buildTaskPath)) {
    return
  }

  $content = Get-Content $buildTaskPath -Raw
  $updated = $content -replace 'val executable = """npm""";[\s\S]*?runTauriCli\(executable\)\s*\n\s*\}', @'
        val executable = if (Os.isFamily(Os.FAMILY_WINDOWS)) "npm.cmd" else "npm"
        runTauriCli(executable)
    }
'@

  if ($updated -ne $content) {
    Set-Content -Path $buildTaskPath -Value $updated
  }
}

function Repair-AndroidReleaseBuildType {
  $gradlePath = Join-Path $projectRoot 'src-tauri\gen\android\app\build.gradle.kts'
  if (-not (Test-Path $gradlePath)) {
    return
  }

  $content = Get-Content $gradlePath -Raw
  $updated = $content -replace 'getByName\("release"\)\s*\{\s*isMinifyEnabled = true', 'getByName("release") {
            isMinifyEnabled = false'

  if ($updated -ne $content) {
    Set-Content -Path $gradlePath -Value $updated
  }
}

function Repair-RustPluginArm64Only {
  $rustPluginPath = Join-Path $projectRoot 'src-tauri\gen\android\buildSrc\src\main\java\com\gabriel\notia\kotlin\RustPlugin.kt'
  if (-not (Test-Path $rustPluginPath)) {
    return
  }

  $content = Get-Content $rustPluginPath -Raw
  $updated = $content `
    -replace 'val defaultAbiList = listOf\("arm64-v8a", "armeabi-v7a", "x86", "x86_64"\);', 'val defaultAbiList = listOf("arm64-v8a");' `
    -replace 'val defaultArchList = listOf\("arm64", "arm", "x86", "x86_64"\);', 'val defaultArchList = listOf("arm64");' `
    -replace 'val targetsList = \(findProperty\("targetList"\) as\? String\)\?\.split\('',''\) \?: listOf\("aarch64", "armv7", "i686", "x86_64"\)', 'val targetsList = (findProperty("targetList") as? String)?.split('','') ?: listOf("aarch64")'

  if ($updated -ne $content) {
    Set-Content -Path $rustPluginPath -Value $updated
  }
}

function Repair-AndroidGradleAbiFilters {
  $gradlePath = Join-Path $projectRoot 'src-tauri\gen\android\app\build.gradle.kts'
  if (-not (Test-Path $gradlePath)) {
    return
  }

  $content = Get-Content $gradlePath -Raw
  if ($content -notmatch 'abiFilters \+= listOf\("arm64-v8a"\)') {
    $content = $content -replace 'versionName = tauriProperties\.getProperty\("tauri\.android\.versionName", "1\.0"\)', "versionName = tauriProperties.getProperty(`"tauri.android.versionName`", `"1.0`")`r`n        ndk {`r`n            abiFilters += listOf(`"arm64-v8a`")`r`n        }"
  }
  $content = $content -replace 'jniLibs\.keepDebugSymbols\.add\("\*/arm64-v8a/\*\.so"\)\s*jniLibs\.keepDebugSymbols\.add\("\*/armeabi-v7a/\*\.so"\)\s*jniLibs\.keepDebugSymbols\.add\("\*/x86/\*\.so"\)\s*jniLibs\.keepDebugSymbols\.add\("\*/x86_64/\*\.so"\)', 'jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")'

  Set-Content -Path $gradlePath -Value $content
}

function Get-AbsoluteStoreFilePath([string]$storeFile) {
  if ([System.IO.Path]::IsPathRooted($storeFile)) {
    return $storeFile
  }

  return Join-Path $projectRoot $storeFile
}

function Get-LatestBuildToolsDir([string]$sdkRoot) {
  $buildToolsRoot = Join-Path $sdkRoot 'build-tools'
  if (-not (Test-Path $buildToolsRoot)) {
    throw '[notia] Android build-tools not found. Install Android SDK Build-Tools from Android Studio.'
  }

  $latest = Get-ChildItem $buildToolsRoot -Directory | Sort-Object Name | Select-Object -Last 1
  if (-not $latest) {
    throw '[notia] Android build-tools not found. Install Android SDK Build-Tools from Android Studio.'
  }

  return $latest.FullName
}

function Sign-UnsignedApk([string]$unsignedApkPath) {
  $buildToolsDir = Get-LatestBuildToolsDir $sdkRoot
  $zipalign = Join-Path $buildToolsDir 'zipalign.exe'
  $apksigner = Join-Path $buildToolsDir 'apksigner.bat'
  if (-not (Test-Path $apksigner)) {
    $apksigner = Join-Path $buildToolsDir 'apksigner'
  }

  if (-not (Test-Path $zipalign) -or -not (Test-Path $apksigner)) {
    throw "[notia] zipalign/apksigner not found in $buildToolsDir."
  }

  $alignedApk = Join-Path $artifactDir 'notia-release-aligned.apk'
  $signedApk = Join-Path $artifactDir 'notia-release-signed.apk'
  $storeFile = Get-AbsoluteStoreFilePath $signing.storeFile

  & $zipalign -f -p 4 $unsignedApkPath $alignedApk
  if ($LASTEXITCODE -ne 0) {
    throw "[notia] zipalign failed with exit code $LASTEXITCODE."
  }

  & $apksigner sign `
    --ks $storeFile `
    --ks-pass "pass:$($signing.storePassword)" `
    --ks-key-alias $signing.keyAlias `
    --key-pass "pass:$($signing.keyPassword)" `
    --out $signedApk `
    $alignedApk
  if ($LASTEXITCODE -ne 0) {
    throw "[notia] apksigner failed with exit code $LASTEXITCODE."
  }

  & $apksigner verify -v $signedApk | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "[notia] apksigner verify failed with exit code $LASTEXITCODE."
  }

  return $signedApk
}

function Copy-ReadyArtifact([string]$format) {
  if (-not (Test-Path $artifactDir)) {
    New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
  }

  $outputsRoot = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs'
  if (-not (Test-Path $outputsRoot)) {
    throw '[notia] Android artifact not found after build.'
  }

  if ($format -eq 'aab') {
    $aab = Get-ChildItem $outputsRoot -Recurse -Filter *.aab | Sort-Object FullName | Select-Object -Last 1
    if (-not $aab) {
      throw '[notia] AAB artifact not found after build.'
    }
    $target = Join-Path $artifactDir 'notia-release.aab'
    Copy-Item $aab.FullName $target -Force
    Write-Host "[notia] AAB ready: $target"
    return
  }

  $signedApk = Get-ChildItem $outputsRoot -Recurse -Filter *.apk |
    Where-Object { $_.Name -notlike '*-unsigned.apk' } |
    Sort-Object FullName |
    Select-Object -Last 1
  $apk = if ($signedApk) {
    $signedApk
  } else {
    Get-ChildItem $outputsRoot -Recurse -Filter *-unsigned.apk | Sort-Object FullName | Select-Object -Last 1
  }

  if (-not $apk) {
    throw '[notia] APK artifact not found after build.'
  }

  $sourceApk = if ($apk.Name -like '*-unsigned.apk') {
    Sign-UnsignedApk $apk.FullName
  } else {
    $apk.FullName
  }

  $target = Join-Path $artifactDir 'notia-release.apk'
  Copy-Item $sourceApk $target -Force
  Write-Host "[notia] APK ready: $target"
}

$sdkRoot = Get-AndroidSdkRoot
$ndkDir = Get-AndroidNdkDir $sdkRoot
$javaHome = Get-JavaHome
$signing = Ensure-SigningConfig

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:NDK_HOME = $ndkDir
$env:ANDROID_NDK_HOME = $ndkDir
$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;$sdkRoot\platform-tools;$sdkRoot\cmdline-tools\latest\bin;$ndkDir\toolchains\llvm\prebuilt\windows-x86_64\bin;$env:PATH"

$toolchainBin = Join-Path $ndkDir 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = Join-Path $toolchainBin 'aarch64-linux-android26-clang.cmd'
if (-not (Test-Path $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER)) {
  $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = Join-Path $toolchainBin 'aarch64-linux-android26-clang'
}
$env:CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER = $null
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER = $null
$env:CARGO_TARGET_I686_LINUX_ANDROID_LINKER = $null

Ensure-AndroidProjectInitialized
Repair-TauriAndroidBuildTask
Repair-AndroidReleaseBuildType
Repair-RustPluginArm64Only
Repair-AndroidGradleAbiFilters

$format = 'apk'
$extraArgs = @()
foreach ($arg in $args) {
  if ($arg -eq '--aab') {
    $format = 'aab'
    continue
  }
  if ($arg -eq '--apk') {
    $format = 'apk'
    continue
  }
  $extraArgs += $arg
}

Push-Location $projectRoot
try {
  & npx.cmd tauri android build "--$format" --target aarch64 @extraArgs
  if ($LASTEXITCODE -ne 0) {
    throw "[notia] Tauri Android build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Copy-ReadyArtifact $format
