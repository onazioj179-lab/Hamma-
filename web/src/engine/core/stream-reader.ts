/**
 * SPK V30-V31 - StreamReader
 * 
 * Reads files as streams WITHOUT loading entirely into memory.
 * Uses Blob.stream() for true streaming with backpressure support.
 * 
 * Features:
 * - Memory-safe for files up to 1TB+
 * - Configurable chunk sizes
 * - Pause/resume support
 * - Progress callbacks
 * - Abort support
 */

// ============================================================================
// TYPES
// ============================================================================

export interface StreamChunk {
  index: number;
  data: Uint8Array;
  offset: number;
  size: number;
  isLast: boolean;
}

export interface StreamReaderConfig {
  chunkSize: number;
  onChunk?: (chunk: StreamChunk) => void | Promise<void>;
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  onComplete?: (totalChunks: number) => void;
  onError?: (error: Error) => void;
}

export interface StreamReaderStats {
  bytesRead: number;
  chunksRead: number;
  totalBytes: number;
  totalChunks: number;
  isReading: boolean;
  isPaused: boolean;
}

// ============================================================================
// STREAM READER CLASS
// ============================================================================

export class StreamReader {
  private config: StreamReaderConfig;
  private file: File | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private abortController: AbortController | null = null;
  
  // State
  private bytesRead = 0;
  private chunksRead = 0;
  private totalBytes = 0;
  private totalChunks = 0;
  private isReading = false;
  private isPaused = false;
  
  // Resume promise
  private resumePromise: Promise<void> | null = null;
  private resumeResolve: (() => void) | null = null;
  
  // Note: pendingBuffer and pendingOffset reserved for future chunking optimization
  
  constructor(config: StreamReaderConfig) {
    this.config = {
      chunkSize: config.chunkSize || 4 * 1024 * 1024, // 4MB default
      onChunk: config.onChunk,
      onProgress: config.onProgress,
      onComplete: config.onComplete,
      onError: config.onError,
    };
  }
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  /**
   * Start reading a file
   * Streams chunks without loading entire file into memory
   */
  async read(file: File): Promise<void> {
    if (this.isReading) {
      throw new Error('StreamReader is already reading');
    }
    
    this.file = file;
    this.totalBytes = file.size;
    this.totalChunks = Math.ceil(file.size / this.config.chunkSize);
    this.bytesRead = 0;
    this.chunksRead = 0;
    this.isReading = true;
    this.isPaused = false;
    
    this.abortController = new AbortController();
    
    try {
      await this.streamFile();
      
      if (!this.abortController.signal.aborted) {
        this.config.onComplete?.(this.chunksRead);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        this.config.onError?.(error);
        throw error;
      }
    } finally {
      this.isReading = false;
      this.cleanup();
    }
  }
  
  /**
   * Pause reading
   */
  pause(): void {
    if (!this.isReading || this.isPaused) return;
    
    this.isPaused = true;
    this.resumePromise = new Promise(resolve => {
      this.resumeResolve = resolve;
    });
  }
  
