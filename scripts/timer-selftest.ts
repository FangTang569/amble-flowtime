/* Offline self-test for the timer semantics ported from flowtime+.
 * Bundled by esbuild and run under plain node — no DOM, no Tauri, deterministic clock. */

// --- deterministic clock -----------------------------------------------------
let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;
const advance = (ms: number) => {
  fakeNow += ms;
};

// --- manual interval driver --------------------------------------------------
let seq = 0;
const intervals = new Map<number, () => void>();
(globalThis as any).setInterval = (fn: () => void) => {
  const id = ++seq;
  intervals.set(id, fn);
  return id;
};
(globalThis as any).clearInterval = (id: number) => {
  intervals.delete(id);
};
function tick() {
  for (const fn of [...intervals.values()]) fn();
}

// --- localStorage stub for pool.ts ------------------------------------------
const STORAGE_KEY = "amble-unused-rest";
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

import { FlowTimer } from "../src/timer.ts";
import { loadUnusedRestMs, saveUnusedRestMs, todayKey } from "../src/pool.ts";
import { secOf, sharePct, restUsedSec } from "../src/share.ts";

// --- tiny assert harness -----------------------------------------------------
let failures = 0;
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  } else {
    console.log(`  ok   ${label} = ${a}`);
  }
}
function section(name: string) {
  console.log(`\n${name}`);
}

// ============================================================================
section("1. Hero number is rest time, not work time");
{
  const t = new FlowTimer(0.25, 0);
  t.start();
  advance(240_000); // 4 min of work
  const s = t.getSnapshot();
  eq(s.workElapsedMs, 240_000, "work elapsed");
  eq(s.restEarnedMs, 60_000, "rest earned (4min × 25%)");
  eq(s.displayMs, 60_000, "display shows rest, not work");
  eq(s.state, "running", "state");
  t.stop();
}

section("2. Ratio is locked once a cycle starts");
{
  const t = new FlowTimer(0.25, 0);
  eq(t.setRatio(0.5), true, "setRatio works while idle");
  eq(t.getSnapshot().ratio, 0.5, "ratio applied while idle");

  const t2 = new FlowTimer(0.25, 0);
  t2.start();
  advance(60_000);
  eq(t2.setRatio(0.9), false, "setRatio rejected while running");
  eq(t2.getSnapshot().ratio, 0.25, "ratio unchanged while running");

  t2.pause();
  eq(t2.setRatio(0.9), false, "setRatio rejected while paused");
  eq(t2.getSnapshot().ratio, 0.25, "ratio unchanged while paused");
  t2.stop();

  eq(t2.setRatio(0.9), true, "setRatio allowed again after stop");
  t2.stop();
}

section("3. Pause settles the earned rest");
{
  const t = new FlowTimer(0.25, 0);
  t.start();
  advance(240_000);
  t.pause();
  const s = t.getSnapshot();
  eq(s.restTargetMs, 60_000, "rest target settled on pause");
  eq(s.displayMs, 60_000, "paused display keeps the settled rest");
  t.stop();
}

section("4. Ending a rest early banks the leftover");
{
  const t = new FlowTimer(0.25, 0);
  t.start();
  advance(240_000);
  t.pause(); // earned 60s
  t.startRest();
  advance(30_000); // rest 30s of the 60s earned
  const mid = t.getSnapshot();
  eq(mid.restPhase, "earned", "still in earned phase");
  eq(mid.restRemainingMs, 30_000, "30s of earned rest left");

  t.stop(); // end early
  eq(t.getSnapshot().unusedRestMs, 30_000, "leftover 30s banked into pool");
  eq(t.getSnapshot().state, "idle", "back to idle");
}

section("5. Normal rest never pulls from the pool");
{
  const t = new FlowTimer(0.25, 600_000); // 10 min pool sitting there
  t.start();
  advance(240_000);
  t.pause(); // earned 60s
  t.startRest();
  const s = t.getSnapshot();
  eq(s.restTargetMs, 60_000, "earned rest is still just 60s");
  eq(s.restPhase, "earned", "pool is not mixed into the earned phase");
  eq(s.unusedRestMs, 600_000, "pool untouched during earned phase");
  t.stop();
}

