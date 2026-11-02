/**
 * SPK V45 - Unified API Signatures
 * Complete type-safe SPK interface
 */

import type { 
  FileReference, 
  CompressionOptions, 
  CompressionResult,
  DecompressionRequest,
  ArchiveInfo,
  ExtractionOptions,
  ExtractedFile,
} from './core-types';
import type { ProgressEvent, TelemetryUpdate, CoordinatorState } from './progress-types';
import type { Manifest, ManifestSummary, FileEntry } from './manifest-types';
import type { SPKError, SPKResult } from './error-contract';

// ============================================================================
// PART 7 — UNIFIED API SIGNATURES
// ============================================================================

/**
 * Main SPK API interface
 * All methods are type-safe with clear contracts
 */
export interface SPK {
  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Initialize SPK engine
   * Must be called before any other operations
   */
  initialize(config?: SPKConfig): Promise<SPKResult<void>>;

  /**
   * Check if engine is initialized
   */
  isInitialized(): boolean;

  /**
   * Shutdown engine and release resources
   */
  shutdown(): Promise<void>;

  /**
   * Get engine version
   */
  getVersion(): string;

  // ========================================================================
  // Compression
  // ========================================================================

  /**
   * Start compression operation
   * @param files - Files to compress
   * @param options - Compression options
   * @returns Operation ID for tracking
   */
  startCompression(
    files: FileReference[],
    options?: CompressionOptions
  ): Promise<SPKResult<string>>;

  /**
   * Get compression progress
   * @param operationId - Operation ID from startCompression
   */
  getCompressionProgress(operationId: string): ProgressEvent | null;

  /**
   * Cancel compression operation
   * @param operationId - Operation ID to cancel
   */
  cancelCompression(operationId: string): Promise<SPKResult<void>>;

  /**
   * Wait for compression to complete
   * @param operationId - Operation ID to wait for
   */
  awaitCompression(operationId: string): Promise<SPKResult<CompressionResult>>;

  /**
   * Compress files synchronously (blocking)
   * @param files - Files to compress
   * @param options - Compression options
   * @param onProgress - Progress callback
   */
  compress(
    files: FileReference[],
    options?: CompressionOptions,
    onProgress?: ProgressCallback
  ): Promise<SPKResult<CompressionResult>>;

  // ========================================================================
  // Decompression
  // ========================================================================

  /**
   * Start decompression operation
   * @param request - Decompression request
   * @returns Operation ID for tracking
   */
  startDecompression(
    request: DecompressionRequest
  ): Promise<SPKResult<string>>;

  /**
   * Get decompression progress
   * @param operationId - Operation ID from startDecompression
   */
  getDecompressionProgress(operationId: string): ProgressEvent | null;

  /**
   * Cancel decompression operation
   * @param operationId - Operation ID to cancel
   */
  cancelDecompression(operationId: string): Promise<SPKResult<void>>;

  /**
   * Wait for decompression to complete
   * @param operationId - Operation ID to wait for
   */
  awaitDecompression(operationId: string): Promise<SPKResult<ExtractedFile[]>>;

  /**
   * Decompress archive synchronously
   * @param request - Decompression request
   * @param onProgress - Progress callback
   */
  decompress(
    request: DecompressionRequest,
    onProgress?: ProgressCallback
  ): Promise<SPKResult<ExtractedFile[]>>;

  // ========================================================================
  // Archive Inspection
  // ========================================================================

  /**
   * Get archive information without extracting
   * @param archive - Archive data or reference
   */
  getArchiveInfo(archive: ArrayBuffer | FileReference): Promise<SPKResult<ArchiveInfo>>;

  /**
   * Get full manifest from archive
   * @param archive - Archive data or reference
   */
  getManifest(archive: ArrayBuffer | FileReference): Promise<SPKResult<Manifest>>;

  /**
   * List files in archive
   * @param archive - Archive data or reference
   */
  listFiles(archive: ArrayBuffer | FileReference): Promise<SPKResult<FileEntry[]>>;

  /**
   * Extract single file from archive
   * @param archive - Archive data or reference
   * @param filePath - Path of file to extract
   * @param options - Extraction options
   */
  extractFile(
    archive: ArrayBuffer | FileReference,
    filePath: string,
    options?: ExtractionOptions
  ): Promise<SPKResult<ExtractedFile>>;

