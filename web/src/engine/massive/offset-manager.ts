/**
 * SPK Hard Constraint Engine - 64-bit Offset Manager
 * Creator: OJ Treasure Onazi
 * 
 * Section 5: 64-bit Offset + Footer Safety
 * - Use BigInt for all offsets (no Number truncation)
 * - Validate offsets don't exceed MAX_SAFE_OFFSET (10TB)
 * - Footer contains jump offsets for random access
 */

import { HARD_LIMITS, TB, GB, MB } from './types';

// ============================================================================
// OFFSET CONSTANTS
// ============================================================================

/**
 * Maximum safe offset for SPK archives (10TB)
 */
export const MAX_SAFE_OFFSET = BigInt(HARD_LIMITS.MAX_TOTAL_INPUT_SIZE);

/**
 * Maximum offset that JavaScript Number can safely represent
 */
export const MAX_JS_NUMBER_OFFSET = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Footer signature for validation
 */
export const FOOTER_SIGNATURE = new Uint8Array([0x53, 0x50, 0x4B, 0x46]); // "SPKF"

/**
 * Footer version
 */
export const FOOTER_VERSION = 2;

// ============================================================================
// OFFSET TYPES
// ============================================================================

export interface ChunkOffset {
  chunkIndex: number;
  fileId: string;
  offset: bigint;
  compressedSize: bigint;
  originalSize: bigint;
  checksum: number;
}

export interface FileOffset {
  fileId: string;
  path: string;
  startOffset: bigint;
  endOffset: bigint;
  totalChunks: number;
  compressedSize: bigint;
  originalSize: bigint;
}

export interface PartitionOffset {
  partitionId: string;
  partitionIndex: number;
  startOffset: bigint;
  endOffset: bigint;
  compressedSize: bigint;
  originalSize: bigint;
  fileCount: number;
  chunkCount: number;
}

export interface JumpOffset {
  type: 'chunk' | 'file' | 'partition' | 'metadata';
  id: string;
  offset: bigint;
  size: bigint;
}

export interface FooterStructure {
  signature: Uint8Array;
  version: number;
  flags: number;
  
  // Archive stats
  totalOriginalSize: bigint;
  totalCompressedSize: bigint;
  totalFiles: number;
  totalChunks: number;
  totalPartitions: number;
  
  // Table offsets
  chunkTableOffset: bigint;
  chunkTableSize: bigint;
  fileTableOffset: bigint;
  fileTableSize: bigint;
  partitionTableOffset: bigint;
  partitionTableSize: bigint;
  metadataOffset: bigint;
  metadataSize: bigint;
  
  // Footer offset (for validation)
  footerOffset: bigint;
  footerSize: bigint;
  
  // Checksum
  checksum: number;
  createdAt: bigint;
}

// ============================================================================
// OFFSET VALIDATOR
// ============================================================================

export class OffsetValidator {
  private maxOffset: bigint;
  private seenOffsets = new Set<string>();

  constructor(maxOffset: bigint = MAX_SAFE_OFFSET) {
    this.maxOffset = maxOffset;
  }

  /**
   * Validate single offset
   */
  validateOffset(offset: bigint, context: string = 'offset'): void {
    if (offset < BigInt(0)) {
      throw new Error(`[OFFSET] ${context}: Negative offset (${offset})`);
    }
    
    if (offset > this.maxOffset) {
      throw new Error(
        `[OFFSET] ${context}: Offset ${offset} exceeds maximum safe offset ` +
        `(${this.maxOffset}/${this.formatSize(this.maxOffset)})`
      );
    }
  }

  /**
   * Validate offset range
   */
  validateRange(start: bigint, end: bigint, context: string = 'range'): void {
    this.validateOffset(start, `${context} start`);
    this.validateOffset(end, `${context} end`);
    
    if (end < start) {
      throw new Error(
        `[OFFSET] ${context}: End offset (${end}) is less than start offset (${start})`
      );
    }
  }

  /**
   * Validate offset doesn't overflow when adding size
   */
  validateAdd(offset: bigint, size: bigint, context: string = 'add'): bigint {
    this.validateOffset(offset, `${context} base`);
    
    if (size < BigInt(0)) {
      throw new Error(`[OFFSET] ${context}: Negative size (${size})`);
    }
    
    const result = offset + size;
    this.validateOffset(result, `${context} result`);
    
    return result;
  }

