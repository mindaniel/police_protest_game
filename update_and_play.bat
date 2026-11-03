@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM update_and_play.bat - check for updates on GitHub, update only if needed, then play.
REM Double-click this file to start the game.

cd /d "%~dp0"

set "API=https://api.github.com/repos/mindaniel/police_protest_game/commits/main"
set "REPO_ZIP=https://codeload.github.com/mindaniel/police_protest_game/zip/refs/heads/main"
set "ZIP_NAME=police_protest_game-main"

REM Sanity check: the game must exist.
if not exist "index.html" (
    echo ERROR: index.html not found in "%~dp0"
    timeout /t 3 >nul
    exit /b 1
)

REM --- Choose update path: git clone, else zip + version.txt -----------------
if exist ".git" (
    where git >nul 2>&1
    if not errorlevel 1 goto git_update
)
goto zip_update

REM --- Git clone: fetch and compare, pull only if behind ----------------------
:git_update
set "DIRTY="
for /f "delims=" %%L in ('git status --porcelain --untracked-files=no 2^>nul') do set "DIRTY=1"
if defined DIRTY (
    echo Local changes found - playing the current version
    goto open_game
)

git fetch --quiet origin main >nul 2>&1
if errorlevel 1 (
    echo Offline - playing the last version
    goto open_game
)

set "OLD_HEAD="
for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%H"
set "REMOTE_HEAD="
for /f "delims=" %%H in ('git rev-parse origin/main 2^>nul') do set "REMOTE_HEAD=%%H"

if not defined REMOTE_HEAD goto git_pull
if /I "!OLD_HEAD!"=="!REMOTE_HEAD!" (
    echo Already up to date
    goto open_game
)

:git_pull
git merge --ff-only origin/main >nul 2>&1
if errorlevel 1 git pull --ff-only origin main >nul 2>&1

set "NEW_HEAD="
for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%H"
if /I "!NEW_HEAD!"=="!OLD_HEAD!" (
    echo Update failed - playing the current version
    goto open_game
)

set "SHORT="
for /f "delims=" %%S in ('git rev-parse --short HEAD 2^>nul') do set "SHORT=%%S"
set "SUBJ="
for /f "delims=" %%T in ('git log -1 --pretty=%%s 2^>nul') do set "SUBJ=%%T"
echo Updated to !SHORT! - !SUBJ!
goto open_game

REM --- Zip install: compare version.txt with the latest commit sha -----------
:zip_update
set "LOCAL_SHA="
if exist "version.txt" for /f "usebackq delims=" %%S in ("version.txt") do set "LOCAL_SHA=%%S"

set "TMPD=%TEMP%\pp_game_%RANDOM%%RANDOM%"
mkdir "%TMPD%" >nul 2>&1
set "SHAFILE=%TMPD%\sha.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Headers @{'User-Agent'='police-protest-game-updater'} -Uri '%API%' -TimeoutSec 10; [IO.File]::WriteAllText('%SHAFILE%', [string]$r.sha) } catch { exit 1 }"
if errorlevel 1 goto check_failed

set "REMOTE_SHA="
if exist "%SHAFILE%" for /f "usebackq delims=" %%S in ("%SHAFILE%") do set "REMOTE_SHA=%%S"
if not defined REMOTE_SHA goto check_failed

if /I "%LOCAL_SHA%"=="%REMOTE_SHA%" (
    echo Already up to date
    goto cleanup_and_open
)

echo Update available - downloading...
set "ZIPFILE=%TMPD%\game.zip"
set "HAVECURL="
where curl.exe >nul 2>&1 && set "HAVECURL=1"
if defined HAVECURL (
    curl.exe -fsSL --max-time 120 "%REPO_ZIP%" -o "%ZIPFILE%"
    if errorlevel 1 goto dl_failed
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%REPO_ZIP%' -OutFile '%ZIPFILE%' } catch { exit 1 }"
    if errorlevel 1 goto dl_failed
)
if not exist "%ZIPFILE%" goto dl_failed

set "EXDIR=%TMPD%\x"
mkdir "%EXDIR%" >nul 2>&1
tar -xf "%ZIPFILE%" -C "%EXDIR%" >nul 2>&1
if not exist "%EXDIR%\%ZIP_NAME%\index.html" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '%ZIPFILE%' -DestinationPath '%EXDIR%' -Force } catch { exit 1 }"
)
if not exist "%EXDIR%\%ZIP_NAME%\index.html" goto dl_failed

xcopy "%EXDIR%\%ZIP_NAME%\*" "%CD%\" /E /I /Y /H /Q >nul
> "version.txt" echo %REMOTE_SHA%
echo Updated to %REMOTE_SHA:~0,7% - playing the newest version
goto cleanup_and_open

:check_failed
echo Offline or version check failed - playing the last version
goto cleanup_and_open

:dl_failed
echo Update failed - playing the last version
goto cleanup_and_open

:cleanup_and_open
if defined TMPD if exist "%TMPD%" rmdir /s /q "%TMPD%" >nul 2>&1

:open_game
start "" "%~dp0index.html"
timeout /t 3 >nul
endlocal
exit /b 0