  /**
   * Resume reading
   */
  resume(): void {
    if (!this.isPaused) return;
    
    this.isPaused = false;
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumeResolve = null;
      this.resumePromise = null;
    }
  }
  
  /**
   * Abort reading
   */
  abort(): void {
    this.abortController?.abort();
    this.resume(); // Unblock any waiting
    this.cleanup();
  }
  
  /**
   * Get current statistics
   */
  getStats(): StreamReaderStats {
    return {
      bytesRead: this.bytesRead,
      chunksRead: this.chunksRead,
      totalBytes: this.totalBytes,
      totalChunks: this.totalChunks,
      isReading: this.isReading,
      isPaused: this.isPaused,
    };
  }
  
  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================
  
  /**
   * Stream file using Blob.stream()
   */
  private async streamFile(): Promise<void> {
    if (!this.file) return;
    
    const stream = this.file.stream();
    this.reader = stream.getReader();
    
    // Buffer for accumulating chunks of the right size
    let buffer = new Uint8Array(this.config.chunkSize);
    let bufferOffset = 0;
    let chunkIndex = 0;
    
    try {
      while (true) {
        // Check for abort
        if (this.abortController?.signal.aborted) {
          break;
        }
        
        // Handle pause
        if (this.isPaused && this.resumePromise) {
          await this.resumePromise;
        }
        
        // Read next piece
        const { done, value } = await this.reader.read();
        
        if (done) {
          // Emit final chunk if buffer has data
          if (bufferOffset > 0) {
            const chunk: StreamChunk = {
              index: chunkIndex,
              data: buffer.slice(0, bufferOffset),
              offset: this.bytesRead - bufferOffset,
              size: bufferOffset,
              isLast: true,
            };
            
            await this.emitChunk(chunk);
          }
          break;
        }
        
        // Process incoming data
        let valueOffset = 0;
        
        while (valueOffset < value.length) {
          const spaceInBuffer = this.config.chunkSize - bufferOffset;
          const bytesToCopy = Math.min(spaceInBuffer, value.length - valueOffset);
          
          buffer.set(value.subarray(valueOffset, valueOffset + bytesToCopy), bufferOffset);
          bufferOffset += bytesToCopy;
          valueOffset += bytesToCopy;
          this.bytesRead += bytesToCopy;
          
          // Emit chunk when buffer is full
          if (bufferOffset >= this.config.chunkSize) {
            const isLast = this.bytesRead >= this.totalBytes;
            
            const chunk: StreamChunk = {
              index: chunkIndex,
              data: buffer.slice(0, bufferOffset),
              offset: this.bytesRead - bufferOffset,
              size: bufferOffset,
              isLast,
            };
            
            await this.emitChunk(chunk);
            
            // Reset buffer
            buffer = new Uint8Array(this.config.chunkSize);
            bufferOffset = 0;
            chunkIndex++;
          }
          
          // Report progress
          this.config.onProgress?.(this.bytesRead, this.totalBytes);
        }
      }
    } finally {
      this.reader.releaseLock();
    }
  }
  
  /**
   * Emit a chunk to callback
   */
  private async emitChunk(chunk: StreamChunk): Promise<void> {
    this.chunksRead++;
    
    if (this.config.onChunk) {
      await this.config.onChunk(chunk);
    }
  }
  
  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.reader) {
      try {
        this.reader.releaseLock();
      } catch (e) {
        // Already released
      }
      this.reader = null;
    }
    this.abortController = null;
  }
}

// ============================================================================
// HELPER: READ FILE AS CHUNKS (SIMPLE API)
// ============================================================================

/**
 * Simple async generator for reading file chunks
 * 
 * Usage:
 * for await (const chunk of readFileChunks(file, 4MB)) {
 *   processChunk(chunk);
 * }
 */
export async function* readFileChunks(
  file: File, 
  chunkSize: number = 4 * 1024 * 1024
): AsyncGenerator<StreamChunk, void, unknown> {
  const totalChunks = Math.ceil(file.size / chunkSize);
  let bytesRead = 0;
  let chunkIndex = 0;
  
  const stream = file.stream();
  const reader = stream.getReader();
  
  let buffer = new Uint8Array(chunkSize);
  let bufferOffset = 0;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Yield final chunk
        if (bufferOffset > 0) {
          yield {
            index: chunkIndex,
            data: buffer.slice(0, bufferOffset),
            offset: bytesRead - bufferOffset,
            size: bufferOffset,
            isLast: true,
          };
        }
        break;
      }
      
      let valueOffset = 0;
      
      while (valueOffset < value.length) {
        const spaceInBuffer = chunkSize - bufferOffset;
        const bytesToCopy = Math.min(spaceInBuffer, value.length - valueOffset);
        
        buffer.set(value.subarray(valueOffset, valueOffset + bytesToCopy), bufferOffset);
        bufferOffset += bytesToCopy;
        valueOffset += bytesToCopy;
        bytesRead += bytesToCopy;
        
        if (bufferOffset >= chunkSize) {
          const isLast = chunkIndex === totalChunks - 1;
          
          yield {
            index: chunkIndex,
            data: buffer.slice(0, bufferOffset),
            offset: bytesRead - bufferOffset,
            size: bufferOffset,
            isLast,
          };
          
          buffer = new Uint8Array(chunkSize);
          bufferOffset = 0;
          chunkIndex++;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============================================================================
// HELPER: SLICE-BASED READER (FALLBACK)
// ============================================================================

/**
 * Read file using slice-based approach
 * More memory overhead but works in all browsers
 */
export async function* readFileSlices(
  file: File,
  chunkSize: number = 4 * 1024 * 1024
): AsyncGenerator<StreamChunk, void, unknown> {
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  for (let i = 0; i < totalChunks; i++) {
    const offset = i * chunkSize;
    const end = Math.min(offset + chunkSize, file.size);
    const size = end - offset;
    const isLast = i === totalChunks - 1;
    
    const blob = file.slice(offset, end);
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    yield {
      index: i,
      data,
      offset,
      size,
      isLast,
    };
  }
}
