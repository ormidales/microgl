import type { Component, Quaternion } from '../types';
import { mat4 } from 'gl-matrix';

/**
 * Stores the position, rotation (quaternion `[x, y, z, w]`), and scale of an entity.
 *
 * The `rotation` property is typed as `Quaternion` (a strict `[number, number, number, number]`
 * tuple) so that the TypeScript compiler rejects any assignment of a plain `number[]` that
 * might have the wrong length, preventing silent matrix-computation failures in systems such
 * as {@link RenderSystem}. The caller is responsible for keeping the quaternion normalised.
 */
export class TransformComponent implements Component {
  public readonly type = 'Transform';
  public readonly modelMatrix = mat4.create();
  private dirty = true;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastRotation: Quaternion = [0, 0, 0, 1];
  private lastScaleX = 1;
  private lastScaleY = 1;
  private lastScaleZ = 1;

  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0,
    public rotation: Quaternion = [0, 0, 0, 1],
    public scaleX: number = 1,
    public scaleY: number = 1,
    public scaleZ: number = 1,
  ) {}

  needsModelMatrixUpdate(): boolean {
    return this.dirty
      || this.x !== this.lastX
      || this.y !== this.lastY
      || this.z !== this.lastZ
      || this.rotation[0] !== this.lastRotation[0]
      || this.rotation[1] !== this.lastRotation[1]
      || this.rotation[2] !== this.lastRotation[2]
      || this.rotation[3] !== this.lastRotation[3]
      || this.scaleX !== this.lastScaleX
      || this.scaleY !== this.lastScaleY
      || this.scaleZ !== this.lastScaleZ;
  }

  markModelMatrixClean(): void {
    this.lastX = this.x;
    this.lastY = this.y;
    this.lastZ = this.z;
    this.lastRotation[0] = this.rotation[0];
    this.lastRotation[1] = this.rotation[1];
    this.lastRotation[2] = this.rotation[2];
    this.lastRotation[3] = this.rotation[3];
    this.lastScaleX = this.scaleX;
    this.lastScaleY = this.scaleY;
    this.lastScaleZ = this.scaleZ;
    this.dirty = false;
  }

  /**
   * Forces the component to be treated as dirty on the next
   * {@link needsModelMatrixUpdate} call, regardless of whether the tracked
   * field values have changed.  Use this after recycling a component instance
   * or after mutating properties through paths that bypass the normal change-
   * detection mechanism (e.g. bulk-assignment from an external script).
   */
  setDirty(): void {
    this.dirty = true;
  }
}
