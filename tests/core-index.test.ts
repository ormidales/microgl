import { describe, it, expect } from 'vitest';
import { EntityManager, TransformComponent, MeshComponent } from '../src/core';

describe('core root index exports', () => {
  it('re-exports ECS primitives', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3));
    em.addComponent(id, new MeshComponent(new Float32Array([0, 0, 0])));

    expect(em.hasComponent(id, 'Transform')).toBe(true);
    expect(em.hasComponent(id, 'Mesh')).toBe(true);
  });
});