section("6. Pool is spent automatically once earned rest runs out");
{
  const t = new FlowTimer(0.25, 120_000); // 2 min pool
  t.start();
  advance(240_000);
  t.pause(); // earned 60s
  t.startRest();
  eq(t.getSnapshot().restBudgetMs, 180_000, "max rest = 60s earned + 120s pool");

  advance(59_000);
  eq(t.getSnapshot().restPhase, "earned", "still earned at 59s");

  advance(2_000); // now 61s elapsed — earned exhausted
  const s = t.getSnapshot();
  eq(s.restPhase, "unused", "switched to unused phase");
  eq(s.restRemainingMs, 119_000, "pool counting down");
  eq(s.displayMs, 119_000, "hero shows pool remainder");

  advance(119_000); // 180s total = budget
  tick(); // interval notices the budget is gone and auto-stops
  eq(t.getSnapshot().state, "idle", "auto-stop at end of budget");
  eq(t.getSnapshot().unusedRestMs, 0, "pool fully consumed");
}

section("7. Ending during the unused phase only charges what was spent");
{
  const t = new FlowTimer(0.25, 120_000);
  t.start();
  advance(240_000);
  t.pause(); // earned 60s
  t.startRest();
  advance(60_000 + 20_000); // 20s into the pool
  eq(t.getSnapshot().restPhase, "unused", "in unused phase");
  t.stop();
  eq(t.getSnapshot().unusedRestMs, 100_000, "spent 20s, 100s left");
}

section("8. Pool cannot be used to rest forever");
{
  const t = new FlowTimer(0.25, 30_000);
  t.start();
  advance(240_000);
  t.pause();
  t.startRest();
  eq(t.getSnapshot().restBudgetMs, 90_000, "budget capped at snapshot");

  // Pretend more rest appeared mid-round: the snapshot must still hold.
  advance(80_000);
  const s = t.getSnapshot();
  eq(s.restBudgetMs, 90_000, "budget unchanged mid-round");
  eq(s.restRemainingMs, 10_000, "10s left of a 90s cap");
  t.stop();
}

section("9. No rest started → no pool credited, nothing invented");
{
  const t = new FlowTimer(0.25, 0);
  t.start();
  advance(240_000);
  t.pause();
  t.stop(); // never rested
  eq(t.getSnapshot().unusedRestMs, 0, "pool stays empty");
}

section("10. Session end payload carries the settled pool");
{
  const t = new FlowTimer(0.25, 0);
  let payload: any = null;
  t.onSessionEnd((d) => {
    payload = d;
  });
  t.start();
  advance(240_000);
  t.pause();
  t.startRest();
  advance(15_000);
  t.stop();
  eq(payload.workDurationMs, 240_000, "work duration");
  eq(payload.restTargetMs, 60_000, "rest target");
  eq(payload.restDurationMs, 15_000, "rest duration actually taken");
  eq(payload.unusedRestMs, 45_000, "unused rest reported to the caller");
}

section("11. Daily reset of the pool store");
{
  store.clear();
  eq(loadUnusedRestMs(), 0, "empty store reads 0");

  saveUnusedRestMs(45_000);
  eq(loadUnusedRestMs(), 45_000, "round-trips today's pool");

  // Forge a record from yesterday.
  const yesterday = new Date(Date.now() - 86_400_000);
  const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  store.set(STORAGE_KEY, JSON.stringify({ date: key, ms: 999_000 }));
  eq(loadUnusedRestMs(), 0, "a previous day's pool is discarded");
  eq(store.has(STORAGE_KEY), false, "stale record removed");

  saveUnusedRestMs(0);
  eq(store.has(STORAGE_KEY), false, "saving zero clears the record");
  eq(todayKey().length, 10, "day key is YYYY-MM-DD");
}

section("12. clearUnusedRest drops the pool on a midnight rollover");
{
  const t = new FlowTimer(0.25, 120_000);
  eq(t.getSnapshot().unusedRestMs, 120_000, "pool restored from storage");
  t.clearUnusedRest();
  eq(t.getSnapshot().unusedRestMs, 0, "pool cleared");
}

section("13. Idle surfaces the pool as the single readout number");
{
  const t = new FlowTimer(0.25, 90_000);
  eq(t.getSnapshot().displayMs, 90_000, "idle displayMs = pool balance");

  t.start();
  advance(240_000);
  eq(t.getSnapshot().displayMs, 60_000, "running displayMs = earned rest");

  t.pause();
  eq(t.getSnapshot().displayMs, 60_000, "paused displayMs = settled rest");
  t.stop();

  const empty = new FlowTimer(0.25, 0);
  eq(empty.getSnapshot().displayMs, 0, "idle with an empty pool reads 0");
  empty.stop();
}

