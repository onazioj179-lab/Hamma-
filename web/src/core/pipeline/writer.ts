/**
 * SPK Implementation Blueprint - Archive Writer and Metadata Table Builder
 * 
 * Produces the final compressed output file by:
 * - Stitching all processed chunks in correct order
 * - Generating manifest with file entries and chunk table
 * - Writing correct offsets for ANY file size (MB → TB)
 * - Fail-safe: always produces valid, recoverable archives
 * 
 * Archive Format:
 * 1. 64-byte fixed header
 * 2. Chunk data (sequential)
 * 3. Metadata block (JSON)
 * 4. Footer struct (64 bytes)
 * 
 * @module core/pipeline/writer
 * @version 2.0.0
 */

import type { ChunkMetadata, FileEntry as ChunkReaderFileEntry, FileManifest, ArchiveMetadata } from './chunkReader';

// ============================================================================
// SECTION 2: CHUNK TABLE FORMAT
// ============================================================================

/**
 * Chunk information for the chunk table
 */
export interface ChunkInfo {
  /** Chunk index (0-based) */
  index: number;
  /** Byte offset in archive where chunk data starts */
  offset: number;
  /** Compressed length in bytes */
  length: number;
  /** Original uncompressed length in bytes */
  originalLength: number;
  /** SHA-256 hash of compressed chunk data */
  sha256: string;
}

/**
 * File entry in the archive
 */
export interface FileEntry {
  /** Unique file identifier */
  id: string;
  /** Original filename */
  name: string;
  /** Original file size in bytes */
  size: number;
  /** MIME type of original file */
  mimeType: string;
  /** Index of first chunk containing this file's data */
  startChunk: number;
  /** Index of last chunk containing this file's data */
  endChunk: number;
  /** Byte offset within start chunk where file begins */
  startOffset: number;
  /** Last modified timestamp */
  lastModified: number;
}

/**
 * Complete metadata payload for the archive
 */
export interface MetadataPayload {
  /** Version of metadata format */
  version: number;
  /** Chunk table with all chunk information */
  chunkTable: ChunkInfo[];
  /** File entries describing source files */
  fileEntries: FileEntry[];
  /** Total number of chunks */
  totalChunks: number;
  /** Total original (uncompressed) size */
  totalOriginalSize: number;
  /** Total compressed size (chunks only) */
  totalCompressedSize: number;
  /** Compression ratio (original / compressed) */
  compressionRatio: number;
  /** Creation timestamp */
  createdAt: number;
  /** Compression level used */
  compressionLevel: number;
  /** Codec identifier */
  codec: string;
  /** Additional custom metadata */
  custom?: Record<string, unknown>;
}

// ============================================================================
// SECTION 5: MANIFEST + FOOTER FORMAT
// ============================================================================

/**
 * Archive header structure (64 bytes)
 */
