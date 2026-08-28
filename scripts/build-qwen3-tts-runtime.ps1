param(
  [ValidateSet('windows','android')][string]$Platform = 'windows',
  [ValidateSet('cpu','gpu')][string]$Device = 'cpu'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'src-tauri\vendor\qwen3-tts.cpp'
$wrapper = Join-Path $root 'src-tauri\resources\qwen3-tts\runtime'
$nativeBuildRoot = Join-Path ([IO.Path]::GetPathRoot($root)) 'notia-native-build'
$build = Join-Path $nativeBuildRoot "qwen3-tts-$Platform-$Device"
if ($Platform -eq 'android' -and $Device -eq 'gpu') {
  throw 'El runtime Qwen3-TTS GPU está integrado mediante CUDA y solo está disponible en Windows.'
}
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) {
  $cmake = @('C:\Program Files\CMake\bin\cmake.exe', 'C:\Program Files (x86)\CMake\bin\cmake.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cmake) { throw 'CMake 3.22 o posterior es obligatorio para compilar qwen3-tts.cpp.' }
$buildSource = $source
if ($Platform -eq 'windows' -and $Device -eq 'gpu') {
  $buildSource = Join-Path $root 'src-tauri\target\qwen3-tts-windows-gpu-source'
  $resolvedSourceCopy = [IO.Path]::GetFullPath($buildSource)
  $resolvedTargetRoot = [IO.Path]::GetFullPath((Join-Path $root 'src-tauri\target')).TrimEnd('\') + '\'
  if (-not $resolvedSourceCopy.StartsWith($resolvedTargetRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La copia temporal de Qwen3-TTS quedó fuera de src-tauri/target.'
  }
  if (Test-Path -LiteralPath $resolvedSourceCopy) {
    Remove-Item -LiteralPath $resolvedSourceCopy -Recurse -Force
  }
  Copy-Item -LiteralPath $source -Destination $resolvedSourceCopy -Recurse
  $cudaPatch = Join-Path $wrapper 'patches\cuda-direct-backend.patch'
  & git -C $resolvedSourceCopy apply --whitespace=nowarn $cudaPatch
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar el registro directo del backend CUDA de Qwen3-TTS.' }
}
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
if ($Platform -eq 'windows' -and $Device -eq 'gpu') {
  $cudaRoot = [Environment]::GetEnvironmentVariable('CUDA_PATH', 'Machine')
  if (-not $cudaRoot -or -not (Test-Path -LiteralPath (Join-Path $cudaRoot 'bin\nvcc.exe'))) {
    throw 'CUDA Toolkit es obligatorio para compilar Qwen3-TTS con GPU.'
  }
  $env:CUDA_PATH = $cudaRoot
  $env:CUDA_PATH_V13_3 = $cudaRoot
  $env:Path = (Join-Path $cudaRoot 'bin') + ';' + $env:Path
  $arguments += @(
    '-G', 'Visual Studio 17 2022', '-A', 'x64',
    '-DQWEN3_TTS_CUDA=ON',
    "-DCMAKE_CUDA_COMPILER=$((Join-Path $cudaRoot 'bin\nvcc.exe').Replace('\','/'))"
  )
}
if ($Platform -eq 'android') {
  $arguments += @("-DCMAKE_TOOLCHAIN_FILE=$($env:ANDROID_NDK_HOME.Replace('\','/'))/build/cmake/android.toolchain.cmake", '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-31')
}
$cache = Join-Path $build 'CMakeCache.txt'
if (Test-Path -LiteralPath $cache) {
  $resolvedBuild = [IO.Path]::GetFullPath($build)
  $resolvedNativeRoot = [IO.Path]::GetFullPath($nativeBuildRoot).TrimEnd('\') + '\'
  if (-not $resolvedBuild.StartsWith($resolvedNativeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'El directorio temporal de Qwen3-TTS quedó fuera de la raíz autorizada.'
  }
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
& $cmake @arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la configuración de Qwen3-TTS.' }
& $cmake --build $build --config Release --parallel
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de Qwen3-TTS.' }
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
  if ($Device -eq 'gpu' -and -not (Test-Path -LiteralPath (Join-Path $outputDirectory 'ggml-cuda.dll'))) {
    throw 'El runtime Qwen3-TTS GPU se compiló sin ggml-cuda.dll.'
  }
} else {
  Get-ChildItem -LiteralPath $build -Recurse -File -Filter 'libggml*.so' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $outputDirectory $_.Name) -Force
  }
}
