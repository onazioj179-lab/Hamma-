/**
 * SPK V45 - Worker Message Interfaces
 * Type-safe communication between coordinator and workers
 */

import type { ProgressEvent } from './progress-types';

// ============================================================================
// PART 3 — WORKER MESSAGE INTERFACES
// ============================================================================

/**
 * Worker → Coordinator messages
 */
export type WorkerMessage =
  | WorkerWasmReadyMessage
  | WorkerChunkProcessedMessage
  | WorkerProgressMessage
  | WorkerFlushCompleteMessage
  | WorkerFinalizeCompleteMessage
  | WorkerErrorMessage
  | WorkerStatusMessage
  | WorkerMemoryWarningMessage;

/**
 * WASM module ready
 */
export type WorkerWasmReadyMessage = {
  type: 'wasm-ready';
  /** Worker ID */
  workerId: string;
  /** WASM module version */
  wasmVersion: string;
  /** Available memory in bytes */
  availableMemory: number;
  /** SIMD support */
  simdSupported: boolean;
  /** Multi-threading support */
  threadsSupported: boolean;
};

/**
 * Chunk processed successfully
 */
export type WorkerChunkProcessedMessage = {
  type: 'chunk-processed';
  /** Chunk index */
  index: number;
  /** Compressed chunk data */
  buffer: ArrayBuffer;
  /** Original size */
  originalSize: number;
  /** Compressed size */
  compressedSize: number;
  /** Processing time in ms */
  processingTimeMs: number;
  /** SHA-256 hash of compressed data */
  hash: string;
};

/**
 * Progress update
 */
export type WorkerProgressMessage = {
  type: 'progress';
  /** Progress event data */
  progress: ProgressEvent;
};

/**
 * Flush complete
 */
export type WorkerFlushCompleteMessage = {
  type: 'flush-complete';
  /** Flushed buffer data */
  buffer: ArrayBuffer;
  /** Bytes flushed */
  bytesFlushed: number;
};

/**
 * Finalization complete
 */
export type WorkerFinalizeCompleteMessage = {
  type: 'finalize-complete';
  /** Archive footer */
  footer: ArrayBuffer;
  /** Chunk table */
  table: ArrayBuffer;
  /** Total archive size */
  totalSize: number;
  /** Checksum */
  checksum: string;
};

/**
 * Error occurred
 */
export type WorkerErrorMessage = {
  type: 'error';
  /** Error message */
  message: string;
  /** Error code */
  code: WorkerErrorCode;
  /** Whether error is recoverable */
  recoverable: boolean;
  /** Stack trace (if available) */
  stack?: string;
  /** Related chunk index (if applicable) */
  chunkIndex?: number;
};

/**
 * Worker status update
 */
export type WorkerStatusMessage = {
  type: 'status';
  /** Worker ID */
  workerId: string;
  /** Current state */
  state: WorkerMessageState;
  /** Queue depth */
  queueDepth: number;
  /** Memory usage */
  memoryUsage: number;
};

/**
 * Memory warning
 */
export type WorkerMemoryWarningMessage = {
  type: 'memory-warning';
  /** Current memory usage */
  usedMemory: number;
  /** Memory limit */
  memoryLimit: number;
  /** Recommended action */
  recommendation: 'reduce-chunk-size' | 'reduce-parallelism' | 'clear-cache';
};

// ============================================================================
// Coordinator → Worker messages
// ============================================================================

/**
 * Coordinator → Worker messages
 */
export type CoordinatorMessage =
  | CoordinatorInitWasmMessage
  | CoordinatorProcessChunkMessage
  | CoordinatorFlushMessage
  | CoordinatorFinalizeMessage
  | CoordinatorCancelMessage
  | CoordinatorResetMessage
  | CoordinatorConfigureMessage;

/**
 * Initialize WASM module
 */
export type CoordinatorInitWasmMessage = {
  type: 'init-wasm';
  /** Worker ID assignment */
  workerId: string;
  /** WASM module URL or bytes */
  wasmSource?: string | ArrayBuffer;
  /** Compression level (1-22) */
  compressionLevel?: number;
  /** Memory limit in bytes */
  memoryLimit?: number;
};

/**
 * Process a chunk
 */
export type CoordinatorProcessChunkMessage = {
  type: 'process-chunk';
  /** Chunk index */
  index: number;
  /** Raw chunk data */
  buffer: ArrayBuffer;
  /** File ID this chunk belongs to */
  fileId: string;
  /** Whether this is the last chunk of the file */
  isLastChunk: boolean;
};

