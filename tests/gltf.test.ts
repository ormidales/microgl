import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  loadGltf,
  parseContainer,
  readAccessorFloat,
  readAccessorIndices,
  buildNodeLocalMatrix,
} from '../src/core/GltfLoader';
import * as GltfLoaderModule from '../src/core/GltfLoader';
import type { GltfAsset, GltfComponentType } from '../src/core/GltfTypes';
import { GL_FLOAT, GL_UNSIGNED_SHORT, GL_UNSIGNED_BYTE, GL_UNSIGNED_INT, GL_SHORT } from '../src/core/GltfTypes';
import { MeshComponent } from '../src/core/ecs/components/MeshComponent';

const gltfLoaderSource = readFileSync(new URL('../src/core/GltfLoader.ts', import.meta.url), 'utf8');

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

describe('GltfPrimitive typing', () => {
  it('supports standard glTF 2.0 attribute semantics', () => {
    const asset: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [
        {
          primitives: [
            {
              attributes: {
                POSITION: 0,
                TEXCOORD_1: 1,
                COLOR_0: 2,
                JOINTS_0: 3,
                WEIGHTS_0: 4,
              },
            },
          ],
        },
      ],
    };

    expect(asset.meshes?.[0].primitives[0].attributes.TEXCOORD_1).toBe(1);
    expect(asset.meshes?.[0].primitives[0].attributes.COLOR_0).toBe(2);
    expect(asset.meshes?.[0].primitives[0].attributes.JOINTS_0).toBe(3);
    expect(asset.meshes?.[0].primitives[0].attributes.WEIGHTS_0).toBe(4);
  });
});

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

  it('rejects oversized plain JSON glTF payloads before decode', () => {
    const oversized = new ArrayBuffer((64 * 1024 * 1024) + 1);
    expect(() => parseContainer(oversized)).toThrow(/payload too large/);
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

  it('throws when GLB chunk length is zero', () => {
    const glb = new ArrayBuffer(20);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546C67, true); // magic
    view.setUint32(4, 2, true);          // version 2
    view.setUint32(8, 20, true);
    view.setUint32(12, 0, true);         // chunk length
    view.setUint32(16, 0x4E4F534A, true); // JSON

    expect(() => parseContainer(glb)).toThrow(/Invalid chunk length/);
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

  it('reuses a single TextDecoder instance across multiple parses', async () => {
    const OriginalTextDecoder = globalThis.TextDecoder;
    let decoderInstanceCount = 0;

    class CountingTextDecoder {
      constructor() {
        decoderInstanceCount++;
      }

      decode(input?: ArrayBuffer | ArrayBufferView): string {
        return new OriginalTextDecoder().decode(input);
      }
    }

    vi.stubGlobal('TextDecoder', CountingTextDecoder as unknown as typeof TextDecoder);
    vi.resetModules();

    try {
      const { parseContainer: parseContainerWithStub } = await import('../src/core/GltfLoader');
      const asset = minimalGltf();
      const jsonBuffer = jsonToBuffer(asset);
      const glbBuffer = buildGlb(asset);

      parseContainerWithStub(jsonBuffer);
      parseContainerWithStub(glbBuffer);
      parseContainerWithStub(jsonBuffer);

      expect(decoderInstanceCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
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

  it('reads MAT3 accessors with column padding required by glTF alignment', () => {
    const bin = new Uint8Array([
      1, 2, 3, 0,
      4, 5, 6, 0,
      7, 8, 9, 0,
    ]).buffer as ArrayBuffer;

    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_BYTE, count: 1, type: 'MAT3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      buffers: [{ byteLength: 12 }],
    };

    const matrix = readAccessorFloat(json, [bin], 0);
    expect(Array.from(matrix)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('throws when float accessor exceeds its bufferView bounds', () => {
    const bin = new ArrayBuffer(32);
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16, byteStride: 16 }],
      buffers: [{ byteLength: 32 }],
    };

    expect(() => readAccessorFloat(json, [bin], 0)).toThrow(/exceeds available buffer bounds/);
  });

  it('throws for sparse float accessor', () => {
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 1, type: 'SCALAR', sparse: {} },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      buffers: [{ byteLength: 4 }],
    };

    expect(() => readAccessorFloat(json, [new ArrayBuffer(4)], 0)).toThrow(/Sparse accessor 0 is not supported/);
  });

  it('throws with accessor index when component type is invalid', () => {
    const bin = new Float32Array([1, 2, 3]).buffer as ArrayBuffer;
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: 9999 as unknown as GltfComponentType, count: 1, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      buffers: [{ byteLength: 12 }],
    };

    expect(() => readAccessorFloat(json, [bin], 0)).toThrow(/Accessor 0/);
    expect(() => readAccessorFloat(json, [bin], 0)).toThrow(/9999/);
  });

  it('reads tightly-packed GL_SHORT VEC3 via TypedArray fast path', () => {
    const src = new Int16Array([10, 20, 30, 40, 50, 60]);
    const bin = src.buffer as ArrayBuffer;
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_SHORT, count: 2, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      buffers: [{ byteLength: 12 }],
    };

    const result = readAccessorFloat(json, [bin], 0);
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('reads tightly-packed GL_UNSIGNED_BYTE VEC3 via TypedArray fast path', () => {
    const src = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const bin = src.buffer as ArrayBuffer;
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_BYTE, count: 2, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 6 }],
      buffers: [{ byteLength: 6 }],
    };

    const result = readAccessorFloat(json, [bin], 0);
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('falls back to DataView for interleaved GL_SHORT accessor', () => {
    // byteStride=8 with a VEC3 GL_SHORT (elementSize=6) → interleaved, 2-byte gap between elements
    const raw = new Uint8Array(16);
    const view = new DataView(raw.buffer);
    view.setInt16(0, 100, true); view.setInt16(2, 200, true); view.setInt16(4, 300, true);
    view.setInt16(8, 400, true); view.setInt16(10, 500, true); view.setInt16(12, 600, true);
    const bin = raw.buffer as ArrayBuffer;
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_SHORT, count: 2, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16, byteStride: 8 }],
      buffers: [{ byteLength: 16 }],
    };

    const result = readAccessorFloat(json, [bin], 0);
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([100, 200, 300, 400, 500, 600]);
  });

  it('throws when tightly-packed GL_SHORT accessor exceeds its bufferView bounds', () => {
    const bin = new ArrayBuffer(8); // only 8 bytes, but accessor needs count*elementSize = 2*6 = 12
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_SHORT, count: 2, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
      buffers: [{ byteLength: 8 }],
    };

    expect(() => readAccessorFloat(json, [bin], 0)).toThrow(/exceeds available buffer bounds/);
  });

  it('throws when tightly-packed GL_UNSIGNED_BYTE accessor exceeds its bufferView bounds', () => {
    const bin = new ArrayBuffer(4); // only 4 bytes, but accessor needs count*elementSize = 2*3 = 6
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_BYTE, count: 2, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      buffers: [{ byteLength: 4 }],
    };

    expect(() => readAccessorFloat(json, [bin], 0)).toThrow(/exceeds available buffer bounds/);
  });
});

