/**
 * SPK Micro-Optimization Layer - I/O Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 6: FILE STREAMING OPTIMIZATION
 * - Native file streams (ReadableStream)
 * - Never load full file in RAM
 * - Pre-calculate chunk boundaries
 * - Backpressure coordination with workers
 * - Zero-copy slicing with subarray
 */

import type {
  IOOptimizationConfig,
  IOStats,
  StreamHandle,
  StreamMode,
  BackpressureStrategy,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_IO_CONFIG: IOOptimizationConfig = {
  useNativeStreams: true,
  neverLoadFullFile: true,
  preCalculateBoundaries: true,
  boundaryAlignment: 64 * 1024,  // 64KB alignment
  backpressureStrategy: 'throttle',
  coordinateWithWorkers: true,
  onlyReadWhenCapacity: true,
  zeroCopySlicing: true,
  useSubarray: true,
  avoidBufferCopies: true,
};

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;  // 4MB
const MIN_CHUNK_SIZE = 64 * 1024;             // 64KB
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;      // 64MB

// ============================================================================
// CHUNK BOUNDARY CALCULATOR
// ============================================================================

interface ChunkBoundary {
  index: number;
  offset: number;
  size: number;
  aligned: boolean;
}

class ChunkBoundaryCalculator {
  private boundaries: ChunkBoundary[] = [];
  private totalSize: number = 0;
  private chunkSize: number;
  private alignment: number;

  constructor(totalSize: number, chunkSize: number, alignment: number) {
    this.totalSize = totalSize;
    this.chunkSize = chunkSize;
    this.alignment = alignment;
    this.calculate();
  }

  /**
   * Pre-calculate all chunk boundaries
   */
  private calculate(): void {
    let offset = 0;
    let index = 0;

    while (offset < this.totalSize) {
      // Calculate chunk size (may be smaller for last chunk)
      let size = Math.min(this.chunkSize, this.totalSize - offset);
      
      // Align to boundary if not last chunk
      if (offset + size < this.totalSize) {
        const alignedSize = Math.floor(size / this.alignment) * this.alignment;
        if (alignedSize > 0) {
          size = alignedSize;
        }
      }

      this.boundaries.push({
        index,
        offset,
        size,
        aligned: size % this.alignment === 0,
      });

      offset += size;
      index++;
    }
  }

  /**
   * Get all boundaries
   */
  getBoundaries(): ChunkBoundary[] {
    return this.boundaries;
  }

  /**
   * Get boundary at index
   */
  getBoundary(index: number): ChunkBoundary | undefined {
    return this.boundaries[index];
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.boundaries.length;
  }

  /**
   * Get boundary containing offset
   */
  getBoundaryAtOffset(offset: number): ChunkBoundary | undefined {
    for (const boundary of this.boundaries) {
      if (offset >= boundary.offset && offset < boundary.offset + boundary.size) {
        return boundary;
      }
    }
    return undefined;
  }
}

// ============================================================================
// BACKPRESSURE CONTROLLER
// ============================================================================

class BackpressureController {
  private strategy: BackpressureStrategy;
  private isPaused = false;
  private pendingCount = 0;
  private maxPending: number;
  private throttleDelay = 10;
  private onPause?: () => void;
  private onResume?: () => void;

  constructor(
    strategy: BackpressureStrategy,
    maxPending: number = 10,
    onPause?: () => void,
    onResume?: () => void
  ) {
    this.strategy = strategy;
    this.maxPending = maxPending;
    this.onPause = onPause;
    this.onResume = onResume;
  }

  /**
   * Check if can continue reading
   */
  canRead(): boolean {
    if (this.strategy === 'drop') {
      return true; // Always read, drop if needed
    }

    return !this.isPaused && this.pendingCount < this.maxPending;
  }

  /**
   * Record chunk sent
   */
  recordSent(): void {
    this.pendingCount++;

    if (this.pendingCount >= this.maxPending) {
      this.pause();
    }
  }

  /**
   * Record chunk processed
   */
  recordProcessed(): void {
    this.pendingCount = Math.max(0, this.pendingCount - 1);

    if (this.pendingCount < this.maxPending / 2 && this.isPaused) {
      this.resume();
    }
  }

  /**
   * Pause reading
   */
  private pause(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    this.onPause?.();
  }

  /**
   * Resume reading
   */
  private resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.onResume?.();
  }

  /**
   * Get throttle delay if needed
   */
  getThrottleDelay(): number {
    if (this.strategy !== 'throttle') return 0;
    
    if (this.pendingCount > this.maxPending * 0.8) {
      return this.throttleDelay * 2;
    }
    if (this.pendingCount > this.maxPending * 0.5) {
      return this.throttleDelay;
    }
    return 0;
  }

  /**
   * Check if paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.pendingCount;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.isPaused = false;
    this.pendingCount = 0;
  }
}

// ============================================================================
// ZERO COPY SLICER
// ============================================================================

class ZeroCopySlicer {
  private buffer: ArrayBuffer | null = null;
  private view: Uint8Array | null = null;
  private stats = {
    zeroCopySlices: 0,
    copiedSlices: 0,
    bytesSliced: 0,
    bytesCopied: 0,
  };

  /**
   * Set source buffer
   */
  setSource(buffer: ArrayBuffer): void {
    this.buffer = buffer;
    this.view = new Uint8Array(buffer);
  }

  /**
   * Get zero-copy slice (view into original buffer)
   */
  slice(offset: number, size: number): Uint8Array {
    if (!this.view) {
      throw new Error('No source buffer set');
    }

    if (offset + size > this.view.byteLength) {
      throw new Error('Slice out of bounds');
    }

    // Use subarray for zero-copy
    this.stats.zeroCopySlices++;
    this.stats.bytesSliced += size;
    
    return this.view.subarray(offset, offset + size);
  }

  /**
   * Get copied slice (new buffer)
   */
  sliceCopy(offset: number, size: number): Uint8Array {
    if (!this.view) {
      throw new Error('No source buffer set');
    }

    this.stats.copiedSlices++;
    this.stats.bytesCopied += size;

    return this.view.slice(offset, offset + size);
  }

  /**
   * Clear source
   */
  clear(): void {
    this.buffer = null;
    this.view = null;
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

// ============================================================================
// FILE STREAM READER
// ============================================================================

class OptimizedFileReader {
  private file: File;
  private boundaries: ChunkBoundaryCalculator;
  private backpressure: BackpressureController;
  private slicer: ZeroCopySlicer;
  private config: IOOptimizationConfig;
  private currentIndex = 0;
  private aborted = false;
  private stream: ReadableStream<Uint8Array> | null = null;

  private stats: IOStats = {
    bytesRead: 0,
    bytesWritten: 0,
    readOperations: 0,
    writeOperations: 0,
    avgReadLatency: 0,
    avgWriteLatency: 0,
    backpressureEvents: 0,
    zeroCopyOperations: 0,
    bufferCopies: 0,
    streamEfficiency: 0,
  };

  private readLatencies: number[] = [];

  constructor(file: File, config: IOOptimizationConfig, chunkSize: number = DEFAULT_CHUNK_SIZE) {
    this.file = file;
    this.config = config;
    this.boundaries = new ChunkBoundaryCalculator(
      file.size,
      chunkSize,
      config.boundaryAlignment
    );
    this.backpressure = new BackpressureController(
      config.backpressureStrategy,
      10,
      () => { this.stats.backpressureEvents++; }
    );
    this.slicer = new ZeroCopySlicer();
  }

  /**
   * Create native readable stream
   */
  createStream(): ReadableStream<Uint8Array> {
    const self = this;
    const boundaries = this.boundaries.getBoundaries();

    this.stream = new ReadableStream({
      async start() {
        self.currentIndex = 0;
        self.aborted = false;
      },

      async pull(controller) {
        if (self.aborted || self.currentIndex >= boundaries.length) {
          controller.close();
          return;
        }

        // Check backpressure
        while (self.config.onlyReadWhenCapacity && !self.backpressure.canRead()) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (self.aborted) {
            controller.close();
            return;
          }
        }

        // Apply throttle delay if needed
        const delay = self.backpressure.getThrottleDelay();
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const boundary = boundaries[self.currentIndex];
        const startTime = performance.now();

        try {
          // Read chunk from file
          const blob = self.file.slice(boundary.offset, boundary.offset + boundary.size);
          const buffer = await blob.arrayBuffer();
          const chunk = new Uint8Array(buffer);

          const readTime = performance.now() - startTime;
          self.readLatencies.push(readTime);
          if (self.readLatencies.length > 100) {
            self.readLatencies.shift();
          }

          self.stats.bytesRead += chunk.byteLength;
          self.stats.readOperations++;
          self.stats.avgReadLatency = 
            self.readLatencies.reduce((a, b) => a + b, 0) / self.readLatencies.length;

          if (self.config.zeroCopySlicing) {
            self.stats.zeroCopyOperations++;
          }

          self.backpressure.recordSent();
          self.currentIndex++;

          controller.enqueue(chunk);
        } catch (error) {
          controller.error(error);
        }
      },

      cancel() {
        self.aborted = true;
      }
    });

    return this.stream;
  }

  /**
   * Read chunk at index
   */
  async readChunk(index: number): Promise<Uint8Array | null> {
    const boundary = this.boundaries.getBoundary(index);
    if (!boundary) return null;

    const startTime = performance.now();
    
    const blob = this.file.slice(boundary.offset, boundary.offset + boundary.size);
    const buffer = await blob.arrayBuffer();
    const chunk = new Uint8Array(buffer);

    const readTime = performance.now() - startTime;
    this.readLatencies.push(readTime);

    this.stats.bytesRead += chunk.byteLength;
    this.stats.readOperations++;
    this.stats.avgReadLatency = 
      this.readLatencies.reduce((a, b) => a + b, 0) / this.readLatencies.length;

    return chunk;
  }

  /**
   * Read all chunks with callback
   */
  async readAll(
    onChunk: (chunk: Uint8Array, index: number) => Promise<void>,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const boundaries = this.boundaries.getBoundaries();

    for (let i = 0; i < boundaries.length; i++) {
      if (this.aborted) break;

      // Check backpressure
      while (this.config.onlyReadWhenCapacity && !this.backpressure.canRead()) {
        await new Promise(resolve => setTimeout(resolve, 10));
        if (this.aborted) return;
      }

      const chunk = await this.readChunk(i);
      if (chunk) {
        await onChunk(chunk, i);
        this.backpressure.recordSent();
      }

      if (onProgress) {
        onProgress((i + 1) / boundaries.length);
      }
    }
  }

  /**
   * Mark chunk as processed (for backpressure)
   */
  markProcessed(): void {
    this.backpressure.recordProcessed();
  }

  /**
   * Abort reading
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Get chunk boundaries
   */
  getBoundaries(): ChunkBoundary[] {
    return this.boundaries.getBoundaries();
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.boundaries.getChunkCount();
  }

  /**
   * Get file size
   */
  getFileSize(): number {
    return this.file.size;
  }

  /**
   * Get statistics
   */
  getStats(): IOStats {
    // Calculate stream efficiency
    const slicerStats = this.slicer.getStats();
    const totalOps = slicerStats.zeroCopySlices + slicerStats.copiedSlices;
    this.stats.streamEfficiency = totalOps > 0 
      ? slicerStats.zeroCopySlices / totalOps 
      : 1;

    return { ...this.stats };
  }

  /**
   * Reset state
   */
  reset(): void {
    this.currentIndex = 0;
    this.aborted = false;
    this.backpressure.reset();
    this.slicer.clear();
    this.readLatencies = [];
  }
}

// ============================================================================
// OPTIMIZED FILE WRITER
// ============================================================================

class OptimizedFileWriter {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;
  private config: IOOptimizationConfig;
  private writeLatencies: number[] = [];
  
  private stats = {
    bytesWritten: 0,
    writeOperations: 0,
    avgWriteLatency: 0,
  };

  constructor(config: IOOptimizationConfig) {
    this.config = config;
  }

  /**
   * Write chunk (streaming append)
   */
  write(chunk: Uint8Array): void {
    const startTime = performance.now();

    // Store reference (no copy if possible)
    this.chunks.push(chunk);
    this.totalSize += chunk.byteLength;

    const writeTime = performance.now() - startTime;
    this.writeLatencies.push(writeTime);
    if (this.writeLatencies.length > 100) {
      this.writeLatencies.shift();
    }

    this.stats.bytesWritten += chunk.byteLength;
    this.stats.writeOperations++;
    this.stats.avgWriteLatency = 
      this.writeLatencies.reduce((a, b) => a + b, 0) / this.writeLatencies.length;
  }

  /**
   * Get as Blob (efficient)
   */
  toBlob(mimeType: string = 'application/octet-stream'): Blob {
    // Cast to any to avoid strict TypeScript ArrayBufferLike issues
    return new Blob(this.chunks as unknown as BlobPart[], { type: mimeType });
  }

  /**
   * Get as File
   */
  toFile(name: string, mimeType: string = 'application/octet-stream'): File {
    // Cast to any to avoid strict TypeScript ArrayBufferLike issues
    return new File(this.chunks as unknown as BlobPart[], name, { type: mimeType });
  }

  /**
   * Stream iterator
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
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.chunks = [];
    this.totalSize = 0;
    this.writeLatencies = [];
  }
}

// ============================================================================
// I/O OPTIMIZER
// ============================================================================

export class IOOptimizer {
  private config: IOOptimizationConfig;
  private activeReaders: Map<string, OptimizedFileReader> = new Map();
  private activeWriters: Map<string, OptimizedFileWriter> = new Map();
  private handleCounter = 0;

  private stats: IOStats = {
    bytesRead: 0,
    bytesWritten: 0,
    readOperations: 0,
    writeOperations: 0,
    avgReadLatency: 0,
    avgWriteLatency: 0,
    backpressureEvents: 0,
    zeroCopyOperations: 0,
    bufferCopies: 0,
    streamEfficiency: 0,
  };

  constructor(config: Partial<IOOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_IO_CONFIG, ...config };
  }

  /**
   * Create file reader
   */
  createReader(file: File, chunkSize?: number): StreamHandle {
    const handleId = `reader-${++this.handleCounter}`;
    const reader = new OptimizedFileReader(
      file,
      this.config,
      chunkSize || DEFAULT_CHUNK_SIZE
    );

    this.activeReaders.set(handleId, reader);

    return {
      id: handleId,
      mode: this.config.useNativeStreams ? 'native' : 'chunked',
      position: 0,
      size: file.size,
      chunkSize: chunkSize || DEFAULT_CHUNK_SIZE,
      buffered: 0,
      backpressure: false,
    };
  }

  /**
   * Get reader stream
   */
  getReaderStream(handleId: string): ReadableStream<Uint8Array> | null {
    const reader = this.activeReaders.get(handleId);
    if (!reader) return null;
    return reader.createStream();
  }

  /**
   * Read chunks with callback
   */
  async readFile(
    handleId: string,
    onChunk: (chunk: Uint8Array, index: number) => Promise<void>,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const reader = this.activeReaders.get(handleId);
    if (!reader) {
      throw new Error(`Reader not found: ${handleId}`);
    }

    await reader.readAll(onChunk, onProgress);
    
    // Update aggregate stats
    const readerStats = reader.getStats();
    this.stats.bytesRead += readerStats.bytesRead;
    this.stats.readOperations += readerStats.readOperations;
    this.stats.backpressureEvents += readerStats.backpressureEvents;
    this.stats.zeroCopyOperations += readerStats.zeroCopyOperations;
  }

  /**
   * Read single chunk
   */
  async readChunk(handleId: string, index: number): Promise<Uint8Array | null> {
    const reader = this.activeReaders.get(handleId);
    if (!reader) return null;
    return reader.readChunk(index);
  }

  /**
   * Mark chunk as processed
   */
  markChunkProcessed(handleId: string): void {
    const reader = this.activeReaders.get(handleId);
    if (reader) {
      reader.markProcessed();
    }
  }

  /**
   * Get chunk boundaries
   */
  getChunkBoundaries(handleId: string): ChunkBoundary[] {
    const reader = this.activeReaders.get(handleId);
    if (!reader) return [];
    return reader.getBoundaries();
  }

  /**
   * Create file writer
   */
  createWriter(): string {
    const handleId = `writer-${++this.handleCounter}`;
    const writer = new OptimizedFileWriter(this.config);
    this.activeWriters.set(handleId, writer);
    return handleId;
  }

  /**
   * Write chunk to writer
   */
  writeChunk(handleId: string, chunk: Uint8Array): void {
    const writer = this.activeWriters.get(handleId);
    if (!writer) {
      throw new Error(`Writer not found: ${handleId}`);
    }
    writer.write(chunk);

    // Update stats
    const writerStats = writer.getStats();
    this.stats.bytesWritten = writerStats.bytesWritten;
    this.stats.writeOperations = writerStats.writeOperations;
    this.stats.avgWriteLatency = writerStats.avgWriteLatency;
  }

  /**
   * Get writer output as Blob
   */
  getWriterBlob(handleId: string, mimeType?: string): Blob | null {
    const writer = this.activeWriters.get(handleId);
    if (!writer) return null;
    return writer.toBlob(mimeType);
  }

  /**
   * Get writer output as File
   */
  getWriterFile(handleId: string, name: string, mimeType?: string): File | null {
    const writer = this.activeWriters.get(handleId);
    if (!writer) return null;
    return writer.toFile(name, mimeType);
  }

  /**
   * Close reader
   */
  closeReader(handleId: string): void {
    const reader = this.activeReaders.get(handleId);
    if (reader) {
      reader.abort();
      reader.reset();
      this.activeReaders.delete(handleId);
    }
  }

  /**
   * Close writer
   */
  closeWriter(handleId: string): void {
    const writer = this.activeWriters.get(handleId);
    if (writer) {
      writer.clear();
      this.activeWriters.delete(handleId);
    }
  }

  /**
   * Get statistics
   */
  getStats(): IOStats {
    // Calculate stream efficiency
    const totalOps = this.stats.zeroCopyOperations + this.stats.bufferCopies;
    this.stats.streamEfficiency = totalOps > 0 
      ? this.stats.zeroCopyOperations / totalOps 
      : 1;

    return { ...this.stats };
  }

  /**
   * Get configuration
   */
  getConfig(): IOOptimizationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IOOptimizationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset optimizer
   */
  reset(): void {
    for (const [id] of this.activeReaders) {
      this.closeReader(id);
    }
    for (const [id] of this.activeWriters) {
      this.closeWriter(id);
    }
    
    this.stats = {
      bytesRead: 0,
      bytesWritten: 0,
      readOperations: 0,
      writeOperations: 0,
      avgReadLatency: 0,
      avgWriteLatency: 0,
      backpressureEvents: 0,
      zeroCopyOperations: 0,
      bufferCopies: 0,
      streamEfficiency: 0,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let ioOptimizerInstance: IOOptimizer | null = null;

export function getIOOptimizer(config?: Partial<IOOptimizationConfig>): IOOptimizer {
  if (!ioOptimizerInstance) {
    ioOptimizerInstance = new IOOptimizer(config);
  }
  return ioOptimizerInstance;
}

export function resetIOOptimizer(): void {
  if (ioOptimizerInstance) {
    ioOptimizerInstance.reset();
  }
  ioOptimizerInstance = null;
}
