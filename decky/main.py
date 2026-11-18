"""eGPU Manager - Decky backend. Runs as root (needed to safely remove / rescan the eGPU)."""
import asyncio
import glob
import json
import os

import decky

CORE = os.path.join(decky.DECKY_PLUGIN_DIR, "core")
CTL = os.path.join(CORE, "egpu-ctl")
INSTALLER = os.path.join(decky.DECKY_PLUGIN_DIR, "install.sh")


def _env():
    # Decky's bundled Python sets library paths that break system tools; start clean.
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "EGPU_USER": decky.DECKY_USER,
    }


async def _run(*args, timeout=120):
    proc = await asyncio.create_subprocess_exec(
        *args, env=_env(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        return 1, "", "timed out"
    if err:
        for line in err.decode(errors="replace").splitlines():
            decky.logger.info(line)
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def _ctl_json(*args):
    rc, out, err = await _run("/usr/bin/python3", "-I", CTL, *args, "--json")
    try:
        return json.loads(out)
    except ValueError:
        return {"ok": False, "message": (err or out).strip() or f"egpu-ctl failed ({rc})"}


# ---- built-in screen guard (root): gamescope on the eGPU never touches the handheld panel, and the
# kernel console keeps it lit (black). Brightness 0 is still lit on AMD, and forcing the connector off
# isn't enough, so while Game Mode runs on the eGPU we take DRM master on the iGPU card ourselves and
# switch its outputs off; nothing re-lights the panel while we hold it. Released as soon as Game Mode
# leaves the eGPU (the session script waits for EDP_FORCED to disappear before starting gamescope).
import ctypes
import fcntl
import struct

EDP_FORCED = "/run/egpu-manager-edp-off"
DRM_SET_MASTER, DRM_DROP_MASTER = 0x641E, 0x641F
DRM_GETRESOURCES, DRM_SETCRTC = 0xC04064A0, 0xC06864A2
_held = {"fd": None, "failed": False}


def _panel_card():
    for st in sorted(glob.glob("/sys/class/drm/card*-eDP-*/status")):
        return "/dev/dri/" + os.path.basename(os.path.dirname(st)).split("-", 1)[0]
    return None


def _crtcs(fd):
    res = bytearray(64)
    fcntl.ioctl(fd, DRM_GETRESOURCES, res)
    n = struct.unpack_from("<4I", res, 32)[1]
    if not n:
        return []
    cbuf = (ctypes.c_uint32 * n)()
    res = bytearray(64)
    struct.pack_into("<Q", res, 8, ctypes.addressof(cbuf))
    struct.pack_into("<I", res, 36, n)
    fcntl.ioctl(fd, DRM_GETRESOURCES, res)
    return list(cbuf)


def _panel_off():
    card = _panel_card()
    if not card:
        return
    fd = os.open(card, os.O_RDWR | os.O_CLOEXEC)
    try:
        fcntl.ioctl(fd, DRM_SET_MASTER)
        for c in _crtcs(fd):
            arg = bytearray(104)
            struct.pack_into("<I", arg, 12, c)   # crtc_id; no fb, no connectors, no mode -> off
            fcntl.ioctl(fd, DRM_SETCRTC, arg)
    except OSError:
        os.close(fd)
        raise
    _held["fd"] = fd


def _panel_release():
    fd, _held["fd"] = _held["fd"], None
    if fd is not None:
        try:
            fcntl.ioctl(fd, DRM_DROP_MASTER)
        except OSError:
            pass
        os.close(fd)


def _game_mode_on_egpu():
    try:
        uid = os.stat(decky.DECKY_USER_HOME).st_uid
        with open(f"/run/user/{uid}/egpu-auto.mode") as f:
            mode = f.read().strip()
    except OSError:
        return False
    if mode != "egpu":
        return False
    for c in glob.glob("/proc/[0-9]*/comm"):
        try:
            with open(c) as f:
                if f.read().strip() == "gamescope-wl" and os.stat(os.path.dirname(c)).st_uid == uid:
                    return True
        except OSError:
            pass
    return False


def _edp_apply(off):
    if not off:
        _held["failed"] = False
    if off == (_held["fd"] is not None) or (off and _held["failed"]):
        return
    if off:
        try:
            _panel_off()
        except OSError as e:
            decky.logger.info(f"built-in screen: could not switch off: {e}")
            _held["failed"] = True
            return
        open(EDP_FORCED, "w").close()
    else:
        _panel_release()
        try:
            os.remove(EDP_FORCED)
        except OSError:
            pass
    decky.logger.info("built-in screen " + ("off (Game Mode on eGPU)" if off else "released"))


def _cleanup_old():
    # 1.2.2 forced the connector off via sysfs; undo that if it's still in place
    if os.path.exists(EDP_FORCED):
        for f in glob.glob("/sys/class/drm/card*-eDP-*/status"):
            try:
                with open(f, "w") as fh:
                    fh.write("detect")
            except OSError:
                pass
        os.remove(EDP_FORCED)


async def _panel_guard():
    _cleanup_old()
    while True:
        try:
            _edp_apply(_game_mode_on_egpu())
        except Exception as e:  # never let the guard die
            decky.logger.info(f"panel guard error: {e}")
        await asyncio.sleep(1)


class Plugin:
    async def get_status(self):
        st = await _ctl_json("status")
        if "state" in st:
            rc, out, _ = await _run("/usr/bin/python3", "-I", CTL, "version")
            st["bundled_version"] = out.strip()
        return st

    async def connect(self):
        return await _ctl_json("connect")

    async def disconnect(self):
        # Game Mode restarts during this; the UI reconnects afterwards and polls status.
        return await _ctl_json("disconnect")

    async def restart_session(self):
        return await _ctl_json("restart")

    async def switch(self, target: str):
        if target not in ("egpu", "igpu"):
            return {"ok": False, "message": "invalid target"}
        return await _ctl_json("switch", target)

    async def set_option(self, key: str, enabled: bool):
        if key not in ("USE_EGPU", "AUTO_SWITCH", "SHADER_SWAP"):
            return {"ok": False, "message": "invalid option"}
        return await _ctl_json("set", key, "on" if enabled else "off")

    async def doctor(self):
        rc, out, err = await _run("/usr/bin/python3", "-I", CTL, "doctor", "--json")
        try:
            return json.loads(out)
        except ValueError:
            return [{"id": "error", "status": "fail", "label": "Check failed", "detail": (err or out)[-300:], "fix": None}]

    async def authorize(self):
        return await _ctl_json("authorize")

    async def shader_info(self):
        rc, out, err = await _run("/usr/bin/python3", "-I", CTL, "shader-info", "--json", timeout=60)
        try:
            return json.loads(out)
        except ValueError:
            return {"active": None, "enabled": False, "profiles": []}

    async def shader_games(self):
        rc, out, err = await _run("/usr/bin/python3", "-I", CTL, "shader-games", timeout=90)
        try:
            return json.loads(out)
        except ValueError:
            return {"active": None, "games": []}

    async def shader_delete(self, appid: str, profile: str):
        return await _ctl_json("shader-delete", str(appid), str(profile))

    async def _ctl_user(self, *args, timeout=60):
        # Runs egpu-ctl as the user: files in their home stay theirs, and their journal is readable.
        uid = os.stat(decky.DECKY_USER_HOME).st_uid
        rc, out, err = await _run(
            "runuser", "-u", decky.DECKY_USER, "--", "env", f"HOME={decky.DECKY_USER_HOME}",
            f"XDG_RUNTIME_DIR=/run/user/{uid}", "/usr/bin/python3", "-I", CTL, *args, "--json", timeout=timeout)
        try:
            return json.loads(out)
        except ValueError:
            return {"ok": False, "message": (err or out).strip()[-300:] or f"{args[0]} failed"}

    async def report(self, kind: str):
        if kind not in ("works", "problem"):
            return {"ok": False, "message": "invalid"}
        return await self._ctl_user("report", kind)

    async def fix_launch_loops(self):
        return await self._ctl_user("fix-launch-loops")

    async def update_check(self):
        return await _ctl_json("update-check")

    async def update(self):
        # Outside Decky's own service: installing the new plugin restarts Decky.
        rc, out, err = await _run("systemd-run", "--collect", "--quiet", "--unit", "egpu-manager-update",
                                  "/usr/bin/python3", "-I", CTL, "_update")
        if rc != 0:
            return {"ok": False, "message": (err or out).strip()[-300:] or "update failed to start"}
        return {"ok": True, "message": "Updating... Decky restarts in a few seconds."}

    async def set_auto(self, enabled: bool):
        return await _ctl_json("auto", "on" if enabled else "off")

    async def install_integration(self):
        user = decky.DECKY_USER
        home = decky.DECKY_USER_HOME
        rc, out, err = await _run(
            "runuser", "-u", user, "--", "env", f"HOME={home}",
            f"XDG_RUNTIME_DIR=/run/user/{os.stat(home).st_uid}",
            f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{os.stat(home).st_uid}/bus",
            "/bin/bash", INSTALLER)
        if rc != 0:
            return {"ok": False, "message": (err or out).strip()[-300:]}
        return {"ok": True, "message": "Installed (Game Mode + Desktop app). Takes effect the next time Game Mode starts."}

    async def reboot(self):
        await _run("systemctl", "reboot")

    async def _main(self):
        decky.logger.info("eGPU Manager loaded")
        self._guard = asyncio.get_event_loop().create_task(_panel_guard())
        # Keep the Game Mode + Desktop integration in step with the plugin version (only if already installed).
        st = await _ctl_json("status")
        rc, out, _ = await _run("/usr/bin/python3", "-I", CTL, "version")
        if st.get("integration") and st.get("installed_version") != out.strip():
            r = await self.install_integration()
            decky.logger.info(f"integration auto-update: {r}")

    async def _unload(self):
        if getattr(self, "_guard", None):
            self._guard.cancel()
        _edp_apply(False)
