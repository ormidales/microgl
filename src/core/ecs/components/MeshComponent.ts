import type { Component } from '../types';

/**
 * Holds the geometry data (vertex positions and optional indices) for an entity.
 * Stores optional POSITION accessor bounds for future spatial culling.
 */
export class MeshComponent implements Component {
  private static readonly EMPTY_FLOAT32 = new Float32Array(0);
  private static readonly EMPTY_UINT16 = new Uint16Array(0);

  public readonly type = 'Mesh';

  constructor(
    public vertices: Float32Array = MeshComponent.EMPTY_FLOAT32,
    public indices: Uint8Array | Uint16Array | Uint32Array = MeshComponent.EMPTY_UINT16,
    public normals: Float32Array = MeshComponent.EMPTY_FLOAT32,
    public uvs: Float32Array = MeshComponent.EMPTY_FLOAT32,
    public min: number[] = [],
    public max: number[] = [],
  ) {}
}
