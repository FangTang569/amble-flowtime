export type TimerState = "idle" | "running" | "paused" | "resting";

/**
 * Which half of a rest you are in.
 *
 * - `earned`: counting down the rest you earned with this work block.
 * - `unused`: the earned rest is exhausted and the unused-rest pool is being
 *   spent. Only reachable once the earned rest hits zero.
 */
export type RestPhase = "earned" | "unused";

export interface TimerSnapshot {
  state: TimerState;
  /** How long the current work block has run (accumulated across resumes). */
  workElapsedMs: number;
  /** Rest earned so far: `workElapsedMs × ratio`. This is the hero number. */
  restEarnedMs: number;
  /** Earned rest for this cycle, settled when work pauses. */
  restTargetMs: number;
  /** Remaining time in the *current* rest phase. */
  restRemainingMs: number;
  restPhase: RestPhase;
  /** Earned rest + pool snapshot — the longest this rest can possibly run. */
  restBudgetMs: number;
  /** Current unused-rest pool balance. */
  unusedRestMs: number;
  /** What a single-number readout (the mini overlay) shows. At idle this is the pool. */
  displayMs: number;
  ratio: number; // 0.05 to 1.0
}

export type TickCallback = (snapshot: TimerSnapshot) => void;
