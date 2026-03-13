/**
 * Caches compiled shaders and linked programs so the same source is never
 * compiled or linked twice for the same WebGL context.
 */

import { createShader, createProgram } from './ShaderUtils';

export class ShaderCache {
  private static readonly FNV1A_OFFSET_BASIS = 0x811c9dc5;
  // Second independent seed for the verification hash.  Chosen as the next
  // published 32-bit FNV offset basis candidate so the two hashes are
  // statistically independent, giving ~64-bit effective collision resistance.
  private static readonly FNV1A_OFFSET_BASIS_2 = 0x84222325;
  private static readonly FNV1A_PRIME = 0x01000193;

  /**
   * Core FNV-1a hash accumulator over a vertex/fragment source pair.
   * Encodes a 4-byte boundary marker (vertex source length) between the two
   * strings so 'ab'+'c' and 'a'+'bc' always produce different hashes.
   *
   * @param vertSrc     GLSL vertex shader source string.
   * @param fragSrc     GLSL fragment shader source string.
   * @param offsetBasis FNV-1a 32-bit offset basis seed. Use distinct seeds for
   *                    primary and secondary hashes to achieve ~64-bit collision resistance.
   * @returns Hex string of the unsigned 32-bit FNV-1a hash.
   */
  private static fnv1aSources(vertSrc: string, fragSrc: string, offsetBasis: number): string {
    let hash = offsetBasis >>> 0;
    const vLen = vertSrc.length;
    for (let i = 0; i < vLen; i++) {
      hash = ((hash ^ vertSrc.charCodeAt(i)) >>> 0);
      hash = (Math.imul(hash, ShaderCache.FNV1A_PRIME) >>> 0);
    }
    hash = ((hash ^ ((vLen >>> 24) & 0xff)) >>> 0);
    hash = (Math.imul(hash, ShaderCache.FNV1A_PRIME) >>> 0);
    hash = ((hash ^ ((vLen >>> 16) & 0xff)) >>> 0);
    hash = (Math.imul(hash, ShaderCache.FNV1A_PRIME) >>> 0);
    hash = ((hash ^ ((vLen >>> 8) & 0xff)) >>> 0);
    hash = (Math.imul(hash, ShaderCache.FNV1A_PRIME) >>> 0);
    hash = ((hash ^ (vLen & 0xff)) >>> 0);
    hash = (Math.imul(hash, ShaderCache.FNV1A_PRIME) >>> 0);
    const fLen = fragSrc.length;
    for (let i = 0; i < fLen; i++) {
      hash = ((hash ^ fragSrc.charCodeAt(i)) >>> 0);
      hash = (Math.imul(hash, ShaderCache.FNV1A_PRIME) >>> 0);
    }
    return hash.toString(16);
  }

  /**
   * Compute a primary cache key for a vertex/fragment source pair without
   * allocating the combined source string.
   */
  private static hashSources(vertSrc: string, fragSrc: string): string {
    return `fnv1a-${ShaderCache.fnv1aSources(vertSrc, fragSrc, ShaderCache.FNV1A_OFFSET_BASIS)}`;
  }

  /**
   * Compute a secondary verification key using a different FNV-1a seed.
   * Used for collision detection and as the collision-resolved cache key,
   * avoiding any allocation of the full combined source string.
   */
  private static hashSources2(vertSrc: string, fragSrc: string): string {
    return `fnv1a2-${ShaderCache.fnv1aSources(vertSrc, fragSrc, ShaderCache.FNV1A_OFFSET_BASIS_2)}`;
  }

  /**
   * Compute a compact, fixed-length cache key for a single GLSL source string
   * using FNV-1a so the raw source is never stored as a Map key.
   */
  private static hashShaderSource(source: string): string {
    return `fnv1a-shader-${ShaderCache.fnv1aSources(source, '', ShaderCache.FNV1A_OFFSET_BASIS)}`;
  }

  /** key → compiled WebGLShader */
  private readonly shaders: Map<string, WebGLShader> = new Map();

