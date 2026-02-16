/**
 * Tracks elapsed time and per-frame delta time.
 */
export class Time {
  private static readonly DEFAULT_MAX_DELTA_TIME_SECONDS = 0.1;

  /** Seconds elapsed since the last frame. */
  public deltaTime: number = 0;

  /** Total seconds elapsed since the loop started. */
  public elapsed: number = 0;

  private readonly maxDeltaTimeSeconds: number;
  private last: number = 0;
  private pausedAt: number | null = null;

  constructor(maxDeltaTimeSeconds = Time.DEFAULT_MAX_DELTA_TIME_SECONDS) {
    this.maxDeltaTimeSeconds = maxDeltaTimeSeconds;
  }

  /** Call once at the start of each frame with the rAF timestamp (ms). */
  update(nowMs: number): void {
    if (this.last === 0) {
      this.last = nowMs;
    }
    this.deltaTime = Math.min(
      (nowMs - this.last) / 1000,
      this.maxDeltaTimeSeconds,
    );
    this.elapsed += this.deltaTime;
    this.last = nowMs;
  }

  /** Pause elapsed time accumulation until resumed. */
  pause(nowMs: number): void {
    if (this.pausedAt === null) {
      this.pausedAt = nowMs;
    }
  }

  /** Resume elapsed time accumulation after a pause. */
  resume(nowMs: number): void {
    if (this.pausedAt !== null) {
      if (this.last !== 0) {
        this.last += Math.max(0, nowMs - this.pausedAt);
      }
      this.pausedAt = null;
    }
  }

  /** Reset all counters. */
  reset(): void {
    this.deltaTime = 0;
    this.elapsed = 0;
    this.last = 0;
    this.pausedAt = null;
  }
}
