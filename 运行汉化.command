#!/bin/bash
cd "$(dirname "$0")"
open "http://localhost:3388" >/dev/null 2>&1 || true
node localize-macos.js
