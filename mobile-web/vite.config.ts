import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'assets',
    emptyOutDir: false,
    lib: { entry: path.resolve(__dirname, 'zip-entry.ts'), formats: ['es'], fileName: () => 'zip.js' },
    minify: true,
  },
});
