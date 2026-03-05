import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('supports configuring the delta time cap', () => {
    const time = new Time(0.2);
    time.update(1000);
    time.update(11000);

    expect(time.deltaTime).toBe(0.2);
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

  it('computes elapsed via absolute difference to avoid floating-point drift', () => {
    const time = new Time();
    const start = 1000;
    const frameCount = 100_000;
    const frameMs = 1;
    time.update(start);
    for (let i = 1; i <= frameCount; i++) {
      time.update(start + i * frameMs);
    }

    expect(time.elapsed).toBe((frameCount * frameMs) / 1000);
  });

  it('requires explicit timestamps for pause and resume', () => {
    const time = new Time();

    const assertNowMsRequired = () => {
      // @ts-expect-error nowMs is required
      time.pause();
      // @ts-expect-error nowMs is required
      time.resume();
    };

    expect(assertNowMsRequired).toBeTypeOf('function');
    expect(time.pause.length).toBe(1);
    expect(time.resume.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Time – visibilitychange integration
// ---------------------------------------------------------------------------

describe('Time visibilitychange', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw when document is unavailable at construction', () => {
    vi.stubGlobal('document', undefined);
    expect(() => new Time()).not.toThrow();
  });

  it('pauses the clock when the document becomes hidden', () => {
    const docTarget = new EventTarget();
    const mockDoc = {
      addEventListener: docTarget.addEventListener.bind(docTarget),
      removeEventListener: docTarget.removeEventListener.bind(docTarget),
      hidden: false,
    };
    vi.stubGlobal('document', mockDoc);
    // performance.now() called at pause: 1020 ms; at resume: 6020 ms
    vi.stubGlobal('performance', { now: vi.fn().mockReturnValueOnce(1020).mockReturnValueOnce(6020) });

    const time = new Time();
    time.update(1000);
    time.update(1016); // deltaTime = 0.016

    // Simulate tab switch away at ~1020 ms
    mockDoc.hidden = true;
    docTarget.dispatchEvent(new Event('visibilitychange'));

    // Simulate tab switch back 5 seconds later at ~6020 ms
    mockDoc.hidden = false;
    docTarget.dispatchEvent(new Event('visibilitychange'));

    // The next rAF fires right after resume; deltaTime must not spike
    time.update(6036);
    expect(time.deltaTime).toBe(0.02);
  });

  it('does not spike elapsed time after a tab switch', () => {
    const docTarget = new EventTarget();
    const mockDoc = {
      addEventListener: docTarget.addEventListener.bind(docTarget),
      removeEventListener: docTarget.removeEventListener.bind(docTarget),
      hidden: false,
    };
    vi.stubGlobal('document', mockDoc);
    // performance.now() called at pause: 2000 ms; at resume: 12000 ms
    vi.stubGlobal('performance', { now: vi.fn().mockReturnValueOnce(2000).mockReturnValueOnce(12000) });

    const time = new Time();
    time.update(1000);
    time.update(2000); // elapsed = 1 s (deltaTime capped to 0.1)

    // Pause at 2000 ms
    mockDoc.hidden = true;
    docTarget.dispatchEvent(new Event('visibilitychange'));

    // Resume 10 s later at 12000 ms
    mockDoc.hidden = false;
    docTarget.dispatchEvent(new Event('visibilitychange'));

    // After resume the rAF fires at 12020 ms
    time.update(12020);
    // elapsed should be ~1.02 s (not ~11 s)
    expect(time.elapsed).toBeCloseTo(1.02, 5);
  });

  it('dispose removes the visibilitychange listener', () => {
    const removeEventListener = vi.fn();
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener,
      hidden: false,
    });

    const time = new Time();
    time.dispose();

    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('dispose is safe when document is unavailable', () => {
    vi.stubGlobal('document', undefined);
    const time = new Time();
    expect(() => time.dispose()).not.toThrow();
  });
});
