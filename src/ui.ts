import type { FlowTimer } from "./timer";
import type { TimerSnapshot } from "./types";
import { saveUnusedRestMs } from "./pool";
import { secOf, sharePct, restUsedSec } from "./share";
import {
  getTodayBlocks, addManualBlock,
  getStatsBetween, getBarsBetween,
  formatDuration, formatTimestamp
} from "./storage";

// --- DOM references (set once on init) ---
let elStateLabel: HTMLElement;
let earnedCol: Column;
let elEarnedColumn: HTMLElement;
let unusedCol: Column;
let elRatioDisplay: HTMLElement;
let elRatioSlider: HTMLInputElement;
let elRatioBubble: HTMLElement;
let elRatioLock: HTMLElement;
let elBtnStart: HTMLElement;
let elBtnPause: HTMLElement;
let elBtnResume: HTMLElement;
let elBtnRest: HTMLElement;
let elBtnStop: HTMLElement;
let elBtnStopLabel: HTMLElement;

// --- Helpers ---

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

function setVisible(el: HTMLElement, visible: boolean): void {
  el.classList.toggle("hidden", !visible);
}

// --- Ratio slider -----------------------------------------------------------
// A continuous 5–100% control. `THUMB_PX` must match ::-webkit-slider-thumb in
// style.css; index.html insets its tick labels by the same half-width so the
// labels sit on the values they claim.

const RATIO_MIN = 5;
const RATIO_MAX = 100;
const THUMB_PX = 22;

let bubbleHideTimer: number | null = null;

/** Show the exact percentage right above the thumb. */
function placeRatioBubble(value: number): void {
  if (!elRatioBubble) return;
  const fraction = (value - RATIO_MIN) / (RATIO_MAX - RATIO_MIN);
  elRatioBubble.textContent = `${value}%`;
  elRatioBubble.style.left = `calc(${THUMB_PX / 2}px + ${fraction} * (100% - ${THUMB_PX}px))`;
  elRatioBubble.classList.remove("opacity-0");
  if (bubbleHideTimer !== null) {
    window.clearTimeout(bubbleHideTimer);
    bubbleHideTimer = null;
  }
}

function hideRatioBubble(delay = 0): void {
  if (!elRatioBubble) return;
  if (bubbleHideTimer !== null) window.clearTimeout(bubbleHideTimer);
  bubbleHideTimer = window.setTimeout(() => {
    elRatioBubble.classList.add("opacity-0");
    bubbleHideTimer = null;
  }, delay);
}

// --- Ledger columns ---------------------------------------------------------
// The readout is two accounts side by side. `earned` is what this cycle has
// bought so far; `unused` is the banked pool. Each column has one emphasis
// tone, and the column currently in play is the solid one.

type Tone = "ghost" | "mid" | "solid" | "rest" | "pool";

interface Column {
  minutes: HTMLElement;
  seconds: HTMLElement;
  colon: HTMLElement;
  label: HTMLElement;
  container: HTMLElement;
  flashing: boolean;
}

// Numbers carry the emphasis; labels stay calm and only echo the two semantic
// tones (rest = green, pool = amber) so the type baseline never shifts.
const NUM_TONE: Record<Tone, string> = {
  ghost: "text-neutral-300",
  mid: "text-neutral-500",
  solid: "text-neutral-800",
  rest: "text-emerald-500",
  pool: "text-amber-500",
};

const LABEL_TONE: Record<Tone, string> = {
  ghost: "text-neutral-400",
  mid: "text-neutral-400",
  solid: "text-neutral-400",
  rest: "text-emerald-500",
  pool: "text-amber-500",
};

const NUM_CLASSES = [
  "text-neutral-300",
  "text-neutral-500",
  "text-neutral-800",
  "text-emerald-500",
  "text-amber-400",
  "text-amber-500",
];

const LABEL_CLASSES = [
  "text-neutral-400",
  "text-emerald-500",
  "text-amber-400",
  "text-amber-500",
];

function setNumber(col: Column, ms: number): void {
  const { minutes, seconds } = formatMinutes(ms);
  col.minutes.textContent = minutes;
  col.seconds.textContent = seconds;
}

// --- Share readout -----------------------------------------------------------
// The left column moonlights as a percentage at idle — and, with "Live rest
// share" on, live while the pool is being spent. Precision-instrument style:
// the integer digits keep the full ledger size so the column still carries
// its weight next to the MM:SS column, while the fractional tail (".4220%")
// renders one tier smaller — all-small would read dwarfed, all-large would
// overflow the 320px panel. Baselines align through the row's items-baseline.

