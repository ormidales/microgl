import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)),
        demos: fileURLToPath(new URL('./demos.html', import.meta.url)),
      },
      external: (id: string) => id === 'gl-matrix' || id.startsWith('gl-matrix/'),
    },
  },
});
