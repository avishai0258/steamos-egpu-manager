#!/bin/bash
# eGPU Manager installer for SteamOS. Installs everything in your home folder (survives SteamOS updates). No root needed.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
D="$HOME/.local/share/egpu-auto"
U="$HOME/.config/systemd/user"
DROP="$HOME/.config/systemd/user.control/gamescope-session.service.d"

mkdir -p "$D/bin" "$U/gamescope-session.service.wants" "$DROP" "$HOME/.config/plasma-workspace/env" "$HOME/.local/share/applications"
rm -f "$D/egpu-lib.sh"   # from older versions
install -m755 "$SRC/core/egpu-ctl" "$SRC/core/egpu-gamescope-session" "$SRC/core/egpu-hotplug-watch" "$D/"
install -m755 "$SRC/core/bin/gamescope" "$D/bin/"
[ -f "$SRC/desktop/egpu-desktop" ] && install -m755 "$SRC/desktop/egpu-desktop" "$D/"
install -m755 "$SRC/uninstall.sh" "$D/"
"$D/egpu-ctl" version > "$D/VERSION"

[ -f "$HOME/.config/egpu-auto.conf" ] || cat > "$HOME/.config/egpu-auto.conf" <<'C'
# egpu-auto settings
# USE_EGPU=0: never use the eGPU in Game Mode
USE_EGPU=1
# AUTO_SWITCH=0: don't switch to the eGPU on plug-in; use the Switch button instead
AUTO_SWITCH=1
# SHADER_SWAP=1: keep a separate Steam shader cache per GPU (no re-compiling after switching)
SHADER_SWAP=1
# Seconds to wait for the eGPU at boot
WAIT_SECS=15
C

cat > "$DROP/50-egpu-auto.conf" <<'C'
# egpu-auto: run Game Mode through the eGPU-aware wrapper
[Service]
ExecStart=
ExecStart=%h/.local/share/egpu-auto/egpu-gamescope-session
TimeoutStartSec=30
C

cat > "$U/egpu-hotplug.service" <<'C'
[Unit]
Description=eGPU hotplug watcher for Game Mode
After=gamescope-session.service
PartOf=gamescope-session.service

[Service]
ExecStart=%h/.local/share/egpu-auto/egpu-hotplug-watch
Restart=on-failure
C
ln -sfn ../egpu-hotplug.service "$U/gamescope-session.service.wants/egpu-hotplug.service"

cat > "$HOME/.config/plasma-workspace/env/egpu-auto.sh" <<'C'
# egpu-auto: in Desktop Mode, render the desktop and games on the eGPU when it drives the monitor
# (avoids copying every frame over USB4), and swap in that GPU's shader cache.
_egpu_out=$("$HOME/.local/share/egpu-auto/egpu-ctl" desktop-env 2>/dev/null) || _egpu_out=""
case $_egpu_out in *[\`\$\;\&\|]*) _egpu_out="" ;; esac
eval "$_egpu_out"
unset _egpu_out
export MESA_SHADER_CACHE_MAX_SIZE="${MESA_SHADER_CACHE_MAX_SIZE:-10G}"
C

if [ -f "$SRC/desktop/egpu-manager.desktop" ]; then
  sed "s|@HOME@|$HOME|g" "$SRC/desktop/egpu-manager.desktop" > "$HOME/.local/share/applications/egpu-manager.desktop"
  if [ -d "$HOME/Desktop" ]; then
    install -m755 "$HOME/.local/share/applications/egpu-manager.desktop" "$HOME/Desktop/egpu-manager.desktop"
  fi
fi

systemctl --user daemon-reload 2>/dev/null || true
echo "eGPU Manager $(cat "$D/VERSION") installed."
