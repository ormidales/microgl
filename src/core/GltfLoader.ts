/**
 * Loads glTF 2.0 / GLB files and extracts geometry data.
 *
 * V1 scope: geometry (positions, normals, UVs, indices) and basic node
 * hierarchy. Materials, textures, animations, and skins are not yet handled.
 */

import type {
  GltfAsset,
  GltfAccessor,
  GltfBufferView,
  GltfNode,
  GltfNodeWithMatrix,
  GltfMaterial,
  GltfPrimitiveAttributeSemantic,
  ParsedMesh,
  GltfLoadResult,
} from './GltfTypes';
import {
  GL_UNSIGNED_BYTE,
  GL_UNSIGNED_SHORT,
  GL_UNSIGNED_INT,
  GL_FLOAT,
  GL_BYTE,
  GL_SHORT,
} from './GltfTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Magic number at the start of every GLB file. */
const GLB_MAGIC = 0x46546C67; // "glTF"
const GLB_CHUNK_JSON = 0x4E4F534A;
const GLB_CHUNK_BIN = 0x004E4942;
const UTF8_DECODER = new TextDecoder();
const MAX_JSON_BUFFER_BYTES = 64 * 1024 * 1024;

export interface GltfLoaderOptions {
  /**
   * Callback invoked to resolve external buffer URIs referenced by the glTF asset.
   * Receives the raw URI string and must return the corresponding binary data.
   * Required when loading plain `.gltf` files that reference external `.bin` files.
   */
  resolveUri?: (uri: string) => Promise<ArrayBuffer>;
  /**
   * Maximum accepted byte size for a plain JSON glTF payload.
   * Defaults to 64 MiB. Raise this value only when loading unusually large assets.
   */
  maxJsonBufferBytes?: number;
  /**
   * When `true`, each VEC3 normal vector is re-normalized to unit length after
   * loading. Useful when the source asset was exported with non-unit normals.
   * Adds an O(n) pass over the normal buffer; leave `false` (default) when the
   * asset is known-clean to avoid the overhead.
   */
  normalizeNormals?: boolean;
  /**
   * When `true`, a non-unit quaternion found in a node's `rotation` field causes
   * `loadGltf` to throw an `Error` rather than silently normalizing it.
   * Also applies stricter URI validation for external buffer references: only
   * alphanumeric characters, dots, hyphens, underscores, and forward slashes
   * are permitted in the URI (all non-`data:` scheme URIs must be simple
   * relative paths).
   * Enable in development / CI to catch malformed assets early; leave `false`
   * (default) in production to be lenient with third-party exporters.
   */
  strict?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a glTF / GLB asset from an `ArrayBuffer` that has already been
 * fetched by the caller. This keeps the loader environment-agnostic
 * (works in browsers, workers, and test environments).
 *
 * @param buffer The raw bytes of a `.gltf` (JSON) or `.glb` file.
 * @param options Optional glTF loader configuration.
 * @param options.resolveUri Optional callback to resolve external buffer URIs.
 *                           Receives the URI string and must return the buffer data.
 * @param options.maxJsonBufferBytes Optional max size accepted for plain JSON glTF payloads.
 * @returns Parsed geometry data ready for GPU upload.
 */
export async function loadGltf(
  buffer: ArrayBuffer,
  options: GltfLoaderOptions = {},
): Promise<GltfLoadResult> {
  let json: GltfAsset;
  let binChunk: ArrayBuffer | undefined;
  try {
    ({ json, binChunk } = parseContainer(buffer, options));
  } catch (e) {
    throw wrapGltfError('Failed to parse glTF container', e);
  }

  const buffers = await resolveBuffers(json, binChunk, options.resolveUri, options);

  let meshes: ParsedMesh[];
  try {
    meshes = extractMeshes(json, buffers);
  } catch (e) {
    throw wrapGltfError('Failed to extract glTF meshes', e);
  }

  if (options.normalizeNormals) {
    for (const mesh of meshes) {
      normalizeNormalArray(mesh.normals);
    }
  }

  return { meshes, nodes: (json.nodes ?? []).map((n) => attachLocalMatrix(n, options)) };
}

/**
 * Wrap an unknown caught value in a new Error with a descriptive prefix,
 * attaching the original as `cause` when it is an Error instance.
 */
function wrapGltfError(prefix: string, cause: unknown): Error {
  const msg = cause instanceof Error ? cause.message : String(cause);
  const wrapped = new Error(`${prefix}: ${msg}`);
  if (cause instanceof Error) (wrapped as Error & { cause?: Error }).cause = cause;
  return wrapped;
}

// ---------------------------------------------------------------------------
// Container parsing (JSON vs GLB)
// ---------------------------------------------------------------------------

/**
 * Determine whether the buffer is a GLB container or plain JSON, then
 * extract the glTF asset descriptor and an optional binary chunk.
 */
export function parseContainer(
  buffer: ArrayBuffer,
  options?: Pick<GltfLoaderOptions, 'maxJsonBufferBytes'>,
): {
  json: GltfAsset;
  binChunk: ArrayBuffer | undefined;
} {
  const header = new DataView(buffer);
  const maxJsonBufferBytes = options?.maxJsonBufferBytes ?? MAX_JSON_BUFFER_BYTES;

  if (buffer.byteLength >= 12 && header.getUint32(0, true) === GLB_MAGIC) {
    return parseGlb(buffer);
  }

  // Treat the whole buffer as UTF-8 JSON
  if (buffer.byteLength > maxJsonBufferBytes) {
    throw new Error(
      `JSON glTF payload too large (${buffer.byteLength} bytes). ` +
      `Maximum supported size is ${maxJsonBufferBytes} bytes.`,
    );
  }
  const text = UTF8_DECODER.decode(buffer);
  const json = JSON.parse(text) as GltfAsset;
  return { json, binChunk: undefined };
}

/**
 * Parse a GLB (binary glTF) container according to the glTF 2.0 spec §5.
 */
function parseGlb(buffer: ArrayBuffer): {
  json: GltfAsset;
  binChunk: ArrayBuffer | undefined;
} {
  const view = new DataView(buffer);

  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }

