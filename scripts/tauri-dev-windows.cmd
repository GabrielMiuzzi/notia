@echo off
setlocal

set "VS_DEV_CMD="

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" set "VSWHERE=%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe"

if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    if exist "%%i\Common7\Tools\VsDevCmd.bat" set "VS_DEV_CMD=%%i\Common7\Tools\VsDevCmd.bat"
  )
)

if not defined VS_DEV_CMD (
  echo No se encontro VsDevCmd.bat.
  echo Instala Visual Studio Build Tools 2022 con "Desktop development with C++".
  exit /b 1
)

call "%VS_DEV_CMD%" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tauri-dev-windows.ps1"
exit /b %errorlevel%
