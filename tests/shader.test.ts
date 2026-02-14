import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShader, createProgram } from '../src/core/ShaderUtils';
import { ShaderCache } from '../src/core/ShaderCache';
import {
  Material,
  DEFAULT_VERTEX_SOURCE,
  DEFAULT_FRAGMENT_SOURCE,
} from '../src/core/Material';

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

  it('supports a custom cache key for getShader', () => {
    const s1 = cache.getShader(gl.VERTEX_SHADER, 'source', 'my-key');
    const s2 = cache.getShader(gl.VERTEX_SHADER, 'source', 'my-key');
    expect(s1).toBe(s2);
    expect(gl.createShader).toHaveBeenCalledTimes(1);
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

  it('dispose deletes the program', () => {
    const mat = new Material(gl);
    mat.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledWith(mat.program);
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

  it('DEFAULT_FRAGMENT_SOURCE is a non-empty string', () => {
    expect(typeof DEFAULT_FRAGMENT_SOURCE).toBe('string');
    expect(DEFAULT_FRAGMENT_SOURCE.length).toBeGreaterThan(0);
    expect(DEFAULT_FRAGMENT_SOURCE).toContain('#version 300 es');
  });
});
