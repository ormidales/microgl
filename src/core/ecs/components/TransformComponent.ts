import type { Component } from '../types';
import { mat4 } from 'gl-matrix';

/**
 * Stores the position, rotation (Euler angles in radians), and scale of an entity.
 */
export class TransformComponent implements Component {
  public readonly type = 'Transform';
  public readonly modelMatrix = mat4.create();
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastZ = Number.NaN;
  private lastRotationX = Number.NaN;
  private lastRotationY = Number.NaN;
  private lastRotationZ = Number.NaN;
  private lastScaleX = Number.NaN;
  private lastScaleY = Number.NaN;
  private lastScaleZ = Number.NaN;

  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0,
    public rotationX: number = 0,
    public rotationY: number = 0,
    public rotationZ: number = 0,
    public scaleX: number = 1,
    public scaleY: number = 1,
    public scaleZ: number = 1,
  ) {}

  needsModelMatrixUpdate(): boolean {
    return this.x !== this.lastX
      || this.y !== this.lastY
      || this.z !== this.lastZ
      || this.rotationX !== this.lastRotationX
      || this.rotationY !== this.lastRotationY
      || this.rotationZ !== this.lastRotationZ
      || this.scaleX !== this.lastScaleX
      || this.scaleY !== this.lastScaleY
      || this.scaleZ !== this.lastScaleZ;
  }

  markModelMatrixClean(): void {
    this.lastX = this.x;
    this.lastY = this.y;
    this.lastZ = this.z;
    this.lastRotationX = this.rotationX;
    this.lastRotationY = this.rotationY;
    this.lastRotationZ = this.rotationZ;
    this.lastScaleX = this.scaleX;
    this.lastScaleY = this.scaleY;
    this.lastScaleZ = this.scaleZ;
  }
}
