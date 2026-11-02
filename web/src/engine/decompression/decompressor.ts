/**
 * SPK V32 - Full Decompression Pipeline
 * 
 * Provides complete decompression functionality:
 * - Stream read SPK archives
 * - Load chunk table + manifest
 * - Feed compressed chunks to decompressor
 * - Reassemble file in correct order
 * - Bit-identical output restoration
 */

// ============================================================================
// TYPES
// ============================================================================

export interface DecompressionProgress {
  phase: 'reading-header' | 'loading-manifest' | 'decompressing' | 'assembling' | 'complete';
  chunksProcessed: number;
  totalChunks: number;
  bytesProcessed: number;
  totalBytes: number;
  currentSpeed: number;
  eta: number;
}

export interface DecompressionResult {
  success: boolean;
  fileName: string;
  originalSize: number;
  restoredSize: number;
  duration: number;
  blob: Blob;
  verified: boolean;
  error?: string;
}

export interface SPKHeader {
  magic: string;
  version: number;
  flags: number;
  originalSize: bigint;
  chunkCount: number;
  chunkSize: number;
  chunksEndOffset: bigint;
  manifestOffset: bigint;
  fileNameLength: number;
  fileName: string;
}

export interface SPKManifest {
  version: number;
  fileName: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  chunkSize: number;
  totalChunks: number;
  chunks: Array<{
    index: number;
    originalSize: number;
    compressedSize: number;
    checksum: number;
    hash: string;
  }>;
  mode: string;
  createdAt: number;
}

export interface SPKFooter {
  magic: string;
  chunkTableOffset: bigint;
  manifestOffset: bigint;
  originalSize: bigint;
  crc32: number;
}

export type DecompressProgressCallback = (progress: DecompressionProgress) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const HEADER_SIZE = 64;
const FOOTER_SIZE = 32;
const SPK_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x21]); // "SPK!"
const FOOTER_MAGIC = new Uint8Array([0x21, 0x4B, 0x50, 0x53]); // "!KPS"

// ============================================================================
// LZ77 DECOMPRESSION
// ============================================================================

function lz77Decompress(compressed: Uint8Array): Uint8Array {
  // Check SPK3 magic
  if (compressed[0] !== 0x53 || compressed[1] !== 0x50 || 
      compressed[2] !== 0x4B || compressed[3] !== 0x33) {
    throw new Error('Invalid LZ77 compressed data: missing SPK3 magic');
  }
  
  // Read original size
  const originalSize = (compressed[4] << 24) | (compressed[5] << 16) | 
                       (compressed[6] << 8) | compressed[7];
  
  // Level is at position 8 (unused for decompression, but validates format)
  // const level = compressed[8];
  
  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let inPos = 9; // Skip header
  
  while (outPos < originalSize && inPos < compressed.length) {
    const flag = compressed[inPos++];
    
    if (flag === 0) {
      // Literal byte
      if (inPos < compressed.length) {
        output[outPos++] = compressed[inPos++];
      }
    } else if (flag === 1) {
      // Match: 2 bytes offset + 1 byte length
      if (inPos + 2 < compressed.length) {
        const offset = (compressed[inPos] << 8) | compressed[inPos + 1];
        const length = compressed[inPos + 2];
        inPos += 3;
        
        // Copy from already-decoded output
        const srcStart = outPos - offset;
        for (let i = 0; i < length && outPos < originalSize; i++) {
          output[outPos++] = output[srcStart + i];
        }
      }
    }
  }
  
  return output.slice(0, outPos);
}

// ============================================================================
// RLE DECOMPRESSION
// ============================================================================

function rleDecompress(compressed: Uint8Array): Uint8Array {
  // Check SPKR magic
  if (compressed[0] !== 0x53 || compressed[1] !== 0x50 || 
      compressed[2] !== 0x4B || compressed[3] !== 0x52) {
    throw new Error('Invalid RLE compressed data: missing SPKR magic');
  }
  
  // Read original size
  const originalSize = (compressed[4] << 24) | (compressed[5] << 16) | 
                       (compressed[6] << 8) | compressed[7];
  
  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let inPos = 8; // Skip header
  
  while (outPos < originalSize && inPos < compressed.length) {
    const count = compressed[inPos++];
    
    if (count < 128) {
      // Literal run
      const literalCount = count + 1;
      for (let i = 0; i < literalCount && inPos < compressed.length && outPos < originalSize; i++) {
        output[outPos++] = compressed[inPos++];
      }
    } else {
      // Repeat run
      const repeatCount = count - 127;
      if (inPos < compressed.length) {
        const value = compressed[inPos++];
        for (let i = 0; i < repeatCount && outPos < originalSize; i++) {
          output[outPos++] = value;
        }
      }
    }
  }
  
  return output.slice(0, outPos);
}

// ============================================================================
// SMART DECOMPRESSION (AUTO-DETECT FORMAT)
// ============================================================================

