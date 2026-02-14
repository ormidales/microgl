/**
 * Tracks elapsed time and per-frame delta time.
 */
export class Time {
  private static readonly MAX_DELTA_TIME_SECONDS = 0.1;

  /** Seconds elapsed since the last frame. */
  public deltaTime: number = 0;

  /** Total seconds elapsed since the loop started. */
  public elapsed: number = 0;

  private last: number = 0;

  /** Call once at the start of each frame with the rAF timestamp (ms). */
  update(nowMs: number): void {
    if (this.last === 0) {
      this.last = nowMs;
    }
    this.deltaTime = Math.min(
      (nowMs - this.last) / 1000,
      Time.MAX_DELTA_TIME_SECONDS,
    );
    this.elapsed += this.deltaTime;
    this.last = nowMs;
  }

  /** Reset all counters. */
  reset(): void {
    this.deltaTime = 0;
    this.elapsed = 0;
    this.last = 0;
  }
}
