import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('Homepage', () => {
  it('contains semantic homepage sections and project summary', () => {
    expect(indexHtml).toContain('<header>');
    expect(indexHtml).toContain('<main>');
    expect(indexHtml).toContain('<footer>');
    expect(indexHtml).toContain('<h1>microgl</h1>');
    expect(indexHtml).toContain('WebGL 2.0');
    expect(indexHtml).toContain('ECS architecture');
    expect(indexHtml).toContain('gl-matrix');
  });

  it('contains a call to action to the gallery page', () => {
    expect(indexHtml).toMatch(/<a[^>]*class="cta-button"[^>]*href="\/gallery\.html"[^>]*>/);
  });
});
