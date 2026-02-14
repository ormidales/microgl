import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer';

function createMockGL(): WebGL2RenderingContext {
  return {
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
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
  public readonly observe = vi.fn();
  public readonly disconnect = vi.fn();
}

describe('Renderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prevents default on context loss and notifies listeners', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;

    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    const onLost = vi.fn();
    renderer.onContextLost(onLost);

    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('reacquires context on restore and notifies listeners with new context', () => {
    const gl1 = createMockGL();
    const gl2 = createMockGL();
    const canvas = new MockCanvas([gl1, gl2]);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;

    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const renderer = new Renderer(container);
    const onRestored = vi.fn();
    renderer.onContextRestored(onRestored);

    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.gl).toBe(gl2);
    expect(onRestored).toHaveBeenCalledWith(gl2);
  });

  it('ignores viewport resize when canvas dimensions are zero', () => {
    const gl = createMockGL();
    const canvas = new MockCanvas([gl]);
    canvas.clientWidth = 0;
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;

    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), body: container });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    new Renderer(container);

    expect(gl.viewport).not.toHaveBeenCalled();
  });
});
