import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer';

function createMockGL(contextLost = false): WebGL2RenderingContext {
  return {
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    isContextLost: vi.fn(() => contextLost),
  } as unknown as WebGL2RenderingContext;
}

class MockCanvas extends EventTarget {
  public style = { display: '', width: '', height: '' };
  public width = 0;
  public height = 0;
  public clientWidth = 200;
  public clientHeight = 100;
  public readonly remove = vi.fn();
  public readonly getContext: ReturnType<typeof vi.fn>;

  constructor(contexts: Array<WebGL2RenderingContext | null>) {
    super();
    const queue = [...contexts];
    this.getContext = vi.fn(() => queue.shift() ?? null);
  }
}

class MockResizeObserver {
  public static instances: MockResizeObserver[] = [];
  public readonly observe = vi.fn();
  public readonly unobserve = vi.fn();
  private _disconnected = false;
  public readonly disconnect = vi.fn(() => {
    this._disconnected = true;
  });
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  public trigger(entries: ResizeObserverEntry[]): void {
    if (!this._disconnected) {
      this.callback(entries, this as unknown as ResizeObserver);
    }
  }
}

/** Creates a mock MediaQueryList that captures the 'change' listener for manual triggering. */
function createMockMediaQuery(): {
  mq: MediaQueryList;
  triggerChange: () => void;
  removeEventListenerMock: ReturnType<typeof vi.fn>;
} {
  let changeHandler: (() => void) | null = null;
  const removeEventListenerMock = vi.fn((event: string, handler: () => void) => {
    if (event === 'change' && changeHandler === handler) changeHandler = null;
  });
  const mq = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'change') changeHandler = handler;
    }),
    removeEventListener: removeEventListenerMock,
  } as unknown as MediaQueryList;
  return {
    mq,
    triggerChange: () => {
      if (changeHandler) changeHandler();
    },
    removeEventListenerMock,
  };
}

