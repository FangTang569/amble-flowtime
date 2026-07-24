import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface OverlayUpdate {
  minutes: string;
  seconds: string;
}

const elMin = document.getElementById("mini-minutes")!;
const elSec = document.getElementById("mini-seconds")!;
const elColon = document.getElementById("mini-colon")!;

listen<OverlayUpdate>("timer-update", (event) => {
  const { minutes, seconds } = event.payload;
  elMin.textContent = minutes;
  elSec.textContent = seconds;
  elColon.classList.add("timer-colon");
  setTimeout(() => elColon.classList.remove("timer-colon"), 200);
});

listen("close-overlay", () => {
  getCurrentWindow().close();
});
