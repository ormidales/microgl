import { System } from '../System';
import type { EntityManager } from '../EntityManager';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { Renderer } from '../../Renderer';
import type { Material } from '../../Material';
import type { TransformComponent } from '../components/TransformComponent';
import type { MeshComponent } from '../components/MeshComponent';
import type { CameraComponent } from '../components/CameraComponent';

/**
 * Number of consecutive GPU mesh-buffer allocation failures that must occur
 * before RenderSystem logs a degraded-rendering warning.
 * A threshold of 2 avoids false positives caused by a single transient
 * WebGL context interruption while still catching persistent GPU memory pressure.
 */
const CONSECUTIVE_MESH_BUFFER_FAILURE_WARNING_THRESHOLD = 2;

/**
 * Iterates over entities that have both a `Transform` and a `Mesh` component
 * and issues WebGL draw calls for each entity.
 */
export class RenderSystem extends System {
  public readonly requiredComponents = ['Transform', 'Mesh'] as const;
  private consecutiveMeshBufferAllocationFailures = 0;
  private warnedAboutMeshBufferAllocationFailure = false;
  private readonly identity = mat4.create();
  private readonly rotation = quat.create();
  private readonly translation = vec3.create();
  private readonly scale = vec3.fromValues(1, 1, 1);
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
      indexType: number;
    }
  >();

  /**
   * @param renderer  The WebGL renderer that provides the `gl` context.
   * @param material  The material (shader program) used for all draw calls.
   * @param onMeshBufferAllocationFailure  Optional callback invoked once when
   *   {@link CONSECUTIVE_MESH_BUFFER_FAILURE_WARNING_THRESHOLD} consecutive GPU
   *   mesh-buffer allocation failures are detected. Useful for surfacing a
   *   degraded-rendering warning to the application layer. The callback is
   *   invoked at most once per streak of consecutive allocation failures, and
   *   may be invoked again after mesh buffers are successfully created and the
   *   internal failure counters are reset.
   */
  constructor(
    private readonly renderer?: Renderer,
    private readonly material?: Material,
    private readonly onMeshBufferAllocationFailure?: (message: string) => void,
  ) {
    super();
  }

  private markMeshBufferAllocationFailure(): null {
    this.consecutiveMeshBufferAllocationFailures += 1;
    if (
      this.consecutiveMeshBufferAllocationFailures >= CONSECUTIVE_MESH_BUFFER_FAILURE_WARNING_THRESHOLD
      && !this.warnedAboutMeshBufferAllocationFailure
    ) {
      this.onMeshBufferAllocationFailure?.(
        'RenderSystem: repeated GPU mesh buffer allocation failures detected. Rendering may be degraded until WebGL context recovers.',
      );
      this.warnedAboutMeshBufferAllocationFailure = true;
    }
    return null;
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
    indexType: number;
  } | null {
    if (this.renderer?.isContextLost) {
      if (this.meshBuffers.size > 0) {
        this.meshBuffers.clear();
      }
      return null;
    }

    const cached = this.meshBuffers.get(mesh);
    if (cached) return cached;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      return this.markMeshBufferAllocationFailure();
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
        return this.markMeshBufferAllocationFailure();
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
        return this.markMeshBufferAllocationFailure();
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
        return this.markMeshBufferAllocationFailure();
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
      indexType: mesh.indices instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : mesh.indices instanceof Uint8Array
          ? gl.UNSIGNED_BYTE
          : gl.UNSIGNED_SHORT,
    };
    this.consecutiveMeshBufferAllocationFailures = 0;
    this.warnedAboutMeshBufferAllocationFailure = false;
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
    const material = this.material;
    let camera: CameraComponent | undefined;
    em.forEachEntityWith(['Camera'] as const, (id) => {
      if (camera) return;
      const component = em.getComponent<CameraComponent>(id, 'Camera');
      if (component) {
        camera = component;
      }
    });
    const activeMeshes = new Set<MeshComponent>();

    material.use();
    material.setVec4('u_color', 1, 1, 1, 1);
    material.setMat4('u_view', camera?.view ?? this.identity);
    material.setMat4('u_projection', camera?.projection ?? this.identity);

    em.forEachEntityWith(this.requiredComponents, (id) => {
      const transform = em.getComponent<TransformComponent>(id, 'Transform');
      const mesh = em.getComponent<MeshComponent>(id, 'Mesh');
      if (!transform || !mesh || mesh.vertices.length === 0) return;
      activeMeshes.add(mesh);

      if (transform.needsModelMatrixUpdate()) {
        vec3.set(this.translation, transform.x, transform.y, transform.z);
        vec3.set(this.scale, transform.scaleX, transform.scaleY, transform.scaleZ);
        quat.set(
          this.rotation,
          transform.rotation[0],
          transform.rotation[1],
          transform.rotation[2],
          transform.rotation[3],
        );
        mat4.fromRotationTranslationScale(
          transform.modelMatrix,
          this.rotation,
          this.translation,
          this.scale,
        );
        transform.markModelMatrixClean();
      }
      material.setMat4('u_model', transform.modelMatrix);

      const buffers = this.ensureMeshBuffers(gl, mesh);
      if (!buffers) return;

      gl.bindVertexArray(buffers.vao);
      if (buffers.indexCount > 0) {
        gl.drawElements(gl.TRIANGLES, buffers.indexCount, buffers.indexType, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, buffers.vertexCount);
      }
      gl.bindVertexArray(null);
    });

    for (const [mesh] of this.meshBuffers) {
      if (!activeMeshes.has(mesh)) this.releaseMeshBuffers(gl, mesh);
    }
  }

  /**
   * Releases GPU buffers for mesh components that are no longer attached to any
   * active entity. Call this outside the `update` loop to reclaim GPU memory
   * immediately after destroying mesh entities when the animation loop is paused.
   * When the loop is running, `update()` (or `safeUpdate()`) performs the same
   * cleanup automatically at the end of every frame.
   *
   * @example
   * // Destroy a batch of entities and immediately free their GPU buffers
   * // while the render loop is suspended:
   * ids.forEach(id => em.destroyEntity(id));
   * renderSystem.flushStaleMeshBuffers(em);
   *
   * // When the loop is active, no explicit flush is needed:
   * ids.forEach(id => em.destroyEntity(id));
   * // cleanup happens automatically inside renderSystem.safeUpdate(em, dt)
   */
  flushStaleMeshBuffers(em: EntityManager): void {
    const gl = this.renderer?.gl;
    if (!gl || this.meshBuffers.size === 0) return;
    const activeMeshes = new Set<MeshComponent>();
    em.forEachEntityWith(this.requiredComponents, (id) => {
      const mesh = em.getComponent<MeshComponent>(id, 'Mesh');
      if (mesh) activeMeshes.add(mesh);
    });
    for (const [mesh] of this.meshBuffers) {
      if (!activeMeshes.has(mesh)) this.releaseMeshBuffers(gl, mesh);
    }
  }

  /**
   * Clear the internal mesh-buffer cache so that GPU resources are
   * reallocated on the first {@link update} (or {@link safeUpdate}) call
   * after the WebGL context has been restored (that is, once
   * `renderer.isContextLost` is `false` again).
   *
   * Intended to be called as part of the WebGL context-loss lifecycle, for
   * example from `webglcontextlost` and/or `webglcontextrestored` handlers.
   * Do **not** call `gl.delete*` before invoking this method — the WebGL spec
   * states that all GPU handles are already invalidated when context is lost,
   * and calling delete on invalidated handles is undefined behaviour.
   *
   * @see {@link flushStaleMeshBuffers} for releasing buffers of destroyed entities
   *      while the render loop is paused (without context loss).
   */
  resetGpuResources(): void {
    // Do not call gl.delete* here — WebGL context loss already invalidates all GPU
    // handles, so calling delete on them is undefined behaviour per the WebGL spec.
    this.meshBuffers = new Map();
  }
}
