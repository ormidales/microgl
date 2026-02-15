/**
 * Manages WebGL 2 context, canvas lifecycle, and viewport resizing.
 */
export class Renderer {
  public readonly canvas: HTMLCanvasElement;
  public gl: WebGL2RenderingContext;

  private resizeObserver: ResizeObserver;
  private readonly contextAttributes?: WebGLContextAttributes;
  private readonly contextLostHandlers: Set<() => void> = new Set();
  private readonly contextRestoredHandlers: Set<(gl: WebGL2RenderingContext) => void> = new Set();

  constructor(container: HTMLElement = document.body, contextAttributes?: WebGLContextAttributes) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);
    this.contextAttributes = contextAttributes;

    const ctx = this.canvas.getContext('webgl2', this.contextAttributes);
    if (!ctx) {
      throw new Error('WebGL 2 is not supported by this browser.');
    }
    this.gl = ctx;
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost as EventListener);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.resizeViewport();

    this.resizeObserver = new ResizeObserver((entries) => this.resizeViewport(entries[0]));
    this.resizeObserver.observe(this.canvas);
  }

  /** Synchronize the drawing buffer size with the canvas CSS size. */
  private resizeViewport(entry?: ResizeObserverEntry): void {
    const devicePixelContentBoxSize = entry?.devicePixelContentBoxSize?.[0];
    const width = Math.round(
      devicePixelContentBoxSize?.inlineSize ?? this.canvas.clientWidth * (window.devicePixelRatio ?? 1)
    );
    const height = Math.round(
      devicePixelContentBoxSize?.blockSize ?? this.canvas.clientHeight * (window.devicePixelRatio ?? 1)
    );
    if (width === 0 || height === 0) return;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Clear the framebuffer with the given RGBA color. */
  clear(r: number, g: number, b: number, a: number = 1.0): void {
    this.gl.clearColor(r, g, b, a);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  /** Register a callback invoked when the WebGL context is lost. Returns an unsubscribe function. */
  onContextLost(handler: () => void): () => void {
    this.contextLostHandlers.add(handler);
    return () => this.contextLostHandlers.delete(handler);
  }

  /** Register a callback invoked after the WebGL context is restored. Returns an unsubscribe function. */
  onContextRestored(handler: (gl: WebGL2RenderingContext) => void): () => void {
    this.contextRestoredHandlers.add(handler);
    return () => this.contextRestoredHandlers.delete(handler);
  }

  /** Stop observing resize events and remove the canvas. */
  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.contextLostHandlers.clear();
    this.contextRestoredHandlers.clear();
    this.canvas.remove();
  }

  private readonly handleContextLost = (event: WebGLContextEvent): void => {
    event.preventDefault();
    for (const handler of this.contextLostHandlers) {
      handler();
    }
  };

  private readonly handleContextRestored = (): void => {
    const ctx = this.canvas.getContext('webgl2', this.contextAttributes);
    if (!ctx) {
      throw new Error('Failed to restore WebGL 2 context.');
    }

    this.gl = ctx;
    this.resizeViewport();
    for (const handler of this.contextRestoredHandlers) {
      handler(ctx);
    }
  };
}
