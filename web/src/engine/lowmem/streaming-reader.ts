/**
 * SPK Hyper-Low-Memory Mode - Streaming File Reader
 * Creator: OJ Treasure Onazi
 * 
 * Section 4: Streaming File Reader for Low Memory
 * - Read → Send → Free → Repeat cycle
 * - Never holds entire file in memory
 * - Supports File, Blob, and ReadableStream inputs
 */

import {
  KB, MB,
  type StreamingReaderConfig,
  type StreamChunk,
  DEFAULT_STREAMING_READER_CONFIG,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';
import { getMemoryBudgetController } from './memory-budget';
import { getBufferPool } from './buffer-pool';

// ============================================================================
// STREAMING READER TYPES
// ============================================================================

export interface ReaderProgress {
  bytesRead: number;
  totalBytes: number;
  chunksEmitted: number;
  currentChunkSize: number;
  elapsedMs: number;
  throughputBytesPerSec: number;
  memoryPressure: string;
}

export interface ReaderOptions {
  onProgress?: (progress: ReaderProgress) => void;
  onChunk?: (chunk: StreamChunk) => Promise<void> | void;
  signal?: AbortSignal;
}

// ============================================================================
// STREAMING FILE READER
// ============================================================================

export class LowMemoryStreamingReader {
  private config: StreamingReaderConfig;
  private memoryController = getMemoryBudgetController();
  private bufferPool = getBufferPool();
  private eventHandlers: LowMemEventHandler[] = [];
  
  // State
  private reading = false;
  private aborted = false;
  private bytesRead = 0;
  private chunksEmitted = 0;
  private startTime = 0;

  constructor(config?: Partial<StreamingReaderConfig>) {
    this.config = { ...DEFAULT_STREAMING_READER_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Stream read a File object
   */
  async *streamFile(
    file: File,
    options?: ReaderOptions
  ): AsyncGenerator<StreamChunk> {
    this.reset();
    this.reading = true;
    this.startTime = performance.now();
    
    const totalBytes = file.size;
    let offset = 0;
    let chunkIndex = 0;
    
    this.emit({ type: 'stream-start', totalBytes });
    
    try {
      while (offset < totalBytes && !this.aborted) {
        // Check abort signal
        if (options?.signal?.aborted) {
          this.aborted = true;
          break;
        }
        
        // Get adaptive chunk size based on pressure
        const chunkSize = this.getAdaptiveChunkSize();
        const end = Math.min(offset + chunkSize, totalBytes);
        const sliceSize = end - offset;
        
        // Allocate memory for this chunk
        const allocResult = this.memoryController.allocate({
          id: `stream_chunk_${chunkIndex}`,
          bytes: sliceSize,
          purpose: 'chunk',
          priority: 'normal',
        });
        
        if (!allocResult.success) {
          // Wait and retry with smaller chunk
          await this.waitForMemory();
          continue;
        }
        
        // Read slice
        const slice = file.slice(offset, end);
        const data = await this.readSlice(slice);
        
        const chunk: StreamChunk = {
          data,
          offset,
          size: data.byteLength,
          isLast: end >= totalBytes,
          sequence: chunkIndex,
        };
        
        this.bytesRead += data.byteLength;
        this.chunksEmitted++;
        
        // Report progress
        if (options?.onProgress) {
          options.onProgress(this.getProgress(totalBytes));
        }
        
        // Emit chunk event
        this.emit({ type: 'chunk-read', size: data.byteLength, offset });
        
        // Call chunk handler if provided
        if (options?.onChunk) {
          await options.onChunk(chunk);
        }
        
        // Yield chunk
        yield chunk;
        
        // Release memory after chunk is processed
        this.memoryController.release(`stream_chunk_${chunkIndex}`);
        
        offset = end;
        chunkIndex++;
        
        // Allow GC between chunks
        if (this.config.yieldInterval && chunkIndex % this.config.yieldInterval === 0) {
          await this.yieldToMainThread();
        }
      }
      
      this.emit({ type: 'stream-end', totalBytesRead: this.bytesRead });
    } finally {
      this.reading = false;
    }
  }

  /**
   * Stream read a Blob
   */
  async *streamBlob(
    blob: Blob,
    options?: ReaderOptions
  ): AsyncGenerator<StreamChunk> {
    // Blob streaming is same as File
    yield* this.streamFile(blob as File, options);
  }

  /**
   * Stream read from ReadableStream
   */
  async *streamReadable(
    stream: ReadableStream<Uint8Array>,
    options?: ReaderOptions
  ): AsyncGenerator<StreamChunk> {
    this.reset();
    this.reading = true;
    this.startTime = performance.now();
    
    const reader = stream.getReader();
    let chunkIndex = 0;
    let totalBytesEstimate = 0;
    
    this.emit({ type: 'stream-start', totalBytes: -1 });
    
    try {
      while (!this.aborted) {
        // Check abort signal
        if (options?.signal?.aborted) {
          this.aborted = true;
          await reader.cancel();
          break;
        }
        
        const { value, done } = await reader.read();
        
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        
        // Allocate memory
        const allocResult = this.memoryController.allocate({
          id: `stream_readable_${chunkIndex}`,
          bytes: value.byteLength,
          purpose: 'chunk',
          priority: 'normal',
        });
        
        if (!allocResult.success) {
          await this.waitForMemory();
          // Re-queue this chunk somehow? For ReadableStream we can't easily re-read
          // So we'll proceed anyway but with warning
          console.warn('[StreamingReader] Memory pressure during stream read');
        }
        
        const chunk: StreamChunk = {
          data: value,
          offset: this.bytesRead,
          size: value.byteLength,
          isLast: false,
          sequence: chunkIndex,
        };
        
        this.bytesRead += value.byteLength;
        this.chunksEmitted++;
        totalBytesEstimate = this.bytesRead;
        
        // Report progress
        if (options?.onProgress) {
          options.onProgress(this.getProgress(totalBytesEstimate));
        }
        
        // Emit event
        this.emit({ type: 'chunk-read', size: value.byteLength, offset: chunk.offset });
        
        // Call handler
        if (options?.onChunk) {
          await options.onChunk(chunk);
        }
        
        yield chunk;
        
        // Release memory
        this.memoryController.release(`stream_readable_${chunkIndex}`);
        
        chunkIndex++;
        
        // Yield periodically
        if (this.config.yieldInterval && chunkIndex % this.config.yieldInterval === 0) {
          await this.yieldToMainThread();
        }
      }
      
      this.emit({ type: 'stream-end', totalBytesRead: this.bytesRead });
    } finally {
      reader.releaseLock();
      this.reading = false;
    }
  }

  /**
   * Read file in chunks and process
   */
  async processFile(
    file: File,
    processor: (chunk: Uint8Array, offset: number, isLast: boolean) => Promise<void>,
    options?: Omit<ReaderOptions, 'onChunk'>
  ): Promise<ReaderProgress> {
    for await (const chunk of this.streamFile(file, options)) {
      await processor(chunk.data, chunk.offset, chunk.isLast);
    }
    return this.getProgress(file.size);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Read a blob slice into Uint8Array
   */
  private async readSlice(slice: Blob): Promise<Uint8Array> {
    // Try using arrayBuffer() first (more efficient)
    try {
      const buffer = await slice.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      // Fallback to FileReader
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(new Uint8Array(reader.result));
          } else {
            reject(new Error('Unexpected result type'));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(slice);
      });
    }
  }

  /**
   * Get adaptive chunk size based on memory pressure
   */
  private getAdaptiveChunkSize(): number {
    const pressure = this.memoryController.getPressureLevel();
    
    switch (pressure) {
      case 'emergency':
        return Math.min(this.config.chunkSize, 64 * KB);
      case 'critical':
        return Math.min(this.config.chunkSize, 128 * KB);
      case 'high':
        return Math.min(this.config.chunkSize, 256 * KB);
      case 'medium':
        return Math.min(this.config.chunkSize, 512 * KB);
      default:
        return this.config.chunkSize;
    }
  }

  /**
   * Wait for memory to become available
   */
  private async waitForMemory(maxWaitMs: number = 1000): Promise<void> {
    const startWait = performance.now();
    
    while (performance.now() - startWait < maxWaitMs) {
      // Try to free memory
      this.memoryController.forceReleaseByPurpose('temp');
      
      // Check if enough memory now
      if (this.memoryController.getAvailable() > this.config.chunkSize) {
        return;
      }
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    this.emit({ type: 'memory-wait-timeout' });
  }

  /**
   * Yield to main thread for UI responsiveness
   */
  private yieldToMainThread(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Get current progress
   */
  private getProgress(totalBytes: number): ReaderProgress {
    const elapsed = performance.now() - this.startTime;
    const throughput = elapsed > 0 ? (this.bytesRead / elapsed) * 1000 : 0;
    
    return {
      bytesRead: this.bytesRead,
      totalBytes,
      chunksEmitted: this.chunksEmitted,
      currentChunkSize: this.getAdaptiveChunkSize(),
      elapsedMs: elapsed,
      throughputBytesPerSec: throughput,
      memoryPressure: this.memoryController.getPressureLevel(),
    };
  }

  /**
   * Reset reader state
   */
  private reset(): void {
    this.reading = false;
    this.aborted = false;
    this.bytesRead = 0;
    this.chunksEmitted = 0;
    this.startTime = 0;
  }

  // ---------------------------------------------------------------------------
  // CONTROL
  // ---------------------------------------------------------------------------

  /**
   * Abort current read operation
   */
  abort(): void {
    this.aborted = true;
    this.emit({ type: 'stream-abort' });
  }

  /**
   * Check if currently reading
   */
  isReading(): boolean {
    return this.reading;
  }

  /**
   * Check if aborted
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Get bytes read so far
   */
  getBytesRead(): number {
    return this.bytesRead;
  }

  /**
   * Get chunks emitted so far
   */
  getChunksEmitted(): number {
    return this.chunksEmitted;
  }

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  /**
   * Update chunk size
   */
  setChunkSize(size: number): void {
    this.config.chunkSize = Math.max(64 * KB, Math.min(size, this.config.maxChunkSize));
  }

  /**
   * Get current config
   */
  getConfig(): StreamingReaderConfig {
    return { ...this.config };
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  on(handler: LowMemEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: LowMemEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[StreamingReader] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create file reader with abort support
 */
export function createAbortableFileReader(
  file: File,
  config?: Partial<StreamingReaderConfig>
): {
  reader: LowMemoryStreamingReader;
  abort: () => void;
  stream: () => AsyncGenerator<StreamChunk>;
} {
  const reader = new LowMemoryStreamingReader(config);
  const abortController = new AbortController();
  
  return {
    reader,
    abort: () => {
      abortController.abort();
      reader.abort();
    },
    stream: () => reader.streamFile(file, { signal: abortController.signal }),
  };
}

/**
 * Read file to completion with progress callback
 */
export async function readFileWithProgress(
  file: File,
  onProgress?: (progress: ReaderProgress) => void,
  config?: Partial<StreamingReaderConfig>
): Promise<Uint8Array[]> {
  const reader = new LowMemoryStreamingReader(config);
  const chunks: Uint8Array[] = [];
  
  for await (const chunk of reader.streamFile(file, { onProgress })) {
    // Clone data since we're keeping it
    chunks.push(new Uint8Array(chunk.data));
  }
  
  return chunks;
}

/**
 * Estimate optimal chunk size for file
 */
export function estimateOptimalChunkSize(
  fileSize: number,
  availableMemory: number
): number {
  // Target: process in reasonable number of chunks
  const targetChunks = Math.max(10, Math.min(100, fileSize / (1 * MB)));
  const idealChunkSize = Math.ceil(fileSize / targetChunks);
  
  // Constrain by available memory (use 1/4 of available)
  const maxByMemory = Math.floor(availableMemory / 4);
  
  // Constrain to reasonable range
  return Math.max(64 * KB, Math.min(idealChunkSize, maxByMemory, 4 * MB));
}

// ============================================================================
// SINGLETON
// ============================================================================

let readerInstance: LowMemoryStreamingReader | null = null;

export function getStreamingReader(
  config?: Partial<StreamingReaderConfig>
): LowMemoryStreamingReader {
  if (!readerInstance) {
    readerInstance = new LowMemoryStreamingReader(config);
  }
  return readerInstance;
}

export function resetStreamingReader(): void {
  readerInstance?.abort();
  readerInstance = null;
}
