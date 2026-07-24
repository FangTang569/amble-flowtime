import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

interface OverlayUpdate {
  minutes: string;
  seconds: string;
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
  const { minutes, seconds } = event.payload;
  elMin.textContent = minutes;
  elSec.textContent = seconds;
  elColon.classList.add("timer-colon");
  setTimeout(() => elColon.classList.remove("timer-colon"), 200);

  adjustWidth(minutes.length);
});

// Close overlay
listen("close-overlay", () => {
  getCurrentWindow().close();
});

document.getElementById("btn-close")?.addEventListener("click", () => {
  getCurrentWindow().close();
});
