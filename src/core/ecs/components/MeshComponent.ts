import type { Component } from '../types';

/**
 * Holds the geometry data (vertex positions and optional indices) for an entity.
 * Stores optional POSITION accessor bounds for future spatial culling.
 */
export class MeshComponent implements Component {
  public readonly type = 'Mesh';

  constructor(
    public vertices: Float32Array = new Float32Array(0),
    public indices: Uint16Array | Uint32Array = new Uint16Array(0),
    public normals: Float32Array = new Float32Array(0),
    public uvs: Float32Array = new Float32Array(0),
    public min: number[] = [],
    public max: number[] = [],
  ) {}
}
