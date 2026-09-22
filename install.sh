#!/usr/bin/env bash
# ===========================================================================
#  OmniMod MCP - one-click installer AND launcher (macOS / Linux).
#
#  Installs (or updates) Node dependencies, builds, runs the self-test battery,
#  prints your full connection card, and - when you are sitting at a terminal -
#  offers to START the server in this window.
#
#  Requires Node.js 18+ (https://nodejs.org). No Python needed.
#
#  Non-interactive use (CI, `curl | bash`) skips the prompt and just installs:
#      OMNIMOD_MCP_NO_PROMPT=1 ./install.sh
#      ./install.sh --serve          install, then start the server
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")"

ENTRY="$PWD/dist/index.js"
WANT_SERVE=0
for arg in "$@"; do
  case "$arg" in
    --serve|serve) WANT_SERVE=1 ;;
  esac
done

echo "========================================================================"
echo "  OmniMod MCP - installer / launcher"
echo "  Folder: $PWD"
echo "========================================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found."
  echo "        Install Node.js 18+ from https://nodejs.org and run this again."
  exit 1
fi
echo "[0/4] node $(node --version)"
echo

echo "[1/4] npm install ..."
npm install

echo "[2/4] npm run build ..."
npm run build
if [ ! -f "$ENTRY" ]; then
  echo "[ERROR] build produced no dist/index.js"
  exit 1
fi

echo "[3/4] npm run selfcheck ..."
npm run selfcheck

echo "[4/4] connection card ..."
echo
node "$ENTRY" setup

echo
echo "========================================================================"
echo "  READY.  Two ways to use it from here:"
echo
echo "    * NORMAL USE - paste your client block (above) into your AI editor's"
echo "      MCP settings and restart the editor. The editor starts the server"
echo "      itself, so you do NOT need to keep any terminal open."
echo
echo "    * WATCH IT RUN - start the server in THIS terminal. It stays in the"
echo "      foreground while it runs, and closing it (or Ctrl+C) stops it."
echo "========================================================================"
echo

# Only offer the prompt when a human is actually there. A piped installer
# (`curl | bash`) has no stdin to read, and blocking on a prompt would look
# like a hang.
if [ "$WANT_SERVE" -eq 0 ]; then
  if [ -t 0 ] && [ "${OMNIMOD_MCP_NO_PROMPT:-0}" != "1" ]; then
    printf "Start the MCP server in this terminal now? [y/N] "
    read -r reply || reply="n"
    case "$reply" in
      [yY]|[yY][eE][sS]) WANT_SERVE=1 ;;
    esac
  fi
fi

if [ "$WANT_SERVE" -eq 1 ]; then
  echo
  echo "Starting the server. Close this terminal or press Ctrl+C to stop it."
  echo "Do NOT type here - this terminal's input is the server's data channel."
  echo
  node "$ENTRY" serve
  echo
  echo "[omnimod-mcp] server stopped."
  exit 0
fi

echo "Not started. To start it later, from ANY folder in ANY terminal, run:"
echo
echo "    omnimod-mcp serve"
echo
echo "Or re-run this file with --serve. Other commands:"
echo "    omnimod-mcp setup     show the connection card again"
echo "    omnimod-mcp doctor    diagnose a connection problem"
echo "    omnimod-mcp --help    all options"
echo