const LEDGER_FONT = "text-5xl";
const SHARE_FONT = "text-2xl";
const SHARE_FONT_WIDE = "text-xl"; // 3-digit integer (100.xxxx%) — keep it in the panel
const FONT_CLASSES = ["text-5xl", "text-4xl", "text-3xl", "text-2xl", "text-xl"];

/** Restore the MM:SS tier on every span (called when leaving a share view). */
function setShareFont(col: Column): void {
  for (const el of [col.minutes, col.seconds, col.colon]) {
    el.classList.remove(...FONT_CLASSES);
    el.classList.add(LEDGER_FONT);
  }
}

/** "34.6154%" split across the MM:SS spans: big digits, small tail.
 *  The 1-decimal idle share skips the mixed sizing — uniform ledger size. */
function setShare(col: Column, pct: number, decimals: number): void {
  const [int, frac] = pct.toFixed(decimals).split(".");
  col.minutes.textContent = int;
  col.colon.textContent = frac ? "." : "";
  col.seconds.textContent = frac ? `${frac}%` : "%";
  for (const el of [col.minutes, col.seconds, col.colon]) {
    el.classList.remove(...FONT_CLASSES);
  }
  col.minutes.classList.add(LEDGER_FONT);
  const mixed = decimals >= 4;
  const tail = !mixed
    ? LEDGER_FONT
    : int.length >= 3
      ? SHARE_FONT_WIDE
      : SHARE_FONT;
  for (const el of [col.seconds, col.colon]) {
    el.classList.add(tail);
  }
}

function setTone(col: Column, tone: Tone): void {
  if (col.flashing) return;
  for (const el of [col.minutes, col.seconds, col.colon]) {
    el.classList.remove(...NUM_CLASSES);
    el.classList.add(NUM_TONE[tone]);
  }
  col.label.classList.remove(...LABEL_CLASSES);
  col.label.classList.add(LABEL_TONE[tone]);
}

/** Brief highlight for the moment a rest ends early and leftover lands in the pool. */
function flashColumn(col: Column): void {
  col.flashing = true;
  for (const el of [col.minutes, col.seconds, col.colon]) {
    el.classList.remove(...NUM_CLASSES);
    el.classList.add("text-amber-400");
  }
  window.setTimeout(() => {
    col.flashing = false;
  }, 800);
}

// --- Render ---

let prevPoolMs: number | null = null;

// Idle readout: today's rest share (rest ÷ tracked time). Kept in sync by
// refreshTodayRestShare() whenever today's blocks change.
let lastSnap: TimerSnapshot | null = null;
let todayRestPct = 0;

// "Live rest share" setting: 4-decimal share, shown at idle and live while
// the unused pool is being spent.
let liveShareOn = false;
let todayWorkSec = 0;
let todayRestSec = 0;
// Rest seconds the live share last displayed for the in-flight session.
let lastLiveRestSec: number | null = null;

/**
 * The rest-second figure the live share last displayed for the in-flight
 * session, if the setting is on and the unused phase was reached. Consumed
 * once per call — the session-end handler stores it so the idle readout
 * recomputes to exactly the digits that were on screen.
 */
export function consumeLiveRestSec(): number | null {
  const sec = lastLiveRestSec;
  lastLiveRestSec = null;
  return liveShareOn ? sec : null;
}

/** Recompute today's rest share for the idle readout; repaint if idle now. */
export async function refreshTodayRestShare(): Promise<void> {
  try {
    const blocks = await getTodayBlocks();
    todayRestSec = blocks.reduce(
      (s, b) => s + (b.block_type === "rest" ? b.duration : 0), 0);
    todayWorkSec = blocks.reduce(
      (s, b) => s + (b.block_type === "work" ? b.duration : 0), 0);
    todayRestPct = sharePct(todayRestSec, todayWorkSec);
  } catch {
    todayRestPct = 0;
    todayRestSec = 0;
    todayWorkSec = 0;
  }
  if (lastSnap?.state === "idle") {
    render(lastSnap);
  }
}

