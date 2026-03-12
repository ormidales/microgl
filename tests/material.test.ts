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

describe('Material shader source JSDoc security warnings', () => {
  it('DEFAULT_VERTEX_SOURCE JSDoc includes a @security tag warning about GLSL injection', () => {
    expect(materialSource).toMatch(/\/\*\*[^]*?@security[^]*?GPU hangs[^]*?\*\/\s*(?:export\s+)?const\s+DEFAULT_VERTEX_SOURCE\s*=/);
  });

  it('DEFAULT_FRAGMENT_SOURCE JSDoc includes a @security tag warning about GLSL injection', () => {
    expect(materialSource).toMatch(/\/\*\*[^]*?@security[^]*?GPU hangs[^]*?\*\/\s*(?:export\s+)?const\s+DEFAULT_FRAGMENT_SOURCE\s*=/);
  });

  it('Material constructor JSDoc includes a @security tag', () => {
    expect(materialSource).toMatch(/\/\*\*[^]*?@security[^]*?GPU hangs[^]*?\*\/\s*constructor\s*\(/);
  });
});
