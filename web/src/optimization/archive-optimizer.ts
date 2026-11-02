/**
 * SPK Micro-Optimization Layer - Archive Writer Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 7: ARCHIVE WRITER OPTIMIZATION
 * - Streaming accumulation (BlobBuilder / stream writer)
 * - Avoid large concatenations
 * - Write metadata late (generate footer once)
 * - TypedArrays for internal tables
 * - Optional metadata compression (LZ4)
 */

import type {
  ArchiveWriterConfig,
  ArchiveWriterStats,
  AccumulationStrategy,
  MetadataCompression,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_ARCHIVE_CONFIG: ArchiveWriterConfig = {
  accumulationStrategy: 'stream-writer',
  avoidLargeConcatenations: true,
  writeMetadataLate: true,
  generateFooterOnce: true,
  avoidRecalculations: true,
  useTypedArrays: true,
  offsetArrayType: 'Uint32Array',
  metricArrayType: 'Float32Array',
  metadataCompression: 'auto',
  metadataCompressionLevel: 3,
};

// SPK Archive Magic Bytes
const SPK_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x00]);  // "SPK\0"
const SPK_VERSION = 24;

// ============================================================================
// OFFSET TABLE (TypedArray based)
// ============================================================================

class OffsetTable {
  private offsets: Uint32Array | BigUint64Array;
  private sizes: Uint32Array | BigUint64Array;
  private count = 0;
  private capacity: number;
  private use64Bit: boolean;

  constructor(initialCapacity: number = 1024, use64Bit: boolean = false) {
    this.capacity = initialCapacity;
    this.use64Bit = use64Bit;

    if (use64Bit) {
      this.offsets = new BigUint64Array(initialCapacity);
      this.sizes = new BigUint64Array(initialCapacity);
    } else {
      this.offsets = new Uint32Array(initialCapacity);
      this.sizes = new Uint32Array(initialCapacity);
    }
  }

  /**
   * Add entry
   */
  add(offset: number | bigint, size: number | bigint): number {
    if (this.count >= this.capacity) {
      this.grow();
    }

    const index = this.count++;

    if (this.use64Bit) {
      (this.offsets as BigUint64Array)[index] = BigInt(offset);
      (this.sizes as BigUint64Array)[index] = BigInt(size);
    } else {
      (this.offsets as Uint32Array)[index] = Number(offset);
      (this.sizes as Uint32Array)[index] = Number(size);
    }

    return index;
  }

  /**
   * Get entry
   */
  get(index: number): { offset: number | bigint; size: number | bigint } | null {
    if (index < 0 || index >= this.count) return null;

    return {
      offset: this.offsets[index],
      size: this.sizes[index],
    };
  }

  /**
   * Get count
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Serialize to bytes
   */
  toBytes(): Uint8Array {
    const headerSize = 8;  // count (4) + flags (4)
    const entrySize = this.use64Bit ? 16 : 8;
    const dataSize = this.count * entrySize;
    const totalSize = headerSize + dataSize * 2;  // offsets + sizes

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const result = new Uint8Array(buffer);

    // Header
    view.setUint32(0, this.count, true);
    view.setUint32(4, this.use64Bit ? 1 : 0, true);

    // Data
    const offsetBytes = new Uint8Array(this.offsets.buffer, 0, this.count * (this.use64Bit ? 8 : 4));
    const sizeBytes = new Uint8Array(this.sizes.buffer, 0, this.count * (this.use64Bit ? 8 : 4));

    result.set(offsetBytes, headerSize);
    result.set(sizeBytes, headerSize + offsetBytes.byteLength);

    return result;
  }

  /**
   * Grow capacity
   */
  private grow(): void {
    const newCapacity = this.capacity * 2;

    if (this.use64Bit) {
      const newOffsets = new BigUint64Array(newCapacity);
      const newSizes = new BigUint64Array(newCapacity);
      newOffsets.set(this.offsets as BigUint64Array);
      newSizes.set(this.sizes as BigUint64Array);
      this.offsets = newOffsets;
      this.sizes = newSizes;
    } else {
      const newOffsets = new Uint32Array(newCapacity);
      const newSizes = new Uint32Array(newCapacity);
      newOffsets.set(this.offsets as Uint32Array);
      newSizes.set(this.sizes as Uint32Array);
      this.offsets = newOffsets;
      this.sizes = newSizes;
    }

    this.capacity = newCapacity;
  }

