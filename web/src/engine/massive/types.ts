/**
 * SPK Hard Constraint Engine - Type Definitions
 * Creator: OJ Treasure Onazi
 * 
 * Types for massive job handling up to:
 * - 10TB total input
 * - 5,000 files
 * - 100KB to multi-TB file sizes
 */

// ============================================================================
// SIZE CONSTANTS
// ============================================================================

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;
export const TB = 1024 * GB;

// ============================================================================
// HARD LIMITS
// ============================================================================

export const HARD_LIMITS = {
  /** Maximum total input size: 10TB */
  MAX_TOTAL_INPUT_SIZE: 10 * TB,
  
  /** Minimum file size: 100KB */
  MIN_FILE_SIZE: 100 * KB,
  
  /** Maximum file count */
  MAX_FILE_COUNT: 5000,
  
  /** Maximum safe offset (2^53 - 1 for JS number safety, use BigInt beyond) */
  MAX_SAFE_OFFSET: BigInt(Number.MAX_SAFE_INTEGER),
  
  /** Maximum 64-bit offset */
  MAX_64BIT_OFFSET: BigInt('18446744073709551615'),
  
  /** Partition size range */
  MIN_PARTITION_SIZE: 500 * MB,
  MAX_PARTITION_SIZE: 2 * GB,
  
  /** Memory thresholds */
  MEMORY_SOFT_LIMIT: 400 * MB,
  MEMORY_HARD_LIMIT: 600 * MB,
  MEMORY_CRITICAL_LIMIT: 800 * MB,
  
  /** Chunk size bounds for massive mode */
  MASSIVE_MIN_CHUNK: 128 * KB,
  MASSIVE_MAX_CHUNK: 4 * MB,
  MASSIVE_DEFAULT_CHUNK: 1 * MB,
  
  /** Worker limits */
  MAX_WORKERS_MASSIVE: 8,
  MIN_WORKERS_MASSIVE: 2,
  
  /** Checkpoint interval (bytes processed) */
  CHECKPOINT_INTERVAL: 100 * MB,
  
  /** Batch flush threshold */
  BATCH_FLUSH_THRESHOLD: 50 * MB,
} as const;

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export type ValidationErrorCode = 
  | 'TOTAL_SIZE_EXCEEDED'
  | 'FILE_COUNT_EXCEEDED'
  | 'FILE_TOO_SMALL'
  | 'FILE_INVALID'
  | 'OFFSET_OVERFLOW'
  | 'MEMORY_EXCEEDED'
  | 'PARTITION_FAILED'
  | 'CHECKPOINT_FAILED'
  | 'STATE_CORRUPTED';

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  details?: {
    limit?: number | bigint;
    actual?: number | bigint;
    file?: string;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  stats: {
    totalSize: number;
    fileCount: number;
    avgFileSize: number;
    minFileSize: number;
    maxFileSize: number;
    estimatedPartitions: number;
    estimatedDuration: number;
  };
}

// ============================================================================
// FILE ENTRY TYPES
// ============================================================================

export interface MassiveFileEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
  file: File;
  
  /** Compression profile for this file type */
  compressionProfile: CompressionProfile;
  
  /** Processing state */
  state: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  
  /** Partition assignment */
  partitionId?: string;
  
  /** Chunk tracking */
  chunksTotal?: number;
  chunksProcessed?: number;
  
  /** Compression stats */
  compressedSize?: number;
  compressionRatio?: number;
  
  /** Error if failed */
  error?: string;
}

// ============================================================================
// PARTITION TYPES
// ============================================================================

export interface Partition {
  id: string;
  index: number;
  files: MassiveFileEntry[];
  totalSize: number;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  
  /** Processing progress */
  bytesProcessed: number;
  chunksProcessed: number;
  chunksTotal: number;
  
  /** Timing */
  startTime?: number;
  endTime?: number;
  
  /** Output */
  compressedSize: number;
  startOffset: bigint;
  endOffset: bigint;
  
  /** Checkpoint */
  checkpointId?: string;
  lastCheckpoint?: number;
}

export interface PartitionPlan {
  partitions: Partition[];
  totalPartitions: number;
  totalSize: number;
  totalFiles: number;
  estimatedDuration: number;
  strategy: 'size-balanced' | 'file-balanced' | 'adaptive';
}

// ============================================================================
// CHECKPOINT TYPES
// ============================================================================

export interface Checkpoint {
  id: string;
  jobId: string;
  timestamp: number;
  version: number;
  
