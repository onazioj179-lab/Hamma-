/**
 * SPK V44 - Unified API Interface
 * Single consistent API contract for all operations
 */

import type {
  JobId,
  FileId,
  ChunkId,
  HistoryId,
  ApiResult,
  ApiError,
  CompressionOptions,
  CompressionJob,
  CompressionProgress,
  CompressionResult,
  DecompressionJob,
  DecompressionProgress,
  DecompressionResult,
  ArchiveManifest,
  ManifestEntry,
  ManifestSummary,
  FileThumbnail,
  ShareToken,
  SharedArchiveExport,
  TokenVerification,
  JobHistoryRecord,
  HistoryQueryOptions,
  EncryptionOptions,
  EncryptionResult,
  IntegrityResult,
  TelemetryPacket,
  PlatformCapabilities,
  ApiConfig,
  FileEntry,
} from './types';

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event emitter interface for API subscriptions
 */
export interface ApiEventEmitter {
  on<T extends ApiEventType>(event: T, handler: ApiEventHandler<T>): () => void;
  off<T extends ApiEventType>(event: T, handler: ApiEventHandler<T>): void;
  emit<T extends ApiEventType>(event: T, data: ApiEventData[T]): void;
}

export type ApiEventType =
  | 'progress'
  | 'telemetry'
  | 'state_change'
  | 'error'
  | 'preview_ready'
  | 'history_updated'
  | 'share_created'
  | 'job_completed'
  | 'job_failed';

export interface ApiEventData {
  progress: { jobId: JobId; progress: CompressionProgress | DecompressionProgress };
  telemetry: TelemetryPacket;
  state_change: { jobId: JobId; previousState: string; newState: string };
  error: { jobId?: JobId; error: ApiError };
  preview_ready: { fileId: FileId; thumbnail: FileThumbnail };
  history_updated: { records: JobHistoryRecord[] };
  share_created: { token: ShareToken };
  job_completed: { jobId: JobId; result: CompressionResult | DecompressionResult };
  job_failed: { jobId: JobId; error: ApiError };
}

export type ApiEventHandler<T extends ApiEventType> = (data: ApiEventData[T]) => void;

// ============================================================================
// Unified API Interface
// ============================================================================

/**
 * SPK Unified API
 * Single interface for all compression operations
 */
export interface SpkApi {
  // =========================================================================
  // Lifecycle
  // =========================================================================
  
  /**
   * Initialize the API and all subsystems
   */
  initialize(config?: Partial<ApiConfig>): Promise<ApiResult<PlatformCapabilities>>;
  
  /**
   * Shutdown the API and cleanup resources
   */
  shutdown(): Promise<ApiResult<void>>;
  
  /**
   * Get current platform capabilities
   */
  getCapabilities(): PlatformCapabilities;
  
  /**
   * Get current API configuration
   */
  getConfig(): ApiConfig;

  // =========================================================================
  // Compression Actions
  // =========================================================================
  
  /**
   * Start a new compression job
   * @param files Files to compress
   * @param options Compression options
   */
  startCompression(
    files: File[] | FileEntry[],
    options?: Partial<CompressionOptions>
  ): Promise<ApiResult<CompressionJob>>;
  
  /**
   * Stream compressed chunks as they're ready
   * @param jobId Job identifier
   */
  streamChunks(jobId: JobId): AsyncGenerator<ApiResult<Uint8Array>, void, unknown>;
  
  /**
   * Get current progress for a compression job
   * @param jobId Job identifier
   */
  getProgress(jobId: JobId): ApiResult<CompressionProgress>;
  
  /**
   * Finalize and get the complete archive
   * @param jobId Job identifier
   */
  finishArchive(jobId: JobId): Promise<ApiResult<CompressionResult>>;
  
  /**
   * Pause a running compression job
   * @param jobId Job identifier
   */
  pauseCompression(jobId: JobId): ApiResult<void>;
  
  /**
   * Resume a paused compression job
   * @param jobId Job identifier
   */
  resumeCompression(jobId: JobId): ApiResult<void>;
  