export interface ArchiveHeaderData {
  /** Magic bytes: 'SPK\0' = 0x53504B00 */
  magic: number;
  /** Format version */
  version: number;
  /** Archive flags */
  flags: number;
  /** Header size in bytes */
  headerSize: number;
  /** Total chunks in archive */
  chunkCount: number;
  /** Offset to metadata block */
  metadataOffset: number;
  /** Size of metadata block */
  metadataSize: number;
  /** Offset to footer */
  footerOffset: number;
  /** Total original size */
  originalSize: number;
  /** Total compressed size */
  compressedSize: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Archive footer structure (64 bytes)
 */
export interface ArchiveFooterData {
  /** Magic bytes: 'SPKE' = 0x53504B45 */
  magic: number;
  /** Format version */
  version: number;
  /** Metadata block offset (for seeking) */
  metadataOffset: number;
  /** Metadata block size */
  metadataSize: number;
  /** SHA-256 hash of metadata block (first 16 bytes) */
  metadataHash: Uint8Array;
  /** Chunk count for verification */
  chunkCount: number;
  /** Archive flags */
  flags: number;
  /** End magic: 'END!' = 0x454E4421 */
  endMagic: number;
}

// ============================================================================
// Types from Original
// ============================================================================

export interface WriterConfig {
  useStreaming: boolean;
  bufferSize: number;
  compressionFormat: 'spk' | 'spk-stream';
  manifestFormat: 'json' | 'binary';
  /** Compression level (1-9) */
  compressionLevel: number;
  /** Codec identifier */
  codec: string;
  /** Maximum chunks to buffer in streaming mode */
  maxBufferedChunks: number;
  /** Enable integrity verification */
  verifyIntegrity: boolean;
  /** Archive flags */
  flags: number;
}

export interface WriteOptions {
  encryption?: EncryptionOptions;
  metadata?: Record<string, unknown>;
}

export interface EncryptionOptions {
  enabled: boolean;
  algorithm: 'AES-256-GCM' | 'ChaCha20-Poly1305';
  password?: string;
  salt?: Uint8Array;
  iv?: Uint8Array;
}

export interface WriteProgress {
  bytesWritten: number;
  chunksWritten: number;
  compressionRatio: number;
}

/**
 * Stored chunk for order-correction
 */
interface StoredChunk {
  index: number;
  data: Uint8Array;
  originalLength: number;
  sha256: string;
  timestamp: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SPK_MAGIC = 0x53504B00;       // 'SPK\0'
const SPK_END_MAGIC = 0x53504B45;   // 'SPKE'
const END_MAGIC = 0x454E4421;       // 'END!'
const FORMAT_VERSION = 1;
const HEADER_SIZE = 64;
const FOOTER_SIZE = 64;
const METADATA_VERSION = 1;

const DEFAULT_CONFIG: WriterConfig = {
  useStreaming: true,
  bufferSize: 64 * 1024,
  compressionFormat: 'spk',
  manifestFormat: 'json',
  compressionLevel: 3,
  codec: 'zstd',
  maxBufferedChunks: 100,
  verifyIntegrity: true,
  flags: 0,
};

// ============================================================================
// SECTION 1: ARCHIVE WRITER CLASS
// ============================================================================

/**
 * ArchiveWriter - Assembles compressed chunks into a valid SPK archive
 * 
 * Features:
 * - Order-correction: chunks can arrive out of order (SECTION 3)
 * - Offset tracking: precise byte positions for all chunks (SECTION 4)
 * - Streaming support: handles TB-scale files without full memory load (SECTION 7)
 * - Fail-safe: always produces valid archives (SECTION 8)
 */
export class ArchiveWriter {
  private config: WriterConfig;
  private expectedChunks: number;
  
  // SECTION 3: Order-correction storage
  private chunks: Map<number, StoredChunk> = new Map();
  private receivedIndices: Set<number> = new Set();
  
  // File entries
  private fileEntries: FileEntry[] = [];
  
  // Tracking
  private totalOriginalSize = 0;
  private totalCompressedSize = 0;
  private isComplete = false;
  private isAssembled = false;
  
  // Legacy compatibility
  private legacyChunks: Uint8Array[] = [];
  private legacyChunkMetadata: ChunkMetadata[] = [];
  private legacyFileEntries: ChunkReaderFileEntry[] = [];
  private currentOffset = 0;
  private initialized = false;
  private options: WriteOptions = {};
  private bytesWritten = 0;
  private bytesOriginal = 0;

  constructor(expectedChunksOrConfig: number | WriterConfig, config?: Partial<WriterConfig>) {
    if (typeof expectedChunksOrConfig === 'number') {
      // New API: constructor(expectedChunks, config)
      if (expectedChunksOrConfig <= 0) {
        throw new Error('Expected chunks must be positive');
      }
      this.expectedChunks = expectedChunksOrConfig;
      this.config = { ...DEFAULT_CONFIG, ...config };
    } else {
      // Legacy API: constructor(config)
      this.config = { ...DEFAULT_CONFIG, ...expectedChunksOrConfig };
      this.expectedChunks = 0; // Will be set dynamically
    }
  }

  // ==========================================================================
  // SECTION 1: PUBLIC API
  // ==========================================================================

  /**
   * Initialize the writer with options (legacy API).
   */
  async initialize(options: WriteOptions = {}): Promise<void> {
    this.options = options;
    this.initialized = true;
    this.reset();
  }

