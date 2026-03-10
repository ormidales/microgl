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
  materials?: GltfMaterial[];
  textures?: GltfTexture[];
  images?: GltfImage[];
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
  /** Column-major 4×4 local transform matrix (glTF §5.3.4). Mutually exclusive with TRS. */
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  /**
   * Computed column-major 4×4 local transform matrix injected by the loader.
   * Derived from `matrix`, TRS properties, or the identity matrix when none
   * of those fields are present on the node.
   */
  localMatrix?: number[];
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

export type GltfPrimitiveAttributeSemantic =
  | 'POSITION'
  | 'NORMAL'
  | 'TANGENT'
  | `TEXCOORD_${number}`
  | `COLOR_${number}`
  | `JOINTS_${number}`
  | `WEIGHTS_${number}`
  | `_${string}`;

export interface GltfPrimitive {
  attributes: Partial<Record<GltfPrimitiveAttributeSemantic, number>>;
  indices?: number;
  mode?: number;
  material?: number;
}

// ---------------------------------------------------------------------------
// Materials, Textures, Images
// ---------------------------------------------------------------------------

/** Reference from a material property to a texture + UV set. */
export interface GltfTextureInfo {
  /** Index into the `textures` array. */
  index: number;
  /** The UV-set index (TEXCOORD_N). Defaults to 0. */
  texCoord?: number;
}

/** PBR metallic-roughness material model. */
export interface GltfPbrMetallicRoughness {
  /** RGBA base colour factor multiplied with the base-colour texture. */
  baseColorFactor?: [number, number, number, number];
  /** Reference to the base-colour texture. */
  baseColorTexture?: GltfTextureInfo;
  metallicFactor?: number;
  roughnessFactor?: number;
  metallicRoughnessTexture?: GltfTextureInfo;
}

/** A glTF material. */
export interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: GltfPbrMetallicRoughness;
  doubleSided?: boolean;
  alphaMode?: string;
  alphaCutoff?: number;
}

/** A glTF texture referencing a sampler and an image source. */
export interface GltfTexture {
  /** Index into the `samplers` array (not yet used by this loader). */
  sampler?: number;
  /** Index into the `images` array. */
  source?: number;
}

/** A glTF image source. */
export interface GltfImage {
  name?: string;
  uri?: string;
  mimeType?: string;
  /** Index into `bufferViews` for inline image data. */
  bufferView?: number;
}


/** A glTF 2.0 accessor describing how to interpret a slice of a buffer view (§3.6.2). */
export interface GltfAccessor {
  /** Index into `bufferViews`. Undefined for zero-initialized accessors. */
  bufferView?: number;
  /** Byte offset relative to the start of the buffer view. Defaults to 0. */
  byteOffset?: number;
  /** WebGL component type constant (e.g. `GL_FLOAT`, `GL_UNSIGNED_SHORT`). */
  componentType: GltfComponentType;
  /** Number of elements (not bytes) in the accessor. */
  count: number;
  /** Element type string: `"SCALAR"`, `"VEC2"`, `"VEC3"`, `"VEC4"`, `"MAT*"`. */
  type: string;
  /** Sparse accessor overrides (not yet supported by this loader). */
  sparse?: unknown;
  max?: number[];
  min?: number[];
}

/** A glTF 2.0 buffer view — a contiguous slice of a binary buffer (§3.6.3). */
export interface GltfBufferView {
  /** Index into the top-level `buffers` array. */
  buffer: number;
  /** Byte offset from the start of the buffer. Defaults to 0. */
  byteOffset?: number;
  /** Length of the buffer view in bytes. */
  byteLength: number;
  /** Stride in bytes between interleaved vertex attributes. When undefined, data is tightly packed. */
  byteStride?: number;
  /** WebGL buffer binding target hint (`ARRAY_BUFFER` or `ELEMENT_ARRAY_BUFFER`). */
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

/** Union of all valid glTF 2.0 accessor component types (§3.6.2.2). */
export type GltfComponentType =
  | typeof GL_BYTE
  | typeof GL_UNSIGNED_BYTE
  | typeof GL_SHORT
  | typeof GL_UNSIGNED_SHORT
  | typeof GL_UNSIGNED_INT
  | typeof GL_FLOAT;

// ---------------------------------------------------------------------------
// Parsed geometry result
// ---------------------------------------------------------------------------

/** Result of extracting geometry data from a glTF primitive. */
export interface ParsedMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Axis-aligned bounds minimum from the POSITION accessor (typically XYZ). */
  min: number[];
  /** Axis-aligned bounds maximum from the POSITION accessor (typically XYZ). */
  max: number[];
  /**
   * Index into the glTF `textures` array for the base-colour texture, when the
   * primitive's material references one **and** the required `TEXCOORD_N` set is present.
   * `undefined` when there is no material, no base-colour texture, or when the required
   * `TEXCOORD_N` attribute is absent (in which case a warning is emitted by the loader).
   */
  baseColorTextureIndex?: number;
}

/** A `GltfNode` with a guaranteed `localMatrix` as injected by `loadGltf`. */
export type GltfNodeWithMatrix = GltfNode & { localMatrix: number[] };

/** Result of loading and parsing an entire glTF asset. */
export interface GltfLoadResult {
  meshes: ParsedMesh[];
  nodes: GltfNodeWithMatrix[];
}
