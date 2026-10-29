import "@fontsource/inter/latin-300.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import { FlowTimer } from "./timer";
import { render, renderHistory, renderTimeline, setupUI, refreshTodayRestShare, consumeLiveRestSec } from "./ui";
import { saveSession } from "./storage";
import { loadUnusedRestMs, saveUnusedRestMs, todayKey } from "./pool";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

// Restore the saved default ratio, plus today's unused-rest pool.
const storedRatio = parseFloat(localStorage.getItem("amble-default-ratio") || "");
const savedRatio = Number.isFinite(storedRatio) ? storedRatio : 0.2;
const timer = new FlowTimer(savedRatio, loadUnusedRestMs());

// Platform detection — mobile (iOS) has no titlebar / window controls / PiP
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
if (IS_MOBILE) {
  document.getElementById("titlebar")?.classList.add("hidden");
  const appEl = document.getElementById("app");
  appEl?.classList.remove("pt-10");
  appEl?.classList.add("safe-top");
}

// --- Mini overlay ---
let overlayWindow: WebviewWindow | null = null;

// --- Timer setup ---
setupUI(timer);

timer.onTick((snap) => {
  render(snap);

  // The overlay mirrors the hero number, which is always rest time.
  const totalSeconds = Math.floor(snap.displayMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  emit("timer-update", {
    minutes: String(m).padStart(2, "0"),
    seconds: String(s).padStart(2, "0"),
    state: snap.state,
    restPhase: snap.restPhase,
  });
});

timer.onSessionEnd((data) => {
  // Zero-jump handover: when the live share was on screen, store the exact
  // rest seconds it last displayed instead of the raw milliseconds, so the
  // idle readout recomputes to the same digits. (<1s from the true duration —
  // same order as the second-rounding storage applies anyway.)
  if (data.restStartTime > 0) {
    const liveRestSec = consumeLiveRestSec();
    if (liveRestSec !== null) data.restDurationMs = liveRestSec * 1000;
  } else {
    consumeLiveRestSec(); // clear any stale figure from an earlier session
  }

  // Bank the pool synchronously — losing the leftover rest is worse than
  // losing the history row — then persist the session best-effort and refresh
  // today's views once the write has actually landed.
  saveUnusedRestMs(data.unusedRestMs);
  void saveSession(data)
    .then(async () => {
      await renderTimeline();
      await renderHistory();
      await refreshTodayRestShare();
    })
    .catch((e) => console.error("Failed to save session:", e));
});

// The pool is a single-day allowance: clear it the moment the local date rolls
// over, even if the app has been left running overnight.
let currentDay = todayKey();
setInterval(() => {
  const day = todayKey();
  if (day === currentDay) return;
  currentDay = day;
  timer.clearUnusedRest();
  saveUnusedRestMs(0);
  void renderTimeline();
  void refreshTodayRestShare();
}, 60_000);

// Window controls (desktop only)
if (!IS_MOBILE) {
  document.getElementById("btn-minimize")?.addEventListener("click", () => getCurrentWindow().minimize());
  document.getElementById("btn-maximize")?.addEventListener("click", () => getCurrentWindow().toggleMaximize());
  document.getElementById("btn-close")?.addEventListener("click", () => getCurrentWindow().close());
}

// Overlay toggle button — PiP: just show the mini overlay (desktop only)
document.getElementById("btn-overlay")?.addEventListener("click", async () => {
  if (IS_MOBILE) return;
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
void refreshTodayRestShare();
