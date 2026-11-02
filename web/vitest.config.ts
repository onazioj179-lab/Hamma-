import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 60000, // 60 seconds for heavy tests
    hookTimeout: 30000,
    pool: 'threads',
    // WASM and stress suites allocate large buffers in each process.
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
  },
});
