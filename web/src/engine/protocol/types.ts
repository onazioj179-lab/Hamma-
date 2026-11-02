/**
 * SPK V29 - Worker-Coordinator Protocol Types
 * 
 * Complete type-safe message protocol for:
 * - UI → Coordinator
 * - Coordinator → Worker
 * - Worker → Coordinator
 * - Worker ↔ WASM
 * 
 * Features:
 * - Strict ordering guarantees
 * - Zero-drop chunk verification
 * - Backpressure signaling
 * - Error recovery with retry
 * - Real-time telemetry (10-30Hz)
 * - Memory safety limits
 * - 1TB+ file support
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Unique job identifier with timestamp for ordering
 */
export type JobId = `spk-${number}-${string}`;

/**
 * Chunk sequence number (0-indexed, strictly ordered)
 */
export type ChunkSeq = number;

/**
 * Protocol version for compatibility
 */
export const PROTOCOL_VERSION = 29;

/**
 * Generate unique job ID
 */
export function generateJobId(): JobId {
  return `spk-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ============================================================================
// COMPRESSION SETTINGS
// ============================================================================

export type CompressionMode = 'fast' | 'balanced' | 'strong' | 'auto';

export interface CompressionSettings {
  mode: CompressionMode;
  chunkSize: number;
  enableDedup: boolean;
  enableEncryption: boolean;
  password?: string;
  maxRetries: number;
  verifyHash: boolean;
}

export const DEFAULT_SETTINGS: CompressionSettings = {
  mode: 'auto',
  chunkSize: 4 * 1024 * 1024, // 4MB
  enableDedup: false,
  enableEncryption: false,
  maxRetries: 3,
  verifyHash: true,
};

// ============================================================================
// MEMORY & PERFORMANCE CONSTANTS
// ============================================================================

export const WORKER_MEMORY_LIMIT = 200 * 1024 * 1024; // 200MB
export const MIN_CHUNK_SIZE = 64 * 1024; // 64KB
export const MAX_CHUNK_SIZE = 256 * 1024 * 1024; // 256MB
export const TELEMETRY_INTERVAL_MS = 50; // 20Hz default
export const BACKPRESSURE_HIGH_WATER = 8; // Max pending chunks
export const BACKPRESSURE_LOW_WATER = 4; // Resume threshold
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 100; // Exponential backoff base

// ============================================================================
// UI → COORDINATOR MESSAGES
// ============================================================================

export interface UIStartJobMessage {
  type: 'UI_START_JOB';
  jobId: JobId;
  file: File;
  settings: CompressionSettings;
}

export interface UICancelJobMessage {
  type: 'UI_CANCEL_JOB';
  jobId: JobId;
}

export interface UIUpdateSettingsMessage {
  type: 'UI_UPDATE_SETTINGS';
  settings: Partial<CompressionSettings>;
}

export interface UIRequestStatsMessage {
  type: 'UI_REQUEST_STATS';
  jobId?: JobId;
}

export interface UIPauseJobMessage {
  type: 'UI_PAUSE_JOB';
  jobId: JobId;
}

export interface UIResumeJobMessage {
  type: 'UI_RESUME_JOB';
  jobId: JobId;
}

export type UIMessage =
  | UIStartJobMessage
  | UICancelJobMessage
  | UIUpdateSettingsMessage
  | UIRequestStatsMessage
  | UIPauseJobMessage
  | UIResumeJobMessage;

// ============================================================================
// COORDINATOR → WORKER MESSAGES
// ============================================================================

export interface WorkerInitWasmMessage {
  type: 'INIT_WASM';
  wasmPath?: string;
}

export interface WorkerStartStreamMessage {
  type: 'START_STREAM';
  jobId: JobId;
  totalBytes: number;
  totalChunks: number;
  settings: CompressionSettings;
  fileName: string;
  mimeType: string;
}

export interface WorkerSendChunkMessage {
  type: 'SEND_CHUNK';
  jobId: JobId;
  seq: ChunkSeq;
  data: ArrayBuffer;
  hash?: string;
  isLast: boolean;
}

export interface WorkerFlushArchiveMessage {
  type: 'FLUSH_ARCHIVE';
  jobId: JobId;
}

export interface WorkerCancelMessage {
  type: 'CANCEL';
  jobId: JobId;
  reason?: string;
}

export interface WorkerShutdownMessage {
  type: 'SHUTDOWN';
}

export interface WorkerRetryChunkMessage {
  type: 'RETRY_CHUNK';
  jobId: JobId;
  seq: ChunkSeq;
  data: ArrayBuffer;
  attempt: number;
}

export interface WorkerSetChunkSizeMessage {
  type: 'SET_CHUNK_SIZE';
  chunkSize: number;
}

export interface WorkerSetModeMessage {
  type: 'SET_MODE';
  mode: CompressionMode;
}

export type CoordinatorToWorkerMessage =
  | WorkerInitWasmMessage
  | WorkerStartStreamMessage
  | WorkerSendChunkMessage
  | WorkerFlushArchiveMessage
  | WorkerCancelMessage
  | WorkerShutdownMessage
  | WorkerRetryChunkMessage
  | WorkerSetChunkSizeMessage
  | WorkerSetModeMessage;

// ============================================================================
// WORKER → COORDINATOR MESSAGES
// ============================================================================

export interface WorkerReadyMessage {
  type: 'READY';
  workerId: string;
  capabilities: WorkerCapabilities;
}

export interface WorkerCapabilities {
  hasSharedArrayBuffer: boolean;
  hasRealWasm: boolean;
  maxMemory: number;
  supportedModes: CompressionMode[];
}

export interface WorkerWasmReadyMessage {
  type: 'WASM_READY';
  version: number;
  capabilities: WorkerCapabilities;
}

export interface WorkerChunkProcessedMessage {
  type: 'CHUNK_PROCESSED';
  jobId: JobId;
  seq: ChunkSeq;
  originalSize: number;
  compressedSize: number;
  durationMs: number;
  hash: string;
  checksum: number;
}

export interface WorkerProgressMessage {
  type: 'PROGRESS';
  jobId: JobId;
  seq: ChunkSeq;
  totalChunks: number;
  bytesProcessed: number;
  totalBytes: number;
  speed: number; // bytes/sec
  eta: number; // seconds
  compressionRatio: number;
  memoryUsage: number;
}

export interface WorkerFinalBlobMessage {
  type: 'FINAL_BLOB';
  jobId: JobId;
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  totalChunks: number;
  durationMs: number;
  averageSpeed: number;
  compressionRatio: number;
  manifest: ArchiveManifest;
}

export interface WorkerErrorMessage {
  type: 'ERROR';
  jobId: JobId;
  code: ErrorCode;
  message: string;
  seq?: ChunkSeq;
  recoverable: boolean;
  stack?: string;
}

export interface WorkerBackpressureOnMessage {
  type: 'BACKPRESSURE_ON';
  jobId: JobId;
  pendingChunks: number;
  memoryUsage: number;
}

export interface WorkerBackpressureOffMessage {
  type: 'BACKPRESSURE_OFF';
  jobId: JobId;
  pendingChunks: number;
  memoryUsage: number;
}

export interface WorkerBufferFullMessage {
  type: 'BUFFER_FULL';
  jobId: JobId;
  capacity: number;
  used: number;
}

export interface WorkerCancelledMessage {
  type: 'CANCELLED';
  jobId: JobId;
  chunksProcessed: number;
  bytesProcessed: number;
  reason?: string;
}

export interface WorkerChunkRetryFailedMessage {
  type: 'CHUNK_RETRY_FAILED';
  jobId: JobId;
  seq: ChunkSeq;
  attempts: number;
  lastError: string;
}

export type WorkerToCoordinatorMessage =
  | WorkerReadyMessage
  | WorkerWasmReadyMessage
  | WorkerChunkProcessedMessage
  | WorkerProgressMessage
  | WorkerFinalBlobMessage
  | WorkerErrorMessage
  | WorkerBackpressureOnMessage
  | WorkerBackpressureOffMessage
  | WorkerBufferFullMessage
  | WorkerCancelledMessage
  | WorkerChunkRetryFailedMessage;

// ============================================================================
// COORDINATOR → UI MESSAGES
// ============================================================================

export interface CoordinatorJobStartedMessage {
  type: 'JOB_STARTED';
  jobId: JobId;
  totalBytes: number;
  totalChunks: number;
  estimatedDuration: number;
}

export interface CoordinatorProgressMessage {
  type: 'PROGRESS_UPDATE';
  jobId: JobId;
  progress: JobProgress;
  telemetry: JobTelemetry;
}

export interface CoordinatorJobCompleteMessage {
  type: 'JOB_COMPLETE';
  jobId: JobId;
  result: JobResult;
}

export interface CoordinatorJobCancelledMessage {
  type: 'JOB_CANCELLED';
  jobId: JobId;
  bytesProcessed: number;
  chunksProcessed: number;
}

export interface CoordinatorJobErrorMessage {
  type: 'JOB_ERROR';
  jobId: JobId;
  error: JobError;
}

export interface CoordinatorStatsMessage {
  type: 'STATS';
  stats: CoordinatorStats;
}

export interface CoordinatorWorkerStatusMessage {
  type: 'WORKER_STATUS';
  status: WorkerStatus;
}

export type CoordinatorToUIMessage =
  | CoordinatorJobStartedMessage
  | CoordinatorProgressMessage
  | CoordinatorJobCompleteMessage
  | CoordinatorJobCancelledMessage
  | CoordinatorJobErrorMessage
  | CoordinatorStatsMessage
  | CoordinatorWorkerStatusMessage;

// ============================================================================
// WASM INTERFACE TYPES
// ============================================================================

export interface WasmCompressChunkRequest {
  buffer: Uint8Array;
  mode: CompressionMode;
  chunkIndex: number;
}

export interface WasmCompressChunkResponse {
  compressedBuffer: Uint8Array;
  originalSize: number;
  compressedSize: number;
  checksum: number;
}

export interface WasmFinalizeArchiveResponse {
  footer: Uint8Array;
  manifest: ArchiveManifest;
}

export interface WasmError {
  code: WasmErrorCode;
  message: string;
}

export enum WasmErrorCode {
  SUCCESS = 0,
  MEMORY_ALLOCATION_FAILED = 1,
  INVALID_INPUT = 2,
  COMPRESSION_FAILED = 3,
  DECOMPRESSION_FAILED = 4,
  ARCHIVE_CORRUPTED = 5,
  CHUNK_SIZE_EXCEEDED = 6,
  OUT_OF_MEMORY = 7,
  WASM_INIT_FAILED = 8,
  WASM_PANIC = 9,
  CHECKSUM_MISMATCH = 10,
}

// ============================================================================
// ERROR CODES
// ============================================================================

export enum ErrorCode {
  // WASM Errors (0-99)
  WASM_INIT_FAILED = 'WASM_INIT_FAILED',
  WASM_PANIC = 'WASM_PANIC',
  WASM_OOM = 'WASM_OOM',
  
  // Compression Errors (100-199)
  COMPRESSION_FAILED = 'COMPRESSION_FAILED',
  DECOMPRESSION_FAILED = 'DECOMPRESSION_FAILED',
  CHUNK_CORRUPTED = 'CHUNK_CORRUPTED',
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  
  // Protocol Errors (200-299)
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  OUT_OF_ORDER = 'OUT_OF_ORDER',
  CHUNK_MISSING = 'CHUNK_MISSING',
  DUPLICATE_CHUNK = 'DUPLICATE_CHUNK',
  
  // IO Errors (300-399)
  FILE_READ_FAILED = 'FILE_READ_FAILED',
  BLOB_CREATE_FAILED = 'BLOB_CREATE_FAILED',
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  
  // Job Errors (400-499)
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  JOB_CANCELLED = 'JOB_CANCELLED',
  JOB_TIMEOUT = 'JOB_TIMEOUT',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
  
  // Worker Errors (500-599)
  WORKER_CRASHED = 'WORKER_CRASHED',
  WORKER_TIMEOUT = 'WORKER_TIMEOUT',
  WORKER_NOT_READY = 'WORKER_NOT_READY',
}

// ============================================================================
// TELEMETRY & STATS
// ============================================================================

export interface JobProgress {
  phase: 'reading' | 'compressing' | 'verifying' | 'writing' | 'finalizing' | 'complete';
  bytesProcessed: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  compressionRatio: number;
  percent: number;
}

export interface JobTelemetry {
  instantSpeed: number; // bytes/sec
  rollingAvgSpeed: number; // bytes/sec (5-second window)
  eta: number; // seconds
  chunkTimings: ChunkTiming[];
  workerLoad: number; // 0-100%
  wasmThroughput: number; // bytes/sec
  memoryUsage: number; // bytes
  memoryPeak: number; // bytes
  timestamp: number;
}

export interface ChunkTiming {
  seq: ChunkSeq;
  readMs: number;
  compressMs: number;
  totalMs: number;
  size: number;
}

export interface JobResult {
  outputBlob: Blob;
  downloadUrl: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  totalChunks: number;
  durationMs: number;
  averageSpeed: number;
  peakSpeed: number;
  manifest: ArchiveManifest;
}

export interface JobError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  seq?: ChunkSeq;
  attempts?: number;
  stack?: string;
}

export interface WorkerStatus {
  workerId: string;
  ready: boolean;
  wasmReady: boolean;
  activeJobId: JobId | null;
  pendingChunks: number;
  memoryUsage: number;
  uptime: number;
  jobsCompleted: number;
  jobsFailed: number;
}

export interface CoordinatorStats {
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalBytesProcessed: number;
  averageSpeed: number;
  workerStatus: WorkerStatus;
  uptime: number;
}

// ============================================================================
// ARCHIVE MANIFEST
// ============================================================================

export interface ArchiveManifest {
  version: number;
  fileName: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  chunkSize: number;
  totalChunks: number;
  chunks: ChunkInfo[];
  settings: CompressionSettings;
  createdAt: number;
  checksum: string;
}

export interface ChunkInfo {
  seq: ChunkSeq;
  offset: number;
  originalSize: number;
  compressedSize: number;
  hash: string;
  checksum: number;
}

// ============================================================================
// JOB STATE
// ============================================================================

export type JobState = 
  | 'pending'
  | 'reading'
  | 'compressing'
  | 'paused'
  | 'finalizing'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface JobContext {
  id: JobId;
  state: JobState;
  file: File;
  settings: CompressionSettings;
  startTime: number;
  
  // Chunk tracking
  totalChunks: number;
  chunksProcessed: Set<ChunkSeq>;
  chunksPending: Map<ChunkSeq, PendingChunk>;
  chunksRetrying: Map<ChunkSeq, RetryState>;
  
  // Results
  compressedChunks: Map<ChunkSeq, CompressedChunk>;
  
  // Telemetry
  bytesRead: number;
  bytesCompressed: number;
  speedSamples: SpeedSample[];
  memoryPeak: number;
  
  // Error tracking
  errors: JobError[];
  
  // Cancellation
  abortController: AbortController;
}

export interface PendingChunk {
  seq: ChunkSeq;
  data: ArrayBuffer;
  hash?: string;
  sentAt: number;
}

export interface RetryState {
  seq: ChunkSeq;
  attempts: number;
  lastError: string;
  nextRetryAt: number;
}

export interface CompressedChunk {
  seq: ChunkSeq;
  data: Uint8Array;
  originalSize: number;
  compressedSize: number;
  hash: string;
  checksum: number;
  durationMs: number;
}

export interface SpeedSample {
  timestamp: number;
  bytes: number;
}

// ============================================================================
// MESSAGE VALIDATION
// ============================================================================

export function isValidMessage(msg: unknown): msg is UIMessage | CoordinatorToWorkerMessage | WorkerToCoordinatorMessage | CoordinatorToUIMessage {
  if (!msg || typeof msg !== 'object') return false;
  if (!('type' in msg) || typeof (msg as any).type !== 'string') return false;
  return true;
}

export function isUIMessage(msg: unknown): msg is UIMessage {
  if (!isValidMessage(msg)) return false;
  const types: UIMessage['type'][] = [
    'UI_START_JOB', 'UI_CANCEL_JOB', 'UI_UPDATE_SETTINGS', 
    'UI_REQUEST_STATS', 'UI_PAUSE_JOB', 'UI_RESUME_JOB'
  ];
  return types.includes((msg as UIMessage).type);
}

export function isCoordinatorToWorkerMessage(msg: unknown): msg is CoordinatorToWorkerMessage {
  if (!isValidMessage(msg)) return false;
  const types: CoordinatorToWorkerMessage['type'][] = [
    'INIT_WASM', 'START_STREAM', 'SEND_CHUNK', 'FLUSH_ARCHIVE',
    'CANCEL', 'SHUTDOWN', 'RETRY_CHUNK', 'SET_CHUNK_SIZE', 'SET_MODE'
  ];
  return types.includes((msg as CoordinatorToWorkerMessage).type);
}

export function isWorkerToCoordinatorMessage(msg: unknown): msg is WorkerToCoordinatorMessage {
  if (!isValidMessage(msg)) return false;
  const types: WorkerToCoordinatorMessage['type'][] = [
    'READY', 'WASM_READY', 'CHUNK_PROCESSED', 'PROGRESS', 'FINAL_BLOB',
    'ERROR', 'BACKPRESSURE_ON', 'BACKPRESSURE_OFF', 'BUFFER_FULL',
    'CANCELLED', 'CHUNK_RETRY_FAILED'
  ];
  return types.includes((msg as WorkerToCoordinatorMessage).type);
}

export function isCoordinatorToUIMessage(msg: unknown): msg is CoordinatorToUIMessage {
  if (!isValidMessage(msg)) return false;
  const types: CoordinatorToUIMessage['type'][] = [
    'JOB_STARTED', 'PROGRESS_UPDATE', 'JOB_COMPLETE', 
    'JOB_CANCELLED', 'JOB_ERROR', 'STATS', 'WORKER_STATUS'
  ];
  return types.includes((msg as CoordinatorToUIMessage).type);
}