  let offset = 12; // past the 12-byte header
  let json: GltfAsset | undefined;
  let binChunk: ArrayBuffer | undefined;

  while (offset < buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    if (chunkLength === 0) {
      throw new Error(`Invalid chunk length: ${chunkLength}`);
    }
    const chunkType = view.getUint32(offset + 4, true);
    const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);

    if (chunkType === GLB_CHUNK_JSON) {
      const text = UTF8_DECODER.decode(chunkData);
      json = JSON.parse(text) as GltfAsset;
    } else if (chunkType === GLB_CHUNK_BIN) {
      binChunk = chunkData;
    }

    offset += 8 + chunkLength;
  }

  if (!json) {
    throw new Error('GLB file does not contain a JSON chunk.');
  }

  return { json, binChunk };
}

// ---------------------------------------------------------------------------
// Buffer resolution
// ---------------------------------------------------------------------------

/**
 * Validate an external buffer URI before forwarding it to the caller-supplied
 * `resolveUri` callback. Rejects absolute URLs, protocol-relative URLs,
 * path-traversal sequences, and null bytes. When `strict` is `true`, only a
 * safe subset of characters (alphanumeric, dot, hyphen, underscore, forward
 * slash) is allowed in the URI.
 *
 * @throws {Error} If the URI is deemed unsafe.
 */