  /**
   * Clear table
   */
  clear(): void {
    this.count = 0;
  }
}

// ============================================================================
// METRICS TABLE (Float32 based)
// ============================================================================

interface ChunkMetrics {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  processTime: number;
}

class MetricsTable {
  private metrics: Float32Array;
  private count = 0;
  private capacity: number;
  private metricsPerEntry = 4;  // originalSize, compressedSize, ratio, processTime

  constructor(initialCapacity: number = 1024) {
    this.capacity = initialCapacity;
    this.metrics = new Float32Array(initialCapacity * this.metricsPerEntry);
  }

  /**
   * Add metrics
   */
  add(metrics: ChunkMetrics): number {
    if (this.count >= this.capacity) {
      this.grow();
    }

    const index = this.count++;
    const base = index * this.metricsPerEntry;

    this.metrics[base] = metrics.originalSize;
    this.metrics[base + 1] = metrics.compressedSize;
    this.metrics[base + 2] = metrics.ratio;
    this.metrics[base + 3] = metrics.processTime;

    return index;
  }

  /**
   * Get metrics
   */
  get(index: number): ChunkMetrics | null {
    if (index < 0 || index >= this.count) return null;

    const base = index * this.metricsPerEntry;

    return {
      originalSize: this.metrics[base],
      compressedSize: this.metrics[base + 1],
      ratio: this.metrics[base + 2],
      processTime: this.metrics[base + 3],
    };
  }

  /**
   * Get aggregate stats
   */
  getAggregateStats(): {
    totalOriginal: number;
    totalCompressed: number;
    avgRatio: number;
    avgProcessTime: number;
  } {
    let totalOriginal = 0;
    let totalCompressed = 0;
    let totalRatio = 0;
    let totalTime = 0;

    for (let i = 0; i < this.count; i++) {
      const base = i * this.metricsPerEntry;
      totalOriginal += this.metrics[base];
      totalCompressed += this.metrics[base + 1];
      totalRatio += this.metrics[base + 2];
      totalTime += this.metrics[base + 3];
    }

    return {
      totalOriginal,
      totalCompressed,
      avgRatio: this.count > 0 ? totalRatio / this.count : 0,
      avgProcessTime: this.count > 0 ? totalTime / this.count : 0,
    };
  }

  /**
   * Serialize to bytes
   */
  toBytes(): Uint8Array {
    const headerSize = 8;
    const dataSize = this.count * this.metricsPerEntry * 4;

    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);
    const result = new Uint8Array(buffer);

    // Header
    view.setUint32(0, this.count, true);
    view.setUint32(4, this.metricsPerEntry, true);

    // Data
    const metricsBytes = new Uint8Array(
      this.metrics.buffer,
      0,
      this.count * this.metricsPerEntry * 4
    );
    result.set(metricsBytes, headerSize);

    return result;
  }

  /**
   * Grow capacity
   */
  private grow(): void {
    const newCapacity = this.capacity * 2;
    const newMetrics = new Float32Array(newCapacity * this.metricsPerEntry);
    newMetrics.set(this.metrics);
    this.metrics = newMetrics;
    this.capacity = newCapacity;
  }

  /**
   * Get count
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Clear table
   */
  clear(): void {
    this.count = 0;
  }
}

// ============================================================================
// STREAMING ACCUMULATOR
// ============================================================================

class StreamingAccumulator {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;
  private strategy: AccumulationStrategy;
  private flushThreshold: number;

  constructor(strategy: AccumulationStrategy, flushThreshold: number = 64 * 1024 * 1024) {
    this.strategy = strategy;
    this.flushThreshold = flushThreshold;
  }

  /**
   * Append data
   */
  append(data: Uint8Array): void {
    this.chunks.push(data);
    this.totalSize += data.byteLength;
  }

  /**
   * Check if should flush
   */
  shouldFlush(): boolean {
    return this.totalSize >= this.flushThreshold;
  }

  /**
   * Get as Blob
   */
  toBlob(mimeType: string = 'application/octet-stream'): Blob {
    return new Blob(this.chunks as BlobPart[], { type: mimeType });
  }

  /**
   * Get stream
   */
  *stream(): Generator<Uint8Array> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }

  /**
   * Get total size
   */
  getSize(): number {
    return this.totalSize;
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Clear accumulator
   */
  clear(): void {
    this.chunks = [];
    this.totalSize = 0;
  }
}

