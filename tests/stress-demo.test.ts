import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const stressDemoSource = readFileSync(new URL('../src/demos/stress.ts', import.meta.url), 'utf8');

describe('Stress demo', () => {
  it('routes the demo entrypoint to stress mode via URL search params', () => {
    expect(mainSource).toContain("import { runStressDemo } from './demos/stress'");
    expect(mainSource).toContain("new URLSearchParams(window.location.search).get('demo')");
    expect(mainSource).toContain("if (demo === 'stress')");
    expect(mainSource).toContain('runStressDemo()');
    expect(mainSource).toContain('runGltfDemo()');
  });

  it('StressMovementSystem has a JSDoc comment referencing MOVE_SPEED, POSITION_OFFSET_STEP, and TURN_SPEED', () => {
    const match = stressDemoSource.match(/\/\*\*[\s\S]*?\*\/\s*class StressMovementSystem/);
    expect(match).not.toBeNull();
    const jsdoc = match![0];
    expect(jsdoc).toContain('MOVE_SPEED');
    expect(jsdoc).toContain('POSITION_OFFSET_STEP');
    expect(jsdoc).toContain('TURN_SPEED');
  });

  it('explains intentional MeshComponent sharing and ref-counting in a comment', () => {
    expect(stressDemoSource).toMatch(
      /\/\/.*All entities share the same MeshComponent instance/,
    );
    expect(stressDemoSource).toMatch(/\/\/.*ref-count/);
  });

  it('creates a large ECS scene with Transform+Mesh updates and live FPS display', () => {
    expect(stressDemoSource).toContain('const ENTITY_GRID_SIZE = 100');
    expect(stressDemoSource).toContain("public readonly requiredComponents = ['Transform', 'Mesh'] as const");
    expect(stressDemoSource).toContain('em.getEntitiesWith(...this.requiredComponents)');
    expect(stressDemoSource).toContain('layout.fpsValue.textContent = (1 / time.deltaTime).toFixed(0)');
  });
});
