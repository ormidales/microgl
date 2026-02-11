import { describe, it, expect } from 'vitest';
import {
  loadGltf,
  parseContainer,
  readAccessorFloat,
  readAccessorUint16,
} from '../src/core/GltfLoader';
import type { GltfAsset } from '../src/core/GltfTypes';
import { GL_FLOAT, GL_UNSIGNED_SHORT, GL_UNSIGNED_BYTE } from '../src/core/GltfTypes';
import { MeshComponent } from '../src/core/ecs/components/MeshComponent';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Encode a JSON object as a UTF-8 ArrayBuffer. */
function jsonToBuffer(obj: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer;
}

/** Build a minimal valid glTF asset JSON. */
function minimalGltf(overrides: Partial<GltfAsset> = {}): GltfAsset {
  return {
    asset: { version: '2.0' },
    ...overrides,
  };
}

/**
 * Build a GLB binary container from JSON + optional binary chunk.
 * Follows the glTF 2.0 spec §5.
 */
function buildGlb(json: unknown, binData?: ArrayBuffer): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  // Pad JSON chunk to 4-byte alignment with spaces (0x20)
  const jsonPadded = padTo4(jsonBytes, 0x20);

  let totalLength = 12 + 8 + jsonPadded.byteLength;
  let binPadded: Uint8Array | undefined;

  if (binData) {
    binPadded = padTo4(new Uint8Array(binData), 0x00);
    totalLength += 8 + binPadded.byteLength;
  }

  const result = new ArrayBuffer(totalLength);
  const view = new DataView(result);
  const bytes = new Uint8Array(result);

  // Header: magic, version, length
  view.setUint32(0, 0x46546C67, true); // "glTF"
  view.setUint32(4, 2, true);          // version
  view.setUint32(8, totalLength, true);

  // JSON chunk header
  let offset = 12;
  view.setUint32(offset, jsonPadded.byteLength, true);
  view.setUint32(offset + 4, 0x4E4F534A, true); // JSON
  bytes.set(jsonPadded, offset + 8);
  offset += 8 + jsonPadded.byteLength;

  // BIN chunk
  if (binPadded) {
    view.setUint32(offset, binPadded.byteLength, true);
    view.setUint32(offset + 4, 0x004E4942, true); // BIN
    bytes.set(binPadded, offset + 8);
  }

  return result;
}

function padTo4(data: Uint8Array, padByte: number): Uint8Array {
  const rem = data.byteLength % 4;
  if (rem === 0) return data;
  const padded = new Uint8Array(data.byteLength + (4 - rem));
  padded.set(data);
  padded.fill(padByte, data.byteLength);
  return padded;
}

/**
 * Build a complete glTF JSON asset with a single triangle mesh and the
 * corresponding binary buffer. Returns both the JSON descriptor and the
 * raw binary data.
 */
function triangleAsset(): { json: GltfAsset; bin: ArrayBuffer } {
  // 3 vertices × 3 floats = 9 floats = 36 bytes  (positions)
  // 3 indices  × 2 bytes  = 6 bytes               (indices)
  // Total binary = 36 + 6 = 42 bytes
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);

  const bin = new ArrayBuffer(42);
  new Uint8Array(bin).set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
  new Uint8Array(bin).set(new Uint8Array(indices.buffer as ArrayBuffer), 36);

  const json: GltfAsset = {
    asset: { version: '2.0' },
    meshes: [
      {
        name: 'Triangle',
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
          },
        ],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 42 }],
  };

  return { json, bin };
}

// ---------------------------------------------------------------------------
// parseContainer
// ---------------------------------------------------------------------------

