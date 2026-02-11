import type { Component } from '../types';

/**
 * Stores the position, rotation (Euler angles in radians), and scale of an entity.
 */
export class TransformComponent implements Component {
  public readonly type = 'Transform';

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
}
