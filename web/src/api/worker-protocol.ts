/**
 * SPK V44 - Worker Protocol Definitions
 * Structured contracts for worker communication
 */

import type { 
  JobId, 
  ChunkId, 
  FileId,
  CompressionOptions,
  CompressionProgress,
  DecompressionProgress,
  ApiError,
  RecoveryInstruction,
} from './types';

// ============================================================================
// Worker Message Types
// ============================================================================

/**
 * All worker message types
 */
export type WorkerMessageType =
  // Lifecycle
  | 'INIT'
  | 'READY'
  | 'SHUTDOWN'
  | 'SHUTDOWN_ACK'
  // Compression
  | 'START_COMPRESSION'
  | 'COMPRESS_CHUNK'
  | 'CHUNK_COMPRESSED'
  | 'COMPRESSION_COMPLETE'
  // Decompression
  | 'START_DECOMPRESSION'
  | 'DECOMPRESS_CHUNK'
  | 'CHUNK_DECOMPRESSED'
  | 'DECOMPRESSION_COMPLETE'
  // Progress
  | 'PROGRESS_UPDATE'
  | 'TELEMETRY'
  // Control
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'CANCELLED'
  // Recovery
  | 'RETRY_CHUNK'
  | 'RECOVER_STATE'
  | 'SAFE_MODE'
  // Error
  | 'ERROR'
  | 'FATAL_ERROR';

/**
 * Base worker message structure
 */
export interface WorkerMessage<T extends WorkerMessageType = WorkerMessageType> {
  type: T;
  id: string; // Message correlation ID
  timestamp: number;
  payload: WorkerPayloadMap[T];
}

/**
 * Payload type mapping for each message type
 */
export interface WorkerPayloadMap {
  // Lifecycle
  INIT: InitPayload;
  READY: ReadyPayload;
  SHUTDOWN: ShutdownPayload;
  SHUTDOWN_ACK: ShutdownAckPayload;
  
  // Compression
  START_COMPRESSION: StartCompressionPayload;
  COMPRESS_CHUNK: CompressChunkPayload;
  CHUNK_COMPRESSED: ChunkCompressedPayload;
  COMPRESSION_COMPLETE: CompressionCompletePayload;
  
  // Decompression
  START_DECOMPRESSION: StartDecompressionPayload;
  DECOMPRESS_CHUNK: DecompressChunkPayload;
  CHUNK_DECOMPRESSED: ChunkDecompressedPayload;
  DECOMPRESSION_COMPLETE: DecompressionCompletePayload;
  
  // Progress
  PROGRESS_UPDATE: ProgressUpdatePayload;
  TELEMETRY: TelemetryPayload;
  
  // Control
  PAUSE: PausePayload;
  RESUME: ResumePayload;
  CANCEL: CancelPayload;
  CANCELLED: CancelledPayload;
  
  // Recovery
  RETRY_CHUNK: RetryChunkPayload;
  RECOVER_STATE: RecoverStatePayload;
  SAFE_MODE: SafeModePayload;
  
  // Error
  ERROR: ErrorPayload;
  FATAL_ERROR: FatalErrorPayload;
}

// ============================================================================
// Lifecycle Payloads
// ============================================================================

export interface InitPayload {
  workerId: number;
  wasmUrl: string;
  sharedMemory?: SharedArrayBuffer;
  config: {
    maxMemoryMB: number;
    chunkSize: number;
    enableDebug: boolean;
  };
}

export interface ReadyPayload {
  workerId: number;
  wasmVersion: string;
  capabilities: {
    supportsSimd: boolean;
    supportsThreads: boolean;
    maxMemory: number;
  };
}

export interface ShutdownPayload {
  reason: 'user' | 'error' | 'idle';
}

export interface ShutdownAckPayload {
  workerId: number;
  cleanedUp: boolean;
}

// ============================================================================
// Compression Payloads
// ============================================================================

export interface StartCompressionPayload {
  jobId: JobId;
  options: CompressionOptions;
  totalChunks: number;
  totalBytes: number;
}

export interface CompressChunkPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  data: Uint8Array | SharedArrayBuffer;
  offset?: number;
  length?: number;
  isLast: boolean;
  fileInfo?: {
    fileId: FileId;
    fileName: string;
    fileOffset: number;
  };
}

export interface ChunkCompressedPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  compressedData: Uint8Array;
  originalSize: number;
  compressedSize: number;
  checksum: string;
  compressionRatio: number;
  processingTimeMs: number;
}

