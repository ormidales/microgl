import { describe, it, expect } from 'vitest';
import { EntityManager } from '../src/core/ecs/EntityManager';
import { TransformComponent } from '../src/core/ecs/components/TransformComponent';
import { MeshComponent } from '../src/core/ecs/components/MeshComponent';
import { RenderSystem } from '../src/core/ecs/systems/RenderSystem';

// ---------------------------------------------------------------------------
// EntityManager
// ---------------------------------------------------------------------------

describe('EntityManager', () => {
  it('creates entities with unique ids', () => {
    const em = new EntityManager();
    const a = em.createEntity();
    const b = em.createEntity();
    expect(a).not.toBe(b);
    expect(em.hasEntity(a)).toBe(true);
    expect(em.hasEntity(b)).toBe(true);
  });

  it('destroys entities and their components', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.destroyEntity(id);

    expect(em.hasEntity(id)).toBe(false);
    expect(em.hasComponent(id, 'Transform')).toBe(false);
  });

  it('adds and retrieves components', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const t = new TransformComponent(1, 2, 3);
    em.addComponent(id, t);

    const got = em.getComponent<TransformComponent>(id, 'Transform');
    expect(got).toBe(t);
    expect(got?.x).toBe(1);
    expect(got?.y).toBe(2);
    expect(got?.z).toBe(3);
  });

  it('removes components', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.removeComponent(id, 'Transform');

    expect(em.hasComponent(id, 'Transform')).toBe(false);
    expect(em.getComponent(id, 'Transform')).toBeUndefined();
  });

  it('getEntitiesWith filters by bitmask', () => {
    const em = new EntityManager();
    const a = em.createEntity();
    const b = em.createEntity();
    const c = em.createEntity();

    em.addComponent(a, new TransformComponent());
    em.addComponent(a, new MeshComponent());

    em.addComponent(b, new TransformComponent());

    em.addComponent(c, new MeshComponent());

    const both = em.getEntitiesWith('Transform', 'Mesh');
    expect(both).toEqual([a]);

    const transforms = em.getEntitiesWith('Transform');
    expect(transforms).toContain(a);
    expect(transforms).toContain(b);
    expect(transforms).not.toContain(c);
  });

  it('ignores addComponent on non-existent entity', () => {
    const em = new EntityManager();
    em.addComponent(999, new TransformComponent());
    expect(em.hasComponent(999, 'Transform')).toBe(false);
  });

  it('destroyEntity is a no-op for unknown ids', () => {
    const em = new EntityManager();
    expect(() => em.destroyEntity(42)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe('TransformComponent', () => {
  it('has correct default values', () => {
    const t = new TransformComponent();
    expect(t.type).toBe('Transform');
    expect(t.x).toBe(0);
    expect(t.scaleX).toBe(1);
  });
});

describe('MeshComponent', () => {
  it('has correct default values', () => {
    const m = new MeshComponent();
    expect(m.type).toBe('Mesh');
    expect(m.vertices.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RenderSystem
// ---------------------------------------------------------------------------

describe('RenderSystem', () => {
  it('declares required components', () => {
    const sys = new RenderSystem();
    expect(sys.requiredComponents).toEqual(['Transform', 'Mesh']);
  });

  it('update runs without errors', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3));
    em.addComponent(id, new MeshComponent(new Float32Array([0, 0, 0])));

    const sys = new RenderSystem();
    expect(() => sys.update(em, 0.016)).not.toThrow();
  });
});
