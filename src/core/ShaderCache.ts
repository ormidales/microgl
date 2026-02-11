/**
 * Caches compiled shaders and linked programs so the same source is never
 * compiled or linked twice for the same WebGL context.
 */

import { createShader, createProgram } from './ShaderUtils';

export class ShaderCache {
  /** key → compiled WebGLShader */
  private readonly shaders: Map<string, WebGLShader> = new Map();

  /** key → linked WebGLProgram */
  private readonly programs: Map<string, WebGLProgram> = new Map();

  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return a compiled shader for the given source, compiling it only once.
   *
   * @param type `gl.VERTEX_SHADER` or `gl.FRAGMENT_SHADER`
   * @param source GLSL source code
   * @param key Optional cache key. Defaults to the source string itself.
   */
  getShader(type: number, source: string, key?: string): WebGLShader {
    const cacheKey = key ?? source;
    const existing = this.shaders.get(cacheKey);
    if (existing) return existing;

    const shader = createShader(this.gl, type, source);
    this.shaders.set(cacheKey, shader);
    return shader;
  }

  /**
   * Return a linked program for the given vertex/fragment source pair,
   * linking only once per unique combination.
   *
   * @param vertexSource GLSL vertex shader source
   * @param fragmentSource GLSL fragment shader source
   * @param key Optional cache key. Defaults to a hash of both sources.
   */
  getProgram(vertexSource: string, fragmentSource: string, key?: string): WebGLProgram {
    const cacheKey = key ?? `${vertexSource}\0${fragmentSource}`;
    const existing = this.programs.get(cacheKey);
    if (existing) return existing;

    const vs = this.getShader(this.gl.VERTEX_SHADER, vertexSource);
    const fs = this.getShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = createProgram(this.gl, vs, fs);
    this.programs.set(cacheKey, program);
    return program;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Delete all cached shaders and programs from the GPU. */
  dispose(): void {
    for (const program of this.programs.values()) {
      this.gl.deleteProgram(program);
    }
    for (const shader of this.shaders.values()) {
      this.gl.deleteShader(shader);
    }
    this.programs.clear();
    this.shaders.clear();
  }
}
