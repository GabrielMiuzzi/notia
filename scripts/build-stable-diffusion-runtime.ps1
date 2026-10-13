# Compila sd-cli de stable-diffusion.cpp (submódulo fijado
# src-tauri/vendor/stable-diffusion.cpp) con el backend Vulkan para generar y
# editar imágenes con Qwen-Image 2.1 Turbo. Notia lo ejecuta como un proceso
# aparte, así su ggml no convive con los de Whisper y Qwen3-TTS. Solo Windows:
# en Android las imágenes se generan en el host.
$ErrorActionPreference = 'Stop'
# PowerShell 5.1 convierte el stderr de un programa redirigido en errores;
# las advertencias de CMake no deben cortar la compilación: decide el código de salida.
function Invoke-Native([string]$File, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $File @Arguments 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previous }
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'src-tauri\vendor\stable-diffusion.cpp'
$nativeBuildRoot = Join-Path ([IO.Path]::GetPathRoot($root)) 'notia-native-build'
$build = Join-Path $nativeBuildRoot 'stable-diffusion-windows'
$outputDirectory = Join-Path $root 'src-tauri\resources\stable-diffusion\runtime\windows-x86_64'
if (-not (Test-Path -LiteralPath (Join-Path $source 'ggml\CMakeLists.txt'))) {
  throw 'Inicialice stable-diffusion.cpp con git submodule update --init --recursive src-tauri/vendor/stable-diffusion.cpp.'
}
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) {
  $cmake = @('C:\Program Files\CMake\bin\cmake.exe', 'C:\Program Files (x86)\CMake\bin\cmake.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cmake) { throw 'CMake 3.22 o posterior es obligatorio para compilar stable-diffusion.cpp.' }
if (-not $env:VULKAN_SDK -or -not (Test-Path -LiteralPath $env:VULKAN_SDK)) {
  throw 'El Vulkan SDK es obligatorio para compilar el backend GPU (defina VULKAN_SDK).'
}
$cache = Join-Path $build 'CMakeCache.txt'
if (Test-Path -LiteralPath $cache) {
  $resolvedBuild = [IO.Path]::GetFullPath($build)
  $resolvedNativeRoot = [IO.Path]::GetFullPath($nativeBuildRoot).TrimEnd('\') + '\'
  if (-not $resolvedBuild.StartsWith($resolvedNativeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'El directorio temporal de stable-diffusion.cpp quedó fuera de la raíz autorizada.'
  }
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
$arguments = @(
  '-S', $source, '-B', $build, '-A', 'x64', '-DCMAKE_BUILD_TYPE=Release',
  '-DSD_VULKAN=ON', '-DSD_BUILD_EXAMPLES=ON', '-DSD_WEBM=OFF', '-DSD_BUILD_SHARED_LIBS=OFF'
)
Invoke-Native $cmake $arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la configuración de stable-diffusion.cpp.' }
Invoke-Native $cmake @('--build', $build, '--config', 'Release', '--target', 'sd-cli', '--parallel')
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de stable-diffusion.cpp.' }
$executable = Get-ChildItem -LiteralPath $build -Recurse -File -Filter 'sd-cli.exe' | Select-Object -First 1
if (-not $executable) { throw 'No se encontro sd-cli.exe en la compilación.' }
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
Get-ChildItem -LiteralPath $outputDirectory -File | Where-Object { $_.Extension -in '.exe', '.dll' } | Remove-Item -Force
Copy-Item -LiteralPath $executable.FullName -Destination (Join-Path $outputDirectory 'sd-cli.exe') -Force
# Con bibliotecas estáticas no debería haber DLL propias; si las hay, viajan junto al ejecutable.
Get-ChildItem -LiteralPath $executable.DirectoryName -File -Filter '*.dll' |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $outputDirectory $_.Name) -Force }
Write-Host "sd-cli instalado en $outputDirectory"