  /**
   * Check for duplicate offsets (indicates corruption)
   */
  checkDuplicate(offset: bigint, chunkId: string): void {
    const key = offset.toString();
    if (this.seenOffsets.has(key)) {
      throw new Error(
        `[OFFSET] Duplicate offset detected at ${offset} for chunk ${chunkId}. ` +
        `This indicates archive corruption.`
      );
    }
    this.seenOffsets.add(key);
  }

  /**
   * Validate offset alignment
   */
  validateAlignment(offset: bigint, alignment: number, context: string = 'alignment'): void {
    const alignBig = BigInt(alignment);
    if (offset % alignBig !== BigInt(0)) {
      throw new Error(
        `[OFFSET] ${context}: Offset ${offset} is not aligned to ${alignment} bytes`
      );
    }
  }

  /**
   * Format size for human readability
   */
  private formatSize(bytes: bigint): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Number(bytes);
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Reset validator
   */
  reset(): void {
    this.seenOffsets.clear();
  }
}

// ============================================================================
// OFFSET TABLE MANAGER
// ============================================================================

export class OffsetTableManager {
  private chunkOffsets: Map<string, ChunkOffset> = new Map();
  private fileOffsets: Map<string, FileOffset> = new Map();
  private partitionOffsets: Map<string, PartitionOffset> = new Map();
  private jumpOffsets: JumpOffset[] = [];
  private validator: OffsetValidator;

  constructor() {
    this.validator = new OffsetValidator();
  }

  // -------------------------------------------------------------------------
  // CHUNK OFFSETS
  // -------------------------------------------------------------------------

  /**
   * Add chunk offset
   */
  addChunkOffset(
    fileId: string,
    chunkIndex: number,
    offset: bigint,
    compressedSize: bigint,
    originalSize: bigint,
    checksum: number
  ): void {
    const key = `${fileId}_${chunkIndex}`;
    
    // Validate
    this.validator.validateOffset(offset, `chunk ${key}`);
    this.validator.validateAdd(offset, compressedSize, `chunk ${key} end`);
    this.validator.checkDuplicate(offset, key);
    
    this.chunkOffsets.set(key, {
      chunkIndex,
      fileId,
      offset,
      compressedSize,
      originalSize,
      checksum,
    });
  }

  /**
   * Get chunk offset
   */
  getChunkOffset(fileId: string, chunkIndex: number): ChunkOffset | undefined {
    return this.chunkOffsets.get(`${fileId}_${chunkIndex}`);
  }

