import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('Vite config', () => {
  it('externalizes gl-matrix from rollup bundle', () => {
    const config = typeof viteConfig === 'function' ? viteConfig({} as never) : viteConfig;
    const external = config.build?.rollupOptions?.external;

    expect(typeof external).toBe('function');
    expect(external?.('gl-matrix')).toBe(true);
    expect(external?.('gl-matrix/vec3')).toBe(true);
    expect(external?.('gl-matrix-fork')).toBeFalsy();
    expect(external?.('my-gl-matrix')).toBeFalsy();
    expect(external?.('other-lib')).toBeFalsy();
  });

  it('declares multiple HTML entry points', () => {
    const config = typeof viteConfig === 'function' ? viteConfig({} as never) : viteConfig;
    const input = config.build?.rollupOptions?.input as Record<string, string> | undefined;

    expect(input).toBeDefined();
    expect(input?.index.endsWith('index.html')).toBe(true);
    expect(input?.gallery.endsWith('gallery.html')).toBe(true);
    expect(input?.demos.endsWith('demos.html')).toBe(true);
    expect(input?.demo.endsWith('demo.html')).toBe(true);
  });
});
