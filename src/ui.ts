import type { FlowTimer } from "./timer";
import type { TimerSnapshot } from "./types";
import { getTodayBlocks, formatDuration, formatTimestamp } from "./storage";

// --- DOM references (set once on init) ---
let elMinutes: HTMLElement;
let elSeconds: HTMLElement;
let elColon: HTMLElement;
let elStateLabel: HTMLElement;
let elTimerContainer: HTMLElement;
let elRatioDisplay: HTMLElement;
let elRatioSlider: HTMLInputElement;
let elRestPreview: HTMLElement;
let elPreviewWork: HTMLElement;
let elPreviewRest: HTMLElement;
let elBtnStart: HTMLElement;
let elBtnPause: HTMLElement;
let elBtnResume: HTMLElement;
let elBtnRest: HTMLElement;
let elBtnStop: HTMLElement;

// --- Helpers ---

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMinutes(ms: number): { minutes: string; seconds: string } {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return {
    minutes: String(m).padStart(2, "0"),
    seconds: String(s).padStart(2, "0"),
  };
}

function formatRatio(ratio: number): string {
  const pct = Math.round(ratio * 100);
  const workParts = Math.round(1 / ratio);
  return `${pct}% (work ${workParts}:1)`;
}

// --- Render ---

export function render(snap: TimerSnapshot): void {
  // State label
  if (snap.state === "resting") {
    elStateLabel.textContent = "Resting…";
    elStateLabel.classList.remove("hidden");
  } else {
    elStateLabel.classList.add("hidden");
  }

  // Timer display
  const timeMs =
    snap.state === "resting"
      ? snap.restRemainingMs
      : snap.workElapsedMs;

  const { minutes, seconds } = formatMinutes(timeMs);
  elMinutes.textContent = minutes;
  elSeconds.textContent = seconds;

  // Colon pulse animation
  if (snap.state === "running") {
    elTimerContainer.classList.add("timer-running");
  } else {
    elTimerContainer.classList.remove("timer-running");
  }

  // Ratio display
  elRatioDisplay.textContent = formatRatio(snap.ratio);

  // Ratio slider (sync if changed externally)
  const sliderVal = Math.round(snap.ratio * 100);
  if (parseInt(elRatioSlider.value) !== sliderVal) {
    elRatioSlider.value = String(sliderVal);
  }

  // Rest preview panel
  if (snap.state === "paused") {
    elPreviewWork.textContent = formatTime(snap.workElapsedMs);
    elPreviewRest.textContent = formatTime(snap.restTargetMs);
    elRestPreview.classList.remove("hidden");
  } else {
    elRestPreview.classList.add("hidden");
  }

  // Button visibility
  setVisible(elBtnStart, snap.state === "idle");
  setVisible(elBtnPause, snap.state === "running");
  setVisible(elBtnResume, snap.state === "paused");
  setVisible(elBtnRest, snap.state === "paused");
  setVisible(elBtnStop, snap.state === "running" || snap.state === "paused" || snap.state === "resting");
}

