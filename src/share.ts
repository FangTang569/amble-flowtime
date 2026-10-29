/**
 * Rest-share math for the live readout ("Live rest share" setting).
 *
 * Pure functions only — no DOM, no Tauri — so the headless selftest can pin
 * the quantization invariants the zero-jump handover depends on.
 */

/**
 * Round ms to whole seconds. MUST stay identical to `msToSec` in storage.ts:
 * the live share quantizes the in-flight session with the same rounding the
 * database will apply at session end, so the last displayed value and the
 * block-based idle value match digit for digit.
 */
export function secOf(ms: number): number {
  return Math.round(ms / 1000);
}

/** Rest share in percent: rest ÷ (rest + work). Zero when nothing is tracked. */
export function sharePct(restSec: number, workSec: number): number {
  const total = restSec + workSec;
  if (total <= 0) return 0;
  return (restSec / total) * 100;
}

/**
 * Seconds of rest consumed during a rest, derived from the same floored
 * remaining time the countdown column displays. Rounding elapsed time
 * independently (secOf) flips at X.5s while the countdown flips at X.0s, so
 * the two columns visibly alternate; this flips on the countdown's tick.
 */
export function restUsedSec(budgetMs: number, remainingMs: number): number {
  return (
    Math.floor(budgetMs / 1000) - Math.floor(Math.max(0, remainingMs) / 1000)
  );
}