  /**
   * Get all chunk offsets for file
   */
  getChunksForFile(fileId: string): ChunkOffset[] {
    const chunks: ChunkOffset[] = [];
    for (const [key, offset] of this.chunkOffsets) {
      if (offset.fileId === fileId) {
        chunks.push(offset);
      }
    }
    return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  // -------------------------------------------------------------------------
  // FILE OFFSETS
  // -------------------------------------------------------------------------

  /**
   * Add file offset
   */
  addFileOffset(
    fileId: string,
    path: string,
    startOffset: bigint,
    endOffset: bigint,
    totalChunks: number,
    compressedSize: bigint,
    originalSize: bigint
  ): void {
    // Validate
    this.validator.validateRange(startOffset, endOffset, `file ${fileId}`);
    
    this.fileOffsets.set(fileId, {
      fileId,
      path,
      startOffset,
      endOffset,
      totalChunks,
      compressedSize,
      originalSize,
    });
    
    // Add jump offset
    this.jumpOffsets.push({
      type: 'file',
      id: fileId,
      offset: startOffset,
      size: compressedSize,
    });
  }

  /**
   * Get file offset
   */
  getFileOffset(fileId: string): FileOffset | undefined {
    return this.fileOffsets.get(fileId);
  }

  /**
   * Calculate file offsets from chunk offsets
   */
  calculateFileOffsets(): void {
    const fileChunks = new Map<string, ChunkOffset[]>();
    
    // Group chunks by file
    for (const chunk of this.chunkOffsets.values()) {
      const chunks = fileChunks.get(chunk.fileId) || [];
      chunks.push(chunk);
      fileChunks.set(chunk.fileId, chunks);
    }
    
    // Calculate file offsets
    for (const [fileId, chunks] of fileChunks) {
      if (chunks.length === 0) continue;
      
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      const first = chunks[0];
      const last = chunks[chunks.length - 1];
      
      const startOffset = first.offset;
      const endOffset = last.offset + last.compressedSize;
      const compressedSize = chunks.reduce((sum, c) => sum + c.compressedSize, BigInt(0));
      const originalSize = chunks.reduce((sum, c) => sum + c.originalSize, BigInt(0));
      
      this.addFileOffset(
        fileId,
        fileId, // Path would need to be provided separately
        startOffset,
        endOffset,
        chunks.length,
        compressedSize,
        originalSize
      );
    }
  }

  // -------------------------------------------------------------------------
  // PARTITION OFFSETS
  // -------------------------------------------------------------------------

  /**
   * Add partition offset
   */
  addPartitionOffset(
    partitionId: string,
    partitionIndex: number,
    startOffset: bigint,
    endOffset: bigint,
    compressedSize: bigint,
    originalSize: bigint,
    fileCount: number,
    chunkCount: number
  ): void {
    // Validate
    this.validator.validateRange(startOffset, endOffset, `partition ${partitionId}`);
    
    this.partitionOffsets.set(partitionId, {
      partitionId,
      partitionIndex,
      startOffset,
      endOffset,
      compressedSize,
      originalSize,
      fileCount,
      chunkCount,
    });
    
    // Add jump offset
    this.jumpOffsets.push({
      type: 'partition',
      id: partitionId,
      offset: startOffset,
      size: compressedSize,
    });
  }

  /**
   * Get partition offset
   */
  getPartitionOffset(partitionId: string): PartitionOffset | undefined {
    return this.partitionOffsets.get(partitionId);
  }

  // -------------------------------------------------------------------------
  // JUMP OFFSETS (Random Access)
  // -------------------------------------------------------------------------

  /**
   * Get jump offsets for random access
   */
  getJumpOffsets(): JumpOffset[] {
    return [...this.jumpOffsets].sort((a, b) => {
      const diff = a.offset - b.offset;
      return diff < BigInt(0) ? -1 : diff > BigInt(0) ? 1 : 0;
    });
  }

  /**
   * Find nearest jump offset for seeking
   */
  findNearestJumpOffset(targetOffset: bigint): JumpOffset | null {
    let nearest: JumpOffset | null = null;
    let nearestDist = MAX_SAFE_OFFSET;
    
    for (const jump of this.jumpOffsets) {
      if (jump.offset <= targetOffset) {
        const dist = targetOffset - jump.offset;
        if (dist < nearestDist) {
          nearest = jump;
          nearestDist = dist;
        }
      }
    }
    
    return nearest;
  }

  // -------------------------------------------------------------------------
  // SERIALIZATION
  // -------------------------------------------------------------------------

  /**
   * Serialize chunk table to binary
   */
  serializeChunkTable(): Uint8Array {
    const chunks = Array.from(this.chunkOffsets.values())
      .sort((a, b) => {
        const diff = a.offset - b.offset;
        return diff < BigInt(0) ? -1 : diff > BigInt(0) ? 1 : 0;
      });
    
    // 64 bytes per entry
    const entrySize = 64;
    const buffer = new ArrayBuffer(8 + chunks.length * entrySize);
    const view = new DataView(buffer);
    const array = new Uint8Array(buffer);
    
    // Header: count
    view.setUint32(0, chunks.length, true);
    view.setUint32(4, entrySize, true);
    
    // Entries
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const base = 8 + i * entrySize;
      
      // File ID (first 16 bytes as hash)
      const idHash = this.hashString(chunk.fileId);
      array.set(idHash, base);
      
      view.setUint32(base + 16, chunk.chunkIndex, true);
      view.setBigUint64(base + 24, chunk.offset, true);
      view.setBigUint64(base + 32, chunk.compressedSize, true);
      view.setBigUint64(base + 40, chunk.originalSize, true);
      view.setUint32(base + 48, chunk.checksum, true);
    }
    
    return array;
  }