function validateExternalUri(uri: string, bufferIndex: number, strict?: boolean): void {
  if (uri.includes('\0')) {
    throw new Error(
      `Buffer ${bufferIndex}: external URI contains a null byte and is not allowed.`,
    );
  }
  // Block any URI with a scheme (e.g. http:, https:, file:, ftp:, //) to prevent SSRF.
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')) {
    throw new Error(
      `Buffer ${bufferIndex}: external URI "${uri}" is not allowed. ` +
      `Only relative paths without traversal sequences are permitted.`,
    );
  }
  // Decode percent-encoded sequences to catch encoded traversal (e.g. %2e%2e).
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    decoded = uri;
  }
  if (uri.includes('..') || decoded.includes('..')) {
    throw new Error(
      `Buffer ${bufferIndex}: external URI "${uri}" is not allowed. ` +
      `Only relative paths without traversal sequences are permitted.`,
    );
  }
  if (strict && !/^[A-Za-z0-9._\-/]+$/.test(uri)) {
    throw new Error(
      `Buffer ${bufferIndex}: external URI "${uri}" contains characters not permitted in strict mode. ` +
      `Only alphanumeric characters, dots, hyphens, underscores, and forward slashes are allowed.`,
    );
  }
}

/**
 * Build an array of `ArrayBuffer`s that correspond to the glTF `buffers`
 * array. Embedded data-URIs and the GLB binary chunk are handled inline;
 * external URIs are delegated to the optional `resolveUri` callback.
 */
async function resolveBuffers(
  json: GltfAsset,
  binChunk: ArrayBuffer | undefined,
  resolveUri?: (uri: string) => Promise<ArrayBuffer>,
  options?: GltfLoaderOptions,
): Promise<ArrayBuffer[]> {
  const gltfBuffers = json.buffers ?? [];
  const resolved: ArrayBuffer[] = [];

  let binChunkConsumed = false;
  for (let i = 0; i < gltfBuffers.length; i++) {
    const buf = gltfBuffers[i];

    if (buf.uri === undefined) {
      // GLB embedded buffer (only one buffer may omit a URI and consume the binary chunk)
      if (!binChunk) {
        throw new Error(`Buffer ${i} has no URI and no GLB binary chunk is available.`);
      }
      if (binChunkConsumed) {
        throw new Error(
          `Buffer ${i} has no URI but the GLB binary chunk has already been consumed by a previous buffer. ` +
          `GLB only supports one embedded binary buffer.`,
        );
      }
      resolved.push(binChunk);
      binChunkConsumed = true;
    } else if (buf.uri.startsWith('data:')) {
      resolved.push(await decodeDataUri(buf.uri));
    } else {
      if (!resolveUri) {
        throw new Error(
          `Buffer ${i} references external URI "${buf.uri}" but no resolveUri callback was provided.`,
        );
      }
      validateExternalUri(buf.uri, i, options?.strict);
      resolved.push(await resolveUri(buf.uri));
    }
  }

  return resolved;
}

/**
 * Decode a base64 data URI into an ArrayBuffer.
 */