export interface CompressionCompletePayload {
  jobId: JobId;
  totalOriginalSize: number;
  totalCompressedSize: number;
  chunksProcessed: number;
  overallRatio: number;
  totalTimeMs: number;
  throughput: number;
}

// ============================================================================
// Decompression Payloads
// ============================================================================

export interface StartDecompressionPayload {
  jobId: JobId;
  archiveHeader: Uint8Array;
  encryptedManifest?: boolean;
  password?: string;
}

export interface DecompressChunkPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  data: Uint8Array | SharedArrayBuffer;
  offset?: number;
  length?: number;
  expectedChecksum: string;
}

export interface ChunkDecompressedPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  decompressedData: Uint8Array;
  originalSize: number;
  decompressedSize: number;
  checksumValid: boolean;
  processingTimeMs: number;
}

export interface DecompressionCompletePayload {
  jobId: JobId;
  totalDecompressedSize: number;
  chunksProcessed: number;
  integrityVerified: boolean;
  totalTimeMs: number;
  throughput: number;
}

// ============================================================================
// Progress Payloads
// ============================================================================

export interface ProgressUpdatePayload {
  jobId: JobId;
  type: 'compression' | 'decompression';
  progress: CompressionProgress | DecompressionProgress;
}

export interface TelemetryPayload {
  jobId: JobId;
  metrics: {
    currentSpeed: number;
    averageSpeed: number;
    peakSpeed: number;
    memoryUsed: number;
    memoryPeak: number;
    cpuUtilization: number;
    queueDepth: number;
    activeWorkers: number;
  };
}

// ============================================================================
// Control Payloads
// ============================================================================

export interface PausePayload {
  jobId: JobId;
  saveState: boolean;
}

export interface ResumePayload {
  jobId: JobId;
  fromState?: Uint8Array;
}

export interface CancelPayload {
  jobId: JobId;
  reason: 'user' | 'error' | 'timeout';
}

export interface CancelledPayload {
  jobId: JobId;
  chunksCompleted: number;
  bytesProcessed: number;
  canResume: boolean;
  savedState?: Uint8Array;
}

// ============================================================================
// Recovery Payloads
// ============================================================================

export interface RetryChunkPayload {
  jobId: JobId;
  chunkId: ChunkId;
  retryCount: number;
  modifiedOptions?: Partial<CompressionOptions>;
}

export interface RecoverStatePayload {
  jobId: JobId;
  savedState: Uint8Array;
  resumeFromChunk: number;
}

export interface SafeModePayload {
  enable: boolean;
  constraints: {
    maxChunkSize: number;
    maxMemory: number;
    singleWorker: boolean;
    disableSimd: boolean;
  };
}

// ============================================================================
// Error Payloads
// ============================================================================

export interface ErrorPayload {
  jobId?: JobId;
  chunkId?: ChunkId;
  error: ApiError;
  recoverable: boolean;
  recovery?: RecoveryInstruction;
}

export interface FatalErrorPayload {
  workerId: number;
  error: ApiError;
  workerState: 'crashed' | 'oom' | 'timeout' | 'corrupted';
  lastKnownGoodState?: {
    jobId: JobId;
    chunkIndex: number;
    bytesProcessed: number;
  };
}

// ============================================================================
// Worker Protocol Utilities
// ============================================================================

/**
 * Create a typed worker message
 */
export function createWorkerMessage<T extends WorkerMessageType>(
  type: T,
  payload: WorkerPayloadMap[T],
  correlationId?: string
): WorkerMessage<T> {
  return {
    type,
    id: correlationId || generateMessageId(),
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Type guard for worker messages
 */
export function isWorkerMessage(obj: unknown): obj is WorkerMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    'id' in obj &&
    'timestamp' in obj &&
    'payload' in obj
  );
}

/**
 * Type guard for specific message types
 */
export function isMessageType<T extends WorkerMessageType>(
  msg: WorkerMessage,
  type: T
): msg is WorkerMessage<T> {
  return msg.type === type;
}

/**
 * Transferable objects extractor for postMessage
 */
export function getTransferables(payload: unknown): Transferable[] {
  const transferables: Transferable[] = [];
  
  if (payload instanceof ArrayBuffer) {
    transferables.push(payload);
  } else if (ArrayBuffer.isView(payload)) {
    transferables.push(payload.buffer);
  } else if (typeof payload === 'object' && payload !== null) {
    for (const value of Object.values(payload)) {
      if (value instanceof ArrayBuffer) {
        transferables.push(value);
      } else if (ArrayBuffer.isView(value)) {
        transferables.push(value.buffer);
      }
    }
  }
  
  return transferables;
}
