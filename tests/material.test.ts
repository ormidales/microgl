import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const materialSource = readFileSync(new URL('../src/core/Material.ts', import.meta.url), 'utf8');

describe('Material.program JSDoc', () => {
  it('documents the program field with a JSDoc comment', () => {
    expect(materialSource).toContain('* The linked `WebGLProgram` for this material, or `null`');
  });

  it('explains the null cases (creation failure and failed restore)', () => {
    expect(materialSource).toContain('could not be created');
    expect(materialSource).toContain('failed');
  });

  it('includes a {@link restore} cross-reference', () => {
    expect(materialSource).toContain('{@link restore}');
  });
});
