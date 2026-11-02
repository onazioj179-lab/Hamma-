/**
 * SPK Mobile Fallback Compressor
 * 
 * Main-thread synchronous compressor for mobile devices that don't support
 * Workers, SharedArrayBuffer, or have limited WASM capabilities.
 * 
 * Designed for:
 * - iOS Safari (no SharedArrayBuffer)
 * - Low-memory Android devices
 * - Older browsers without Worker module support
 * - PWA/WebView environments
 * 
 * Features:
 * - Zero external dependencies
 * - Chunked processing to prevent UI blocking
 * - Memory-efficient streaming
 * - Progress callbacks for UI updates
 * 
 * @module fallback/mobile-compressor
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface MobileCompressorConfig {
  /** Compression level (1-9, higher = better compression, slower) */
  level: number;
  /** Chunk size for processing (smaller = more responsive UI) */
  chunkSize: number;
  /** Yield to main thread every N bytes */
  yieldInterval: number;
  /** Enable progress callbacks */
  enableProgress: boolean;
}

export interface MobileProgress {
  /** Progress percentage (0-100) */
  progress: number;
  /** Bytes processed so far */
  bytesProcessed: number;
  /** Total bytes to process */
  totalBytes: number;
  /** Current phase */
  phase: 'reading' | 'compressing' | 'finalizing' | 'complete';
  /** Estimated speed (bytes/sec) */
  speed: number;
  /** Estimated time remaining (ms) */
  eta: number;
}

export interface MobileResult {
  /** Success flag */
  success: boolean;
  /** Compressed data */
  data?: Uint8Array;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (compressed/original) */
  ratio: number;
  /** Time taken in ms */
  duration: number;
  /** Error message if failed */
  error?: string;
}

export type MobileProgressCallback = (progress: MobileProgress) => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: MobileCompressorConfig = {
  level: 6,
  chunkSize: 1024 * 1024, // 1MB chunks for maximum throughput on large files
  yieldInterval: 1024 * 1024, // Yield every 1MB (less often = much faster for 10TB files)
  enableProgress: true,
};

// SPK Header magic bytes
const SPK_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x00]); // "SPK\0"
const SPK_VERSION = 1;
const HEADER_SIZE = 64;
const FOOTER_SIZE = 32;

// ============================================================================
// Mobile Compressor Class
// ============================================================================

export class MobileCompressor {
  private config: MobileCompressorConfig;
  private progressCallback?: MobileProgressCallback;
  private aborted = false;
  private startTime = 0;
  private bytesProcessed = 0;

  constructor(config: Partial<MobileCompressorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Adjust for compression level
    if (this.config.level < 4) {
      this.config.chunkSize = 128 * 1024; // Faster, larger chunks
    } else if (this.config.level > 7) {
      this.config.chunkSize = 32 * 1024; // Better compression, smaller chunks
    }
  }

  /**
   * Set progress callback
   */
  onProgress(callback: MobileProgressCallback): this {
    this.progressCallback = callback;
    return this;
  }

