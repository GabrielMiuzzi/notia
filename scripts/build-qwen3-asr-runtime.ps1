param(
  [ValidateSet('windows-x86_64', 'android-arm64-v8a')]
  [string]$Platform = 'windows-x86_64',
  [ValidateSet('cpu', 'gpu')]
  [string]$Device = 'cpu'
)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $root 'src-tauri\resources\qwen3-asr\runtime'
$nativeBuildRoot = Join-Path ([IO.Path]::GetPathRoot($root)) 'notia-native-build'
$build = Join-Path $nativeBuildRoot "qwen3-asr-$Platform-$Device"
$destination = Join-Path $source $Platform

$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) {
  $cmake = @('C:\Program Files\CMake\bin\cmake.exe', 'C:\Program Files (x86)\CMake\bin\cmake.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cmake) { throw 'CMake 3.22 o posterior es obligatorio.' }
if (-not (Test-Path (Join-Path $root 'src-tauri\vendor\llama.cpp\CMakeLists.txt'))) {
  throw 'Inicialice llama.cpp con git submodule update --init --recursive.'
}

$arguments = @('-S', $source, '-B', $build, '-DGGML_NATIVE=OFF')
if ($Platform -eq 'windows-x86_64') {
  # No dependemos de una Developer Command Prompt: CMake localiza MSVC y
  # MSBuild directamente mediante el generador de Visual Studio.
  $arguments += @('-G', 'Visual Studio 17 2022', '-A', 'x64')
}
if ($Device -eq 'gpu' -and $Platform -eq 'windows-x86_64') { $arguments += '-DGGML_VULKAN=ON' }
if ($Platform -eq 'android-arm64-v8a') {
  if (-not $env:ANDROID_NDK_HOME) { throw 'ANDROID_NDK_HOME es obligatorio para Android.' }
  $toolchain = (Join-Path $env:ANDROID_NDK_HOME 'build\cmake\android.toolchain.cmake').Replace('\', '/')
  $arguments += @("-DCMAKE_TOOLCHAIN_FILE=$toolchain", '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-31')
}

& $cmake @arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la configuración de Qwen3-ASR.' }
& $cmake --build $build --config Release --target notia_qwen3_asr --parallel
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de Qwen3-ASR.' }

if ($Device -eq 'gpu' -and $Platform -eq 'windows-x86_64') {
  $vulkanRuntime = Get-ChildItem -LiteralPath $build -Recurse -Filter 'notia_asr_ggml-vulkan.dll' |
    Select-Object -First 1
  if (-not $vulkanRuntime) {
    throw 'El runtime GPU se compiló sin el backend Vulkan notia_asr_ggml-vulkan.dll.'
  }
}

New-Item -ItemType Directory -Force -Path $destination | Out-Null
$extensions = if ($Platform -eq 'windows-x86_64') { @('*.dll') } else { @('*.so') }
foreach ($extension in $extensions) {
  Get-ChildItem -Path $build -Filter $extension -Recurse | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) -Force
  }
}
Write-Host "Runtime Qwen3-ASR instalado en $destination"