// ============================================================================
// METADATA COMPRESSOR (Simple LZ4-like)
// ============================================================================

class MetadataCompressor {
  /**
   * Compress metadata (simple RLE + delta encoding for tables)
   */
  static compress(data: Uint8Array, level: number = 3): Uint8Array {
    if (data.length < 64 || level === 0) {
      // Too small or compression disabled
      return this.wrapUncompressed(data);
    }

    // Simple compression: store only non-zero runs
    const compressed: number[] = [];
    let i = 0;

    while (i < data.length) {
      // Count consecutive identical bytes
      let runLength = 1;
      while (i + runLength < data.length && 
             data[i + runLength] === data[i] && 
             runLength < 255) {
        runLength++;
      }

      if (runLength >= 4) {
        // RLE: marker (0xFF) + byte + length
        compressed.push(0xFF, data[i], runLength);
        i += runLength;
      } else {
        // Literal
        if (data[i] === 0xFF) {
          // Escape 0xFF
          compressed.push(0xFF, 0xFF, 1);
        } else {
          compressed.push(data[i]);
        }
        i++;
      }
    }

    // Check if compression was beneficial
    if (compressed.length >= data.length * 0.95) {
      return this.wrapUncompressed(data);
    }

    // Wrap compressed data
    const result = new Uint8Array(compressed.length + 9);
    const view = new DataView(result.buffer);
    
    result[0] = 0x01;  // Compressed flag
    view.setUint32(1, data.length, true);  // Original size
    view.setUint32(5, compressed.length, true);  // Compressed size
    result.set(new Uint8Array(compressed), 9);

    return result;
  }

  /**
   * Decompress metadata
   */
  static decompress(data: Uint8Array): Uint8Array {
    if (data[0] === 0x00) {
      // Uncompressed
      return data.subarray(9);
    }

    const view = new DataView(data.buffer, data.byteOffset);
    const originalSize = view.getUint32(1, true);
    const compressedSize = view.getUint32(5, true);

    const result = new Uint8Array(originalSize);
    const compressed = data.subarray(9, 9 + compressedSize);
    
    let srcPos = 0;
    let dstPos = 0;

    while (srcPos < compressed.length && dstPos < originalSize) {
      if (compressed[srcPos] === 0xFF && srcPos + 2 < compressed.length) {
        const byte = compressed[srcPos + 1];
        const length = compressed[srcPos + 2];
        
        if (byte === 0xFF && length === 1) {
          // Escaped 0xFF
          result[dstPos++] = 0xFF;
        } else {
          // RLE
          for (let i = 0; i < length && dstPos < originalSize; i++) {
            result[dstPos++] = byte;
          }
        }
        srcPos += 3;
      } else {
        result[dstPos++] = compressed[srcPos++];
      }
    }

    return result;
  }

  /**
   * Wrap uncompressed data
   */
  private static wrapUncompressed(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length + 9);
    const view = new DataView(result.buffer);
    
    result[0] = 0x00;  // Uncompressed flag
    view.setUint32(1, data.length, true);
    view.setUint32(5, data.length, true);
    result.set(data, 9);

    return result;
  }
}

// ============================================================================
// ARCHIVE FOOTER
// ============================================================================

interface ArchiveFooter {
  magic: Uint8Array;
  version: number;
  flags: number;
  chunkCount: number;
  originalSize: bigint;
  compressedSize: bigint;
  metadataOffset: bigint;
  metadataSize: number;
  checksum: number;
}

class FooterBuilder {
  private footer: ArchiveFooter;
  private built = false;

  constructor() {
    this.footer = {
      magic: SPK_MAGIC,
      version: SPK_VERSION,
      flags: 0,
      chunkCount: 0,
      originalSize: 0n,
      compressedSize: 0n,
      metadataOffset: 0n,
      metadataSize: 0,
      checksum: 0,
    };
  }

  /**
   * Set chunk count
   */
  setChunkCount(count: number): this {
    this.footer.chunkCount = count;
    return this;
  }

  /**
   * Set sizes
   */
  setSizes(original: bigint, compressed: bigint): this {
    this.footer.originalSize = original;
    this.footer.compressedSize = compressed;
    return this;
  }

  /**
   * Set metadata info
   */
  setMetadata(offset: bigint, size: number): this {
    this.footer.metadataOffset = offset;
    this.footer.metadataSize = size;
    return this;
  }

