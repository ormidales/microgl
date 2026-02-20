import { mat4, vec3 } from 'gl-matrix';
import { System } from '../System';
import type { EntityManager } from '../EntityManager';
import type { CameraComponent } from '../components/CameraComponent';

/**
 * Converts the spherical orbital parameters stored in each `CameraComponent`
 * into up-to-date view and projection matrices.
 *
 * When an `HTMLCanvasElement` is provided via {@link attach}, the system also
 * registers mouse and wheel listeners so the user can orbit (left-click drag)
 * and zoom (scroll wheel).
 */
export class OrbitalCameraSystem extends System {
  private static readonly DOM_DELTA_LINE = typeof WheelEvent === 'undefined' ? 1 : WheelEvent.DOM_DELTA_LINE;
  private static readonly DOM_DELTA_PAGE = typeof WheelEvent === 'undefined' ? 2 : WheelEvent.DOM_DELTA_PAGE;
  /** Fixed pixel equivalent of one scroll line (matches the browser default font size). */
  private static readonly WHEEL_LINE_HEIGHT_PX = 16;
  /** Fixed pixel equivalent of one scroll page used for normalisation. */
  private static readonly WHEEL_PAGE_HEIGHT_PX = 600;
  private static readonly NON_PASSIVE_EVENT_OPTIONS: AddEventListenerOptions = {
    passive: false,
  };
  private static readonly PASSIVE_EVENT_OPTIONS: AddEventListenerOptions = {
    passive: true,
  };

  public readonly requiredComponents = ['Camera'] as const;

  // ---- Orbital sensitivity --------------------------------------------------

  /** Radians per pixel of mouse movement. */
  public rotateSensitivity: number = 0.005;

  /** Radius change per wheel delta unit. */
  public zoomSensitivity: number = 0.01;

  /** Minimum allowed orbit radius. */
  public minRadius: number = 0.5;

  /** Maximum allowed orbit radius. */
  public maxRadius: number = 100;

  // ---- Internal state -------------------------------------------------------

  private canvas: HTMLCanvasElement | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  /** Accumulated deltas applied on next `update`. */
  private deltaTheta = 0;
  private deltaPhi = 0;
  private deltaZoom = 0;
  private lastAspect: number | null = null;
  private readonly initializedCameras = new Set<number>();
  private readonly eye = vec3.create();
  private readonly center = vec3.create();
  private readonly up = vec3.set(vec3.create(), 0, 1, 0);

  // Bound handlers (kept for removal in `detach`)
  private readonly onMouseDown = this.handleMouseDown.bind(this);
  private readonly onMouseMove = this.handleMouseMove.bind(this);
  private readonly onMouseUp = this.handleMouseUp.bind(this);
  private readonly onTouchStart = this.handleTouchStart.bind(this);
  private readonly onTouchMove = this.handleTouchMove.bind(this);
  private readonly onTouchEnd = this.handleTouchEnd.bind(this);
  private readonly onWheel = this.handleWheel.bind(this);

  // ---------------------------------------------------------------------------
  // DOM event binding
  // ---------------------------------------------------------------------------

  /** Start listening to mouse/wheel events on the given canvas. */
  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    this.canvas = canvas;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('touchstart', this.onTouchStart, OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS);
    canvas.addEventListener(
      'touchmove',
      this.onTouchMove,
      OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS,
    );
    window.addEventListener('touchend', this.onTouchEnd, OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS);
    canvas.addEventListener('wheel', this.onWheel, OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS);
  }

  /** Remove previously registered event listeners. */
  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener(
      'touchstart',
      this.onTouchStart,
      OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS,
    );
    this.canvas.removeEventListener(
      'touchmove',
      this.onTouchMove,
      OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS,
    );
    window.removeEventListener(
      'touchend',
      this.onTouchEnd,
      OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS,
    );
    this.canvas.removeEventListener(
      'wheel',
      this.onWheel,
      OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS,
    );
    this.canvas = null;
  }

  // ---------------------------------------------------------------------------
  // System update
  // ---------------------------------------------------------------------------

  update(em: EntityManager, _deltaTime: number): void {
    const entities = em.getEntitiesWith(...this.requiredComponents);
    const aspect = this.canvas ? this.canvas.width / (this.canvas.height || 1) : 1;
    const aspectChanged = aspect !== this.lastAspect;
    const hasInputDelta = this.deltaTheta !== 0 || this.deltaPhi !== 0 || this.deltaZoom !== 0;

    for (const id of entities) {
      const cam = em.getComponent<CameraComponent>(id, 'Camera');
      if (!cam) continue;

      // Apply accumulated input deltas
      cam.theta += this.deltaTheta;
      cam.phi += this.deltaPhi;
      cam.radius += this.deltaZoom;

      // Clamp phi to avoid flipping (small epsilon away from poles)
      const EPS = 0.0001;
      cam.phi = Math.max(EPS, Math.min(Math.PI - EPS, cam.phi));

      // Clamp radius
      cam.radius = Math.max(this.minRadius, Math.min(this.maxRadius, cam.radius));

      const shouldRebuildMatrices =
        hasInputDelta || aspectChanged || !this.initializedCameras.has(id);
      if (!shouldRebuildMatrices) continue;

      // Spherical → Cartesian
      const sinPhi = Math.sin(cam.phi);
      const eyeX = cam.target[0] + cam.radius * sinPhi * Math.sin(cam.theta);
      const eyeY = cam.target[1] + cam.radius * Math.cos(cam.phi);
      const eyeZ = cam.target[2] + cam.radius * sinPhi * Math.cos(cam.theta);

      vec3.set(this.eye, eyeX, eyeY, eyeZ);
      vec3.set(this.center, cam.target[0], cam.target[1], cam.target[2]);
      mat4.lookAt(cam.view, this.eye, this.center, this.up);

      // Rebuild projection (aspect may change on resize)
      mat4.perspective(cam.projection, cam.fov, aspect, cam.near, cam.far);
      this.initializedCameras.add(id);
    }

    this.lastAspect = aspect;

    // Reset accumulated deltas after applying them
    this.deltaTheta = 0;
    this.deltaPhi = 0;
    this.deltaZoom = 0;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // left-click only
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.deltaTheta -= dx * this.rotateSensitivity;
    this.deltaPhi -= dy * this.rotateSensitivity;
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.dragging = false;
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    this.dragging = true;
    this.lastX = e.touches[0].clientX;
    this.lastY = e.touches[0].clientY;
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - this.lastX;
    const dy = e.touches[0].clientY - this.lastY;
    this.lastX = e.touches[0].clientX;
    this.lastY = e.touches[0].clientY;

    this.deltaTheta -= dx * this.rotateSensitivity;
    this.deltaPhi -= dy * this.rotateSensitivity;
  }

  private handleTouchEnd(_e: TouchEvent): void {
    this.dragging = false;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const deltaPixels = this.normalizeWheelDeltaYToPixels(e.deltaY, e.deltaMode);
    this.deltaZoom +=
      (deltaPixels / OrbitalCameraSystem.WHEEL_PAGE_HEIGHT_PX) * this.zoomSensitivity;
  }

  private normalizeWheelDeltaYToPixels(deltaY: number, deltaMode: number): number {
    if (deltaMode === OrbitalCameraSystem.DOM_DELTA_LINE) {
      return deltaY * OrbitalCameraSystem.WHEEL_LINE_HEIGHT_PX;
    }
    if (deltaMode === OrbitalCameraSystem.DOM_DELTA_PAGE) {
      return deltaY * OrbitalCameraSystem.WHEEL_PAGE_HEIGHT_PX;
    }
    return deltaY;
  }
}
