import type { TimerSnapshot, TimerState, TickCallback } from "./types";

const TICK_INTERVAL_MS = 250;

export interface SessionEndData {
  workStartTime: number;   // absolute timestamp (ms)
  workEndTime: number;     // absolute timestamp (ms)
  workDurationMs: number;
  restTargetMs: number;
  restStartTime: number;   // absolute timestamp (ms), 0 if no rest
  restEndTime: number;     // absolute timestamp (ms), 0 if no rest
  restDurationMs: number;
  ratio: number;
}

type SessionEndCallback = (data: SessionEndData) => void;

export class FlowTimer {
  private state: TimerState = "idle";
  private workAccumulatedMs = 0;
  private workLastStart = 0;
  private workStartTime = 0;   // wall-clock: when work first started
  private workEndTime = 0;     // wall-clock: when work last paused
  private restTargetMs = 0;
  private restLastStart = 0;
  private restStartTime = 0;   // wall-clock: when rest started
  private ratio = 0.20;
  private listeners: Set<TickCallback> = new Set();
  private sessionEndListeners: Set<SessionEndCallback> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(initialRatio: number = 0.20) {
    this.setRatio(initialRatio);
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

  startRest(): void {
    if (this.state !== "paused") return;
    this.state = "resting";
    this.restLastStart = Date.now();
    this.restStartTime = Date.now();
    this.startInterval();
    this.notify();
  }

  stop(): void {
    // Emit session end before resetting
    if (this.workAccumulatedMs > 0) {
      const restEndTime = this.restStartTime > 0 ? Date.now() : 0;
      const restDurationMs = this.restStartTime > 0
        ? Date.now() - this.restStartTime
        : 0;
      const data: SessionEndData = {
        workStartTime: this.workStartTime,
        workEndTime: this.workEndTime || Date.now(),
        workDurationMs: this.workAccumulatedMs,
        restTargetMs: this.restTargetMs,
        restStartTime: this.restStartTime,
        restEndTime,
        restDurationMs: Math.max(0, restDurationMs),
        ratio: this.ratio,
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
    this.restLastStart = 0;
    this.restStartTime = 0;
    this.notify();
  }

  setRatio(r: number): void {
    this.ratio = Math.min(1.0, Math.max(0.05, r));
    // Recalculate rest target if currently paused
    if (this.state === "paused") {
      this.restTargetMs = Math.round(this.workAccumulatedMs * this.ratio);
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

  private buildSnapshot(): TimerSnapshot {
    let workElapsedMs = this.workAccumulatedMs;
    let restRemainingMs = 0;

    if (this.state === "running") {
      workElapsedMs += Date.now() - this.workLastStart;
    }

    if (this.state === "resting") {
      const elapsed = Date.now() - this.restLastStart;
      restRemainingMs = Math.max(0, this.restTargetMs - elapsed);
    }

    if (this.state === "paused") {
      restRemainingMs = this.restTargetMs;
    }

    return {
      state: this.state,
      workElapsedMs,
      restRemainingMs,
      restTargetMs: this.restTargetMs,
      ratio: this.ratio,
    };
  }

  private startInterval(): void {
    this.stopInterval();
    this.intervalId = setInterval(() => {
      const snap = this.buildSnapshot();
      // Auto-stop when rest completes
      if (snap.state === "resting" && snap.restRemainingMs <= 0) {
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
