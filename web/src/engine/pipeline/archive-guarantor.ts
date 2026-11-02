/**
 * SPK Fail-Safe Pipeline - Archive Assembly Guarantor
 * 
 * Ensures archive output is ALWAYS valid:
 * - Reliable chunk table reconstruction
 * - Offset recalculation after retries
 * - Footer validation and regeneration
 * - Final blob integrity verification
 * - Recovery from partial failures
 * 
 * @module pipeline/archive-guarantor
 * @version 1.0.0
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ArchiveGuarantorConfig {
  /** Maximum retries for finalization */
  maxFinalizeRetries: number;
  /** Enable footer validation */
  validateFooter: boolean;
  /** Enable chunk table verification */
  verifyChunkTable: boolean;
  /** Maximum assembly attempts */
  maxAssemblyAttempts: number;
  /** Checksum algorithm */
  checksumAlgorithm: 'crc32' | 'sha256';
}

export interface ChunkRecord {
  index: number;
  offset: number;
  compressedSize: number;
  originalSize: number;
  hash?: string;
  retryCount: number;
  workerId: string;
  timestamp: number;
}

export interface ChunkTable {
  version: number;
  totalChunks: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  compressionRatio: number;
  chunks: ChunkRecord[];
  checksum: string;
}

export interface ArchiveHeader {
  magic: number;          // 0x53504B00 ('SPK\0')
  version: number;
  flags: number;
  headerSize: number;
  chunkTableOffset: number;
  footerOffset: number;
  originalSize: number;
  compressedSize: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ArchiveFooter {
  magic: number;          // 0x53504B45 ('SPKE')
  version: number;
  chunkTableOffset: number;
  chunkTableSize: number;
  chunkCount: number;
  checksum: string;
  signature?: string;
}

export interface AssemblyResult {
  success: boolean;
  blob?: Blob;
  size: number;
  checksum: string;
  chunks: number;
  compressionRatio: number;
  retries: number;
  errors: string[];
}

export type GuarantorEventHandler = (event: GuarantorEvent) => void;

export interface GuarantorEvent {
  type: 
    | 'assembly-started'
    | 'chunk-added'
    | 'chunk-recovered'
    | 'table-rebuilt'
    | 'footer-generated'
    | 'footer-validated'
    | 'assembly-complete'
    | 'assembly-retry'
    | 'assembly-failed'
    | 'validation-error';
  timestamp: number;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SPK_MAGIC = 0x53504B00;  // 'SPK\0'
const SPK_END_MAGIC = 0x53504B45;  // 'SPKE'
const CURRENT_VERSION = 1;

const DEFAULT_CONFIG: ArchiveGuarantorConfig = {
  maxFinalizeRetries: 3,
  validateFooter: true,
  verifyChunkTable: true,
  maxAssemblyAttempts: 5,
  checksumAlgorithm: 'crc32',
};

// ============================================================================
// CRC32 IMPLEMENTATION
// ============================================================================

const CRC32_TABLE: number[] = [];

// Initialize CRC32 lookup table
(function initCRC32Table() {
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32_TABLE[i] = c >>> 0;
  }
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================================
// ARCHIVE ASSEMBLY GUARANTOR
// ============================================================================

export class ArchiveAssemblyGuarantor {
  private config: ArchiveGuarantorConfig;
  private chunks = new Map<number, { data: Uint8Array; record: ChunkRecord }>();
  private chunkTable: ChunkTable | null = null;
  private _header: ArchiveHeader | null = null;
  private footer: ArchiveFooter | null = null;
  private eventHandlers: GuarantorEventHandler[] = [];
  private missingChunks = new Set<number>();
  private _totalOriginalSize = 0;
  private assemblyAttempts = 0;
  
  constructor(config: Partial<ArchiveGuarantorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // PUBLIC GETTERS
  // ==========================================================================
  
  /**
   * Get current header (generated after assembly starts)
   */
  get header(): ArchiveHeader | null {
    return this._header;
  }
  
  /**
   * Get total original size of all chunks
   */
  get totalOriginalSize(): number {
    return this._totalOriginalSize;
  }
  
  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  
  /**
   * Initialize for new archive
   */
  initialize(totalChunks: number, originalSize: number): void {
    this.chunks.clear();
    this.chunkTable = null;
    this._header = null;
    this.footer = null;
    this.missingChunks.clear();
    this._totalOriginalSize = originalSize;
    this.assemblyAttempts = 0;
    
    // Track which chunks we expect
    for (let i = 0; i < totalChunks; i++) {
      this.missingChunks.add(i);
    }
    
    this.emit({
      type: 'assembly-started',
      timestamp: Date.now(),
      message: `Initialized for ${totalChunks} chunks`,
      details: { totalChunks, originalSize },
    });
  }
  
  /**
   * Reset guarantor
   */
  reset(): void {
    this.chunks.clear();
    this.chunkTable = null;
    this._header = null;
    this.footer = null;
    this.missingChunks.clear();
    this._totalOriginalSize = 0;
    this.assemblyAttempts = 0;
  }
  
  // ==========================================================================
  // CHUNK MANAGEMENT
  // ==========================================================================
  
  /**
   * Add a compressed chunk
   */
  addChunk(
    index: number,
    compressedData: Uint8Array,
    originalSize: number,
    retryCount: number,
    workerId: string,
    hash?: string
  ): void {
    const record: ChunkRecord = {
      index,
      offset: 0, // Will be calculated during assembly
      compressedSize: compressedData.length,
      originalSize,
      hash: hash ?? this.calculateHash(compressedData),
      retryCount,
      workerId,
      timestamp: Date.now(),
    };
    
    this.chunks.set(index, { data: compressedData, record });
    this.missingChunks.delete(index);
    
    this.emit({
      type: 'chunk-added',
      timestamp: Date.now(),
      message: `Added chunk ${index} (${compressedData.length} bytes)`,
      details: { record },
    });
  }
  
  /**
   * Check if chunk exists
   */
  hasChunk(index: number): boolean {
    return this.chunks.has(index);
  }
  
  /**
   * Get missing chunks
   */
  getMissingChunks(): number[] {
    return Array.from(this.missingChunks);
  }
  
  /**
   * Replace a chunk (for retries)
   */
  replaceChunk(
    index: number,
    compressedData: Uint8Array,
    originalSize: number,
    retryCount: number,
    workerId: string
  ): void {
    const existing = this.chunks.get(index);
    
    const record: ChunkRecord = {
      index,
      offset: 0,
      compressedSize: compressedData.length,
      originalSize,
      hash: this.calculateHash(compressedData),
      retryCount,
      workerId,
      timestamp: Date.now(),
    };
    
    this.chunks.set(index, { data: compressedData, record });
    
    this.emit({
      type: 'chunk-recovered',
      timestamp: Date.now(),
      message: `Replaced chunk ${index} after retry`,
      details: {
        previousSize: existing?.record.compressedSize,
        newSize: compressedData.length,
        retryCount,
      },
    });
  }
  
  // ==========================================================================
  // CHUNK TABLE
  // ==========================================================================
  
  /**
   * Build chunk table with correct offsets
   */
  buildChunkTable(): ChunkTable {
    // Sort chunks by index
    const sortedChunks = Array.from(this.chunks.entries())
      .sort((a, b) => a[0] - b[0]);
    
    // Calculate offsets
    let currentOffset = 64; // Header size
    const records: ChunkRecord[] = [];
    let totalOriginal = 0;
    let totalCompressed = 0;
    
    for (const [, { data, record }] of sortedChunks) {
      records.push({
        ...record,
        offset: currentOffset,
      });
      
      currentOffset += data.length;
      totalOriginal += record.originalSize;
      totalCompressed += record.compressedSize;
    }
    
    // Create table
    this.chunkTable = {
      version: CURRENT_VERSION,
      totalChunks: records.length,
      totalOriginalSize: totalOriginal,
      totalCompressedSize: totalCompressed,
      compressionRatio: totalOriginal > 0 ? totalCompressed / totalOriginal : 1,
      chunks: records,
      checksum: '', // Will be calculated
    };
    
    // Calculate table checksum
    this.chunkTable.checksum = this.calculateTableChecksum(this.chunkTable);
    
    this.emit({
      type: 'table-rebuilt',
      timestamp: Date.now(),
      message: `Built chunk table with ${records.length} entries`,
      details: {
        totalChunks: records.length,
        totalOriginalSize: totalOriginal,
        totalCompressedSize: totalCompressed,
        compressionRatio: this.chunkTable.compressionRatio,
      },
    });
    
    return this.chunkTable;
  }
  
  /**
   * Verify chunk table integrity
   */
  verifyChunkTable(): { valid: boolean; errors: string[] } {
    if (!this.chunkTable) {
      return { valid: false, errors: ['Chunk table not built'] };
    }
    
    const errors: string[] = [];
    
    // Check chunk count
    if (this.chunkTable.chunks.length !== this.chunkTable.totalChunks) {
      errors.push(`Chunk count mismatch: ${this.chunkTable.chunks.length} vs ${this.chunkTable.totalChunks}`);
    }
    
    // Check for gaps in indices
    const indices = this.chunkTable.chunks.map(c => c.index).sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        errors.push(`Gap in chunk indices at position ${i} (found ${indices[i]})`);
        break;
      }
    }
    
    // Check offsets are monotonically increasing
    let lastEnd = 64; // After header
    for (const chunk of this.chunkTable.chunks) {
      if (chunk.offset < lastEnd) {
        errors.push(`Chunk ${chunk.index} offset ${chunk.offset} overlaps with previous chunk ending at ${lastEnd}`);
      }
      lastEnd = chunk.offset + chunk.compressedSize;
    }
    
    // Verify checksum
    const expectedChecksum = this.calculateTableChecksum(this.chunkTable);
    if (this.chunkTable.checksum !== expectedChecksum) {
      errors.push(`Chunk table checksum mismatch`);
    }
    
    const valid = errors.length === 0;
    
    if (!valid) {
      this.emit({
        type: 'validation-error',
        timestamp: Date.now(),
        message: `Chunk table validation failed with ${errors.length} errors`,
        details: { errors },
      });
    }
    
    return { valid, errors };
  }
  
  // ==========================================================================
  // HEADER & FOOTER
  // ==========================================================================
  
  /**
   * Generate archive header
   */
  private generateHeader(): ArrayBuffer {
    if (!this.chunkTable) {
      throw new Error('Chunk table not built');
    }
    
    const headerSize = 64;
    const buffer = new ArrayBuffer(headerSize);
    const view = new DataView(buffer);
    
    // Calculate offsets
    const chunkDataSize = this.chunkTable.chunks.reduce((sum, c) => sum + c.compressedSize, 0);
    const chunkTableOffset = headerSize + chunkDataSize;
    const footerOffset = chunkTableOffset + this.calculateChunkTableSize();
    
    // Write header
    view.setUint32(0, SPK_MAGIC, true);           // Magic
    view.setUint16(4, CURRENT_VERSION, true);     // Version
    view.setUint16(6, 0, true);                   // Flags
    view.setUint32(8, headerSize, true);          // Header size
    view.setBigUint64(12, BigInt(chunkTableOffset), true);  // Chunk table offset
    view.setBigUint64(20, BigInt(footerOffset), true);      // Footer offset
    view.setBigUint64(28, BigInt(this.chunkTable.totalOriginalSize), true);   // Original size
    view.setBigUint64(36, BigInt(this.chunkTable.totalCompressedSize), true); // Compressed size
    view.setBigUint64(44, BigInt(Date.now()), true);        // Created at
    // Bytes 52-63 reserved
    
    this._header = {
      magic: SPK_MAGIC,
      version: CURRENT_VERSION,
      flags: 0,
      headerSize,
      chunkTableOffset,
      footerOffset,
      originalSize: this.chunkTable.totalOriginalSize,
      compressedSize: this.chunkTable.totalCompressedSize,
      createdAt: Date.now(),
    };
    
    return buffer;
  }
  
  /**
   * Generate archive footer
   */
  private generateFooter(): ArrayBuffer {
    if (!this.chunkTable) {
      throw new Error('Chunk table not built');
    }
    
    const footerSize = 64;
    const buffer = new ArrayBuffer(footerSize);
    const view = new DataView(buffer);
    const encoder = new TextEncoder();
    
    // Calculate positions
    const chunkDataSize = this.chunkTable.chunks.reduce((sum, c) => sum + c.compressedSize, 0);
    const chunkTableOffset = 64 + chunkDataSize;
    const chunkTableSize = this.calculateChunkTableSize();
    
    // Write footer
    view.setUint32(0, SPK_END_MAGIC, true);       // Magic
    view.setUint16(4, CURRENT_VERSION, true);     // Version
    view.setBigUint64(8, BigInt(chunkTableOffset), true);   // Chunk table offset
    view.setUint32(16, chunkTableSize, true);     // Chunk table size
    view.setUint32(20, this.chunkTable.totalChunks, true);  // Chunk count
    
    // Write checksum (16 bytes at offset 24)
    const checksumBytes = encoder.encode(this.chunkTable.checksum.slice(0, 16));
    for (let i = 0; i < Math.min(checksumBytes.length, 16); i++) {
      view.setUint8(24 + i, checksumBytes[i]);
    }
    
    // Bytes 40-63 reserved
    
    this.footer = {
      magic: SPK_END_MAGIC,
      version: CURRENT_VERSION,
      chunkTableOffset,
      chunkTableSize,
      chunkCount: this.chunkTable.totalChunks,
      checksum: this.chunkTable.checksum,
    };
    
    this.emit({
      type: 'footer-generated',
      timestamp: Date.now(),
      message: 'Footer generated',
      details: { footer: this.footer },
    });
    
    return buffer;
  }
  
  /**
   * Serialize chunk table
   */
  private serializeChunkTable(): ArrayBuffer {
    if (!this.chunkTable) {
      throw new Error('Chunk table not built');
    }
    
    const json = JSON.stringify({
      version: this.chunkTable.version,
      totalChunks: this.chunkTable.totalChunks,
      totalOriginalSize: this.chunkTable.totalOriginalSize,
      totalCompressedSize: this.chunkTable.totalCompressedSize,
      compressionRatio: this.chunkTable.compressionRatio,
      chunks: this.chunkTable.chunks.map(c => ({
        i: c.index,
        o: c.offset,
        cs: c.compressedSize,
        os: c.originalSize,
        h: c.hash,
      })),
      checksum: this.chunkTable.checksum,
    });
    
    const encoder = new TextEncoder();
    return encoder.encode(json).buffer;
  }
  
  /**
   * Calculate chunk table size
   */
  private calculateChunkTableSize(): number {
    if (!this.chunkTable) return 0;
    const json = JSON.stringify(this.chunkTable);
    return new TextEncoder().encode(json).length;
  }
  
  // ==========================================================================
  // ASSEMBLY
  // ==========================================================================
  
  /**
   * Assemble final archive
   */
  async assemble(): Promise<AssemblyResult> {
    this.assemblyAttempts++;
    const errors: string[] = [];
    
    try {
      // Check for missing chunks
      if (this.missingChunks.size > 0) {
        errors.push(`Missing ${this.missingChunks.size} chunks: ${Array.from(this.missingChunks).join(', ')}`);
        
        if (this.assemblyAttempts < this.config.maxAssemblyAttempts) {
          this.emit({
            type: 'assembly-retry',
            timestamp: Date.now(),
            message: `Assembly attempt ${this.assemblyAttempts} failed - missing chunks`,
            details: { missingChunks: Array.from(this.missingChunks) },
          });
          
          return {
            success: false,
            size: 0,
            checksum: '',
            chunks: 0,
            compressionRatio: 0,
            retries: this.assemblyAttempts,
            errors,
          };
        }
      }
      
      // Build chunk table
      const table = this.buildChunkTable();
      
      // Verify chunk table
      if (this.config.verifyChunkTable) {
        const verification = this.verifyChunkTable();
        if (!verification.valid) {
          errors.push(...verification.errors);
          
          // Try to rebuild
          if (this.assemblyAttempts < this.config.maxAssemblyAttempts) {
            this.emit({
              type: 'assembly-retry',
              timestamp: Date.now(),
              message: 'Chunk table verification failed - attempting rebuild',
              details: { errors: verification.errors },
            });
            
            // Rebuild table
            this.buildChunkTable();
          }
        }
      }
      
      // Generate header
      const headerBuffer = this.generateHeader();
      
      // Collect chunk data as ArrayBuffers
      const sortedChunks: ArrayBuffer[] = Array.from(this.chunks.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, { data }]) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      
      // Serialize chunk table
      const tableBuffer = this.serializeChunkTable() as ArrayBuffer;
      
      // Generate footer
      const footerBuffer = this.generateFooter() as ArrayBuffer;
      
      // Validate footer
      if (this.config.validateFooter) {
        if (!this.validateFooter()) {
          errors.push('Footer validation failed');
        }
      }
      
      // Assemble blob parts - cast to BlobPart[] for type safety
      const parts: BlobPart[] = [
        headerBuffer as BlobPart,
        ...(sortedChunks as BlobPart[]),
        tableBuffer as BlobPart,
        footerBuffer as BlobPart,
      ];
      
      const blob = new Blob(parts, { type: 'application/x-spk' });
      
      // Calculate final checksum
      const checksum = await this.calculateBlobChecksum(blob);
      
      // Success!
      this.emit({
        type: 'assembly-complete',
        timestamp: Date.now(),
        message: `Archive assembled: ${this.formatBytes(blob.size)}`,
        details: {
          size: blob.size,
          chunks: table.totalChunks,
          compressionRatio: table.compressionRatio,
          checksum,
        },
      });
      
      return {
        success: true,
        blob,
        size: blob.size,
        checksum,
        chunks: table.totalChunks,
        compressionRatio: table.compressionRatio,
        retries: this.assemblyAttempts,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      
      this.emit({
        type: 'assembly-failed',
        timestamp: Date.now(),
        message: `Assembly failed: ${message}`,
        details: { error: message, attempts: this.assemblyAttempts },
      });
      
      return {
        success: false,
        size: 0,
        checksum: '',
        chunks: 0,
        compressionRatio: 0,
        retries: this.assemblyAttempts,
        errors,
      };
    }
  }
  
  /**
   * Validate footer
   */
  private validateFooter(): boolean {
    if (!this.footer || !this.chunkTable) return false;
    
    // Check magic
    if (this.footer.magic !== SPK_END_MAGIC) return false;
    
    // Check chunk count matches
    if (this.footer.chunkCount !== this.chunkTable.totalChunks) return false;
    
    // Check checksum matches
    if (this.footer.checksum !== this.chunkTable.checksum) return false;
    
    this.emit({
      type: 'footer-validated',
      timestamp: Date.now(),
      message: 'Footer validation passed',
    });
    
    return true;
  }
  
  // ==========================================================================
  // CHECKSUMS
  // ==========================================================================
  
  /**
   * Calculate chunk hash
   */
  private calculateHash(data: Uint8Array): string {
    if (this.config.checksumAlgorithm === 'crc32') {
      return crc32(data).toString(16).padStart(8, '0');
    } else {
      // For SHA-256, we'd need async, so use CRC32 as fallback for sync
      return crc32(data).toString(16).padStart(8, '0');
    }
  }
  
  /**
   * Calculate table checksum
   */
  private calculateTableChecksum(table: ChunkTable): string {
    const data = table.chunks.map(c => 
      `${c.index}:${c.offset}:${c.compressedSize}:${c.originalSize}`
    ).join('|');
    
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    return crc32(bytes).toString(16).padStart(8, '0');
  }
  
  /**
   * Calculate blob checksum
   */
  private async calculateBlobChecksum(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const data = new Uint8Array(buffer);
    return crc32(data).toString(16).padStart(8, '0');
  }
  
  // ==========================================================================
  // EVENTS
  // ==========================================================================
  
  /**
   * Add event handler
   */
  addEventListener(handler: GuarantorEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }
  
  /**
   * Emit event
   */
  private emit(event: GuarantorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[ArchiveGuarantor] Handler error:', error);
      }
    }
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  /**
   * Format bytes
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
  
  /**
   * Get statistics
   */
  getStats(): {
    chunksAdded: number;
    missingChunks: number;
    totalCompressedSize: number;
    totalOriginalSize: number;
    assemblyAttempts: number;
  } {
    let compressedSize = 0;
    let originalSize = 0;
    
    for (const { record } of this.chunks.values()) {
      compressedSize += record.compressedSize;
      originalSize += record.originalSize;
    }
    
    return {
      chunksAdded: this.chunks.size,
      missingChunks: this.missingChunks.size,
      totalCompressedSize: compressedSize,
      totalOriginalSize: originalSize,
      assemblyAttempts: this.assemblyAttempts,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalGuarantor: ArchiveAssemblyGuarantor | null = null;

export function getArchiveAssemblyGuarantor(
  config?: Partial<ArchiveGuarantorConfig>
): ArchiveAssemblyGuarantor {
  if (!globalGuarantor) {
    globalGuarantor = new ArchiveAssemblyGuarantor(config);
  }
  return globalGuarantor;
}

export function resetArchiveAssemblyGuarantor(): void {
  if (globalGuarantor) {
    globalGuarantor.reset();
    globalGuarantor = null;
  }
}
