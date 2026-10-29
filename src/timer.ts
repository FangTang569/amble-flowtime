import type { RestPhase, TimerSnapshot, TimerState, TickCallback } from "./types";

const TICK_INTERVAL_MS = 250;

export interface SessionEndData {
  workStartTime: number; // absolute timestamp (ms)
  workEndTime: number; // absolute timestamp (ms)
  workDurationMs: number;
  restTargetMs: number;
  restStartTime: number; // absolute timestamp (ms), 0 if no rest
  restEndTime: number; // absolute timestamp (ms), 0 if no rest
  restDurationMs: number;
  ratio: number;
  /** Unused-rest pool balance *after* this session settled. */
  unusedRestMs: number;
}

type SessionEndCallback = (data: SessionEndData) => void;

/**
 * Work → rest cycle driven purely by a rest ratio.
 *
 * There is no notion of a total session length: you work for as long as you
 * like and the timer tells you how much rest that work has bought you
 * (`workElapsed × ratio`). Ending a rest early banks the leftover into the
 * unused-rest pool, which is spent automatically once the earned rest runs out.
 */
export class FlowTimer {
  private state: TimerState = "idle";

  private workAccumulatedMs = 0;
  private workLastStart = 0;
  private workStartTime = 0; // wall-clock: when work first started
  private workEndTime = 0; // wall-clock: when work last paused

  private restTargetMs = 0; // earned rest for this cycle
  private restStartTime = 0; // wall-clock: when rest started, 0 if none
  private poolAtRestStartMs = 0; // pool snapshot — caps this rest

  private unusedRestMs = 0;
  private ratio = 0.2;

  private listeners: Set<TickCallback> = new Set();
  private sessionEndListeners: Set<SessionEndCallback> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(initialRatio: number = 0.2, initialUnusedRestMs: number = 0) {
    this.setRatio(initialRatio);
    this.unusedRestMs = Math.max(0, Math.round(initialUnusedRestMs));
  }

  // --- Public API ---

  start(): void {
    if (this.state !== "idle" && this.state !== "paused") return;
    if (this.state === "idle") {
      this.workStartTime = Date.now();
    }
    this.state = "running";
    this.workLastStart = Date.now();
    this.startInterval();
    this.notify();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.workAccumulatedMs += Date.now() - this.workLastStart;
    this.workEndTime = Date.now();
    this.restTargetMs = Math.round(this.workAccumulatedMs * this.ratio);
    this.state = "paused";
    this.stopInterval();
    this.notify();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.state = "running";
    this.workLastStart = Date.now();
    this.startInterval();
    this.notify();
  }

  /**
   * Begin the rest. The pool balance is snapshotted here so the round's
   * maximum rest is fixed up front — that is what stops an endless rest.
   */
  startRest(): void {
    if (this.state !== "paused") return;
    if (this.restTargetMs + this.unusedRestMs <= 0) return;

    this.poolAtRestStartMs = this.unusedRestMs;
    this.restStartTime = Date.now();
    this.state = "resting";
    this.startInterval();
    this.notify();
  }

  stop(): void {
    const now = Date.now();

    // Bank whatever rest is left before tearing the cycle down.
    this.settleRestPool(now);

    if (this.workAccumulatedMs > 0) {
      const hasRest = this.restStartTime > 0;
      const data: SessionEndData = {
        workStartTime: this.workStartTime,
        workEndTime: this.workEndTime || now,
        workDurationMs: this.workAccumulatedMs,
        restTargetMs: this.restTargetMs,
        restStartTime: this.restStartTime,
        restEndTime: hasRest ? now : 0,
        restDurationMs: hasRest ? Math.max(0, now - this.restStartTime) : 0,
        ratio: this.ratio,
        unusedRestMs: this.unusedRestMs,
      };
      for (const cb of this.sessionEndListeners) {
        cb(data);
      }
    }

    this.state = "idle";
    this.stopInterval();
    this.workAccumulatedMs = 0;
    this.workLastStart = 0;
    this.workStartTime = 0;
    this.workEndTime = 0;
    this.restTargetMs = 0;
    this.restStartTime = 0;
    this.poolAtRestStartMs = 0;
    this.notify();
  }