async function decodeDataUri(uri: string): Promise<ArrayBuffer> {
  const commaIndex = uri.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URI: no comma separator found.');
  }
  let fetchFailure: Error | undefined;
  try {
    const response = await fetch(uri);
    if (response.ok) {
      return await response.arrayBuffer();
    }
    fetchFailure = new Error(`status ${response.status}`);
  } catch (error) {
    // Fall back to manual decoding when fetch fails (e.g. oversized data URI).
    fetchFailure = error instanceof Error ? error : new Error('network failure');
  }
  const header = uri.slice(0, commaIndex).toLowerCase();
  if (!header.includes(';base64')) {
    const error = new Error(`Failed to decode data URI (${fetchFailure?.message ?? 'unsupported format'}): expected base64 payload.`);
    if (fetchFailure) (error as Error & { cause?: Error }).cause = fetchFailure;
    throw error;
  }
  try {
    const binary = atob(uri.slice(commaIndex + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    const decodeFailure = error instanceof Error ? error : new Error('invalid base64 payload');
    const fetchMessage = fetchFailure ? ` Initial fetch failure: ${fetchFailure.message}.` : '';
    const decodeError = new Error(`Failed to decode base64 data URI via fallback: ${decodeFailure.message}.${fetchMessage}`);
    if (fetchFailure) (decodeError as Error & { cause?: Error }).cause = fetchFailure;
    throw decodeError;
  }
}

// ---------------------------------------------------------------------------
// Node local-matrix helpers
// ---------------------------------------------------------------------------

/** Column-major 4×4 identity matrix. */
const IDENTITY_MAT4: readonly number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/**
 * Compute the column-major 4×4 local transform matrix for a glTF node.
 *
 * Execution order (per glTF 2.0 §5.3.4):
 *  1. `node.matrix` – used verbatim when exactly 16 elements are present.
 *  2. No transform data at all – returns the identity matrix early.
 *  3. TRS components – composed as T × R × S with identity defaults for any
 *     missing component (`translation` → [0,0,0], `rotation` → [0,0,0,1],
 *     `scale` → [1,1,1]).
 *
 * @param node The glTF node descriptor.
 * @param options Optional configuration forwarded from `loadGltf`.
 *   - `strict`: when `true`, a non-unit quaternion throws an `Error` instead of
 *     being silently normalized.
 */
export function buildNodeLocalMatrix(
  node: GltfNode,
  options?: Pick<GltfLoaderOptions, 'strict'>,
): number[] {
  // 1. Explicit matrix
  if (node.matrix && node.matrix.length === 16) {
    return node.matrix.slice();
  }

  // 2. No transform data at all → identity
  if (!node.translation && !node.rotation && !node.scale) {
    return IDENTITY_MAT4.slice();
  }

  // 3. TRS composition (with identity defaults)
  const tx = node.translation?.[0] ?? 0;
  const ty = node.translation?.[1] ?? 0;
  const tz = node.translation?.[2] ?? 0;

  let qx = node.rotation?.[0] ?? 0;
  let qy = node.rotation?.[1] ?? 0;
  let qz = node.rotation?.[2] ?? 0;
  let qw = node.rotation?.[3] ?? 1;

  // Validate and normalize the quaternion if it deviates from unit length.
  if (node.rotation) {
    const len = Math.hypot(qx, qy, qz, qw);
    if (Math.abs(len - 1) > 1e-4) {
      if (options?.strict) {
        throw new Error(
          `Node "${node.name}": quaternion not normalized (length=${len.toFixed(6)})`,
        );
      }
      console.warn(
        `Node "${node.name}": quaternion not normalized (length=${len.toFixed(6)}), normalizing.`,
      );
      qx /= len;
      qy /= len;
      qz /= len;
      qw /= len;
    }
  }

  const sx = node.scale?.[0] ?? 1;
  const sy = node.scale?.[1] ?? 1;
  const sz = node.scale?.[2] ?? 1;

  // Pre-compute quaternion products
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  // Column-major layout (each group of 4 values is one column)
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Return a shallow copy of `node` with `localMatrix` attached. */
function attachLocalMatrix(
  node: GltfNode,
  options?: Pick<GltfLoaderOptions, 'strict'>,
): GltfNodeWithMatrix {
  return { ...node, localMatrix: buildNodeLocalMatrix(node, options) };
}

// ---------------------------------------------------------------------------
// Mesh extraction
// ---------------------------------------------------------------------------

/**
 * Walk every mesh/primitive in the asset and extract typed geometry arrays.
 */
function extractMeshes(json: GltfAsset, buffers: ArrayBuffer[]): ParsedMesh[] {
  const result: ParsedMesh[] = [];

  for (const mesh of json.meshes ?? []) {
    for (let pi = 0; pi < mesh.primitives.length; pi++) {
      const prim = mesh.primitives[pi];
      const positionAccessorIndex = prim.attributes['POSITION'];

      const positions = readAccessorFloat(
        json,
        buffers,
        positionAccessorIndex,
      );
      if (positions.length === 0) continue;
      const normals = prim.attributes['NORMAL'] !== undefined
        ? readAccessorFloat(json, buffers, prim.attributes['NORMAL'])
        : new Float32Array(0);

      const name = mesh.name
        ? (mesh.primitives.length > 1 ? `${mesh.name}_${pi}` : mesh.name)
        : `mesh_${result.length}`;

      const baseColorInfo = resolveBaseColorInfo(json, prim.material, prim.attributes, name, pi);
      const uvTexcoordKey = `TEXCOORD_${baseColorInfo?.uvSetIndex ?? 0}` as GltfPrimitiveAttributeSemantic;
      const uvAccessorIndex = prim.attributes[uvTexcoordKey];
      const uvs = uvAccessorIndex !== undefined
        ? readAccessorFloat(json, buffers, uvAccessorIndex)
        : new Float32Array(0);

      const indices = prim.indices !== undefined
        ? readAccessorIndices(json, buffers, prim.indices)
        : new Uint16Array(0);

      const positionAccessor = positionAccessorIndex !== undefined
        ? getAccessor(json, positionAccessorIndex)
        : undefined;
      const computedBounds = (positionAccessor?.min === undefined || positionAccessor?.max === undefined)
        ? computePositionBounds(positions)
        : undefined;
      const min = positionAccessor?.min ?? computedBounds?.min ?? [];
      const max = positionAccessor?.max ?? computedBounds?.max ?? [];

      const baseColorTextureIndex = baseColorInfo?.textureIndex;

      result.push({ name, positions, normals, uvs, indices, min, max, baseColorTextureIndex });
    }
  }

  return result;
}


/**
 * Resolve the base-color texture index and UV set for a primitive's material.
 *
 * Returns `{ textureIndex, uvSetIndex }` when the material references a
 * base-color texture **and** the required `TEXCOORD_N` attribute is present.
 * Returns `undefined` when there is no material, no base-colour texture, or
 * the required attribute is absent (in which case a warning is emitted).
 *
 * Keeping both values together ensures the UV set selection in `extractMeshes`
 * and the `baseColorTextureIndex` assignment share a single source of truth.
 */
function resolveBaseColorInfo(
  json: GltfAsset,
  materialIndex: number | undefined,
  attributes: Partial<Record<GltfPrimitiveAttributeSemantic, number>>,
  meshName: string,
  primitiveIndex: number,
): { textureIndex: number; uvSetIndex: number } | undefined {
  if (materialIndex === undefined) return undefined;

  const material: GltfMaterial | undefined = json.materials?.[materialIndex];
  const texInfo = material?.pbrMetallicRoughness?.baseColorTexture;
  if (texInfo === undefined) return undefined;

  const uvSetIndex = texInfo.texCoord ?? 0;
  const texcoordKey = `TEXCOORD_${uvSetIndex}` as GltfPrimitiveAttributeSemantic;
  const texcoordAccessorIndex = attributes[texcoordKey];

  if (texcoordAccessorIndex === undefined) {
    console.warn(
      `[GltfLoader] Mesh "${meshName}" primitive ${primitiveIndex}: ` +
      `material ${materialIndex} references a base-color texture using TEXCOORD_${uvSetIndex} ` +
      `but that attribute is absent – texture will be skipped.`,
    );
    return undefined;
  }

  return { textureIndex: texInfo.index, uvSetIndex };
}

function normalizeNormalArray(normals: Float32Array): void {
  for (let i = 0; i + 2 < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      normals[i] = x / len;
      normals[i + 1] = y / len;
      normals[i + 2] = z / len;
    }
  }
}

function computePositionBounds(positions: Float32Array): { min: number[]; max: number[] } {
  if (positions.length < 3) {
    throw new Error(
      `Invalid position data: expected at least 3 components (one XYZ vertex), got ${positions.length}.`,
    );
  }

  let minX = positions[0];
  let minY = positions[1];
  let minZ = positions[2];
  let maxX = positions[0];
  let maxY = positions[1];
  let maxZ = positions[2];

  for (let i = 3; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// ---------------------------------------------------------------------------
// Accessor helpers
// ---------------------------------------------------------------------------

/**
 * Read an accessor as a `Float32Array`. Component type conversion is
 * performed when the source data is not already float.
 */
export function readAccessorFloat(
  json: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number | undefined,
): Float32Array {
  if (accessorIndex === undefined) return new Float32Array(0);

  const accessor = getAccessor(json, accessorIndex);
  if (accessor.sparse) {
    throw new Error(`Sparse accessor ${accessorIndex} is not supported.`);
  }
  const { data, byteOffset, byteStride, byteLength } = getBufferSlice(json, buffers, accessor);
  const componentCount = accessor.count * componentCountForType(accessor.type);
  let elementLayout: { elementSize: number; componentOffsets: number[] };
  try {
    elementLayout = getAccessorElementLayout(accessor.componentType, accessor.type);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Accessor ${accessorIndex}: ${msg}`);
  }
  const { elementSize, componentOffsets } = elementLayout;

  // Fast path: tightly packed types – non-matrix types only (matrix columns may
  // carry alignment padding that makes a flat TypedArray view incorrect).
  const expectedStride = elementSize;
  const isTightlyPacked = byteStride === 0 || byteStride === expectedStride;
  const isNonMatrix = !accessor.type.startsWith('MAT');
  if (isTightlyPacked && isNonMatrix) {
    if (accessor.componentType === GL_FLOAT) {
      return new Float32Array(data, byteOffset, componentCount);
    }
    const requiredBytes = accessor.count === 0 ? 0 : accessor.count * elementSize;
    if (requiredBytes > byteLength) {
      throw new Error(`Accessor ${accessorIndex} exceeds available buffer bounds.`);
    }
    if (accessor.componentType === GL_SHORT) {
      const out = new Float32Array(componentCount);
      out.set(new Int16Array(data, byteOffset, componentCount));
      return out;
    }
    if (accessor.componentType === GL_UNSIGNED_BYTE) {
      const out = new Float32Array(componentCount);
      out.set(new Uint8Array(data, byteOffset, componentCount));
      return out;
    }
  }

  // Slow path: stride or type conversion
  const elemSize = componentCountForType(accessor.type);
  const stride = byteStride || expectedStride;
  const requiredBytes = accessor.count === 0 ? 0 : (accessor.count - 1) * stride + elementSize;
  if (requiredBytes > byteLength) {
    throw new Error(`Accessor ${accessorIndex} exceeds available buffer bounds.`);
  }
  const out = new Float32Array(componentCount);
  const view = new DataView(data);
  let outIdx = 0;

  for (let i = 0; i < accessor.count; i++) {
    const base = byteOffset + i * stride;
    for (let c = 0; c < elemSize; c++) {
      out[outIdx++] = readComponent(view, base + componentOffsets[c], accessor.componentType, accessorIndex);
    }
  }

  return out;
}

/**
 * Read an accessor as an index array (used for index buffers).
 * Supports UNSIGNED_BYTE, UNSIGNED_SHORT, and UNSIGNED_INT sources.
 */
export function readAccessorIndices(
  json: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number | undefined,
): Uint16Array | Uint32Array {
  if (accessorIndex === undefined) return new Uint16Array(0);

  const accessor = getAccessor(json, accessorIndex);
  if (accessor.sparse) {
    throw new Error(`Sparse accessor ${accessorIndex} is not supported.`);
  }
  const { data, byteOffset, byteStride, byteLength } = getBufferSlice(json, buffers, accessor);

  const count = accessor.count;
  let bpc: number;
  try {
    bpc = bytesPerComponent(accessor.componentType);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Accessor ${accessorIndex}: ${msg}`);
  }
  const stride = byteStride || bpc;
  const requiredBytes = count === 0 ? 0 : (count - 1) * stride + bpc;
  if (requiredBytes > byteLength) {
    throw new Error(`Index accessor ${accessorIndex} exceeds available buffer bounds.`);
  }

  // Fast path: tightly packed unsigned shorts
  if (accessor.componentType === GL_UNSIGNED_SHORT && stride === 2) {
    return new Uint16Array(data, byteOffset, count);
  }

  // Fast path: tightly packed unsigned ints
  if (accessor.componentType === GL_UNSIGNED_INT && stride === 4) {
    return new Uint32Array(data, byteOffset, count);
  }

  const out = accessor.componentType === GL_UNSIGNED_INT
    ? new Uint32Array(count)
    : new Uint16Array(count);
  const view = new DataView(data);

  for (let i = 0; i < count; i++) {
    const offset = byteOffset + i * stride;
    if (accessor.componentType === GL_UNSIGNED_BYTE) {
      out[i] = view.getUint8(offset);
    } else if (accessor.componentType === GL_UNSIGNED_SHORT) {
      out[i] = view.getUint16(offset, true);
    } else if (accessor.componentType === GL_UNSIGNED_INT) {
      out[i] = view.getUint32(offset, true);
    } else {
      throw new Error(`Accessor ${accessorIndex}: unsupported glTF component type ${accessor.componentType}.`);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getAccessor(json: GltfAsset, index: number): GltfAccessor {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`Accessor ${index} not found.`);
  return acc;
}

function getBufferSlice(
  json: GltfAsset,
  buffers: ArrayBuffer[],
  accessor: GltfAccessor,
): { data: ArrayBuffer; byteOffset: number; byteStride: number; byteLength: number } {
  const bvIndex = accessor.bufferView;
  if (bvIndex === undefined) {
    throw new Error('Accessors without a bufferView are not supported.');
  }
  const bv = json.bufferViews?.[bvIndex] as GltfBufferView | undefined;
  if (!bv) throw new Error(`BufferView ${bvIndex} not found.`);

  const data = buffers[bv.buffer];
  if (!data) throw new Error(`Buffer ${bv.buffer} not resolved.`);

  const accessorByteOffset = accessor.byteOffset ?? 0;
  const byteOffset = (bv.byteOffset ?? 0) + accessorByteOffset;
  const byteStride = bv.byteStride ?? 0;
  const byteLength = bv.byteLength - accessorByteOffset;

  return { data, byteOffset, byteStride, byteLength };
}

function readComponent(view: DataView, offset: number, componentType: number, accessorIndex: number): number {
  switch (componentType) {
    case GL_BYTE: return view.getInt8(offset);
    case GL_UNSIGNED_BYTE: return view.getUint8(offset);
    case GL_SHORT: return view.getInt16(offset, true);
    case GL_UNSIGNED_SHORT: return view.getUint16(offset, true);
    case GL_UNSIGNED_INT: return view.getUint32(offset, true);
    case GL_FLOAT: return view.getFloat32(offset, true);
    default: throw new Error(`Accessor ${accessorIndex}: unsupported glTF component type ${componentType}.`);
  }
}

function bytesPerComponent(componentType: number): number {
  switch (componentType) {
    case GL_BYTE:
    case GL_UNSIGNED_BYTE: return 1;
    case GL_SHORT:
    case GL_UNSIGNED_SHORT: return 2;
    case GL_UNSIGNED_INT:
    case GL_FLOAT: return 4;
    default: throw new Error(`Unknown component type: ${componentType}`);
  }
}

function componentCountForType(type: string): number {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT2': return 4;
    case 'MAT3': return 9;
    case 'MAT4': return 16;
    default: throw new Error(`Unknown accessor type: ${type}`);
  }
}

function getAccessorElementLayout(componentType: number, type: string): { elementSize: number; componentOffsets: number[] } {
  const bpc = bytesPerComponent(componentType);
  if (type === 'MAT2' || type === 'MAT3' || type === 'MAT4') {
    const rows = type === 'MAT2' ? 2 : type === 'MAT3' ? 3 : 4;
    const cols = rows;
    const columnStride = Math.ceil((rows * bpc) / 4) * 4;
    const componentOffsets: number[] = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        componentOffsets.push(col * columnStride + row * bpc);
      }
    }
    return { elementSize: cols * columnStride, componentOffsets };
  }

  const componentCount = componentCountForType(type);
  const componentOffsets = Array.from({ length: componentCount }, (_, idx) => idx * bpc);
  return { elementSize: componentCount * bpc, componentOffsets };
}
