#!/bin/bash
# Builds out/eGPU-Manager.zip, installable from Decky: Settings -> Developer -> Install plugin from ZIP.
set -e
cd "$(dirname "$0")"
ROOT=..
pnpm build
rm -rf out && mkdir -p "out/eGPU Manager"
P="out/eGPU Manager"
cp plugin.json package.json main.py "$P/"
cp -r dist "$P/" && rm -f "$P"/dist/*.map
cp -r "$ROOT/core" "$ROOT/desktop" "$ROOT/install.sh" "$ROOT/uninstall.sh" "$ROOT/setup.sh" "$ROOT/First-time setup.desktop" "$ROOT/Uninstall.desktop" "$P/"
cp "$ROOT/LICENSE" "$ROOT/README.md" "$P/" 2>/dev/null || true
(cd out && zip -qr eGPU-Manager.zip "eGPU Manager")
echo "Built $(pwd)/out/eGPU-Manager.zip"
