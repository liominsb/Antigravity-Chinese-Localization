#!/bin/bash
# Antigravity 2.0 Chinese Localizer Service Startup Script for Linux/macOS

cd "$(dirname -- "$0")" || exit 1

echo "======================================================="
echo "  Antigravity 2.0 Chinese Localizer Service"
echo "======================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found in your PATH."
  echo "Please install Node.js (>= 18.18.0 recommended) before starting the localization service:"
  echo "  https://nodejs.org"
  echo ""
  if [ -t 0 ]; then
    read -r -p "Press Enter to exit..." _
  fi
  exit 1
fi

if [ ! -f "localize.js" ]; then
  echo "[ERROR] localize.js was not found in $(pwd)."
  echo "Please make sure you extracted the complete localization package."
  exit 1
fi

echo "Starting localization backend service..."
echo "Opening dashboard in your default browser: http://127.0.0.1:3388"
echo ""

# Delay browser launch by 1 second in the background so the HTTP server is listening first
(
  sleep 1
  if [ "$(uname)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:3388" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:3388" >/dev/null 2>&1 || true
  elif command -v gnome-open >/dev/null 2>&1; then
    gnome-open "http://127.0.0.1:3388" >/dev/null 2>&1 || true
  elif command -v x-www-browser >/dev/null 2>&1; then
    x-www-browser "http://127.0.0.1:3388" >/dev/null 2>&1 || true
  fi
) &

exec node localize.js "$@"
