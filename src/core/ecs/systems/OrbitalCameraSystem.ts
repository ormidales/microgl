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
  /** Minimum allowed value for {@link maxElevationDeg}. */
  public static readonly MIN_ELEVATION_DEG: number = 0;
  /** Maximum allowed value for {@link maxElevationDeg}. Kept below 90° to prevent a degenerate up-vector at the poles. */
  public static readonly MAX_ELEVATION_DEG: number = 89.999;

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

  private _maxElevationDeg: number = 89.9;

  /**
   * Maximum elevation angle in degrees (applied symmetrically above and below
   * the equatorial plane).  Keeping this value strictly below 90° prevents the
   * camera from reaching the zenith / nadir poles where the `lookAt` up-vector
   * becomes undefined and causes a sudden axis flip or jitter.
   *
   * Automatically clamped to the range `[{@link OrbitalCameraSystem.MIN_ELEVATION_DEG}, {@link OrbitalCameraSystem.MAX_ELEVATION_DEG}]`
   * to ensure the up-vector never becomes degenerate regardless of what value
   * the caller supplies. See the setter for details on out-of-range handling.
   */
  public get maxElevationDeg(): number {
    return this._maxElevationDeg;
  }

  /**
   * Sets the maximum elevation angle in degrees.
   * Non-finite values (`NaN`, `Infinity`) and values outside
   * `[{@link OrbitalCameraSystem.MIN_ELEVATION_DEG}, {@link OrbitalCameraSystem.MAX_ELEVATION_DEG}]`
   * are clamped and a `console.warn` is emitted; the read-back value may
   * therefore differ from the assigned value.
   */
  public set maxElevationDeg(value: number) {
    const { MIN_ELEVATION_DEG, MAX_ELEVATION_DEG } = OrbitalCameraSystem;
    if (!Number.isFinite(value) || value < MIN_ELEVATION_DEG || value > MAX_ELEVATION_DEG) {
      console.warn(
        `OrbitalCameraSystem: maxElevationDeg ${value} is out of range [${MIN_ELEVATION_DEG}, ${MAX_ELEVATION_DEG}] and will be clamped.`
      );
    }
    // Clamp to a safe range to avoid reaching the poles and degenerating the up-vector.
    if (Number.isFinite(value)) {
      this._maxElevationDeg = Math.min(MAX_ELEVATION_DEG, Math.max(MIN_ELEVATION_DEG, value));
    } else if (value === Infinity) {
      this._maxElevationDeg = MAX_ELEVATION_DEG;
    } else {
      // NaN, -Infinity, or other non-finite values clamp to the minimum.
      this._maxElevationDeg = MIN_ELEVATION_DEG;
    }
  }

  // ---- Internal state -------------------------------------------------------

  private canvas: HTMLCanvasElement | null = null;
  private windowListenersAttached = false;
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

  /**
   * Start listening to mouse/wheel/touch events on the given canvas.
   *
   * **Important:** always call {@link detach} when the owning scene is torn
   * down (e.g. in a `pagehide` handler or equivalent cleanup path).  Failing
   * to do so leaves `mouseup` and `touchend` listeners registered on `window`,
   * and a non-passive `wheel` listener on the canvas, registered indefinitely.
   * This leaks memory and produces ghost input events on subsequent scene reloads.
   */
  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    this.canvas = canvas;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('touchstart', this.onTouchStart, OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS);
    canvas.addEventListener(
      'touchmove',
      this.onTouchMove,
      OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS,
    );
    canvas.addEventListener('wheel', this.onWheel, OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS);
    if (typeof window !== 'undefined') {
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('touchend', this.onTouchEnd, OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS);
      this.windowListenersAttached = true;
    }
  }

  /**
   * Remove all event listeners registered by {@link attach} and release the
   * canvas reference.  Safe to call even when {@link attach} was never invoked
   * or after a previous {@link detach} call (no-op in both cases).
   */
  detach(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.onMouseDown);
      this.canvas.removeEventListener('mousemove', this.onMouseMove);
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
      this.canvas.removeEventListener(
        'wheel',
        this.onWheel,
        OrbitalCameraSystem.NON_PASSIVE_EVENT_OPTIONS,
      );
      this.canvas = null;
    }
    if (this.windowListenersAttached) {
      window.removeEventListener('mouseup', this.onMouseUp);
      window.removeEventListener(
        'touchend',
        this.onTouchEnd,
        OrbitalCameraSystem.PASSIVE_EVENT_OPTIONS,
      );
      this.windowListenersAttached = false;
    }
  }

  // ---------------------------------------------------------------------------
  // System update
  // ---------------------------------------------------------------------------

  /**
   * Apply accumulated input deltas to every `CameraComponent`, rebuild view
   * and projection matrices when needed, then reset the delta accumulators.
   *
   * @param em         The entity manager used to iterate over Camera entities.
   * @param _deltaTime Frame delta time (unused — input is event-driven).
   */
  update(em: EntityManager, _deltaTime: number): void {
    const aspect = this.canvas ? this.canvas.width / (this.canvas.height || 1) : 1;
    const aspectChanged = aspect !== this.lastAspect;
    const hasInputDelta = this.deltaTheta !== 0 || this.deltaPhi !== 0 || this.deltaZoom !== 0;

    // Compute phiMin once per update, outside the entity loop, since it only
    // depends on maxElevationDeg which cannot change mid-update.
    // phi is the polar angle from the north pole; elevation = 90° − phi (degrees).
    // Restricting elevation to [−maxElevationDeg, +maxElevationDeg] keeps the
    // lookAt up-vector well-defined and prevents gimbal flip or camera jitter.
    const phiMin = (90 - this.maxElevationDeg) * (Math.PI / 180);

    em.forEachEntityWith(this.requiredComponents, (id) => {
      const cam = em.getComponent<CameraComponent>(id, 'Camera');
      if (!cam) return;

      // Apply accumulated input deltas
      cam.theta += this.deltaTheta;
      cam.phi += this.deltaPhi;
      cam.radius += this.deltaZoom;

      // Clamp phi to avoid flipping at the poles.
      cam.phi = Math.max(phiMin, Math.min(Math.PI - phiMin, cam.phi));

      // Clamp radius
      cam.radius = Math.max(this.minRadius, Math.min(this.maxRadius, cam.radius));

      const shouldRebuildMatrices =
        hasInputDelta || aspectChanged || !this.initializedCameras.has(id);
      if (!shouldRebuildMatrices) return;

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
    });

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