  /** key → linked WebGLProgram */
  private readonly programs: Map<string, WebGLProgram> = new Map();
  /** program key → shader cache keys used by this program */
  private readonly programShaders: Map<string, [string, string]> = new Map();
  /** shader key → number of programs currently referencing it */
  private readonly shaderRefCounts: Map<string, number> = new Map();
  /** program key → secondary hash (only for auto-keyed entries; used to detect hash collisions) */
  private readonly programSources: Map<string, string> = new Map();
  /** program key → number of consumers currently retaining this program */
  private readonly programRefCounts: Map<string, number> = new Map();

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
   * @param key Optional cache key. Defaults to an FNV-1a hash of the source string.
   */
  getShader(type: number, source: string, key?: string): WebGLShader {
    const cacheKey = key ?? ShaderCache.hashShaderSource(source);
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
    // Explicit-key path: bypass auto-hashing entirely.
    if (key !== undefined) {
      const existing = this.programs.get(key);
      if (existing !== undefined) return existing;
      return this.compileAndCache(vertexSource, fragmentSource, key, undefined);
    }

    // Auto-keyed path: compute both hashes without allocating combinedSource.
    // hashSources  → primary cache key (used as the normal slot).
    // hashSources2 → secondary key for collision verification.
    // collisionKey → composite of both hashes; used as a globally-unique slot
    //                for collision-resolved entries (simultaneous collision on
    //                two independent 32-bit hashes is ~1 in 2^64).
    const hashKey = ShaderCache.hashSources(vertexSource, fragmentSource);
    const secondaryKey = ShaderCache.hashSources2(vertexSource, fragmentSource);
    const collisionKey = `${hashKey}:${secondaryKey}`;

    // 1. Check primary hash slot.
    const primaryEntry = this.programs.get(hashKey);
    if (primaryEntry !== undefined) {
      // Verify this slot belongs to the same source pair via stored secondary hash.
      if (this.programSources.get(hashKey) === secondaryKey) {
        return primaryEntry; // ✅ cache hit — no combinedSource allocation
      }
      // Primary hash collision: look up the collision-resolved slot.
      const collisionEntry = this.programs.get(collisionKey);
      if (collisionEntry !== undefined) return collisionEntry;
      // No resolved entry yet: compile under the composite key.
      // secondaryKey is undefined here: programSources only needs to be written
      // for primary-slot entries (where it is checked for collision detection).
      return this.compileAndCache(vertexSource, fragmentSource, collisionKey, undefined);
    }

    // 2. Primary slot empty: check collision-resolved slot.
    //    This covers the case where the primary-keyed entry was removed/released
    //    but the collision-resolved program (stored under collisionKey) remains.
    const collisionEntry = this.programs.get(collisionKey);
    if (collisionEntry !== undefined) return collisionEntry;

    // 3. Full cache miss: compile under the primary hash key.
    return this.compileAndCache(vertexSource, fragmentSource, hashKey, secondaryKey);
  }

  /**
   * Compile a vertex/fragment shader pair, link them into a program, and
   * store the result in the cache under `cacheKey`.
   *
   * @param secondaryKey The secondary hash to store in `programSources` for
   *   collision detection.  Pass `undefined` for explicitly-keyed programs and
   *   for collision-resolved programs (stored under the composite collision key).
   */
  private compileAndCache(
    vertexSource: string,
    fragmentSource: string,
    cacheKey: string,
    secondaryKey: string | undefined,
  ): WebGLProgram {
    const vertexShaderKey = ShaderCache.hashShaderSource(vertexSource);
    const fragmentShaderKey = ShaderCache.hashShaderSource(fragmentSource);
    const vsPreExisted = this.shaders.has(vertexShaderKey);
    const fsPreExisted = this.shaders.has(fragmentShaderKey);
    let vs: WebGLShader;
    let fs: WebGLShader;
    let program: WebGLProgram;
    try {
      vs = this.getShader(this.gl.VERTEX_SHADER, vertexSource, vertexShaderKey);
      fs = this.getShader(this.gl.FRAGMENT_SHADER, fragmentSource, fragmentShaderKey);
      program = createProgram(this.gl, vs, fs);
    } catch (e) {
      // Evict any shaders that were newly added to the cache during this failed
      // attempt so that their WebGL objects are released immediately.
      if (!vsPreExisted) {
        const shader = this.shaders.get(vertexShaderKey);
        if (shader) {
          this.gl.deleteShader(shader);
          this.shaders.delete(vertexShaderKey);
        }
      }
      if (!fsPreExisted) {
        const shader = this.shaders.get(fragmentShaderKey);
        if (shader) {
          this.gl.deleteShader(shader);
          this.shaders.delete(fragmentShaderKey);
        }
      }
      throw e;
    }
    this.programs.set(cacheKey, program);
    this.programShaders.set(cacheKey, [vertexShaderKey, fragmentShaderKey]);
    if (secondaryKey !== undefined) {
      this.programSources.set(cacheKey, secondaryKey);
    }
    this.shaderRefCounts.set(vertexShaderKey, (this.shaderRefCounts.get(vertexShaderKey) ?? 0) + 1);
    this.shaderRefCounts.set(fragmentShaderKey, (this.shaderRefCounts.get(fragmentShaderKey) ?? 0) + 1);
    return program;
  }