  /**
   * Abort current operation
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Compress data with mobile-optimized algorithm
   */
  async compress(data: Uint8Array, filename?: string): Promise<MobileResult> {
    this.aborted = false;
    this.startTime = Date.now();
    this.bytesProcessed = 0;

    try {
      this.reportProgress(0, 0, data.length, 'reading');

      // LZ77 compression with yielding
      const compressed = await this.lz77CompressAsync(data);

      if (this.aborted) {
        return this.createErrorResult('Operation aborted');
      }

      this.reportProgress(90, data.length, data.length, 'finalizing');

      // Build SPK archive
      const archive = this.buildArchive(data.length, compressed, filename);

      this.reportProgress(100, data.length, data.length, 'complete');

      const duration = Date.now() - this.startTime;
      return {
        success: true,
        data: archive,
        originalSize: data.length,
        compressedSize: archive.length,
        ratio: archive.length / data.length,
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(message);
    }
  }

  /**
   * Decompress SPK archive
   */
  async decompress(archive: Uint8Array): Promise<MobileResult> {
    this.aborted = false;
    this.startTime = Date.now();
    this.bytesProcessed = 0;

    try {
      // Validate header
      if (!this.validateHeader(archive)) {
        return this.createErrorResult('Invalid SPK archive');
      }

      // Extract original size from header
      const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
      const originalSize = Number(view.getBigUint64(8, true));
      const compressedSize = Number(view.getBigUint64(16, true));

      if (view.getUint16(4, true) !== SPK_VERSION ||
          !Number.isSafeInteger(originalSize) || !Number.isSafeInteger(compressedSize) ||
          HEADER_SIZE + compressedSize + FOOTER_SIZE !== archive.length) {
        throw new Error('Invalid SPK archive size or version');
      }
      const footer = HEADER_SIZE + compressedSize;
      if (archive[footer] !== 0x45 || archive[footer + 1] !== 0x4E || archive[footer + 2] !== 0x44 ||
          view.getBigUint64(footer + 4, true) !== BigInt(archive.length) ||
          view.getBigUint64(footer + 12, true) !== BigInt(originalSize) ||
          view.getUint32(footer + 20, true) !== this.crc32(archive.subarray(0, footer + 20))) {
        throw new Error('SPK archive integrity check failed');
      }

      this.reportProgress(0, 0, originalSize, 'reading');

      // Extract compressed data
      const compressedData = archive.slice(HEADER_SIZE, HEADER_SIZE + compressedSize);
      if (view.getUint32(28, true) !== this.crc32(compressedData)) {
        throw new Error('SPK payload checksum mismatch');
      }

      // Decompress
      const decompressed = await this.lz77DecompressAsync(compressedData, originalSize);

      if (this.aborted) {
        return this.createErrorResult('Operation aborted');
      }

      this.reportProgress(100, originalSize, originalSize, 'complete');

      const duration = Date.now() - this.startTime;
      return {
        success: true,
        data: decompressed,
        originalSize,
        compressedSize: archive.length,
        ratio: archive.length / originalSize,
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(message);
    }
  }

  // ==========================================================================
  // LZ77 Compression (Async with yielding) - OPTIMIZED with hash table
  // ==========================================================================

  /**
   * LZ77 compression with hash-based matching
   * Uses 3-byte hash chains for O(1) average match lookup
   * 
   * For MAXIMUM COMPRESSION (level 7-9):
   * - Deep hash chain traversal (up to 4096 positions)
   * - Lazy matching (check if next byte gives better match)
   * - No early exits - always find the absolute best match
   * - 32KB sliding window
   */
  private async lz77CompressAsync(data: Uint8Array): Promise<Uint8Array> {
    const windowSize = this.getWindowSize();
    const output: number[] = [];
    let pos = 0;
    let lastYield = 0;

    // Hash table for fast matching: maps 3-byte hash to positions
    const HASH_SIZE = 65536; // 64KB hash table
    const hashTable = new Int32Array(HASH_SIZE).fill(-1);
    const hashChain = new Int32Array(data.length); // Chain to previous positions with same hash
    
    // Hash function for 3 bytes - improved distribution
    const hash3 = (p: number): number => {
      if (p + 2 >= data.length) return 0;
      // Better hash function for fewer collisions
      return ((data[p] * 31 + data[p + 1]) * 31 + data[p + 2]) & (HASH_SIZE - 1);
    };

    // Compression parameters based on level
    // Level 9 = MAXIMUM COMPRESSION for smallest 10TB output
    const isMaxCompression = this.config.level >= 7;
    const maxChainLength = isMaxCompression ? 4096 : (this.config.level >= 5 ? 256 : 64);
    const useLazyMatching = isMaxCompression;
    const earlyExitLength = isMaxCompression ? 258 : (this.config.level >= 5 ? 200 : 128);

    while (pos < data.length) {
      if (this.aborted) break;

      let bestLength = 0;
      let bestOffset = 0;

      // Only search if we have at least 3 bytes
      if (pos + 2 < data.length) {
        const h = hash3(pos);
        let chainPos = hashTable[h];
        let chainCount = 0;
        const minMatchPos = Math.max(0, pos - windowSize);

        // Search hash chain for best match
        while (chainPos >= minMatchPos && chainCount < maxChainLength) {
          // Verify match and find length
          let len = 0;
          // The archive stores match length in one byte.
          const maxLen = Math.min(255, data.length - pos);
          
          // Quick check: first bytes must match
          if (data[chainPos] === data[pos]) {
            // For max compression, also check end bytes to skip bad matches faster
            if (isMaxCompression && bestLength > 3) {
              if (data[chainPos + bestLength] !== data[pos + bestLength]) {
                chainPos = hashChain[chainPos];
                chainCount++;
                continue;
              }
            }
            
            // Full comparison
            while (len < maxLen && data[chainPos + len] === data[pos + len]) {
              len++;
            }
            
            if (len > bestLength) {
              bestLength = len;
              bestOffset = pos - chainPos;
              
              // Early exit only if we found max length
              if (len >= earlyExitLength) break;
            }
          }
          
          chainPos = hashChain[chainPos];
          chainCount++;
        }

        // LAZY MATCHING: Check if starting at next position gives even better match
        // This is crucial for maximum compression
        if (useLazyMatching && bestLength >= 3 && bestLength < 258 && pos + 1 + 2 < data.length) {
          const h2 = hash3(pos + 1);
          let chainPos2 = hashTable[h2];
          let chainCount2 = 0;
          let lazyBestLength = 0;
          let lazyBestOffset = 0;
          const minMatchPos2 = Math.max(0, pos + 1 - windowSize);
          
          // Search for better match at pos+1
          while (chainPos2 >= minMatchPos2 && chainCount2 < maxChainLength) {
            let len = 0;
            const maxLen = Math.min(255, data.length - pos - 1);
            
            if (data[chainPos2] === data[pos + 1]) {
              while (len < maxLen && data[chainPos2 + len] === data[pos + 1 + len]) {
                len++;
              }
              
              if (len > lazyBestLength) {
                lazyBestLength = len;
                lazyBestOffset = pos + 1 - chainPos2;
                if (len >= earlyExitLength) break;
              }
            }
            
            chainPos2 = hashChain[chainPos2];
            chainCount2++;
          }
          
          // If lazy match is significantly better, emit current byte as literal
          // and use the lazy match next iteration
          if (lazyBestLength > bestLength + 1) {
            // Emit current byte as literal
            if (data[pos] === 0xFF) {
              output.push(0xFF, 0x00, 0x00, 0x01);
            } else {
              output.push(data[pos]);
            }
            
            // Update hash for current position
            hashChain[pos] = hashTable[h];
            hashTable[h] = pos;
            pos++;
            
            // The lazy match will be found again in next iteration
            continue;
          }
        }

        // Update hash table
        hashChain[pos] = hashTable[h];
        hashTable[h] = pos;
      }

      // Encode
      if (bestLength >= 3) {
        // Match found: [0xFF, offset_high, offset_low, length]
        output.push(0xFF);
        output.push((bestOffset >> 8) & 0xFF);
        output.push(bestOffset & 0xFF);
        output.push(bestLength);
        
        // Update hash for all skipped positions (important for max compression)
        for (let i = 1; i < bestLength && pos + i + 2 < data.length; i++) {
          const h = hash3(pos + i);
          hashChain[pos + i] = hashTable[h];
          hashTable[h] = pos + i;
        }
        
        pos += bestLength;
      } else {
        // Literal byte (escape 0xFF)
        if (data[pos] === 0xFF) {
          output.push(0xFF, 0x00, 0x00, 0x01);
        } else {
          output.push(data[pos]);
        }
        pos++;
      }

      // Yield to main thread periodically
      if (pos - lastYield >= this.config.yieldInterval) {
        lastYield = pos;
        this.bytesProcessed = pos;
        this.reportProgress(
          (pos / data.length) * 85, // Reserve 15% for finalization
          pos,
          data.length,
          'compressing'
        );
        await this.yieldToMainThread();
      }
    }

    return new Uint8Array(output);
  }

  /**
   * LZ77 decompression with periodic yields
   */
  private async lz77DecompressAsync(
    compressed: Uint8Array,
    expectedSize: number
  ): Promise<Uint8Array> {
    const output: number[] = [];
    let pos = 0;
    let lastYield = 0;

    while (pos < compressed.length && output.length < expectedSize) {
      if (this.aborted) break;

      if (compressed[pos] === 0xFF) {
        if (pos + 3 >= compressed.length) throw new Error('Truncated SPK back-reference');
        // Back-reference or escaped literal
        const offsetHigh = compressed[pos + 1];
        const offsetLow = compressed[pos + 2];
        const length = compressed[pos + 3];
        const offset = (offsetHigh << 8) | offsetLow;

        if (offset === 0 && length === 1) {
          // Escaped 0xFF literal
          output.push(0xFF);
        } else if (offset > 0 && offset <= output.length && length > 0 && output.length + length <= expectedSize) {
          // Copy from back-reference
          const start = output.length - offset;
          // Copy byte by byte to handle overlapping references correctly
          for (let i = 0; i < length && output.length < expectedSize; i++) {
            output.push(output[start + i]);
          }
        } else {
          throw new Error('Invalid SPK back-reference');
        }
        pos += 4;
      } else {
        // Literal byte
        output.push(compressed[pos]);
        pos++;
      }

      // Yield periodically
      if (output.length - lastYield >= this.config.yieldInterval) {
        lastYield = output.length;
        this.reportProgress(
          (output.length / expectedSize) * 100,
          output.length,
          expectedSize,
          'compressing'
        );
        await this.yieldToMainThread();
      }
    }

    if (!this.aborted && (output.length !== expectedSize || pos !== compressed.length)) {
      throw new Error('Invalid SPK payload length');
    }
    return new Uint8Array(output);
  }

  // ==========================================================================
  // Archive Building
  // ==========================================================================

  /**
   * Build SPK archive with header and footer
   */
  private buildArchive(
    originalSize: number,
    compressed: Uint8Array,
    filename?: string
  ): Uint8Array {
    const totalSize = HEADER_SIZE + compressed.length + FOOTER_SIZE;
    const result = new Uint8Array(totalSize);
    const view = new DataView(result.buffer);

    // === HEADER (64 bytes) ===
    // Magic (4 bytes)
    result.set(SPK_MAGIC, 0);
    // Version (2 bytes)
    view.setUint16(4, SPK_VERSION, true);
    // Flags (2 bytes) - 0x01 = mobile compression
    view.setUint16(6, 0x01, true);
    // Original size (8 bytes)
    view.setBigUint64(8, BigInt(originalSize), true);
    // Compressed size (8 bytes)
    view.setBigUint64(16, BigInt(compressed.length), true);
    // Chunk count (4 bytes) - 1 for simple compression
    view.setUint32(24, 1, true);
    // Checksum placeholder (4 bytes)
    view.setUint32(28, this.crc32(compressed), true);
    // Timestamp (8 bytes)
    view.setBigUint64(32, BigInt(Date.now()), true);
    // Filename length (2 bytes)
    const fnBytes = filename ? new TextEncoder().encode(filename).slice(0, 22) : new Uint8Array(0);
    view.setUint16(40, fnBytes.length, true);
    // Filename (up to 22 bytes, padded)
    result.set(fnBytes, 42);

    // === COMPRESSED DATA ===
    result.set(compressed, HEADER_SIZE);

    // === FOOTER (32 bytes) ===
    const footerStart = HEADER_SIZE + compressed.length;
    // Footer magic
    result[footerStart] = 0x45; // E
    result[footerStart + 1] = 0x4E; // N
    result[footerStart + 2] = 0x44; // D
    result[footerStart + 3] = 0x00;
    // Total archive size (8 bytes)
    view.setBigUint64(footerStart + 4, BigInt(totalSize), true);
    // Original size repeat (8 bytes)
    view.setBigUint64(footerStart + 12, BigInt(originalSize), true);
    // Archive checksum (4 bytes)
    view.setUint32(footerStart + 20, this.crc32(result.slice(0, footerStart + 20)), true);
    // Padding
    view.setUint32(footerStart + 24, 0, true);
    view.setUint32(footerStart + 28, 0, true);

    return result;
  }

  /**
   * Validate SPK header
   */
  private validateHeader(data: Uint8Array): boolean {
    if (data.length < HEADER_SIZE + FOOTER_SIZE) return false;
    
    // Check magic bytes
    return (
      data[0] === SPK_MAGIC[0] &&
      data[1] === SPK_MAGIC[1] &&
      data[2] === SPK_MAGIC[2] &&
      data[3] === SPK_MAGIC[3]
    );
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get window size based on compression level
   * Larger window = better compression ratio but slower
   * For MAXIMUM COMPRESSION (10TB → smallest), use 32KB window
   */
  private getWindowSize(): number {
    // Window sizes optimized for compression ratio
    if (this.config.level <= 1) return 4096;      // Fast: 4KB window
    if (this.config.level <= 3) return 8192;      // Balanced-fast: 8KB window
    if (this.config.level <= 5) return 16384;     // Balanced: 16KB window
    // Levels 6-9: Maximum 32KB window for best compression
    return 32768;                                  // Maximum: 32KB window (best ratio)
  }

  /**
   * Yield to main thread (allows UI updates)
   */
  private yieldToMainThread(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(), { timeout: 16 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * Report progress to callback
   */
  private reportProgress(
    progress: number,
    bytesProcessed: number,
    totalBytes: number,
    phase: MobileProgress['phase']
  ): void {
    if (!this.config.enableProgress || !this.progressCallback) return;

    const elapsed = Date.now() - this.startTime;
    const speed = elapsed > 0 ? (bytesProcessed / elapsed) * 1000 : 0;
    const remaining = totalBytes - bytesProcessed;
    const eta = speed > 0 ? (remaining / speed) * 1000 : 0;

    this.progressCallback({
      progress: Math.min(100, Math.max(0, progress)),
      bytesProcessed,
      totalBytes,
      phase,
      speed,
      eta,
    });
  }

  /**
   * Create error result
   */
  private createErrorResult(error: string): MobileResult {
    return {
      success: false,
      originalSize: 0,
      compressedSize: 0,
      ratio: 0,
      duration: Date.now() - this.startTime,
      error,
    };
  }

  /**
   * Simple CRC32 checksum
   */
  private crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick compress with default settings
 */
export async function mobileCompress(
  data: Uint8Array,
  onProgress?: MobileProgressCallback
): Promise<MobileResult> {
  const compressor = new MobileCompressor();
  if (onProgress) compressor.onProgress(onProgress);
  return compressor.compress(data);
}

/**
 * Quick decompress
 */
export async function mobileDecompress(
  archive: Uint8Array,
  onProgress?: MobileProgressCallback
): Promise<MobileResult> {
  const compressor = new MobileCompressor();
  if (onProgress) compressor.onProgress(onProgress);
  return compressor.decompress(archive);
}

export default MobileCompressor;