export function render(snap: TimerSnapshot): void {
  lastSnap = snap;
  const resting = snap.state === "resting";
  // Second half of a rest: the earned rest is gone, the pool is being spent.
  const spendingPool = resting && snap.restPhase === "unused";

  // Caption sits above the ledger. The column labels carry everything else, so
  // this only needs to say "you are resting right now".
  const caption = resting ? "resting" : "";
  elStateLabel.textContent = caption || "\u00a0";
  elStateLabel.classList.toggle("invisible", caption === "");
  elStateLabel.classList.toggle("text-emerald-500", resting && !spendingPool);
  elStateLabel.classList.toggle("text-amber-500", spendingPool);

  // --- EARNED: what this cycle has bought ---
  let earnedMs = 0;
  let earnedTone: Tone = "ghost";
  if (snap.state === "idle") {
    // The share is real information, not a dead readout — keep it readable.
    earnedTone = "solid";
  } else if (snap.state === "running") {
    earnedMs = snap.restEarnedMs;
    earnedTone = "solid";
  } else if (snap.state === "paused") {
    earnedMs = snap.restTargetMs;
    earnedTone = "solid";
  } else if (resting) {
    if (spendingPool) {
      earnedMs = 0;
      earnedTone = liveShareOn ? "solid" : "ghost";
    } else {
      earnedMs = snap.restRemainingMs;
      earnedTone = "rest";
    }
  }

  // --- UNUSED: the banked pool ---
  let unusedMs: number;
  let unusedTone: Tone;
  if (spendingPool) {
    unusedMs = snap.restRemainingMs;
    unusedTone = "pool";
  } else {
    unusedMs = snap.unusedRestMs;
    if (snap.state === "idle" || snap.state === "paused") {
      // Nothing else is happening: the balance is the whole story.
      unusedTone = unusedMs > 0 ? "solid" : "ghost";
    } else {
      // A cycle is in flight — the pool is held, not in play.
      unusedTone = unusedMs > 0 ? "mid" : "ghost";
    }
  }

  // Left account: at idle it is today's share; while spending the pool with
  // the setting on, the same share live; otherwise the cycle's earned rest.
  const liveShare = spendingPool && liveShareOn;
  if (snap.state === "idle") {
    setShare(earnedCol, todayRestPct, liveShareOn ? 4 : 1);
  } else if (liveShare) {
    // In-flight rest, quantized off the same floored remaining time the
    // countdown shows, so both columns flip on the same tick.
    const usedSec = restUsedSec(snap.restBudgetMs, snap.restRemainingMs);
    const restSec = todayRestSec + usedSec;
    const workSec = todayWorkSec + secOf(snap.workElapsedMs);
    // Storage alignment wants THIS session's own rest seconds. todayRestSec is
    // display-only context — it is already in the database, so leaking it into
    // the session row would re-count every earlier rest and compound.
    lastLiveRestSec = usedSec;
    setShare(earnedCol, sharePct(restSec, workSec), 4);
  } else {
    setShareFont(earnedCol);
    earnedCol.colon.textContent = ":";
    setNumber(earnedCol, earnedMs);
  }
  setNumber(unusedCol, unusedMs);

  if (prevPoolMs !== null && snap.unusedRestMs > prevPoolMs) {
    flashColumn(unusedCol);
  }
  prevPoolMs = snap.unusedRestMs;

  setTone(earnedCol, earnedTone);
  setTone(unusedCol, unusedTone);
  // The left label follows what the left account is currently showing.
  earnedCol.label.textContent =
    snap.state === "idle" || liveShare ? "TODAY" : "EARNED";

  // In the two share states the left column doubles as the toggle.
  const shareClickable = snap.state === "idle" || spendingPool;
  elEarnedColumn?.classList.toggle("cursor-pointer", shareClickable);
  elEarnedColumn?.setAttribute(
    "title",
    shareClickable ? "Toggle live rest share" : "",
  );

  // Colon pulse on whichever account is actually moving.
  earnedCol.container.classList.toggle(
    "timer-running",
    snap.state === "running" || (resting && !spendingPool),
  );
  unusedCol.container.classList.toggle("timer-running", spendingPool);

  // Ratio display + slider
  elRatioDisplay.textContent = formatRatio(snap.ratio);
  const sliderVal = String(Math.round(snap.ratio * 100));
  if (elRatioSlider.value !== sliderVal) {
    elRatioSlider.value = sliderVal;
  }

  // Ratio is frozen once a cycle has begun.
  const locked = snap.state !== "idle";
  elRatioSlider.disabled = locked;
  elRatioSlider.classList.toggle("opacity-40", locked);
  elRatioSlider.classList.toggle("cursor-not-allowed", locked);
  elRatioLock.classList.toggle("hidden", !locked);

  // Button visibility — one capsule row, so the footprint is identical in
  // every state and the panel never jumps.
  setVisible(elBtnStart, snap.state === "idle");
  setVisible(elBtnPause, snap.state === "running");
  setVisible(elBtnResume, snap.state === "paused");
  setVisible(elBtnRest, snap.state === "paused");

  // `End` and `End Rest` are the same control: both call timer.stop(). Only the
  // label and the emphasis tier change — a sole "End Rest" reads as the primary
  // action, while a paired "End" is deliberately the quietest of the three.
  const stopBase =
    "flex-1 h-12 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer";
  elBtnStop.className = resting
    ? `${stopBase} bg-neutral-200 hover:bg-neutral-300 text-neutral-700`
    : `${stopBase} bg-neutral-100 hover:bg-neutral-200 text-neutral-500`;
  elBtnStopLabel.textContent = resting ? "End Rest" : "End";
  setVisible(elBtnStop, snap.state !== "idle");
}