describe('Renderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockResizeObserver.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prevents default on context loss and notifies listeners', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    const onLost = vi.fn();
    renderer.onContextLost(onLost);

    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', undefined);
  });

  it('passes custom context attributes on creation and restore', () => {
    const gl1 = createMockGL();
    const gl2 = createMockGL();
    const canvas = new MockCanvas([gl1, gl2]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const contextAttributes: WebGLContextAttributes = {
      alpha: false,
      depth: false,
      antialias: false,
      preserveDrawingBuffer: true,
    };
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container, contextAttributes);
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(canvas.getContext).toHaveBeenNthCalledWith(1, 'webgl2', contextAttributes);
    expect(canvas.getContext).toHaveBeenNthCalledWith(2, 'webgl2', contextAttributes);
  });

  it('reacquires context on restore and notifies listeners with new context', () => {
    const gl1 = createMockGL();
    const gl2 = createMockGL();
    const canvas = new MockCanvas([gl1, gl2]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    const onRestored = vi.fn();
    renderer.onContextRestored(onRestored);

    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.gl).toBe(gl2);
    expect(onRestored).toHaveBeenCalledWith(gl2);
  });

  it('ignores viewport resize when canvas width is zero', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 0;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);

    expect(gl.viewport).not.toHaveBeenCalled();
  });

  it('ignores viewport resize when canvas height is zero', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientHeight = 0;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);

    expect(gl.viewport).not.toHaveBeenCalled();
  });

  it('uses dynamic device pixel ratio from resize observer entry', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);

    MockResizeObserver.instances[0].trigger([
      { devicePixelContentBoxSize: [{ inlineSize: 400, blockSize: 200 }] } as unknown as ResizeObserverEntry,
    ]);

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 400, 200);
  });

  it('does not call gl.viewport when dimensions are unchanged', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);
    // The constructor calls resizeViewport() which may call gl.viewport once.
    const callsAfterInit = (gl.viewport as ReturnType<typeof vi.fn>).mock.calls.length;

    MockResizeObserver.instances[0].trigger([
      { devicePixelContentBoxSize: [{ inlineSize: 400, blockSize: 200 }] } as unknown as ResizeObserverEntry,
    ]);
    expect(gl.viewport).toHaveBeenCalledTimes(callsAfterInit + 1);

    // Trigger again with same dimensions — viewport should NOT be called again
    MockResizeObserver.instances[0].trigger([
      { devicePixelContentBoxSize: [{ inlineSize: 400, blockSize: 200 }] } as unknown as ResizeObserverEntry,
    ]);
    expect(gl.viewport).toHaveBeenCalledTimes(callsAfterInit + 1);
  });

  it('sets resizeObserver to null after dispose to allow garbage collection', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    renderer.dispose();

    expect((renderer as unknown as Record<string, unknown>).resizeObserver).toBeNull();
  });

  it('unobserves canvas and disconnects observer only once on repeated dispose', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);

    renderer.dispose();
    renderer.dispose();

    expect(MockResizeObserver.instances[0].unobserve).toHaveBeenCalledWith(container);
    expect(MockResizeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(MockResizeObserver.instances[0].unobserve).toHaveBeenCalledTimes(1);
  });

  it('observes the container element to prevent ResizeObserver feedback loops', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);

    expect(MockResizeObserver.instances[0].observe).toHaveBeenCalledWith(container);
    expect(MockResizeObserver.instances[0].observe).not.toHaveBeenCalledWith(canvas);
  });

  it('updates viewport when devicePixelRatio changes to a higher value', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 200;
    canvas.clientHeight = 100;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq, triggerChange } = createMockMediaQuery();
    const win = { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) };

    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);

    // Simulate the window moving to a Retina/4K screen — DPR doubles
    win.devicePixelRatio = 2;
    triggerChange();

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 400, 200);
  });

  it('re-registers the DPR observer after each change to track further DPR transitions', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 200;
    canvas.clientHeight = 100;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;

    const mqInstances: MediaQueryList[] = [];
    const triggerFns: Array<() => void> = [];
    const win = { devicePixelRatio: 1, matchMedia: vi.fn() };
    win.matchMedia.mockImplementation(() => {
      const { mq, triggerChange } = createMockMediaQuery();
      mqInstances.push(mq);
      triggerFns.push(triggerChange);
      return mq;
    });

    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);
    expect(mqInstances.length).toBe(1);

    // First DPR change: 1 → 2
    win.devicePixelRatio = 2;
    triggerFns[0]();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(mqInstances.length).toBe(2);

    // Second DPR change: 2 → 1
    win.devicePixelRatio = 1;
    triggerFns[1]();
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(mqInstances.length).toBe(3);
  });

  it('removes the DPR media query listener on dispose', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 200;
    canvas.clientHeight = 100;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq, triggerChange, removeEventListenerMock } = createMockMediaQuery();
    const win = { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) };

    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    renderer.dispose();

    // The 'change' listener must have been unregistered
    expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));

    // After dispose, a DPR change must no longer update the viewport
    const callsBeforeDprChange = (gl.viewport as ReturnType<typeof vi.fn>).mock.calls.length;
    win.devicePixelRatio = 2;
    triggerChange();
    expect(gl.viewport).toHaveBeenCalledTimes(callsBeforeDprChange);
  });

  it('does not update viewport after dispose when resize observer is triggered', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 200;
    canvas.clientHeight = 100;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    renderer.dispose();

    const callsBeforeResize = (gl.viewport as ReturnType<typeof vi.fn>).mock.calls.length;

    // Simulate a resize event after disposal — must not update the viewport
    MockResizeObserver.instances[0].trigger([
      { devicePixelContentBoxSize: [{ inlineSize: 999, blockSize: 888 }] } as unknown as ResizeObserverEntry,
    ]);

    expect(gl.viewport).toHaveBeenCalledTimes(callsBeforeResize);
  });

  it('skips DPR observation when matchMedia is unavailable', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 200;
    canvas.clientHeight = 100;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;

    vi.stubGlobal('window', { devicePixelRatio: 1 }); // no matchMedia
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    expect(() => new Renderer(container)).not.toThrow();
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 200, 100);
  });

  it('isContextLost returns false when context is active', () => {
    const gl = createMockGL(false);
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);

    expect(renderer.isContextLost).toBe(false);
    expect(gl.isContextLost).toHaveBeenCalled();
  });

  it('isContextLost returns true when context is lost', () => {
    const gl = createMockGL(true);
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const { mq } = createMockMediaQuery();

    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => mq) });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);

    expect(renderer.isContextLost).toBe(true);
    expect(gl.isContextLost).toHaveBeenCalled();
  });
});
