param(
  [ValidateSet('windows','android')][string]$Platform = 'windows'
)
# Compila whisper.cpp (submódulo fijado src-tauri/vendor/whisper.cpp) y el
# bridge C ABI de Notia. Windows incluye el backend Vulkan, que se carga solo
# si hay un driver Vulkan; Android incluye las variantes CPU arm64.
$ErrorActionPreference = 'Stop'
# PowerShell 5.1 convierte el stderr de un programa redirigido en errores;
# las advertencias de CMake no deben cortar la compilación: decide el código de salida.
function Invoke-Native([string]$File, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $File @Arguments 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previous }
}
$root =[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'src-tauri\vendor\whisper.cpp'
$wrapper = Join-Path $root 'src-tauri\resources\whisper\runtime'
$nativeBuildRoot = Join-Path ([IO.Path]::GetPathRoot($root)) 'notia-native-build'
$build = Join-Path $nativeBuildRoot "whisper-$Platform"
if (-not (Test-Path -LiteralPath (Join-Path $source 'CMakeLists.txt'))) {
  throw 'Inicialice whisper.cpp con git submodule update --init src-tauri/vendor/whisper.cpp.'
}
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) {
  $cmake = @('C:\Program Files\CMake\bin\cmake.exe', 'C:\Program Files (x86)\CMake\bin\cmake.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cmake) { throw 'CMake 3.22 o posterior es obligatorio para compilar whisper.cpp.' }
$arguments = @('-S', $wrapper, '-B', $build, "-DWHISPER_SOURCE=$($source.Replace('\','/'))", '-DCMAKE_BUILD_TYPE=Release')
if ($Platform -eq 'windows') {
  if (-not $env:VULKAN_SDK -or -not (Test-Path -LiteralPath $env:VULKAN_SDK)) {
    throw 'El Vulkan SDK es obligatorio para compilar el backend GPU (defina VULKAN_SDK).'
  }
  $arguments += @('-A', 'x64', '-DGGML_VULKAN=ON')
} else {
  if (-not $env:ANDROID_NDK_HOME) { throw 'ANDROID_NDK_HOME no esta definido.' }
  # El generador de Visual Studio no admite el toolchain del NDK: se usa el
  # Ninja que trae el CMake del Android SDK.
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $ninja = Get-ChildItem -LiteralPath (Join-Path $sdk 'cmake') -Recurse -Filter 'ninja.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $ninja) { throw 'No se encontro ninja.exe en el CMake del Android SDK.' }
  $toolchain = (Join-Path $env:ANDROID_NDK_HOME 'build\cmake\android.toolchain.cmake').Replace('\','/')
  $arguments += @(
    '-G', 'Ninja', "-DCMAKE_MAKE_PROGRAM=$($ninja.FullName.Replace('\','/'))",
    "-DCMAKE_TOOLCHAIN_FILE=$toolchain", '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-26',
    '-DGGML_CPU_ALL_VARIANTS=ON'
  )
}
$cache = Join-Path $build 'CMakeCache.txt'
if (Test-Path -LiteralPath $cache) {
  $resolvedBuild = [IO.Path]::GetFullPath($build)
  $resolvedNativeRoot = [IO.Path]::GetFullPath($nativeBuildRoot).TrimEnd('\') + '\'
  if (-not $resolvedBuild.StartsWith($resolvedNativeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'El directorio temporal de whisper.cpp quedó fuera de la raíz autorizada.'
  }
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
Invoke-Native $cmake $arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la configuración de whisper.cpp.' }
Invoke-Native $cmake @('--build', $build, '--config', 'Release', '--target', 'notia_whisper', '--parallel')
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de whisper.cpp.' }
$platformDirectory = if ($Platform -eq 'windows') { 'windows-x86_64' } else { 'android-arm64-v8a' }
$pattern = if ($Platform -eq 'windows') { '*.dll' } else { '*.so' }
$outputDirectory = Join-Path $wrapper $platformDirectory
if (Test-Path -LiteralPath $outputDirectory) {
  Get-ChildItem -LiteralPath $outputDirectory -File -Filter $pattern | Remove-Item -Force
}
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
# Las variantes armv9 (SVE/SME) no se empaquetan: el bridge no las carga,
# porque con vectores SVE de 128 bits no superan a NEON con i8mm.
$libraries = Get-ChildItem -LiteralPath $build -Recurse -File -Filter $pattern |
  Where-Object { $_.Name -match '^(lib)?notia_(whisper|stt_)' -and $_.Name -notmatch 'armv9' }
foreach ($library in $libraries) {
  Copy-Item -LiteralPath $library.FullName -Destination (Join-Path $outputDirectory $library.Name) -Force
}
$bridge = if ($Platform -eq 'windows') { 'notia_whisper.dll' } else { 'libnotia_whisper.so' }
if (-not (Test-Path -LiteralPath (Join-Path $outputDirectory $bridge))) {
  throw "No se encontro $bridge en la compilación."
}
if ($Platform -eq 'windows' -and -not (Test-Path -LiteralPath (Join-Path $outputDirectory 'notia_stt_ggml-vulkan.dll'))) {
  throw 'El runtime se compiló sin notia_stt_ggml-vulkan.dll.'
}
Write-Host "Runtime whisper.cpp instalado en $outputDirectory"
