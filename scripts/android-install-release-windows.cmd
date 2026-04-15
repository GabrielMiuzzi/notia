@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "APK_PATH=%PROJECT_ROOT%\builds\android\notia-release.apk"

call "%SCRIPT_DIR%android-build-release-windows.cmd" %*
if errorlevel 1 exit /b %errorlevel%

where adb >nul 2>&1
if errorlevel 1 (
  echo [notia] adb is required to install the Android APK.>&2
  exit /b 1
)

set "ANDROID_SERIAL="
for /f "skip=1 tokens=1,2" %%A in ('adb devices') do (
  if "%%B"=="device" if not defined ANDROID_SERIAL set "ANDROID_SERIAL=%%A"
)

if not defined ANDROID_SERIAL (
  echo [notia] No Android device detected. Connect a device with USB debugging enabled.>&2
  exit /b 1
)

if not exist "%APK_PATH%" (
  echo [notia] APK not found: %APK_PATH%>&2
  exit /b 1
)

adb -s "%ANDROID_SERIAL%" install -r "%APK_PATH%"
if errorlevel 1 exit /b %errorlevel%

echo [notia] Installed APK on device from %APK_PATH%
exit /b 0
