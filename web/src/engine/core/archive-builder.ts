/**
 * SPK V30-V31 - ArchiveBuilder
 * 
 * Assembles valid SPK archives from compressed chunks.
 * Produces browser-downloadable Blob with:
 * - SPK header (64 bytes)
 * - Compressed chunks (sequential)
 * - Chunk table
 * - Manifest JSON
 * - Footer with offsets
 * 
 * Output is fully decompressible and spec-compliant.
 */

import type { ProcessedChunk } from './chunk-processor';

// ============================================================================
// CONSTANTS
// ============================================================================

const SPK_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x21]); // "SPK!"
const SPK_VERSION = 31;
const HEADER_SIZE = 64;
const FOOTER_SIZE = 32;

// ============================================================================
// TYPES
// ============================================================================

export interface ArchiveInfo {
  fileName: string;
  mimeType: string;
  originalSize: number;
  chunkSize: number;
  compressionMode: string;
  createdAt: number;
}

export interface ArchiveManifest {
  version: number;
  fileName: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  chunkSize: number;
  totalChunks: number;
  chunks: ChunkTableEntry[];
  compressionMode: string;
  createdAt: number;
  checksum: string;
}

export interface ChunkTableEntry {
  index: number;
  offset: number;
  originalSize: number;
  compressedSize: number;
  checksum: number;
  hash: string;
}

export interface BuiltArchive {
  blob: Blob;
  manifest: ArchiveManifest;
  originalSize: number;
  compressedSize: number;
  ratio: number;
}

// ============================================================================
// CRC32
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================================
// ARCHIVE BUILDER CLASS
// ============================================================================

export class ArchiveBuilder {
  private info: ArchiveInfo;
  private chunks: ProcessedChunk[] = [];
  private isFinalized = false;
  
  constructor(info: ArchiveInfo) {
    this.info = info;
  }
  
  // ==========================================================================
  // CHUNK MANAGEMENT
  // ==========================================================================
  
  /**
   * Add a compressed chunk to the archive
   */
  addChunk(chunk: ProcessedChunk): void {
    if (this.isFinalized) {
      throw new Error('Archive already finalized');
    }
    
    // Insert in order
    this.chunks[chunk.index] = chunk;
  }
  
  /**
   * Add multiple chunks
   */
  addChunks(chunks: ProcessedChunk[]): void {
    for (const chunk of chunks) {
      this.addChunk(chunk);
    }
  }
  
  /**
   * Get count of added chunks
   */
  getChunkCount(): number {
    return this.chunks.filter(c => c !== undefined).length;
  }
  
  /**
   * Check if all chunks are present
   */
  isComplete(expectedCount: number): boolean {
    if (this.chunks.length !== expectedCount) return false;
    for (let i = 0; i < expectedCount; i++) {
      if (!this.chunks[i]) return false;
    }
    return true;
  }
  
  // ==========================================================================
  // ARCHIVE BUILDING
  // ==========================================================================
  
