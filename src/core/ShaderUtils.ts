/**
 * Utility functions for compiling GLSL shaders and linking WebGL programs.
 *
 * Provides error checking via `gl.getShaderInfoLog` and `gl.getProgramInfoLog`.
 */

// ---------------------------------------------------------------------------
// Shader compilation
// ---------------------------------------------------------------------------

/**
 * Compile a GLSL shader of the given type.
 *
 * @throws Error with the shader info log when compilation fails.
 */
export function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create WebGL shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    const label = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    const sourceWithLineNumbers = source
      .split('\n')
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n');
    throw new Error(
      `Failed to compile ${label} shader:\n${log}\nSource (${label} shader):\n${sourceWithLineNumbers}`,
    );
  }

  return shader;
}

// ---------------------------------------------------------------------------
// Program linking
// ---------------------------------------------------------------------------

/**
 * Link a vertex shader and a fragment shader into a WebGL program.
 *
 * @throws Error with the program info log when linking fails.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create WebGL program object.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Failed to link shader program:\n${log}`);
  }

  return program;
}
