#!/usr/bin/env bash
# OmniMod MCP — one-click installer (macOS / Linux).
# Installs Node dependencies, builds, and runs the self-test battery.
# Requires Node.js 18+ (https://nodejs.org).
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js 18+ from https://nodejs.org then re-run install.sh"
  exit 1
fi
echo "[1/3] npm install ..."
npm install
echo "[2/3] npm run build ..."
npm run build
echo "[3/3] npm run selfcheck ..."
npm run selfcheck
echo ""
echo "SUCCESS: OmniMod MCP is ready."
echo "Point your AI client at: $PWD/dist/index.js"
echo "See examples/ for Claude Desktop / Claude Code / Cursor / Cline / Kilo configs."
