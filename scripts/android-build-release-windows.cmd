@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"

set "ARTIFACT_DIR=%PROJECT_ROOT%\builds\android"
set "SIGNING_FILE=%PROJECT_ROOT%\android-signing.properties"
set "DEFAULT_STORE_RELATIVE=.secrets\android\notia-upload.jks"
set "ANDROID_PACKAGE_FORMAT=apk"

call :configure_android_environment
if errorlevel 1 exit /b %errorlevel%

call :configure_java_environment
if errorlevel 1 exit /b %errorlevel%

call :resolve_signing_values
if errorlevel 1 exit /b %errorlevel%

call :ensure_local_signing_config
if errorlevel 1 exit /b %errorlevel%

call :resolve_signing_values
if errorlevel 1 exit /b %errorlevel%

if not defined STORE_FILE (
  echo [notia] storeFile is not configured.>&2
  exit /b 1
)

set "STORE_FILE=%STORE_FILE:/=\%"
if not exist "%STORE_FILE%" if exist "%PROJECT_ROOT%\%STORE_FILE%" set "STORE_FILE=%PROJECT_ROOT%\%STORE_FILE%"
if not exist "%STORE_FILE%" (
  echo [notia] Keystore not found: %STORE_FILE%>&2
  exit /b 1
)

call :resolve_android_package_format %*
if errorlevel 1 exit /b %errorlevel%

call :ensure_android_project_initialized
if errorlevel 1 exit /b %errorlevel%

set "TAURI_ARGS=android build --target aarch64 --%ANDROID_PACKAGE_FORMAT%"
if not "%~1"=="" set "TAURI_ARGS=%TAURI_ARGS% %*"

pushd "%PROJECT_ROOT%"
call npx.cmd tauri %TAURI_ARGS%
set "BUILD_EXIT=%ERRORLEVEL%"
popd
if not "%BUILD_EXIT%"=="0" exit /b %BUILD_EXIT%

call :copy_ready_artifact
exit /b %ERRORLEVEL%

:configure_android_environment
call :find_android_sdk_root
if errorlevel 1 (
  echo [notia] Android SDK not found. Define ANDROID_HOME or ANDROID_SDK_ROOT.>&2
  exit /b 1
)

set "ANDROID_HOME=%SDK_ROOT%"
set "ANDROID_SDK_ROOT=%SDK_ROOT%"
if exist "%SDK_ROOT%\platform-tools" set "PATH=%SDK_ROOT%\platform-tools;%PATH%"
if exist "%SDK_ROOT%\cmdline-tools\latest\bin" set "PATH=%SDK_ROOT%\cmdline-tools\latest\bin;%PATH%"

call :find_android_ndk_dir "%SDK_ROOT%"
if errorlevel 1 (
  echo [notia] Android NDK not found. Install it from Android Studio or define NDK_HOME.>&2
  exit /b 1
)

set "NDK_HOME=%NDK_DIR%"
set "ANDROID_NDK_HOME=%NDK_DIR%"

set "TOOLCHAIN_BIN=%NDK_DIR%\toolchains\llvm\prebuilt\windows-x86_64\bin"
if not exist "%TOOLCHAIN_BIN%" (
  echo [notia] Android LLVM toolchain not found: %TOOLCHAIN_BIN%>&2
  exit /b 1
)

set "PATH=%TOOLCHAIN_BIN%;%PATH%"
set "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=%TOOLCHAIN_BIN%\aarch64-linux-android26-clang.cmd"
if not exist "%CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER%" set "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=%TOOLCHAIN_BIN%\aarch64-linux-android26-clang"
set "CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="
set "CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="
set "CARGO_TARGET_I686_LINUX_ANDROID_LINKER="
exit /b 0

:configure_java_environment
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
  exit /b 0
)

for %%D in (
  "%ProgramFiles%\Android\Android Studio\jbr"
  "%ProgramFiles%\Android\Android Studio\jre"
  "%LocalAppData%\Programs\Android Studio\jbr"
  "%LocalAppData%\Programs\Android Studio\jre"
  "%ProgramFiles%\Eclipse Adoptium\jdk-21*"
  "%ProgramFiles%\Microsoft\jdk-21*"
  "%ProgramFiles%\Java\jdk-21*"
  "%ProgramFiles%\Java\jdk-17*"
) do (
  if exist "%%~fD\bin\java.exe" (
    set "JAVA_HOME=%%~fD"
    set "PATH=%%~fD\bin;%PATH%"
    exit /b 0
  )
)

