/**
 * SPK V25 - Streaming File Reader
 * Production-grade chunked file reader for GB-TB scale files
 */

import { DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE } from '../wasm/types';

/**
 * Chunk data with metadata
 */
export interface FileChunk {
  index: number;
  data: Uint8Array;
  offset: number;
  size: number;
  isLast: boolean;
}

/**
 * Stream reading options
 */
export interface StreamOptions {
  chunkSize: number;
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

/**
 * Validate chunk size
 */
export function validateChunkSize(size: number): number {
  if (size < MIN_CHUNK_SIZE) return MIN_CHUNK_SIZE;
  if (size > MAX_CHUNK_SIZE) return MAX_CHUNK_SIZE;
  // Round to nearest power of 2 for optimal memory alignment
  return Math.pow(2, Math.round(Math.log2(size)));
}

/**
 * High-performance streaming file reader using Blob.stream()
 * Supports files of any size without memory spikes
 */
export class StreamingFileReader {
  private file: File;
  private chunkSize: number;
  private offset: number = 0;
  private chunkIndex: number = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  private aborted: boolean = false;

  constructor(file: File, chunkSize: number = DEFAULT_CHUNK_SIZE) {
    this.file = file;
    this.chunkSize = validateChunkSize(chunkSize);
  }

  /**
   * Get file info
   */
  get fileInfo(): { name: string; size: number; type: string } {
    return {
      name: this.file.name,
      size: this.file.size,
      type: this.file.type || 'application/octet-stream',
    };
  }

  /**
   * Calculate total chunks
   */
  get totalChunks(): number {
    return Math.ceil(this.file.size / this.chunkSize);
  }

  /**
   * Get current progress
   */
  get progress(): number {
    return this.file.size > 0 ? this.offset / this.file.size : 0;
  }

  /**
   * Abort reading
   */
  abort(): void {
    this.aborted = true;
    if (this.reader) {
      this.reader.cancel('Aborted by user');
      this.reader = null;
    }
  }

  /**
   * Reset reader to beginning
   */
  reset(): void {
    this.offset = 0;
    this.chunkIndex = 0;
    this.buffer = new Uint8Array(0);
    this.aborted = false;
    if (this.reader) {
      this.reader.cancel('Reset');
      this.reader = null;
    }
  }

  /**
   * Read next chunk using Blob.stream()
   * Returns null when done or aborted
   */
  async readNextChunk(): Promise<FileChunk | null> {
    if (this.aborted || this.offset >= this.file.size) {
      return null;
    }

    try {
      // Initialize reader if needed
      if (!this.reader) {
        const stream = this.file.stream();
        this.reader = stream.getReader();
      }

      // Fill buffer until we have enough data for a chunk
      while (this.buffer.length < this.chunkSize && !this.aborted) {
        const { done, value } = await this.reader.read();
        
        if (done) break;
        
        if (value) {
          // Append to buffer efficiently
          const newBuffer = new Uint8Array(this.buffer.length + value.length);
          newBuffer.set(this.buffer);
          newBuffer.set(value, this.buffer.length);
          this.buffer = newBuffer;
        }
      }

      if (this.aborted) {
        return null;
      }

      // Extract chunk from buffer
      const chunkData = this.buffer.slice(0, this.chunkSize);
      this.buffer = this.buffer.slice(this.chunkSize);

      if (chunkData.length === 0) {
        return null;
      }

      const chunk: FileChunk = {
        index: this.chunkIndex++,
        data: chunkData,
        offset: this.offset,
        size: chunkData.length,
        isLast: this.offset + chunkData.length >= this.file.size,
      };

      this.offset += chunkData.length;

      return chunk;
    } catch (error) {
      if (this.aborted) return null;
      throw error;
    }
  }

  /**
   * Async generator for streaming chunks
   * Usage: for await (const chunk of reader.stream()) { ... }
   */
  async *stream(options?: { signal?: AbortSignal }): AsyncGenerator<FileChunk> {
    const signal = options?.signal;
    
    // Reset for new stream
    this.reset();
    
    // Abort listener
    if (signal) {
      signal.addEventListener('abort', () => this.abort(), { once: true });
    }

    while (!this.aborted && !signal?.aborted) {
      const chunk = await this.readNextChunk();
      
      if (chunk === null) break;
      
      yield chunk;
    }

    // Cleanup
    if (this.reader) {
      await this.reader.cancel('Stream complete');
      this.reader = null;
    }
  }

  /**
   * Process file with callback (alternative to async generator)
   */
  async processChunks(
    callback: (chunk: FileChunk) => Promise<void>,
    options?: StreamOptions
  ): Promise<{ totalBytes: number; totalChunks: number }> {
    if (options?.chunkSize) {
      this.chunkSize = validateChunkSize(options.chunkSize);
    }

    this.reset();

    let totalBytes = 0;
    let totalChunks = 0;

    for await (const chunk of this.stream({ signal: options?.signal })) {
      await callback(chunk);
      
      totalBytes += chunk.size;
      totalChunks++;
      
      if (options?.onProgress) {
        options.onProgress(totalBytes, this.file.size);
      }
    }

    return { totalBytes, totalChunks };
  }
}

/**
 * Create a readable stream from chunks for download
 */
export function createChunkedDownloadStream(
  chunks: Uint8Array[],
  onProgress?: (bytesWritten: number, totalBytes: number) => void
): ReadableStream<Uint8Array> {
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let bytesWritten = 0;
  let chunkIndex = 0;

  return new ReadableStream({
    pull(controller) {
      if (chunkIndex >= chunks.length) {
        controller.close();
        return;
      }

      const chunk = chunks[chunkIndex++];
      controller.enqueue(chunk);
      
      bytesWritten += chunk.length;
      
      if (onProgress) {
        onProgress(bytesWritten, totalSize);
      }
    },
  });
}

/**
 * Calculate optimal chunk size based on file size and memory constraints
 */
export function calculateOptimalChunkSize(
  fileSize: number,
  availableMemory: number = 256 * 1024 * 1024 // 256MB default
): number {
  // For small files, use smaller chunks
  if (fileSize < 10 * 1024 * 1024) { // < 10MB
    return Math.max(MIN_CHUNK_SIZE, Math.min(fileSize, 1024 * 1024)); // 1MB max
  }
  
  // For medium files
  if (fileSize < 1024 * 1024 * 1024) { // < 1GB
    return 4 * 1024 * 1024; // 4MB chunks
  }
  
  // For large files, use larger chunks for efficiency
  // But ensure we don't exceed 1/8 of available memory (for buffering)
  const maxChunk = Math.floor(availableMemory / 8);
  return Math.min(maxChunk, MAX_CHUNK_SIZE);
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format speed to human-readable string
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Format time duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export { DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE };
