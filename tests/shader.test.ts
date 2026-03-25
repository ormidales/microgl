import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShader, createProgram } from '../src/core/ShaderUtils';
import { ShaderCache } from '../src/core/ShaderCache';
import {
  Material,
  DEFAULT_VERTEX_SOURCE,
  DEFAULT_FRAGMENT_SOURCE,
} from '../src/core/Material';

const materialSource = readFileSync(new URL('../src/core/Material.ts', import.meta.url), 'utf8');
const shaderCacheSource = readFileSync(new URL('../src/core/ShaderCache.ts', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// WebGL 2 mock helpers
// ---------------------------------------------------------------------------

function createMockGL(overrides: Record<string, unknown> = {}): WebGL2RenderingContext {
  const mockShader = { __type: 'shader' } as unknown as WebGLShader;
  const mockProgram = { __type: 'program' } as unknown as WebGLProgram;
  const mockLocation = { __type: 'location' } as unknown as WebGLUniformLocation;

  return {
    VERTEX_SHADER: 0x8B31,
    FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,

    createShader: vi.fn(() => mockShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),

    createProgram: vi.fn(() => mockProgram),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),

    useProgram: vi.fn(),
    getUniformLocation: vi.fn(() => mockLocation),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    uniformMatrix4fv: vi.fn(),

    ...overrides,
  } as unknown as WebGL2RenderingContext;
}

// ---------------------------------------------------------------------------
// createShader
// ---------------------------------------------------------------------------

describe('createShader', () => {
  it('compiles a vertex shader successfully', () => {
    const gl = createMockGL();
    const shader = createShader(gl, gl.VERTEX_SHADER, 'void main(){}');

    expect(gl.createShader).toHaveBeenCalledWith(gl.VERTEX_SHADER);
    expect(gl.shaderSource).toHaveBeenCalled();
    expect(gl.compileShader).toHaveBeenCalled();
    expect(shader).toBeDefined();
  });

  it('throws on compilation failure with info log', () => {
    const gl = createMockGL({
      getShaderParameter: vi.fn(() => false),
      getShaderInfoLog: vi.fn(() => 'syntax error at line 1'),
    });

    expect(() => createShader(gl, gl.VERTEX_SHADER, 'bad source')).toThrow(
      /Failed to compile vertex shader/,
    );
    expect(() => createShader(gl, gl.VERTEX_SHADER, 'bad source')).toThrow(
      /syntax error at line 1/,
    );
    expect(gl.deleteShader).toHaveBeenCalled();
  });

  it('throws on compilation failure for fragment shader', () => {
    const gl = createMockGL({
      getShaderParameter: vi.fn(() => false),
      getShaderInfoLog: vi.fn(() => 'frag error'),
    });

    expect(() => createShader(gl, gl.FRAGMENT_SHADER, 'bad')).toThrow(
      /Failed to compile fragment shader/,
    );
  });

  it('includes numbered shader source on compilation failure', () => {
    const gl = createMockGL({
      getShaderParameter: vi.fn(() => false),
      getShaderInfoLog: vi.fn(() => 'syntax error'),
    });
    const source = 'void main() {\n  gl_Position = vec4(0.0);\n}';

    expect(() => createShader(gl, gl.VERTEX_SHADER, source)).toThrow(
      /Source \(vertex shader\):\n1: void main\(\) \{\n2:   gl_Position = vec4\(0.0\);\n3: \}/,
    );
  });

  it('throws if gl.createShader returns null', () => {
    const gl = createMockGL({ createShader: vi.fn(() => null) });

    expect(() => createShader(gl, gl.VERTEX_SHADER, 'src')).toThrow(
      /Failed to create WebGL shader object/,
    );
  });
});

// ---------------------------------------------------------------------------
// createProgram
// ---------------------------------------------------------------------------

describe('createProgram', () => {
  it('links a program successfully', () => {
    const gl = createMockGL();
    const vs = {} as WebGLShader;
    const fs = {} as WebGLShader;
    const program = createProgram(gl, vs, fs);

    expect(gl.attachShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalled();
    expect(program).toBeDefined();
  });

  it('throws on link failure with info log', () => {
    const gl = createMockGL({
      getProgramParameter: vi.fn(() => false),
      getProgramInfoLog: vi.fn(() => 'link error: missing varying'),
    });

    const vs = {} as WebGLShader;
    const fs = {} as WebGLShader;
    expect(() => createProgram(gl, vs, fs)).toThrow(
      /Failed to link shader program/,
    );
    expect(() => createProgram(gl, vs, fs)).toThrow(
      /link error: missing varying/,
    );
    expect(gl.deleteProgram).toHaveBeenCalled();
  });

  it('throws if gl.createProgram returns null', () => {
    const gl = createMockGL({ createProgram: vi.fn(() => null) });

    expect(() => createProgram(gl, {} as WebGLShader, {} as WebGLShader)).toThrow(
      /Failed to create WebGL program object/,
    );
  });
});

// ---------------------------------------------------------------------------
// ShaderCache
// ---------------------------------------------------------------------------

describe('ShaderCache', () => {
  let gl: WebGL2RenderingContext;
  let cache: ShaderCache;

  beforeEach(() => {
    gl = createMockGL();
    cache = new ShaderCache(gl);
  });

  it('compiles a shader only once for the same source', () => {
    const s1 = cache.getShader(gl.VERTEX_SHADER, 'src A');
    const s2 = cache.getShader(gl.VERTEX_SHADER, 'src A');

    expect(s1).toBe(s2);
    expect(gl.createShader).toHaveBeenCalledTimes(1);
  });

  it('compiles different shaders for different sources', () => {
    let callCount = 0;
    (gl.createShader as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return { __id: callCount++ } as unknown as WebGLShader;
    });

    const s1 = cache.getShader(gl.VERTEX_SHADER, 'src A');
    const s2 = cache.getShader(gl.VERTEX_SHADER, 'src B');

    expect(s1).not.toBe(s2);
    expect(gl.createShader).toHaveBeenCalledTimes(2);
  });

  it('links a program only once for the same source pair', () => {
    const p1 = cache.getProgram('vert', 'frag');
    const p2 = cache.getProgram('vert', 'frag');

    expect(p1).toBe(p2);
    // createProgram called once, createShader called twice (vert+frag)
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
  });

  it('does not collide default keys when shader sources include separator characters', () => {
    cache.getProgram('a', 'b\0c');
    cache.getProgram('a\0b', 'c');
    cache.getProgram('a', 'b\0c');
    cache.getProgram('a\0b', 'c');
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
  });

  it('supports a custom cache key for getShader', () => {
    const s1 = cache.getShader(gl.VERTEX_SHADER, 'source', 'my-key');
    const s2 = cache.getShader(gl.VERTEX_SHADER, 'source', 'my-key');
    expect(s1).toBe(s2);
    expect(gl.createShader).toHaveBeenCalledTimes(1);
  });

  it('uses a hash string, not the raw source, as the default shader cache key', () => {
    let shaderId = 0;
    (gl.createShader as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __shaderId: shaderId++ }) as unknown as WebGLShader,
    );

    // First call without an explicit key caches under a hash-derived key.
    const s1 = cache.getShader(gl.VERTEX_SHADER, 'void main(){}');

    // A second call with the same source returns the cached shader (hash hit).
    const s2 = cache.getShader(gl.VERTEX_SHADER, 'void main(){}');
    expect(s1).toBe(s2);
    expect(gl.createShader).toHaveBeenCalledTimes(1);

    // Passing the raw source string as an explicit key is a different slot:
    // the hash key !== the source string, so a new shader is compiled.
    const s3 = cache.getShader(gl.VERTEX_SHADER, 'void main(){}', 'void main(){}');
    expect(s3).not.toBe(s1);
    expect(gl.createShader).toHaveBeenCalledTimes(2);
  });

  it('supports a custom cache key for getProgram', () => {
    const p1 = cache.getProgram('v', 'f', 'prog-key');
    const p2 = cache.getProgram('v', 'f', 'prog-key');
    expect(p1).toBe(p2);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
  });

  it('dispose deletes all cached resources', () => {
    cache.getProgram('v', 'f');
    cache.dispose();

    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(gl.deleteShader).toHaveBeenCalled();
  });

  it('dispose calls deleteProgram and deleteShader exactly once per cached resource', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );
    let shaderId = 0;
    (gl.createShader as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __shaderId: shaderId++ }) as unknown as WebGLShader,
    );

    const p1 = cache.getProgram('vert-a', 'frag-a', 'prog-a');
    const p2 = cache.getProgram('vert-b', 'frag-b', 'prog-b');
    cache.dispose();

    // Two programs → two deleteProgram calls, each with the correct object
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledWith(p1);
    expect(gl.deleteProgram).toHaveBeenCalledWith(p2);
    // Four distinct shaders → four deleteShader calls, each with the correct object
    const createdShaders = (gl.createShader as ReturnType<typeof vi.fn>).mock.results.map(
      (result) => result.value as WebGLShader,
    );
    expect(gl.deleteShader).toHaveBeenCalledTimes(createdShaders.length);
    for (const shader of createdShaders) {
      expect(gl.deleteShader).toHaveBeenCalledWith(shader);
    }
  });

  it('dispose clears the internal cache so a subsequent getProgram recompiles', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    const before = cache.getProgram('v', 'f', 'key');
    cache.dispose();

    // After dispose the cache must be empty; a new program must be compiled.
    const after = cache.getProgram('v', 'f', 'key');
    expect(after).not.toBe(before);
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
  });

  it('dispose is safe on an empty cache and does not call any delete methods', () => {
    cache.dispose();
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });

  it('dispose is idempotent: a second call after the cache is already empty is a no-op', () => {
    let shaderId = 0;
    (gl.createShader as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __shaderId: shaderId++ }) as unknown as WebGLShader,
    );
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    cache.getProgram('v', 'f', 'key');
    cache.dispose();

    // Capture what was deleted in the first dispose.
    const createdShaders = (gl.createShader as ReturnType<typeof vi.fn>).mock.results.map(
      (result) => result.value as WebGLShader,
    );
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(createdShaders.length);
    for (const shader of createdShaders) {
      expect(gl.deleteShader).toHaveBeenCalledWith(shader);
    }

    // Second dispose on an already-empty cache must not call any delete methods again.
    cache.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(createdShaders.length);
  });

  it('removeProgram deletes only the targeted program resources', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );
    let shaderId = 0;
    (gl.createShader as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __shaderId: shaderId++ }) as unknown as WebGLShader,
    );

    const programA = cache.getProgram('vert-a', 'frag-a', 'prog-a');
    const programB = cache.getProgram('vert-b', 'frag-b', 'prog-b');

    cache.removeProgram('prog-b');

    expect(gl.deleteProgram).toHaveBeenCalledWith(programB);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);

    expect(cache.getProgram('vert-a', 'frag-a', 'prog-a')).toBe(programA);
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    expect(cache.getProgram('vert-b', 'frag-b', 'prog-b')).not.toBe(programB);
    expect(gl.createProgram).toHaveBeenCalledTimes(3);
  });

  it('removeProgram is a no-op for missing keys', () => {
    cache.removeProgram('does-not-exist');
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // getProgramKey
  // -------------------------------------------------------------------------

  it('getProgramKey returns the explicit key unchanged', () => {
    cache.getProgram('v', 'f', 'my-key');
    expect(cache.getProgramKey('v', 'f', 'my-key')).toBe('my-key');
  });

  it('getProgramKey returns the same hash key used by getProgram for auto-keyed programs', () => {
    cache.getProgram('vert', 'frag');
    const key = cache.getProgramKey('vert', 'frag');
    // The key must be stable and point to the already-cached program.
    cache.retainProgram(key);
    cache.releaseProgram(key);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it('getProgramKey works before getProgram is called (consistent key)', () => {
    const keyBefore = cache.getProgramKey('vert', 'frag');
    cache.getProgram('vert', 'frag');
    const keyAfter = cache.getProgramKey('vert', 'frag');
    expect(keyBefore).toBe(keyAfter);
  });

  it('getProgramKey returns the collision-free key after a hash collision', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    vi.spyOn(ShaderCache as unknown as { hashSources: (v: string, f: string) => string }, 'hashSources').mockReturnValue(
      'collision-key',
    );

    cache.getProgram('vert-a', 'frag-a'); // stored under 'collision-key'
    // Second pair collides; must be stored under the composite collision key.
    cache.getProgram('vert-b', 'frag-b');

    // getProgramKey must return the composite collision key for the second pair.
    const keyB = cache.getProgramKey('vert-b', 'frag-b');
    cache.retainProgram(keyB);
    cache.releaseProgram(keyB);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    // The first program must still be alive.
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    expect(cache.getProgram('vert-a', 'frag-a')).toBeDefined();
    expect(gl.createProgram).toHaveBeenCalledTimes(2); // still cached

    vi.restoreAllMocks();
  });

  it('collision-resolved entry survives after the hash-keyed program is removed', () => {
    // Regression test: removing the original hash-keyed program must not orphan
    // the collision-resolved program (stored under the composite collision key).  Both
    // getProgramKey and getProgram must continue to point at the surviving entry.
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    vi.spyOn(ShaderCache as unknown as { hashSources: (v: string, f: string) => string }, 'hashSources').mockReturnValue(
      'collision-key',
    );

    cache.getProgram('vert-a', 'frag-a'); // stored under 'collision-key'
    const p2 = cache.getProgram('vert-b', 'frag-b'); // collision → stored under composite collision key

    // Remove the hash-keyed program so the hash slot is now vacant.
    cache.removeProgram('collision-key');
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);

    // getProgramKey must still return the composite collision key for the second pair.
    const keyB = cache.getProgramKey('vert-b', 'frag-b');
    expect(typeof keyB).toBe('string');
    // The key must reference the surviving entry — getProgram must not recompile.
    const retrieved = cache.getProgram('vert-b', 'frag-b');
    expect(retrieved).toBe(p2);
    expect(gl.createProgram).toHaveBeenCalledTimes(2); // no extra compilation

    // retain / release must still work correctly via the surviving key.
    cache.retainProgram(keyB);
    cache.releaseProgram(keyB);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2); // now also p2 is deleted

    vi.restoreAllMocks();
  });



  it('retainProgram is a no-op for an unknown key', () => {
    cache.retainProgram('does-not-exist');
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it('releaseProgram is a no-op for an unretained key', () => {
    cache.getProgram('v', 'f', 'prog');
    cache.releaseProgram('prog');
    // No retain was called, so nothing should be deleted.
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it('releaseProgram is a no-op after removeProgram has already cleared the entry', () => {
    cache.getProgram('v', 'f', 'prog');
    cache.retainProgram('prog');
    cache.removeProgram('prog'); // explicit removal clears ref count too
    cache.releaseProgram('prog'); // must be a no-op; program already gone
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1); // only from removeProgram
  });

  it('releaseProgram deletes the program when the last retain is released', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    const program = cache.getProgram('v', 'f', 'prog');
    cache.retainProgram('prog');
    cache.releaseProgram('prog');

    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    // Shaders used only by this program must be freed too.
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    // Program is gone from the cache; next getProgram must recompile.
    const recompiled = cache.getProgram('v', 'f', 'prog');
    expect(recompiled).not.toBe(program);
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
  });

  it('releaseProgram keeps the program alive while additional retains are held', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    const program = cache.getProgram('v', 'f', 'prog');
    cache.retainProgram('prog');
    cache.retainProgram('prog');

    cache.releaseProgram('prog'); // count goes from 2 → 1; program stays alive
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(cache.getProgram('v', 'f', 'prog')).toBe(program);

    cache.releaseProgram('prog'); // count goes from 1 → 0; program deleted
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
  });

  it('two programs sharing a shader: releaseProgram does not delete shared shader', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );
    let shaderId = 0;
    (gl.createShader as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __shaderId: shaderId++ }) as unknown as WebGLShader,
    );

    // prog-a and prog-b share the same vertex shader source.
    const programA = cache.getProgram('shared-vert', 'frag-a', 'prog-a');
    const programB = cache.getProgram('shared-vert', 'frag-b', 'prog-b');
    cache.retainProgram('prog-a');
    cache.retainProgram('prog-b');

    cache.releaseProgram('prog-a');
    expect(gl.deleteProgram).toHaveBeenCalledWith(programA);
    // The shared vertex shader is still referenced by prog-b; must NOT be deleted.
    const allDeleteShaderArgs = (gl.deleteShader as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    const shaders = (gl.createShader as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as WebGLShader,
    );
    // shaders[0] = shared-vert, shaders[1] = frag-a, shaders[2] = frag-b
    expect(allDeleteShaderArgs).toContain(shaders[1]); // frag-a deleted
    expect(allDeleteShaderArgs).not.toContain(shaders[0]); // shared-vert still alive

    cache.releaseProgram('prog-b');
    expect(gl.deleteProgram).toHaveBeenCalledWith(programB);
    const allDeleteShaderArgs2 = (gl.deleteShader as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(allDeleteShaderArgs2).toContain(shaders[0]); // shared-vert now freed
    expect(allDeleteShaderArgs2).toContain(shaders[2]); // frag-b freed
  });

  it('does not cache vertex or fragment shader when vertex compilation fails', () => {
    // Vertex shader compilation always fails; fragment never reached.
    gl = createMockGL({
      getShaderParameter: vi.fn(() => false),
      getShaderInfoLog: vi.fn(() => 'vert error'),
    });
    cache = new ShaderCache(gl);

    expect(() => cache.getProgram('bad-vert', 'frag')).toThrow(/Failed to compile vertex shader/);

    // The bad vertex shader object should have been deleted by createShader.
    expect(gl.deleteShader).toHaveBeenCalled();
    // Neither shader should remain in the cache.
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it('evicts newly-cached vertex shader when fragment compilation fails', () => {
    let shaderCallCount = 0;
    // Odd-numbered calls (vertex shaders) succeed; even-numbered calls (fragment shaders) fail.
    gl = createMockGL({
      getShaderParameter: vi.fn(() => {
        shaderCallCount++;
        return shaderCallCount % 2 === 1;
      }),
      getShaderInfoLog: vi.fn(() => 'frag error'),
    });
    cache = new ShaderCache(gl);

    expect(() => cache.getProgram('vert', 'bad-frag')).toThrow(/Failed to compile fragment shader/);

    // One deletion by createShader (bad frag) + one by ShaderCache cleanup (newly-cached vert).
    expect((gl.deleteShader as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    // No program should have been created.
    expect(gl.createProgram).not.toHaveBeenCalled();

    // Calling getProgram again for the same vertex shader must recompile it (cache was cleared).
    expect(() => cache.getProgram('vert', 'bad-frag')).toThrow();
    expect(gl.createShader).toHaveBeenCalledTimes(4); // 2 attempts × (1 vert + 1 frag)
  });

  it('does not evict pre-existing vertex shader when fragment compilation fails', () => {
    let shaderParamCallCount = 0;
    gl = createMockGL({
      // First call (pre-populate vertex) succeeds; subsequent calls (fragment in getProgram) fail.
      getShaderParameter: vi.fn(() => {
        shaderParamCallCount++;
        return shaderParamCallCount === 1;
      }),
      getShaderInfoLog: vi.fn(() => 'frag error'),
    });
    cache = new ShaderCache(gl);

    // Pre-populate the vertex shader cache.
    const preExistingVs = cache.getShader(gl.VERTEX_SHADER, 'vert');

    const deleteShaderBefore = (gl.deleteShader as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(() => cache.getProgram('vert', 'bad-frag')).toThrow(/Failed to compile fragment shader/);

    const deleteShaderAfter = (gl.deleteShader as ReturnType<typeof vi.fn>).mock.calls.length;
    // Only the bad fragment shader should have been deleted (by createShader), not the pre-existing vertex.
    expect(deleteShaderAfter - deleteShaderBefore).toBe(1);
    // The pre-existing vertex shader should still be in the cache (reused without recompile).
    expect(cache.getShader(gl.VERTEX_SHADER, 'vert')).toBe(preExistingVs);
    expect(gl.createShader).toHaveBeenCalledTimes(2); // 1 initial getShader + 1 failed frag attempt
  });

  it('evicts both newly-cached shaders when program linking fails', () => {
    gl = createMockGL({
      getProgramParameter: vi.fn(() => false),
      getProgramInfoLog: vi.fn(() => 'link error'),
    });
    cache = new ShaderCache(gl);

    expect(() => cache.getProgram('vert', 'frag')).toThrow(/Failed to link shader program/);

    // createProgram already deletes the program; ShaderCache must additionally evict both shaders.
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect((gl.deleteShader as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    // Both shaders must be re-created on the next attempt (cache was cleared).
    expect(() => cache.getProgram('vert', 'frag')).toThrow(/Failed to link shader program/);
    expect(gl.createShader).toHaveBeenCalledTimes(4); // 2 attempts × 2 shaders
  });

  it('returns distinct programs when two source pairs produce the same FNV-1a hash (collision)', () => {
    let programId = 0;
    (gl.createProgram as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ __programId: programId++ }) as unknown as WebGLProgram,
    );

    // Simulate a hash collision by forcing hashSources to always return the same key.
    vi.spyOn(ShaderCache as unknown as { hashSources: (v: string, f: string) => string }, 'hashSources').mockReturnValue(
      'collision-key',
    );

    const p1 = cache.getProgram('vert-a', 'frag-a');
    const p2 = cache.getProgram('vert-b', 'frag-b'); // same hash, different sources

    // Same sources must return the already-cached program.
    const p3 = cache.getProgram('vert-a', 'frag-a');
    const p4 = cache.getProgram('vert-b', 'frag-b');

    expect(p1).not.toBe(p2);
    expect(p1).toBe(p3);
    expect(p2).toBe(p4);
    expect(gl.createProgram).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Explicit key length validation
  // -------------------------------------------------------------------------

  describe('explicit key length validation', () => {
    const overKey = 'x'.repeat(ShaderCache.MAX_KEY_LENGTH + 1);
    const exactKey = 'x'.repeat(ShaderCache.MAX_KEY_LENGTH);

    it('getProgram throws RangeError when explicit key exceeds MAX_KEY_LENGTH', () => {
      expect(() => cache.getProgram('v', 'f', overKey)).toThrow(RangeError);
      expect(() => cache.getProgram('v', 'f', overKey)).toThrow(
        /ShaderCache: explicit key exceeds maximum length of \d+ characters\./,
      );
    });

    it('getProgram accepts an explicit key of exactly MAX_KEY_LENGTH characters', () => {
      expect(() => cache.getProgram('v', 'f', exactKey)).not.toThrow();
    });

    it('getShader throws RangeError when explicit key exceeds MAX_KEY_LENGTH', () => {
      expect(() => cache.getShader(gl.VERTEX_SHADER, 'void main(){}', overKey)).toThrow(RangeError);
      expect(() => cache.getShader(gl.VERTEX_SHADER, 'void main(){}', overKey)).toThrow(
        /ShaderCache: explicit key exceeds maximum length of \d+ characters\./,
      );
    });

    it('getShader accepts an explicit key of exactly MAX_KEY_LENGTH characters', () => {
      expect(() => cache.getShader(gl.VERTEX_SHADER, 'void main(){}', exactKey)).not.toThrow();
    });

    it('getProgramKey throws RangeError when explicit key exceeds MAX_KEY_LENGTH', () => {
      expect(() => cache.getProgramKey('v', 'f', overKey)).toThrow(RangeError);
      expect(() => cache.getProgramKey('v', 'f', overKey)).toThrow(
        /ShaderCache: explicit key exceeds maximum length of \d+ characters\./,
      );
    });

    it('getProgramKey accepts an explicit key of exactly MAX_KEY_LENGTH characters', () => {
      expect(() => cache.getProgramKey('v', 'f', exactKey)).not.toThrow();
    });

    it('getProgram without an explicit key is unaffected by long shader sources', () => {
      const longSource = 'x'.repeat(10_000);
      // auto-keyed path hashes the source — must not throw regardless of source length
      expect(() => cache.getProgram(longSource, longSource)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // FNV-1a hash correctness
  // -------------------------------------------------------------------------

  describe('FNV-1a hash (fnv1aSources)', () => {
    // Access private static methods via type cast for white-box testing.
    const hashSources = (v: string, f: string): string =>
      (ShaderCache as unknown as { hashSources: (v: string, f: string) => string }).hashSources(v, f);
    const hashSources2 = (v: string, f: string): string =>
      (ShaderCache as unknown as { hashSources2: (v: string, f: string) => string }).hashSources2(v, f);

    it('returns a valid lowercase hex string prefixed with fnv1a-', () => {
      const key = hashSources('vert', 'frag');
      expect(key).toMatch(/^fnv1a-[0-9a-f]+$/);
    });

    it('returns a valid lowercase hex string prefixed with fnv1a2- for secondary hash', () => {
      const key = hashSources2('vert', 'frag');
      expect(key).toMatch(/^fnv1a2-[0-9a-f]+$/);
    });

    it('is deterministic — same inputs always produce the same key', () => {
      expect(hashSources('hello', 'world')).toBe(hashSources('hello', 'world'));
      expect(hashSources2('hello', 'world')).toBe(hashSources2('hello', 'world'));
    });

    it('primary and secondary hashes differ for the same inputs (independent seeds)', () => {
      const primary = hashSources('hello', 'world');
      const secondary = hashSources2('hello', 'world');
      expect(primary).not.toBe(secondary);
    });

    it('produces different keys for different source pairs', () => {
      expect(hashSources('a', 'b')).not.toBe(hashSources('c', 'd'));
    });

    it('treats "ab"+"c" differently from "a"+"bc" (length-separator prevents aliasing)', () => {
      expect(hashSources('ab', 'c')).not.toBe(hashSources('a', 'bc'));
    });

    it('handles source strings containing charCodes > 0x7F without producing NaN or undefined', () => {
      // 'é' = 0xe9, '你' = 0x4f60 — both exceed the ASCII range.
      const key1 = hashSources('caf\u00e9', 'frag');
      const key2 = hashSources2('caf\u00e9', '\u4f60\u597d');
      expect(key1).toMatch(/^fnv1a-[0-9a-f]+$/);
      expect(key2).toMatch(/^fnv1a2-[0-9a-f]+$/);
    });

    it('high-charCode inputs are deterministic', () => {
      const a = hashSources('caf\u00e9', '\u4f60\u597d');
      const b = hashSources('caf\u00e9', '\u4f60\u597d');
      expect(a).toBe(b);
    });

    it('spot-check: hashSources("hello","world") matches reference FNV-1a value', () => {
      // Reference value independently verified using the same algorithm inline:
      //   seed = 0x811c9dc5 (FNV1A_OFFSET_BASIS); prime = 0x01000193
      //   Each step: hash = ((hash ^ charCode) >>> 0); hash = (Math.imul(hash, prime) >>> 0)
      //   Length bytes (big-endian) of "hello" (5) are mixed in between the two strings.
      //   Final result (no trailing >>> 0 needed — hash is already uint32): '832f0b0'
      expect(hashSources('hello', 'world')).toBe('fnv1a-832f0b0');
    });

    it('spot-check: hashSources2("hello","world") matches reference FNV-1a value', () => {
      // Reference value independently verified using the same algorithm inline:
      //   seed = 0x84222325 (FNV1A_OFFSET_BASIS_2); prime = 0x01000193
      //   Same per-step >>> 0 masking as hashSources, different starting seed.
      //   Final result: '794f9810'
      expect(hashSources2('hello', 'world')).toBe('fnv1a2-794f9810');
    });
  });
});

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

describe('Material', () => {
  let gl: WebGL2RenderingContext;

  beforeEach(() => {
    gl = createMockGL();
  });

  it('creates a material with default shaders', () => {
    const mat = new Material(gl);
    expect(mat.program).toBeDefined();
    expect(gl.createShader).toHaveBeenCalledTimes(2);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
  });

  it('creates a material with custom shader sources', () => {
    const mat = new Material(gl, 'custom vert', 'custom frag');
    expect(mat.program).toBeDefined();
  });

  it('use() activates the program', () => {
    const mat = new Material(gl);
    mat.use();
    expect(gl.useProgram).toHaveBeenCalledWith(mat.program);
  });

  it('setFloat sets a float uniform', () => {
    const mat = new Material(gl);
    mat.setFloat('u_time', 1.5);
    expect(gl.uniform1f).toHaveBeenCalled();
  });

  it('setInt sets an int uniform', () => {
    const mat = new Material(gl);
    mat.setInt('u_sampler', 0);
    expect(gl.uniform1i).toHaveBeenCalled();
  });

  it('setVec2 sets a vec2 uniform', () => {
    const mat = new Material(gl);
    mat.setVec2('u_res', 800, 600);
    expect(gl.uniform2f).toHaveBeenCalled();
  });

  it('setVec3 sets a vec3 uniform', () => {
    const mat = new Material(gl);
    mat.setVec3('u_pos', 1, 2, 3);
    expect(gl.uniform3f).toHaveBeenCalled();
  });

  it('setVec4 sets a vec4 uniform', () => {
    const mat = new Material(gl);
    mat.setVec4('u_color', 1, 0, 0, 1);
    expect(gl.uniform4f).toHaveBeenCalled();
  });

  it('setMat4 sets a mat4 uniform', () => {
    const mat = new Material(gl);
    mat.setMat4('u_model', new Float32Array(16));
    expect(gl.uniformMatrix4fv).toHaveBeenCalled();
  });

  it('caches uniform locations', () => {
    const mat = new Material(gl);
    mat.setFloat('u_time', 1.0);
    mat.setFloat('u_time', 2.0);

    // getUniformLocation should be called only once for the same name
    const calls = (gl.getUniformLocation as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[1] === 'u_time');
    expect(calls.length).toBe(1);
  });

  it('caches null uniform locations', () => {
    gl = createMockGL({ getUniformLocation: vi.fn(() => null) });
    const mat = new Material(gl);
    mat.setVec4('u_color', 1, 0, 0, 1);
    mat.setVec4('u_color', 0, 1, 0, 1);

    const calls = (gl.getUniformLocation as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[1] === 'u_color');
    expect(calls.length).toBe(1);
  });

  it('deletes intermediate shaders immediately after linking to prevent GPU memory leaks', () => {
    const vertexShader = { __type: 'vertex-shader' } as unknown as WebGLShader;
    const fragmentShader = { __type: 'fragment-shader' } as unknown as WebGLShader;
    let createShaderCalls = 0;
    gl = createMockGL({
      createShader: vi.fn(() => createShaderCalls++ === 0 ? vertexShader : fragmentShader),
    });

    const mat = new Material(gl);
    expect(mat.program).toBeDefined();
    // Both the vertex and fragment shader objects must be deleted right after
    // the program is linked so they are freed when the program is later deleted.
    expect(gl.deleteShader).toHaveBeenCalledWith(vertexShader);
    expect(gl.deleteShader).toHaveBeenCalledWith(fragmentShader);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('dispose deletes the program', () => {
    const mat = new Material(gl);
    mat.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledWith(mat.program);
  });

  it('deletes vertex shader when fragment shader compilation fails', () => {
    const vertexShader = { __type: 'vertex-shader' } as unknown as WebGLShader;
    const fragmentShader = { __type: 'fragment-shader' } as unknown as WebGLShader;
    let createShaderCalls = 0;
    let getShaderParamCalls = 0;
    gl = createMockGL({
      createShader: vi.fn(() => createShaderCalls++ === 0 ? vertexShader : fragmentShader),
      // vertex compilation succeeds; fragment compilation fails
      getShaderParameter: vi.fn(() => getShaderParamCalls++ === 0),
      getShaderInfoLog: vi.fn(() => 'frag error'),
    });

    expect(() => new Material(gl, 'vert', 'bad-frag')).toThrow(/Failed to compile fragment shader/);
    // createShader deletes the bad fragment shader; Material must delete the vertex shader
    expect(gl.deleteShader).toHaveBeenCalledWith(vertexShader);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('deletes both shaders when program linking fails', () => {
    const vertexShader = { __type: 'vertex-shader' } as unknown as WebGLShader;
    const fragmentShader = { __type: 'fragment-shader' } as unknown as WebGLShader;
    let createShaderCalls = 0;
    gl = createMockGL({
      createShader: vi.fn(() => createShaderCalls++ === 0 ? vertexShader : fragmentShader),
      getProgramParameter: vi.fn(() => false),
      getProgramInfoLog: vi.fn(() => 'link error'),
    });

    expect(() => new Material(gl, 'vert', 'frag')).toThrow(/Failed to link shader program/);
    // createProgram deletes the failed program; Material must delete both shaders
    expect(gl.deleteShader).toHaveBeenCalledWith(vertexShader);
    expect(gl.deleteShader).toHaveBeenCalledWith(fragmentShader);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('restore rebuilds program and clears uniform cache', () => {
    const mat = new Material(gl);
    mat.setFloat('u_time', 1.0);
    mat.restore();
    mat.setFloat('u_time', 2.0);

    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    const calls = (gl.getUniformLocation as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[1] === 'u_time');
    expect(calls.length).toBe(2);
  });

  it('restore can be called multiple times with a new context', () => {
    const mat = new Material(gl);
    let nextProgramId = 0;
    const restoredGl = createMockGL({
      createProgram: vi.fn(
        () => ({ __restoredProgramId: nextProgramId++ }) as unknown as WebGLProgram,
      ),
    });

    mat.restore(restoredGl);
    const firstRestoredProgram = mat.program;
    mat.restore(restoredGl);

    expect(restoredGl.createProgram).toHaveBeenCalledTimes(2);
    expect(mat.program).not.toBe(firstRestoredProgram);
    mat.use();
    expect(restoredGl.useProgram).toHaveBeenCalledWith(mat.program);
  });

  it('restore keeps previous context and nulls program when restore fails', () => {
    const mat = new Material(gl);
    const failingGl = createMockGL({
      getProgramParameter: vi.fn(() => false),
      getProgramInfoLog: vi.fn(() => 'link failed'),
    });

    expect(() => mat.restore(failingGl)).toThrow(/Failed to link shader program/);

    expect(mat.program).toBeNull();
    mat.use(); // must be a no-op
    expect(gl.useProgram).not.toHaveBeenCalled();
    expect(failingGl.useProgram).not.toHaveBeenCalled();
  });

  it('restore nulls program when same-context restore fails', () => {
    const failingGl = createMockGL({
      getProgramParameter: vi.fn(() => false),
      getProgramInfoLog: vi.fn(() => 'link failed'),
    });
    // First call succeeds (initial construction) - subsequent calls fail
    let callCount = 0;
    (failingGl.getProgramParameter as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return callCount++ === 0;
    });

    const mat = new Material(failingGl);
    expect(mat.program).toBeDefined();

    expect(() => mat.restore()).toThrow(/Failed to link shader program/);

    expect(mat.program).toBeNull();
    mat.use(); // must be a no-op
    expect(failingGl.useProgram).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Default shader sources
// ---------------------------------------------------------------------------

describe('Default shader sources', () => {
  it('DEFAULT_VERTEX_SOURCE is a non-empty string', () => {
    expect(typeof DEFAULT_VERTEX_SOURCE).toBe('string');
    expect(DEFAULT_VERTEX_SOURCE.length).toBeGreaterThan(0);
    expect(DEFAULT_VERTEX_SOURCE).toContain('#version 300 es');
  });

  it('DEFAULT_VERTEX_SOURCE JSDoc documents a_normal at location 1', () => {
    const normalIdx = materialSource.indexOf('`a_normal`');
    expect(normalIdx).toBeGreaterThan(-1);
    const loc1Idx = materialSource.indexOf('location 1', normalIdx);
    expect(loc1Idx).toBeGreaterThan(normalIdx);
  });

  it('DEFAULT_VERTEX_SOURCE JSDoc documents a_uv at location 2', () => {
    const uvIdx = materialSource.indexOf('`a_uv`');
    expect(uvIdx).toBeGreaterThan(-1);
    const loc2Idx = materialSource.indexOf('location 2', uvIdx);
    expect(loc2Idx).toBeGreaterThan(uvIdx);
  });

  it('DEFAULT_VERTEX_SOURCE JSDoc marks a_normal and a_uv as optional', () => {
    const normalIdx = materialSource.indexOf('`a_normal`');
    const uvIdx = materialSource.indexOf('`a_uv`');
    expect(materialSource.indexOf('optional', normalIdx)).toBeGreaterThan(normalIdx);
    expect(materialSource.indexOf('optional', uvIdx)).toBeGreaterThan(uvIdx);
  });

  it('DEFAULT_FRAGMENT_SOURCE is a non-empty string', () => {
    expect(typeof DEFAULT_FRAGMENT_SOURCE).toBe('string');
    expect(DEFAULT_FRAGMENT_SOURCE.length).toBeGreaterThan(0);
    expect(DEFAULT_FRAGMENT_SOURCE).toContain('#version 300 es');
  });
});

// ---------------------------------------------------------------------------
// ShaderCache JSDoc
// ---------------------------------------------------------------------------

describe('ShaderCache JSDoc', () => {
  it('getProgramKey has a @remarks block documenting key-stability expectations', () => {
    const remarksIdx = shaderCacheSource.indexOf('@remarks', shaderCacheSource.indexOf('getProgramKey'));
    expect(remarksIdx).toBeGreaterThan(-1);
  });

  it('getProgramKey @remarks mentions calling getProgramKey before getProgram', () => {
    const getProgramKeyIdx = shaderCacheSource.indexOf('getProgramKey');
    const remarksIdx = shaderCacheSource.indexOf('@remarks', getProgramKeyIdx);
    const commentEndIdx = shaderCacheSource.indexOf('*/', remarksIdx);
    expect(commentEndIdx).toBeGreaterThan(remarksIdx);
    const nextParamIdx = shaderCacheSource.indexOf('@param', remarksIdx);
    // Only use nextParamIdx when it falls within the current comment block
    const endIdx = (nextParamIdx !== -1 && nextParamIdx < commentEndIdx) ? nextParamIdx : commentEndIdx;
    const remarksBody = shaderCacheSource.slice(remarksIdx, endIdx);
    expect(remarksBody).toContain('before');
    expect(remarksBody).toMatch(/\bgetProgram\b/);
  });

  it('getProgramKey @remarks mentions eviction as the cause of key instability', () => {
    const getProgramKeyIdx = shaderCacheSource.indexOf('getProgramKey');
    const remarksIdx = shaderCacheSource.indexOf('@remarks', getProgramKeyIdx);
    const commentEndIdx = shaderCacheSource.indexOf('*/', remarksIdx);
    expect(commentEndIdx).toBeGreaterThan(remarksIdx);
    const nextParamIdx = shaderCacheSource.indexOf('@param', remarksIdx);
    // Only use nextParamIdx when it falls within the current comment block
    const endIdx = (nextParamIdx !== -1 && nextParamIdx < commentEndIdx) ? nextParamIdx : commentEndIdx;
    const remarksBody = shaderCacheSource.slice(remarksIdx, endIdx);
    expect(remarksBody).toContain('evicted');
  });

  it('getProgramKey JSDoc code example is preserved', () => {
    const exampleIdx = shaderCacheSource.indexOf('cache.getProgramKey(vertSrc, fragSrc)');
    expect(exampleIdx).toBeGreaterThan(-1);
    expect(shaderCacheSource.indexOf('cache.retainProgram(key)', exampleIdx)).toBeGreaterThan(exampleIdx);
    expect(shaderCacheSource.indexOf('cache.releaseProgram(key)', exampleIdx)).toBeGreaterThan(exampleIdx);
  });
});
