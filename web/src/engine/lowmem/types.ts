/**
 * SPK Hyper-Low-Memory Mode - Type Definitions
 * Creator: OJ Treasure Onazi
 * 
 * Types for ultra-low memory operation (1GB RAM or less)
 * Supports MB → TB workloads via partitioning and micro-chunking
 */

// ============================================================================
// SIZE CONSTANTS
// ============================================================================

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

// ============================================================================
// MEMORY BUDGET CONSTANTS (Section 1)
// ============================================================================

export const MEMORY_CONSTANTS = {
  /** Default target RAM: 1GB */
  DEFAULT_TARGET_RAM: 1 * GB,
  
  /** Safe margin reserved for system/UI: 150MB */
  SAFE_MARGIN: 150 * MB,
  
  /** Memory pressure threshold: 80% */
  PRESSURE_THRESHOLD: 0.80,
  
  /** Critical threshold: 90% */
  CRITICAL_THRESHOLD: 0.90,
  
  /** Emergency threshold: 95% */
  EMERGENCY_THRESHOLD: 0.95,
  
  /** Minimum operating budget: 100MB */
  MIN_BUDGET: 100 * MB,
  
  /** Maximum concurrent chunks in RAM */
  MAX_CONCURRENT_CHUNKS: 4,
  
  /** Maximum WASM temp buffer */
  MAX_WASM_BUFFER: 32 * MB,
  
  /** Maximum live metadata overhead */
  MAX_METADATA_OVERHEAD: 30 * MB,
  
  /** Maximum worker memory */
  MAX_WORKER_MEMORY: 200 * MB,
  
  /** Target worker memory */
  TARGET_WORKER_MEMORY: 150 * MB,
} as const;

// ============================================================================
// MICRO-CHUNK MODES (Section 2)
// ============================================================================

export type ChunkMode = 'nano' | 'micro' | 'small' | 'normal' | 'large';

export const CHUNK_SIZES: Record<ChunkMode, number> = {
  nano: 64 * KB,      // 64KB - extreme low memory
  micro: 128 * KB,    // 128KB - high memory pressure
  small: 256 * KB,    // 256KB - default for low-RAM
  normal: 1 * MB,     // 1MB - standard operation
  large: 4 * MB,      // 4MB - high memory available
};

export const CHUNK_MODE_ORDER: ChunkMode[] = ['nano', 'micro', 'small', 'normal', 'large'];

export interface ChunkModeTransition {
  from: ChunkMode;
  to: ChunkMode;
  reason: 'pressure_increase' | 'pressure_decrease' | 'stability' | 'emergency';
  timestamp: number;
}

// ============================================================================
// MEMORY STATE TYPES
// ============================================================================

export type MemoryPressureLevel = 'low' | 'medium' | 'high' | 'critical' | 'emergency';

export interface MemoryState {
  /** Current allocated bytes */
  allocated: number;
  
  /** Peak allocated bytes */
  peak: number;
  
  /** Available budget */
  available: number;
  
  /** Total budget */
  budget: number;
  
  /** Current pressure level */
  pressureLevel: MemoryPressureLevel;
  
  /** Usage percentage (0-1) */
  usagePercent: number;
  
  /** JS heap used */
  jsHeapUsed: number;
  
  /** WASM pages allocated */
  wasmPages: number;
  
  /** Timestamp */
  timestamp: number;
}

export interface AllocationRequest {
  id: string;
  bytes: number;
  purpose: 'chunk' | 'metadata' | 'wasm' | 'buffer' | 'worker';
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface AllocationResult {
  success: boolean;
  allocated: number;
  remainingBudget: number;
  pressureLevel: MemoryPressureLevel;
  recommendation?: 'reduce_chunk_size' | 'flush_buffers' | 'reduce_workers' | 'emergency_gc';
}

// ============================================================================
// BUFFER POOL TYPES (Section 3)
// ============================================================================

export interface PooledBuffer {
  data: Uint8Array;
  size: number;
  inUse: boolean;
  lastUsed: number;
  useCount: number;
}

export interface BufferPoolConfig {
  /** Maximum pool size in bytes */
  maxPoolSize: number;
  
  /** Buffer sizes to pre-allocate */
  bufferSizes: number[];
  
  /** Maximum buffers per size */
  maxBuffersPerSize: number;
  
  /** Idle timeout before buffer release (ms) */
  idleTimeout: number;
  
  /** Pre-allocate common sizes */
  preAllocate: boolean;
}

export const DEFAULT_BUFFER_POOL_CONFIG: BufferPoolConfig = {
  maxPoolSize: 50 * MB,
  bufferSizes: [64 * KB, 128 * KB, 256 * KB, 1 * MB],
  maxBuffersPerSize: 4,
  idleTimeout: 10000,
  preAllocate: true,
};

// ============================================================================
// STREAMING READER TYPES (Section 4)
// ============================================================================

export interface StreamingReaderConfig {
  /** Chunk size for reading */
  chunkSize: number;
  