  /**
   * Return the cache key that `getProgram` uses (or would use) for the given
   * source pair. Use this to obtain the key for auto-keyed programs (i.e.
   * those where `key` was omitted in the `getProgram` call) before calling
   * `retainProgram` or `releaseProgram`.
   *
   * ```ts
   * const key = cache.getProgramKey(vertSrc, fragSrc);
   * const program = cache.getProgram(vertSrc, fragSrc);
   * cache.retainProgram(key);
   * // … later …
   * cache.releaseProgram(key);
   * ```
   *
   * @param vertexSource GLSL vertex shader source
   * @param fragmentSource GLSL fragment shader source
   * @param key Explicit cache key, if one was supplied to `getProgram`.
   * @returns The string cache key used (or that would be used) by `getProgram`
   *   for this source pair. For auto-keyed programs this is the primary FNV-1a
   *   hash string; for explicitly-keyed programs it is the supplied `key` value.
   */
  getProgramKey(vertexSource: string, fragmentSource: string, key?: string): string {
    if (key !== undefined) return key;
    const hashKey = ShaderCache.hashSources(vertexSource, fragmentSource);
    const secondaryKey = ShaderCache.hashSources2(vertexSource, fragmentSource);
    const collisionKey = `${hashKey}:${secondaryKey}`;
    // If a collision-resolved entry already exists under the composite key,
    // return that key — even if the original primary-hash slot is now vacant.
    if (this.programs.has(collisionKey)) {
      return collisionKey;
    }
    // Mirror the collision-resolution logic from getProgram: if the primary hash
    // slot is occupied by a *different* source pair, the actual key is collisionKey.
    if (this.programs.has(hashKey) && this.programSources.get(hashKey) !== secondaryKey) {
      return collisionKey;
    }
    return hashKey;
  }

  /**
   * Increment the consumer reference count for a cached program.
   *
   * Call this once per consumer (e.g. a Material) that takes ownership of the
   * program returned by `getProgram`. Each `retainProgram` call must be
   * balanced by exactly one `releaseProgram` call when the consumer is
   * disposed.
   *
   * Use `getProgramKey` to obtain the cache key when no explicit key was
   * supplied to `getProgram`.
   *
   * @param key Program cache key — use `getProgramKey(vert, frag)` when the
   *   program was cached with an auto-generated key.
   */
  retainProgram(key: string): void {
    if (!this.programs.has(key)) return;
    this.programRefCounts.set(key, (this.programRefCounts.get(key) ?? 0) + 1);
  }

  /**
   * Decrement the consumer reference count for a cached program.
   *
   * When the count drops to zero the program (and any shaders that are no
   * longer referenced by any other program) are deleted from the GPU and
   * removed from the cache automatically.
   *
   * @param key Program cache key — use `getProgramKey(vert, frag)` when the
   *   program was cached with an auto-generated key.
   */
  releaseProgram(key: string): void {
    const current = this.programRefCounts.get(key);
    if (current === undefined) return;
    const next = current - 1;
    if (next > 0) {
      this.programRefCounts.set(key, next);
      return;
    }
    this.programRefCounts.delete(key);
    this.removeProgram(key);
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
    this.programSources.delete(key);
    this.programRefCounts.delete(key);

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
    this.programSources.clear();
    this.programRefCounts.clear();
    this.shaderRefCounts.clear();
    this.shaders.clear();
  }
}