  /** Job state */
  currentPartitionIndex: number;
  currentChunkIndex: number;
  totalPartitions: number;
  
  /** Progress */
  bytesProcessed: bigint;
  bytesTotal: bigint;
  filesProcessed: number;
  filesTotal: number;
  
  /** Archive state */
  archiveOffset: bigint;
  metadataTable: ChunkMetadataEntry[];
  offsetTable: OffsetEntry[];
  
  /** AI state */
  aiFingerprint?: string;
  optimizerState?: OptimizerState;
  
  /** History */
  historyId: string;
  
  /** Integrity */
  checksum: string;
}

export interface ChunkMetadataEntry {
  chunkIndex: number;
  fileId: string;
  offset: bigint;
  compressedSize: number;
  originalSize: number;
  checksum: number;
}

export interface OffsetEntry {
  index: number;
  offset: bigint;
  length: bigint;
  originalLength: bigint;
  fileId: string;
}

export interface OptimizerState {
  mode: 'balanced' | 'speed' | 'memory' | 'massive';
  chunkSize: number;
  concurrency: number;
  memoryPressure: 'low' | 'medium' | 'high' | 'critical';
  throughputHistory: number[];
  stallCount: number;
}

// ============================================================================
// MEMORY TRACKING TYPES
// ============================================================================

export interface MemorySnapshot {
  timestamp: number;
  
  /** JS Heap */
  jsHeapUsed: number;
  jsHeapTotal: number;
  jsHeapLimit: number;
  
  /** WASM */
  wasmPages: number;
  wasmBytesUsed: number;
  
  /** Buffer pools */
  bufferPoolUsed: number;
  bufferPoolTotal: number;
  
  /** Workers */
  workerMemoryEstimate: number;
  
  /** Total */
  totalEstimate: number;
  pressure: 'low' | 'medium' | 'high' | 'critical';
}

export interface MemoryBudget {
  totalBudget: number;
  wasmBudget: number;
  workerBudget: number;
  bufferBudget: number;
  jsBudget: number;
  
  /** Current usage */
  current: MemorySnapshot;
  
  /** Recommendations */
  recommendedChunkSize: number;
  recommendedConcurrency: number;
  shouldFlush: boolean;
  shouldReduceChunks: boolean;
}

// ============================================================================
// JOB TYPES
// ============================================================================

export type MassiveJobState = 
  | 'idle'
  | 'validating'
  | 'partitioning'
  | 'processing'
  | 'checkpointing'
  | 'recovering'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MassiveJob {
  id: string;
  state: MassiveJobState;
  
  /** Input */
  files: MassiveFileEntry[];
  totalSize: number;
  totalFiles: number;
  
  /** Partitioning */
  partitionPlan?: PartitionPlan;
  currentPartitionIndex: number;
  
  /** Progress */
  bytesProcessed: bigint;
  chunksProcessed: number;
  chunksTotal: number;
  filesProcessed: number;
  
  /** Output */
  compressedSize: bigint;
  compressionRatio: number;
  
  /** Timing */
  startTime: number;
  endTime?: number;
  estimatedEndTime?: number;
  
  /** Performance */
  throughputBps: number;
  peakThroughput: number;
  avgThroughput: number;
  
  /** Checkpointing */
  lastCheckpoint?: Checkpoint;
  checkpointCount: number;
  
  /** Error */
  error?: string;
  
  /** History */
  historyId: string;
}

// ============================================================================
// COMPRESSION PROFILE TYPES
// ============================================================================

export type CompressionProfile = 
  | 'text'
  | 'binary'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'log'
  | 'csv'
  | 'json'
  | 'generic';

export interface FileTypeProfile {
  profile: CompressionProfile;
  expectedRatio: number;
  preferredChunkSize: number;
  optimalChunk: number;
  multiPassEnabled: boolean;
  entropyThreshold: number;
}