/**
 * Flush internal buffers
 */
export type CoordinatorFlushMessage = {
  type: 'flush';
};

/**
 * Finalize archive
 */
export type CoordinatorFinalizeMessage = {
  type: 'finalize';
  /** Manifest data */
  manifest?: ArrayBuffer;
};

/**
 * Cancel current operation
 */
export type CoordinatorCancelMessage = {
  type: 'cancel';
  /** Reason for cancellation */
  reason?: string;
};

/**
 * Reset worker state
 */
export type CoordinatorResetMessage = {
  type: 'reset';
};

/**
 * Configure worker
 */
export type CoordinatorConfigureMessage = {
  type: 'configure';
  /** New compression level */
  compressionLevel?: number;
  /** New chunk size */
  chunkSize?: number;
  /** Enable/disable dedup */
  dedup?: boolean;
};

// ============================================================================
// Message Types and Utilities
// ============================================================================

/**
 * Worker error codes
 */
export type WorkerErrorCode =
  | 'wasm-init-failed'
  | 'wasm-runtime-error'
  | 'out-of-memory'
  | 'invalid-input'
  | 'compression-failed'
  | 'decompression-failed'
  | 'integrity-check-failed'
  | 'cancelled'
  | 'timeout'
  | 'unknown';

/**
 * Worker message state
 */
export type WorkerMessageState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'flushing'
  | 'finalizing'
  | 'error';

/**
 * Type guards for worker messages
 */
export const WorkerMessageGuards = {
  isWasmReady: (msg: WorkerMessage): msg is WorkerWasmReadyMessage =>
    msg.type === 'wasm-ready',
  isChunkProcessed: (msg: WorkerMessage): msg is WorkerChunkProcessedMessage =>
    msg.type === 'chunk-processed',
  isProgress: (msg: WorkerMessage): msg is WorkerProgressMessage =>
    msg.type === 'progress',
  isFlushComplete: (msg: WorkerMessage): msg is WorkerFlushCompleteMessage =>
    msg.type === 'flush-complete',
  isFinalizeComplete: (msg: WorkerMessage): msg is WorkerFinalizeCompleteMessage =>
    msg.type === 'finalize-complete',
  isError: (msg: WorkerMessage): msg is WorkerErrorMessage =>
    msg.type === 'error',
  isStatus: (msg: WorkerMessage): msg is WorkerStatusMessage =>
    msg.type === 'status',
  isMemoryWarning: (msg: WorkerMessage): msg is WorkerMemoryWarningMessage =>
    msg.type === 'memory-warning',
};

/**
 * Type guards for coordinator messages
 */
export const CoordinatorMessageGuards = {
  isInitWasm: (msg: CoordinatorMessage): msg is CoordinatorInitWasmMessage =>
    msg.type === 'init-wasm',
  isProcessChunk: (msg: CoordinatorMessage): msg is CoordinatorProcessChunkMessage =>
    msg.type === 'process-chunk',
  isFlush: (msg: CoordinatorMessage): msg is CoordinatorFlushMessage =>
    msg.type === 'flush',
  isFinalize: (msg: CoordinatorMessage): msg is CoordinatorFinalizeMessage =>
    msg.type === 'finalize',
  isCancel: (msg: CoordinatorMessage): msg is CoordinatorCancelMessage =>
    msg.type === 'cancel',
  isReset: (msg: CoordinatorMessage): msg is CoordinatorResetMessage =>
    msg.type === 'reset',
  isConfigure: (msg: CoordinatorMessage): msg is CoordinatorConfigureMessage =>
    msg.type === 'configure',
};

/**
 * Create worker error message
 */
export function createWorkerError(
  message: string,
  code: WorkerErrorCode = 'unknown',
  recoverable = false,
  chunkIndex?: number
): WorkerErrorMessage {
  return {
    type: 'error',
    message,
    code,
    recoverable,
    chunkIndex,
  };
}

/**
 * All worker message types
 */
export const WORKER_MESSAGE_TYPES = [
  'wasm-ready',
  'chunk-processed',
  'progress',
  'flush-complete',
  'finalize-complete',
  'error',
  'status',
  'memory-warning',
] as const;

/**
 * All coordinator message types
 */
export const COORDINATOR_MESSAGE_TYPES = [
  'init-wasm',
  'process-chunk',
  'flush',
  'finalize',
  'cancel',
  'reset',
  'configure',
] as const;
