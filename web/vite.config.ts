import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand', 'framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5009,
    strictPort: true,
    host: '0.0.0.0',
    open: false,
    cors: true,
    proxy: {
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
