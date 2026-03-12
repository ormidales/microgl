import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagePaths = ['../index.html', '../demo.html', '../demos.html', '../gallery.html'] as const;

describe('Content-Security-Policy', () => {
  it('includes a CSP meta tag on each public entry page', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(html).toContain('http-equiv="Content-Security-Policy"');
    }
  });

  it('disallows unsafe-eval in every CSP', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(html).not.toContain("'unsafe-eval'");
    }
  });

  it('restricts object-src to none in every CSP', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(html).toContain("object-src 'none'");
    }
  });

  it('restricts base-uri to self in every CSP', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(html).toContain("base-uri 'self'");
    }
  });
});
