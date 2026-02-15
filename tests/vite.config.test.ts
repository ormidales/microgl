import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('Vite config', () => {
  it('externalizes gl-matrix from rollup bundle', () => {
    const config = typeof viteConfig === 'function' ? viteConfig({} as never) : viteConfig;
    const external = config.build?.rollupOptions?.external;

    expect(typeof external).toBe('function');
    expect(external?.('gl-matrix')).toBe(true);
    expect(external?.('gl-matrix/vec3')).toBe(true);
    expect(external?.('other-lib')).toBeFalsy();
  });
});
