import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('Vite config', () => {
  it('externalizes gl-matrix from rollup bundle', () => {
    const config = typeof viteConfig === 'function' ? viteConfig({} as never) : viteConfig;

    expect(config.build?.rollupOptions?.external).toContain('gl-matrix');
  });
});
