/**
 * Caches compiled shaders and linked programs so the same source is never
 * compiled or linked twice for the same WebGL context.
 */

import { createShader, createProgram } from './ShaderUtils';

export class ShaderCache {
  private static fnv1a(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
  }

  /** key → compiled WebGLShader */
  private readonly shaders: Map<string, WebGLShader> = new Map();

  /** key → linked WebGLProgram */
  private readonly programs: Map<string, WebGLProgram> = new Map();
  /** program key → shader cache keys used by this program */
  private readonly programShaders: Map<string, [string, string]> = new Map();
  /** shader key → number of programs currently referencing it */
  private readonly shaderRefCounts: Map<string, number> = new Map();

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
    const cacheKey =
      key ??
      ShaderCache.fnv1a(
        `${vertexSource.length}:${vertexSource}\0${fragmentSource.length}:${fragmentSource}`,
      );
    const existing = this.programs.get(cacheKey);
    if (existing) return existing;

    const vertexShaderKey = vertexSource;
    const fragmentShaderKey = fragmentSource;
    const vs = this.getShader(this.gl.VERTEX_SHADER, vertexSource, vertexShaderKey);
    const fs = this.getShader(this.gl.FRAGMENT_SHADER, fragmentSource, fragmentShaderKey);
    const program = createProgram(this.gl, vs, fs);
    this.programs.set(cacheKey, program);
    this.programShaders.set(cacheKey, [vertexShaderKey, fragmentShaderKey]);
    this.shaderRefCounts.set(vertexShaderKey, (this.shaderRefCounts.get(vertexShaderKey) ?? 0) + 1);
    this.shaderRefCounts.set(fragmentShaderKey, (this.shaderRefCounts.get(fragmentShaderKey) ?? 0) + 1);
    return program;
  }

  /**
   * Delete one cached program and any orphaned shaders that were only used by it.
   *
   * @param key Program cache key
   */
  removeProgram(key: string): void {
    const program = this.programs.get(key);
    if (!program) return;

    this.gl.deleteProgram(program);
    this.programs.delete(key);

    const shaderKeys = this.programShaders.get(key);
    if (!shaderKeys) return;
    this.programShaders.delete(key);

    for (const shaderKey of shaderKeys) {
      const refCount = (this.shaderRefCounts.get(shaderKey) ?? 0) - 1;
      if (refCount > 0) {
        this.shaderRefCounts.set(shaderKey, refCount);
        continue;
      }
      this.shaderRefCounts.delete(shaderKey);
      const shader = this.shaders.get(shaderKey);
      if (!shader) continue;
      this.gl.deleteShader(shader);
      this.shaders.delete(shaderKey);
    }
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
    this.programShaders.clear();
    this.shaderRefCounts.clear();
    this.shaders.clear();
  }
}
