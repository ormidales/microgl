import { System } from '../System';
import type { EntityManager } from '../EntityManager';
import type { TransformComponent } from '../components/TransformComponent';
import type { MeshComponent } from '../components/MeshComponent';

/**
 * Iterates over entities that have both a `Transform` and a `Mesh` component
 * and logs their data each frame. In a full engine this would issue draw calls.
 */
export class RenderSystem extends System {
  public readonly requiredComponents = ['Transform', 'Mesh'] as const;

  update(em: EntityManager, _deltaTime: number): void {
    const entities = em.getEntitiesWith(...this.requiredComponents);

    for (const id of entities) {
      const _transform = em.getComponent<TransformComponent>(id, 'Transform');
      const _mesh = em.getComponent<MeshComponent>(id, 'Mesh');

      // Placeholder – a real implementation would issue WebGL draw calls
      // using _transform and _mesh data.
    }
  }
}
