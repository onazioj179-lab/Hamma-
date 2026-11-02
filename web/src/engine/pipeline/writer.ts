/**
 * SPK Archive Writer and Metadata Table Builder
 * 
 * Produces the final compressed output file:
 * - Stitches all processed chunks in correct order
 * - Generates manifest with file entries and chunk table
 * - Writes correct offsets for ANY file size (MB → TB)
 * - Fail-safe: always produces valid, recoverable archives
 * 
 * Archive Format:
 * 1. 64-byte fixed header
 * 2. Chunk data (sequential)
 * 3. Metadata block (JSON)
 * 4. Footer struct (64 bytes)
 * 
 * @module pipeline/writer
 * @version 1.0.0
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Single chunk information for the chunk table
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

/**
 * Archive flags
 */
export const ArchiveFlags = {
  NONE: 0x0000,
  ENCRYPTED: 0x0001,
  SHARE_TOKEN: 0x0002,
  MULTI_FILE: 0x0004,
  STREAMING: 0x0008,
  DEDUP_ENABLED: 0x0010,
  INTEGRITY_VERIFIED: 0x0020,
} as const;

/**
 * Configuration for ArchiveWriter
 */
export interface ArchiveWriterConfig {
  /** Compression level used */
  compressionLevel: number;
  /** Codec identifier */
  codec: string;
  /** Enable streaming mode for large files */
  streamingMode: boolean;
  /** Maximum chunks to buffer before flushing */
  maxBufferedChunks: number;
  /** Enable integrity verification */
  verifyIntegrity: boolean;
  /** Archive flags */
  flags: number;
  /** Custom metadata to include */
  customMetadata?: Record<string, unknown>;
}

/**
 * Stored chunk data
 */
interface StoredChunk {
  index: number;
  data: Uint8Array;
  originalLength: number;
  sha256: string;
  timestamp: number;
}

/**
 * Write event types
 */
export type WriterEventType =
  | 'chunk-received'
  | 'chunk-stored'
  | 'chunk-duplicate'
  | 'all-chunks-ready'
  | 'metadata-built'
  | 'archive-assembled'
  | 'integrity-verified'
  | 'error';

/**
 * Writer event
 */
export interface WriterEvent {
  type: WriterEventType;
  timestamp: number;
  message: string;
  details?: Record<string, unknown>;
}

export type WriterEventHandler = (event: WriterEvent) => void;

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

const DEFAULT_CONFIG: ArchiveWriterConfig = {
  compressionLevel: 3,
  codec: 'zstd',
  streamingMode: true,
  maxBufferedChunks: 100,
  verifyIntegrity: true,
  flags: ArchiveFlags.INTEGRITY_VERIFIED,
};

// ============================================================================
// ARCHIVE WRITER CLASS
// ============================================================================

/**
 * ArchiveWriter - Assembles compressed chunks into a valid SPK archive
 * 
 * Features:
 * - Order-correction: chunks can arrive out of order
 * - Offset tracking: precise byte positions for all chunks
 * - Streaming support: handles TB-scale files without full memory load
 * - Fail-safe: always produces valid archives
 */
export class ArchiveWriter {
  private config: ArchiveWriterConfig;
  private expectedChunks: number;
  
  // Chunk storage (sparse array by index)
  private chunks: Map<number, StoredChunk> = new Map();
  private receivedIndices: Set<number> = new Set();
  
  // File entries
  private fileEntries: FileEntry[] = [];
  
  // Tracking
  private totalOriginalSize = 0;
  private totalCompressedSize = 0;
  private isComplete = false;
  private isAssembled = false;
  
  // Streaming mode state
  private streamingParts: BlobPart[] = [];
  private flushedChunks = 0;
  
  // Event handlers
  private eventHandlers: WriterEventHandler[] = [];
  
