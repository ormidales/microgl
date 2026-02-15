import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagePaths = ['../index.html', '../demo.html', '../demos.html', '../gallery.html'] as const;

describe('Public HTML metadata', () => {
  it('includes a non-empty meta description on each public entry page', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"\s*\/>/);
    }
  });
});