  /**
   * Build the final SPK archive
   * Returns Blob ready for download
   */
  build(): BuiltArchive {
    if (this.isFinalized) {
      throw new Error('Archive already built');
    }
    
    // Validate chunks are sequential
    for (let i = 0; i < this.chunks.length; i++) {
      if (!this.chunks[i]) {
        throw new Error(`Missing chunk at index ${i}`);
      }
    }
    
    // Calculate sizes and offsets
    const chunkTable: ChunkTableEntry[] = [];
    let dataOffset = HEADER_SIZE;
    let totalOriginal = 0;
    let totalCompressed = 0;
    
    for (const chunk of this.chunks) {
      chunkTable.push({
        index: chunk.index,
        offset: dataOffset,
        originalSize: chunk.originalSize,
        compressedSize: chunk.compressedSize,
        checksum: chunk.checksum,
        hash: chunk.hash,
      });
      
      totalOriginal += chunk.originalSize;
      totalCompressed += chunk.compressedSize;
      dataOffset += 4 + chunk.compressedSize; // 4-byte size prefix + data
    }
    
    // Build manifest
    const manifest: ArchiveManifest = {
      version: SPK_VERSION,
      fileName: this.info.fileName,
      mimeType: this.info.mimeType,
      originalSize: totalOriginal,
      compressedSize: 0, // Will update after building
      chunkSize: this.info.chunkSize,
      totalChunks: this.chunks.length,
      chunks: chunkTable,
      compressionMode: this.info.compressionMode,
      createdAt: this.info.createdAt,
      checksum: '', // Will compute
    };
    
    // Serialize manifest
    const manifestJson = JSON.stringify(manifest);
    const manifestBytes = new TextEncoder().encode(manifestJson);
    
    // Build archive parts
    const parts: Uint8Array[] = [];
    
    // 1. Header (64 bytes)
    const header = this.buildHeader(
      totalOriginal,
      this.chunks.length,
      dataOffset, // chunks end offset
      dataOffset + manifestBytes.length + 4 // manifest end offset
    );
    parts.push(header);
    
    // 2. Compressed chunks with size prefixes
    for (const chunk of this.chunks) {
      // 4-byte size prefix (little-endian)
      const sizePrefix = new Uint8Array(4);
      new DataView(sizePrefix.buffer).setUint32(0, chunk.compressedSize, true);
      parts.push(sizePrefix);
      parts.push(chunk.compressedData);
    }
    
    // 3. Manifest with size prefix
    const manifestSizePrefix = new Uint8Array(4);
    new DataView(manifestSizePrefix.buffer).setUint32(0, manifestBytes.length, true);
    parts.push(manifestSizePrefix);
    parts.push(manifestBytes);
    
    // 4. Footer (32 bytes)
    const chunkTableOffset = dataOffset;
    const manifestOffset = dataOffset; // Manifest immediately follows chunks
    const footer = this.buildFooter(chunkTableOffset, manifestOffset, totalOriginal);
    parts.push(footer);
    
    // Calculate total size
    let totalSize = 0;
    for (const part of parts) {
      totalSize += part.length;
    }
    
    // Update manifest with final size
    manifest.compressedSize = totalSize;
    manifest.checksum = this.computeArchiveChecksum(parts);
    
    // Create Blob (convert Uint8Array to ArrayBuffer properly)
    const blobParts: ArrayBuffer[] = parts.map(p => {
      if (p.buffer instanceof SharedArrayBuffer) {
        const copy = new ArrayBuffer(p.byteLength);
        new Uint8Array(copy).set(p);
        return copy;
      }
      return p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength);
    });
    const blob = new Blob(blobParts, { 
      type: 'application/x-spk' 
    });
    
    this.isFinalized = true;
    
    return {
      blob,
      manifest,
      originalSize: totalOriginal,
      compressedSize: totalSize,
      ratio: totalOriginal > 0 ? totalSize / totalOriginal : 1,
    };
  }
  
  /**
   * Build SPK header (64 bytes)
   */
  private buildHeader(
    originalSize: number,
    chunkCount: number,
    chunksEndOffset: number,
    manifestEndOffset: number
  ): Uint8Array {
    const header = new Uint8Array(HEADER_SIZE);
    const view = new DataView(header.buffer);
    
    let offset = 0;
    
    // Magic (4 bytes): "SPK!"
    header.set(SPK_MAGIC, offset);
    offset += 4;
    
    // Version (2 bytes)
    view.setUint16(offset, SPK_VERSION, true);
    offset += 2;
    
    // Flags (2 bytes)
    const flags = this.buildFlags();
    view.setUint16(offset, flags, true);
    offset += 2;
    
    // Original size (8 bytes, 64-bit for large files)
    view.setBigUint64(offset, BigInt(originalSize), true);
    offset += 8;
    
    // Chunk count (4 bytes)
    view.setUint32(offset, chunkCount, true);
    offset += 4;
    
    // Chunk size (4 bytes)
    view.setUint32(offset, this.info.chunkSize, true);
    offset += 4;
    
    // Chunks end offset (8 bytes)
    view.setBigUint64(offset, BigInt(chunksEndOffset), true);
    offset += 8;
    
    // Manifest offset (8 bytes)
    view.setBigUint64(offset, BigInt(manifestEndOffset), true);
    offset += 8;
    
    // File name length (2 bytes)
    const fileNameBytes = new TextEncoder().encode(this.info.fileName);
    const fileNameLen = Math.min(fileNameBytes.length, 20); // Max 20 bytes in header
    view.setUint16(offset, fileNameLen, true);
    offset += 2;
    
    // File name (up to 20 bytes, truncated)
    header.set(fileNameBytes.subarray(0, fileNameLen), offset);
    offset += 20;
    
    // Reserved / padding to 64 bytes
    // Already zero-filled
    
    return header;
  }
  
  /**
   * Build footer (32 bytes)
   */
  private buildFooter(
    chunkTableOffset: number,
    manifestOffset: number,
    originalSize: number
  ): Uint8Array {
    const footer = new Uint8Array(FOOTER_SIZE);
    const view = new DataView(footer.buffer);
    
    let offset = 0;
    
    // Footer magic (4 bytes): "!KPS" (reverse of SPK!)
    footer.set([0x21, 0x4B, 0x50, 0x53], offset);
    offset += 4;
    
    // Chunk table offset (8 bytes)
    view.setBigUint64(offset, BigInt(chunkTableOffset), true);
    offset += 8;
    
    // Manifest offset (8 bytes)
    view.setBigUint64(offset, BigInt(manifestOffset), true);
    offset += 8;
    
    // Original size repeated (8 bytes)
    view.setBigUint64(offset, BigInt(originalSize), true);
    offset += 8;
    
    // Footer checksum (4 bytes) - CRC32 of footer sans this field
    const footerCrc = crc32(footer.subarray(0, 28));
    view.setUint32(offset, footerCrc, true);
    
    return footer;
  }
  
  /**
   * Build flags byte
   */
  private buildFlags(): number {
    let flags = 0;
    
    // Bit 0-1: Compression mode
    switch (this.info.compressionMode) {
      case 'fast': flags |= 0x00; break;
      case 'balanced': flags |= 0x01; break;
      case 'strong': flags |= 0x02; break;
      case 'auto': flags |= 0x03; break;
    }
    
    // Bit 2: Reserved
    // Bit 3: Reserved  
    // Bit 4: Has manifest
    flags |= 0x10;
    
    // Bit 5: Has chunk table
    flags |= 0x20;
    
    // Bit 6-7: Reserved
    
    return flags;
  }
  
  /**
   * Compute archive checksum
   */
  private computeArchiveChecksum(_parts: Uint8Array[]): string {
    // XOR all chunk checksums together
    let checksum = 0;
    for (const chunk of this.chunks) {
      checksum ^= chunk.checksum;
    }
    return checksum.toString(16).padStart(8, '0');
  }
  
  // ==========================================================================
  // RESET
  // ==========================================================================
  
  /**
   * Reset builder for reuse
   */
  reset(info?: ArchiveInfo): void {
    this.chunks = [];
    this.isFinalized = false;
    if (info) {
      this.info = info;
    }
  }
}