  /** Maximum chunk size */
  maxChunkSize: number;
  
  /** Yield interval for UI responsiveness */
  yieldInterval: number;
  
  /** Enable prefetch (disabled for low-mem) */
  prefetchEnabled: boolean;
  
  /** Maximum concurrent reads */
  maxConcurrentReads: number;
  
  /** Read timeout (ms) */
  readTimeout: number;
}

export const DEFAULT_STREAMING_READER_CONFIG: StreamingReaderConfig = {
  chunkSize: 256 * KB,
  maxChunkSize: 4 * MB,
  yieldInterval: 10,
  prefetchEnabled: false,
  maxConcurrentReads: 1,
  readTimeout: 30000,
};

export interface StreamChunk {
  data: Uint8Array;
  offset: number;
  size: number;
  isLast: boolean;
  sequence: number;
}

export interface StreamProgress {
  fileId: string;
  bytesRead: number;
  totalBytes: number;
  chunksRead: number;
  estimatedChunks: number;
}

// ============================================================================
// WORKER PROFILE TYPES (Section 5)
// ============================================================================

export type WorkerProfileName = 'ultra_low' | 'low' | 'normal' | 'high';

export interface WorkerProfile {
  /** Maximum concurrent workers */
  workerCount: number;
  
  /** Memory limit per worker */
  memoryLimit: number;
  
  /** WASM memory pages (64KB each) */
  wasmPages: number;
  
  /** Progress event interval (ms) */
  progressInterval: number;
  
  /** Enable WASM warm-up per job */
  warmupPerJob: boolean;
}

export const WORKER_PROFILES: Record<WorkerProfileName, WorkerProfile> = {
  'ultra_low': {
    workerCount: 1,
    memoryLimit: 100 * MB,
    wasmPages: 16,        // 1MB WASM memory
    progressInterval: 500,
    warmupPerJob: false,
  },
  'low': {
    workerCount: 2,
    memoryLimit: 150 * MB,
    wasmPages: 32,        // 2MB WASM memory
    progressInterval: 250,
    warmupPerJob: false,
  },
  'normal': {
    workerCount: 4,
    memoryLimit: 200 * MB,
    wasmPages: 64,        // 4MB WASM memory
    progressInterval: 100,
    warmupPerJob: true,
  },
  'high': {
    workerCount: 8,
    memoryLimit: 400 * MB,
    wasmPages: 128,       // 8MB WASM memory
    progressInterval: 50,
    warmupPerJob: true,
  },
};

// ============================================================================
// ARCHIVE WRITER TYPES (Section 6)
// ============================================================================

export interface LowMemWriterConfig {
  /** Flush threshold in bytes */
  flushThreshold: number;
  
  /** Flush interval in ms */
  flushIntervalMs: number;
  
  /** Maximum metadata RAM */
  maxMetadataRAM: number;
  
  /** Use binary metadata format */
  binaryMetadata: boolean;
  
  /** Streaming mode */
  streamingMode: boolean;
  
  /** Incremental table updates */
  incrementalTables: boolean;
}

export const DEFAULT_LOW_MEM_WRITER_CONFIG: LowMemWriterConfig = {
  flushThreshold: 4 * MB,
  flushIntervalMs: 5000,
  maxMetadataRAM: 30 * MB,
  binaryMetadata: true,
  streamingMode: true,
  incrementalTables: true,
};

export interface WriterMetrics {
  bytesWritten: bigint;
  chunksWritten: number;
  filesWritten: number;
  flushCount: number;
  writeCount: number;
  avgWriteTime: number;
  peakMetadataRAM: number;
  headerSize: number;
  indexSize: number;
  footerSize: number;
}

// ============================================================================
// AI OPTIMIZER TYPES (Section 7)
// ============================================================================

export interface LowMemAIConfig {
  /** Enable shallow statistics only */
  shallowStats: boolean;
  
  /** Sample rate for statistics (0-1) */
  sampleRate: number;
  
  /** History window size */
  historyWindow: number;
  
  /** Enable predictive shrinking */
  predictiveShrink: boolean;
  
  /** Device baseline tracking */
  trackBaseline: boolean;
  