  /**
   * Set flags
   */
  setFlags(flags: number): this {
    this.footer.flags = flags;
    return this;
  }

  /**
   * Calculate checksum
   */
  calculateChecksum(data: Uint8Array): this {
    // Simple CRC32-like checksum
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < Math.min(data.length, 1024 * 1024); i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    this.footer.checksum = crc ^ 0xFFFFFFFF;
    return this;
  }

  /**
   * Build footer bytes
   */
  build(): Uint8Array {
    if (this.built) {
      throw new Error('Footer already built');
    }

    const size = 64;  // Fixed footer size
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    const result = new Uint8Array(buffer);

    // Magic (4 bytes)
    result.set(this.footer.magic, 0);
    
    // Version (2 bytes)
    view.setUint16(4, this.footer.version, true);
    
    // Flags (2 bytes)
    view.setUint16(6, this.footer.flags, true);
    
    // Chunk count (4 bytes)
    view.setUint32(8, this.footer.chunkCount, true);
    
    // Original size (8 bytes)
    view.setBigUint64(12, this.footer.originalSize, true);
    
    // Compressed size (8 bytes)
    view.setBigUint64(20, this.footer.compressedSize, true);
    
    // Metadata offset (8 bytes)
    view.setBigUint64(28, this.footer.metadataOffset, true);
    
    // Metadata size (4 bytes)
    view.setUint32(36, this.footer.metadataSize, true);
    
    // Checksum (4 bytes)
    view.setUint32(40, this.footer.checksum, true);
    
    // Reserved (20 bytes)
    // Already zero-filled

    this.built = true;
    return result;
  }

  /**
   * Reset builder
   */
  reset(): void {
    this.footer = {
      magic: SPK_MAGIC,
      version: SPK_VERSION,
      flags: 0,
      chunkCount: 0,
      originalSize: 0n,
      compressedSize: 0n,
      metadataOffset: 0n,
      metadataSize: 0,
      checksum: 0,
    };
    this.built = false;
  }
}

// ============================================================================
// ARCHIVE WRITER OPTIMIZER
// ============================================================================

export class ArchiveWriterOptimizer {
  private config: ArchiveWriterConfig;
  private accumulator: StreamingAccumulator;
  private offsetTable: OffsetTable;
  private metricsTable: MetricsTable;
  private footerBuilder: FooterBuilder;
  private currentOffset = 0n;
  private headerWritten = false;

  private stats: ArchiveWriterStats = {
    chunksWritten: 0,
    bytesWritten: 0,
    metadataSize: 0,
    footerSize: 64,
    compressionRatio: 0,
    writeLatency: 0,
    flushCount: 0,
    concatenationCount: 0,
  };

  private writeLatencies: number[] = [];

  constructor(config: Partial<ArchiveWriterConfig> = {}) {
    this.config = { ...DEFAULT_ARCHIVE_CONFIG, ...config };
    this.accumulator = new StreamingAccumulator(
      this.config.accumulationStrategy,
      64 * 1024 * 1024
    );
    this.offsetTable = new OffsetTable(
      1024,
      this.config.offsetArrayType === 'BigUint64Array'
    );
    this.metricsTable = new MetricsTable(1024);
    this.footerBuilder = new FooterBuilder();
  }

  /**
   * Start new archive
   */
  start(): void {
    this.writeHeader();
    this.headerWritten = true;
  }

  /**
   * Write archive header
   */
  private writeHeader(): void {
    const header = new Uint8Array(16);
    const view = new DataView(header.buffer);

    // Magic
    header.set(SPK_MAGIC, 0);
    
    // Version
    view.setUint16(4, SPK_VERSION, true);
    
    // Flags
    view.setUint16(6, 0, true);
    
    // Reserved
    view.setBigUint64(8, 0n, true);

    this.accumulator.append(header);
    this.currentOffset = BigInt(header.length);
  }

