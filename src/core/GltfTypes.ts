/**
 * TypeScript interfaces for a subset of the glTF 2.0 specification.
 *
 * Only the structures needed for basic geometry + material loading are
 * included (V1 scope: meshes, accessors, buffer views, buffers).
 */

// ---------------------------------------------------------------------------
// Top-level glTF asset
// ---------------------------------------------------------------------------

export interface GltfAsset {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
}

// ---------------------------------------------------------------------------
// Scenes & Nodes
// ---------------------------------------------------------------------------

export interface GltfScene {
  name?: string;
  nodes?: number[];
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
}

// ---------------------------------------------------------------------------
// Accessors & BufferViews
// ---------------------------------------------------------------------------

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  max?: number[];
  min?: number[];
}

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

export interface GltfBuffer {
  uri?: string;
  byteLength: number;
}

// ---------------------------------------------------------------------------
// Component type constants (matching WebGL / glTF spec)
// ---------------------------------------------------------------------------

export const GL_BYTE = 5120;
export const GL_UNSIGNED_BYTE = 5121;
export const GL_SHORT = 5122;
export const GL_UNSIGNED_SHORT = 5123;
export const GL_UNSIGNED_INT = 5125;
export const GL_FLOAT = 5126;

// ---------------------------------------------------------------------------
// Parsed geometry result
// ---------------------------------------------------------------------------

/** Result of extracting geometry data from a glTF primitive. */
export interface ParsedMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

/** Result of loading and parsing an entire glTF asset. */
export interface GltfLoadResult {
  meshes: ParsedMesh[];
  nodes: GltfNode[];
}
