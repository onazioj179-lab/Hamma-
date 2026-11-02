/**
 * SPK V45 - Core API Types
 * Fundamental structures for the Unified API
 */

// ============================================================================
// PART 1 — CORE API TYPES
// ============================================================================

/**
 * File source type
 */
export type FileSourceType = 'file' | 'blob' | 'url' | 'buffer';

/**
 * File reference for compression input
 */
export type FileReference = {
  /** Unique identifier for the file */
  id: string;
  /** Original filename */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
  /** Source type */
  source?: FileSourceType;
};

/**
 * Compression mode
 */
export type CompressionMode = 'auto' | 'fast' | 'strong';

/**
 * Compression options
 */
export type CompressionOptions = {
  /** Chunk size in bytes (default: 4MB) */
  chunkSize: number;
  /** Compression mode */
  mode: CompressionMode;
  /** Enable encryption */
  encrypt?: boolean;
  /** Encryption password (required if encrypt is true) */
  password?: string;
};

/**
 * Request to start compression
 */
export type CompressionStartRequest = {
  /** Files to compress */
  files: FileReference[];
  /** Compression options */
  options: CompressionOptions;
};

/**
 * Compression result
 */
export type CompressionResult = {
  /** Compressed archive blob */
  blob: Blob;
  /** Original total size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (original / compressed) */
  ratio: number;
  /** Archive manifest summary */
  manifest: ManifestSummary;
};

/**
 * Request for decompression
 */
export type DecompressionRequest = {
  /** Archive blob to decompress */
  archive: Blob;
  /** Optional: specific files to extract (selective extraction) */
  targetFiles?: string[];
};

/**
 * Decompression result
 */
export type DecompressionResult = {
  /** Extracted files as blobs */
  files: Map<string, Blob>;
  /** Total extracted size */
  totalSize: number;
  /** Extraction duration in ms */
  duration: number;
};

/**
 * Archive information (metadata without extraction)
 */
export type ArchiveInfo = {
  /** Archive format version */
  version: string;
  /** Total number of files */
  fileCount: number;
  /** Total original size */
  originalSize: number;
  /** Compressed size */
  compressedSize: number;
  /** Compression ratio */
  ratio: number;
  /** Whether archive is encrypted */
  encrypted: boolean;
  /** Archive creation timestamp */
  createdAt: string;
  /** Archive checksum */
  checksum: string;
};

/**
 * Options for extraction
 */
export type ExtractionOptions = {
  /** Specific files to extract (empty = all) */
  targetFiles?: string[];
  /** Output directory path */
  outputPath?: string;
  /** Overwrite existing files */
  overwrite?: boolean;
  /** Decrypt with password */
  password?: string;
  /** Verify integrity before extraction */
  verifyIntegrity?: boolean;
};

/**
 * Extracted file result
 */
export type ExtractedFile = {
  /** File path */
  path: string;
  /** File name */
  name: string;
  /** File content as blob */
  blob: Blob;
  /** Original size */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Last modified date */
  modifiedAt: string;
};

// ============================================================================
// PART 5 — MANIFEST + CHUNK TABLE TYPES
// ============================================================================

/**
 * Information about a single chunk
 */
export type ChunkInfo = {
  /** Byte offset in archive */
  offset: number;
  /** Compressed length in bytes */
  length: number;
  /** Original uncompressed length */
  originalLength: number;
  /** SHA-256 hash for integrity verification */
  sha256: string;
};

/**
 * File entry in manifest
 */
export type FileEntry = {
  /** Unique file identifier */
  id: string;
  /** File name (with path) */
  name: string;
  /** Original file size */
  size: number;
  /** Index of first chunk containing this file */
  startChunk: number;
  /** Index of last chunk containing this file */
  endChunk: number;
};

/**
 * Manifest summary
 */
export type ManifestSummary = {
  /** All files in the archive */
  files: FileEntry[];
  /** Chunk table for random access */
  chunkTable: ChunkInfo[];
};

// ============================================================================
// Default Options
// ============================================================================

/**
 * Default compression options
 */
export const DEFAULT_COMPRESSION_OPTIONS: CompressionOptions = {
  chunkSize: 4 * 1024 * 1024, // 4MB
  mode: 'auto',
  encrypt: false,
};

/**
 * Minimum chunk size (1MB)
 */
export const MIN_CHUNK_SIZE = 1 * 1024 * 1024;

/**
 * Maximum chunk size (64MB)
 */
export const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

/**
 * Validate compression options
 */
export function validateCompressionOptions(
  options: Partial<CompressionOptions>
): CompressionOptions {
  const merged = { ...DEFAULT_COMPRESSION_OPTIONS, ...options };

  // Validate chunk size
  if (merged.chunkSize < MIN_CHUNK_SIZE) {
    merged.chunkSize = MIN_CHUNK_SIZE;
  }
  if (merged.chunkSize > MAX_CHUNK_SIZE) {
    merged.chunkSize = MAX_CHUNK_SIZE;
  }

  // Validate encryption
  if (merged.encrypt && (!merged.password || merged.password.length < 8)) {
    throw new Error('Encryption requires a password of at least 8 characters');
  }

  return merged;
}

/**
 * Create file reference from File object
 */
export function createFileReference(file: File): FileReference {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    source: 'file',
  };
}

/**
 * Create file references from FileList
 */
export function createFileReferences(files: FileList | File[]): FileReference[] {
  return Array.from(files).map(createFileReference);
}

/**
 * Create compression options with defaults
 */
export function createCompressionOptions(
  options: Partial<CompressionOptions> = {}
): CompressionOptions {
  return validateCompressionOptions(options);
}