function setVisible(el: HTMLElement, visible: boolean): void {
  if (visible) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// --- Setup ---

export function setupUI(timer: FlowTimer): void {
  // Cache DOM references
  elMinutes = document.getElementById("timer-minutes")!;
  elSeconds = document.getElementById("timer-seconds")!;
  elColon = document.getElementById("timer-colon")!;
  elStateLabel = document.getElementById("state-label")!;
  elTimerContainer = document.getElementById("timer-container")!;
  elRatioDisplay = document.getElementById("ratio-display")!;
  elRatioSlider = document.getElementById("ratio-slider") as HTMLInputElement;
  elRestPreview = document.getElementById("rest-preview")!;
  elPreviewWork = document.getElementById("preview-work-time")!;
  elPreviewRest = document.getElementById("preview-rest-time")!;
  elBtnStart = document.getElementById("btn-start")!;
  elBtnPause = document.getElementById("btn-pause")!;
  elBtnResume = document.getElementById("btn-resume")!;
  elBtnRest = document.getElementById("btn-rest")!;
  elBtnStop = document.getElementById("btn-stop")!;

  // Wire events
  elBtnStart.addEventListener("click", () => timer.start());
  elBtnPause.addEventListener("click", () => timer.pause());
  elBtnResume.addEventListener("click", () => timer.resume());
  elBtnRest.addEventListener("click", () => timer.startRest());
  elBtnStop.addEventListener("click", () => timer.stop());
  elRatioSlider.addEventListener("input", () => {
    timer.setRatio(parseInt(elRatioSlider.value) / 100);
  });

  // Timeline scale toggle
  document.getElementById("timeline-scale")?.addEventListener("click", () => {
    rowScaleIdx = (rowScaleIdx + 1) % ROW_SCALES.length;
    renderTimeline();
  });
}

// --- History ---

export async function renderHistory(): Promise<void> {
  const el = document.getElementById("history-list");
  if (!el) return;
  const elEmpty = document.getElementById("history-empty");
  const elSection = document.getElementById("history-section");

  const blocks = await getTodayBlocks();

  if (blocks.length === 0) {
    el.classList.add("hidden");
    if (elEmpty) elEmpty.classList.remove("hidden");
    return;
  }

  if (elEmpty) elEmpty.classList.add("hidden");
  if (elSection) elSection.classList.remove("hidden");
  el.classList.remove("hidden");

  // Total
  const totalSec = blocks.reduce((sum, b) => sum + b.duration, 0);
  const elStats = document.getElementById("history-stats");
  if (elStats) {
    elStats.textContent = formatDuration(totalSec);
  }

  el.innerHTML = blocks.map((b) => {
    const isWork = b.block_type === "work";
    const dot = isWork
      ? '<span class="w-2 h-2 rounded-full bg-accent"></span>'
      : '<span class="w-2 h-2 rounded-full bg-amber-400"></span>';
    const label = isWork ? "Focus" : "Break";
    const time = formatTimestamp(b.start_time);

    return `
    <div class="flex items-center justify-between py-2 border-b border-neutral-100 last:border-0">
      <div class="flex items-center gap-2">
        ${dot}
        <span class="text-neutral-700 text-sm">${label}</span>
        <span class="text-neutral-400 text-xs">${time}</span>
      </div>
      <span class="text-neutral-500 text-xs font-mono tabular-nums">${formatDuration(b.duration)}</span>
    </div>
  `;
  }).join("");
}

// --- Timeline ---

const ROW_SCALES = [
  { label: "30m", sec: 1800 },
  { label: "1h", sec: 3600 },
  { label: "2h", sec: 7200 },
];
let rowScaleIdx = 2; // default: 2h

function currentRowSec(): number {
  return ROW_SCALES[rowScaleIdx].sec;
}

interface BarSegment {
  block_type: "work" | "rest";
  duration: number;
  continues: boolean; // this chunk is part of a split block
}

export async function renderTimeline(): Promise<void> {
  const elSection = document.getElementById("timeline-section");
  const elRows = document.getElementById("timeline-rows");
  const elLabels = document.getElementById("timeline-labels");
  if (!elSection || !elRows || !elLabels) return;

  const blocks = await getTodayBlocks();

  if (blocks.length === 0) {
    elSection.classList.add("hidden");
    return;
  }

  elSection.classList.remove("hidden");

  const rowSec = currentRowSec();
  const firstStart = blocks[0].start_time;
  const lastEnd = blocks[blocks.length - 1].end_time;
  const totalSpanSec = Math.max(1, (lastEnd - firstStart) / 1000);
  const totalActiveSec = blocks.reduce((s, b) => s + b.duration, 0);

  // Scale button
  const elScale = document.getElementById("timeline-scale");
  if (elScale) {
    elScale.textContent = ROW_SCALES[rowScaleIdx].label;
  }

  // Pack blocks into rows — always split at row boundary
  const rows: BarSegment[][] = [];
  let currentRow: BarSegment[] = [];
  let rowRemaining = rowSec;

  for (const b of blocks) {
    let remaining = b.duration;
    let firstChunk = true;
    while (remaining > 0) {
      if (rowRemaining <= 0) {
        rows.push(currentRow);
        currentRow = [];
        rowRemaining = rowSec;
      }
      const chunk = Math.min(remaining, rowRemaining);
      const isSplit = remaining > rowRemaining || (!firstChunk);
      currentRow.push({ block_type: b.block_type, duration: chunk, continues: isSplit });
      remaining -= chunk;
      rowRemaining -= chunk;
      firstChunk = false;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Render rows — split blocks get flat edges (= no rounding)
  elRows.innerHTML = rows.map((row) => {
    const rowTotal = row.reduce((s, seg) => s + seg.duration, 0);
    const segs = row.map((seg) => {
      const pct = Math.max(1, (seg.duration / rowTotal) * 100);
      const color = seg.block_type === "work" ? "bg-accent" : "bg-neutral-300";
      const round = seg.continues ? "rounded-none" : "rounded-sm";
      return `<div class="${color} ${round}" style="width:${pct}%"></div>`;
    }).join("");

    return `
      <div class="flex gap-0.5 h-3">
        ${segs}
      </div>
    `;
  }).join("");

  // Total label
  const elTotal = document.getElementById("timeline-total");
  if (elTotal) {
    elTotal.textContent = formatDuration(totalActiveSec);
  }

  // Labels
  elLabels.innerHTML = `
    <span class="text-neutral-400 text-xs">${formatTimestamp(firstStart)}</span>
    <span class="text-neutral-400 text-xs">${formatTimestamp(lastEnd)}</span>
  `;
}