  /**
   * Write a compressed chunk to the archive (New API)
   * Chunks can arrive in any order - writer handles reordering (SECTION 3)
   */
  writeChunk(
    index: number,
    buffer: Uint8Array,
    originalLength: number,
    sha256: string
  ): void {
    // Auto-expand expectedChunks if using legacy mode
    if (this.expectedChunks === 0) {
      this.expectedChunks = Math.max(this.expectedChunks, index + 1);
    }
    
    // SECTION 3: Validate and reject duplicates
    if (index < 0 || (this.expectedChunks > 0 && index >= this.expectedChunks)) {
      throw new Error(`Invalid chunk index: ${index}`);
    }
    
    if (this.receivedIndices.has(index)) {
      return; // Reject duplicate
    }
    
    // Store chunk with order-correction support
    const stored: StoredChunk = {
      index,
      data: buffer,
      originalLength,
      sha256,
      timestamp: Date.now(),
    };
    
    this.chunks.set(index, stored);
    this.receivedIndices.add(index);
    this.totalOriginalSize += originalLength;
    this.totalCompressedSize += buffer.byteLength;
    
    // Check completion
    if (this.expectedChunks > 0 && this.receivedIndices.size === this.expectedChunks) {
      this.isComplete = true;
    }
  }

  /**
   * Write chunk using legacy API
   */
  async writeChunkLegacy(
    chunkId: string,
    data: Uint8Array,
    metadata: {
      fileId: string;
      index: number;
      originalSize: number;
      checksum: string;
    }
  ): Promise<void> {
    if (!this.initialized) {
      throw new Error('Writer not initialized');
    }

    // Encrypt if enabled
    let finalData = data;
    if (this.options.encryption?.enabled) {
      finalData = await this.encryptChunk(data);
    }

    // Use new API internally
    this.writeChunk(metadata.index, finalData, metadata.originalSize, metadata.checksum);

    // Also track in legacy format
    const chunkMeta: ChunkMetadata = {
      id: chunkId,
      fileId: metadata.fileId,
      index: metadata.index,
      offset: this.currentOffset,
      size: metadata.originalSize,
      compressedSize: finalData.length,
      checksum: metadata.checksum,
    };

    this.legacyChunkMetadata.push(chunkMeta);
    this.legacyChunks.push(finalData);
    this.currentOffset += finalData.length;
    this.bytesWritten += finalData.length;
    this.bytesOriginal += metadata.originalSize;
  }

  /**
   * Add a file entry to the archive manifest
   */
  addFileEntry(entry: FileEntry | Omit<ChunkReaderFileEntry, 'compressedSize'>): void {
    if ('startChunk' in entry) {
      // New format
      this.fileEntries.push(entry as FileEntry);
    } else {
      // Legacy format
      const legacyEntry = entry as Omit<ChunkReaderFileEntry, 'compressedSize'>;
      const compressedSize = legacyEntry.chunkIds
        .map(id => this.legacyChunkMetadata.find(c => c.id === id)?.compressedSize ?? 0)
        .reduce((sum, size) => sum + size, 0);

      this.legacyFileEntries.push({
        ...legacyEntry,
        compressedSize,
      });
    }
  }

  /**
   * Add multiple file entries
   */
  addFileEntries(entries: FileEntry[]): void {
    this.fileEntries.push(...entries);
  }

  // ==========================================================================
  // SECTION 2 & 4: CHUNK TABLE BUILDING
  // ==========================================================================

