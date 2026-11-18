@echo off
setlocal EnableExtensions

set "ORIG_CP="
for /f "tokens=*" %%A in ('chcp 2^>nul') do (
  for %%B in (%%A) do set "ORIG_CP=%%~nB"
)
chcp 65001 >nul
cd /d "%~dp0"

title Antigravity 2.0 汉化管理面板
echo =======================================================
echo  Antigravity 2.0 汉化管理面板 (支持更新自动检测与版本管理)
echo =======================================================
echo.

if not exist "%~dp0localize.js" goto NO_SCRIPT

where node >nul 2>&1
if errorlevel 1 goto NO_NODE

echo 正在启动汉化管理服务与客户端更新检查...
echo 将在默认浏览器中打开控制台：http://127.0.0.1:3388
echo.

if not defined ANTIGRAVITY_NO_BROWSER start "" /b cmd /c "ping -n 2 127.0.0.1 >nul & start http://127.0.0.1:3388"

node "%~dp0localize.js"
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto SERVICE_ERROR
goto CLEANUP

:NO_NODE
echo [提示] 未检测到 Node.js 运行环境，无法启动本地 Web 可视化控制中心。
echo        如需使用可视化控制中心，可前往官网安装 Node.js：https://nodejs.org
echo.
if defined ANTIGRAVITY_BATCH_NOPAUSE goto NO_NODE_EXIT
if exist "%~dp0一键更新汉化.bat" if exist "%~dp0app.asar.ready" goto BRIDGE_OFFLINE
echo [错误] 当前目录未找到离线就绪补丁包 app.asar.ready，无法执行免环境离线汉化。
echo        请确认已下载完整发行包并完整解压后再运行。
echo.
pause
:NO_NODE_EXIT
set "EXIT_CODE=1"
goto CLEANUP

:BRIDGE_OFFLINE
echo =======================================================
echo  检测到本地内置免环境补丁包 (app.asar.ready)！
echo  即将自动切换至【离线安全模式】直接为您完成汉化...
echo =======================================================
echo.
call "%~dp0一键更新汉化.bat"
set "EXIT_CODE=%errorlevel%"
goto CLEANUP

:NO_SCRIPT
echo [错误] 未在当前目录找到核心脚本 localize.js！
echo        请勿直接在压缩包预览窗口中双击运行，请先将压缩包完整解压到文件夹后再试。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=1"
goto CLEANUP

:SERVICE_ERROR
echo.
echo [错误] 汉化管理服务异常退出（退出码：%EXIT_CODE%）。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
goto CLEANUP

:CLEANUP
if defined ORIG_CP chcp %ORIG_CP% >nul 2>&1
endlocal & exit /b %EXIT_CODE%
