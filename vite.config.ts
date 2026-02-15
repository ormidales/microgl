import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    rollupOptions: {
      external: (id) => id === 'gl-matrix' || id.startsWith('gl-matrix/'),
    },
  },
});
