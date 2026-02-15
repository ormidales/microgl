import { describe, it, expect } from 'vitest';
import { Time } from '../src/core/Time';

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

describe('Time', () => {
  it('uses real delta time when below cap', () => {
    const time = new Time();
    time.update(1000);
    time.update(1050);

    expect(time.deltaTime).toBe(0.05);
  });

  it('caps delta time after long frame gaps', () => {
    const time = new Time();
    time.update(1000);
    time.update(11000);

    expect(time.deltaTime).toBe(0.1);
  });

  it('does not include paused duration in delta time after resume', () => {
    const time = new Time();
    time.update(1000);
    time.update(1016);
    time.pause(1020);
    time.resume(6020);
    time.update(6036);

    expect(time.deltaTime).toBe(0.02);
  });

  it('keeps deltaTime at zero for first update after pausing before any updates', () => {
    const time = new Time();
    time.pause(0);
    time.resume(5000);
    time.update(5016);

    expect(time.deltaTime).toBe(0);
  });

  it('requires explicit timestamps for pause and resume', () => {
    const time = new Time();

    if (false) {
      // @ts-expect-error nowMs is required
      time.pause();
      // @ts-expect-error nowMs is required
      time.resume();
    }
  });
});