// ============================================================================
// ARCHIVE READER (for decompression)
// ============================================================================

export interface ParsedArchive {
  header: {
    version: number;
    flags: number;
    originalSize: number;
    chunkCount: number;
    chunkSize: number;
    fileName: string;
  };
  manifest: ArchiveManifest | null;
  chunks: Array<{
    index: number;
    offset: number;
    size: number;
  }>;
}

/**
 * Parse SPK archive header
 */
export function parseArchiveHeader(data: Uint8Array): ParsedArchive['header'] | null {
  if (data.length < HEADER_SIZE) return null;
  
  // Verify magic
  if (data[0] !== 0x53 || data[1] !== 0x50 || 
      data[2] !== 0x4B || data[3] !== 0x21) {
    return null;
  }
  
  const view = new DataView(data.buffer, data.byteOffset);
  
  const version = view.getUint16(4, true);
  const flags = view.getUint16(6, true);
  const originalSize = Number(view.getBigUint64(8, true));
  const chunkCount = view.getUint32(16, true);
  const chunkSize = view.getUint32(20, true);
  
  // Read file name
  const fileNameLen = view.getUint16(44, true);
  const fileNameBytes = data.subarray(46, 46 + Math.min(fileNameLen, 20));
  const fileName = new TextDecoder().decode(fileNameBytes);
  
  return {
    version,
    flags,
    originalSize,
    chunkCount,
    chunkSize,
    fileName,
  };
}

/**
 * Extract chunks from archive for decompression
 */
export function* extractArchiveChunks(
  data: Uint8Array
): Generator<{ index: number; compressedData: Uint8Array }, void, unknown> {
  const header = parseArchiveHeader(data);
  if (!header) {
    throw new Error('Invalid SPK archive');
  }
  
  let offset = HEADER_SIZE;
  
  for (let i = 0; i < header.chunkCount; i++) {
    if (offset + 4 > data.length) {
      throw new Error(`Archive truncated at chunk ${i}`);
    }
    
    // Read chunk size
    const view = new DataView(data.buffer, data.byteOffset + offset);
    const chunkSize = view.getUint32(0, true);
    offset += 4;
    
    if (offset + chunkSize > data.length) {
      throw new Error(`Chunk ${i} extends beyond archive`);
    }
    
    const compressedData = data.subarray(offset, offset + chunkSize);
    offset += chunkSize;
    
    yield { index: i, compressedData };
  }
}
