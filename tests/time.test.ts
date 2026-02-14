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
});
