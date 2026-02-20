/**
 * Abstracts a WebGL shader program and provides helpers to set uniforms.
 *
 * A Material owns a linked `WebGLProgram` built from vertex and fragment
 * shader sources. It exposes typed `setUniform*` helpers so callers never
 * need to look up uniform locations manually.
 */

import { createShader, createProgram } from './ShaderUtils';
import type { mat4 } from 'gl-matrix';

// ---------------------------------------------------------------------------
// Default shaders
// ---------------------------------------------------------------------------

/** Minimal pass-through vertex shader. */
export const DEFAULT_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec4 a_position;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;

void main() {
  gl_Position = u_projection * u_view * u_model * a_position;
}
`;

/** Solid-color fragment shader. */
export const DEFAULT_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

uniform vec4 u_color;

out vec4 fragColor;

void main() {
  fragColor = u_color;
}
`;

// ---------------------------------------------------------------------------
// Material class
// ---------------------------------------------------------------------------

export class Material {
  public program: WebGLProgram | null;

  private gl: WebGL2RenderingContext;
  private readonly uniformLocations: Map<string, WebGLUniformLocation | null> = new Map();
  private readonly vertexSource: string;
  private readonly fragmentSource: string;

  /**
   * Create a Material by compiling and linking the supplied shaders.
   *
   * @param gl WebGL 2 context
   * @param vertexSource GLSL vertex shader source (defaults to a basic MVP shader)
   * @param fragmentSource GLSL fragment shader source (defaults to a solid-color shader)
   */
  constructor(
    gl: WebGL2RenderingContext,
    vertexSource: string = DEFAULT_VERTEX_SOURCE,
    fragmentSource: string = DEFAULT_FRAGMENT_SOURCE,
  ) {
    this.gl = gl;
    this.vertexSource = vertexSource;
    this.fragmentSource = fragmentSource;
    this.program = this.createProgram();
  }

  // ---------------------------------------------------------------------------
  // Program activation
  // ---------------------------------------------------------------------------

  /** Bind this material's program as the active shader program. */
  use(): void {
    if (!this.program) return;
    this.gl.useProgram(this.program);
  }

  // ---------------------------------------------------------------------------
  // Uniform setters
  // ---------------------------------------------------------------------------

  /** Set a `float` uniform. */
  setFloat(name: string, value: number): void {
    this.gl.uniform1f(this.location(name), value);
  }

  /** Set an `int` or `sampler` uniform. */
  setInt(name: string, value: number): void {
    this.gl.uniform1i(this.location(name), value);
  }

  /** Set a `vec2` uniform. */
  setVec2(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.location(name), x, y);
  }

  /** Set a `vec3` uniform. */
  setVec3(name: string, x: number, y: number, z: number): void {
    this.gl.uniform3f(this.location(name), x, y, z);
  }

  /** Set a `vec4` uniform. */
  setVec4(name: string, x: number, y: number, z: number, w: number): void {
    this.gl.uniform4f(this.location(name), x, y, z, w);
  }

  /** Set a `mat4` uniform from a `Float32Array` (column-major). */
  setMat4(name: string, value: Float32Array | mat4): void {
    this.gl.uniformMatrix4fv(this.location(name), false, value);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Delete the program from the GPU. */
  dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  /** Rebuild the GPU program (typically after `webglcontextrestored`) and reset cached uniforms. */
  restore(gl: WebGL2RenderingContext = this.gl): void {
    const previousGl = this.gl;
    this.gl = gl;
    try {
      const restoredProgram = this.createProgram();
      this.uniformLocations.clear();
      this.program = restoredProgram;
    } catch (error) {
      this.gl = previousGl;
      this.program = null;
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Lazily look up and cache a uniform location.
   * Returns `null` for inactive/optimized-away uniforms (WebGL spec compliant).
   */
  private location(name: string): WebGLUniformLocation | null {
    if (!this.program) return null;
    if (this.uniformLocations.has(name)) return this.uniformLocations.get(name) ?? null;

    const loc = this.gl.getUniformLocation(this.program, name);
    this.uniformLocations.set(name, loc);
    return loc;
  }

  private createProgram(): WebGLProgram {
    const vs = createShader(this.gl, this.gl.VERTEX_SHADER, this.vertexSource);
    const fs = createShader(this.gl, this.gl.FRAGMENT_SHADER, this.fragmentSource);
    return createProgram(this.gl, vs, fs);
  }
}
