/**
 * Manages WebGL 2 context, canvas lifecycle, and viewport resizing.
 */
export class Renderer {
  public readonly canvas: HTMLCanvasElement;
  public readonly gl: WebGL2RenderingContext;

  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement = document.body) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('webgl2');
    if (!ctx) {
      throw new Error('WebGL 2 is not supported by this browser.');
    }
    this.gl = ctx;

    this.resizeViewport();

    this.resizeObserver = new ResizeObserver(() => this.resizeViewport());
    this.resizeObserver.observe(this.canvas);
  }

  /** Synchronize the drawing buffer size with the canvas CSS size. */
  private resizeViewport(): void {
    const dpr = window.devicePixelRatio ?? 1;
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);

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

  /** Stop observing resize events and remove the canvas. */
  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}
