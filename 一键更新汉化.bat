@echo off
setlocal EnableExtensions

set "ORIG_CP="
for /f "tokens=*" %%A in ('chcp 2^>nul') do (
  for %%B in (%%A) do set "ORIG_CP=%%~nB"
)
chcp 65001 >nul
cd /d "%~dp0"

title Antigravity 2.0 一键更新与自动恢复汉化
echo =======================================================
echo     Antigravity 2.0 汉化更新与自动恢复程序
echo =======================================================
echo.
echo 说明：本程序将自动检测 Antigravity 安装状态、官方更新覆盖情况，
echo 并安全恢复汉化包（具备版本兼容性检查、原版备份与防白屏机制）。
echo.

if defined ANTIGRAVITY_FORCE_LEGACY goto USE_LEGACY_FLOW
where node >nul 2>&1
if errorlevel 1 goto USE_LEGACY_FLOW
goto USE_NODE_FLOW

:USE_NODE_FLOW
echo [模式] 检测到系统已安装 Node.js 环境，启动智能安全恢复流程...
echo.
node "%~dp0localize.js" --auto-restore
set "EXIT_CODE=%errorlevel%"
echo.
if "%EXIT_CODE%"=="0" goto NODE_SUCCESS
if "%EXIT_CODE%"=="2" goto NODE_MISMATCH
goto NODE_FAILED

:NODE_SUCCESS
echo =======================================================
echo  [成功] 汉化补丁已就绪！正在重新启动 Antigravity...
echo =======================================================
if not defined ANTIGRAVITY_BATCH_NOPAUSE timeout /t 2 >nul
if defined ANTIGRAVITY_NO_START goto CLEANUP
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
goto CLEANUP

:NODE_MISMATCH
echo =======================================================
echo  [版本警告] 检测到官方更新与本地补丁版本不匹配
echo =======================================================
echo 为避免覆盖后软件白屏，本次已自动安全拦截。
echo 请双击运行【双击运行汉化.bat】打开控制中心，下载对应最新版本的汉化包。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=2"
goto CLEANUP

:NODE_FAILED
echo =======================================================
echo  [失败] 恢复过程发生异常，请检查权限或路径配置。
echo =======================================================
echo 您也可以双击运行【双击运行汉化.bat】通过管理面板进行诊断与安装。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
if "%EXIT_CODE%"=="0" set "EXIT_CODE=1"
goto CLEANUP

:USE_LEGACY_FLOW
echo [提示] 未在系统中检测到 Node.js，进入离线安全保底模式。
echo.

set "TARGET_DIR=%LOCALAPPDATA%\Programs\antigravity\resources"
if not exist "%TARGET_DIR%\app.asar" set "TARGET_DIR=%LOCALAPPDATA%\Programs\antigravity\Resources"
if defined ANTIGRAVITY_TARGET_DIR set "TARGET_DIR=%ANTIGRAVITY_TARGET_DIR%"

set "ASAR_FILE=%TARGET_DIR%\app.asar"
set "BAK_FILE=%TARGET_DIR%\app.asar.bak"
set "READY_FILE=%~dp0app.asar.ready"
if defined ANTIGRAVITY_READY_FILE set "READY_FILE=%ANTIGRAVITY_READY_FILE%"

if not exist "%ASAR_FILE%" goto LEGACY_NO_CLIENT

where powershell.exe >nul 2>&1
if errorlevel 1 goto LEGACY_NO_POWERSHELL

echo [预检] 正在只读校验客户端与本地补丁包版本及汉化指纹...
set "SELF_BAT=%~f0"
set "PS_ACTION=precheck"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$r=[IO.File]::ReadAllText($env:SELF_BAT,[Text.Encoding]::UTF8);$m='::#PS_'+'HELPER_BEGIN#';$i=$r.IndexOf($m);if($i -lt 0){exit 3};&([scriptblock]::Create($r.Substring($i+$m.Length)))"
set "PS_CODE=%errorlevel%"