  /** Maximum cache size for decisions */
  maxCacheSize: number;
}

export const DEFAULT_LOW_MEM_AI_CONFIG: LowMemAIConfig = {
  shallowStats: true,
  sampleRate: 0.1,
  historyWindow: 20,
  predictiveShrink: true,
  trackBaseline: true,
  maxCacheSize: 100,
};

export interface AIRecommendation {
  chunkMode: ChunkMode;
  workerCount: number;
  algorithm: string;
  flushInterval: number;
}

// ============================================================================
// SAFETY LIMITS (Section 8)
// ============================================================================

export interface SafetyLimits {
  maxConcurrentChunks: number;
  maxWorkers: number;
  maxWasmBuffer: number;
  maxMetadataOverhead: number;
  instantFallbackEnabled: boolean;
  fallbackChunkMode: ChunkMode;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxConcurrentChunks: 4,
  maxWorkers: 2,
  maxWasmBuffer: 32 * MB,
  maxMetadataOverhead: 30 * MB,
  instantFallbackEnabled: true,
  fallbackChunkMode: 'nano',
};

// ============================================================================
// MAIN CONFIGURATION
// ============================================================================

export interface LowMemConfig {
  /** Target RAM budget */
  targetRAM: number;
  
  /** Safe margin */
  safeMargin: number;
  
  /** Initial chunk mode */
  initialChunkMode: ChunkMode;
  
  /** Worker profile */
  workerProfile: WorkerProfileName;
  
  /** Safety limits */
  safetyLimits: SafetyLimits;
  
  /** Buffer pool config */
  bufferPool: BufferPoolConfig;
  
  /** Writer config */
  writer: LowMemWriterConfig;
  
  /** AI config */
  ai: LowMemAIConfig;
  
  /** Enable strict mode (no exceptions to limits) */
  strictMode: boolean;
}

export const DEFAULT_LOWMEM_CONFIG: LowMemConfig = {
  targetRAM: MEMORY_CONSTANTS.DEFAULT_TARGET_RAM,
  safeMargin: MEMORY_CONSTANTS.SAFE_MARGIN,
  initialChunkMode: 'small',
  workerProfile: 'low',
  safetyLimits: DEFAULT_SAFETY_LIMITS,
  bufferPool: DEFAULT_BUFFER_POOL_CONFIG,
  writer: DEFAULT_LOW_MEM_WRITER_CONFIG,
  ai: DEFAULT_LOW_MEM_AI_CONFIG,
  strictMode: true,
};

// ============================================================================
// EVENT TYPES
// ============================================================================

export type LowMemEvent =
  | { type: 'memory-allocated'; bytes: number; purpose: string }
  | { type: 'memory-released'; bytes: number }
  | { type: 'pressure-change'; from: MemoryPressureLevel; to: MemoryPressureLevel }
  | { type: 'chunk-mode-change'; from: ChunkMode; to: ChunkMode; reason: string }
  | { type: 'buffer-pool-resize'; oldSize: number; newSize: number }
  | { type: 'emergency-gc'; savedBytes: number }
  | { type: 'flush-triggered'; bufferId: string; bytes: number }
  | { type: 'worker-reduced'; from: number; to: number }
  | { type: 'safety-limit-hit'; limit: string; value: number }
  // Buffer pool events
  | { type: 'buffer-acquired'; size: number; pooled: boolean }
  | { type: 'buffer-released'; size: number }
  | { type: 'pool-eviction'; evictedBytes: number }
  | { type: 'pool-shrink'; freedBytes: number }
  | { type: 'pool-clear'; totalBytes: number }
  // Streaming reader events
  | { type: 'stream-start'; totalBytes: number }
  | { type: 'stream-end'; totalBytesRead: number }
  | { type: 'stream-abort' }
  | { type: 'chunk-read'; size: number; offset: number }
  | { type: 'memory-wait-timeout' }
  // Writer events
  | { type: 'writer-initialized'; mode: string }
  | { type: 'writer-aborted' }
  | { type: 'chunk-written'; size: number }
  | { type: 'file-registered'; path: string }
  | { type: 'buffer-flushed'; blobSize: number }
  | { type: 'metadata-limit-warning'; currentSize: number; limit: number }
  | { type: 'archive-finalized'; size: number }
  // Worker events
  | { type: 'worker-pool-initialized'; workerCount: number }
  | { type: 'worker-pool-terminated' }
  | { type: 'worker-created'; workerId: string }
  | { type: 'worker-terminated'; workerId: string }
  | { type: 'worker-profile-change'; profile: string }
  | { type: 'task-queued'; taskId: string; queueLength: number }
  // AI optimizer events
  | { type: 'optimization-complete'; result: unknown }
  // Safety enforcer events
  | { type: 'safety-blocked'; resource: string; reason?: string }
  | { type: 'safety-violation'; violation: unknown }
  | { type: 'emergency-stop'; reason: string }
  | { type: 'emergency-reset' }
  | { type: 'emergency-reset-blocked'; reason: string }
  | { type: 'safe-mode-entered'; newLimits: SafetyLimits }
  | { type: 'safe-mode-exited' }
  | { type: 'profile-applied'; profile: string }
  | { type: 'limits-updated'; limits: SafetyLimits }
  // Chunk pipeline events
  | { type: 'chunk-failed'; chunkId: string; reason: string }
  | { type: 'concurrency-change'; maxConcurrent: number };

export type LowMemEventHandler = (event: LowMemEvent) => void;
