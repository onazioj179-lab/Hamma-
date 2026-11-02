/**
 * SPK V44 - Unified API Type Definitions
 * Core types for the entire API surface
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Unique identifier for jobs, files, chunks, etc.
 */
export type JobId = string;
export type FileId = string;
export type ChunkId = string;
export type TokenId = string;
export type HistoryId = string;

/**
 * Result wrapper for all API operations
 */
export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: number;
}

/**
 * Structured API error
 */
export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  recovery?: RecoveryInstruction;
}

/**
 * Error codes for all failure modes
 */
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'FILE_TOO_LARGE'
  | 'INSUFFICIENT_MEMORY'
  | 'WORKER_CRASHED'
  | 'WASM_ERROR'
  | 'STORAGE_FULL'
  | 'STORAGE_INTERRUPTED'
  | 'NETWORK_ERROR'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'INTEGRITY_CHECK_FAILED'
  | 'CORRUPTED_INPUT'
  | 'UNSUPPORTED_FORMAT'
  | 'OPERATION_CANCELLED'
  | 'OPERATION_TIMEOUT'
  | 'QUOTA_EXCEEDED'
  | 'PERMISSION_DENIED'
  | 'INTERNAL_ERROR';

/**
 * Recovery instruction for recoverable errors
 */
export interface RecoveryInstruction {
  action: RecoveryAction;
  jobId?: JobId;
  chunkId?: ChunkId;
  retryAfterMs?: number;
  fallbackMode?: boolean;
}

export type RecoveryAction =
  | 'RETRY_OPERATION'
  | 'RETRY_CHUNK'
  | 'RECOVER_JOB'
  | 'FALLBACK_MODE'
  | 'CLEAR_CACHE'
  | 'RESTART_WORKER'
  | 'REDUCE_MEMORY'
  | 'SPLIT_INPUT';

// ============================================================================
// Compression Types
// ============================================================================

/**
 * Compression quality preset
 */
export type CompressionQuality = 'fast' | 'balanced' | 'maximum';

/**
 * Compression options
 */
export interface CompressionOptions {
  quality: CompressionQuality;
  chunkSize: number;
  enableDedup: boolean;
  enableEncryption: boolean;
  encryptionPassword?: string;
  enableSigning: boolean;
  maxMemoryMB: number;
  workerCount: number;
  archiveName?: string;
}

/**
 * File entry for compression input
 */
export interface FileEntry {
  id: FileId;
  file: File;
  path: string;
  size: number;
  type: string;
  lastModified: number;
}

/**
 * Compression job metadata
 */
export interface CompressionJob {
  id: JobId;
  state: CompressionState;
  files: FileEntry[];
  options: CompressionOptions;
  progress: CompressionProgress;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: CompressionResult;
  error?: ApiError;
}

/**
 * Compression state machine states
 */
export type CompressionState =
  | 'idle'
  | 'initializing'
  | 'reading'
  | 'chunking'
  | 'compressing'
  | 'writing'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Compression progress
 */
export interface CompressionProgress {
  phase: CompressionState;
  bytesRead: number;
  bytesWritten: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
  compressionRatio: number;
  laneUtilization: number;
  memoryUsage: number;
}

/**
 * Compression result
 */
export interface CompressionResult {
  archiveBlob: Blob;
  archiveSize: number;
  originalSize: number;
  compressionRatio: number;
  filesCompressed: number;
  chunksWritten: number;
  duration: number;
  throughput: number; // bytes per second
  encrypted: boolean;
  signed: boolean;
  checksum: string;
}

// ============================================================================
// Decompression Types
// ============================================================================

/**
 * Decompression job metadata
 */
export interface DecompressionJob {
  id: JobId;
  state: DecompressionState;
  archiveBlob: Blob;
  manifest?: ArchiveManifest;
  progress: DecompressionProgress;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: DecompressionResult;
  error?: ApiError;
}

/**
 * Decompression state machine states
 */
export type DecompressionState =
  | 'idle'
  | 'loading'
  | 'reading_index'
  | 'extracting'
  | 'writing_output'
  | 'completed'
  | 'failed';

/**
 * Decompression progress
 */
export interface DecompressionProgress {
  phase: DecompressionState;
  bytesRead: number;
  bytesWritten: number;
  totalBytes: number;
  filesExtracted: number;
  totalFiles: number;
  currentFile: string;
  speed: number;
  eta: number;
}

/**
 * Decompression result
 */
export interface DecompressionResult {
  files: ExtractedFile[];
  totalSize: number;
  filesExtracted: number;
  duration: number;
  throughput: number;
  integrityVerified: boolean;
}

/**
 * Extracted file
 */
export interface ExtractedFile {
  id: FileId;
  name: string;
  path: string;
  size: number;
  blob: Blob;
  mimeType: string;
  checksum: string;
}

// ============================================================================
// Archive & Manifest Types
// ============================================================================

/**
 * Archive manifest
 */
export interface ArchiveManifest {
  version: string;
  createdAt: number;
  totalFiles: number;
  totalSize: number;
  compressedSize: number;
  encrypted: boolean;
  signed: boolean;
  entries: ManifestEntry[];
  metadata: ArchiveMetadata;
}

/**
 * Manifest entry for a file
 */
