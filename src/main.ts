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

export async function toggleOverlay(): Promise<boolean> {
  try {
    if (overlayWindow) {
      // Dual-path: try direct close + event fallback
      try { await overlayWindow.close(); } catch { emit("close-overlay"); }
      overlayWindow = null;
      return false;
    }

    // Ensure no stale window with same label
    const stale = await WebviewWindow.getByLabel("mini");
    if (stale) {
      try { await stale.close(); } catch { emit("close-overlay"); }
      await new Promise(r => setTimeout(r, 200));
    }

    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const size = await win.innerSize();
    const sf = await win.scaleFactor();
    const x = Math.round(pos.x / sf + size.width / sf + 12);

    overlayWindow = new WebviewWindow("mini", {
      url: "/mini.html",
      width: 170,
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
      updateOverlayButton(false);
    });

    return true;
  } catch (e) {
    console.error("toggleOverlay error:", e);
    return false;
  }
}

function updateOverlayButton(visible: boolean) {
  const btn = document.getElementById("btn-overlay");
  if (!btn) return;
  btn.textContent = visible ? "Hide Overlay" : "Show Overlay";
  if (visible) {
    btn.className = "text-accent text-xs transition-colors cursor-pointer mt-1 font-medium";
  } else {
    btn.className = "text-neutral-400 hover:text-accent text-xs transition-colors cursor-pointer mt-1";
  }
}

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

// Overlay toggle button
document.getElementById("btn-overlay")?.addEventListener("click", async () => {
  const visible = await toggleOverlay();
  updateOverlayButton(visible);
});

// Startup: backup database
const today = new Date().toISOString().slice(0, 10);
invoke("backup_database", { dateStr: today }).catch(() => {});

render(timer.getSnapshot());
renderTimeline();
renderHistory();
