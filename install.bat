@echo off
REM OmniMod MCP — one-click installer (Windows).
REM Installs Node dependencies, builds, and runs the self-test battery.
REM Requires Node.js 18+ (https://nodejs.org). No Python needed for the MCP itself.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ from https://nodejs.org then re-run install.bat
  pause
  exit /b 1
)
echo [1/3] npm install ...
call npm install || (echo [ERROR] npm install failed & pause & exit /b 1)
echo [2/3] npm run build ...
call npm run build || (echo [ERROR] build failed & pause & exit /b 1)
echo [3/3] npm run selfcheck ...
call npm run selfcheck || (echo [ERROR] selfcheck failed & pause & exit /b 1)
echo.
echo SUCCESS: OmniMod MCP is ready.
echo Point your AI client at: %CD%\dist\index.js
echo See examples\ for Claude Desktop / Claude Code / Cursor / Cline / Kilo configs.
pause
