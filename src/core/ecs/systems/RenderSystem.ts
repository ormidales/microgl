import { System } from '../System';
import type { EntityManager } from '../EntityManager';
import { mat4 } from 'gl-matrix';
import type { Renderer } from '../../Renderer';
import type { Material } from '../../Material';
import type { TransformComponent } from '../components/TransformComponent';
import type { MeshComponent } from '../components/MeshComponent';
import type { CameraComponent } from '../components/CameraComponent';

/**
 * Iterates over entities that have both a `Transform` and a `Mesh` component
 * and issues WebGL draw calls for each entity.
 */
export class RenderSystem extends System {
  public readonly requiredComponents = ['Transform', 'Mesh'] as const;
  private readonly identity = mat4.create();
  private readonly model = mat4.create();
  private meshBuffers = new Map<
    MeshComponent,
    {
      vao: WebGLVertexArrayObject;
      vbo: WebGLBuffer;
      normalVbo: WebGLBuffer | null;
      uvVbo: WebGLBuffer | null;
      ebo: WebGLBuffer | null;
      vertexCount: number;
      indexCount: number;
    }
  >();

  constructor(
    private readonly renderer?: Renderer,
    private readonly material?: Material,
  ) {
    super();
  }

  private ensureMeshBuffers(
    gl: WebGL2RenderingContext,
    mesh: MeshComponent,
  ): {
    vao: WebGLVertexArrayObject;
    vbo: WebGLBuffer;
    normalVbo: WebGLBuffer | null;
    uvVbo: WebGLBuffer | null;
    ebo: WebGLBuffer | null;
    vertexCount: number;
    indexCount: number;
  } | null {
    const cached = this.meshBuffers.get(mesh);
    if (cached) return cached;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      return null;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    let normalVbo: WebGLBuffer | null = null;
    if (mesh.normals.length > 0) {
      normalVbo = gl.createBuffer();
      if (!normalVbo) {
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        return null;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, normalVbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }

    let uvVbo: WebGLBuffer | null = null;
    if (mesh.uvs.length > 0) {
      uvVbo = gl.createBuffer();
      if (!uvVbo) {
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        if (normalVbo) gl.deleteBuffer(normalVbo);
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        return null;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, uvVbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    }

    let ebo: WebGLBuffer | null = null;
    if (mesh.indices.length > 0) {
      ebo = gl.createBuffer();
      if (!ebo) {
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        if (uvVbo) gl.deleteBuffer(uvVbo);
        if (normalVbo) gl.deleteBuffer(normalVbo);
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        return null;
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const buffers = {
      vao,
      vbo,
      normalVbo,
      uvVbo,
      ebo,
      vertexCount: Math.floor(mesh.vertices.length / 3),
      indexCount: mesh.indices.length,
    };
    this.meshBuffers.set(mesh, buffers);
    return buffers;
  }

  private releaseMeshBuffers(gl: WebGL2RenderingContext, mesh: MeshComponent): void {
    const buffers = this.meshBuffers.get(mesh);
    if (!buffers) return;
    if (buffers.ebo) gl.deleteBuffer(buffers.ebo);
    if (buffers.uvVbo) gl.deleteBuffer(buffers.uvVbo);
    if (buffers.normalVbo) gl.deleteBuffer(buffers.normalVbo);
    gl.deleteBuffer(buffers.vbo);
    gl.deleteVertexArray(buffers.vao);
    this.meshBuffers.delete(mesh);
  }

  update(em: EntityManager, _deltaTime: number): void {
    if (!this.renderer || !this.material) return;

    const gl = this.renderer.gl;
    const cameraEntity = em.getEntitiesWith('Camera')[0];
    const camera = cameraEntity !== undefined
      ? em.getComponent<CameraComponent>(cameraEntity, 'Camera')
      : undefined;
    const entities = em.getEntitiesWith(...this.requiredComponents);
    const activeMeshes = new Set<MeshComponent>();

    this.material.use();
    this.material.setVec4('u_color', 1, 1, 1, 1);
    this.material.setMat4('u_view', camera?.view ?? this.identity);
    this.material.setMat4('u_projection', camera?.projection ?? this.identity);

    for (const id of entities) {
      const transform = em.getComponent<TransformComponent>(id, 'Transform');
      const mesh = em.getComponent<MeshComponent>(id, 'Mesh');
      if (!transform || !mesh || mesh.vertices.length === 0) continue;
      activeMeshes.add(mesh);

      mat4.identity(this.model);
      mat4.translate(this.model, this.model, [transform.x, transform.y, transform.z]);
      mat4.rotateX(this.model, this.model, transform.rotationX);
      mat4.rotateY(this.model, this.model, transform.rotationY);
      mat4.rotateZ(this.model, this.model, transform.rotationZ);
      mat4.scale(this.model, this.model, [transform.scaleX, transform.scaleY, transform.scaleZ]);
      this.material.setMat4('u_model', this.model);

      const buffers = this.ensureMeshBuffers(gl, mesh);
      if (!buffers) continue;

      gl.bindVertexArray(buffers.vao);
      if (buffers.indexCount > 0) {
        gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, buffers.vertexCount);
      }
      gl.bindVertexArray(null);
    }

    for (const [mesh] of this.meshBuffers) {
      if (!activeMeshes.has(mesh)) this.releaseMeshBuffers(gl, mesh);
    }
  }

  /** Drop cached VAO metadata so buffers are rebuilt on next draw after context restoration. */
  resetGpuResources(): void {
    const gl = this.renderer?.gl;
    if (gl) {
      for (const buffers of this.meshBuffers.values()) {
        if (buffers.ebo) gl.deleteBuffer(buffers.ebo);
        if (buffers.uvVbo) gl.deleteBuffer(buffers.uvVbo);
        if (buffers.normalVbo) gl.deleteBuffer(buffers.normalVbo);
        gl.deleteBuffer(buffers.vbo);
        gl.deleteVertexArray(buffers.vao);
      }
    }
    this.meshBuffers = new Map();
  }
}