// --- Setup ---

function readColumn(prefix: "earned" | "unused"): Column {
  return {
    minutes: document.getElementById(`${prefix}-minutes`)!,
    seconds: document.getElementById(`${prefix}-seconds`)!,
    colon: document.getElementById(`${prefix}-colon`)!,
    label: document.getElementById(`${prefix}-label`)!,
    container: document.getElementById(`${prefix}-container`)!,
    flashing: false,
  };
}

export function setupUI(timer: FlowTimer): void {
  // Cache DOM references
  elStateLabel = document.getElementById("state-label")!;
  earnedCol = readColumn("earned");
  elEarnedColumn = document.getElementById("earned-column")!;
  unusedCol = readColumn("unused");
  elRatioDisplay = document.getElementById("ratio-display")!;
  elRatioSlider = document.getElementById("ratio-slider") as HTMLInputElement;
  elRatioBubble = document.getElementById("ratio-bubble")!;
  elRatioLock = document.getElementById("ratio-lock")!;
  elBtnStart = document.getElementById("btn-start")!;
  elBtnPause = document.getElementById("btn-pause")!;
  elBtnResume = document.getElementById("btn-resume")!;
  elBtnRest = document.getElementById("btn-rest")!;
  elBtnStop = document.getElementById("btn-stop")!;
  elBtnStopLabel = document.getElementById("btn-stop-label")!;

  const elSettingRatioSlider = document.getElementById(
    "setting-ratio-slider",
  ) as HTMLInputElement;
  const elSettingRatioDisplay = document.getElementById("setting-ratio-display")!;
  const elSettingRatioHint = document.getElementById("setting-ratio-hint")!;

  // Wire timer controls
  elBtnStart.addEventListener("click", () => timer.start());
  document.getElementById("btn-start-top")?.addEventListener("click", () => timer.start());
  elBtnPause.addEventListener("click", () => timer.pause());
  elBtnResume.addEventListener("click", () => timer.resume());
  elBtnRest.addEventListener("click", () => timer.startRest());
  elBtnStop.addEventListener("click", () => timer.stop());

  // One handler owns every way the ratio can change: drag, click, wheel and the
  // arrow keys (which the range input handles natively). Anything that mutates
  // the slider value dispatches a bubbling `input`.
  elRatioSlider.addEventListener("input", () => {
    const value = parseInt(elRatioSlider.value);
    placeRatioBubble(value);
    hideRatioBubble(1200);

    const r = value / 100;
    if (!timer.setRatio(r)) return;
    elSettingRatioSlider.value = String(value);
    elSettingRatioDisplay.textContent = formatRatio(r);
    localStorage.setItem("amble-default-ratio", String(r));
  });

  // Wheel nudges by a single percent, so every value is reachable without the
  // precision problem of a 300px track with 96 steps in it.
  elRatioSlider.addEventListener(
    "wheel",
    (e) => {
      if (timer.getSnapshot().state !== "idle") return;
      e.preventDefault();
      const next = Math.min(
        RATIO_MAX,
        Math.max(RATIO_MIN, parseInt(elRatioSlider.value) + (e.deltaY < 0 ? 1 : -1)),
      );
      if (String(next) === elRatioSlider.value) return;
      elRatioSlider.value = String(next);
      elRatioSlider.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { passive: false },
  );

  elRatioSlider.addEventListener("pointerdown", () => {
    placeRatioBubble(parseInt(elRatioSlider.value));
  });
  const releaseRatio = () => hideRatioBubble(400);
  elRatioSlider.addEventListener("pointerup", releaseRatio);
  elRatioSlider.addEventListener("pointercancel", releaseRatio);
  elRatioSlider.addEventListener("blur", () => hideRatioBubble(0));

  elSettingRatioSlider?.addEventListener("input", () => {
    const r = parseInt(elSettingRatioSlider.value) / 100;
    if (!timer.setRatio(r)) return;
    elSettingRatioDisplay.textContent = formatRatio(r);
    elRatioSlider.value = elSettingRatioSlider.value;
    localStorage.setItem("amble-default-ratio", String(r));
  });

  // Live rest share — 4-decimal share at idle and live while the unused pool
  // is being spent. Off by default; must be set before the first render so
  // the idle readout starts in the right format. Two controls flip it: the
  // settings switch and the ledger's left column itself (in the two states
  // where it shows the share).
  liveShareOn = localStorage.getItem("amble-live-share") === "1";
  const elLiveShare = document.getElementById("setting-live-share");
  const elLiveShareKnob = document.getElementById("setting-live-share-knob");
  const paintLiveShare = (on: boolean) => {
    elLiveShare?.setAttribute("aria-checked", String(on));
    elLiveShare?.classList.toggle("bg-accent", on);
    elLiveShare?.classList.toggle("bg-neutral-200", !on);
    elLiveShareKnob?.classList.toggle("translate-x-4", on);
  };
  const toggleLiveShare = () => {
    liveShareOn = !liveShareOn;
    localStorage.setItem("amble-live-share", liveShareOn ? "1" : "0");
    paintLiveShare(liveShareOn);
    if (lastSnap) render(lastSnap);
  };
  paintLiveShare(liveShareOn);
  elLiveShare?.addEventListener("click", toggleLiveShare);
  elEarnedColumn?.addEventListener("click", () => {
    const s = lastSnap;
    if (!s) return;
    const inShareState =
      s.state === "idle" ||
      (s.state === "resting" && s.restPhase === "unused");
    if (inShareState) toggleLiveShare();
  });

  // Sync both sliders to the timer's current ratio (restored from localStorage).
  const initRatio = timer.getSnapshot().ratio;
  const initVal = String(Math.round(initRatio * 100));
  elRatioSlider.value = initVal;
  elSettingRatioSlider.value = initVal;
  elSettingRatioDisplay.textContent = formatRatio(initRatio);

  // Keep the settings slider locked in step with the main one.
  const syncSettingsLock = (locked: boolean) => {
    elSettingRatioSlider.disabled = locked;
    elSettingRatioSlider.classList.toggle("opacity-40", locked);
    elSettingRatioSlider.classList.toggle("cursor-not-allowed", locked);
    elSettingRatioHint.classList.toggle("hidden", !locked);
  };
  syncSettingsLock(timer.getSnapshot().state !== "idle");
  timer.onTick((snap) => syncSettingsLock(snap.state !== "idle"));

  // Segmented control: switch between timer / stats / settings views
  type ViewKind = "timer" | "stats" | "settings";
  const elPanelTimer = document.getElementById("panel-timer")!;
  const elPanelStats = document.getElementById("panel-stats")!;
  const elPanelSettings = document.getElementById("panel-settings")!;
  const elSegTimer = document.getElementById("seg-timer")!;
  const elSegStats = document.getElementById("seg-stats")!;
  const elSegSettings = document.getElementById("seg-settings")!;
  const elSegSlider = document.getElementById("seg-slider")!;
  const SLIDER_BASE = "absolute left-0.5 top-0.5 w-7 h-7 bg-white rounded-lg shadow-sm";

  function switchTo(view: ViewKind) {
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

    const posMap: Record<ViewKind, string> = {
      timer: "pos-0",
      stats: "pos-1",
      settings: "pos-2",
    };
    elSegSlider.className = `${SLIDER_BASE} ${posMap[view]}`;

    if (view === "stats") {
      renderStats();
    }
  }

  elSegTimer.addEventListener("click", () => switchTo("timer"));
  elSegStats.addEventListener("click", () => switchTo("stats"));
  elSegSettings.addEventListener("click", () => switchTo("settings"));

  // Initial state: timer icon = active (darker)
  elSegTimer.classList.add("text-neutral-800");

  // Timeline scale toggle
  document.getElementById("timeline-scale")?.addEventListener("click", () => {
    rowScaleIdx = (rowScaleIdx + 1) % ROW_SCALES.length;
    renderTimeline();
  });

  // Quick-add. "work"/"rest" write a manual time block; "earn"/"pool" are pool
  // operations only — no block, just the unused balance.
  const qaTypeEl = document.getElementById("qa-type") as HTMLSelectElement;
  const qaDurEl = document.getElementById("qa-duration") as HTMLInputElement;
  const qaHintEl = document.getElementById("qa-hint");

  // "earn" converts focus minutes into pool minutes at the current ratio;
  // "pool" is a direct delta.
  function qaPoolGainMin(kind: string, minutes: number): number {
    return kind === "earn" ? minutes * timer.getSnapshot().ratio : minutes;
  }

  function updateQaHint(): void {
    if (!qaHintEl) return;
    const kind = qaTypeEl?.value;
    const v = parseInt(qaDurEl?.value ?? "");
    let gain: number | null = null;
    if (kind === "earn" && Number.isFinite(v) && v > 0) {
      gain = qaPoolGainMin(kind, v);
    } else if (kind === "pool" && Number.isFinite(v) && v !== 0) {
      gain = v;
    }
    if (gain === null) {
      qaHintEl.classList.add("hidden");
      return;
    }
    const sign = gain > 0 ? "+" : "−";
    const abs = Math.abs(gain);
    const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
    qaHintEl.textContent = `unused pool ${sign}${txt} min`;
    qaHintEl.classList.remove("hidden");
  }

  // Only the direct pool edit may go negative; every other kind keeps min=1.
  qaTypeEl?.addEventListener("change", () => {
    if (qaDurEl) qaDurEl.min = qaTypeEl.value === "pool" ? "-480" : "1";
    updateQaHint();
  });
  qaDurEl?.addEventListener("input", updateQaHint);

  document.getElementById("qa-add")?.addEventListener("click", async () => {
    if (!qaTypeEl || !qaDurEl) return;

    const kind = qaTypeEl.value;
    const durationMin = parseInt(qaDurEl.value);
    if (!Number.isFinite(durationMin)) return;
    // Negative input is the direct pool edit's privilege alone.
    if (kind === "pool" ? durationMin === 0 : durationMin <= 0) return;

    if (kind === "earn" || kind === "pool") {
      timer.addUnusedRestMs(Math.round(qaPoolGainMin(kind, durationMin) * 60_000));
      saveUnusedRestMs(timer.getSnapshot().unusedRestMs);
      return; // no time block — the pool is the whole entry
    }

    const ratio = parseInt(elRatioSlider.value) / 100;

    await addManualBlock({
      block_type: kind as "work" | "rest",
      durationMin,
      ratio,
    });

    await renderTimeline();
    await renderHistory();
    await refreshTodayRestShare();
  });

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
  // Periods with nothing tracked are dropped rather than drawn as empty slots —
  // the chart is a record of what happened, not a calendar.
  const bars = (await getBarsBetween(since, until, gran)).filter(
    (b) => b.focusSec + b.breakSec > 0,
  );

  if (bars.length === 0) {
    elChart.innerHTML = `<p class="text-neutral-500 text-sm w-full text-center">No data</p>`;
    return;
  }

  const maxSec = Math.max(1, ...bars.map((b) => b.focusSec + b.breakSec));

  // Dynamic chart height: ~30px per hour of the tallest bar
  const maxHours = maxSec / 3600;
  const chartPx = Math.round(Math.max(80, Math.min(280, maxHours * 30)));
  elChart.style.height = `${chartPx}px`;

  // Columns share the width only while there are enough of them to warrant it
  // (`max-w-14`) — one day of data is one bar, not a full-width slab. The
  // container centres the group, so a short week sits in the middle.
  elChart.innerHTML = bars.map((b) => {
    const total = b.focusSec + b.breakSec;
    const heightPct = (total / maxSec) * 100;
    const breakPct = total > 0 ? (b.breakSec / total) * 100 : 0;

    return `
      <div class="flex-1 max-w-14 h-full flex flex-col items-center justify-end gap-0.5">
        <span class="text-neutral-500 text-xs font-mono tabular-nums leading-none">${formatDuration(total)}</span>
        <div class="w-full rounded-sm bg-accent relative overflow-hidden" style="height:${heightPct}%">
          <div class="bg-neutral-300 w-full absolute bottom-0 rounded-b-sm" style="height:${breakPct}%"></div>
        </div>
        <span class="text-neutral-500 text-xs">${b.label}</span>
      </div>
    `;
  }).join("");
}
