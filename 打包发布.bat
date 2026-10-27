@echo off
rem Release packer launcher.
rem This file is intentionally pure ASCII: cmd.exe on a UTF-8 code page can
rem mis-parse multi-byte lines (bytes get dropped at buffer boundaries), which
rem silently truncates echo output. All Chinese messages come from Node instead.
setlocal
chcp 65001 >nul 2>&1
title Antigravity Localization - Release Pack
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo.
  echo Packaging requires Node.js. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "app.asar.ready" (
  echo [ERROR] app.asar.ready is missing in this folder.
  echo.
  echo Packaging needs a prebuilt ready bundle. Either:
  echo   1. Download app.asar.ready from GitHub Releases into this folder, or
  echo   2. Copy the localized app.asar from
  echo      %%LOCALAPPDATA%%\Programs\antigravity\resources\
  echo      into this folder and rename it to app.asar.ready
  echo.
  pause
  exit /b 1
)

rem Read the version declared in localize.js, so a stale ready bundle is
rem rejected instead of being shipped under the wrong tag.
set "EXPECTED="
for /f "tokens=2 delims='" %%v in ('findstr /b /c:"const CURRENT_VERSION" localize.js') do set "EXPECTED=%%v"

if defined EXPECTED (
  node build-release-zip.js --version "%EXPECTED%"
) else (
  node build-release-zip.js
)

if errorlevel 1 (
  echo.
  echo [FAILED] Packaging aborted. Check the messages above.
  echo.
  pause
  exit /b 1
)

echo.
pause
exit /b 0