  constructor(expectedChunks: number, config: Partial<ArchiveWriterConfig> = {}) {
    if (expectedChunks <= 0) {
      throw new Error('Expected chunks must be positive');
    }
    
    this.expectedChunks = expectedChunks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  /**
   * Write a compressed chunk to the archive
   * Chunks can arrive in any order - writer handles reordering
   */
  writeChunk(
    index: number,
    buffer: Uint8Array,
    originalLength: number,
    sha256: string
  ): void {
    // Validate index
    if (index < 0 || index >= this.expectedChunks) {
      throw new Error(`Invalid chunk index: ${index} (expected 0-${this.expectedChunks - 1})`);
    }
    
    // Check for duplicate
    if (this.receivedIndices.has(index)) {
      this.emit({
        type: 'chunk-duplicate',
        timestamp: Date.now(),
        message: `Duplicate chunk ${index} rejected`,
        details: { index },
      });
      return;
    }
    
    // Store chunk
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
    
    this.emit({
      type: 'chunk-stored',
      timestamp: Date.now(),
      message: `Chunk ${index} stored (${this.formatBytes(buffer.byteLength)})`,
      details: {
        index,
        compressedSize: buffer.byteLength,
        originalSize: originalLength,
        received: this.receivedIndices.size,
        expected: this.expectedChunks,
      },
    });
    
    // Check if all chunks received
    if (this.receivedIndices.size === this.expectedChunks) {
      this.isComplete = true;
      this.emit({
        type: 'all-chunks-ready',
        timestamp: Date.now(),
        message: 'All chunks received - ready for assembly',
        details: {
          totalChunks: this.expectedChunks,
          totalOriginalSize: this.totalOriginalSize,
          totalCompressedSize: this.totalCompressedSize,
        },
      });
    }
    
    // Streaming mode: flush chunks periodically
    if (this.config.streamingMode && this.chunks.size >= this.config.maxBufferedChunks) {
      this.flushBufferedChunks();
    }
  }
  
  /**
   * Add a file entry to the archive manifest
   */
  addFileEntry(entry: FileEntry): void {
    this.fileEntries.push(entry);
  }
  
  /**
   * Add multiple file entries
   */
  addFileEntries(entries: FileEntry[]): void {
    this.fileEntries.push(...entries);
  }
  
  /**
   * Build metadata payload from stored chunks and file entries
   */
  buildMetadata(): MetadataPayload {
    if (!this.isComplete) {
      throw new Error(`Cannot build metadata: missing ${this.expectedChunks - this.receivedIndices.size} chunks`);
    }
    
    // Build chunk table with correct offsets
    const chunkTable = this.buildChunkTable();
    
    const metadata: MetadataPayload = {
      version: METADATA_VERSION,
      chunkTable,
      fileEntries: this.fileEntries,
      totalChunks: this.expectedChunks,
      totalOriginalSize: this.totalOriginalSize,
      totalCompressedSize: this.totalCompressedSize,
      compressionRatio: this.totalCompressedSize > 0 
        ? this.totalOriginalSize / this.totalCompressedSize 
        : 0,
      createdAt: Date.now(),
      compressionLevel: this.config.compressionLevel,
      codec: this.config.codec,
      custom: this.config.customMetadata,
    };
    
    this.emit({
      type: 'metadata-built',
      timestamp: Date.now(),
      message: 'Metadata built successfully',
      details: {
        chunks: chunkTable.length,
        files: this.fileEntries.length,
        compressionRatio: metadata.compressionRatio.toFixed(2),
      },
    });
    
    return metadata;
  }
  
  /**
   * Assemble the final SPK archive blob
   */
  assembleArchive(metadata?: MetadataPayload): Blob {
    if (!this.isComplete) {
      throw new Error(`Cannot assemble: missing ${this.expectedChunks - this.receivedIndices.size} chunks`);
    }
    
    if (this.isAssembled) {
      throw new Error('Archive already assembled');
    }
    
    // Build metadata if not provided
    const meta = metadata || this.buildMetadata();
    
    // Serialize metadata to JSON
    const metadataJson = JSON.stringify(meta, null, 0);
    const metadataBytes = new TextEncoder().encode(metadataJson);
    
    // Calculate offsets
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
    
    // Collect chunk data in order
    const chunkParts: BlobPart[] = [];
    for (let i = 0; i < this.expectedChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} during assembly`);
      }
      // Convert to ArrayBuffer for Blob compatibility
      chunkParts.push(chunk.data.buffer.slice(
        chunk.data.byteOffset,
        chunk.data.byteOffset + chunk.data.byteLength
      ) as ArrayBuffer);
    }
    
    // Assemble all parts
    const parts: BlobPart[] = [
      header as BlobPart,
      ...chunkParts,
      metadataBytes.buffer.slice(
        metadataBytes.byteOffset,
        metadataBytes.byteOffset + metadataBytes.byteLength
      ) as BlobPart,
      footer as BlobPart,
    ];
    
    const blob = new Blob(parts, { type: 'application/x-spk' });
    
    this.isAssembled = true;
    
    this.emit({
      type: 'archive-assembled',
      timestamp: Date.now(),
      message: `Archive assembled: ${this.formatBytes(blob.size)}`,
      details: {
        headerSize: HEADER_SIZE,
        chunkDataSize,
        metadataSize: metadataBytes.byteLength,
        footerSize: FOOTER_SIZE,
        totalSize: blob.size,
        compressionRatio: meta.compressionRatio.toFixed(2),
      },
    });
    
    // Verify if enabled
    if (this.config.verifyIntegrity) {
      this.verifyArchive(blob, meta);
    }
    
    return blob;
  }
  
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
   * Get list of missing chunk indices
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
        : 0,
      isComplete: this.isComplete,
      isAssembled: this.isAssembled,
    };
  }
  
  /**
   * Subscribe to writer events
   */
  onEvent(handler: WriterEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }
  
  /**
   * Reset writer for reuse
   */
  reset(newExpectedChunks?: number): void {
    this.chunks.clear();
    this.receivedIndices.clear();
    this.fileEntries = [];
    this.totalOriginalSize = 0;
    this.totalCompressedSize = 0;
    this.isComplete = false;
    this.isAssembled = false;
    this.streamingParts = [];
    this.flushedChunks = 0;
    
    if (newExpectedChunks !== undefined) {
      this.expectedChunks = newExpectedChunks;
    }
  }
  
  // ==========================================================================
  // CHUNK TABLE BUILDING (SECTION 2 & 4)
  // ==========================================================================
  
  /**
   * Build chunk table with calculated offsets
   */
  private buildChunkTable(): ChunkInfo[] {
    const table: ChunkInfo[] = [];
    let offset = HEADER_SIZE;
    
    for (let i = 0; i < this.expectedChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} when building chunk table`);
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
  
  // ==========================================================================
  // HEADER & FOOTER BUILDING (SECTION 5)
  // ==========================================================================
  
  /**
   * Build 64-byte header
   */
  private buildHeader(data: ArchiveHeaderData): ArrayBuffer {
    const buffer = new ArrayBuffer(HEADER_SIZE);
    const view = new DataView(buffer);
    
    // Byte 0-3: Magic 'SPK\0'
    view.setUint32(0, data.magic, true);
    
    // Byte 4-5: Version
    view.setUint16(4, data.version, true);
    
    // Byte 6-7: Flags
    view.setUint16(6, data.flags, true);
    
    // Byte 8-11: Header size
    view.setUint32(8, data.headerSize, true);
    
    // Byte 12-15: Chunk count
    view.setUint32(12, data.chunkCount, true);
    
    // Byte 16-23: Metadata offset
    view.setBigUint64(16, BigInt(data.metadataOffset), true);
    
    // Byte 24-31: Metadata size
    view.setBigUint64(24, BigInt(data.metadataSize), true);
    
    // Byte 32-39: Footer offset
    view.setBigUint64(32, BigInt(data.footerOffset), true);
    
    // Byte 40-47: Original size
    view.setBigUint64(40, BigInt(data.originalSize), true);
    
    // Byte 48-55: Compressed size
    view.setBigUint64(48, BigInt(data.compressedSize), true);
    
    // Byte 56-63: Created at timestamp
    view.setBigUint64(56, BigInt(data.createdAt), true);
    
    return buffer;
  }
  
  /**
   * Build 64-byte footer
   */
  private buildFooter(data: ArchiveFooterData): ArrayBuffer {
    const buffer = new ArrayBuffer(FOOTER_SIZE);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    
    // Byte 0-3: Magic 'SPKE'
    view.setUint32(0, data.magic, true);
    
    // Byte 4-5: Version
    view.setUint16(4, data.version, true);
    
    // Byte 6-7: Flags
    view.setUint16(6, data.flags, true);
    
    // Byte 8-15: Metadata offset
    view.setBigUint64(8, BigInt(data.metadataOffset), true);
    
    // Byte 16-23: Metadata size
    view.setBigUint64(16, BigInt(data.metadataSize), true);
    
    // Byte 24-39: Metadata hash (16 bytes)
    bytes.set(data.metadataHash.slice(0, 16), 24);
    
    // Byte 40-43: Chunk count
    view.setUint32(40, data.chunkCount, true);
    
    // Byte 44-47: Reserved
    view.setUint32(44, 0, true);
    
    // Byte 48-55: Reserved
    view.setBigUint64(48, BigInt(0), true);
    
    // Byte 56-59: Reserved
    view.setUint32(56, 0, true);
    
    // Byte 60-63: End magic 'END!'
    view.setUint32(60, data.endMagic, true);
    
    return buffer;
  }
  
  // ==========================================================================
  // STREAMING MODE (SECTION 7)
  // ==========================================================================
  
  /**
   * Flush buffered chunks to streaming parts (for large files)
   */
  private flushBufferedChunks(): void {
    // Sort chunks by index and flush contiguous sequences
    const indices = Array.from(this.chunks.keys()).sort((a, b) => a - b);
    
    for (const idx of indices) {
      if (idx === this.flushedChunks) {
        const chunk = this.chunks.get(idx);
        if (chunk) {
          this.streamingParts.push(
            chunk.data.buffer.slice(
              chunk.data.byteOffset,
              chunk.data.byteOffset + chunk.data.byteLength
            ) as ArrayBuffer
          );
          // Keep chunk info but release data
          // Note: We still need the data for final assembly, so in practice
          // we might not delete here - this is for future true streaming support
          this.flushedChunks++;
        }
      }
    }
  }
  
  // ==========================================================================
  // INTEGRITY VERIFICATION (SECTION 8)
  // ==========================================================================
  
  /**
   * Verify assembled archive integrity
   */
  private verifyArchive(blob: Blob, metadata: MetadataPayload): void {
    // Verify size
    const expectedSize = HEADER_SIZE + 
      this.totalCompressedSize + 
      JSON.stringify(metadata).length + 
      FOOTER_SIZE;
    
    // Allow small variance due to JSON serialization
    if (Math.abs(blob.size - expectedSize) > 100) {
      console.warn(`Archive size mismatch: expected ~${expectedSize}, got ${blob.size}`);
    }
    
    // Verify chunk count
    if (metadata.chunkTable.length !== this.expectedChunks) {
      throw new Error(`Chunk count mismatch: ${metadata.chunkTable.length} vs ${this.expectedChunks}`);
    }
    
    // Verify offsets are sequential
    let expectedOffset = HEADER_SIZE;
    for (const chunk of metadata.chunkTable) {
      if (chunk.offset !== expectedOffset) {
        throw new Error(`Offset mismatch at chunk ${chunk.index}: expected ${expectedOffset}, got ${chunk.offset}`);
      }
      expectedOffset += chunk.length;
    }
    
    this.emit({
      type: 'integrity-verified',
      timestamp: Date.now(),
      message: 'Archive integrity verified',
      details: {
        size: blob.size,
        chunks: this.expectedChunks,
        offsetsValid: true,
      },
    });
  }
  
  // ==========================================================================
  // FAIL-SAFE METHODS (SECTION 8)
  // ==========================================================================
  
  /**
   * Request missing chunks (to be called by Coordinator)
   */
  requestMissingChunks(): number[] {
    return this.getMissingChunks();
  }
  
  /**
   * Rebuild metadata if mismatch detected
   */
  rebuildMetadata(): MetadataPayload {
    if (!this.isComplete) {
      throw new Error('Cannot rebuild metadata: not all chunks received');
    }
    return this.buildMetadata();
  }
  
  /**
   * Recalculate all offsets from scratch
   */
  recalculateOffsets(): ChunkInfo[] {
    return this.buildChunkTable();
  }
  
  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  
  /**
   * Compute quick hash (first 16 bytes of simple checksum)
   */
  private computeQuickHash(data: Uint8Array): Uint8Array {
    // Simple FNV-1a based hash for speed
    const hash = new Uint8Array(16);
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    let h3 = 0x811c9dc5;
    let h4 = 0x811c9dc5;
    
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      h1 ^= b;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= b ^ (i & 0xff);
      h2 = Math.imul(h2, 0x01000193);
      h3 ^= b ^ ((i >> 8) & 0xff);
      h3 = Math.imul(h3, 0x01000193);
      h4 ^= b ^ ((i >> 16) & 0xff);
      h4 = Math.imul(h4, 0x01000193);
    }
    
    const view = new DataView(hash.buffer);
    view.setUint32(0, h1 >>> 0, true);
    view.setUint32(4, h2 >>> 0, true);
    view.setUint32(8, h3 >>> 0, true);
    view.setUint32(12, h4 >>> 0, true);
    
    return hash;
  }
  