// ---------------------------------------------------------------------------
// readAccessorIndices
// ---------------------------------------------------------------------------

describe('GltfLoader module exports', () => {
  it('does not expose deprecated readAccessorUint16 export', () => {
    expect('readAccessorUint16' in GltfLoaderModule).toBe(false);
  });
});

describe('readAccessorIndices', () => {
  it('reads SCALAR unsigned short index accessor', () => {
    const { json, bin } = triangleAsset();
    const buffers = [bin];

    const indices = readAccessorIndices(json, buffers, 1);

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

    const indices = readAccessorIndices(json, [bin], 0);
    expect(Array.from(indices)).toEqual([0, 1, 2]);
  });

  it('reads UNSIGNED_INT indices as Uint32', () => {
    const intIndices = new Uint32Array([0, 1, 70000]);
    const bin = intIndices.buffer as ArrayBuffer;

    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_INT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      buffers: [{ byteLength: 12 }],
    };

    const indices = readAccessorIndices(json, [bin], 0);
    expect(indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(indices)).toEqual([0, 1, 70000]);
  });

  it('returns empty array for undefined index', () => {
    const json = minimalGltf();
    const result = readAccessorIndices(json, [], undefined);
    expect(result.length).toBe(0);
  });

  it('throws when index accessor count exceeds buffer bounds', () => {
    const bin = new Uint16Array([0, 1, 2]).buffer as ArrayBuffer;
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_SHORT, count: 4, type: 'SCALAR' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 6 }],
      buffers: [{ byteLength: 6 }],
    };

    expect(() => readAccessorIndices(json, [bin], 0)).toThrow(/exceeds available buffer bounds/);
  });

  it('throws for sparse index accessor', () => {
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: GL_UNSIGNED_SHORT, count: 1, type: 'SCALAR', sparse: {} },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 2 }],
      buffers: [{ byteLength: 2 }],
    };

    expect(() => readAccessorIndices(json, [new ArrayBuffer(2)], 0)).toThrow(/Sparse accessor 0 is not supported/);
  });

  it('throws with accessor index when index component type is invalid', () => {
    const bin = new Uint16Array([0, 1, 2]).buffer as ArrayBuffer;
    const json: GltfAsset = {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: 9999 as unknown as GltfComponentType, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 6 }],
      buffers: [{ byteLength: 6 }],
    };

    expect(() => readAccessorIndices(json, [bin], 0)).toThrow(/Accessor 0/);
    expect(() => readAccessorIndices(json, [bin], 0)).toThrow(/9999/);
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

  it('decodes data URI buffers via async fetch', async () => {
    const { json, bin } = triangleAsset();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bin)));
    const uri = `data:application/octet-stream;base64,${base64}`;
    json.buffers = [{ uri, byteLength: bin.byteLength }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bin),
    } as unknown as Response);

    try {
      const buffer = jsonToBuffer(json);
      const result = await loadGltf(buffer);
      expect(fetchSpy).toHaveBeenCalledWith(uri);
      expect(result.meshes).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('falls back to direct base64 decoding when fetch rejects data URI', async () => {
    const { json, bin } = triangleAsset();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bin)));
    const uri = `data:application/octet-stream;base64,${base64}`;
    json.buffers = [{ uri, byteLength: bin.byteLength }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NetworkError'));

    try {
      const buffer = jsonToBuffer(json);
      const result = await loadGltf(buffer);
      expect(fetchSpy).toHaveBeenCalledWith(uri);
      expect(result.meshes).toHaveLength(1);
      expect(Array.from(result.meshes[0].indices)).toEqual([0, 1, 2]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps original fetch error context when fallback base64 decoding also fails', async () => {
    const { json } = triangleAsset();
    const uri = 'data:application/octet-stream;base64,@@@';
    json.buffers = [{ uri, byteLength: 1 }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CSP blocked data URI'));

    try {
      const buffer = jsonToBuffer(json);
      await expect(loadGltf(buffer)).rejects.toMatchObject({
        message: expect.stringContaining('Initial fetch failure: CSP blocked data URI'),
        cause: expect.objectContaining({ message: 'CSP blocked data URI' }),
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('attaches original fetch error as cause when fetch throws and data URI is not base64', async () => {
    const { json } = triangleAsset();
    // Plain (URL-encoded) data URI — no ;base64 in header
    const uri = 'data:application/octet-stream,some-data';
    json.buffers = [{ uri, byteLength: 1 }];

    const networkError = new Error('CORS policy blocked request');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkError);

    try {
      const buffer = jsonToBuffer(json);
      await expect(loadGltf(buffer)).rejects.toMatchObject({
        message: expect.stringContaining('CORS policy blocked request'),
        cause: expect.objectContaining({ message: 'CORS policy blocked request' }),
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('attaches fetch status as cause when fetch returns non-OK and base64 decoding also fails', async () => {
    const { json } = triangleAsset();
    const uri = 'data:application/octet-stream;base64,@@@';
    json.buffers = [{ uri, byteLength: 1 }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
    } as unknown as Response);

    try {
      const buffer = jsonToBuffer(json);
      await expect(loadGltf(buffer)).rejects.toMatchObject({
        message: expect.stringContaining('Initial fetch failure: status 403'),
        cause: expect.objectContaining({ message: 'status 403' }),
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('decodes data URI buffer without MIME type (data:;base64,...)', async () => {
    const { json, bin } = triangleAsset();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bin)));
    const uri = `data:;base64,${base64}`;
    json.buffers = [{ uri, byteLength: bin.byteLength }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bin),
    } as unknown as Response);

    try {
      const buffer = jsonToBuffer(json);
      const result = await loadGltf(buffer);
      expect(fetchSpy).toHaveBeenCalledWith(uri);
      expect(result.meshes).toHaveLength(1);
      expect(Array.from(result.meshes[0].indices)).toEqual([0, 1, 2]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('falls back to direct base64 decoding for data URI without MIME type when fetch fails', async () => {
    const { json, bin } = triangleAsset();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bin)));
    const uri = `data:;base64,${base64}`;
    json.buffers = [{ uri, byteLength: bin.byteLength }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NetworkError'));

    try {
      const buffer = jsonToBuffer(json);
      const result = await loadGltf(buffer);
      expect(fetchSpy).toHaveBeenCalledWith(uri);
      expect(result.meshes).toHaveLength(1);
      expect(Array.from(result.meshes[0].indices)).toEqual([0, 1, 2]);
    } finally {
      fetchSpy.mockRestore();
    }
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

  it('throws a descriptive error when multiple URI-less buffers are declared (buffer index included)', async () => {
    // A malformed GLB that declares two buffers without URIs is invalid:
    // only one embedded binary chunk exists and it must not be reused.
    const { json, bin } = triangleAsset();
    json.buffers = [
      { byteLength: bin.byteLength },   // buffer 0 – consumed by binChunk
      { byteLength: bin.byteLength },   // buffer 1 – no URI, should trigger error
    ];

    const glb = buildGlb(json, bin);
    const err = await loadGltf(glb).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    // Error message must name the offending buffer index (1)
    expect((err as Error).message).toMatch(/Buffer 1/);
    // Error message must mention the binary chunk already being consumed
    expect((err as Error).message).toMatch(/already been consumed/);
  });

  it('resolves external buffer URIs via callback', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'triangle.bin', byteLength: bin.byteLength }];

    const buffer = jsonToBuffer(json);
    const resolveUri = async (uri: string) => {
      expect(uri).toBe('triangle.bin');
      return bin;
    };

    const result = await loadGltf(buffer, { resolveUri });
    expect(result.meshes).toHaveLength(1);
  });

  it('allows overriding JSON payload size limit via options', async () => {
    const buffer = jsonToBuffer(minimalGltf());

    await expect(loadGltf(buffer, { maxJsonBufferBytes: 1 })).rejects.toThrow(/payload too large/);
    await expect(loadGltf(buffer, { maxJsonBufferBytes: buffer.byteLength })).resolves.toMatchObject({
      meshes: [],
      nodes: [],
    });
  });

  it('throws when external URI has no resolver', async () => {
    const { json } = triangleAsset();
    json.buffers = [{ uri: 'external.bin', byteLength: 42 }];

    const buffer = jsonToBuffer(json);
    await expect(loadGltf(buffer)).rejects.toThrow(/no resolveUri callback/);
  });

  // ---------------------------------------------------------------------------
  // External URI validation (SSRF / path traversal)
  // ---------------------------------------------------------------------------

  it('rejects path traversal URI "../../../etc/passwd"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: '../../../etc/passwd', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects path traversal URI "subdir/../../../secret.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'subdir/../../../secret.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects absolute HTTP URI "http://evil.com/payload.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'http://evil.com/payload.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects absolute HTTPS URI "https://evil.com/payload.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'https://evil.com/payload.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects file:// URI "file:///etc/passwd"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'file:///etc/passwd', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects protocol-relative URI "//evil.com/payload.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: '//evil.com/payload.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects URI containing a null byte', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'triangle\0.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/null byte/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('allows a valid simple relative URI without strict mode', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'models/triangle.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).resolves.toMatchObject({ meshes: expect.any(Array) });
    expect(resolveUri).toHaveBeenCalledWith('models/triangle.bin');
  });

  it('allows a valid simple relative URI in strict mode', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'models/triangle.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri, strict: true })).resolves.toMatchObject({ meshes: expect.any(Array) });
    expect(resolveUri).toHaveBeenCalledWith('models/triangle.bin');
  });

  it('rejects URI with special characters in strict mode', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'models/my file.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri, strict: true })).rejects.toThrow(/not permitted in strict mode/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects URL-encoded path traversal URI "%2e%2e%2fetc%2fpasswd"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: '%2e%2e%2fetc%2fpasswd', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects non-http/file scheme URI "ftp://files.example.com/payload.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'ftp://files.example.com/payload.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects percent-encoded scheme URI "%68%74%74%70:%2f%2fevil.com"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: '%68%74%74%70:%2f%2fevil.com/payload.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects percent-encoded null byte URI "triangle%00.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'triangle%00.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/null byte/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects absolute path URI "/etc/passwd"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: '/etc/passwd', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('rejects Windows/UNC-style path URI "\\\\server\\share\\file.bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: '\\\\server\\share\\file.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).rejects.toThrow(/Only relative paths without traversal/);
    expect(resolveUri).not.toHaveBeenCalled();
  });

  it('allows URI with double-dot within a filename segment "file..bin"', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'file..bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).resolves.toMatchObject({ meshes: expect.any(Array) });
    expect(resolveUri).toHaveBeenCalledWith('file..bin');
  });

  it('allows URI with spaces in non-strict mode', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ uri: 'my file.bin', byteLength: bin.byteLength }];
    const buffer = jsonToBuffer(json);
    const resolveUri = vi.fn().mockResolvedValue(bin);
    await expect(loadGltf(buffer, { resolveUri })).resolves.toMatchObject({ meshes: expect.any(Array) });
    expect(resolveUri).toHaveBeenCalledWith('my file.bin');
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
    // loader must inject localMatrix
    expect(result.nodes[0].localMatrix).toHaveLength(16);
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

  it('skips primitives with empty POSITION accessor', async () => {
    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        primitives: [{ attributes: { POSITION: 0 } }],
      }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 0, type: 'VEC3' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 0 },
      ],
      buffers: [{ byteLength: 0 }],
    };

    json.buffers = [{ uri: 'data:application/octet-stream;base64,', byteLength: 0 }];
    const result = await loadGltf(jsonToBuffer(json));

    expect(result.meshes).toHaveLength(0);
  });

  it('propagates POSITION accessor min/max bounds', async () => {
    const { json, bin } = triangleAsset();
    json.accessors![0].min = [0, 0, 0];
    json.accessors![0].max = [1, 1, 0];
    json.buffers = [{ byteLength: bin.byteLength }];

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes[0].min).toEqual([0, 0, 0]);
    expect(result.meshes[0].max).toEqual([1, 1, 0]);
  });

  it('computes POSITION bounds when accessor min/max are missing', async () => {
    const { json, bin } = triangleAsset();
    json.accessors![0].min = undefined;
    json.accessors![0].max = undefined;
    json.buffers = [{ byteLength: bin.byteLength }];

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes[0].min).toEqual([0, 0, 0]);
    expect(result.meshes[0].max).toEqual([1, 1, 0]);
  });

  it('throws when position accessor has fewer than 3 components', async () => {
    // SCALAR accessor with count=2 yields a Float32Array of length 2 (<3 components).
    const positionData = new Float32Array([1, 2]);
    const bin = positionData.buffer as ArrayBuffer;

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{ name: 'Bad', primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 2, type: 'SCALAR' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
      buffers: [{ byteLength: bin.byteLength }],
    };

    const glb = buildGlb(json, bin);
    await expect(loadGltf(glb)).rejects.toThrow(/Invalid position data/);
  });

  it('normalizes non-unit normals when normalizeNormals option is true', async () => {
    // Use a normal with length 2 (should become unit length after normalization)
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 2, 2, 0, 0, 0, 2, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 36 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(normals.buffer as ArrayBuffer), 36);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 72);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{ name: 'Test', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb, { normalizeNormals: true });

    const n = result.meshes[0].normals;
    // Each normal should now be unit length
    for (let i = 0; i + 2 < n.length; i += 3) {
      const len = Math.sqrt(n[i] ** 2 + n[i + 1] ** 2 + n[i + 2] ** 2);
      expect(len).toBeCloseTo(1, 5);
    }
    // First normal (0,0,2) -> (0,0,1)
    expect(n[0]).toBeCloseTo(0, 5);
    expect(n[1]).toBeCloseTo(0, 5);
    expect(n[2]).toBeCloseTo(1, 5);
  });

  it('does not normalize normals when normalizeNormals option is false or omitted', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 2, 2, 0, 0, 0, 2, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 36 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(normals.buffer as ArrayBuffer), 36);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 72);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{ name: 'Test', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    // Original non-unit normals are preserved
    expect(result.meshes[0].normals[2]).toBeCloseTo(2, 5);
  });

  it('leaves zero-length normals unchanged when normalizeNormals is true', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 36 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(normals.buffer as ArrayBuffer), 36);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 72);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{ name: 'Test', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb, { normalizeNormals: true });

    const n = result.meshes[0].normals;
    // Zero-length normal (0,0,0) is left unchanged (no NaN)
    expect(n[0]).toBe(0);
    expect(n[1]).toBe(0);
    expect(n[2]).toBe(0);
    // Already-unit normal (0,0,1) stays unchanged
    expect(n[5]).toBeCloseTo(1, 5);
  });

  it('sets baseColorTextureIndex when material has a base-color texture and TEXCOORD_0 is present', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 24 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(uvs.buffer as ArrayBuffer), 36);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 60);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        name: 'TexturedMesh',
        primitives: [{
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
          indices: 2,
          material: 0,
        }],
      }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
        },
      }],
      textures: [{ source: 0 }],
      images: [{ uri: 'texture.png' }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_FLOAT, count: 3, type: 'VEC2' },
        { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 24 },
        { buffer: 0, byteOffset: 60, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes).toHaveLength(1);
    expect(result.meshes[0].baseColorTextureIndex).toBe(0);
    expect(result.meshes[0].uvs.length).toBe(6);
  });

  it('warns and skips baseColorTextureIndex when material has a texture but TEXCOORD_0 is absent', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 36);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        name: 'NoUVMesh',
        primitives: [{
          attributes: { POSITION: 0 },
          indices: 1,
          material: 0,
        }],
      }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
        },
      }],
      textures: [{ source: 0 }],
      images: [{ uri: 'texture.png' }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const glb = buildGlb(json, bin);
      const result = await loadGltf(glb);

      expect(result.meshes).toHaveLength(1);
      expect(result.meshes[0].baseColorTextureIndex).toBeUndefined();
      expect(result.meshes[0].uvs.length).toBe(0);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/TEXCOORD_0.*absent/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/base-color/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/NoUVMesh/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not set baseColorTextureIndex when primitive has no material', async () => {
    const { json, bin } = triangleAsset();
    json.buffers = [{ byteLength: bin.byteLength }];

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes[0].baseColorTextureIndex).toBeUndefined();
  });

  it('does not set baseColorTextureIndex when material has no base-color texture', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 36);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        name: 'UnlitMesh',
        primitives: [{
          attributes: { POSITION: 0 },
          indices: 1,
          material: 0,
        }],
      }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes[0].baseColorTextureIndex).toBeUndefined();
  });

  it('sets baseColorTextureIndex when baseColorTexture.texCoord is 1 and TEXCOORD_1 is present', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const uvs1 = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 24 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(uvs1.buffer as ArrayBuffer), 36);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 60);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        name: 'MultiUVMesh',
        primitives: [{
          attributes: { POSITION: 0, TEXCOORD_1: 1 },
          indices: 2,
          material: 0,
        }],
      }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0, texCoord: 1 },
        },
      }],
      textures: [{ source: 0 }],
      images: [{ uri: 'texture.png' }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_FLOAT, count: 3, type: 'VEC2' },
        { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 24 },
        { buffer: 0, byteOffset: 60, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.meshes[0].baseColorTextureIndex).toBe(0);
    expect(result.meshes[0].uvs.length).toBe(6);
  });

  it('warns and skips baseColorTextureIndex when baseColorTexture.texCoord is 1 but TEXCOORD_1 is absent', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const totalBytes = 36 + 6;
    const bin = new ArrayBuffer(totalBytes);
    const u8 = new Uint8Array(bin);
    u8.set(new Uint8Array(positions.buffer as ArrayBuffer), 0);
    u8.set(new Uint8Array(indices.buffer as ArrayBuffer), 36);

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{
        name: 'MissingUV1Mesh',
        primitives: [{
          attributes: { POSITION: 0 },
          indices: 1,
          material: 0,
        }],
      }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0, texCoord: 1 },
        },
      }],
      textures: [{ source: 0 }],
      images: [{ uri: 'texture.png' }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: GL_UNSIGNED_SHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [{ byteLength: totalBytes }],
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const glb = buildGlb(json, bin);
      const result = await loadGltf(glb);

      expect(result.meshes[0].baseColorTextureIndex).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/TEXCOORD_1.*absent/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/MissingUV1Mesh/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // Error-handling: try/catch wrapping
  // -------------------------------------------------------------------------

  it('wraps a corrupt GLB container error with "Failed to parse glTF container" prefix', async () => {
    // A GLB whose version field is 1 (unsupported) triggers parseContainer to throw.
    const glb = new ArrayBuffer(12);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546C67, true); // magic
    view.setUint32(4, 1, true);          // unsupported version
    view.setUint32(8, 12, true);

    await expect(loadGltf(glb)).rejects.toMatchObject({
      message: expect.stringContaining('Failed to parse glTF container'),
      cause: expect.objectContaining({ message: expect.stringContaining('Unsupported GLB version') }),
    });
  });

  it('wraps a corrupt GLB container error (no JSON chunk) with "Failed to parse glTF container" prefix', async () => {
    // A valid GLB header but with no chunks following.
    const glb = new ArrayBuffer(12);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546C67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 12, true);

    await expect(loadGltf(glb)).rejects.toMatchObject({
      message: expect.stringContaining('Failed to parse glTF container'),
      cause: expect.objectContaining({ message: expect.stringContaining('JSON chunk') }),
    });
  });

  it('wraps a mesh extraction error (accessor pointing to missing bufferView) with "Failed to extract glTF meshes" prefix', async () => {
    // Accessor 0 references bufferView 99, which does not exist.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bin = positions.buffer as ArrayBuffer;

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{ name: 'BadMesh', primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { bufferView: 99, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    };

    const glb = buildGlb(json, bin);
    await expect(loadGltf(glb)).rejects.toMatchObject({
      message: expect.stringContaining('Failed to extract glTF meshes'),
      cause: expect.objectContaining({ message: expect.stringContaining('BufferView 99') }),
    });
  });

  it('wraps a mesh extraction error (accessor index out of range) with "Failed to extract glTF meshes" prefix', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bin = positions.buffer as ArrayBuffer;

    const json: GltfAsset = {
      asset: { version: '2.0' },
      meshes: [{ name: 'BadMesh', primitives: [{ attributes: { POSITION: 0 }, indices: 99 }] }],
      accessors: [
        { bufferView: 0, componentType: GL_FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    };

    const glb = buildGlb(json, bin);
    await expect(loadGltf(glb)).rejects.toMatchObject({
      message: expect.stringContaining('Failed to extract glTF meshes'),
      cause: expect.objectContaining({ message: expect.stringContaining('Accessor 99') }),
    });
  });

  it('rejects with unwrapped error when resolveUri callback is absent', async () => {
    // Error comes from resolveBuffers, not from parseContainer or extractMeshes,
    // so it must NOT carry the "Failed to parse …" / "Failed to extract …" prefixes.
    const { json } = triangleAsset();
    json.buffers = [{ uri: 'external.bin', byteLength: 42 }];

    const buffer = jsonToBuffer(json);
    const err = await loadGltf(buffer).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/no resolveUri callback/);
    expect(message).not.toMatch(/Failed to parse glTF container/);
    expect(message).not.toMatch(/Failed to extract glTF meshes/);
    // resolveBuffers errors are not wrapped, so there is no added cause layer.
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('preserves fetch error cause chain from resolveBuffers without re-wrapping', async () => {
    // Use invalid base64 so decodeDataUri's atob fallback also fails, forcing the
    // error path that attaches the original fetch failure as `cause`. The fetch is
    // mocked to return a non-OK 403 response, which is what decodeDataUri stores.
    const { json, bin } = triangleAsset();
    const uri = `data:application/octet-stream;base64,@@@invalid`; // invalid base64 → atob fallback throws
    json.buffers = [{ uri, byteLength: bin.byteLength }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
    } as unknown as Response);

    try {
      const buffer = jsonToBuffer(json);
      const err = await loadGltf(buffer).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      // The error originates in decodeDataUri / resolveBuffers – not re-wrapped.
      expect(message).not.toMatch(/Failed to parse glTF container/);
      expect(message).not.toMatch(/Failed to extract glTF meshes/);
      // The original fetch failure must be attached as cause.
      expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
      expect(((err as Error & { cause?: Error }).cause)!.message).toMatch(/status 403/);
    } finally {
      fetchSpy.mockRestore();
    }
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
    expect(m.min).toEqual([]);
    expect(m.max).toEqual([]);
  });

  it('accepts normals and uvs in constructor', () => {
    const m = new MeshComponent(
      new Float32Array([0, 0, 0]),
      new Uint16Array([0]),
      new Float32Array([0, 0, 1]),
      new Float32Array([0.5, 0.5]),
      [0, 0, 0],
      [1, 1, 1],
    );
    expect(m.normals.length).toBe(3);
    expect(m.uvs.length).toBe(2);
    expect(m.min).toEqual([0, 0, 0]);
    expect(m.max).toEqual([1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// buildNodeLocalMatrix
// ---------------------------------------------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('buildNodeLocalMatrix', () => {
  it('returns identity matrix when node has no transform properties', () => {
    const result = buildNodeLocalMatrix({});
    expect(result).toEqual(IDENTITY);
  });

  it('returns identity matrix when node has only name/mesh/children', () => {
    const result = buildNodeLocalMatrix({ name: 'Empty', mesh: 0, children: [1] });
    expect(result).toEqual(IDENTITY);
  });

  it('returns a copy of the matrix property when present', () => {
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1];
    const result = buildNodeLocalMatrix({ matrix: m });
    expect(result).toEqual(m);
    // Must be a copy, not the same reference
    expect(result).not.toBe(m);
  });

  it('ignores a malformed matrix (length !== 16) and falls back to TRS', () => {
    // 15-element array should be ignored; no TRS → identity
    const result = buildNodeLocalMatrix({ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0] });
    expect(result).toEqual(IDENTITY);
  });

  it('applies translation only', () => {
    const result = buildNodeLocalMatrix({ translation: [3, 5, 7] });
    // Column-major: translation lives in column 3 (indices 12-14)
    expect(result[12]).toBe(3);
    expect(result[13]).toBe(5);
    expect(result[14]).toBe(7);
    expect(result[15]).toBe(1);
    // Rotation/scale part must be identity
    expect(result[0]).toBeCloseTo(1);
    expect(result[5]).toBeCloseTo(1);
    expect(result[10]).toBeCloseTo(1);
  });

  it('applies scale only', () => {
    const result = buildNodeLocalMatrix({ scale: [2, 3, 4] });
    expect(result[0]).toBeCloseTo(2);
    expect(result[5]).toBeCloseTo(3);
    expect(result[10]).toBeCloseTo(4);
    expect(result[12]).toBe(0);
    expect(result[13]).toBe(0);
    expect(result[14]).toBe(0);
  });

  it('applies identity rotation (quaternion [0,0,0,1]) correctly', () => {
    const result = buildNodeLocalMatrix({ rotation: [0, 0, 0, 1] });
    expect(result).toEqual(IDENTITY);
  });

  it('applies 90-degree rotation around Z axis', () => {
    // quaternion for 90° around Z: (0, 0, sin(π/4), cos(π/4))
    const s = Math.sin(Math.PI / 4);
    const c = Math.cos(Math.PI / 4);
    const result = buildNodeLocalMatrix({ rotation: [0, 0, s, c] });
    // Column 0 should be (0, 1, 0, 0) — X-axis maps to Y
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo(1, 5);
    expect(result[2]).toBeCloseTo(0, 5);
    // Column 1 should be (-1, 0, 0, 0) — Y-axis maps to -X
    expect(result[4]).toBeCloseTo(-1, 5);
    expect(result[5]).toBeCloseTo(0, 5);
    expect(result[6]).toBeCloseTo(0, 5);
  });

  it('composes TRS correctly', () => {
    // T=[1,0,0], R=identity, S=[2,2,2]
    const result = buildNodeLocalMatrix({
      translation: [1, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [2, 2, 2],
    });
    expect(result[0]).toBeCloseTo(2);
    expect(result[5]).toBeCloseTo(2);
    expect(result[10]).toBeCloseTo(2);
    expect(result[12]).toBe(1);
    expect(result[13]).toBe(0);
    expect(result[14]).toBe(0);
    expect(result[15]).toBe(1);
  });

  it('loadGltf attaches localMatrix to every node', async () => {
    const { json, bin } = triangleAsset();
    // Node with no transform data at all
    json.nodes = [
      { name: 'NoTransform' },
      { name: 'WithTranslation', translation: [1, 2, 3] },
    ];
    json.buffers = [{ byteLength: bin.byteLength }];

    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);

    expect(result.nodes[0].localMatrix).toEqual(IDENTITY);
    expect(result.nodes[1].localMatrix).toBeDefined();
    expect(result.nodes[1].localMatrix[12]).toBe(1);
    expect(result.nodes[1].localMatrix[13]).toBe(2);
    expect(result.nodes[1].localMatrix[14]).toBe(3);
  });

  it('warns and normalizes a non-unit quaternion', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Quaternion with length 2 (doubles each component of identity)
    const result = buildNodeLocalMatrix({ name: 'BadQ', rotation: [0, 0, 0, 2] });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('BadQ');
    expect(warnSpy.mock.calls[0][0]).toContain('normalizing');
    // After normalizing [0,0,0,2] → [0,0,0,1] which is the identity rotation
    expect(result).toEqual(IDENTITY);
    warnSpy.mockRestore();
  });

  it('does not warn for a quaternion within the 1e-4 tolerance', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Nearly unit quaternion; deviation < 1e-4
    buildNodeLocalMatrix({ rotation: [0, 0, 0, 1.00005] });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws in strict mode for a non-unit quaternion', () => {
    expect(() =>
      buildNodeLocalMatrix({ name: 'StrictNode', rotation: [0, 0, 0, 2] }, { strict: true }),
    ).toThrow('StrictNode');
  });

  it('does not throw in strict mode for a valid unit quaternion', () => {
    const s = Math.sin(Math.PI / 4);
    const c = Math.cos(Math.PI / 4);
    expect(() =>
      buildNodeLocalMatrix({ rotation: [0, 0, s, c] }, { strict: true }),
    ).not.toThrow();
  });

  it('loadGltf strict option propagates and throws for non-unit quaternion', async () => {
    const { json, bin } = triangleAsset();
    json.nodes = [{ name: 'BadQ', rotation: [0, 0, 0, 2] }];
    json.buffers = [{ byteLength: bin.byteLength }];
    const glb = buildGlb(json, bin);
    await expect(loadGltf(glb, { strict: true })).rejects.toThrow('BadQ');
  });

  it('loadGltf warns (not throws) for non-unit quaternion without strict mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { json, bin } = triangleAsset();
    json.nodes = [{ name: 'BadQ', rotation: [0, 0, 0, 2] }];
    json.buffers = [{ byteLength: bin.byteLength }];
    const glb = buildGlb(json, bin);
    const result = await loadGltf(glb);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(result.nodes[0].localMatrix).toEqual(IDENTITY);
    warnSpy.mockRestore();
  });
});

describe('GltfLoaderOptions JSDoc', () => {
  it('normalizeNormals JSDoc mentions O(n) cost', () => {
    expect(gltfLoaderSource).toContain('O(n)');
  });

  it('normalizeNormals JSDoc documents the false default value', () => {
    expect(gltfLoaderSource).toContain('(default)');
    expect(gltfLoaderSource).toContain('`false`');
  });

  it('strict JSDoc explains error-vs-warning behaviour', () => {
    expect(gltfLoaderSource).toContain('throw an `Error`');
  });

  it('strict JSDoc recommends enabling in CI', () => {
    expect(gltfLoaderSource).toContain('CI');
  });

  it('strict JSDoc documents the false default value', () => {
    expect(gltfLoaderSource).toContain('(default) in production');
  });
});