  /**
   * Serialize file table to binary
   */
  serializeFileTable(): Uint8Array {
    const files = Array.from(this.fileOffsets.values())
      .sort((a, b) => {
        const diff = a.startOffset - b.startOffset;
        return diff < BigInt(0) ? -1 : diff > BigInt(0) ? 1 : 0;
      });
    
    // 96 bytes per entry
    const entrySize = 96;
    const buffer = new ArrayBuffer(8 + files.length * entrySize);
    const view = new DataView(buffer);
    const array = new Uint8Array(buffer);
    
    // Header
    view.setUint32(0, files.length, true);
    view.setUint32(4, entrySize, true);
    
    // Entries
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base = 8 + i * entrySize;
      
      // File ID hash
      const idHash = this.hashString(file.fileId);
      array.set(idHash, base);
      
      view.setBigUint64(base + 16, file.startOffset, true);
      view.setBigUint64(base + 24, file.endOffset, true);
      view.setUint32(base + 32, file.totalChunks, true);
      view.setBigUint64(base + 40, file.compressedSize, true);
      view.setBigUint64(base + 48, file.originalSize, true);
      
      // Path hash
      const pathHash = this.hashString(file.path);
      array.set(pathHash, base + 56);
    }
    
    return array;
  }

  /**
   * Serialize partition table to binary
   */
  serializePartitionTable(): Uint8Array {
    const partitions = Array.from(this.partitionOffsets.values())
      .sort((a, b) => a.partitionIndex - b.partitionIndex);
    
    // 64 bytes per entry
    const entrySize = 64;
    const buffer = new ArrayBuffer(8 + partitions.length * entrySize);
    const view = new DataView(buffer);
    const array = new Uint8Array(buffer);
    
    // Header
    view.setUint32(0, partitions.length, true);
    view.setUint32(4, entrySize, true);
    
    // Entries
    for (let i = 0; i < partitions.length; i++) {
      const partition = partitions[i];
      const base = 8 + i * entrySize;
      
      view.setUint32(base, partition.partitionIndex, true);
      view.setBigUint64(base + 8, partition.startOffset, true);
      view.setBigUint64(base + 16, partition.endOffset, true);
      view.setBigUint64(base + 24, partition.compressedSize, true);
      view.setBigUint64(base + 32, partition.originalSize, true);
      view.setUint32(base + 40, partition.fileCount, true);
      view.setUint32(base + 44, partition.chunkCount, true);
    }
    
    return array;
  }

  /**
   * Hash string to 16-byte array
   */
  private hashString(str: string): Uint8Array {
    const hash = new Uint8Array(16);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    
    const view = new DataView(hash.buffer);
    view.setUint32(0, h1, true);
    view.setUint32(4, h2, true);
    view.setUint32(8, h1 ^ h2, true);
    view.setUint32(12, (h1 + h2) >>> 0, true);
    
    return hash;
  }

  // -------------------------------------------------------------------------
  // STATS
  // -------------------------------------------------------------------------

  getStats(): {
    totalChunks: number;
    totalFiles: number;
    totalPartitions: number;
    totalCompressedSize: bigint;
    totalOriginalSize: bigint;
    maxOffset: bigint;
  } {
    let maxOffset = BigInt(0);
    let totalCompressed = BigInt(0);
    let totalOriginal = BigInt(0);
    
    for (const chunk of this.chunkOffsets.values()) {
      const endOffset = chunk.offset + chunk.compressedSize;
      if (endOffset > maxOffset) maxOffset = endOffset;
      totalCompressed += chunk.compressedSize;
      totalOriginal += chunk.originalSize;
    }
    
    return {
      totalChunks: this.chunkOffsets.size,
      totalFiles: this.fileOffsets.size,
      totalPartitions: this.partitionOffsets.size,
      totalCompressedSize: totalCompressed,
      totalOriginalSize: totalOriginal,
      maxOffset,
    };
  }

  /**
   * Reset manager
   */
  reset(): void {
    this.chunkOffsets.clear();
    this.fileOffsets.clear();
    this.partitionOffsets.clear();
    this.jumpOffsets = [];
    this.validator.reset();
  }
}

// ============================================================================
// FOOTER MANAGER
// ============================================================================

export class FooterManager {
  private offsetManager: OffsetTableManager;
  private validator: OffsetValidator;

  constructor(offsetManager: OffsetTableManager) {
    this.offsetManager = offsetManager;
    this.validator = new OffsetValidator();
  }