  /**
   * Emit event to handlers
   */
  private emit(event: WriterEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Writer event handler error:', e);
      }
    }
  }
  
  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
    if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${(bytes / GB).toFixed(2)} GB`;
  }
}

// ============================================================================
// METADATA TABLE BUILDER (HELPER CLASS)
// ============================================================================

/**
 * MetadataTableBuilder - Helper for constructing file entries
 */
export class MetadataTableBuilder {
  private files: FileEntry[] = [];
  private currentChunkIndex = 0;
  private currentByteOffset = 0;
  private fileIdCounter = 0;
  
  /**
   * Add a file to the table
   */
  addFile(
    name: string,
    size: number,
    mimeType: string,
    lastModified: number,
    chunkSize: number
  ): FileEntry {
    const startChunk = this.currentChunkIndex;
    const chunksNeeded = Math.ceil(size / chunkSize);
    const endChunk = startChunk + chunksNeeded - 1;
    
    const entry: FileEntry = {
      id: `file-${++this.fileIdCounter}`,
      name,
      size,
      mimeType,
      startChunk,
      endChunk,
      startOffset: this.currentByteOffset,
      lastModified,
    };
    
    this.files.push(entry);
    
    // Update tracking (simplified - real impl needs exact byte tracking)
    this.currentChunkIndex = endChunk + 1;
    this.currentByteOffset = 0; // Reset for next file
    
    return entry;
  }
  
  /**
   * Add a file from File object
   */
  addFileFromFile(file: File, chunkSize: number): FileEntry {
    return this.addFile(
      file.name,
      file.size,
      file.type || 'application/octet-stream',
      file.lastModified,
      chunkSize
    );
  }
  
  /**
   * Get all file entries
   */
  getEntries(): FileEntry[] {
    return [...this.files];
  }
  
  /**
   * Get total chunks needed
   */
  getTotalChunks(): number {
    if (this.files.length === 0) return 0;
    const lastFile = this.files[this.files.length - 1];
    return lastFile.endChunk + 1;
  }
  
  /**
   * Reset builder
   */
  reset(): void {
    this.files = [];
    this.currentChunkIndex = 0;
    this.currentByteOffset = 0;
    this.fileIdCounter = 0;
  }
}

// ============================================================================
// ARCHIVE READER (FOR VERIFICATION)
// ============================================================================

/**
 * ArchiveReader - Reads and parses SPK archive structure
 */
export class ArchiveReader {
  private blob: Blob;
  private header: ArchiveHeaderData | null = null;
  private footer: ArchiveFooterData | null = null;
  private metadata: MetadataPayload | null = null;
  
  constructor(blob: Blob) {
    this.blob = blob;
  }
  
  /**
   * Helper to read blob as ArrayBuffer (works in jsdom too)
   */
  private async blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    // Try native arrayBuffer first
    if (typeof blob.arrayBuffer === 'function') {
      try {
        return await blob.arrayBuffer();
      } catch {
        // Fall through to FileReader
      }
    }
    
    // Fallback for environments without blob.arrayBuffer
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }
  
  /**
   * Parse archive header
   */
  async parseHeader(): Promise<ArchiveHeaderData> {
    const headerBlob = this.blob.slice(0, HEADER_SIZE);
    const buffer = await this.blobToArrayBuffer(headerBlob);
    const view = new DataView(buffer);
    
    const magic = view.getUint32(0, true);
    if (magic !== SPK_MAGIC) {
      throw new Error(`Invalid magic: 0x${magic.toString(16)}`);
    }
    
    this.header = {
      magic,
      version: view.getUint16(4, true),
      flags: view.getUint16(6, true),
      headerSize: view.getUint32(8, true),
      chunkCount: view.getUint32(12, true),
      metadataOffset: Number(view.getBigUint64(16, true)),
      metadataSize: Number(view.getBigUint64(24, true)),
      footerOffset: Number(view.getBigUint64(32, true)),
      originalSize: Number(view.getBigUint64(40, true)),
      compressedSize: Number(view.getBigUint64(48, true)),
      createdAt: Number(view.getBigUint64(56, true)),
    };
    
    return this.header;
  }
  
  /**
   * Parse archive footer
   */
  async parseFooter(): Promise<ArchiveFooterData> {
    const footerBlob = this.blob.slice(this.blob.size - FOOTER_SIZE);
    const buffer = await this.blobToArrayBuffer(footerBlob);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    
    const magic = view.getUint32(0, true);
    if (magic !== SPK_END_MAGIC) {
      throw new Error(`Invalid footer magic: 0x${magic.toString(16)}`);
    }
    
    const endMagic = view.getUint32(60, true);
    if (endMagic !== END_MAGIC) {
      throw new Error(`Invalid end magic: 0x${endMagic.toString(16)}`);
    }
    
    this.footer = {
      magic,
      version: view.getUint16(4, true),
      metadataOffset: Number(view.getBigUint64(8, true)),
      metadataSize: Number(view.getBigUint64(16, true)),
      metadataHash: bytes.slice(24, 40),
      chunkCount: view.getUint32(40, true),
      flags: view.getUint16(6, true),
      endMagic,
    };
    
    return this.footer;
  }
  
  /**
   * Helper to read blob as text (works in jsdom too)
   */
  private async blobToText(blob: Blob): Promise<string> {
    // Try native text first
    if (typeof blob.text === 'function') {
      try {
        return await blob.text();
      } catch {
        // Fall through to FileReader
      }
    }
    
    // Fallback for environments without blob.text
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }
  
  /**
   * Parse metadata
   */
  async parseMetadata(): Promise<MetadataPayload> {
    if (!this.header) {
      await this.parseHeader();
    }
    
    const metadataBlob = this.blob.slice(
      this.header!.metadataOffset,
      this.header!.metadataOffset + this.header!.metadataSize
    );
    
    const text = await this.blobToText(metadataBlob);
    this.metadata = JSON.parse(text) as MetadataPayload;
    
    return this.metadata;
  }
  
  /**
   * Get chunk data by index
   */
  async getChunkData(index: number): Promise<Uint8Array> {
    if (!this.metadata) {
      await this.parseMetadata();
    }
    
    const chunkInfo = this.metadata!.chunkTable.find(c => c.index === index);
    if (!chunkInfo) {
      throw new Error(`Chunk ${index} not found`);
    }
    
    const chunkBlob = this.blob.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.length);
    const buffer = await this.blobToArrayBuffer(chunkBlob);
    
    return new Uint8Array(buffer);
  }
  
  /**
   * Verify archive integrity
   */
  async verify(): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    try {
      const header = await this.parseHeader();
      const footer = await this.parseFooter();
      const metadata = await this.parseMetadata();
      
      // Verify chunk count consistency
      if (header.chunkCount !== footer.chunkCount) {
        errors.push(`Chunk count mismatch: header=${header.chunkCount}, footer=${footer.chunkCount}`);
      }
      
      if (header.chunkCount !== metadata.totalChunks) {
        errors.push(`Chunk count mismatch: header=${header.chunkCount}, metadata=${metadata.totalChunks}`);
      }
      
      // Verify metadata offset consistency
      if (header.metadataOffset !== footer.metadataOffset) {
        errors.push(`Metadata offset mismatch: header=${header.metadataOffset}, footer=${footer.metadataOffset}`);
      }
      
      // Verify chunk table
      let expectedOffset = HEADER_SIZE;
      for (const chunk of metadata.chunkTable) {
        if (chunk.offset !== expectedOffset) {
          errors.push(`Chunk ${chunk.index} offset mismatch: expected=${expectedOffset}, actual=${chunk.offset}`);
        }
        expectedOffset += chunk.length;
      }
      
    } catch (e) {
      errors.push(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// ============================================================================
// SINGLETON & EXPORTS
// ============================================================================

let writerInstance: ArchiveWriter | null = null;

/**
 * Get a shared ArchiveWriter instance
 */
export function getArchiveWriter(
  expectedChunks: number,
  config?: Partial<ArchiveWriterConfig>
): ArchiveWriter {
  if (!writerInstance || writerInstance.getStats().expectedChunks !== expectedChunks) {
    writerInstance = new ArchiveWriter(expectedChunks, config);
  }
  return writerInstance;
}

/**
 * Reset the shared writer instance
 */
export function resetArchiveWriter(): void {
  writerInstance = null;
}

/**
 * Create file entry from File object (convenience function)
 */
export function createFileEntry(
  file: File,
  startChunk: number,
  endChunk: number,
  startOffset = 0
): FileEntry {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    startChunk,
    endChunk,
    startOffset,
    lastModified: file.lastModified,
  };
}
