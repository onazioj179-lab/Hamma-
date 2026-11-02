/**
 * SPK Implementation Blueprint - Core Module Index
 * 
 * Central exports for all core runtime modules.
 * 
 * @module core
 * @version 1.0.0
 */

// WASM Layer (excluding WorkerMessage to avoid conflict)
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
  loadWasmModule,
  preloadWasmModule,
  validateWasmExports,
  createFallbackModule,
  type WasmCompressionCore,
  type LoadOptions,
  MemoryPool,
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
  createWorkerPool,
  sendWorkerMessage,
  getNextWorker,
  terminateWorkerPool,
  type WorkerPool,
  type WorkerResponse as WasmWorkerResponse,
} from './wasm';

// Pipeline Layer (renamed to avoid conflicts)
export {
  PipelineCoordinator,
  type CompressionJob as CoreCompressionJob,
  type CompressionOptions as CoreCompressionOptions,
  type EncryptionOptions,
  type JobProgress as CoreJobProgress,
  type JobState as CoreJobState,
  type JobStage,
  type DecompressionJob,
  type DecompressionOptions as CoreDecompressionOptions,
  type CoordinatorConfig as CoreCoordinatorConfig,
  type WorkerMessage as CoreWorkerMessage,
  type Checkpoint,
} from './pipeline/coordinator';

export {
  ChunkScheduler,
  type Chunk as CoreChunk,
  type ChunkState as CoreChunkState,
  type SchedulerConfig,
  type WorkerLoad,
  type SchedulerStats,
} from './pipeline/scheduler';

export {
  ChunkReader,
  type ReadConfig,
  type FileManifest,
  type FileEntry as CoreFileEntry,
  type ChunkMetadata as CoreChunkMetadata,
  type ArchiveMetadata as CoreArchiveMetadata,
  type ReadProgress,
} from './pipeline/chunkReader';

export {
  ArchiveWriter as CoreArchiveWriter,
  type WriterConfig,
  type WriteOptions,
  type WriteProgress,
} from './pipeline/writer';

export {
  IntegrityChecker,
  CRC32,
  XXHash,
  type IntegrityResult,
  type IntegrityError,
  type ChecksumAlgorithm,
} from './pipeline/integrity';

// Runtime Layer
export * from './runtime/types';
export * from './runtime/error';
export * from './runtime/events';

// Module versions
export const CORE_VERSION = '1.0.0';
export const IMPLEMENTATION_BLUEPRINT_VERSION = '1.0.0';