  /**
   * Build footer structure
   */
  buildFooter(
    archiveEndOffset: bigint,
    metadata: Uint8Array | null = null
  ): { footer: Uint8Array; structure: FooterStructure } {
    const stats = this.offsetManager.getStats();
    
    // Serialize tables
    const chunkTable = this.offsetManager.serializeChunkTable();
    const fileTable = this.offsetManager.serializeFileTable();
    const partitionTable = this.offsetManager.serializePartitionTable();
    const metadataData = metadata || new Uint8Array(0);
    
    // Calculate offsets
    const footerHeaderSize = BigInt(128);
    const chunkTableOffset = archiveEndOffset;
    const fileTableOffset = chunkTableOffset + BigInt(chunkTable.length);
    const partitionTableOffset = fileTableOffset + BigInt(fileTable.length);
    const metadataOffset = partitionTableOffset + BigInt(partitionTable.length);
    const footerOffset = metadataOffset + BigInt(metadataData.length);
    
    // Validate all offsets
    this.validator.validateOffset(chunkTableOffset, 'chunk table');
    this.validator.validateOffset(fileTableOffset, 'file table');
    this.validator.validateOffset(partitionTableOffset, 'partition table');
    this.validator.validateOffset(metadataOffset, 'metadata');
    this.validator.validateOffset(footerOffset, 'footer');
    
    // Build structure
    const structure: FooterStructure = {
      signature: FOOTER_SIGNATURE,
      version: FOOTER_VERSION,
      flags: 0,
      totalOriginalSize: stats.totalOriginalSize,
      totalCompressedSize: stats.totalCompressedSize,
      totalFiles: stats.totalFiles,
      totalChunks: stats.totalChunks,
      totalPartitions: stats.totalPartitions,
      chunkTableOffset,
      chunkTableSize: BigInt(chunkTable.length),
      fileTableOffset,
      fileTableSize: BigInt(fileTable.length),
      partitionTableOffset,
      partitionTableSize: BigInt(partitionTable.length),
      metadataOffset,
      metadataSize: BigInt(metadataData.length),
      footerOffset,
      footerSize: footerHeaderSize,
      checksum: 0,
      createdAt: BigInt(Date.now()),
    };
    
    // Serialize footer header
    const footerHeader = new Uint8Array(128);
    const view = new DataView(footerHeader.buffer);
    
    // Signature
    footerHeader.set(FOOTER_SIGNATURE, 0);
    view.setUint16(4, FOOTER_VERSION, true);
    view.setUint16(6, structure.flags, true);
    
    // Stats
    view.setBigUint64(8, structure.totalOriginalSize, true);
    view.setBigUint64(16, structure.totalCompressedSize, true);
    view.setUint32(24, structure.totalFiles, true);
    view.setUint32(28, structure.totalChunks, true);
    view.setUint32(32, structure.totalPartitions, true);
    
    // Table offsets
    view.setBigUint64(40, structure.chunkTableOffset, true);
    view.setBigUint64(48, structure.chunkTableSize, true);
    view.setBigUint64(56, structure.fileTableOffset, true);
    view.setBigUint64(64, structure.fileTableSize, true);
    view.setBigUint64(72, structure.partitionTableOffset, true);
    view.setBigUint64(80, structure.partitionTableSize, true);
    view.setBigUint64(88, structure.metadataOffset, true);
    view.setBigUint64(96, structure.metadataSize, true);
    
    // Footer self-reference
    view.setBigUint64(104, structure.footerOffset, true);
    view.setBigUint64(112, structure.footerSize, true);
    
    // Timestamp
    view.setBigUint64(120, structure.createdAt, true);
    
    // Calculate checksum
    let checksum = 0xFFFFFFFF;
    for (let i = 0; i < footerHeader.length - 4; i++) {
      checksum ^= footerHeader[i];
      for (let j = 0; j < 8; j++) {
        checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xEDB88320 : 0);
      }
    }
    structure.checksum = checksum ^ 0xFFFFFFFF;
    
    // Combine all parts
    const totalSize = chunkTable.length + fileTable.length + partitionTable.length + 
                      metadataData.length + footerHeader.length;
    const footer = new Uint8Array(totalSize);
    