describe('parseContainer', () => {
  it('parses plain JSON glTF', () => {
    const asset = minimalGltf();
    const buf = jsonToBuffer(asset);
    const { json, binChunk } = parseContainer(buf);

    expect(json.asset.version).toBe('2.0');
    expect(binChunk).toBeUndefined();
  });

  it('parses GLB container with JSON + BIN chunks', () => {
    const { json: srcJson, bin } = triangleAsset();
    const glb = buildGlb(srcJson, bin);
    const { json, binChunk } = parseContainer(glb);

    expect(json.asset.version).toBe('2.0');
    expect(json.meshes).toHaveLength(1);
    expect(binChunk).toBeDefined();
    expect(binChunk!.byteLength).toBeGreaterThanOrEqual(42);
  });

  it('parses GLB container without BIN chunk', () => {
    const asset = minimalGltf();
    const glb = buildGlb(asset);
    const { json, binChunk } = parseContainer(glb);

    expect(json.asset.version).toBe('2.0');
    expect(binChunk).toBeUndefined();
  });

  it('throws on unsupported GLB version', () => {
    const glb = new ArrayBuffer(12);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546C67, true); // magic
    view.setUint32(4, 1, true);          // version 1
    view.setUint32(8, 12, true);

    expect(() => parseContainer(glb)).toThrow(/Unsupported GLB version/);
  });

  it('throws when GLB has no JSON chunk', () => {
    // Build a GLB header with no chunks following
    const glb = new ArrayBuffer(12);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546C67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 12, true);

    expect(() => parseContainer(glb)).toThrow(/does not contain a JSON chunk/);
  });
});

// ---------------------------------------------------------------------------
// readAccessorFloat
// ---------------------------------------------------------------------------

describe('readAccessorFloat', () => {
  it('reads VEC3 float accessor', () => {
    const { json, bin } = triangleAsset();
    const buffers = [bin];

    const positions = readAccessorFloat(json, buffers, 0);

    expect(positions).toBeInstanceOf(Float32Array);
    expect(positions.length).toBe(9); // 3 verts × 3 components
    expect(positions[0]).toBe(0);
    expect(positions[3]).toBe(1);
    expect(positions[7]).toBe(1);
  });

  it('returns empty array for undefined index', () => {
    const json = minimalGltf();
    const result = readAccessorFloat(json, [], undefined);
    expect(result.length).toBe(0);
  });

  it('throws for missing accessor', () => {
    const json = minimalGltf({ accessors: [] });
    expect(() => readAccessorFloat(json, [], 99)).toThrow(/Accessor 99 not found/);
  });
});

// ---------------------------------------------------------------------------
// readAccessorUint16
// ---------------------------------------------------------------------------

