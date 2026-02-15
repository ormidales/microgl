import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    rollupOptions: {
      external: (id: string) => id === 'gl-matrix' || id.startsWith('gl-matrix/'),
    },
  },
});
