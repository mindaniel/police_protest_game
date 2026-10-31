@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM update_and_play.bat - update the game from GitHub and open it (Windows).
REM Double-click this file to update and play.

cd /d "%~dp0"

set "REPO_ZIP=https://codeload.github.com/mindaniel/police_protest_game/zip/refs/heads/main"
set "ZIP_NAME=police_protest_game-main"

REM Sanity check: the game must exist.
if not exist "%~dp0index.html" (
    echo ERROR: index.html not found in "%~dp0"
    timeout /t 3 >nul
    exit /b 1
)

REM --- Git path -------------------------------------------------------------
if exist "%~dp0.git" (
    where git >nul 2>&1
    if not errorlevel 1 (
        set "HASCHANGES="
        for /f "delims=" %%L in ('git status --porcelain --untracked-files=no 2^>nul') do set "HASCHANGES=1"
        if defined HASCHANGES (
            echo Local changes found - skipping update, playing current version
            goto open_game
        )
        for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%H"
        git fetch --quiet origin main >nul 2>&1
        if errorlevel 1 (
            echo Offline - playing the last version
            goto open_game
        )
        git merge --ff-only origin/main >nul 2>&1
        if errorlevel 1 git pull --ff-only >nul 2>&1
        for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%H"
        if not "!NEW_HEAD!"=="!OLD_HEAD!" (
            for /f "delims=" %%S in ('git rev-parse --short HEAD 2^>nul') do set "SHORT=%%S"
            for /f "delims=" %%T in ('git log -1 --pretty=%%s 2^>nul') do set "SUBJ=%%T"
            echo Updated to !SHORT! - !SUBJ!
        ) else (
            echo Already up to date
        )
        goto open_game
    )
)

REM --- Zip fallback (no git) ------------------------------------------------
set "TMPPS=%TEMP%\pp_game_%RANDOM%%RANDOM%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  $tmp='%TMPPS%'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null;" ^
  "  $zip=Join-Path $tmp 'game.zip';" ^
  "  Invoke-WebRequest -UseBasicParsing -Uri '%REPO_ZIP%' -OutFile $zip;" ^
  "  Expand-Archive -Path $zip -DestinationPath $tmp -Force;" ^
  "  $src=Join-Path $tmp '%ZIP_NAME%';" ^
  "  if (-not (Test-Path $src)) { throw 'extracted folder missing' };" ^
  "  Get-ChildItem -Path $src -Force | Copy-Item -Destination '%CD%' -Recurse -Force;" ^
  "  (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') | Out-File -Encoding ASCII -FilePath (Join-Path '%CD%' '.last_update');" ^
  "  Write-Host 'Updated (zip) - playing the newest version';" ^
  "} catch { Write-Host ('Update failed - playing the last version: ' + $_.Exception.Message) }" ^
  "finally { if (Test-Path '%TMPPS%') { Remove-Item -Recurse -Force '%TMPPS%' -ErrorAction SilentlyContinue } }"
if errorlevel 1 echo Offline or update failed - playing the last version

:open_game
start "" "%~dp0index.html"
timeout /t 3 >nul
endlocal
exit /b 0
