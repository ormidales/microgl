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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a glTF / GLB asset from an `ArrayBuffer` that has already been
 * fetched by the caller. This keeps the loader environment-agnostic
 * (works in browsers, workers, and test environments).
 *
 * @param buffer The raw bytes of a `.gltf` (JSON) or `.glb` file.
 * @param resolveUri Optional callback to resolve external buffer URIs.
 *                   Receives the URI string and must return the buffer data.
 * @returns Parsed geometry data ready for GPU upload.
 */
export async function loadGltf(
  buffer: ArrayBuffer,
  resolveUri?: (uri: string) => Promise<ArrayBuffer>,
): Promise<GltfLoadResult> {
  const { json, binChunk } = parseContainer(buffer);

  const buffers = await resolveBuffers(json, binChunk, resolveUri);

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
} {
  const header = new DataView(buffer);

  if (buffer.byteLength >= 12 && header.getUint32(0, true) === GLB_MAGIC) {
    return parseGlb(buffer);
  }

  // Treat the whole buffer as UTF-8 JSON
  const text = new TextDecoder().decode(buffer);
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
    if (chunkLength <= 0) {
      throw new Error(`Invalid chunk length: ${chunkLength}`);
    }
    const chunkType = view.getUint32(offset + 4, true);
    const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);

    if (chunkType === GLB_CHUNK_JSON) {
      const text = new TextDecoder().decode(chunkData);
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
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to decode data URI (status ${response.status}).`);
  }
  return await response.arrayBuffer();
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

      const positions = readAccessorFloat(
        json,
        buffers,
        prim.attributes['POSITION'],
      );
      const normals = prim.attributes['NORMAL'] !== undefined
        ? readAccessorFloat(json, buffers, prim.attributes['NORMAL'])
        : new Float32Array(0);
      const uvs = prim.attributes['TEXCOORD_0'] !== undefined
        ? readAccessorFloat(json, buffers, prim.attributes['TEXCOORD_0'])
        : new Float32Array(0);
      const indices = prim.indices !== undefined
        ? readAccessorUint16(json, buffers, prim.indices)
        : new Uint16Array(0);

      const name = mesh.name
        ? (mesh.primitives.length > 1 ? `${mesh.name}_${pi}` : mesh.name)
        : `mesh_${result.length}`;

      result.push({ name, positions, normals, uvs, indices });
    }
  }

  return result;
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
  const { data, byteOffset, byteStride } = getBufferSlice(json, buffers, accessor);
  const componentCount = accessor.count * componentCountForType(accessor.type);

  // Fast path: tightly packed floats – just wrap
  const expectedStride = componentSizeBytes(accessor.componentType, accessor.type);
  const isTightlyPacked = byteStride === 0 || byteStride === expectedStride;
  if (accessor.componentType === GL_FLOAT && isTightlyPacked) {
    return new Float32Array(data, byteOffset, componentCount);
  }

  // Slow path: stride or type conversion
  const elemSize = componentCountForType(accessor.type);
  const stride = byteStride || elemSize * bytesPerComponent(accessor.componentType);
  const out = new Float32Array(componentCount);
  const view = new DataView(data);
  let outIdx = 0;

  for (let i = 0; i < accessor.count; i++) {
    const base = byteOffset + i * stride;
    for (let c = 0; c < elemSize; c++) {
      out[outIdx++] = readComponent(view, base + c * bytesPerComponent(accessor.componentType), accessor.componentType);
    }
  }

  return out;
}

/**
 * Read an accessor as a `Uint16Array` (used for index buffers).
 * Supports UNSIGNED_BYTE, UNSIGNED_SHORT, and UNSIGNED_INT sources.
 */
export function readAccessorUint16(
  json: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number | undefined,
): Uint16Array {
  if (accessorIndex === undefined) return new Uint16Array(0);

  const accessor = getAccessor(json, accessorIndex);
  const { data, byteOffset, byteStride } = getBufferSlice(json, buffers, accessor);

  const count = accessor.count;
  const bpc = bytesPerComponent(accessor.componentType);
  const stride = byteStride || bpc;

  // Fast path: tightly packed unsigned shorts
  if (accessor.componentType === GL_UNSIGNED_SHORT && stride === 2) {
    return new Uint16Array(data, byteOffset, count);
  }

  const out = new Uint16Array(count);
  const view = new DataView(data);

  for (let i = 0; i < count; i++) {
    const offset = byteOffset + i * stride;
    if (accessor.componentType === GL_UNSIGNED_BYTE) {
      out[i] = view.getUint8(offset);
    } else if (accessor.componentType === GL_UNSIGNED_SHORT) {
      out[i] = view.getUint16(offset, true);
    } else if (accessor.componentType === GL_UNSIGNED_INT) {
      out[i] = view.getUint32(offset, true);
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
): { data: ArrayBuffer; byteOffset: number; byteStride: number } {
  const bvIndex = accessor.bufferView;
  if (bvIndex === undefined) {
    throw new Error('Accessors without a bufferView are not supported.');
  }
  const bv = json.bufferViews?.[bvIndex] as GltfBufferView | undefined;
  if (!bv) throw new Error(`BufferView ${bvIndex} not found.`);

  const data = buffers[bv.buffer];
  if (!data) throw new Error(`Buffer ${bv.buffer} not resolved.`);

  const byteOffset = (bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const byteStride = bv.byteStride ?? 0;

  return { data, byteOffset, byteStride };
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

function componentSizeBytes(componentType: number, type: string): number {
  return bytesPerComponent(componentType) * componentCountForType(type);
}
