# Reddit / group post (English)

**Title:** eGPU Manager: plug-and-play eGPU for SteamOS handhelds (free Decky plugin + desktop app)

---

Using an eGPU on a SteamOS handheld always meant fiddling: Game Mode stays on the iGPU, shaders re-process every time you switch, the handheld screen stays lit black, and pulling the cable can freeze the driver until a reboot.

So I built **eGPU Manager**, a free, open-source Decky plugin + Desktop app:

- **Auto switch:** plug the eGPU in → Game Mode restarts on it, on your TV/monitor. Unplug → back on the handheld. (Or turn auto off and use a Switch button.)
- **Shaders per GPU:** each GPU keeps its own shader cache, so switching doesn't trigger "Processing Vulkan shaders" again. A Shaders page shows every game's size per GPU, and you can delete per GPU.
- **Handheld screen turns off** while you play on the eGPU.
- **Disconnect safely** button: releases the card first, so unplugging never freezes amdgpu.
- **Smooth Desktop Mode:** KDE renders on the eGPU too (no frames copied over USB4).
- **Status + Check setup:** dock chip, USB4 speed, PCIe link, monitor, and fixes it can apply (like approving the dock).
- **One-click install, one-click uninstall.** Everything lives in your home folder, so it survives SteamOS updates and never touches the system partition. Uninstall restores stock.

**Tested on:** Legion Go S (Z1 Extreme) · SteamOS 3.9.5 · RX 9060 XT · AOOSTAR AG02 (USB4 40 Gb/s).
That's the only setup I've tested so far. If you try it on other hardware (Steam Deck, ROG Ally, other docks or cards), there's an **"It works: share my hardware"** button in the plugin. It pre-fills a GitHub report (no serials) so I can add your setup to the compatibility list. **Report a problem** does the same, with a log.

AMD cards only (NVIDIA isn't supported on SteamOS).

GitHub + download: https://github.com/avishai0258/steamos-egpu-manager

Feedback welcome!