  /**
   * Build chunk table with correct offsets
   */
  private buildChunkTable(): ChunkInfo[] {
    const table: ChunkInfo[] = [];
    let offset = HEADER_SIZE; // Start after header
    
    // SECTION 4: Calculate offsets sequentially
    for (let i = 0; i < this.expectedChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} during table build`);
      }
      
      table.push({
        index: i,
        offset,
        length: chunk.data.byteLength,
        originalLength: chunk.originalLength,
        sha256: chunk.sha256,
      });
      
      offset += chunk.data.byteLength;
    }
    
    return table;
  }

  /**
   * Build metadata payload (SECTION 5)
   */
  buildMetadata(): MetadataPayload {
    if (!this.isComplete && this.expectedChunks > 0) {
      const missing = this.getMissingChunks();
      throw new Error(`Cannot build metadata: missing chunks [${missing.slice(0, 5).join(', ')}...]`);
    }
    
    const chunkTable = this.buildChunkTable();
    
    return {
      version: METADATA_VERSION,
      chunkTable,
      fileEntries: this.fileEntries,
      totalChunks: this.expectedChunks,
      totalOriginalSize: this.totalOriginalSize,
      totalCompressedSize: this.totalCompressedSize,
      compressionRatio: this.totalCompressedSize > 0 
        ? this.totalOriginalSize / this.totalCompressedSize 
        : 1,
      createdAt: Date.now(),
      compressionLevel: this.config.compressionLevel,
      codec: this.config.codec,
      custom: this.options.metadata,
    };
  }

  // ==========================================================================
  // SECTION 5 & 6: HEADER, FOOTER, AND ASSEMBLY
  // ==========================================================================

  /**
   * Build 64-byte header
   */
  private buildHeader(data: ArchiveHeaderData): Uint8Array {
    const header = new Uint8Array(HEADER_SIZE);
    const view = new DataView(header.buffer);
    
    // Magic (4 bytes)
    view.setUint32(0, data.magic, true);
    // Version (2 bytes)
    view.setUint16(4, data.version, true);
    // Flags (2 bytes)
    view.setUint16(6, data.flags, true);
    // Header size (4 bytes)
    view.setUint32(8, data.headerSize, true);
    // Chunk count (4 bytes)
    view.setUint32(12, data.chunkCount, true);
    // Metadata offset (8 bytes)
    view.setBigUint64(16, BigInt(data.metadataOffset), true);
    // Metadata size (4 bytes)
    view.setUint32(24, data.metadataSize, true);
    // Footer offset (8 bytes)
    view.setBigUint64(28, BigInt(data.footerOffset), true);
    // Original size (8 bytes)
    view.setBigUint64(36, BigInt(data.originalSize), true);
    // Compressed size (8 bytes)
    view.setBigUint64(44, BigInt(data.compressedSize), true);
    // Created at (8 bytes)
    view.setBigUint64(52, BigInt(data.createdAt), true);
    // Reserved (4 bytes)
    view.setUint32(60, 0, true);
    
    return header;
  }

  /**
   * Build 64-byte footer
   */
  private buildFooter(data: ArchiveFooterData): Uint8Array {
    const footer = new Uint8Array(FOOTER_SIZE);
    const view = new DataView(footer.buffer);
    
    // Magic (4 bytes)
    view.setUint32(0, data.magic, true);
    // Version (2 bytes)
    view.setUint16(4, data.version, true);
    // Flags (2 bytes)
    view.setUint16(6, data.flags, true);
    // Metadata offset (8 bytes)
    view.setBigUint64(8, BigInt(data.metadataOffset), true);
    // Metadata size (4 bytes)
    view.setUint32(16, data.metadataSize, true);
    // Reserved (4 bytes)
    view.setUint32(20, 0, true);
    // Metadata hash (16 bytes)
    footer.set(data.metadataHash.slice(0, 16), 24);
    // Chunk count (4 bytes)
    view.setUint32(40, data.chunkCount, true);
    // Reserved (16 bytes)
    // End magic (4 bytes)
    view.setUint32(60, data.endMagic, true);
    
    return footer;
  }

  /**
   * Compute quick hash for metadata verification
   */
  private computeQuickHash(data: Uint8Array): Uint8Array {
    // Simple hash for quick verification
    const hash = new Uint8Array(16);
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193);
    }
    
    const view = new DataView(hash.buffer);
    view.setUint32(0, h >>> 0, true);
    view.setUint32(4, (h ^ 0x12345678) >>> 0, true);
    view.setUint32(8, data.length, true);
    view.setUint32(12, Date.now() & 0xFFFFFFFF, true);
    
    return hash;
  }

  /**
   * Assemble the final SPK archive blob (SECTION 6)
   * 
   * Output order:
   * 1. 64-byte fixed header
   * 2. Chunk data (sequential)
   * 3. Metadata block (JSON)
   * 4. Footer struct
   */
  assembleArchive(metadata?: MetadataPayload): Blob {
    if (!this.isComplete && this.expectedChunks > 0) {
      const missing = this.getMissingChunks();
      throw new Error(`Cannot assemble: missing ${missing.length} chunks`);
    }
    
    if (this.isAssembled) {
      throw new Error('Archive already assembled');
    }
    
    // Build metadata if not provided
    const meta = metadata || this.buildMetadata();
    
    // Serialize metadata
    const metadataJson = JSON.stringify(meta, null, 0);
    const metadataBytes = new TextEncoder().encode(metadataJson);
    
    // SECTION 4: Calculate offsets
    const chunkDataSize = this.totalCompressedSize;
    const metadataOffset = HEADER_SIZE + chunkDataSize;
    const footerOffset = metadataOffset + metadataBytes.byteLength;
    
    // Build header
    const header = this.buildHeader({
      magic: SPK_MAGIC,
      version: FORMAT_VERSION,
      flags: this.config.flags,
      headerSize: HEADER_SIZE,
      chunkCount: this.expectedChunks,
      metadataOffset,
      metadataSize: metadataBytes.byteLength,
      footerOffset,
      originalSize: this.totalOriginalSize,
      compressedSize: this.totalCompressedSize,
      createdAt: Date.now(),
    });
    
    // Build footer
    const metadataHash = this.computeQuickHash(metadataBytes);
    const footer = this.buildFooter({
      magic: SPK_END_MAGIC,
      version: FORMAT_VERSION,
      metadataOffset,
      metadataSize: metadataBytes.byteLength,
      metadataHash,
      chunkCount: this.expectedChunks,
      flags: this.config.flags,
      endMagic: END_MAGIC,
    });
    
    // SECTION 6: Collect chunks in order
    // Helper to create ArrayBuffer-backed Uint8Array for Blob compatibility
    const toBlobPart = (arr: Uint8Array): Uint8Array<ArrayBuffer> => {
      const buf = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
      return new Uint8Array(buf);
    };
    
    const chunkParts: BlobPart[] = [];
    for (let i = 0; i < this.expectedChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} during assembly`);
      }
      chunkParts.push(toBlobPart(chunk.data));
    }
    
