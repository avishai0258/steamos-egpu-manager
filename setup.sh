#!/bin/bash
# eGPU Manager - first-time setup for SteamOS (Legion Go S / Steam Deck / ROG Ally + e.g. AOOSTAR AG02 + AMD Radeon).
# Run once in Desktop Mode with the eGPU plugged in and powered on. It:
#   1. checks the whole chain (USB4 port -> dock -> cable speed -> GPU -> driver -> monitor)
#   2. approves the USB4 dock and installs the Decky plugin   (one password prompt)
#   3. installs the Game Mode integration and the Desktop Mode app (no root, home folder only)
cd "$(dirname "$(readlink -f "$0")")" || exit 1
CTL=./core/egpu-ctl
bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Where is the built Decky plugin? (inside the release zip it's this folder; in the git repo, decky/out)
PLUGIN=
if [ -f plugin.json ] && [ -f dist/index.js ]; then
  PLUGIN=$PWD
elif [ -f "decky/out/eGPU Manager/dist/index.js" ]; then
  PLUGIN="$PWD/decky/out/eGPU Manager"
elif command -v pnpm >/dev/null && [ -f decky/package.json ]; then
  (cd decky && pnpm install --silent && ./package.sh) && PLUGIN="$PWD/decky/out/eGPU Manager"
fi

bold "1/4  Checking your setup"
"$CTL" doctor
json=$("$CTL" doctor --json)

bold "2/4  Approving the dock and installing the Decky plugin"
if passwd -S "$USER" 2>/dev/null | grep -qE "^$USER (NP|L)"; then
  echo "Your user has no password yet. Set one first (needed for admin steps):  passwd"
  exit 1
fi
if [ -n "$PLUGIN" ] && [ -d "$HOME/homebrew/plugins" ]; then
  echo "You'll be asked for your password once."
  if pkexec "$PWD/core/egpu-ctl" _setup "$PLUGIN"; then
    echo "Decky plugin installed (open the Quick Access menu > Decky > eGPU Manager)."
  else
    echo "Admin step was cancelled or failed - the plugin was not installed."
  fi
else
  [ -d "$HOME/homebrew/plugins" ] || echo "Decky Loader is not installed - skipping the plugin (get it at https://decky.xyz and run this again)."
  [ -n "$PLUGIN" ] || echo "No built plugin found - skipping it (use the release zip, or install pnpm to build)."
  if grep -q '"fix": "authorize"' <<<"$json"; then
    echo "Approving the USB4 dock (asks for your password)..."
    "$CTL" authorize
  fi
fi
sleep 2
grep -q '"fix": "connect"' <<<"$json" && { "$CTL" connect || true; }

bold "3/4  Installing Game Mode integration + Desktop app"
./install.sh

bold "4/4  Result"
"$CTL" doctor
if grep -q '"fix": "reboot"' <<<"$("$CTL" doctor --json)"; then
  echo; echo "Reboot with the eGPU plugged in, then run this again."
  exit 1
fi
cat <<'T'

All set. Next steps:
  - Plug the monitor/TV into the graphics card, then switch to Game Mode: Big Picture opens on the eGPU.
  - Steam > Settings > Display > Resolution: pick your monitor's native resolution (e.g. 3840x2160).
  - Steam > Settings > Downloads > Shader Pre-Caching: on.
  - Before unplugging: eGPU Manager > Disconnect safely (Decky plugin, or the eGPU Manager app on the desktop).
T
