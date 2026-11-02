/**
 * SPK Workers - Module Exports
 * 
 * Central export point for all worker-related functionality.
 * 
 * @module workers
 * @version 1.0.0
 */

// Export type definitions
export * from './types';

// Export worker manager (V24 compatibility)
export * from './manager';

// Export worker URLs for dynamic import
export const COMPRESSION_WORKER_URL = new URL('./compressionWorker.ts', import.meta.url);
export const DECOMPRESSION_WORKER_URL = new URL('./decompressionWorker.ts', import.meta.url);

// Re-export for convenience
export type {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
  WorkerConfig,
  WorkerPoolConfig,
  WorkerStatus,
  ProgressEvent,
  WorkerStats,
  ChunkTable,
} from './types';