  /**
   * The ratio can only be set before a cycle starts — once work is underway
   * the rest you are earning is locked in.
   *
   * @returns whether the change was applied.
   */
  setRatio(r: number): boolean {
    if (this.state !== "idle") return false;
    this.ratio = Math.min(1.0, Math.max(0.05, r));
    this.notify();
    return true;
  }

  /** Drop the pool to zero (used by the daily reset). */
  clearUnusedRest(): void {
    if (this.unusedRestMs === 0) return;
    this.unusedRestMs = 0;
    this.notify();
  }

  /**
   * Manually adjust the pool (quick-add). The balance floors at zero. During a
   * rest the snapshot is adjusted in step, so a manual add extends the running
   * round instead of being overwritten when the rest settles.
   */
  addUnusedRestMs(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return;
    const delta = Math.round(deltaMs);
    this.unusedRestMs = Math.max(0, this.unusedRestMs + delta);
    if (this.state === "resting") {
      this.poolAtRestStartMs = Math.max(0, this.poolAtRestStartMs + delta);
    }
    this.notify();
  }

  getSnapshot(): TimerSnapshot {
    return this.buildSnapshot();
  }

  onTick(cb: TickCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onSessionEnd(cb: SessionEndCallback): () => void {
    this.sessionEndListeners.add(cb);
    return () => {
      this.sessionEndListeners.delete(cb);
    };
  }

  // --- Private ---

  /**
   * Fold a finished rest into the pool.
   *
   *   pool = poolAtStart − spentFromPool + unspentEarnedRest
   *
   * Ending early leaves the unused earned rest behind; running past the earned
   * rest spends the pool instead. Either way the two never mix inside a round.
   */
  private settleRestPool(now: number): void {
    if (this.restStartTime <= 0) return;

    const elapsed = Math.max(0, now - this.restStartTime);
    const spentEarned = Math.min(elapsed, this.restTargetMs);
    const spentPool = Math.min(
      Math.max(0, elapsed - this.restTargetMs),
      this.poolAtRestStartMs,
    );
    const unspentEarned = this.restTargetMs - spentEarned;

    this.unusedRestMs = Math.max(0, this.poolAtRestStartMs - spentPool + unspentEarned);
  }

  private buildSnapshot(): TimerSnapshot {
    const now = Date.now();

    let workElapsedMs = this.workAccumulatedMs;
    if (this.state === "running") {
      workElapsedMs += now - this.workLastStart;
    }

    const restEarnedMs = Math.round(workElapsedMs * this.ratio);

    let restRemainingMs = 0;
    let restPhase: RestPhase = "earned";

    if (this.state === "paused") {
      restRemainingMs = this.restTargetMs;
    } else if (this.state === "resting") {
      const elapsed = now - this.restStartTime;
      if (elapsed < this.restTargetMs) {
        restPhase = "earned";
        restRemainingMs = this.restTargetMs - elapsed;
      } else {
        restPhase = "unused";
        restRemainingMs = Math.max(
          0,
          this.poolAtRestStartMs - (elapsed - this.restTargetMs),
        );
      }
    }

    // The single number a glanceable readout (the mini overlay) should show.
    // At idle the only rest you own is the banked pool, so that is the figure
    // worth surfacing rather than a dead 00:00.
    let displayMs = this.unusedRestMs;
    if (this.state === "resting") {
      displayMs = restRemainingMs;
    } else if (this.state === "running" || this.state === "paused") {
      displayMs = restEarnedMs;
    }

    return {
      state: this.state,
      workElapsedMs,
      restEarnedMs,
      restTargetMs: this.restTargetMs,
      restRemainingMs,
      restPhase,
      restBudgetMs: this.restTargetMs + this.poolAtRestStartMs,
      unusedRestMs: this.unusedRestMs,
      displayMs,
      ratio: this.ratio,
    };
  }

  private restBudgetMs(): number {
    return this.restTargetMs + this.poolAtRestStartMs;
  }

  private startInterval(): void {
    this.stopInterval();
    this.intervalId = setInterval(() => {
      // Auto-stop once the earned rest *and* the spendable pool are used up.
      if (
        this.state === "resting" &&
        Date.now() - this.restStartTime >= this.restBudgetMs()
      ) {
        this.stop();
        return;
      }
      this.notify();
    }, TICK_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private notify(): void {
    const snap = this.buildSnapshot();
    for (const cb of this.listeners) {
      cb(snap);
    }
  }
}
