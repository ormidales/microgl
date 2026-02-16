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
  resolveUri?: (uri: string) => Promise<ArrayBuffer>;
  maxJsonBufferBytes?: number;
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
  const { json, binChunk } = parseContainer(buffer, options);

  const buffers = await resolveBuffers(json, binChunk, options.resolveUri);

  const meshes = extractMeshes(json, buffers);

  return { meshes, nodes: json.nodes ?? [] };
}

// ---------------------------------------------------------------------------
// Container parsing (JSON vs GLB)
// ---------------------------------------------------------------------------

/**
 * Determine whether the buffer is a GLB container or plain JSON, then
 * extract the glTF asset descriptor and an optional binary chunk.
 */
export function parseContainer(buffer: ArrayBuffer): {
  json: GltfAsset;
  binChunk: ArrayBuffer | undefined;
};
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
 * Build an array of `ArrayBuffer`s that correspond to the glTF `buffers`
 * array. Embedded data-URIs and the GLB binary chunk are handled inline;
 * external URIs are delegated to the optional `resolveUri` callback.
 */
async function resolveBuffers(
  json: GltfAsset,
  binChunk: ArrayBuffer | undefined,
  resolveUri?: (uri: string) => Promise<ArrayBuffer>,
): Promise<ArrayBuffer[]> {
  const gltfBuffers = json.buffers ?? [];
  const resolved: ArrayBuffer[] = [];

  for (let i = 0; i < gltfBuffers.length; i++) {
    const buf = gltfBuffers[i];

    if (buf.uri === undefined) {
      // GLB embedded buffer (first buffer with no URI)
      if (!binChunk) {
        throw new Error(`Buffer ${i} has no URI and no GLB binary chunk is available.`);
      }
      resolved.push(binChunk);
    } else if (buf.uri.startsWith('data:')) {
      resolved.push(await decodeDataUri(buf.uri));
    } else {
      if (!resolveUri) {
        throw new Error(
          `Buffer ${i} references external URI "${buf.uri}" but no resolveUri callback was provided.`,
        );
      }
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
    throw new Error(`Failed to decode data URI (${fetchFailure?.message ?? 'unsupported format'}): expected base64 payload.`);
  }
  const binary = atob(uri.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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
      const uvs = prim.attributes['TEXCOORD_0'] !== undefined
        ? readAccessorFloat(json, buffers, prim.attributes['TEXCOORD_0'])
        : new Float32Array(0);
      const indices = prim.indices !== undefined
        ? readAccessorIndices(json, buffers, prim.indices)
        : new Uint16Array(0);

      const name = mesh.name
        ? (mesh.primitives.length > 1 ? `${mesh.name}_${pi}` : mesh.name)
        : `mesh_${result.length}`;
      const positionAccessor = positionAccessorIndex !== undefined
        ? getAccessor(json, positionAccessorIndex)
        : undefined;
      const computedBounds = (positionAccessor?.min === undefined || positionAccessor?.max === undefined)
        ? computePositionBounds(positions)
        : undefined;
      const min = positionAccessor?.min ?? computedBounds?.min ?? [];
      const max = positionAccessor?.max ?? computedBounds?.max ?? [];

      result.push({ name, positions, normals, uvs, indices, min, max });
    }
  }

  return result;
}

function computePositionBounds(positions: Float32Array): { min: number[]; max: number[] } {
  if (positions.length < 3) {
    return { min: [], max: [] };
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
  const { data, byteOffset, byteStride, byteLength } = getBufferSlice(json, buffers, accessor);
  const componentCount = accessor.count * componentCountForType(accessor.type);
  const { elementSize, componentOffsets } = getAccessorElementLayout(accessor.componentType, accessor.type);

  // Fast path: tightly packed floats – just wrap
  const expectedStride = elementSize;
  const isTightlyPacked = byteStride === 0 || byteStride === expectedStride;
  if (accessor.componentType === GL_FLOAT && isTightlyPacked) {
    return new Float32Array(data, byteOffset, componentCount);
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
      out[outIdx++] = readComponent(view, base + componentOffsets[c], accessor.componentType);
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
  const { data, byteOffset, byteStride, byteLength } = getBufferSlice(json, buffers, accessor);

  const count = accessor.count;
  const bpc = bytesPerComponent(accessor.componentType);
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
      throw new Error(`Unsupported index component type: ${accessor.componentType}`);
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

function readComponent(view: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case GL_BYTE: return view.getInt8(offset);
    case GL_UNSIGNED_BYTE: return view.getUint8(offset);
    case GL_SHORT: return view.getInt16(offset, true);
    case GL_UNSIGNED_SHORT: return view.getUint16(offset, true);
    case GL_UNSIGNED_INT: return view.getUint32(offset, true);
    case GL_FLOAT: return view.getFloat32(offset, true);
    default: throw new Error(`Unsupported glTF component type: ${componentType}`);
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
