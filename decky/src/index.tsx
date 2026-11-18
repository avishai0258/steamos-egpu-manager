import { callable, definePlugin, toaster } from "@decky/api";
import {
  ButtonItem,
  ConfirmModal,
  DialogButton,
  Field,
  Focusable,
  ModalRoot,
  Navigation,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  showModal,
  staticClasses,
} from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { BsGpuCard } from "react-icons/bs";

type Status = {
  state: "connected" | "removed" | "absent" | "stuck" | "no_driver";
  gpu: { name: string; slot: string; id: string; driver: string | null; link: string | null } | null;
  interface: { type: string; label: string; device: string | null; gbps: number | null } | null;
  monitors: { connector: string; name: string }[];
  session: "game" | "desktop" | "none";
  session_gpu: "egpu" | "igpu" | null;
  want: "egpu" | "igpu";
  choice: "egpu" | "igpu" | null;
  auto: boolean;
  auto_switch: boolean;
  shader_swap: boolean;
  shader_profile: string | null;
  integration: boolean;
  installed_version: string | null;
  bundled_version?: string;
  busy: string | null;
  message?: string;
};
type Result = { ok: boolean; message: string };
type Check = { id: string; status: "ok" | "warn" | "fail" | "info"; label: string; detail: string; fix: string | null };
type ShaderGames = { active: string | null; games: { appid: string; name: string; sizes: Record<string, number> }[] };
type Page = "main" | "shaders" | "settings";

const getStatus = callable<[], Status>("get_status");
const doConnect = callable<[], Result>("connect");
const doDisconnect = callable<[], Result>("disconnect");
const doSwitch = callable<[string], Result>("switch");
const restartSession = callable<[], Result>("restart_session");
const setOption = callable<[string, boolean], Result>("set_option");
const installIntegration = callable<[], Result>("install_integration");
const runDoctor = callable<[], Check[]>("doctor");
const authorize = callable<[], Result>("authorize");
const reboot = callable<[], void>("reboot");
const shaderGames = callable<[], ShaderGames>("shader_games");
const shaderDelete = callable<[string, string], Result>("shader_delete");
type Report = { ok: boolean; url?: string; file?: string; message?: string };
const makeReport = callable<[string], Report>("report");
type UpdateInfo = { ok: boolean; current?: string; latest?: string; available?: boolean; message?: string };
const updateCheck = callable<[], UpdateInfo>("update_check");
const doUpdate = callable<[], Result>("update");
const fixLaunchLoops = callable<[], Result>("fix_launch_loops");

let lastPage: Page = "main"; // reopen the panel on the page you left

const STATE_LABEL: Record<Status["state"], string> = {
  connected: "Connected",
  removed: "Safe to unplug",
  absent: "Not detected",
  stuck: "Reboot required",
  no_driver: "No driver loaded",
};
const ICON: Record<Check["status"], string> = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };

const fmtBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${(b / 1e3).toFixed(0)} KB`;

function Content() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [page, setPage] = useState<Page>(lastPage);
  const go = (p: Page) => {
    lastPage = p;
    setPage(p);
  };
  const alive = useRef(true);

  const refresh = async () => {
    try {
      const s = await getStatus();
      if (alive.current) setSt(s);
    } catch (e) {
      if (alive.current) setMsg(String(e));
    }
  };

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, 2000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, []);

  // Quietly look for a new release when the Settings page opens (once per panel open)
  useEffect(() => {
    if (page === "settings" && !upd) {
      updateCheck()
        .then((u) => alive.current && setUpd(u))
        .catch(() => {});
    }
  }, [page]);

  const run = async (label: string, fn: () => Promise<Result>) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      if (alive.current) setMsg(r.message);
      toaster.toast({ title: "eGPU Manager", body: r.message });
    } catch (e) {
      if (alive.current) setMsg(String(e));
    } finally {
      if (alive.current) setBusy(null);
      refresh();
    }
  };

  const check = async () => {
    setBusy("Checking");
    try {
      const c = await runDoctor();
      if (alive.current) setChecks(c);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const checkUpdate = async () => {
    setBusy("Checking for updates");
    try {
      const u = await updateCheck();
      if (alive.current) setUpd(u);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const update = async () => {
    setBusy("Updating");
    const r = await doUpdate();
    toaster.toast({ title: "eGPU Manager", body: r.message });
    if (!r.ok && alive.current) setBusy(null);
  };

  const share = async (kind: "works" | "problem") => {
    setBusy(kind);
    try {
      const r = await makeReport(kind);
      if (r.ok && r.url) {
        toaster.toast({ title: "eGPU Manager", body: `Report saved to ${r.file}` });
        Navigation.NavigateToExternalWeb(r.url);
      } else {
        toaster.toast({ title: "eGPU Manager", body: r.message ?? "Could not create the report" });
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const fixAction = async (fix: string) => {
    if (fix === "install") await run("Installing", installIntegration);
    else if (fix === "authorize") await run("Approving dock", authorize);
    else if (fix === "connect") await run("Connecting", doConnect);
    else if (fix === "reboot") await reboot();
    else if (fix === "launchloop") {
      await run("Fixing", fixLaunchLoops);
      check();
    }
    check();
  };

  if (!st) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <Field label="Loading..." />
        </PanelSectionRow>
      </PanelSection>
    );
  }
  if (!("state" in st)) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <Field label="Error" description={(st as { message?: string }).message ?? "Backend error"} />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const working = busy ?? (st.busy ? `${st.busy}...` : null);
  const outdated = st.integration && st.bundled_version && st.installed_version !== st.bundled_version;
  const mons = st.monitors.map((m) => `${m.name} (${m.connector})`).join(", ");
  const inGame = st.session === "game";
  const onEgpu = st.session_gpu === "egpu";
  const usable = st.state === "connected" && st.monitors.length > 0;

  const nav = (
    <PanelSection>
      <Focusable style={{ display: "flex", gap: "4px" }} flow-children="horizontal">
        {(["main", "shaders", "settings"] as Page[]).map((p) => (
          <DialogButton
            key={p}
            style={{ minWidth: 0, flex: 1, padding: "6px 4px", fontSize: "12px", opacity: page === p ? 1 : 0.55 }}
            onClick={() => go(p)}
          >
            {{ main: "Main", shaders: "Shaders", settings: "Settings" }[p]}
          </DialogButton>
        ))}
      </Focusable>
    </PanelSection>
  );

  if (page === "shaders") {
    return (
      <>
        {nav}
        <ShadersPage />
      </>
    );
  }
  if (page === "settings") {
    return (
      <>
        {nav}
        <PanelSection title="Settings">
          <PanelSectionRow>
            <ToggleField
              label="Use eGPU in Game Mode"
              checked={st.auto}
              disabled={!!working}
              onChange={(v) => run("Saving", () => setOption("USE_EGPU", v))}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label="Switch automatically when plugged in"
              description="Off: plugging in only shows the Switch button"
              checked={st.auto_switch}
              disabled={!!working || !st.auto}
              onChange={(v) => run("Saving", () => setOption("AUTO_SWITCH", v))}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label="Separate shader cache per GPU"
              description="Each GPU keeps its own compiled shaders, so switching doesn't rebuild them"
              checked={st.shader_swap}
              disabled={!!working}
              onChange={(v) => run("Saving", () => setOption("SHADER_SWAP", v))}
            />
          </PanelSectionRow>
        </PanelSection>

        <PanelSection title="Updates">
          <PanelSectionRow>
            {upd?.available ? (
              <ButtonItem
                layout="below"
                disabled={!!working}
                description={`You have ${upd.current}. Downloads the new version from GitHub and restarts Decky.`}
                onClick={update}
              >
                {busy === "Updating" ? "Updating..." : `Update to ${upd.latest}`}
              </ButtonItem>
            ) : (
              <ButtonItem
                layout="below"
                disabled={!!working}
                description={upd ? (upd.ok ? `Version ${upd.current} is the latest.` : upd.message) : "Checks GitHub for a newer version."}
                onClick={checkUpdate}
              >
                {busy === "Checking for updates" ? "Checking..." : "Check for updates"}
              </ButtonItem>
            )}
          </PanelSectionRow>
        </PanelSection>

        <PanelSection title="Share your result">
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              disabled={!!working}
              description="Opens a GitHub post with your handheld, eGPU, dock and a short log (no serial numbers). You review it before posting."
              onClick={() => share("works")}
            >
              {busy === "works" ? "Preparing..." : "It works: share my hardware"}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={!!working} onClick={() => share("problem")}>
              {busy === "problem" ? "Preparing..." : "Report a problem"}
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>

        <PanelSection title="Setup">
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={!!working} description="Checks port, dock, cable speed, GPU, driver and monitor, and fixes what it can." onClick={check}>
              {busy === "Checking" ? "Checking..." : "Check setup"}
            </ButtonItem>
          </PanelSectionRow>
          {checks?.map((c, i) => (
            <PanelSectionRow key={`${c.id}-${i}`}>
              {c.fix ? (
                <ButtonItem layout="below" disabled={!!working} description={`${ICON[c.status]} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`} onClick={() => fixAction(c.fix!)}>
                  {{ install: "Install", authorize: "Approve dock", connect: "Connect", reboot: "Reboot", launchloop: "Fix games" }[c.fix] ?? "Fix"}
                </ButtonItem>
              ) : (
                <Field description={c.detail || undefined} label={`${ICON[c.status]} ${c.label}`} />
              )}
            </PanelSectionRow>
          ))}
        </PanelSection>
      </>
    );
  }
  return (
    <>
      {nav}
      <PanelSection title="Status">
        <PanelSectionRow>
          <Field label="eGPU" description={st.gpu?.name ?? "—"}>
            {STATE_LABEL[st.state]}
          </Field>
        </PanelSectionRow>
        {st.interface && (
          <PanelSectionRow>
            <Field label="Interface" description={st.interface.device ?? undefined}>
              {st.interface.label}
            </Field>
          </PanelSectionRow>
        )}
        {st.gpu?.link && (
          <PanelSectionRow>
            <Field label="PCIe link">{st.gpu.link}</Field>
          </PanelSectionRow>
        )}
        {st.state === "connected" && (
          <PanelSectionRow>
            <Field label="Monitor" description={mons || "Plug the monitor into the graphics card to use it in Game Mode"}>
              {st.monitors.length ? "Connected" : "None"}
            </Field>
          </PanelSectionRow>
        )}
        {inGame && (
          <PanelSectionRow>
            <Field label="Game Mode runs on">{onEgpu ? "eGPU" : "Built-in GPU"}</Field>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Actions">
        {st.state === "stuck" && (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              description="The eGPU was unplugged while in use. Linux can't reattach it until you restart. Plug it in, then reboot."
              onClick={() => reboot()}
            >
              Reboot now
            </ButtonItem>
          </PanelSectionRow>
        )}
        {inGame && usable && (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              disabled={!!working}
              description={
                onEgpu
                  ? "Play on the handheld screen with the eGPU still plugged in."
                  : "Move Big Picture and games to the eGPU and its monitor."
              }
              onClick={() => run("Switching", () => doSwitch(onEgpu ? "igpu" : "egpu"))}
            >
              {working ?? (onEgpu ? "Switch to handheld screen" : "Switch to eGPU")}
            </ButtonItem>
          </PanelSectionRow>
        )}
        {st.state === "connected" ? (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              disabled={!!working}
              description="Use this before unplugging the cable."
              onClick={() => run("Disconnecting", doDisconnect)}
            >
              {working ?? "Disconnect safely"}
            </ButtonItem>
          </PanelSectionRow>
        ) : (
          st.state !== "stuck" && (
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                disabled={!!working}
                description={st.state === "removed" ? "Unplug now, or reconnect without unplugging." : "Plug in and power on the eGPU first."}
                onClick={() => run("Connecting", doConnect)}
              >
                {working ?? "Connect"}
              </ButtonItem>
            </PanelSectionRow>
          )
        )}
        {inGame && st.state === "connected" && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={!!working} onClick={() => run("Restarting", restartSession)}>
              Restart Game Mode
            </ButtonItem>
          </PanelSectionRow>
        )}
        {msg && (
          <PanelSectionRow>
            <Field description={msg} />
          </PanelSectionRow>
        )}
      </PanelSection>

      {(!st.integration || outdated) && (
        <PanelSection title="Setup">
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              disabled={!!working}
              description={
                st.integration
                  ? `Update (${st.installed_version ?? "old"} → ${st.bundled_version}).`
                  : "Required once: lets Game Mode use the eGPU and adds the eGPU Manager app to Desktop Mode. Installs in your home folder only."
              }
              onClick={() => run("Installing", installIntegration)}
            >
              {st.integration ? "Update integration" : "Install (Game Mode + Desktop app)"}
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
}

// Shaders from before setup were built on the handheld first; they count as iGPU. eGPU shaders are
// only claimed once a game has actually run on the eGPU.
function gpuSizes(sizes: Record<string, number>) {
  return {
    igpu: sizes.igpu || sizes.legacy || 0,
    egpu: Object.entries(sizes).filter(([p, b]) => p.startsWith("egpu-") && b > 0),
  };
}

function gpuLine(sizes: Record<string, number>) {
  const sz = gpuSizes(sizes);
  const e = sz.egpu.reduce((a, [, b]) => a + b, 0);
  return `iGPU: ${sz.igpu ? fmtBytes(sz.igpu) : "N/A yet"} · eGPU: ${e ? fmtBytes(e) : "N/A yet"}`;
}

function ChooseModal(props: {
  title: string;
  opts: { label: string; profile: string; bytes: number }[];
  onPick: (o: { label: string; profile: string; bytes: number }) => void;
  closeModal?: () => void;
}) {
  return (
    <ModalRoot onCancel={props.closeModal} onEscKeypress={props.closeModal}>
      <div style={{ fontSize: "1.2em", fontWeight: "bold", marginBottom: "12px" }}>{props.title}</div>
      <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {props.opts.map((o) => (
          <DialogButton
            key={o.label}
            onClick={() => {
              props.closeModal?.();
              props.onPick(o);
            }}
          >
            {`${o.label} (${fmtBytes(o.bytes)})`}
          </DialogButton>
        ))}
        <DialogButton onClick={() => props.closeModal?.()}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
}

function ShadersPage() {
  const [data, setData] = useState<ShaderGames | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const load = () =>
    shaderGames()
      .then((d) => alive.current && setData(d))
      .catch((e) => alive.current && setMsg(String(e)));
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, []);

  const del = async (appid: string, profile: string) => {
    setBusy(true);
    try {
      const r = await shaderDelete(appid, profile);
      toaster.toast({ title: "eGPU Manager", body: r.message });
      if (alive.current) setMsg(r.message);
    } finally {
      if (alive.current) setBusy(false);
      load();
    }
  };

  const ask = (g: ShaderGames["games"][number]) => {
    const sz = gpuSizes(g.sizes);
    const opts: { label: string; profile: string; bytes: number }[] = [];
    if (sz.igpu) opts.push({ label: "iGPU", profile: "igpu+legacy", bytes: sz.igpu });
    sz.egpu.forEach(([p, b]) => opts.push({ label: "eGPU", profile: p, bytes: b }));
    if (opts.length > 1) opts.push({ label: "Both", profile: "all", bytes: opts.reduce((a, o) => a + o.bytes, 0) });
    const confirm = (o: (typeof opts)[number]) =>
      showModal(
        <ConfirmModal
          strTitle={`Delete ${o.label === "Both" ? "iGPU + eGPU" : o.label} shaders?`}
          strDescription={`${g.name}: ${fmtBytes(o.bytes)} will be deleted. Steam rebuilds them the next time you play (the first minutes may stutter).`}
          bDestructiveWarning
          strOKButtonText="Delete"
          onOK={() => del(g.appid, o.profile)}
        />,
      );
    if (opts.length === 1) {
      confirm(opts[0]);
      return;
    }
    showModal(<ChooseModal title={`Which shaders to delete? ${g.name}`} opts={opts} onPick={confirm} />);
  };

  if (!data) {
    return (
      <PanelSection title="Shaders">
        <PanelSectionRow>
          <Field label={msg ?? "Measuring shader caches..."} />
        </PanelSectionRow>
      </PanelSection>
    );
  }
  const totals: Record<string, number> = {};
  data.games.forEach((g) => {
    const sz = gpuSizes(g.sizes);
    if (sz.igpu) totals.igpu = (totals.igpu ?? 0) + sz.igpu;
    sz.egpu.forEach(([, b]) => (totals.egpu = (totals.egpu ?? 0) + b));
  });
  return (
    <PanelSection title="Shaders per game">
      <PanelSectionRow>
        <Field
          label="Total"
          description={
            Object.entries(totals)
              .map(([p, b]) => `${p === "igpu" ? "iGPU" : "eGPU"}: ${fmtBytes(b)}`)
              .join(" · ") || "No shaders yet"
          }
        />
      </PanelSectionRow>
      {msg && (
        <PanelSectionRow>
          <Field description={msg} />
        </PanelSectionRow>
      )}
      {data.games
        .filter((g) => Object.values(g.sizes).some((b) => b > 0))
        .map((g) => (
          <PanelSectionRow key={g.appid}>
            <ButtonItem
              layout="below"
              disabled={busy}
              label={g.name}
              description={gpuLine(g.sizes)}
              onClick={() => ask(g)}
            >
              Delete...
            </ButtonItem>
          </PanelSectionRow>
        ))}
    </PanelSection>
  );
}

export default definePlugin(() => ({
  name: "eGPU Manager",
  titleView: <div className={staticClasses.Title}>eGPU Manager</div>,
  content: <Content />,
  icon: <BsGpuCard />,
  onDismount() {},
}));
