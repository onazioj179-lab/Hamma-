import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: 'assets',
    emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL('./zip-entry.ts', import.meta.url)), formats: ['es'], fileName: () => 'zip.js' },
    minify: true,
  },
});
