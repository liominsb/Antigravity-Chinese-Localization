#!/bin/bash
# Antigravity 2.0 Chinese Localizer Service Startup Script for Linux

echo "======================================================="
echo "  Antigravity 2.0 Chinese Localizer Service"
echo "======================================================="
echo ""
echo "Starting localization backend service..."
echo "Opening dashboard in your default browser..."
echo ""

# Open dashboard in browser
if which xdg-open > /dev/null 2>&1; then
  xdg-open "http://localhost:3388" &
elif which gnome-open > /dev/null 2>&1; then
  gnome-open "http://localhost:3388" &
elif which x-www-browser > /dev/null 2>&1; then
  x-www-browser "http://localhost:3388" &
fi

# Start the node service
node localize.js

if [ $? -ne 0 ]; then
  echo ""
  echo "[ERROR] Failed to start the localization service."
  echo "Please make sure Node.js is installed on your system."
  echo "You can download it from https://nodejs.org"
  echo ""
  read -p "Press Enter to exit..."
fi
