/**
 * SPK V45 - Manifest + Chunk Table Types
 * Type definitions for archive metadata structures
 */

// ============================================================================
// PART 5 — MANIFEST + CHUNK TABLE TYPES
// ============================================================================

/**
 * Information about a single chunk
 */
export interface ChunkInfo {
  /** Chunk index (0-based) */
  index: number;
  /** Offset in archive file */
  offset: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Original size in bytes */
  originalSize: number;
  /** SHA-256 hash of compressed data */
  hash: string;
  /** Compression algorithm used */
  algorithm: CompressionAlgorithm;
  /** Whether chunk is encrypted */
  encrypted: boolean;
  /** Encryption IV (if encrypted) */
  iv?: string;
  /** Reference count for dedup */
  refCount: number;
}

/**
 * Supported compression algorithms
 */
export type CompressionAlgorithm =
  | 'zstd'
  | 'lz4'
  | 'brotli'
  | 'none';

/**
 * File entry in manifest
 */
export interface FileEntry {
  /** Unique file ID */
  id: string;
  /** Original file path */
  path: string;
  /** Original file name */
  name: string;
  /** File size in bytes */
  size: number;
  /** File MIME type */
  mimeType: string;
  /** Last modified timestamp (ISO 8601) */
  modifiedAt: string;
  /** Created timestamp (ISO 8601) */
  createdAt?: string;
  /** Chunk indices belonging to this file */
  chunks: number[];
  /** File attributes */
  attributes: FileAttributes;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * File attributes
 */
export interface FileAttributes {
  /** Read-only flag */
  readonly: boolean;
  /** Hidden flag */
  hidden: boolean;
  /** System file flag */
  system: boolean;
  /** Is directory */
  isDirectory: boolean;
  /** Is symbolic link */
  isSymlink: boolean;
  /** Symlink target (if symlink) */
  symlinkTarget?: string;
  /** UNIX permissions (octal) */
  permissions?: number;
  /** Owner UID */
  uid?: number;
  /** Owner GID */
  gid?: number;
}

/**
 * Manifest summary (header information)
 */
export interface ManifestSummary {
  /** Archive format version */
  version: string;
  /** Archive creation timestamp */
  createdAt: string;
  /** Total number of files */
  totalFiles: number;
  /** Total number of directories */
  totalDirectories: number;
  /** Total original size */
  totalOriginalSize: number;
  /** Total compressed size */
  totalCompressedSize: number;
  /** Compression ratio (original / compressed) */
  compressionRatio: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Number of unique chunks (after dedup) */
  uniqueChunks: number;
  /** Space saved by dedup */
  dedupSavings: number;
  /** Default chunk size used */
  chunkSize: number;
  /** Compression algorithm used */
  algorithm: CompressionAlgorithm;
  /** Compression level used */
  compressionLevel: number;
  /** Whether archive is encrypted */
  encrypted: boolean;
  /** Encryption method (if encrypted) */
  encryptionMethod?: EncryptionMethod;
  /** Archive checksum */
  checksum: string;
  /** Checksum algorithm */
  checksumAlgorithm: 'sha256' | 'xxhash64';
  /** Optional archive comment */
  comment?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Encryption methods
 */
export type EncryptionMethod =
  | 'aes-256-gcm'
  | 'chacha20-poly1305';

/**
 * Full manifest structure
 */
export interface Manifest {
  /** Manifest summary/header */
  summary: ManifestSummary;
  /** File entries */
  files: FileEntry[];
  /** Chunk table */
  chunks: ChunkInfo[];
  /** Directory structure */
  directories: DirectoryEntry[];
}

/**
 * Directory entry
 */
export interface DirectoryEntry {
  /** Directory path */
  path: string;
  /** Directory name */
  name: string;
  /** Parent directory path */
  parent: string | null;
  /** Child file IDs */
  fileIds: string[];
  /** Child directory paths */
  subdirectories: string[];
  /** Directory attributes */
  attributes: FileAttributes;
}

/**
 * Chunk table for binary format
 */
export interface ChunkTable {
  /** Table format version */
  version: number;
  /** Number of entries */
  count: number;
  /** Total table size in bytes */
  tableSize: number;
  /** Chunk entries */
  entries: ChunkTableEntry[];
}

/**
 * Binary chunk table entry
 * Optimized for fast lookup
 */
export interface ChunkTableEntry {
  /** Chunk offset in archive */
  offset: number;
  /** Compressed size */
  compressedSize: number;
  /** Original size */
  originalSize: number;
  /** Hash (first 8 bytes of SHA-256) */
  hashPrefix: bigint;
  /** Flags (encrypted, algorithm, etc.) */
  flags: number;
}

/**
 * Chunk table flags
 */
export const CHUNK_FLAGS = {
  ENCRYPTED: 0x01,
  DEDUP_REF: 0x02,
  ALGORITHM_ZSTD: 0x00,
  ALGORITHM_LZ4: 0x10,
  ALGORITHM_BROTLI: 0x20,
  ALGORITHM_NONE: 0x30,
} as const;

// ============================================================================
// Manifest Utilities
// ============================================================================

/**
 * Create empty manifest
 */
export function createEmptyManifest(): Manifest {
  return {
    summary: createEmptySummary(),
    files: [],
    chunks: [],
    directories: [],
  };
}

/**
 * Create empty summary
 */
export function createEmptySummary(): ManifestSummary {
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalFiles: 0,
    totalDirectories: 0,
    totalOriginalSize: 0,
    totalCompressedSize: 0,
    compressionRatio: 1,
    totalChunks: 0,
    uniqueChunks: 0,
    dedupSavings: 0,
    chunkSize: 4 * 1024 * 1024, // 4MB default
    algorithm: 'zstd',
    compressionLevel: 3,
    encrypted: false,
    checksum: '',
    checksumAlgorithm: 'sha256',
  };
}

/**
 * Calculate manifest statistics
 */
export function calculateManifestStats(manifest: Manifest): ManifestStats {
  const uniqueHashes = new Set(manifest.chunks.map(c => c.hash));
  const duplicateChunks = manifest.chunks.length - uniqueHashes.size;
  const duplicateSavings = manifest.chunks
    .filter(c => c.refCount > 1)
    .reduce((sum, c) => sum + c.originalSize * (c.refCount - 1), 0);

  return {
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    chunkCount: manifest.chunks.length,
    uniqueChunkCount: uniqueHashes.size,
    duplicateChunkCount: duplicateChunks,
    totalOriginalSize: manifest.summary.totalOriginalSize,
    totalCompressedSize: manifest.summary.totalCompressedSize,
    spaceSavedByCompression: manifest.summary.totalOriginalSize - manifest.summary.totalCompressedSize,
    spaceSavedByDedup: duplicateSavings,
    averageChunkSize: manifest.chunks.length > 0
      ? manifest.summary.totalOriginalSize / manifest.chunks.length
      : 0,
    largestFile: Math.max(...manifest.files.map(f => f.size), 0),
    smallestFile: manifest.files.length > 0
      ? Math.min(...manifest.files.map(f => f.size))
      : 0,
  };
}

/**
 * Manifest statistics
 */
export interface ManifestStats {
  fileCount: number;
  directoryCount: number;
  chunkCount: number;
  uniqueChunkCount: number;
  duplicateChunkCount: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  spaceSavedByCompression: number;
  spaceSavedByDedup: number;
  averageChunkSize: number;
  largestFile: number;
  smallestFile: number;
}

/**
 * Validate manifest integrity
 */
export function validateManifest(manifest: Manifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check version
  if (!manifest.summary.version) {
    errors.push('Missing manifest version');
  }

  // Check files reference valid chunks
  for (const file of manifest.files) {
    for (const chunkIndex of file.chunks) {
      if (chunkIndex < 0 || chunkIndex >= manifest.chunks.length) {
        errors.push(`File "${file.path}" references invalid chunk index ${chunkIndex}`);
      }
    }
  }

  // Check chunk offsets are ordered
  let lastOffset = -1;
  for (const chunk of manifest.chunks) {
    if (chunk.offset <= lastOffset) {
      warnings.push(`Chunk ${chunk.index} has non-sequential offset`);
    }
    lastOffset = chunk.offset;
  }

  // Check compression ratio
  if (manifest.summary.compressionRatio < 0.01) {
    warnings.push('Unusually high compression ratio detected');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Manifest validation result
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Find file by path
 */
export function findFileByPath(manifest: Manifest, path: string): FileEntry | undefined {
  return manifest.files.find(f => f.path === path);
}

/**
 * Find file by ID
 */
export function findFileById(manifest: Manifest, id: string): FileEntry | undefined {
  return manifest.files.find(f => f.id === id);
}

/**
 * Get chunks for file
 */
export function getChunksForFile(manifest: Manifest, fileId: string): ChunkInfo[] {
  const file = findFileById(manifest, fileId);
  if (!file) return [];
  return file.chunks.map(index => manifest.chunks[index]).filter(Boolean);
}

/**
 * List files in directory
 */
export function listFilesInDirectory(manifest: Manifest, dirPath: string): FileEntry[] {
  const dir = manifest.directories.find(d => d.path === dirPath);
  if (!dir) return [];
  return dir.fileIds.map(id => findFileById(manifest, id)).filter((f): f is FileEntry => f !== undefined);
}