export interface ManifestEntry {
  id: FileId;
  name: string;
  path: string;
  size: number;
  compressedSize: number;
  offset: number;
  length: number;
  mimeType: string;
  checksum: string;
  modifiedAt: number;
  isDirectory: boolean;
}

/**
 * Archive metadata
 */
export interface ArchiveMetadata {
  archiveName: string;
  createdBy: string;
  compressionMethod: string;
  quality: CompressionQuality;
  chunksCount: number;
  dedupEnabled: boolean;
  dedupSavings: number;
}

// ============================================================================
// Preview Types
// ============================================================================

/**
 * File thumbnail
 */
export interface FileThumbnail {
  fileId: FileId;
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Manifest summary for quick display
 */
export interface ManifestSummary {
  totalFiles: number;
  totalSize: number;
  compressedSize: number;
  ratio: number;
  fileTypes: Record<string, number>;
  largestFiles: ManifestEntry[];
  directoryTree: DirectoryNode;
}

/**
 * Directory tree node
 */
export interface DirectoryNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children?: DirectoryNode[];
  fileId?: FileId;
}

// ============================================================================
// Sharing Types
// ============================================================================

/**
 * Share token
 */
export interface ShareToken {
  id: TokenId;
  token: string;
  archiveChecksum: string;
  expiresAt: number;
  maxDownloads?: number;
  downloadsRemaining?: number;
  password?: boolean; // indicates if password protected
  createdAt: number;
}

/**
 * Shared archive export
 */
export interface SharedArchiveExport {
  blob: Blob;
  token: ShareToken;
  encryptedManifest: boolean;
  size: number;
}

/**
 * Share token verification result
 */
export interface TokenVerification {
  valid: boolean;
  expired: boolean;
  downloadsExceeded: boolean;
  archiveChecksum?: string;
}

// ============================================================================
// History Types
// ============================================================================

/**
 * Job history record
 */
export interface JobHistoryRecord {
  id: HistoryId;
  type: 'compression' | 'decompression' | 'share';
  name: string;
  createdAt: number;
  completedAt?: number;
  status: 'completed' | 'failed' | 'cancelled' | 'pending';
  inputSize: number;
  outputSize: number;
  filesCount: number;
  duration: number;
  options: Partial<CompressionOptions>;
  archivePath?: string;
  shareToken?: string;
  error?: string;
}

/**
 * History query options
 */
export interface HistoryQueryOptions {
  limit?: number;
  offset?: number;
  type?: 'compression' | 'decompression' | 'share';
  status?: JobHistoryRecord['status'];
  startDate?: number;
  endDate?: number;
}

// ============================================================================
// Security Types
// ============================================================================

/**
 * Encryption options
 */
export interface EncryptionOptions {
  algorithm: 'aes-256-gcm' | 'chacha20-poly1305';
  password: string;
  iterations?: number;
}

/**
 * Archive encryption result
 */
export interface EncryptionResult {
  encryptedBlob: Blob;
  salt: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

/**
 * Integrity verification result
 */
export interface IntegrityResult {
  valid: boolean;
  checksumMatch: boolean;
  signatureValid?: boolean;
  manifestIntact: boolean;
  corruptedChunks: ChunkId[];
}

// ============================================================================
// Telemetry Types
// ============================================================================

/**
 * Telemetry packet for UI updates
 */
export interface TelemetryPacket {
  timestamp: number;
  jobId: JobId;
  type: 'progress' | 'speed' | 'memory' | 'error' | 'state_change';
  payload: TelemetryPayload;
}

export type TelemetryPayload =
  | ProgressTelemetry
  | SpeedTelemetry
  | MemoryTelemetry
  | ErrorTelemetry
  | StateChangeTelemetry;

export interface ProgressTelemetry {
  type: 'progress';
  bytesProcessed: number;
  totalBytes: number;
  percentage: number;
  currentFile: string;
}

export interface SpeedTelemetry {
  type: 'speed';
  currentSpeed: number;
  averageSpeed: number;
  peakSpeed: number;
  eta: number;
  throughputPercent: number; // vs 100GB/min target
}

export interface MemoryTelemetry {
  type: 'memory';
  heapUsed: number;
  heapTotal: number;
  bufferPoolUsage: number;
  workerMemory: number[];
}

export interface ErrorTelemetry {
  type: 'error';
  error: ApiError;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
}

export interface StateChangeTelemetry {
  type: 'state_change';
  previousState: string;
  newState: string;
  reason?: string;
}

// ============================================================================
// Platform Types
// ============================================================================

/**
 * Platform capabilities
 */
export interface PlatformCapabilities {
  platform: 'browser' | 'pwa' | 'electron' | 'tauri' | 'node';
  hasSharedArrayBuffer: boolean;
  hasWebWorkers: boolean;
  hasWebAssembly: boolean;
  hasFileSystem: boolean;
  hasIndexedDB: boolean;
  maxMemoryMB: number;
  maxWorkers: number;
  supportsStreaming: boolean;
  supportsP2P: boolean;
}

/**
 * API configuration
 */
export interface ApiConfig {
  maxFileSizeTB: number;
  maxFilesCount: number;
  defaultChunkSize: number;
  defaultWorkerCount: number;
  targetThroughput: number; // bytes per second (100GB/min)
  telemetryInterval: number;
  historyRetentionDays: number;
  enableDebugMode: boolean;
}