if "%PS_CODE%"=="10" goto LEGACY_ALREADY_LOCALIZED
if "%PS_CODE%"=="11" goto LEGACY_NO_READY
if "%PS_CODE%"=="20" goto LEGACY_VERSION_MISMATCH
if "%PS_CODE%"=="22" goto LEGACY_VERSION_UNKNOWN
if not "%PS_CODE%"=="0" goto LEGACY_PRECHECK_FAILED

echo.
echo 注意：汉化安装需要关闭当前运行的 Antigravity 客户端以解除文件占用。
echo 如果您有未保存的工作，请先保存。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
echo.

echo [1/3] 正在关闭 Antigravity 进程...
if not defined ANTIGRAVITY_SKIP_TASKKILL taskkill /F /IM Antigravity.exe >nul 2>&1
if not defined ANTIGRAVITY_SKIP_TASKKILL taskkill /F /IM language_server.exe >nul 2>&1
if not defined ANTIGRAVITY_BATCH_NOPAUSE timeout /t 2 >nul

echo [2/3] 正在校验并安全维护原版备份 app.asar.bak...
echo [3/3] 正在通过临时文件安全替换 app.asar...
set "PS_ACTION=install"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$r=[IO.File]::ReadAllText($env:SELF_BAT,[Text.Encoding]::UTF8);$m='::#PS_'+'HELPER_BEGIN#';$i=$r.IndexOf($m);if($i -lt 0){exit 3};&([scriptblock]::Create($r.Substring($i+$m.Length)))"
set "PS_CODE=%errorlevel%"

if "%PS_CODE%"=="10" goto LEGACY_ALREADY_LOCALIZED
if "%PS_CODE%"=="20" goto LEGACY_VERSION_MISMATCH
if "%PS_CODE%"=="22" goto LEGACY_VERSION_UNKNOWN
if not "%PS_CODE%"=="0" goto LEGACY_INSTALL_FAILED

echo.
echo =======================================================
echo  [成功] 汉化补丁安全更新完成！
echo =======================================================
echo.
set "EXIT_CODE=0"
if defined ANTIGRAVITY_NO_START goto CLEANUP
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" echo 正在为您重新启动 Antigravity...
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
goto CLEANUP

:LEGACY_NO_CLIENT
echo [错误] 未在目标路径找到 Antigravity 客户端文件：
echo %ASAR_FILE%
echo 请安装 Node.js 后运行【双击运行汉化.bat】指定自定义安装路径。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=1"
goto CLEANUP

:LEGACY_NO_POWERSHELL
echo [错误] 未检测到 Windows PowerShell，无法执行离线版本安全校验。
echo 为防止跨版本强行覆盖导致白屏，已中止操作。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=2"
goto CLEANUP

:LEGACY_NO_READY
echo [错误] 未找到本地就绪补丁包：
echo %READY_FILE%
echo 请确保已完整解压汉化包后再试。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=1"
goto CLEANUP

:LEGACY_ALREADY_LOCALIZED
echo =======================================================
echo  [状态正常] 当前客户端已处于汉化状态，无需重复覆盖安装。
echo =======================================================
echo 已跳过备份刷新，确保原版备份 app.asar.bak 不受汉化包污染。
echo.
set "EXIT_CODE=0"
goto CLEANUP

:LEGACY_VERSION_MISMATCH
echo.
echo =======================================================
echo  [版本警告] 客户端版本与本地 app.asar.ready 版本不一致
echo =======================================================
echo 为避免跨版本覆盖导致客户端白屏或崩溃，本次已严格安全拦截！
echo 请下载与当前客户端版本一致的汉化包后重试。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=2"
goto CLEANUP

:LEGACY_VERSION_UNKNOWN
echo.
echo =======================================================
echo  [安全拦截] 无法解析客户端或补丁包的 ASAR 版本信息
echo =======================================================
echo 目标文件可能不完整或已损坏，为避免客户端白屏，本次已严格拦截！
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=2"
goto CLEANUP

:LEGACY_PRECHECK_FAILED
echo.
echo [错误] 预检过程发生未知异常（状态码：%PS_CODE%），已安全中止。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=1"
goto CLEANUP

:LEGACY_INSTALL_FAILED
echo.
echo [失败] 写入备份或覆盖汉化包失败，请检查客户端是否已完全退出或尝试以管理员身份运行。
echo.
if not defined ANTIGRAVITY_BATCH_NOPAUSE pause
set "EXIT_CODE=1"
goto CLEANUP

