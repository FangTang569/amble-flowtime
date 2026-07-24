export type TimerState = "idle" | "running" | "paused" | "resting";

export interface TimerSnapshot {
  state: TimerState;
  workElapsedMs: number;
  restRemainingMs: number;
  restTargetMs: number;
  ratio: number; // 0.05 to 1.0
}

export type TickCallback = (snapshot: TimerSnapshot) => void;