  /**
   * Cancel a compression job
   * @param jobId Job identifier
   */
  cancelCompression(jobId: JobId): ApiResult<void>;

  // =========================================================================
  // Decompression Actions
  // =========================================================================
  
  /**
   * Open an archive for reading
   * @param blob Archive blob
   * @param password Optional decryption password
   */
  openArchive(
    blob: Blob,
    password?: string
  ): Promise<ApiResult<DecompressionJob>>;
  
  /**
   * List contents of an opened archive
   * @param jobId Job identifier from openArchive
   */
  listContents(jobId: JobId): ApiResult<ManifestEntry[]>;
  
  /**
   * Extract a single file from the archive
   * @param jobId Job identifier
   * @param fileId File identifier
   */
  extractFile(
    jobId: JobId,
    fileId: FileId
  ): Promise<ApiResult<Blob>>;
  
  /**
   * Extract a range of chunks (for partial extraction)
   * @param jobId Job identifier
   * @param startChunk Start chunk index
   * @param endChunk End chunk index
   */
  extractRange(
    jobId: JobId,
    startChunk: number,
    endChunk: number
  ): Promise<ApiResult<Uint8Array>>;
  
  /**
   * Extract all files from the archive
   * @param jobId Job identifier
   */
  extractAll(jobId: JobId): Promise<ApiResult<DecompressionResult>>;
  
  /**
   * Close an opened archive and release resources
   * @param jobId Job identifier
   */
  closeArchive(jobId: JobId): ApiResult<void>;

  // =========================================================================
  // Metadata & Preview
  // =========================================================================
  
  /**
   * Get full metadata for an archive
   * @param jobId Job identifier from openArchive
   */
  getMetadata(jobId: JobId): ApiResult<ArchiveManifest>;
  
  /**
   * Get thumbnails for previewable files
   * @param jobId Job identifier
   * @param fileIds Optional specific file IDs (all if not specified)
   */
  getThumbnails(
    jobId: JobId,
    fileIds?: FileId[]
  ): Promise<ApiResult<FileThumbnail[]>>;
  
  /**
   * Get a summary of the manifest for quick display
   * @param jobId Job identifier
   */
  getManifestSummary(jobId: JobId): ApiResult<ManifestSummary>;

  // =========================================================================
  // Sharing Layer
  // =========================================================================
  
  /**
   * Create a share token for an archive
   * @param jobId Job identifier
   * @param options Sharing options
   */
  createShareToken(
    jobId: JobId,
    options?: {
      expiresInHours?: number;
      maxDownloads?: number;
      password?: string;
    }
  ): Promise<ApiResult<ShareToken>>;
  
  /**
   * Verify a share token
   * @param token Token string
   */
  verifyShareToken(token: string): Promise<ApiResult<TokenVerification>>;
  
  /**
   * Export archive for sharing
   * @param jobId Job identifier
   * @param includeToken Include share token in export
   */
  exportForSharing(
    jobId: JobId,
    includeToken?: boolean
  ): Promise<ApiResult<SharedArchiveExport>>;
  
  /**
   * Import a shared archive
   * @param blob Shared archive blob
   * @param token Optional share token for verification
   */
  importSharedArchive(
    blob: Blob,
    token?: string
  ): Promise<ApiResult<DecompressionJob>>;

  // =========================================================================
  // History Layer
  // =========================================================================
  
  /**
   * Save a job record to history
   * @param record Job record to save
   */
  saveJobRecord(
    record: Omit<JobHistoryRecord, 'id'>
  ): Promise<ApiResult<JobHistoryRecord>>;
  
  /**
   * List job history with optional filters
   * @param options Query options
   */
  listJobHistory(
    options?: HistoryQueryOptions
  ): Promise<ApiResult<JobHistoryRecord[]>>;
  
  /**
   * Delete a history entry
   * @param historyId History record ID
   */
  deleteHistoryEntry(historyId: HistoryId): Promise<ApiResult<void>>;
  