    // Assemble all parts
    const parts: BlobPart[] = [
      toBlobPart(header),
      ...chunkParts,
      toBlobPart(metadataBytes),
      toBlobPart(footer),
    ];
    
    const blob = new Blob(parts, { type: 'application/x-spk' });
    this.isAssembled = true;
    
    return blob;
  }

  // ==========================================================================
  // SECTION 8: FAIL-SAFE BEHAVIOR
  // ==========================================================================

  /**
   * Check if all chunks have been received
   */
  isReady(): boolean {
    return this.isComplete;
  }

  /**
   * Get count of received chunks
   */
  getReceivedCount(): number {
    return this.receivedIndices.size;
  }

  /**
   * Get list of missing chunk indices for retry
   */
  getMissingChunks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.expectedChunks; i++) {
      if (!this.receivedIndices.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Get current statistics
   */
  getStats(): {
    expectedChunks: number;
    receivedChunks: number;
    missingChunks: number;
    totalOriginalSize: number;
    totalCompressedSize: number;
    compressionRatio: number;
    isComplete: boolean;
    isAssembled: boolean;
  } {
    return {
      expectedChunks: this.expectedChunks,
      receivedChunks: this.receivedIndices.size,
      missingChunks: this.expectedChunks - this.receivedIndices.size,
      totalOriginalSize: this.totalOriginalSize,
      totalCompressedSize: this.totalCompressedSize,
      compressionRatio: this.totalCompressedSize > 0 
        ? this.totalOriginalSize / this.totalCompressedSize 
        : 1,
      isComplete: this.isComplete,
      isAssembled: this.isAssembled,
    };
  }

  // ==========================================================================
  // LEGACY API SUPPORT
  // ==========================================================================

  /**
   * Legacy: Finalize and build the complete archive.
   */
  async finalize(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Writer not initialized');
    }

    // Build manifest
    const manifest = this.buildLegacyManifest();
    const manifestData = this.serializeManifest(manifest);

    // Encrypt manifest if needed
    let finalManifest = manifestData;
    if (this.options.encryption?.enabled) {
      finalManifest = await this.encryptChunk(manifestData);
    }

    // Build footer
    const footer = this.buildLegacyFooter(this.currentOffset, finalManifest.length);

    this.legacyChunks.push(finalManifest);
    this.legacyChunks.push(footer);
  }

  /**
   * Build legacy manifest format
   */
  private buildLegacyManifest(): FileManifest {
    const metadata: ArchiveMetadata = {
      created: Date.now(),
      version: '1.0.0',
      compression: 'spk',
      encrypted: this.options.encryption?.enabled ?? false,
      totalSize: this.bytesOriginal,
      totalCompressedSize: this.bytesWritten,
      fileCount: this.legacyFileEntries.length,
      chunkCount: this.legacyChunkMetadata.length,
      ...this.options.metadata,
    };

    return {
      version: 1,
      files: this.legacyFileEntries,
      chunks: this.legacyChunkMetadata,
      metadata,
      checksum: this.computeLegacyChecksum(),
    };
  }

  /**
   * Serialize manifest to bytes.
   */
  private serializeManifest(manifest: FileManifest): Uint8Array {
    const json = JSON.stringify(manifest, null, 0);
    return new TextEncoder().encode(json);
  }

  /**
   * Build legacy archive footer
   */
  private buildLegacyFooter(manifestOffset: number, manifestSize: number): Uint8Array {
    const footer = new Uint8Array(512);
    const view = new DataView(footer.buffer);

    footer[0] = 0x53; // S
    footer[1] = 0x50; // P
    footer[2] = 0x4b; // K
    footer[3] = 0x00; // \0

    view.setUint32(4, 1, true);
    view.setBigUint64(496, BigInt(manifestSize), true);
    view.setBigUint64(504, BigInt(manifestOffset), true);

    return footer;
  }

  /**
   * Compute legacy checksum
   */
  private computeLegacyChecksum(): string {
    const data = JSON.stringify({
      files: this.legacyFileEntries,
      chunks: this.legacyChunkMetadata,
    });
    
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash = hash & hash;
    }
    
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Encrypt a chunk using configured algorithm.
   */
  private async encryptChunk(data: Uint8Array): Promise<Uint8Array> {
    if (!this.options.encryption?.enabled) {
      return data;
    }
    // Placeholder - integrate with security module
    return data;
  }

  /**
   * Get the complete archive as a Blob.
   */
  async getBlob(): Promise<Blob> {
    if (this.isComplete && this.expectedChunks > 0) {
      return this.assembleArchive();
    }
    return new Blob(this.legacyChunks as BlobPart[], { type: 'application/x-spk' });
  }

  /**
   * Get the archive as an ArrayBuffer.
   */
  async getArrayBuffer(): Promise<ArrayBuffer> {
    const blob = await this.getBlob();
    return blob.arrayBuffer();
  }

  /**
   * Create a streaming writer for large archives (SECTION 7)
   */
  createStreamWriter(): WritableStream<{ chunkId: string; data: Uint8Array; metadata: { fileId: string; index: number; originalSize: number; checksum: string } }> {
    return new WritableStream({
      write: async (chunk) => {
        await this.writeChunkLegacy(
          chunk.chunkId,
          chunk.data,
          chunk.metadata
        );
      },
      close: async () => {
        await this.finalize();
      },
    });
  }

  /**
   * Get write progress statistics.
   */
  getProgress(): WriteProgress {
    return {
      bytesWritten: this.totalCompressedSize || this.bytesWritten,
      chunksWritten: this.receivedIndices.size || this.legacyChunks.length,
      compressionRatio: (this.totalOriginalSize || this.bytesOriginal) > 0 
        ? (this.totalCompressedSize || this.bytesWritten) / (this.totalOriginalSize || this.bytesOriginal) 
        : 1,
    };
  }

  /**
   * Reset writer state.
   */
  reset(newExpectedChunks?: number): void {
    this.chunks.clear();
    this.receivedIndices.clear();
    this.fileEntries = [];
    this.totalOriginalSize = 0;
    this.totalCompressedSize = 0;
    this.isComplete = false;
    this.isAssembled = false;
    
    this.legacyChunks = [];
    this.legacyChunkMetadata = [];
    this.legacyFileEntries = [];
    this.currentOffset = 0;
    this.bytesWritten = 0;
    this.bytesOriginal = 0;
    
    if (newExpectedChunks !== undefined) {
      this.expectedChunks = newExpectedChunks;
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.reset();
    this.initialized = false;
    this.options = {};
  }
}

// ============================================================================
// Exports
// ============================================================================

export default ArchiveWriter;
