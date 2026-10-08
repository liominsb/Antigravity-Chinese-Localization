@echo off
chcp 65001 >nul
title Antigravity 2.0 一键更新汉化
echo =======================================================
echo        Antigravity 2.0 一键汉化替换程序
echo =======================================================
echo.
echo 注意：汉化需要关闭当前运行的 Antigravity 客户端以解除文件占用。
echo 如果您有未保存的工作，请先保存。
echo.
pause
echo.
echo [1/3] 正在关闭 Antigravity 进程...
taskkill /F /IM Antigravity.exe >nul 2>&1
taskkill /F /IM language_server.exe >nul 2>&1
timeout /t 2 >nul

set "TARGET_DIR=%LOCALAPPDATA%\Programs\antigravity\resources"
if not exist "%TARGET_DIR%\app.asar.bak" (
  echo [2/3] 正在创建原版备份 app.asar.bak...
  copy /y "%TARGET_DIR%\app.asar" "%TARGET_DIR%\app.asar.bak" >nul
) else (
  echo [2/3] 备份已存在，跳过备份。
)

if not exist "%~dp0app.asar.ready" (
  if exist "%~dp0extracted" (
    echo [提示] 未检测到预打包的 app.asar.ready，正在自动从 extracted 源码目录打包...
    call npx -y @electron/asar pack "%~dp0extracted" "%~dp0app.asar.ready" --unpack-dir "**/chrome-devtools-mcp/**"
  )
)

if not exist "%~dp0app.asar.ready" (
  echo.
  echo [错误] 未找到 app.asar.ready 汉化包，且未能自动生成。
  echo 请先从 GitHub Releases 下载汉化包，或运行“双击运行汉化.bat”进行全自动汉化。
  pause
  exit /b 1
)

echo [3/3] 正在覆盖安装汉化包...
copy /y "%~dp0app.asar.ready" "%TARGET_DIR%\app.asar" >nul

if %errorlevel% equ 0 (
  echo.
  echo =======================================================
  echo  [成功] 汉化补丁更新完成！
  echo =======================================================
  echo.
  echo 正在为您重新启动 Antigravity...
  start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
) else (
  echo.
  echo [失败] 复制汉化包失败，请检查文件是否被占用或尝试以管理员身份运行。
  pause
)
