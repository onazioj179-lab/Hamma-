/**
 * SPK Implementation Blueprint - WASM Module
 * 
 * Exports all WASM-related functionality for compression and decompression.
 * 
 * @module core/wasm
 * @version 1.0.0
 */

// Memory management
export {
  WasmBufferPool,
  getBufferPool,
  initializeBufferPool,
  WASM_PAGE_SIZE,
  INITIAL_PAGES,
  MAX_PAGES,
  DEFAULT_CHUNK_SIZE,
  MAX_POOL_SIZE,
  type MemoryStats,
  type BufferHandle,
  type MemoryConfig,
} from './memory';

// WASM interface
export {
  WasmInterface,
  getWasmInterface,
  initializeWasm,
  WASM_ERROR_CODES,
  type WasmExports,
  type WasmModule,
  type CompressionContext,
  type DecompressionContext,
  type CompressionLevel,
  type InitOptions,
  type WasmErrorCode,
} from './interface';

// WASM loader and validation
export {
  loadWasmModule,
  preloadWasmModule,
  validateWasmExports,
  createFallbackModule,
  type WasmCompressionCore,
  type LoadOptions,
} from './loader';

// Memory pool
export {
  MemoryPool,
} from './pool';

// Compression wrappers
export {
  compressChunk,
  flushArchive,
  finalizeArchive,
  resetCompression,
  decompressChunk,
  flushDecompression,
  finalizeDecompression,
  computeChecksum,
  getWasmVersion,
  compressChunks,
  decompressChunks,
  safeWasmCall,
  type CompressionResult,
  type WasmError,
} from './wrappers';

// Worker integration
export {
  createWorkerPool,
  sendWorkerMessage,
  getNextWorker,
  terminateWorkerPool,
  type WorkerMessage,
  type WorkerResponse,
  type WorkerPool,
} from './worker-example';
