/**
 * SPK Implementation Blueprint - Runtime Types
 * 
 * Core type definitions for the SPK runtime API.
 * Defines contracts for compression, decompression, and metadata operations.
 * 
 * @module core/runtime/types
 * @version 1.0.0
 */

// ============================================================================
// Core API Types
// ============================================================================

export interface SPKConfig {
  workerCount: number;
  chunkSize: number;
  defaultCompressionLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  enableAI: boolean;
  enableEncryption: boolean;
  enableRecovery: boolean;
  cacheSizeLimit: number;
}

export interface CompressOptions {
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  chunkSize?: number;
  workerCount?: number;
  encryption?: EncryptionConfig;
  metadata?: Record<string, string>;
  aiOptimization?: boolean;
  onProgress?: (progress: ProgressEvent) => void;
}

export interface DecompressOptions {
  targetFiles?: string[];
  verifyIntegrity?: boolean;
  decryption?: EncryptionConfig;
  workerCount?: number;
  onProgress?: (progress: ProgressEvent) => void;
}

export interface EncryptionConfig {
  enabled: boolean;
  password?: string;
  algorithm?: 'AES-256-GCM' | 'ChaCha20-Poly1305';
}

export interface ProgressEvent {
  stage: 'scanning' | 'compressing' | 'writing' | 'verifying' | 'complete';
  bytesProcessed: number;
  bytesTotal: number;
  filesProcessed: number;
  filesTotal: number;
  chunksProcessed: number;
  chunksTotal: number;
  throughputBps: number;
  estimatedTimeRemaining: number;
  percentComplete: number;
  currentFile?: string;
}

export interface CompressResult {
  success: boolean;
  archiveId: string;
  blob: Blob;
  stats: CompressionStats;
  metadata: ArchiveInfo;
  error?: string;
}

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  savedBytes: number;
  savedPercentage: number;
  duration: number;
  throughput: number;
  filesProcessed: number;
  chunksProcessed: number;
}

export interface ArchiveInfo {
  id: string;
  created: number;
  version: string;
  fileCount: number;
  totalSize: number;
  compressedSize: number;
  encrypted: boolean;
  metadata?: Record<string, any>;
}

export interface DecompressResult {
  success: boolean;
  files: ExtractedFile[];
  stats: DecompressionStats;
  verified: boolean;
  error?: string;
}

export interface ExtractedFile {
  path: string;
  blob: Blob;
  size: number;
  modified: number;
  checksum: string;
}

export interface DecompressionStats {
  bytesRead: number;
  bytesWritten: number;
  filesExtracted: number;
  duration: number;
  throughput: number;
  verified: boolean;
}

// ============================================================================
// Preview & Metadata
// ============================================================================

export interface PreviewOptions {
  maxFiles?: number;
  includeMetadata?: boolean;
  includeThumbnails?: boolean;
}

export interface ArchivePreview {
  files: FilePreview[];
  metadata: ArchiveInfo;
  totalSize: number;
  fileCount: number;
}

export interface FilePreview {
  path: string;
  size: number;
  compressedSize: number;
  modified: number;
  type: string;
  thumbnail?: string;
}

// ============================================================================
// Sharing
// ============================================================================

export interface ShareOptions {
  mode: 'link' | 'p2p' | 'cloud';
  expiration?: number;
  password?: string;
  maxDownloads?: number;
  allowPreview?: boolean;
}

export interface ShareToken {
  token: string;
  url: string;
  expiration: number;
  created: number;
  archiveId: string;
  options: ShareOptions;
}

export interface ShareStats {
  downloads: number;
  views: number;
  lastAccessed: number;
  active: boolean;
}

// ============================================================================
// History
// ============================================================================

export interface HistoryEntry {
  id: string;
  type: 'compress' | 'decompress' | 'share';
  timestamp: number;
  archiveId?: string;
  files: string[];
  size: number;
  duration: number;
  success: boolean;
  error?: string;
}

export interface HistoryOptions {
  limit?: number;
  startDate?: number;
  endDate?: number;
  type?: 'compress' | 'decompress' | 'share';
}

// ============================================================================
// Security
// ============================================================================

export interface SecurityOptions {
  encryption?: EncryptionConfig;
  signature?: boolean;
  verifyIntegrity?: boolean;
}

export interface SignatureInfo {
  algorithm: string;
  signature: string;
  publicKey?: string;
  timestamp: number;
}

export interface IntegrityReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  verified: number;
  total: number;
}

// ============================================================================
// Jobs & Status
// ============================================================================

export interface JobInfo {
  id: string;
  type: 'compress' | 'decompress';
  state: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: ProgressEvent;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface SystemStatus {
  ready: boolean;
  workerCount: number;
  activeJobs: number;
  cacheSize: number;
  memoryUsage: number;
  version: string;
}

// ============================================================================
// Events
// ============================================================================

export type EventType =
  | 'compress-start'
  | 'compress-progress'
  | 'compress-complete'
  | 'compress-error'
  | 'decompress-start'
  | 'decompress-progress'
  | 'decompress-complete'
  | 'decompress-error'
  | 'share-created'
  | 'share-accessed'
  | 'worker-ready'
  | 'worker-error'
  | 'ai-optimization'
  | 'status-change';

export interface Event<T = any> {
  type: EventType;
  timestamp: number;
  data: T;
  jobId?: string;
}

export type EventListener<T = any> = (event: Event<T>) => void;

// ============================================================================
// Errors
// ============================================================================

export type ErrorCode =
  | 'NOT_INITIALIZED'
  | 'INVALID_INPUT'
  | 'COMPRESSION_FAILED'
  | 'DECOMPRESSION_FAILED'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'OUT_OF_MEMORY'
  | 'WORKER_ERROR'
  | 'NETWORK_ERROR'
  | 'PERMISSION_DENIED'
  | 'FILE_NOT_FOUND'
  | 'INVALID_ARCHIVE'
  | 'OPERATION_CANCELLED'
  | 'UNKNOWN_ERROR';

export interface SPKError {
  code: ErrorCode;
  message: string;
  details?: any;
  timestamp: number;
  recoverable: boolean;
}

// ============================================================================
// Exports
// ============================================================================

// All types are exported via named exports above
