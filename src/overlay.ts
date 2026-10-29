import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

interface OverlayUpdate {
  minutes: string;
  seconds: string;
  state: string;
  restPhase?: "earned" | "unused";
}

const elMin = document.getElementById("mini-minutes")!;
const elSec = document.getElementById("mini-seconds")!;
const elColon = document.getElementById("mini-colon")!;

let lastWidth = 0;

function adjustWidth(minLen: number) {
  // ~13px per digit at text-xl, + colon + minimal padding
  const newW = Math.round(minLen * 26 + 38);
  if (newW !== lastWidth) {
    lastWidth = newW;
    getCurrentWindow().setSize(new LogicalSize(newW, 40));
  }
}

// Update time display
listen<OverlayUpdate>("timer-update", (event) => {
  const { minutes, seconds, state, restPhase } = event.payload;
  elMin.textContent = minutes;
  elSec.textContent = seconds;
  elColon.classList.add("timer-colon");
  setTimeout(() => elColon.classList.remove("timer-colon"), 200);

  const resting = state === "resting";
  // Amber mirrors the main window: it means the unused-rest pool is being spent.
  const spendingPool = resting && restPhase === "unused";
  const digitColor = spendingPool
    ? "text-amber-500"
    : resting
      ? "text-emerald-500"
      : "text-neutral-800";
  const colonColor = spendingPool
    ? "text-amber-500"
    : resting
      ? "text-emerald-500"
      : "text-neutral-400";

  const COLORS = ["text-neutral-800", "text-emerald-500", "text-amber-500"];
  for (const el of [elMin, elSec]) {
    el.classList.remove(...COLORS);
    el.classList.add(digitColor);
  }
  elColon.classList.remove(...COLORS, "text-neutral-400");
  elColon.classList.add(colonColor);

  adjustWidth(minutes.length);
});

// Close overlay
listen("close-overlay", () => {
  getCurrentWindow().close();
});

document.getElementById("btn-close")?.addEventListener("click", () => {
  getCurrentWindow().close();
});