echo [notia] No compatible JDK found for Android builds. Install JDK 17/21 or Android Studio and define JAVA_HOME.>&2
exit /b 1

:find_android_sdk_root
if defined ANDROID_HOME if exist "%ANDROID_HOME%" (
  set "SDK_ROOT=%ANDROID_HOME%"
  exit /b 0
)
if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%" (
  set "SDK_ROOT=%ANDROID_SDK_ROOT%"
  exit /b 0
)
if exist "%LocalAppData%\Android\Sdk" (
  set "SDK_ROOT=%LocalAppData%\Android\Sdk"
  exit /b 0
)
if exist "%USERPROFILE%\AppData\Local\Android\Sdk" (
  set "SDK_ROOT=%USERPROFILE%\AppData\Local\Android\Sdk"
  exit /b 0
)
exit /b 1

:find_android_ndk_dir
if defined ANDROID_NDK_HOME if exist "%ANDROID_NDK_HOME%" (
  set "NDK_DIR=%ANDROID_NDK_HOME%"
  exit /b 0
)
if defined NDK_HOME if exist "%NDK_HOME%" (
  set "NDK_DIR=%NDK_HOME%"
  exit /b 0
)

set "SDK_ROOT=%~1"
if not exist "%SDK_ROOT%\ndk" exit /b 1

set "NDK_DIR="
for /f "delims=" %%D in ('dir /b /ad "%SDK_ROOT%\ndk" 2^>nul') do (
  set "NDK_DIR=%SDK_ROOT%\ndk\%%D"
)
if defined NDK_DIR if exist "%NDK_DIR%" exit /b 0
exit /b 1

:resolve_android_package_format
for %%A in (%*) do (
  if /I "%%~A"=="--aab" set "ANDROID_PACKAGE_FORMAT=aab"
  if /I "%%~A"=="--apk" set "ANDROID_PACKAGE_FORMAT=apk"
)
exit /b 0

:ensure_android_project_initialized
if exist "%PROJECT_ROOT%\src-tauri\gen\android" exit /b 0
echo [notia] Android project not initialized. Running `npx tauri android init`...>&2
pushd "%PROJECT_ROOT%"
call npx.cmd tauri android init
set "INIT_EXIT=%ERRORLEVEL%"
popd
if not "%INIT_EXIT%"=="0" exit /b %INIT_EXIT%
if exist "%PROJECT_ROOT%\src-tauri\gen\android" exit /b 0
echo [notia] Android Studio project directory was not generated.>&2
exit /b 1

:resolve_signing_values
set "STORE_FILE=%NOTIA_ANDROID_KEYSTORE_PATH%"
set "STORE_PASSWORD=%NOTIA_ANDROID_KEYSTORE_PASSWORD%"
set "KEY_ALIAS=%NOTIA_ANDROID_KEY_ALIAS%"
set "KEY_PASSWORD=%NOTIA_ANDROID_KEY_PASSWORD%"

if exist "%SIGNING_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%SIGNING_FILE%") do (
    if /I "%%A"=="storeFile" if not defined STORE_FILE set "STORE_FILE=%%B"
    if /I "%%A"=="storePassword" if not defined STORE_PASSWORD set "STORE_PASSWORD=%%B"
    if /I "%%A"=="keyAlias" if not defined KEY_ALIAS set "KEY_ALIAS=%%B"
    if /I "%%A"=="keyPassword" if not defined KEY_PASSWORD set "KEY_PASSWORD=%%B"
  )
)
exit /b 0

:ensure_local_signing_config
if defined STORE_FILE if defined STORE_PASSWORD if defined KEY_ALIAS if defined KEY_PASSWORD exit /b 0

set "STORE_FILE=%DEFAULT_STORE_RELATIVE%"
set "STORE_PASSWORD=notia-dev-password"
set "KEY_ALIAS=notia"
set "KEY_PASSWORD=%STORE_PASSWORD%"

if not exist "%PROJECT_ROOT%\.secrets\android" mkdir "%PROJECT_ROOT%\.secrets\android" >nul 2>&1