export const FILE_TYPE_PROFILES: Record<CompressionProfile, FileTypeProfile> = {
  text: {
    profile: 'text',
    expectedRatio: 0.25,
    preferredChunkSize: 2 * MB,
    optimalChunk: 2 * MB,
    multiPassEnabled: true,
    entropyThreshold: 0.3,
  },
  binary: {
    profile: 'binary',
    expectedRatio: 0.7,
    preferredChunkSize: 1 * MB,
    optimalChunk: 1 * MB,
    multiPassEnabled: false,
    entropyThreshold: 0.8,
  },
  image: {
    profile: 'image',
    expectedRatio: 0.85,
    preferredChunkSize: 512 * KB,
    optimalChunk: 512 * KB,
    multiPassEnabled: false,
    entropyThreshold: 0.9,
  },
  video: {
    profile: 'video',
    expectedRatio: 0.95,
    preferredChunkSize: 4 * MB,
    optimalChunk: 4 * MB,
    multiPassEnabled: false,
    entropyThreshold: 0.95,
  },
  audio: {
    profile: 'audio',
    expectedRatio: 0.9,
    preferredChunkSize: 1 * MB,
    optimalChunk: 1 * MB,
    multiPassEnabled: false,
    entropyThreshold: 0.85,
  },
  archive: {
    profile: 'archive',
    expectedRatio: 0.98,
    preferredChunkSize: 1 * MB,
    optimalChunk: 1 * MB,
    multiPassEnabled: false,
    entropyThreshold: 0.99,
  },
  log: {
    profile: 'log',
    expectedRatio: 0.15,
    preferredChunkSize: 2 * MB,
    optimalChunk: 2 * MB,
    multiPassEnabled: true,
    entropyThreshold: 0.2,
  },
  csv: {
    profile: 'csv',
    expectedRatio: 0.2,
    preferredChunkSize: 2 * MB,
    optimalChunk: 2 * MB,
    multiPassEnabled: true,
    entropyThreshold: 0.25,
  },
  json: {
    profile: 'json',
    expectedRatio: 0.3,
    preferredChunkSize: 1 * MB,
    optimalChunk: 1 * MB,
    multiPassEnabled: true,
    entropyThreshold: 0.35,
  },
  generic: {
    profile: 'generic',
    expectedRatio: 0.5,
    preferredChunkSize: 1 * MB,
    optimalChunk: 1 * MB,
    multiPassEnabled: false,
    entropyThreshold: 0.6,
  },
};

// ============================================================================
// EVENT TYPES
// ============================================================================

export type MassiveJobEvent =
  | { type: 'validation-start' }
  | { type: 'validation-complete'; result: ValidationResult }
  | { type: 'partition-start'; totalPartitions: number }
  | { type: 'partition-progress'; partitionIndex: number; totalPartitions: number }
  | { type: 'partition-complete'; partition: Partition }
  | { type: 'processing-start'; partition: Partition }
  | { type: 'chunk-progress'; chunkIndex: number; totalChunks: number; bytesProcessed: bigint }
  | { type: 'file-complete'; file: MassiveFileEntry }
  | { type: 'checkpoint-saved'; checkpoint: Checkpoint }
  | { type: 'checkpoint-restored'; checkpoint: Checkpoint }
  | { type: 'memory-pressure'; snapshot: MemorySnapshot }
  | { type: 'memory-recovery'; action: string }
  | { type: 'throughput-update'; bps: number; eta: number }
  | { type: 'job-complete'; job: MassiveJob }
  | { type: 'job-failed'; error: string }
  | { type: 'job-cancelled' };

export type MassiveJobEventHandler = (event: MassiveJobEvent) => void;

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface MassiveJobConfig {
  /** Memory budget in bytes */
  memoryBudget: number;
  
  /** Target partition size */
  partitionSize: number;
  
  /** Initial chunk size */
  chunkSize: number;
  
  /** Worker count */
  workerCount: number;
  
  /** Enable AI optimization */
  aiOptimization: boolean;
  
  /** Enable checkpointing */
  checkpointEnabled: boolean;
  
  /** Checkpoint interval in bytes */
  checkpointInterval: number;
  
  /** Enable multi-pass compression for suitable files */
  multiPassEnabled: boolean;
  
  /** Compression level (1-9) */
  compressionLevel: number;
  
  /** Verify integrity after each partition */
  verifyPartitions: boolean;
  
  /** Storage key prefix for IndexedDB */
  storagePrefix: string;
}

export const DEFAULT_MASSIVE_CONFIG: MassiveJobConfig = {
  memoryBudget: HARD_LIMITS.MEMORY_SOFT_LIMIT,
  partitionSize: 1 * GB,
  chunkSize: HARD_LIMITS.MASSIVE_DEFAULT_CHUNK,
  workerCount: Math.min(navigator.hardwareConcurrency || 4, HARD_LIMITS.MAX_WORKERS_MASSIVE),
  aiOptimization: true,
  checkpointEnabled: true,
  checkpointInterval: HARD_LIMITS.CHECKPOINT_INTERVAL,
  multiPassEnabled: true,
  compressionLevel: 6,
  verifyPartitions: true,
  storagePrefix: 'spk_massive_',
};
