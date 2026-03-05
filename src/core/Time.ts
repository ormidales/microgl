/**
 * Tracks elapsed time and per-frame delta time.
 *
 * When constructed in a browser context, automatically listens for
 * `document.visibilitychange` to pause/resume the elapsed clock whenever the
 * user switches tabs. Call {@link dispose} to remove the listener when the
 * render loop is torn down.
 */
export class Time {
  private static readonly DEFAULT_MAX_DELTA_TIME_SECONDS = 0.1;

  /** Seconds elapsed since the last frame. */
  public deltaTime: number = 0;

  /** Total seconds elapsed since the loop started. */
  public elapsed: number = 0;

  private readonly maxDeltaTimeSeconds: number;
  private last: number = 0;
  private origin: number = 0;
  private totalPausedMs: number = 0;
  private pausedAt: number | null = null;

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.pause(performance.now());
    } else {
      this.resume(performance.now());
    }
  };

  constructor(maxDeltaTimeSeconds = Time.DEFAULT_MAX_DELTA_TIME_SECONDS) {
    this.maxDeltaTimeSeconds = maxDeltaTimeSeconds;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** Remove the `visibilitychange` listener registered in the constructor. */
  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** Call once at the start of each frame with the rAF timestamp (ms). */
  update(nowMs: number): void {
    if (this.last === 0) {
      this.last = nowMs;
      this.origin = nowMs;
    }
    this.deltaTime = Math.min(
      (nowMs - this.last) / 1000,
      this.maxDeltaTimeSeconds,
    );
    this.elapsed = (nowMs - this.origin - this.totalPausedMs) / 1000;
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
      const pauseDuration = Math.max(0, nowMs - this.pausedAt);
      if (this.origin !== 0) {
        this.totalPausedMs += pauseDuration;
      }
      if (this.last !== 0) {
        this.last += pauseDuration;
      }
      this.pausedAt = null;
    }
  }

  /** Reset all counters. */
  reset(): void {
    this.deltaTime = 0;
    this.elapsed = 0;
    this.last = 0;
    this.origin = 0;
    this.totalPausedMs = 0;
    this.pausedAt = null;
  }
}