  /**
   * Clear all history entries
   */
  clearHistory(): Promise<ApiResult<void>>;

  // =========================================================================
  // Security
  // =========================================================================
  
  /**
   * Encrypt an archive
   * @param blob Archive blob
   * @param options Encryption options
   */
  encryptArchive(
    blob: Blob,
    options: EncryptionOptions
  ): Promise<ApiResult<EncryptionResult>>;
  
  /**
   * Decrypt an archive
   * @param encryptedBlob Encrypted archive blob
   * @param password Decryption password
   */
  decryptArchive(
    encryptedBlob: Blob,
    password: string
  ): Promise<ApiResult<Blob>>;
  
  /**
   * Verify archive integrity
   * @param blob Archive blob
   */
  verifyIntegrity(blob: Blob): Promise<ApiResult<IntegrityResult>>;

  // =========================================================================
  // Error & Recovery
  // =========================================================================
  
  /**
   * Attempt to recover a failed compression job
   * @param jobId Job identifier
   */
  recoverCompressionJob(jobId: JobId): Promise<ApiResult<CompressionJob>>;
  
  /**
   * Attempt to recover a failed decompression job
   * @param jobId Job identifier
   */
  recoverDecompressionJob(jobId: JobId): Promise<ApiResult<DecompressionJob>>;
  
  /**
   * Retry a specific failed chunk
   * @param jobId Job identifier
   * @param chunkId Chunk identifier
   */
  retryChunk(
    jobId: JobId,
    chunkId: ChunkId
  ): Promise<ApiResult<void>>;
  
  /**
   * Fall back to safe mode (reduced performance, higher stability)
   */
  fallbackToSafeMode(): Promise<ApiResult<void>>;
  
  /**
   * Get current error state for a job
   * @param jobId Job identifier
   */
  getJobError(jobId: JobId): ApiResult<ApiError | null>;

  // =========================================================================
  // Event Subscriptions
  // =========================================================================
  
  /**
   * Subscribe to progress events
   * @param handler Progress handler
   */
  onProgress(
    handler: (data: { jobId: JobId; progress: CompressionProgress | DecompressionProgress }) => void
  ): () => void;
  
  /**
   * Subscribe to telemetry events
   * @param handler Telemetry handler
   */
  onTelemetry(handler: (packet: TelemetryPacket) => void): () => void;
  
  /**
   * Subscribe to state change events
   * @param handler State change handler
   */
  onStateChange(
    handler: (data: { jobId: JobId; previousState: string; newState: string }) => void
  ): () => void;
  
  /**
   * Subscribe to error events
   * @param handler Error handler
   */
  onError(handler: (data: { jobId?: JobId; error: ApiError }) => void): () => void;
  
  /**
   * Subscribe to job completion events
   * @param handler Completion handler
   */
  onJobCompleted(
    handler: (data: { jobId: JobId; result: CompressionResult | DecompressionResult }) => void
  ): () => void;
  
  /**
   * Subscribe to history update events
   * @param handler History handler
   */
  onHistoryUpdated(handler: (records: JobHistoryRecord[]) => void): () => void;
}

// ============================================================================
// API Constants
// ============================================================================

/**
 * Default API configuration
 */
export const DEFAULT_API_CONFIG: ApiConfig = {
  maxFileSizeTB: 10,
  maxFilesCount: 100000,
  defaultChunkSize: 64 * 1024 * 1024, // 64MB
  defaultWorkerCount: navigator?.hardwareConcurrency || 4,
  targetThroughput: 1.67 * 1024 * 1024 * 1024, // 100GB/min
  telemetryInterval: 100, // ms
  historyRetentionDays: 30,
  enableDebugMode: false,
};

/**
 * Default compression options
 */
export const DEFAULT_COMPRESSION_OPTIONS: CompressionOptions = {
  quality: 'balanced',
  chunkSize: 64 * 1024 * 1024,
  enableDedup: true,
  enableEncryption: false,
  enableSigning: false,
  maxMemoryMB: 2048,
  workerCount: navigator?.hardwareConcurrency || 4,
};