  /**
   * Write chunk
   */
  writeChunk(
    compressedData: Uint8Array,
    originalSize: number,
    processTime: number = 0
  ): number {
    if (!this.headerWritten) {
      this.start();
    }

    const startTime = performance.now();

    // Record offset
    const index = this.offsetTable.add(this.currentOffset, BigInt(compressedData.length));

    // Record metrics
    this.metricsTable.add({
      originalSize,
      compressedSize: compressedData.length,
      ratio: 1 - (compressedData.length / originalSize),
      processTime,
    });

    // Append data
    this.accumulator.append(compressedData);
    this.currentOffset += BigInt(compressedData.length);

    // Update stats
    const writeTime = performance.now() - startTime;
    this.writeLatencies.push(writeTime);
    if (this.writeLatencies.length > 100) {
      this.writeLatencies.shift();
    }

    this.stats.chunksWritten++;
    this.stats.bytesWritten += compressedData.length;
    this.stats.writeLatency = 
      this.writeLatencies.reduce((a, b) => a + b, 0) / this.writeLatencies.length;

    // Check for flush
    if (this.accumulator.shouldFlush() && !this.config.avoidLargeConcatenations) {
      this.stats.flushCount++;
    }

    return index;
  }

  /**
   * Finalize archive
   */
  finalize(): Blob {
    if (!this.headerWritten) {
      this.start();
    }

    // Generate metadata
    const metadataOffset = this.currentOffset;
    const metadata = this.generateMetadata();
    
    // Compress metadata if configured
    let metadataBytes: Uint8Array;
    if (this.config.metadataCompression !== 'none') {
      metadataBytes = MetadataCompressor.compress(
        metadata,
        this.config.metadataCompressionLevel
      );
    } else {
      metadataBytes = metadata;
    }

    this.accumulator.append(metadataBytes);
    this.stats.metadataSize = metadataBytes.length;

    // Generate footer
    const aggregateStats = this.metricsTable.getAggregateStats();
    
    const footer = this.footerBuilder
      .setChunkCount(this.stats.chunksWritten)
      .setSizes(
        BigInt(Math.floor(aggregateStats.totalOriginal)),
        BigInt(Math.floor(aggregateStats.totalCompressed))
      )
      .setMetadata(metadataOffset, metadataBytes.length)
      .setFlags(this.config.metadataCompression !== 'none' ? 0x01 : 0x00)
      .build();

    this.accumulator.append(footer);

    // Calculate final stats
    this.stats.compressionRatio = aggregateStats.avgRatio;

    return this.accumulator.toBlob('application/x-spk');
  }

  /**
   * Generate metadata section
   */
  private generateMetadata(): Uint8Array {
    const offsetBytes = this.offsetTable.toBytes();
    const metricsBytes = this.metricsTable.toBytes();

    // Combine with length prefixes
    const totalSize = 8 + offsetBytes.length + metricsBytes.length;
    const result = new Uint8Array(totalSize);
    const view = new DataView(result.buffer);

    let pos = 0;

    // Offset table length + data
    view.setUint32(pos, offsetBytes.length, true);
    pos += 4;
    result.set(offsetBytes, pos);
    pos += offsetBytes.length;

    // Metrics table length + data
    view.setUint32(pos, metricsBytes.length, true);
    pos += 4;
    result.set(metricsBytes, pos);

    return result;
  }

  /**
   * Get current statistics
   */
  getStats(): ArchiveWriterStats {
    return { ...this.stats };
  }

  /**
   * Get configuration
   */
  getConfig(): ArchiveWriterConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ArchiveWriterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current size
   */
  getCurrentSize(): number {
    return Number(this.currentOffset);
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.stats.chunksWritten;
  }

  /**
   * Reset writer
   */
  reset(): void {
    this.accumulator.clear();
    this.offsetTable.clear();
    this.metricsTable.clear();
    this.footerBuilder.reset();
    this.currentOffset = 0n;
    this.headerWritten = false;
    this.writeLatencies = [];
    
    this.stats = {
      chunksWritten: 0,
      bytesWritten: 0,
      metadataSize: 0,
      footerSize: 64,
      compressionRatio: 0,
      writeLatency: 0,
      flushCount: 0,
      concatenationCount: 0,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let archiveWriterInstance: ArchiveWriterOptimizer | null = null;

export function getArchiveWriterOptimizer(
  config?: Partial<ArchiveWriterConfig>
): ArchiveWriterOptimizer {
  if (!archiveWriterInstance) {
    archiveWriterInstance = new ArchiveWriterOptimizer(config);
  }
  return archiveWriterInstance;
}

export function resetArchiveWriterOptimizer(): void {
  if (archiveWriterInstance) {
    archiveWriterInstance.reset();
  }
  archiveWriterInstance = null;
}