section("14. Manual pool adjustment floors at zero (quick-add)");
{
  const t = new FlowTimer(0.25, 60_000);
  t.addUnusedRestMs(30_000);
  eq(t.getSnapshot().unusedRestMs, 90_000, "positive add while idle");

  t.addUnusedRestMs(-120_000);
  eq(t.getSnapshot().unusedRestMs, 0, "oversized negative add floors at zero");

  t.addUnusedRestMs(0);
  eq(t.getSnapshot().unusedRestMs, 0, "zero delta is a no-op");

  t.start();
  advance(60_000);
  t.addUnusedRestMs(30_000);
  eq(t.getSnapshot().unusedRestMs, 30_000, "add works while running (pool held)");
  t.stop();
}

section("15. Pool add during a rest extends the running round");
{
  const t = new FlowTimer(0.25, 60_000);
  t.start();
  advance(240_000);
  t.pause(); // earned 60s
  t.startRest(); // budget = 60 earned + 60 pool
  advance(60_000); // earned exhausted, pool counting down
  eq(t.getSnapshot().restPhase, "unused", "spending the pool");
  t.addUnusedRestMs(60_000);
  eq(t.getSnapshot().restBudgetMs, 180_000, "manual add extends the snapshot budget");
  eq(t.getSnapshot().restRemainingMs, 120_000, "remaining follows the add");
  t.stop();
  eq(t.getSnapshot().unusedRestMs, 120_000, "settle keeps banked + added time");
}

section("16. Negative pool add can end the rest at once");
{
  const t = new FlowTimer(0.25, 120_000);
  t.start();
  advance(240_000);
  t.pause(); // earned 60s
  t.startRest(); // budget = 180s
  advance(61_000); // 1s into the pool
  t.addUnusedRestMs(-240_000); // wipe the pool snapshot
  eq(t.getSnapshot().restBudgetMs, 60_000, "budget shrinks to the earned rest");
  tick(); // interval sees elapsed (61s) >= budget (60s)
  eq(t.getSnapshot().state, "idle", "rest auto-stops once the budget is gone");
  eq(t.getSnapshot().unusedRestMs, 0, "pool settled to zero");
}

section("17. Live rest share quantizes like the database");
{
  eq(secOf(240_000), 240, "secOf matches storage msToSec (exact)");
  eq(secOf(61_400), 61, "secOf rounds 61.4s down");
  eq(secOf(61_500), 62, "secOf rounds 61.5s up — same as msToSec");
  eq(sharePct(0, 0), 0, "nothing tracked reads 0");

  // The live share of an in-flight session (empty day, work 4 min, 61.4s
  // rested) vs what the blocks recompute once the session lands: the override
  // stores the displayed seconds, so both sides quantize identically.
  const workMs = 240_000;
  const elapsedMs = 61_400;
  const live = sharePct(0 + secOf(elapsedMs), 0 + secOf(workMs));
  eq(sharePct(secOf(elapsedMs), secOf(workMs)), live,
    "live share == idle share after save (no jump)");

  // Why raw-ms math is banned: it drifts from the stored seconds.
  eq((elapsedMs / (elapsedMs + workMs)) * 100 !== live, true,
    "raw-ms share would differ from the quantized readout");

  // The rounding-boundary case the override exists for: last tick showed the
  // 61st second, but stopping 2ms later would store 62 — so the session-end
  // handler reuses the displayed second, not the exact ms.
  eq(secOf(61_499), 61, "displayed second at the last tick");
  eq(secOf(61_501), 62, "what exact-ms storage would have written");
  eq(sharePct(61, secOf(workMs)), sharePct(secOf(61_000), secOf(workMs)),
    "override keeps displayed and stored figures identical");

  // Flip sync: the share's seconds come from the same floored remaining time
  // the countdown displays, so the two columns change on the same tick rather
  // than alternating (round flips at X.5s, the countdown at X.0s).
  eq(restUsedSec(12_400, 10_000), 2, "matches the countdown at 10s remaining");
  eq(restUsedSec(12_400, 9_999), 3, "flips the instant the countdown flips");
  eq(restUsedSec(1_400, 0), 1, "fully spent sub-second budget counts its second");
  eq(restUsedSec(0, 0), 0, "empty budget consumes nothing");
}

// ============================================================================
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
process.exit(0);
