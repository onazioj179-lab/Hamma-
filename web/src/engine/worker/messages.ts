/**
 * SPK V25 - Worker Message Types
 * Type-safe message protocol between main thread and worker
 */

import type { CompressionMode, CompressionSettings } from '../wasm/types';

/**
 * Unique job identifier
 */
export type JobId = string;

/**
 * Generate unique job ID
 */
export function generateJobId(): JobId {
  return `spk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// UI → Worker Messages
// ============================================================================

export interface StartCompressionMessage {
  type: 'START_COMPRESSION';
  jobId: JobId;
  file: File;
  settings: CompressionSettings;
}

export interface StartDecompressionMessage {
  type: 'START_DECOMPRESSION';
  jobId: JobId;
  file: File;
}

export interface CancelJobMessage {
  type: 'CANCEL_JOB';
  jobId: JobId;
}

export interface SetChunkSizeMessage {
  type: 'SET_CHUNK_SIZE';
  chunkSize: number;
}

export interface SetModeMessage {
  type: 'SET_MODE';
  mode: CompressionMode;
}

export interface InitWasmMessage {
  type: 'INIT_WASM';
}

export type WorkerIncomingMessage =
  | StartCompressionMessage
  | StartDecompressionMessage
  | CancelJobMessage
  | SetChunkSizeMessage
  | SetModeMessage
  | InitWasmMessage;

// ============================================================================
// Worker → UI Messages
// ============================================================================

export interface ProgressMessage {
  type: 'PROGRESS';
  jobId: JobId;
  chunkIndex: number;
  totalChunks: number;
  bytesProcessed: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
  compressionRatio: number;
}

export interface CompleteMessage {
  type: 'COMPLETE';
  jobId: JobId;
  outputBlob: Blob;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  totalTime: number; // milliseconds
  averageSpeed: number; // bytes per second
}

export interface ErrorMessage {
  type: 'ERROR';
  jobId: JobId;
  message: string;
  code: string;
  recoverable: boolean;
}

export interface WasmReadyMessage {
  type: 'WASM_READY';
  capabilities: {
    hasSharedArrayBuffer: boolean;
    hasRealWasm: boolean;
    maxMemory: number;
  };
}

export interface CancelledMessage {
  type: 'CANCELLED';
  jobId: JobId;
  bytesProcessed: number;
}

export interface ChunkCompleteMessage {
  type: 'CHUNK_COMPLETE';
  jobId: JobId;
  chunkIndex: number;
  originalSize: number;
  compressedSize: number;
  processingTimeMs: number;
}

export type WorkerOutgoingMessage =
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage
  | WasmReadyMessage
  | CancelledMessage
  | ChunkCompleteMessage;

// ============================================================================
// Typed message handlers
// ============================================================================

export type MessageHandler<T extends WorkerOutgoingMessage['type']> = (
  message: Extract<WorkerOutgoingMessage, { type: T }>
) => void;

export interface WorkerMessageHandlers {
  onProgress?: MessageHandler<'PROGRESS'>;
  onComplete?: MessageHandler<'COMPLETE'>;
  onError?: MessageHandler<'ERROR'>;
  onWasmReady?: MessageHandler<'WASM_READY'>;
  onCancelled?: MessageHandler<'CANCELLED'>;
  onChunkComplete?: MessageHandler<'CHUNK_COMPLETE'>;
}

/**
 * Create typed message sender for worker
 */
export function createWorkerMessageSender(
  postMessage: (message: WorkerOutgoingMessage, transfer?: Transferable[]) => void
) {
  return {
    sendProgress(data: Omit<ProgressMessage, 'type'>) {
      postMessage({ type: 'PROGRESS', ...data });
    },
    sendComplete(data: Omit<CompleteMessage, 'type'>) {
      postMessage({ type: 'COMPLETE', ...data });
    },
    sendError(data: Omit<ErrorMessage, 'type'>) {
      postMessage({ type: 'ERROR', ...data });
    },
    sendWasmReady(data: Omit<WasmReadyMessage, 'type'>) {
      postMessage({ type: 'WASM_READY', ...data });
    },
    sendCancelled(data: Omit<CancelledMessage, 'type'>) {
      postMessage({ type: 'CANCELLED', ...data });
    },
    sendChunkComplete(data: Omit<ChunkCompleteMessage, 'type'>) {
      postMessage({ type: 'CHUNK_COMPLETE', ...data });
    },
  };
}
