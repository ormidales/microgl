import { mat4 } from 'gl-matrix';
import type { Component } from '../types';

/**
 * Stores the projection and view matrices along with orbital camera parameters.
 *
 * Spherical coordinates (`theta`, `phi`, `radius`) define the camera position
 * relative to a `target` point. The system converts these into Cartesian
 * coordinates each frame and rebuilds the view matrix.
 */
export class CameraComponent implements Component {
  public readonly type = 'Camera';

  /** Perspective projection matrix. */
  public projection: mat4 = mat4.create();

  /** View (lookAt) matrix. */
  public view: mat4 = mat4.create();

  /** Horizontal orbit angle in radians. */
  public theta: number;

  /** Vertical orbit angle in radians (clamped to avoid gimbal flip). */
  public phi: number;

  /** Distance from the target point. */
  public radius: number;

  /** Point the camera orbits around [x, y, z]. */
  public target: [number, number, number];

  /** Vertical field of view in radians. */
  public fov: number;

  /** Near clipping plane. */
  public near: number;

  /** Far clipping plane. */
  public far: number;

  constructor(
    fov: number = Math.PI / 4,
    near: number = 0.1,
    far: number = 100,
    radius: number = 5,
    theta: number = 0,
    phi: number = Math.PI / 4,
    target: [number, number, number] = [0, 0, 0],
  ) {
    this.fov = fov;
    this.near = near;
    this.far = far;
    this.radius = radius;
    this.theta = theta;
    this.phi = phi;
    this.target = target;
  }
}
