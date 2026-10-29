/**
 * Unused-rest pool (未使用休息池).
 *
 * Leftover rest time accumulates here when you end a rest early. The pool is
 * intentionally ephemeral: it resets at local midnight, so it can never be
 * hoarded across days.
 */

const STORAGE_KEY = "amble-unused-rest";

interface PoolRecord {
  date: string; // local YYYY-MM-DD the pool belongs to
  ms: number;
}

/** Local calendar day key — deliberately not UTC, the reset is at local midnight. */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Read the pool, discarding anything left over from a previous day. */
export function loadUnusedRestMs(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;

    const rec = JSON.parse(raw) as PoolRecord;
    if (!rec || typeof rec.ms !== "number" || !Number.isFinite(rec.ms)) return 0;

    if (rec.date !== todayKey()) {
      // Stale — a new day, start clean.
      localStorage.removeItem(STORAGE_KEY);
      return 0;
    }

    return Math.max(0, Math.round(rec.ms));
  } catch {
    return 0;
  }
}

/** Persist the pool for the current day. Zero removes the record entirely. */
export function saveUnusedRestMs(ms: number): void {
  const safe = Math.max(0, Math.round(ms));
  try {
    if (safe === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const rec: PoolRecord = { date: todayKey(), ms: safe };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // Storage unavailable (private mode, quota) — the pool just won't survive
    // a restart. Not worth surfacing to the user.
  }
}
