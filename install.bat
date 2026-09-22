@echo off
REM ===========================================================================
REM  OmniMod MCP - one-click installer AND launcher (Windows).
REM
REM  Installs (or updates) Node dependencies, builds, runs the self-test
REM  battery, prints your full connection card, and offers to START the server
REM  in this window.
REM
REM  Requires Node.js 18+ (https://nodejs.org). No Python needed.
REM
REM  ASCII-only on purpose: this file is executed by cmd.exe under whatever code
REM  page the machine happens to use, and non-ASCII bytes here would be mangled.
REM  The connection card it prints IS UTF-8 - see the chcp below.
REM ===========================================================================
setlocal EnableExtensions

REM The card contains Arabic + box-drawing characters; without this, cmd renders
REM them as mojibake. Harmless on consoles that are already UTF-8.
chcp 65001 >nul 2>nul

cd /d "%~dp0"

set "ENTRY=%CD%\dist\index.js"

echo ========================================================================
echo   OmniMod MCP - installer / launcher
echo   Folder: %CD%
echo ========================================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo         Install Node.js 18+ from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do set "NODEV=%%v"
echo [0/4] node %NODEV%
echo.

echo [1/4] npm install ...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed. Check your internet connection and retry.
  pause
  exit /b 1
)

echo [2/4] npm run build ...
call npm run build
if errorlevel 1 (
  echo [ERROR] build failed. Report it at https://github.com/Mcamento8/omnimod-mcp/issues
  pause
  exit /b 1
)
if not exist "%ENTRY%" (
  echo [ERROR] build produced no dist\index.js
  pause
  exit /b 1
)

echo [3/4] npm run selfcheck ...
call npm run selfcheck
if errorlevel 1 (
  echo [ERROR] selfcheck failed. Report it at https://github.com/Mcamento8/omnimod-mcp/issues
  pause
  exit /b 1
)

echo [4/4] connection card ...
echo.
node "%ENTRY%" setup
if errorlevel 1 echo [WARN] could not print the connection card - run: node "%ENTRY%" setup

echo.
echo ========================================================================
echo   READY.  Two ways to use it from here:
echo.
echo     * NORMAL USE - paste your client block (above) into your AI editor's
echo       MCP settings and restart the editor. The editor starts the server
echo       itself, so you do NOT need to keep any window open.
echo.
echo     * WATCH IT RUN - start the server in THIS window. It stays open while
echo       it runs, and closing this window (or Ctrl+C) stops it.
echo ========================================================================
echo.

choice /C YN /N /T 30 /D N /M "Start the MCP server in this window now? [Y/N] (auto-N in 30s): "
if errorlevel 2 goto done

echo.
echo Starting the server. Close this window or press Ctrl+C to stop it.
echo Do NOT type here - this window's input is the server's data channel.
echo.
node "%ENTRY%" serve
echo.
echo [omnimod-mcp] server stopped.
pause
exit /b 0

:done
echo.
echo Not started. To start it later, from ANY folder in ANY terminal, run:
echo.
echo     omnimod-mcp serve
echo.
echo Or re-run this file. Other commands:
echo     omnimod-mcp setup     show the connection card again
echo     omnimod-mcp doctor    diagnose a connection problem
echo     omnimod-mcp --help    all options
echo.
pause
exit /b 0
