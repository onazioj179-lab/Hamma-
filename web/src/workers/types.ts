/**
 * SPK Workers - Type Definitions
 * 
 * Shared types for worker communication protocol.
 * Ensures type safety between workers and coordinator.
 * 
 * @module workers/types
 * @version 1.0.0
 */

// ============================================================================
// Worker Messages (Incoming)
// ============================================================================

export interface InitWasmMessage {
  type: 'init-wasm';
  wasmUrl?: string;
  blockSize?: number;
  initialBlocks?: number;
}

export interface ProcessChunkMessage {
  type: 'process-chunk';
  index: number;
  buffer: ArrayBuffer;
  maxOutputSize?: number;
  fileId?: string;
  priority?: number;
}

export interface SetSelectionMessage {
  type: 'set-selection';
  fileIds: string[];
}

export interface PrefetchHintMessage {
  type: 'prefetch-hint';
  nextIndex: number;
  fileId?: string;
}

export interface FlushMessage {
  type: 'flush';
}

export interface FinalizeMessage {
  type: 'finalize';
}

export interface CancelMessage {
  type: 'cancel';
}

export interface GetStatsMessage {
  type: 'get-stats';
}

export type WorkerIncomingMessage =
  | InitWasmMessage
  | ProcessChunkMessage
  | SetSelectionMessage
  | PrefetchHintMessage
  | FlushMessage
  | FinalizeMessage
  | CancelMessage
  | GetStatsMessage;

// ============================================================================
// Worker Responses (Outgoing)
// ============================================================================

export interface WorkerLoadedResponse {
  type: 'worker-loaded';
  timestamp: number;
}

export interface WasmReadyResponse {
  type: 'wasm-ready';
  memorySize: number;
  blockSize: number;
  capabilities?: {
    maxChunkSize: number;
    supportsGPU: boolean;
    supportsThreads: boolean;
  };
}

export interface ChunkProcessedResponse {
  type: 'chunk-processed';
  index: number;
  buffer: ArrayBuffer;
  bytesIn: number;
  bytesOut: number;
  ratio?: number;
  expansionRatio?: number;
  processingTime: number;
  fileId?: string;
}

export interface ChunkSkippedResponse {
  type: 'chunk-skipped';
  index: number;
  reason: 'not-selected' | 'duplicate' | 'corrupted';
  fileId?: string;
}

export interface FlushCompleteResponse {
  type: 'flush-complete';
  buffer?: ArrayBuffer;
  bytesOut: number;
}

export interface FinalizeCompleteResponse {
  type: 'finalize-complete';
  footer?: ArrayBuffer;
  table?: ChunkTable;
  stats: WorkerStats;
}

export interface CancelledResponse {
  type: 'cancelled';
  timestamp: number;
}

export interface SelectionUpdatedResponse {
  type: 'selection-updated';
  selectedCount: number;
  fileIds: string[];
}

export interface PrefetchAcknowledgedResponse {
  type: 'prefetch-acknowledged';
  nextIndex: number;
  fileId?: string;
}

export interface ProgressResponse {
  type: 'progress';
  progress: ProgressEvent;
}

export interface ErrorResponse {
  type: 'error';
  index?: number;
  message: string;
  recoverable: boolean;
  details?: any;
}

export interface WarningResponse {
  type: 'warning';
  message: string;
  stats?: any;
}

export interface StatsResponse {
  type: 'stats';
  stats: WorkerStats;
}

export type WorkerOutgoingMessage =
  | WorkerLoadedResponse
  | WasmReadyResponse
  | ChunkProcessedResponse
  | ChunkSkippedResponse
  | FlushCompleteResponse
  | FinalizeCompleteResponse
  | CancelledResponse
  | SelectionUpdatedResponse
  | PrefetchAcknowledgedResponse
  | ProgressResponse
  | ErrorResponse
  | WarningResponse
  | StatsResponse;

// ============================================================================
// Data Structures
// ============================================================================

export interface ProgressEvent {
  chunksProcessed: number;
  bytesIn: number;
  bytesOut: number;
  compressionRatio?: number;
  expansionRatio?: number;
  throughputMBps: number;
  elapsedMs: number;
  memoryUsed?: number;
  queueDepth?: number;
}

export interface WorkerStats {
  chunksProcessed: number;
  totalBytesIn: number;
  totalBytesOut: number;
  compressionRatio?: number;
  expansionRatio?: number;
  elapsedMs: number;
  avgChunkTime?: number;
  throughputMBps?: number;
  errorsRecovered?: number;
  memoryStats?: {
    totalBlocks: number;
    usedBlocks: number;
    freeBlocks: number;
    totalMemory: number;
    usedMemory: number;
  };
}

export interface ChunkTable {
  totalChunks: number;
  totalBytesIn: number;
  totalBytesOut: number;
  compressionRatio: number;
  chunkOffsets?: number[];
  chunkSizes?: number[];
}

// ============================================================================
// Worker Configuration
// ============================================================================

export interface WorkerConfig {
  wasmUrl?: string;
  blockSize?: number;
  initialBlocks?: number;
  telemetryInterval?: number;
  enablePrefetch?: boolean;
  maxQueueSize?: number;
}

// ============================================================================
// Worker Pool Types
// ============================================================================

export interface WorkerPoolConfig {
  workerCount: number;
  workerConfig: WorkerConfig;
  loadBalancing?: 'round-robin' | 'least-busy' | 'adaptive';
  restartOnError?: boolean;
}

export interface WorkerStatus {
  id: number;
  ready: boolean;
  busy: boolean;
  chunksProcessed: number;
  lastActivity: number;
  errorCount: number;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isErrorResponse(msg: WorkerOutgoingMessage): msg is ErrorResponse {
  return msg.type === 'error';
}

export function isChunkProcessedResponse(msg: WorkerOutgoingMessage): msg is ChunkProcessedResponse {
  return msg.type === 'chunk-processed';
}

export function isProgressResponse(msg: WorkerOutgoingMessage): msg is ProgressResponse {
  return msg.type === 'progress';
}

export function isWasmReadyResponse(msg: WorkerOutgoingMessage): msg is WasmReadyResponse {
  return msg.type === 'wasm-ready';
}

export function isFinalizeCompleteResponse(msg: WorkerOutgoingMessage): msg is FinalizeCompleteResponse {
  return msg.type === 'finalize-complete';
}

// ============================================================================
// Utility Types
// ============================================================================

export type WorkerMessageHandler<T extends WorkerOutgoingMessage = WorkerOutgoingMessage> = (
  message: T
) => void | Promise<void>;

export type WorkerErrorHandler = (error: ErrorResponse) => void | Promise<void>;

export type WorkerProgressHandler = (progress: ProgressEvent) => void;
