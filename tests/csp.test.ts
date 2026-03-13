import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagePaths = ['../index.html', '../demo.html', '../demos.html', '../gallery.html'] as const;

function extractCspContent(html: string): string | null {
  const match =
    html.match(/<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i) ??
    html.match(/<meta\s[^>]*content="([^"]+)"[^>]*http-equiv="Content-Security-Policy"/i) ??
    html.match(/<meta\s[^>]*http-equiv='Content-Security-Policy'[^>]*content='([^']+)'/i) ??
    html.match(/<meta\s[^>]*content='([^']+)'[^>]*http-equiv='Content-Security-Policy'/i);
  return match ? match[1] : null;
}

describe('Content-Security-Policy', () => {
  it('includes a CSP meta tag on each public entry page', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(extractCspContent(html), `${path} must have a CSP meta tag`).not.toBeNull();
    }
  });

  it('disallows unsafe-eval in every CSP', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      const csp = extractCspContent(html);
      if (csp === null) throw new Error(`${path} must have a CSP meta tag`);
      expect(csp).not.toContain("'unsafe-eval'");
    }
  });

  it('restricts object-src to none in every CSP', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      const csp = extractCspContent(html);
      if (csp === null) throw new Error(`${path} must have a CSP meta tag`);
      expect(csp).toContain("object-src 'none'");
    }
  });

  it('restricts base-uri to self in every CSP', () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      const csp = extractCspContent(html);
      if (csp === null) throw new Error(`${path} must have a CSP meta tag`);
      expect(csp).toContain("base-uri 'self'");
    }
  });

  it("does not use a bare 'self' in script-src without a complementary nonce or hash", () => {
    for (const path of pagePaths) {
      const html = readFileSync(new URL(path, import.meta.url), 'utf8');
      const csp = extractCspContent(html);
      if (csp === null) throw new Error(`${path} must have a CSP meta tag`);
      const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
      if (scriptSrcMatch === null) continue;
      const scriptSrc = scriptSrcMatch[1];
      if (scriptSrc.includes("'self'")) {
        const hasNonce = /'nonce-[^']+'/.test(scriptSrc);
        const hasHash = /'sha(?:256|384|512)-[^']+'/.test(scriptSrc);
        expect(
          hasNonce || hasHash,
          `${path} uses bare 'self' in script-src without a nonce or hash`,
        ).toBe(true);
      }
    }
  });
});