:CLEANUP
if defined ORIG_CP chcp %ORIG_CP% >nul 2>&1
endlocal & exit /b %EXIT_CODE%

::#PS_HELPER_BEGIN#
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Marker = 'Antigravity 2.0 Chinese Localization Engine'
$MaxHeaderBytes = 4 * 1024 * 1024
$MaxPkgBytes = 1024 * 1024
$Latin1 = [System.Text.Encoding]::GetEncoding(28591)
$Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

function Read-ExactBytes([System.IO.FileStream]$Stream, [int]$Count, [int64]$Offset) {
  if ($Offset -lt 0 -or $Count -lt 0 -or ($Offset + $Count) -gt $Stream.Length) {
    throw 'Truncated ASAR range'
  }
  [void]$Stream.Seek($Offset, [System.IO.SeekOrigin]::Begin)
  $buf = New-Object byte[] $Count
  $readTotal = 0
  while ($readTotal -lt $Count) {
    $n = $Stream.Read($buf, $readTotal, $Count - $readTotal)
    if ($n -le 0) { throw 'Truncated ASAR data' }
    $readTotal += $n
  }
  return $buf
}

function Normalize-Ver([string]$Ver) {
  if ([string]::IsNullOrWhiteSpace($Ver)) { return '' }
  $v = $Ver.Trim()
  if ($v.Length -gt 128) { return '' }
  if ($v -match '[\x00-\x1f\x7f]') { return '' }
  return ($v -replace '^[vV]', '')
}

function Has-ReparsePoint([string]$TargetPath) {
  $curr = [System.IO.Path]::GetFullPath($TargetPath)
  while ($true) {
    if (-not (Test-Path -LiteralPath $curr)) { return $false }
    $item = Get-Item -LiteralPath $curr -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
    $parent = [System.IO.Path]::GetDirectoryName($curr)
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $curr) { break }
    $curr = $parent
  }
  return $false
}

