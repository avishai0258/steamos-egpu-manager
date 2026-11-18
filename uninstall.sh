#!/bin/bash
# Removes everything eGPU Manager changed and puts SteamOS back to stock:
#  - Steam's shader cache goes back to the normal folder (the current GPU's shaders are kept)
#  - Game Mode / Desktop Mode integration, the Desktop app and the Decky plugin are removed
#  - the built-in screen's brightness is restored
# Usage: ./uninstall.sh [--purge]
#   --purge  also deletes the other GPU's saved shader copies and the settings file
D="$HOME/.local/share/egpu-auto"
CTL="$D/egpu-ctl"
[ -x "$CTL" ] || CTL="$(cd "$(dirname "$0")" && pwd)/core/egpu-ctl"
PURGE=0; [ "$1" = --purge ] && PURGE=1
uid=$(id -u)

if pgrep -u "$uid" -x steam >/dev/null; then
  echo "Closing Steam (needed to restore its shader cache)..."
  (steam -shutdown >/dev/null 2>&1 &)
  for _ in $(seq 60); do pgrep -u "$uid" -x steam >/dev/null || break; sleep 1; done
fi
if [ -x "$CTL" ]; then
  "$CTL" backlight restore >/dev/null 2>&1
  if ! "$CTL" shader-restore; then
    echo "WARNING: Steam is still running, so the shader cache was not restored."
    echo "         Exit Steam and run this again."
    exit 1
  fi
fi

# Other GPUs' shader copies (shadercache.<gpu> next to each library's shadercache)
for lib in "$HOME/.local/share/Steam" $(grep -o '"path"[[:space:]]*"[^"]*"' "$HOME/.local/share/Steam/steamapps/libraryfolders.vdf" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/'); do
  for c in "$lib"/steamapps/shadercache.*; do
    [ -d "$c" ] || continue
    if [ $PURGE = 1 ]; then rm -rf "$c" && echo "Deleted $c"
    else echo "Kept $c ($(du -sh "$c" 2>/dev/null | cut -f1)). Delete it to free the space."; fi
  done
done

# Decky plugin (root-owned folder: one password prompt)
if [ -d "$HOME/homebrew/plugins/eGPU Manager" ] && [ -x "$CTL" ]; then
  echo "Removing the Decky plugin (asks for your password)..."
  pkexec "$CTL" _uninstall-plugin || echo "WARNING: Decky plugin not removed. Delete it from Decky's settings."
fi

systemctl --user stop egpu-hotplug.service 2>/dev/null
rm -f "$HOME/.config/systemd/user.control/gamescope-session.service.d/50-egpu-auto.conf" \
      "$HOME/.config/systemd/user/egpu-hotplug.service" \
      "$HOME/.config/systemd/user/gamescope-session.service.wants/egpu-hotplug.service" \
      "$HOME/.config/plasma-workspace/env/egpu-auto.sh" \
      "$HOME/.local/share/applications/egpu-manager.desktop" "$HOME/Desktop/egpu-manager.desktop" \
      "$HOME/egpu-manager-report.md"
rm -rf "$D"
systemctl --user daemon-reload 2>/dev/null || true
if [ $PURGE = 1 ]; then rm -f "$HOME/.config/egpu-auto.conf"; fi

echo
echo "eGPU Manager removed. Game Mode and Desktop Mode are back to stock from their next start."
[ $PURGE = 1 ] || echo "Settings kept in ~/.config/egpu-auto.conf (delete it if you won't reinstall)."
echo "The USB4 dock stays approved in SteamOS (harmless; remove with: boltctl forget <uuid>)."