export function decompressChunk(compressed: Uint8Array): Uint8Array {
  if (compressed.length < 8) {
    throw new Error('Compressed data too small');
  }
  
  // Check magic bytes to determine compression format
  const magic = String.fromCharCode(compressed[0], compressed[1], compressed[2], compressed[3]);
  
  if (magic === 'SPK3') {
    return lz77Decompress(compressed);
  } else if (magic === 'SPKR') {
    return rleDecompress(compressed);
  } else {
    // Unknown format - might be uncompressed
    throw new Error(`Unknown compression format: ${magic}`);
  }
}

// ============================================================================
// CRC32 VERIFICATION
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================================
// ARCHIVE PARSER
// ============================================================================

export function parseHeader(data: ArrayBuffer): SPKHeader {
  if (data.byteLength < HEADER_SIZE) {
    throw new Error('Invalid SPK file: header too small');
  }
  
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  
  // Check magic
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== SPK_MAGIC[i]) {
      throw new Error('Invalid SPK file: wrong magic bytes');
    }
  }
  
  const version = view.getUint16(4, true);
  const flags = view.getUint16(6, true);
  const originalSize = view.getBigUint64(8, true);
  const chunkCount = view.getUint32(16, true);
  const chunkSize = view.getUint32(20, true);
  const chunksEndOffset = view.getBigUint64(24, true);
  const manifestOffset = view.getBigUint64(32, true);
  const fileNameLength = view.getUint16(44, true);
  
  // Read filename
  const fileNameBytes = bytes.slice(46, 46 + Math.min(fileNameLength, 18));
  const fileName = new TextDecoder().decode(fileNameBytes);
  
  return {
    magic: 'SPK!',
    version,
    flags,
    originalSize,
    chunkCount,
    chunkSize,
    chunksEndOffset,
    manifestOffset,
    fileName,
    fileNameLength,
  };
}

export function parseFooter(data: ArrayBuffer, offset: number): SPKFooter {
  if (data.byteLength < offset + FOOTER_SIZE) {
    throw new Error('Invalid SPK file: footer incomplete');
  }
  
  const view = new DataView(data, offset, FOOTER_SIZE);
  const bytes = new Uint8Array(data, offset, FOOTER_SIZE);
  
  // Check magic
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== FOOTER_MAGIC[i]) {
      throw new Error('Invalid SPK file: wrong footer magic');
    }
  }
  
  return {
    magic: '!KPS',
    chunkTableOffset: view.getBigUint64(4, true),
    manifestOffset: view.getBigUint64(12, true),
    originalSize: view.getBigUint64(20, true),
    crc32: view.getUint32(28, true),
  };
}

export function parseManifest(data: ArrayBuffer, offset: number, size: number): SPKManifest {
  const manifestData = new Uint8Array(data, offset, size);
  const jsonString = new TextDecoder().decode(manifestData);
  return JSON.parse(jsonString);
}

// ============================================================================
// DECOMPRESSION ENGINE
// ============================================================================

export class Decompressor {
  private file: File | Blob | null = null;
  private header: SPKHeader | null = null;
  private manifest: SPKManifest | null = null;
  private _footer: SPKFooter | null = null;
  private onProgress: DecompressProgressCallback | null = null;
  private cancelled = false;
  private startTime = 0;
  private bytesProcessed = 0;
  
  /**
   * Initialize decompressor with SPK file
   */
  async load(file: File | Blob): Promise<void> {
    this.file = file;
    this.cancelled = false;
    
    // Read header
    const headerBlob = file.slice(0, HEADER_SIZE);
    const headerBuffer = await headerBlob.arrayBuffer();
    this.header = parseHeader(headerBuffer);
    
    // Read footer (last 32 bytes)
    const footerOffset = file.size - FOOTER_SIZE;
    const footerBlob = file.slice(footerOffset);
    const footerBuffer = await footerBlob.arrayBuffer();
    this._footer = parseFooter(footerBuffer, 0);
    
    // Read manifest
    const manifestOffset = Number(this.header.manifestOffset);
    const manifestSizeBlob = file.slice(manifestOffset, manifestOffset + 4);
    const manifestSizeBuffer = await manifestSizeBlob.arrayBuffer();
    const manifestSize = new DataView(manifestSizeBuffer).getUint32(0, true);
    
    const manifestBlob = file.slice(manifestOffset + 4, manifestOffset + 4 + manifestSize);
    const manifestBuffer = await manifestBlob.arrayBuffer();
    this.manifest = parseManifest(manifestBuffer, 0, manifestSize);
  }
  
  /**
   * Get file info without decompressing
   */
  getInfo(): { fileName: string; originalSize: number; compressedSize: number; chunks: number } | null {
    if (!this.manifest || !this.file) return null;
    
    return {
      fileName: this.manifest.fileName,
      originalSize: this.manifest.originalSize,
      compressedSize: this.file.size,
      chunks: this.manifest.totalChunks,
    };
  }
  