function Read-AsarPackageVersion([string]$AsarPath) {
  if ([string]::IsNullOrWhiteSpace($AsarPath) -or -not (Test-Path -LiteralPath $AsarPath -PathType Leaf)) {
    return $null
  }
  $item = Get-Item -LiteralPath $AsarPath -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }

  $fs = $null
  try {
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $fs = New-Object System.IO.FileStream($item.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    $archiveSize = $fs.Length
    if ($archiveSize -lt 16) { return $null }

    $prefix = Read-ExactBytes -Stream $fs -Count 8 -Offset 0
    $sizePickle = [System.BitConverter]::ToUInt32($prefix, 0)
    $headerSize = [System.BitConverter]::ToUInt32($prefix, 4)
    if ($sizePickle -ne 4 -or $headerSize -lt 8 -or $headerSize -gt $MaxHeaderBytes -or ($headerSize % 4) -ne 0 -or $headerSize -gt ($archiveSize - 8)) {
      return $null
    }

    $header = Read-ExactBytes -Stream $fs -Count ([int]$headerSize) -Offset 8
    $payloadSize = [System.BitConverter]::ToUInt32($header, 0)
    $jsonSize = [System.BitConverter]::ToInt32($header, 4)
    $alignedSize = 8 + [int]([Math]::Ceiling($jsonSize / 4.0) * 4)
    if ($payloadSize -ne ($headerSize - 4) -or $jsonSize -le 0 -or $jsonSize -gt ($headerSize - 8) -or $alignedSize -ne $headerSize) {
      return $null
    }

    $headerJson = $Utf8Strict.GetString($header, 8, $jsonSize)
    $tree = $headerJson | ConvertFrom-Json
    if ($null -eq $tree -or $null -eq $tree.files) { return $null }
    $pkgProp = $tree.files.PSObject.Properties['package.json']
    if ($null -eq $pkgProp -or $null -eq $pkgProp.Value) { return $null }
    $entry = $pkgProp.Value

    if ($null -ne $entry.PSObject.Properties['link'] -or $null -ne $entry.PSObject.Properties['files']) {
      return $null
    }
    if ($null -eq $entry.size) { return $null }
    $pkgSize = [int64]$entry.size
    if ($pkgSize -lt 1 -or $pkgSize -gt $MaxPkgBytes) { return $null }

    $pkgBytes = $null
    if ($entry.unpacked -eq $true) {
      $unpackedDir = "$($item.FullName).unpacked"
      if (-not (Test-Path -LiteralPath $unpackedDir -PathType Container) -or (Has-ReparsePoint $unpackedDir)) { return $null }
      $unpackedPkg = Join-Path $unpackedDir 'package.json'
      if (-not (Test-Path -LiteralPath $unpackedPkg -PathType Leaf)) { return $null }
      $uItem = Get-Item -LiteralPath $unpackedPkg -Force
      if (($uItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $uItem.Length -ne $pkgSize) { return $null }
      $ufs = New-Object System.IO.FileStream($uItem.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
      try {
        $pkgBytes = Read-ExactBytes -Stream $ufs -Count ([int]$pkgSize) -Offset 0
      } finally {
        $ufs.Dispose()
      }
    } else {
      if ($null -eq $entry.offset -or ($entry.offset -isnot [string]) -or ($entry.offset -notmatch '^\d+$')) {
        return $null
      }
      $offset = [int64]$entry.offset
      $pos = [int64]8 + [int64]$headerSize + $offset
      if ($offset -lt 0 -or $pos -lt (8 + $headerSize) -or $pkgSize -gt ($archiveSize - $pos)) {
        return $null
      }
      $pkgBytes = Read-ExactBytes -Stream $fs -Count ([int]$pkgSize) -Offset $pos
    }

    $pkgJson = $Utf8Strict.GetString($pkgBytes)
    $meta = $pkgJson | ConvertFrom-Json
    if ($null -eq $meta -or ($meta.version -isnot [string])) { return $null }
    $norm = Normalize-Ver $meta.version
    if ([string]::IsNullOrEmpty($norm)) { return $null }
    return $meta.version.Trim()
  } catch {
    return $null
  } finally {
    if ($null -ne $fs) { $fs.Dispose() }
  }
}

function Test-LocalizedAsar([string]$AsarPath) {
  if ([string]::IsNullOrWhiteSpace($AsarPath) -or -not (Test-Path -LiteralPath $AsarPath -PathType Leaf)) {
    return $false
  }
  $fs = $null
  try {
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $fs = New-Object System.IO.FileStream($AsarPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    $chunkSize = 4 * 1024 * 1024
    $overlap = 128
    $buf = New-Object byte[] ($chunkSize + $overlap)
    $carry = 0
    while ($true) {
      $read = $fs.Read($buf, $carry, $chunkSize)
      if ($read -le 0) { break }
      $total = $carry + $read
      $text = $Latin1.GetString($buf, 0, $total)
      if ($text.IndexOf($Marker, [System.StringComparison]::Ordinal) -ge 0) {
        return $true
      }
      if ($total -gt $overlap) {
        [System.Array]::Copy($buf, $total - $overlap, $buf, 0, $overlap)
        $carry = $overlap
      } else {
        $carry = $total
      }
    }
    return $false
  } catch {
    return $false
  } finally {
    if ($null -ne $fs) { $fs.Dispose() }
  }
}

function Get-FileSha256Hex([string]$FilePath) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $fs = [System.IO.File]::OpenRead($FilePath)
  try {
    $hash = $sha.ComputeHash($fs)
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
  } finally {
    $fs.Dispose()
    $sha.Dispose()
  }
}

function Replace-FileSafely([string]$TempFile, [string]$DestFile) {
  if (Test-Path -LiteralPath $DestFile -PathType Leaf) {
    try {
      [System.IO.File]::Replace($TempFile, $DestFile, $null, $true)
      return
    } catch {
      [System.IO.File]::Copy($TempFile, $DestFile, $true)
      [System.IO.File]::Delete($TempFile)
      return
    }
  } else {
    [System.IO.File]::Move($TempFile, $DestFile)
  }
}

$asarFile = $env:ASAR_FILE
$readyFile = $env:READY_FILE
$bakFile = $env:BAK_FILE
$action = $env:PS_ACTION

if (-not (Test-Path -LiteralPath $asarFile -PathType Leaf)) {
  exit 1
}

if (Test-LocalizedAsar $asarFile) {
  $curVer = Read-AsarPackageVersion $asarFile
  if ($curVer) {
    Write-Host "  客户端版本: v$curVer（检测到已含汉化特征指纹）"
  }
  exit 10
}

if (-not (Test-Path -LiteralPath $readyFile -PathType Leaf)) {
  exit 11
}

$appVer = Read-AsarPackageVersion $asarFile
$readyVer = Read-AsarPackageVersion $readyFile
$appNorm = Normalize-Ver $appVer
$readyNorm = Normalize-Ver $readyVer

if ([string]::IsNullOrEmpty($appNorm) -or [string]::IsNullOrEmpty($readyNorm)) {
  Write-Host "  客户端版本: $(if ($appVer) { $appVer } else { '无法解析' }) | 补丁版本: $(if ($readyVer) { $readyVer } else { '无法解析' })"
  exit 22
}

if ($appNorm -ne $readyNorm) {
  Write-Host "  客户端版本: v$appVer | 本地补丁版本: v$readyVer"
  exit 20
}

if ($action -eq 'precheck') {
  Write-Host "  版本校验通过: 客户端与补丁包均为 v$appVer"
  exit 0
}

if ($action -eq 'install') {
  $targetDir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($asarFile))
  $token = "$PID.$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
  $bakTemp = Join-Path $targetDir "app.asar.temp.bak.$token"
  $stageTemp = Join-Path $targetDir "app.asar.temp.stage.$token"

  try {
    $bakExists = Test-Path -LiteralPath $bakFile -PathType Leaf
    $bakLocalized = $bakExists -and (Test-LocalizedAsar $bakFile)
    $bakVer = if ($bakExists) { Read-AsarPackageVersion $bakFile } else { $null }
    $bakNorm = Normalize-Ver $bakVer
    $needRefreshBak = (-not $bakExists) -or $bakLocalized -or ([string]::IsNullOrEmpty($bakNorm)) -or ($bakNorm -ne $appNorm)

    if ($needRefreshBak) {
      if ($bakExists -and (-not $bakLocalized) -and (-not [string]::IsNullOrEmpty($bakNorm))) {
        $archiveBak = Join-Path $targetDir "app.asar.bak.$bakVer.$(Get-Date -Format 'HHmmss')"
        try { [System.IO.File]::Copy($bakFile, $archiveBak, $true) } catch {}
      }
      [System.IO.File]::Copy($asarFile, $bakTemp, $true)
      if ((Get-FileSha256Hex $asarFile) -ne (Get-FileSha256Hex $bakTemp)) {
        throw 'Backup SHA-256 verification failed'
      }
      Replace-FileSafely -TempFile $bakTemp -DestFile $bakFile
      Write-Host "  已安全生成/刷新纯净原版备份: app.asar.bak (v$appVer)"
    } else {
      Write-Host "  原版备份校验通过，无需重复备份: app.asar.bak (v$bakVer)"
    }

    [System.IO.File]::Copy($readyFile, $stageTemp, $true)
    if ((Get-FileSha256Hex $readyFile) -ne (Get-FileSha256Hex $stageTemp)) {
      throw 'Stage patch SHA-256 verification failed'
    }
    if ((Normalize-Ver (Read-AsarPackageVersion $stageTemp)) -ne $appNorm -or (Normalize-Ver (Read-AsarPackageVersion $asarFile)) -ne $appNorm) {
      exit 20
    }
    Replace-FileSafely -TempFile $stageTemp -DestFile $asarFile
    exit 0
  } catch {
    Write-Error $_.Exception.Message
    exit 1
  } finally {
    if (Test-Path -LiteralPath $bakTemp -PathType Leaf) {
      try { [System.IO.File]::Delete($bakTemp) } catch {}
    }
    if (Test-Path -LiteralPath $stageTemp -PathType Leaf) {
      try { [System.IO.File]::Delete($stageTemp) } catch {}
    }
  }
}

exit 3
