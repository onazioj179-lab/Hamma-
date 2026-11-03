import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|zustand|framer-motion)[\\/]/.test(id)) return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5009,
    strictPort: true,
    host: '127.0.0.1',
    open: false,
    cors: false,
    proxy: {
      '/api/process': { target: 'http://127.0.0.1:5010', changeOrigin: false },
      '/api': { target: process.env.SPK_API_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
    },
    headers: {
      // Enable SharedArrayBuffer for multi-threaded WASM
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['spk-wasm'],
  },
  worker: {
    format: 'es',
    plugins: () => [react()],
  },
});
