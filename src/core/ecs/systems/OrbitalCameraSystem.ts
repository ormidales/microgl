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
  private readonly eye = vec3.create();
  private readonly center = vec3.create();
  private readonly up = vec3.set(vec3.create(), 0, 1, 0);

  // Bound handlers (kept for removal in `detach`)
  private readonly onMouseDown = this.handleMouseDown.bind(this);
  private readonly onMouseMove = this.handleMouseMove.bind(this);
  private readonly onMouseUp = this.handleMouseUp.bind(this);
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
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Remove previously registered event listeners. */
  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas = null;
  }

  // ---------------------------------------------------------------------------
  // System update
  // ---------------------------------------------------------------------------

  update(em: EntityManager, _deltaTime: number): void {
    const entities = em.getEntitiesWith(...this.requiredComponents);

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

      // Spherical → Cartesian
      const sinPhi = Math.sin(cam.phi);
      const eyeX = cam.target[0] + cam.radius * sinPhi * Math.sin(cam.theta);
      const eyeY = cam.target[1] + cam.radius * Math.cos(cam.phi);
      const eyeZ = cam.target[2] + cam.radius * sinPhi * Math.cos(cam.theta);

      vec3.set(this.eye, eyeX, eyeY, eyeZ);
      vec3.set(this.center, cam.target[0], cam.target[1], cam.target[2]);
      mat4.lookAt(cam.view, this.eye, this.center, this.up);

      // Rebuild projection (aspect may change on resize)
      const aspect = this.canvas
        ? this.canvas.clientWidth / (this.canvas.clientHeight || 1)
        : 1;
      mat4.perspective(cam.projection, cam.fov, aspect, cam.near, cam.far);
    }

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

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    this.deltaZoom += e.deltaY * this.zoomSensitivity;
  }
}
