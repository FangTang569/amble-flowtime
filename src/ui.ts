import type { FlowTimer } from "./timer";
import type { TimerSnapshot } from "./types";
import {
  getTodayBlocks, addManualBlock,
  getStatsBetween, getBarsBetween,
  formatDuration, formatTimestamp
} from "./storage";

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
  return `${pct}% ≈ (work ${workParts}:1)`;
}

// --- Render ---

export function render(snap: TimerSnapshot): void {
  // State label + timer color
  const resting = snap.state === "resting";
  if (resting) {
    elStateLabel.textContent = "Resting…";
    elStateLabel.classList.remove("hidden");
    elMinutes.classList.add("text-emerald-500");
    elSeconds.classList.add("text-emerald-500");
    elColon.classList.add("text-emerald-500");
    elMinutes.classList.remove("text-neutral-800");
    elSeconds.classList.remove("text-neutral-800");
    elColon.classList.remove("text-neutral-800");
  } else {
    elStateLabel.classList.add("hidden");
    elMinutes.classList.add("text-neutral-800");
    elSeconds.classList.add("text-neutral-800");
    elColon.classList.add("text-neutral-800");
    elMinutes.classList.remove("text-emerald-500");
    elSeconds.classList.remove("text-emerald-500");
    elColon.classList.remove("text-emerald-500");
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
  document.getElementById("btn-start-top")?.addEventListener("click", () => timer.start());
  elBtnPause.addEventListener("click", () => timer.pause());
  elBtnResume.addEventListener("click", () => timer.resume());
  elBtnRest.addEventListener("click", () => timer.startRest());
  elBtnStop.addEventListener("click", () => timer.stop());
  elRatioSlider.addEventListener("input", () => {
    timer.setRatio(parseInt(elRatioSlider.value) / 100);
    if (elSettingRatioSlider) {
      elSettingRatioSlider.value = elRatioSlider.value;
      elSettingRatioDisplay.textContent = formatRatio(parseInt(elRatioSlider.value) / 100);
    }
  });

  // Timeline scale toggle
  document.getElementById("timeline-scale")?.addEventListener("click", () => {
    rowScaleIdx = (rowScaleIdx + 1) % ROW_SCALES.length;
    renderTimeline();
  });

  // Quick-add
  document.getElementById("qa-add")?.addEventListener("click", async () => {
    const typeEl = document.getElementById("qa-type") as HTMLSelectElement;
    const durEl = document.getElementById("qa-duration") as HTMLInputElement;
    if (!typeEl || !durEl) return;

    const blockType = typeEl.value as "work" | "rest";
    const durationMin = parseInt(durEl.value);
    if (durationMin <= 0) return;

    const ratio = parseInt((document.getElementById("ratio-slider") as HTMLInputElement).value) / 100;

    await addManualBlock({
      block_type: blockType,
      durationMin,
      ratio,
    });

    await renderTimeline();
    await renderHistory();
  });

  // Segmented control: switch between timer / stats / settings views
  type ViewKind = "timer" | "stats" | "settings";
  let currentView: ViewKind = "timer";
  const elPanelTimer = document.getElementById("panel-timer")!;
  const elPanelStats = document.getElementById("panel-stats")!;
  const elPanelSettings = document.getElementById("panel-settings")!;
  const elSegTimer = document.getElementById("seg-timer")!;
  const elSegStats = document.getElementById("seg-stats")!;
  const elSegSettings = document.getElementById("seg-settings")!;
  const elSegSlider = document.getElementById("seg-slider")!;
  const SLIDER_BASE = "absolute left-0.5 top-0.5 w-7 h-7 bg-white rounded-lg shadow-sm";

  function switchTo(view: ViewKind) {
    currentView = view;
    elPanelTimer.classList.toggle("hidden", view !== "timer");
    elPanelStats.classList.toggle("hidden", view !== "stats");
    elPanelSettings.classList.toggle("hidden", view !== "settings");

    const setSeg = (el: HTMLElement, active: boolean) => {
      el.classList.toggle("text-neutral-800", active);
      el.classList.toggle("text-neutral-500", !active);
    };
    setSeg(elSegTimer, view === "timer");
    setSeg(elSegStats, view === "stats");
    setSeg(elSegSettings, view === "settings");

    const posMap: Record<ViewKind, string> = { timer: "pos-0", stats: "pos-1", settings: "pos-2" };
    elSegSlider.className = `${SLIDER_BASE} ${posMap[view]}`;

    if (view === "stats") {
      renderStats();
    }
  }

  elSegTimer.addEventListener("click", () => switchTo("timer"));
  elSegStats.addEventListener("click", () => switchTo("stats"));
  elSegSettings.addEventListener("click", () => switchTo("settings"));

  // Setting: default ratio slider
  const elSettingRatioSlider = document.getElementById("setting-ratio-slider") as HTMLInputElement;
  const elSettingRatioDisplay = document.getElementById("setting-ratio-display")!;
  elSettingRatioSlider?.addEventListener("input", () => {
    const r = parseInt(elSettingRatioSlider.value) / 100;
    timer.setRatio(r);
    elSettingRatioDisplay.textContent = formatRatio(r);
    elRatioSlider.value = elSettingRatioSlider.value;
    localStorage.setItem("amble-default-ratio", String(r));
  });

  // Sync sliders to the timer's current ratio (restored from localStorage or default)
  const initVal = String(Math.round(timer.getSnapshot().ratio * 100));
  elRatioSlider.value = initVal;
  if (elSettingRatioSlider) {
    elSettingRatioSlider.value = initVal;
    elSettingRatioDisplay.textContent = formatRatio(timer.getSnapshot().ratio);
  }

  // Initial state: timer icon = active (darker)
  elSegTimer.classList.add("text-neutral-800");

  // Stats period selector
  const statButtons = [
    { el: document.getElementById("stat-week")!, period: "week" as const },
    { el: document.getElementById("stat-month")!, period: "month" as const },
    { el: document.getElementById("stat-year")!, period: "year" as const },
  ];

  statButtons.forEach(({ el, period }) => {
    el.addEventListener("click", () => {
      statsPeriod = period;
      statsOffset = 0;
      statButtons.forEach(({ el: b, period: p }) => {
        if (p === period) {
          b.className = "bg-neutral-200 rounded-full px-3 py-1 text-xs font-semibold text-neutral-800 cursor-pointer transition-colors";
        } else {
          b.className = "text-neutral-500 hover:text-neutral-700 rounded-full px-3 py-1 text-xs cursor-pointer transition-colors";
        }
      });
      renderStats();
    });
  });

  // Stats navigation
  document.getElementById("stat-prev")?.addEventListener("click", () => {
    statsOffset--;
    renderStats();
  });
  document.getElementById("stat-next")?.addEventListener("click", () => {
    if (statsOffset < 0) {
      statsOffset++;
      renderStats();
    }
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
        <span class="text-neutral-500 text-xs">${time}</span>
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

  // Render rows — each row width = full rowSec, last row may have empty tail
  elRows.innerHTML = rows.map((row, ri) => {
    const isLast = ri === rows.length - 1;
    const rowTotal = row.reduce((s, seg) => s + seg.duration, 0);
    const scale = isLast ? rowSec : rowTotal; // last row uses full rowSec width, others fill exactly

    const segs = row.map((seg) => {
      const pct = Math.max(1, (seg.duration / scale) * 100);
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
    <span class="text-neutral-500 text-xs">${formatTimestamp(firstStart)}</span>
    <span class="text-neutral-500 text-xs">${formatTimestamp(lastEnd)}</span>
  `;
}

// --- Stats ---

let statsPeriod: "week" | "month" | "year" = "week";
let statsOffset = 0;

function getDateRange(): { since: number; until: number; label: string } {
  const now = new Date();
  let since: Date;
  let until: Date;
  let label: string;

  if (statsPeriod === "week") {
    const dow = now.getDay();
    const monOff = dow === 0 ? -6 : 1 - dow;
    since = new Date(now);
    since.setDate(now.getDate() + monOff + statsOffset * 7);
    since.setHours(0, 0, 0, 0);
    until = new Date(since);
    until.setDate(since.getDate() + 7);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const end = new Date(until);
    end.setDate(end.getDate() - 1);
    label = `${fmt(since)} – ${fmt(end)}, ${since.getFullYear()}`;
  } else if (statsPeriod === "month") {
    since = new Date(now.getFullYear(), now.getMonth() + statsOffset, 1);
    until = new Date(now.getFullYear(), now.getMonth() + statsOffset + 1, 1);
    label = since.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } else {
    since = new Date(now.getFullYear() + statsOffset, 0, 1);
    until = new Date(now.getFullYear() + statsOffset + 1, 0, 1);
    label = String(since.getFullYear());
  }

  return { since: since.getTime(), until: until.getTime(), label };
}

export async function renderStats(): Promise<void> {
  const { since, until, label } = getDateRange();
  const stats = await getStatsBetween(since, until);

  // Period label
  const elLabel = document.getElementById("stat-range-label");
  if (elLabel) elLabel.textContent = label;

  // Nav buttons
  const elPrev = document.getElementById("stat-prev");
  const elNext = document.getElementById("stat-next");
  if (elPrev) {
    elPrev.style.visibility = "visible";
  }
  if (elNext) {
    elNext.style.visibility = statsOffset === 0 ? "hidden" : "visible";
  }

  // Summary cards
  const elFocus = document.getElementById("stat-focus");
  const elBreak = document.getElementById("stat-break");
  const elCount = document.getElementById("stat-count");

  const totalSec = stats.focusSec + stats.breakSec;
  const breakPct = totalSec > 0 ? Math.round((stats.breakSec / totalSec) * 100) : 0;

  if (elFocus) elFocus.textContent = formatDuration(totalSec);
  if (elBreak) elBreak.textContent = `${breakPct}%`;
  if (elCount) elCount.textContent = String(stats.sessionCount);

  // Bar chart
  const elChart = document.getElementById("bar-chart");
  if (!elChart) return;

  const gran: "day" | "week" | "month" =
    statsPeriod === "week" ? "day" : statsPeriod === "month" ? "week" : "month";
  const bars = await getBarsBetween(since, until, gran);

  if (bars.length === 0) {
    elChart.innerHTML = `<p class="text-neutral-500 text-sm w-full text-center">No data</p>`;
    return;
  }

  const maxSec = Math.max(1, ...bars.map((b) => b.focusSec + b.breakSec));

  // Dynamic chart height: ~30px per hour of the tallest bar
  const maxHours = maxSec / 3600;
  const chartPx = Math.round(Math.max(80, Math.min(280, maxHours * 30)));
  elChart.style.height = `${chartPx}px`;

  elChart.innerHTML = bars.map((b) => {
    const total = b.focusSec + b.breakSec;
    const heightPct = (total / maxSec) * 100;
    const breakPct = total > 0 ? (b.breakSec / total) * 100 : 0;

    return `
      <div class="flex-1 h-full flex flex-col items-center justify-end gap-0.5">
        <span class="text-neutral-500 text-xs font-mono tabular-nums leading-none">${total > 0 ? formatDuration(total) : ""}</span>
        <div class="w-full rounded-sm bg-accent relative overflow-hidden" style="height:${heightPct}%">
          <div class="bg-neutral-300 w-full absolute bottom-0 rounded-b-sm" style="height:${breakPct}%"></div>
        </div>
        <span class="text-neutral-500 text-xs">${b.label}</span>
      </div>
    `;
  }).join("");
}