  // ========================================================================
  // Sharing
  // ========================================================================

  /**
   * Upload archive for sharing
   * @param archive - Compressed archive data
   * @param options - Sharing options
   * @returns Share URL
   */
  share(
    archive: ArrayBuffer,
    options?: ShareOptions
  ): Promise<SPKResult<ShareResult>>;

  /**
   * Download shared archive
   * @param shareId - Share ID or URL
   */
  downloadShared(shareId: string): Promise<SPKResult<ArrayBuffer>>;

  /**
   * Get share info
   * @param shareId - Share ID or URL
   */
  getShareInfo(shareId: string): Promise<SPKResult<ShareInfo>>;

  /**
   * Delete shared archive
   * @param shareId - Share ID
   */
  deleteShare(shareId: string): Promise<SPKResult<void>>;

  // ========================================================================
  // History
  // ========================================================================

  /**
   * Get compression history
   * @param limit - Maximum items to return
   */
  getHistory(limit?: number): Promise<SPKResult<HistoryEntry[]>>;

  /**
   * Clear history
   */
  clearHistory(): Promise<SPKResult<void>>;

  /**
   * Get history entry by ID
   * @param entryId - History entry ID
   */
  getHistoryEntry(entryId: string): Promise<SPKResult<HistoryEntry | null>>;

  // ========================================================================
  // Security
  // ========================================================================

  /**
   * Encrypt archive with password
   * @param archive - Archive data
   * @param password - Encryption password
   */
  encrypt(
    archive: ArrayBuffer,
    password: string
  ): Promise<SPKResult<ArrayBuffer>>;

  /**
   * Decrypt archive with password
   * @param archive - Encrypted archive data
   * @param password - Decryption password
   */
  decrypt(
    archive: ArrayBuffer,
    password: string
  ): Promise<SPKResult<ArrayBuffer>>;

  /**
   * Verify archive integrity
   * @param archive - Archive data
   */
  verifyIntegrity(archive: ArrayBuffer): Promise<SPKResult<IntegrityReport>>;

  // ========================================================================
  // Telemetry & Diagnostics
  // ========================================================================

  /**
   * Subscribe to telemetry updates
   * @param callback - Telemetry callback
   * @returns Unsubscribe function
   */
  subscribeTelemetry(callback: TelemetryCallback): () => void;

  /**
   * Get coordinator state
   */
  getCoordinatorState(): CoordinatorState;

  /**
   * Get diagnostics report
   */
  getDiagnostics(): Promise<DiagnosticsReport>;
}

// ============================================================================
// Supporting Types
// ============================================================================

/**
 * SPK configuration
 */
export interface SPKConfig {
  /** Number of worker threads */
  workerCount?: number;
  /** Maximum memory usage in bytes */
  maxMemory?: number;
  /** Enable telemetry */
  enableTelemetry?: boolean;
  /** Default compression level */
  defaultCompressionLevel?: number;
  /** Default chunk size */
  defaultChunkSize?: number;
  /** Enable deduplication by default */
  defaultDedup?: boolean;
  /** WASM module URL */
  wasmUrl?: string;
  /** API endpoint for sharing */
  apiEndpoint?: string;
}

/**
 * Progress callback
 */
export type ProgressCallback = (progress: ProgressEvent) => void;

/**
 * Telemetry callback
 */
export type TelemetryCallback = (update: TelemetryUpdate) => void;

/**
 * Share options
 */
export interface ShareOptions {
  /** Expiration time in hours (default: 24) */
  expiresIn?: number;
  /** Maximum download count */
  maxDownloads?: number;
  /** Password protect share */
  password?: string;
  /** Custom share name */
  name?: string;
}

/**
 * Share result
 */
export interface ShareResult {
  /** Share ID */
  id: string;
  /** Share URL */
  url: string;
  /** Expiration timestamp */
  expiresAt: string;
  /** Maximum downloads */
  maxDownloads: number;
  /** Password protected */
  passwordProtected: boolean;
}

/**
 * Share info
 */
export interface ShareInfo {
  /** Share ID */
  id: string;
  /** Archive name */
  name: string;
  /** Archive size */
  size: number;
  /** File count */
  fileCount: number;
  /** Creation timestamp */
  createdAt: string;
  /** Expiration timestamp */
  expiresAt: string;
  /** Download count */
  downloadCount: number;
  /** Maximum downloads */
  maxDownloads: number;
  /** Password protected */
  passwordProtected: boolean;
}

