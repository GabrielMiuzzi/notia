param([ValidateSet('windows','android')][string]$Platform = 'windows')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'src-tauri\vendor\qwen3-tts.cpp'
$wrapper = Join-Path $root 'src-tauri\resources\qwen3-tts\runtime'
$build = Join-Path $root "src-tauri\target\qwen3-tts-$Platform"
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { throw 'CMake 3.22 o posterior es obligatorio para compilar qwen3-tts.cpp.' }
$buildSource = $source
if ($Platform -eq 'android') {
  if (-not $env:ANDROID_NDK_HOME) { throw 'ANDROID_NDK_HOME no esta definido.' }
  # Upstream enables -march=native for every Clang build. That flag targets the
  # host and is invalid while cross-compiling arm64. Patch an isolated target
  # copy so the pinned submodule remains untouched and reproducible.
  $buildSource = Join-Path $root 'src-tauri\target\qwen3-tts-android-source'
  if (-not (Test-Path -LiteralPath $buildSource)) {
    Copy-Item -LiteralPath $source -Destination $buildSource -Recurse
    $upstreamCmake = Join-Path $buildSource 'CMakeLists.txt'
    $cmakeText = [IO.File]::ReadAllText($upstreamCmake).Replace(' -march=native', '')
    [IO.File]::WriteAllText($upstreamCmake, $cmakeText, [Text.UTF8Encoding]::new($false))
  }
}
$arguments = @('-S', $wrapper, '-B', $build, "-DQWEN3_TTS_SOURCE=$($buildSource.Replace('\','/'))", '-DCMAKE_BUILD_TYPE=Release')
if ($Platform -eq 'android') {
  $arguments += @("-DCMAKE_TOOLCHAIN_FILE=$($env:ANDROID_NDK_HOME.Replace('\','/'))/build/cmake/android.toolchain.cmake", '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-31')
}
& cmake @arguments
& cmake --build $build --config Release --parallel
$extension = if ($Platform -eq 'windows') { 'dll' } else { 'so' }
$platformDirectory = if ($Platform -eq 'windows') { 'windows-x86_64' } else { 'android-arm64-v8a' }
$outputDirectory = Join-Path $wrapper $platformDirectory
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$library = Get-ChildItem -LiteralPath $build -Recurse -File | Where-Object { $_.Name -eq "qwen3_tts_runtime.$extension" -or $_.Name -eq "libqwen3_tts_runtime.$extension" } | Select-Object -First 1
if (-not $library) { throw 'No se encontro la biblioteca compilada de Qwen3-TTS.' }
Copy-Item -LiteralPath $library.FullName -Destination (Join-Path $outputDirectory $library.Name) -Force
if ($Platform -eq 'windows') {
  Get-ChildItem -LiteralPath $build -Recurse -File -Filter 'ggml*.dll' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $outputDirectory $_.Name) -Force
  }
} else {
  Get-ChildItem -LiteralPath $build -Recurse -File -Filter 'libggml*.so' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $outputDirectory $_.Name) -Force
  }
}