if not exist "%PROJECT_ROOT%\%STORE_FILE%" (
  where keytool >nul 2>&1
  if errorlevel 1 (
    echo [notia] keytool is required to generate the Android signing keystore.>&2
    exit /b 1
  )

  keytool -genkeypair ^
    -keystore "%PROJECT_ROOT%\%STORE_FILE%" ^
    -storepass "%STORE_PASSWORD%" ^
    -alias "%KEY_ALIAS%" ^
    -keypass "%KEY_PASSWORD%" ^
    -keyalg RSA ^
    -keysize 2048 ^
    -validity 10000 ^
    -dname "CN=Notia, OU=Development, O=Notia, L=Local, S=Local, C=AR" ^
    -noprompt >nul
  if errorlevel 1 exit /b %errorlevel%
)

(
  echo storeFile=%STORE_FILE%
  echo storePassword=%STORE_PASSWORD%
  echo keyAlias=%KEY_ALIAS%
  echo keyPassword=%KEY_PASSWORD%
) > "%SIGNING_FILE%"

echo [notia] Generated local Android signing config at %SIGNING_FILE%>&2
exit /b 0

:copy_ready_artifact
if not exist "%ARTIFACT_DIR%" mkdir "%ARTIFACT_DIR%" >nul 2>&1

set "FOUND_ARTIFACT="
for /r "%PROJECT_ROOT%\src-tauri\gen\android\app\build\outputs" %%F in (*.apk *.aab) do (
  set "FOUND_ARTIFACT=%%~fF"
)

if not defined FOUND_ARTIFACT (
  echo [notia] Android artifact not found after build.>&2
  exit /b 1
)

set "EXT=%FOUND_ARTIFACT:~-4%"
if /I "%EXT%"==".aab" (
  set "READY_ARTIFACT=%ARTIFACT_DIR%\notia-release.aab"
  copy /Y "%FOUND_ARTIFACT%" "%READY_ARTIFACT%" >nul
  echo [notia] AAB ready: %READY_ARTIFACT%
  exit /b 0
)

set "BUILD_TOOLS_DIR="
for /f "delims=" %%D in ('dir /b /ad "%SDK_ROOT%\build-tools" 2^>nul') do (
  set "BUILD_TOOLS_DIR=%SDK_ROOT%\build-tools\%%D"
)

if defined BUILD_TOOLS_DIR if exist "%FOUND_ARTIFACT%" (
  echo %FOUND_ARTIFACT% | findstr /I /C:"-unsigned.apk" >nul
  if not errorlevel 1 (
    set "ZIPALIGN_BIN=%BUILD_TOOLS_DIR%\zipalign.exe"
    set "APKSIGNER_BIN=%BUILD_TOOLS_DIR%\apksigner.bat"
    if not exist "%APKSIGNER_BIN%" set "APKSIGNER_BIN=%BUILD_TOOLS_DIR%\apksigner"
    if exist "%ZIPALIGN_BIN%" if exist "%APKSIGNER_BIN%" (
      set "ALIGNED_APK=%ARTIFACT_DIR%\notia-release-aligned.apk"
      set "SIGNED_APK=%ARTIFACT_DIR%\notia-release-signed.apk"
      "%ZIPALIGN_BIN%" -f -p 4 "%FOUND_ARTIFACT%" "%ALIGNED_APK%"
      if errorlevel 1 exit /b %errorlevel%
      call "%APKSIGNER_BIN%" sign --ks "%STORE_FILE%" --ks-pass pass:%STORE_PASSWORD% --ks-key-alias "%KEY_ALIAS%" --key-pass pass:%KEY_PASSWORD% --out "%SIGNED_APK%" "%ALIGNED_APK%"
      if errorlevel 1 exit /b %errorlevel%
      call "%APKSIGNER_BIN%" verify -v "%SIGNED_APK%" >nul
      if errorlevel 1 exit /b %errorlevel%
      copy /Y "%SIGNED_APK%" "%ARTIFACT_DIR%\notia-release.apk" >nul
      echo [notia] APK ready: %ARTIFACT_DIR%\notia-release.apk
      exit /b 0
    )
  )
)

copy /Y "%FOUND_ARTIFACT%" "%ARTIFACT_DIR%\notia-release.apk" >nul
echo [notia] APK ready: %ARTIFACT_DIR%\notia-release.apk
exit /b 0