describe('readAccessorUint16', () => {
  it('reads SCALAR unsigned short index accessor', () => {
    const { json, bin } = triangleAsset();
    const buffers = [bin];

    const indices = readAccessorUint16(json, buffers, 1);

    expect(indices).toBeInstanceOf(Uint16Array);
    expect(indices.length).toBe(3);
    expect(Array.from(indices)).toEqual([0, 1, 2]);
  });

  it('reads UNSIGNED_BYTE indices and converts to Uint16', () => {
    const byteIndices = new Uint8Array([0, 1, 2]);
    const bin = byteIndices.buffer as ArrayBuffer;

    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_BYTE, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 3 }],
      buffers: [{ byteLength: 3 }],
    };

    const indices = readAccessorUint16(json, [bin], 0);
    expect(Array.from(indices)).toEqual([0, 1, 2]);
  });

  it('returns empty array for undefined index', () => {
    const json = minimalGltf();
    const result = readAccessorUint16(json, [], undefined);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadGltf (integration)
// ---------------------------------------------------------------------------

describe('loadGltf', () => {
  it('loads a plain JSON glTF with embedded data URI buffer', async () => {
    const { json, bin } = triangleAsset();

    // Encode the binary as a base64 data URI in the buffer definition
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bin)));
    json.buffers = [
      { uri: `data:application/octet-stream;base64,${base64}`, byteLength: bin.byteLength },
    ];

    const buffer = jsonToBuffer(json);
    const result = await loadGltf(buffer);

    expect(result.meshes).toHaveLength(1);
    expect(result.meshes[0].name).toBe('Triangle');
    expect(result.meshes[0].positions.length).toBe(9);
    expect(result.meshes[0].indices.length).toBe(3);
  });

  it('loads a GLB file with embedded binary chunk', async () => {
    const { json, bin } = triangleAsset();
    // In GLB, the first buffer has no URI
    json.buffers = [{ byteLength: bin.byteLength }];

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes).toHaveLength(1);
    expect(result.meshes[0].positions.length).toBe(9);
    expect(Array.from(result.meshes[0].indices)).toEqual([0, 1, 2]);
  });

  it('resolves external buffer URIs via callback', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'triangle.bin', byteLength: bin.byteLength }];

    const buffer = jsonToBuffer(json);
    const resolveUri = async (uri: string) => {
      expect(uri).toBe('triangle.bin');
      return bin;
    };

    const result = await loadGltf(buffer, resolveUri);
    expect(result.meshes).toHaveLength(1);
  });

  it('throws when external URI has no resolver', async () => {
    const { json } = triangleAsset();
    json.buffers = [{ uri: 'external.bin', byteLength: 42 }];

    const buffer = jsonToBuffer(json);
    await expect(loadGltf(buffer)).rejects.toThrow(/no resolveUri callback/);
  });

  it('handles meshes with normals and UVs', async () => {
    // 3 vertices × (3 pos + 3 normal + 2 uv) = 3×8 = 24 floats = 96 bytes
    // 3 indices = 6 bytes
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 36 + 24 + 6; // 102 bytes
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(normals.buffer as ArrayBuffer), 36);
    u8.set(new Uint8Array(uvs.buffer as ArrayBuffer), 72);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 96);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        name: 'TriangleWithNormalsUVs',
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
        }],
      }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: GL_FLOAT, count: 3, type: 'VEC2' },
        { bufferView: 3, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 24 },
        { buffer: 0, byteOffset: 96, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    json.buffers = [{ byteLength: totalBytes }];
    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes).toHaveLength(1);
    const m = result.meshes[0];
    expect(m.positions.length).toBe(9);
    expect(m.normals.length).toBe(9);
    expect(m.uvs.length).toBe(6);
    expect(m.indices.length).toBe(3);
    expect(m.normals[2]).toBe(1); // z component of first normal
  });

  it('handles multiple meshes', async () => {
    // Two triangles back-to-back
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const bin = new ArrayBuffer(42);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 36);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [
        {
          name: 'Mesh_A',
          primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
        },
        {
          name: 'Mesh_B',
          primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
        },
      ],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [{ byteLength: 42 }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes).toHaveLength(2);
    expect(result.meshes[0].name).toBe('Mesh_A');
    expect(result.meshes[1].name).toBe('Mesh_B');
  });

  it('returns node data from the asset', async () => {
    const { json, bin } = triangleAsset();
    json.nodes = [
      { name: 'Root', mesh: 0, translation: [1, 2, 3] },
    ];
    json.buffers = [{ byteLength: bin.byteLength }];

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('Root');
    expect(result.nodes[0].translation).toEqual([1, 2, 3]);
  });

  it('handles mesh with no indices', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bin = new ArrayBuffer(36);
    new Uint8Array(bin).set(new Uint8Array(positions.buffer as ArrayBuffer), 0);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        primitives: [{ attributes: { POSITION: 0 } }],
      }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
      ],
      buffers: [{ byteLength: 36 }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes).toHaveLength(1);
    expect(result.meshes[0].indices.length).toBe(0);
    expect(result.meshes[0].positions.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// MeshComponent (normals & uvs support)
// ---------------------------------------------------------------------------

describe('MeshComponent with normals and uvs', () => {
  it('has default empty normals and uvs', () => {
    const m = new MeshComponent();
    expect(m.normals.length).toBe(0);
    expect(m.uvs.length).toBe(0);
  });

  it('accepts normals and uvs in constructor', () => {
    const m = new MeshComponent(
      new Float32Array([0, 0, 0]),
      new Uint16Array([0]),
      new Float32Array([0, 0, 1]),
      new Float32Array([0.5, 0.5]),
    );
    expect(m.normals.length).toBe(3);
    expect(m.uvs.length).toBe(2);
  });
});
