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

  constructor(
    private readonly renderer?: Renderer,
    private readonly material?: Material,
  ) {
    super();
  }

  update(em: EntityManager, _deltaTime: number): void {
    if (!this.renderer || !this.material) return;

    const gl = this.renderer.gl;
    const cameraEntity = em.getEntitiesWith('Camera')[0];
    const camera = cameraEntity !== undefined
      ? em.getComponent<CameraComponent>(cameraEntity, 'Camera')
      : undefined;
    const entities = em.getEntitiesWith(...this.requiredComponents);

    this.material.use();
    this.material.setMat4('u_view', camera?.view ?? this.identity);
    this.material.setMat4('u_projection', camera?.projection ?? this.identity);

    for (const id of entities) {
      const transform = em.getComponent<TransformComponent>(id, 'Transform');
      const mesh = em.getComponent<MeshComponent>(id, 'Mesh');
      if (!transform || mesh.vertices.length === 0) continue;

      const model = mat4.create();
      mat4.translate(model, model, [transform.x, transform.y, transform.z]);
      mat4.rotateX(model, model, transform.rotationX);
      mat4.rotateY(model, model, transform.rotationY);
      mat4.rotateZ(model, model, transform.rotationZ);
      mat4.scale(model, model, [transform.scaleX, transform.scaleY, transform.scaleZ]);
      this.material.setMat4('u_model', model);

      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      if (!vao || !vbo) continue;

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      let ebo: WebGLBuffer | null = null;
      if (mesh.indices.length > 0) {
        ebo = gl.createBuffer();
        if (ebo) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
          gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
        }
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, Math.floor(mesh.vertices.length / 3));
      }

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.deleteBuffer(vbo);
      if (ebo) gl.deleteBuffer(ebo);
      gl.deleteVertexArray(vao);
    }
  }
}