    let offset = 0;
    footer.set(chunkTable, offset);
    offset += chunkTable.length;
    footer.set(fileTable, offset);
    offset += fileTable.length;
    footer.set(partitionTable, offset);
    offset += partitionTable.length;
    footer.set(metadataData, offset);
    offset += metadataData.length;
    footer.set(footerHeader, offset);
    
    return { footer, structure };
  }

  /**
   * Parse footer from archive
   */
  parseFooter(data: Uint8Array): FooterStructure {
    if (data.length < 128) {
      throw new Error('[FOOTER] Footer data too small');
    }
    
    // Read from end (footer header is last 128 bytes)
    const headerOffset = data.length - 128;
    const header = data.slice(headerOffset);
    const view = new DataView(header.buffer, header.byteOffset, header.length);
    
    // Verify signature
    const sig = header.slice(0, 4);
    if (!this.compareArrays(sig, FOOTER_SIGNATURE)) {
      throw new Error('[FOOTER] Invalid footer signature');
    }
    
    const version = view.getUint16(4, true);
    if (version > FOOTER_VERSION) {
      throw new Error(`[FOOTER] Unsupported footer version: ${version}`);
    }
    
    const structure: FooterStructure = {
      signature: sig,
      version,
      flags: view.getUint16(6, true),
      totalOriginalSize: view.getBigUint64(8, true),
      totalCompressedSize: view.getBigUint64(16, true),
      totalFiles: view.getUint32(24, true),
      totalChunks: view.getUint32(28, true),
      totalPartitions: view.getUint32(32, true),
      chunkTableOffset: view.getBigUint64(40, true),
      chunkTableSize: view.getBigUint64(48, true),
      fileTableOffset: view.getBigUint64(56, true),
      fileTableSize: view.getBigUint64(64, true),
      partitionTableOffset: view.getBigUint64(72, true),
      partitionTableSize: view.getBigUint64(80, true),
      metadataOffset: view.getBigUint64(88, true),
      metadataSize: view.getBigUint64(96, true),
      footerOffset: view.getBigUint64(104, true),
      footerSize: view.getBigUint64(112, true),
      createdAt: view.getBigUint64(120, true),
      checksum: 0,
    };
    
    // Validate offsets
    this.validator.validateOffset(structure.chunkTableOffset, 'chunk table');
    this.validator.validateOffset(structure.fileTableOffset, 'file table');
    this.validator.validateOffset(structure.partitionTableOffset, 'partition table');
    this.validator.validateOffset(structure.metadataOffset, 'metadata');
    this.validator.validateOffset(structure.footerOffset, 'footer');
    
    return structure;
  }

  /**
   * Compare two arrays
   */
  private compareArrays(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let offsetManagerInstance: OffsetTableManager | null = null;

export function getOffsetManager(): OffsetTableManager {
  if (!offsetManagerInstance) {
    offsetManagerInstance = new OffsetTableManager();
  }
  return offsetManagerInstance;
}

export function createFooterManager(offsetManager?: OffsetTableManager): FooterManager {
  return new FooterManager(offsetManager || getOffsetManager());
}

export function resetOffsetManager(): void {
  offsetManagerInstance?.reset();
  offsetManagerInstance = null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert Number to BigInt safely
 */
export function toBigInt(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot convert ${value} to BigInt`);
  }
  if (value < 0) {
    throw new Error(`Cannot convert negative number ${value} to BigInt for offset`);
  }
  return BigInt(Math.floor(value));
}

/**
 * Convert BigInt to Number safely
 */
export function toNumber(value: bigint): number {
  if (value > MAX_JS_NUMBER_OFFSET) {
    throw new Error(
      `BigInt ${value} exceeds MAX_SAFE_INTEGER, cannot convert to Number`
    );
  }
  return Number(value);
}

/**
 * Format bytes as human readable
 */
export function formatOffset(offset: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(offset);
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Calculate checksum for offset validation
 */
export function calculateOffsetChecksum(offsets: bigint[]): number {
  let checksum = 0xFFFFFFFF;
  
  for (const offset of offsets) {
    // Process 8 bytes of BigInt
    for (let i = 0; i < 8; i++) {
      const byte = Number((offset >> BigInt(i * 8)) & BigInt(0xFF));
      checksum ^= byte;
      for (let j = 0; j < 8; j++) {
        checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xEDB88320 : 0);
      }
    }
  }
  
  return checksum ^ 0xFFFFFFFF;
}
