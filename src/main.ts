import { FlowTimer } from "./timer";
import { render, renderHistory, renderTimeline, setupUI } from "./ui";
import { saveSession } from "./storage";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

const timer = new FlowTimer(0.20);

// --- Mini overlay ---
let overlayWindow: WebviewWindow | null = null;

// --- Timer setup ---
setupUI(timer);

timer.onTick((snap) => {
  render(snap);

  const totalSeconds = Math.floor(
    (snap.state === "resting" ? snap.restRemainingMs : snap.workElapsedMs) / 1000
  );
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  emit("timer-update", {
    minutes: String(m).padStart(2, "0"),
    seconds: String(s).padStart(2, "0"),
  });
});

timer.onSessionEnd(async (data) => {
  await saveSession(data);
  await renderTimeline();
  await renderHistory();
});

// Window controls
document.getElementById("btn-minimize")?.addEventListener("click", () => getCurrentWindow().minimize());
document.getElementById("btn-maximize")?.addEventListener("click", () => getCurrentWindow().toggleMaximize());
document.getElementById("btn-close")?.addEventListener("click", () => getCurrentWindow().close());

// Overlay toggle button — PiP: just show the mini overlay
document.getElementById("btn-overlay")?.addEventListener("click", async () => {
  // Close stale if any
  const stale = await WebviewWindow.getByLabel("mini");
  if (stale) {
    try { await stale.close(); } catch { emit("close-overlay"); }
    await new Promise(r => setTimeout(r, 200));
    overlayWindow = null;
  }

  if (overlayWindow) {
    try { await overlayWindow.close(); } catch { emit("close-overlay"); }
    overlayWindow = null;
    return;
  }

  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  const size = await win.innerSize();
  const sf = await win.scaleFactor();
  const x = Math.round(pos.x / sf + size.width / sf + 12);

  overlayWindow = new WebviewWindow("mini", {
    url: "/mini.html",
    width: 180,
    height: 40,
    x,
    y: 12,
    decorations: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
  });

  overlayWindow.once("tauri://destroyed", () => {
    overlayWindow = null;
  });
});

// Startup: backup database
const today = new Date().toISOString().slice(0, 10);
invoke("backup_database", { dateStr: today }).catch(() => {});

render(timer.getSnapshot());
renderTimeline();
renderHistory();