/**
 * History entry
 */
export interface HistoryEntry {
  /** Entry ID */
  id: string;
  /** Operation type */
  type: 'compress' | 'decompress' | 'share';
  /** Timestamp */
  timestamp: string;
  /** File names */
  files: string[];
  /** Original total size */
  originalSize: number;
  /** Compressed size (if applicable) */
  compressedSize?: number;
  /** Compression ratio */
  ratio?: number;
  /** Duration in ms */
  durationMs: number;
  /** Archive summary */
  summary?: ManifestSummary;
}

/**
 * Integrity verification report
 */
export interface IntegrityReport {
  /** Overall validity */
  valid: boolean;
  /** Archive version */
  version: string;
  /** Header checksum valid */
  headerValid: boolean;
  /** Manifest checksum valid */
  manifestValid: boolean;
  /** Chunk checksums valid */
  chunksValid: boolean;
  /** Failed chunk indices (if any) */
  failedChunks: number[];
  /** Verification time in ms */
  verificationTimeMs: number;
}

/**
 * Diagnostics report
 */
export interface DiagnosticsReport {
  /** Engine version */
  version: string;
  /** WASM loaded */
  wasmLoaded: boolean;
  /** WASM version */
  wasmVersion?: string;
  /** Worker count */
  workerCount: number;
  /** Active workers */
  activeWorkers: number;
  /** Memory usage */
  memoryUsage: MemoryUsage;
  /** Browser capabilities */
  capabilities: BrowserCapabilities;
  /** Recent errors */
  recentErrors: SPKError[];
  /** Uptime in ms */
  uptimeMs: number;
}

/**
 * Memory usage info
 */
export interface MemoryUsage {
  /** Used memory in bytes */
  used: number;
  /** Allocated memory in bytes */
  allocated: number;
  /** Peak memory in bytes */
  peak: number;
  /** Buffer pool usage */
  bufferPool: number;
}

/**
 * Browser capabilities
 */
export interface BrowserCapabilities {
  /** WASM supported */
  wasm: boolean;
  /** WASM SIMD supported */
  wasmSimd: boolean;
  /** WASM threads supported */
  wasmThreads: boolean;
  /** SharedArrayBuffer available */
  sharedArrayBuffer: boolean;
  /** Web Workers available */
  webWorkers: boolean;
  /** File System Access API available */
  fileSystemAccess: boolean;
  /** Compression Streams API available */
  compressionStreams: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * SPK event types
 */
export type SPKEvent =
  | { type: 'initialized' }
  | { type: 'shutdown' }
  | { type: 'compression-started'; operationId: string }
  | { type: 'compression-progress'; operationId: string; progress: ProgressEvent }
  | { type: 'compression-completed'; operationId: string; result: CompressionResult }
  | { type: 'compression-failed'; operationId: string; error: SPKError }
  | { type: 'decompression-started'; operationId: string }
  | { type: 'decompression-progress'; operationId: string; progress: ProgressEvent }
  | { type: 'decompression-completed'; operationId: string; files: ExtractedFile[] }
  | { type: 'decompression-failed'; operationId: string; error: SPKError }
  | { type: 'worker-ready'; workerId: string }
  | { type: 'worker-error'; workerId: string; error: SPKError }
  | { type: 'memory-warning'; usedMemory: number; limit: number };

/**
 * SPK event callback
 */
export type SPKEventCallback = (event: SPKEvent) => void;

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create SPK instance
 * This is the main entry point
 */
export type CreateSPK = (config?: SPKConfig) => Promise<SPK>;

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Required<SPKConfig> = {
  workerCount: navigator.hardwareConcurrency || 4,
  maxMemory: 512 * 1024 * 1024, // 512MB
  enableTelemetry: true,
  defaultCompressionLevel: 3,
  defaultChunkSize: 4 * 1024 * 1024, // 4MB
  defaultDedup: true,
  wasmUrl: '/spk_core.wasm',
  apiEndpoint: 'https://api.singularitypack.com',
};

/**
 * Merge config with defaults
 */
export function mergeConfig(config?: SPKConfig): Required<SPKConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}
