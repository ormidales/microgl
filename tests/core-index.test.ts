import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { EntityManager, TransformComponent, MeshComponent } from '../src/core';

const coreIndexSource = readFileSync(new URL('../src/core/index.ts', import.meta.url), 'utf8');

describe('core root index exports', () => {
  it('re-exports ECS primitives', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3));
    em.addComponent(id, new MeshComponent(new Float32Array([0, 0, 0])));

    expect(em.hasComponent(id, 'Transform')).toBe(true);
    expect(em.hasComponent(id, 'Mesh')).toBe(true);
  });

  it('re-exports DEFAULT_VERTEX_SOURCE and DEFAULT_FRAGMENT_SOURCE together without duplicating JSDoc', () => {
    expect(coreIndexSource).toContain('DEFAULT_VERTEX_SOURCE');
    expect(coreIndexSource).toContain('DEFAULT_FRAGMENT_SOURCE');
    expect(coreIndexSource).toMatch(/export \{[^}]*DEFAULT_VERTEX_SOURCE[^}]*DEFAULT_FRAGMENT_SOURCE[^}]*\}/);
  });

  it('does not duplicate @security documentation in the barrel re-export', () => {
    expect(coreIndexSource).not.toMatch(/@security[^]*export \{[^}]*DEFAULT_VERTEX_SOURCE/);
    expect(coreIndexSource).not.toMatch(/@security[^]*export \{[^}]*DEFAULT_FRAGMENT_SOURCE/);
  });
});
