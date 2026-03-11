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

  it('annotates DEFAULT_VERTEX_SOURCE barrel export with a JSDoc comment linking Material', () => {
    expect(coreIndexSource).toMatch(/see \{@link Material\}[^]*?export \{ DEFAULT_VERTEX_SOURCE \}/);
    expect(coreIndexSource).not.toContain('in Material.ts');
  });

  it('annotates DEFAULT_FRAGMENT_SOURCE barrel export with a JSDoc comment linking Material', () => {
    expect(coreIndexSource).toMatch(/see \{@link Material\}[^]*?export \{ DEFAULT_FRAGMENT_SOURCE \}/);
    expect(coreIndexSource).not.toContain('in Material.ts');
  });
});