  /**
   * Set progress callback
   */
  setProgressCallback(callback: DecompressProgressCallback): void {
    this.onProgress = callback;
  }
  
  /**
   * Cancel decompression
   */
  cancel(): void {
    this.cancelled = true;
  }
  
  /**
   * Decompress the loaded archive
   */
  async decompress(): Promise<DecompressionResult> {
    if (!this.file || !this.header || !this.manifest) {
      throw new Error('No file loaded. Call load() first.');
    }
    
    this.startTime = performance.now();
    this.bytesProcessed = 0;
    
    const decompressedChunks: Uint8Array[] = new Array(this.manifest.totalChunks);
    let currentOffset = HEADER_SIZE;
    let verified = true;
    
    // Process each chunk
    for (let i = 0; i < this.manifest.totalChunks; i++) {
      if (this.cancelled) {
        return {
          success: false,
          fileName: this.manifest.fileName,
          originalSize: this.manifest.originalSize,
          restoredSize: 0,
          duration: performance.now() - this.startTime,
          blob: new Blob([]),
          verified: false,
          error: 'Decompression cancelled',
        };
      }
      
      // Read chunk size prefix
      const sizePrefixBlob = this.file.slice(currentOffset, currentOffset + 4);
      const sizePrefixBuffer = await sizePrefixBlob.arrayBuffer();
      const chunkCompressedSize = new DataView(sizePrefixBuffer).getUint32(0, true);
      currentOffset += 4;
      
      // Read compressed chunk
      const chunkBlob = this.file.slice(currentOffset, currentOffset + chunkCompressedSize);
      const chunkBuffer = await chunkBlob.arrayBuffer();
      const compressedData = new Uint8Array(chunkBuffer);
      currentOffset += chunkCompressedSize;
      
      // Verify checksum if available
      const chunkInfo = this.manifest.chunks[i];
      if (chunkInfo) {
        const checksum = crc32(compressedData);
        if (checksum !== chunkInfo.checksum) {
          verified = false;
          console.warn(`Chunk ${i} checksum mismatch: expected ${chunkInfo.checksum}, got ${checksum}`);
        }
      }
      
      // Decompress chunk
      const decompressed = decompressChunk(compressedData);
      decompressedChunks[i] = decompressed;
      
      this.bytesProcessed += decompressed.length;
      
      // Report progress
      if (this.onProgress) {
        const elapsed = performance.now() - this.startTime;
        const speed = this.bytesProcessed / (elapsed / 1000);
        const remaining = this.manifest.originalSize - this.bytesProcessed;
        const eta = speed > 0 ? remaining / speed : 0;
        
        this.onProgress({
          phase: 'decompressing',
          chunksProcessed: i + 1,
          totalChunks: this.manifest.totalChunks,
          bytesProcessed: this.bytesProcessed,
          totalBytes: this.manifest.originalSize,
          currentSpeed: speed,
          eta,
        });
      }
    }
    
    // Assemble final file
    if (this.onProgress) {
      this.onProgress({
        phase: 'assembling',
        chunksProcessed: this.manifest.totalChunks,
        totalChunks: this.manifest.totalChunks,
        bytesProcessed: this.manifest.originalSize,
        totalBytes: this.manifest.originalSize,
        currentSpeed: 0,
        eta: 0,
      });
    }
    
    // Create final blob - convert to regular ArrayBuffer for Blob compatibility
    const blobParts: ArrayBuffer[] = decompressedChunks.map(chunk => {
      // Always create a copy to ensure it's a regular ArrayBuffer
      const copy = new Uint8Array(chunk.length);
      copy.set(chunk);
      return copy.buffer as ArrayBuffer;
    });
    const blob = new Blob(blobParts, { type: this.manifest.mimeType });
    const duration = performance.now() - this.startTime;
    
    // Verify final size
    if (blob.size !== this.manifest.originalSize) {
      verified = false;
      console.warn(`Size mismatch: expected ${this.manifest.originalSize}, got ${blob.size}`);
    }
    
    if (this.onProgress) {
      this.onProgress({
        phase: 'complete',
        chunksProcessed: this.manifest.totalChunks,
        totalChunks: this.manifest.totalChunks,
        bytesProcessed: this.manifest.originalSize,
        totalBytes: this.manifest.originalSize,
        currentSpeed: this.manifest.originalSize / (duration / 1000),
        eta: 0,
      });
    }
    
    return {
      success: true,
      fileName: this.manifest.fileName,
      originalSize: this.manifest.originalSize,
      restoredSize: blob.size,
      duration,
      blob,
      verified,
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTION
// ============================================================================

/**
 * Decompress an SPK file and return the restored file
 */
export async function decompressFile(
  file: File | Blob,
  onProgress?: DecompressProgressCallback
): Promise<DecompressionResult> {
  const decompressor = new Decompressor();
  
  if (onProgress) {
    decompressor.setProgressCallback(onProgress);
  }
  
  await decompressor.load(file);
  return decompressor.decompress();
}
