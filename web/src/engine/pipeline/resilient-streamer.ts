/**
 * SPK Fail-Safe Pipeline - Resilient File Streamer
 * 
 * TB-scale file streaming with automatic recovery:
 * - Reads files in small increments (never loads entire file)
 * - Automatically resumes on read errors
 * - Supports any file type and any OS/browser/storage
 * - Checkpoint-based recovery
 * - Memory-efficient streaming
 * 
 * @module pipeline/resilient-streamer
 * @version 1.0.0
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ResilientStreamerConfig {
  /** Minimum chunk size (bytes) */
  minChunkSize: number;
  /** Maximum chunk size (bytes) */
  maxChunkSize: number;
  /** Default chunk size (bytes) */
  defaultChunkSize: number;
  /** Maximum retries per read operation */
  maxReadRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
  /** Enable checkpointing */
  enableCheckpoints: boolean;
  /** Checkpoint frequency (chunks) */
  checkpointFrequency: number;
  /** Read timeout (ms) */
  readTimeout: number;
  /** Buffer ahead chunks */
  bufferAhead: number;
}

export interface StreamChunk {
  index: number;
  data: Uint8Array;
  offset: number;
  size: number;
  isLast: boolean;
  retryCount: number;
  readTime: number;
}

export interface StreamCheckpoint {
  fileId: string;
  fileName: string;
  fileSize: number;
  chunkIndex: number;
  bytesRead: number;
  timestamp: number;
  hash?: string;
}

export interface StreamProgress {
  bytesRead: number;
  totalBytes: number;
  chunksRead: number;
  totalChunks: number;
  percentage: number;
  speed: number;
  eta: number;
  retries: number;
  isResuming: boolean;
}

export interface StreamError {
  type: 'read' | 'timeout' | 'abort' | 'permission' | 'not-found' | 'unknown';
  message: string;
  offset: number;
  retryable: boolean;
}

export type StreamEventHandler = (event: StreamEvent) => void;

export interface StreamEvent {
  type: 
    | 'stream-started'
    | 'chunk-read'
    | 'chunk-retry'
    | 'chunk-failed'
    | 'checkpoint-saved'
    | 'stream-resumed'
    | 'stream-paused'
    | 'stream-complete'
    | 'stream-error'
    | 'progress';
  timestamp: number;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

const DEFAULT_CONFIG: ResilientStreamerConfig = {
  minChunkSize: 64 * KB,        // 64KB minimum
  maxChunkSize: 64 * MB,        // 64MB maximum
  defaultChunkSize: 4 * MB,     // 4MB default
  maxReadRetries: 5,            // 5 retries per chunk
  retryDelay: 500,              // 500ms between retries
  enableCheckpoints: true,      // Enable checkpointing
  checkpointFrequency: 50,      // Checkpoint every 50 chunks
  readTimeout: 30000,           // 30 second read timeout
  bufferAhead: 2,               // Buffer 2 chunks ahead
};

// ============================================================================
// CHECKPOINT STORAGE
// ============================================================================

class CheckpointStorage {
  private storage: Map<string, StreamCheckpoint> = new Map();
  
  constructor() {
    // Storage is in-memory with sessionStorage fallback
  }
  
  /**
   * Save checkpoint
   */
  async save(checkpoint: StreamCheckpoint): Promise<void> {
    this.storage.set(checkpoint.fileId, checkpoint);
    
    // Try to persist to sessionStorage for recovery
    try {
      sessionStorage.setItem(
        `spk-checkpoint-${checkpoint.fileId}`,
        JSON.stringify(checkpoint)
      );
    } catch {
      // Storage full or unavailable - continue with in-memory only
    }
  }
  
  /**
   * Load checkpoint
   */
  async load(fileId: string): Promise<StreamCheckpoint | null> {
    // Check in-memory first
    const cached = this.storage.get(fileId);
    if (cached) return cached;
    
    // Try sessionStorage
    try {
      const stored = sessionStorage.getItem(`spk-checkpoint-${fileId}`);
      if (stored) {
        const checkpoint = JSON.parse(stored) as StreamCheckpoint;
        this.storage.set(fileId, checkpoint);
        return checkpoint;
      }
    } catch {
      // Storage unavailable
    }
    
    return null;
  }
  
  /**
   * Delete checkpoint
   */
  async delete(fileId: string): Promise<void> {
    this.storage.delete(fileId);
    
    try {
      sessionStorage.removeItem(`spk-checkpoint-${fileId}`);
    } catch {
      // Ignore
    }
  }
  
  /**
   * Clear all checkpoints
   */
  async clear(): Promise<void> {
    this.storage.clear();
    
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('spk-checkpoint-')) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// RESILIENT FILE STREAMER
// ============================================================================

export class ResilientFileStreamer {
  private config: ResilientStreamerConfig;
  private file: File | null = null;
  private fileId = '';
  private chunkSize: number;
  private currentOffset = 0;
  private currentChunkIndex = 0;
  private totalChunks = 0;
  private totalRetries = 0;
  private isStreaming = false;
  private isPaused = false;
  private abortController: AbortController | null = null;
  private checkpointStorage = new CheckpointStorage();
  private eventHandlers: StreamEventHandler[] = [];
  private speedSamples: { time: number; bytes: number }[] = [];
  private startTime = 0;
  
  constructor(config: Partial<ResilientStreamerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chunkSize = this.config.defaultChunkSize;
  }
  
  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  
  /**
   * Initialize streamer for a file
   */
  async initialize(file: File, chunkSize?: number): Promise<void> {
    this.file = file;
    this.fileId = await this.generateFileId(file);
    this.chunkSize = chunkSize ?? this.calculateOptimalChunkSize(file.size);
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.currentOffset = 0;
    this.currentChunkIndex = 0;
    this.totalRetries = 0;
    this.speedSamples = [];
    this.startTime = 0;
    
    // Check for existing checkpoint
    const checkpoint = await this.checkpointStorage.load(this.fileId);
    if (checkpoint) {
      this.emit({
        type: 'stream-resumed',
        timestamp: Date.now(),
        message: `Found checkpoint at chunk ${checkpoint.chunkIndex}`,
        details: { checkpoint },
      });
    }
  }
  
  /**
   * Generate unique file ID
   */
  private async generateFileId(file: File): Promise<string> {
    const data = `${file.name}-${file.size}-${file.lastModified}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }
  
  /**
   * Calculate optimal chunk size based on file size
   */
  private calculateOptimalChunkSize(fileSize: number): number {
    // Smaller files = smaller chunks
    if (fileSize < 10 * MB) return MB;
    if (fileSize < 100 * MB) return 4 * MB;
    if (fileSize < GB) return 8 * MB;
    if (fileSize < 10 * GB) return 16 * MB;
    if (fileSize < 100 * GB) return 32 * MB;
    return 64 * MB;
  }
  
  // ==========================================================================
  // STREAMING
  // ==========================================================================
  
  /**
   * Stream chunks with automatic recovery
   */
  async *stream(options: {
    signal?: AbortSignal;
    resume?: boolean;
  } = {}): AsyncGenerator<StreamChunk> {
    if (!this.file) {
      throw new Error('Streamer not initialized');
    }
    
    this.isStreaming = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    
    const signal = options.signal;
    
    // Handle external abort
    if (signal) {
      signal.addEventListener('abort', () => {
        this.abortController?.abort();
      });
    }
    
    // Resume from checkpoint if requested
    if (options.resume) {
      const checkpoint = await this.checkpointStorage.load(this.fileId);
      if (checkpoint) {
        this.currentOffset = checkpoint.bytesRead;
        this.currentChunkIndex = checkpoint.chunkIndex;
      }
    }
    
    this.emit({
      type: 'stream-started',
      timestamp: Date.now(),
      message: `Starting stream of ${this.file.name} (${this.formatBytes(this.file.size)})`,
      details: {
        fileName: this.file.name,
        fileSize: this.file.size,
        chunkSize: this.chunkSize,
        totalChunks: this.totalChunks,
        resumeFrom: this.currentChunkIndex,
      },
    });
    
    while (this.currentOffset < this.file.size && !this.abortController.signal.aborted) {
      // Check for pause
      while (this.isPaused && !this.abortController.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      try {
        const chunk = await this.readChunkWithRetry();
        
        if (chunk) {
          // Update speed tracking
          this.updateSpeedSamples(chunk.size);
          
          // Save checkpoint periodically
          if (
            this.config.enableCheckpoints &&
            this.currentChunkIndex % this.config.checkpointFrequency === 0
          ) {
            await this.saveCheckpoint();
          }
          
          yield chunk;
          
          // Emit progress
          this.emitProgress();
        }
      } catch (error) {
        // Handle fatal read error
        const streamError = this.classifyError(error);
        
        this.emit({
          type: 'stream-error',
          timestamp: Date.now(),
          message: streamError.message,
          details: { error: streamError },
        });
        
        if (!streamError.retryable) {
          throw new Error(streamError.message);
        }
      }
    }
    
    // Stream complete
    this.isStreaming = false;
    
    if (!this.abortController.signal.aborted) {
      // Clean up checkpoint
      await this.checkpointStorage.delete(this.fileId);
      
      this.emit({
        type: 'stream-complete',
        timestamp: Date.now(),
        message: `Stream complete: ${this.currentChunkIndex} chunks, ${this.totalRetries} retries`,
        details: {
          chunksRead: this.currentChunkIndex,
          bytesRead: this.currentOffset,
          totalRetries: this.totalRetries,
          duration: Date.now() - this.startTime,
        },
      });
    }
  }
  
  /**
   * Read a chunk with retry logic
   */
  private async readChunkWithRetry(): Promise<StreamChunk | null> {
    if (!this.file) return null;
    
    let retryCount = 0;
    let lastError: Error | null = null;
    
    while (retryCount <= this.config.maxReadRetries) {
      try {
        const chunk = await this.readChunk();
        return { ...chunk, retryCount };
      } catch (error) {
        lastError = error as Error;
        retryCount++;
        this.totalRetries++;
        
        this.emit({
          type: 'chunk-retry',
          timestamp: Date.now(),
          message: `Retrying chunk ${this.currentChunkIndex} (attempt ${retryCount}/${this.config.maxReadRetries + 1})`,
          details: {
            chunkIndex: this.currentChunkIndex,
            attempt: retryCount,
            error: lastError.message,
          },
        });
        
        // Wait before retry
        if (retryCount <= this.config.maxReadRetries) {
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay * retryCount)
          );
        }
      }
    }
    
    // All retries exhausted
    this.emit({
      type: 'chunk-failed',
      timestamp: Date.now(),
      message: `Failed to read chunk ${this.currentChunkIndex} after ${retryCount} attempts`,
      details: {
        chunkIndex: this.currentChunkIndex,
        error: lastError?.message,
      },
    });
    
    throw lastError;
  }
  
  /**
   * Read a single chunk
   */
  private async readChunk(): Promise<Omit<StreamChunk, 'retryCount'>> {
    if (!this.file) {
      throw new Error('No file to read');
    }
    
    const startTime = performance.now();
    const start = this.currentOffset;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const isLast = end >= this.file.size;
    
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), this.config.readTimeout);
    });
    
    // Read with timeout
    const blob = this.file.slice(start, end);
    const arrayBuffer = await Promise.race([
      blob.arrayBuffer(),
      timeoutPromise,
    ]);
    
    const data = new Uint8Array(arrayBuffer);
    const readTime = performance.now() - startTime;
    
    const chunk: Omit<StreamChunk, 'retryCount'> = {
      index: this.currentChunkIndex,
      data,
      offset: start,
      size: data.length,
      isLast,
      readTime,
    };
    
    // Update position
    this.currentOffset = end;
    this.currentChunkIndex++;
    
    this.emit({
      type: 'chunk-read',
      timestamp: Date.now(),
      message: `Read chunk ${chunk.index} (${this.formatBytes(chunk.size)}) in ${readTime.toFixed(1)}ms`,
      details: {
        chunkIndex: chunk.index,
        size: chunk.size,
        offset: chunk.offset,
        readTime,
        isLast,
      },
    });
    
    return chunk;
  }
  
  // ==========================================================================
  // CONTROL
  // ==========================================================================
  
  /**
   * Pause streaming
   */
  pause(): void {
    if (!this.isStreaming || this.isPaused) return;
    
    this.isPaused = true;
    
    // Save checkpoint
    this.saveCheckpoint();
    
    this.emit({
      type: 'stream-paused',
      timestamp: Date.now(),
      message: `Stream paused at chunk ${this.currentChunkIndex}`,
    });
  }
  
  /**
   * Resume streaming
   */
  resume(): void {
    if (!this.isStreaming || !this.isPaused) return;
    
    this.isPaused = false;
    
    this.emit({
      type: 'stream-resumed',
      timestamp: Date.now(),
      message: `Stream resumed from chunk ${this.currentChunkIndex}`,
    });
  }
  
  /**
   * Abort streaming
   */
  abort(): void {
    this.abortController?.abort();
    this.isStreaming = false;
    this.isPaused = false;
  }
  
  /**
   * Reset streamer
   */
  reset(): void {
    this.abort();
    this.file = null;
    this.fileId = '';
    this.currentOffset = 0;
    this.currentChunkIndex = 0;
    this.totalRetries = 0;
    this.speedSamples = [];
  }
  
  // ==========================================================================
  // CHECKPOINTS
  // ==========================================================================
  
  /**
   * Save current checkpoint
   */
  private async saveCheckpoint(): Promise<void> {
    if (!this.file || !this.config.enableCheckpoints) return;
    
    const checkpoint: StreamCheckpoint = {
      fileId: this.fileId,
      fileName: this.file.name,
      fileSize: this.file.size,
      chunkIndex: this.currentChunkIndex,
      bytesRead: this.currentOffset,
      timestamp: Date.now(),
    };
    
    await this.checkpointStorage.save(checkpoint);
    
    this.emit({
      type: 'checkpoint-saved',
      timestamp: Date.now(),
      message: `Checkpoint saved at chunk ${this.currentChunkIndex}`,
      details: { checkpoint },
    });
  }
  
  /**
   * Get existing checkpoint for file
   */
  async getCheckpoint(file: File): Promise<StreamCheckpoint | null> {
    const fileId = await this.generateFileId(file);
    return this.checkpointStorage.load(fileId);
  }
  
  /**
   * Clear checkpoint for file
   */
  async clearCheckpoint(file: File): Promise<void> {
    const fileId = await this.generateFileId(file);
    await this.checkpointStorage.delete(fileId);
  }
  
  // ==========================================================================
  // PROGRESS & SPEED
  // ==========================================================================
  
  /**
   * Update speed tracking samples
   */
  private updateSpeedSamples(_bytesRead: number): void {
    const now = Date.now();
    this.speedSamples.push({ time: now, bytes: this.currentOffset });
    
    // Keep last 10 samples
    if (this.speedSamples.length > 10) {
      this.speedSamples.shift();
    }
  }
  
  /**
   * Calculate current speed
   */
  private calculateSpeed(): number {
    if (this.speedSamples.length < 2) {
      return 0;
    }
    
    const oldest = this.speedSamples[0];
    const newest = this.speedSamples[this.speedSamples.length - 1];
    const timeDiff = (newest.time - oldest.time) / 1000;
    const bytesDiff = newest.bytes - oldest.bytes;
    
    return timeDiff > 0 ? bytesDiff / timeDiff : 0;
  }
  
  /**
   * Get current progress
   */
  getProgress(): StreamProgress {
    const speed = this.calculateSpeed();
    const remaining = this.file ? this.file.size - this.currentOffset : 0;
    const eta = speed > 0 ? remaining / speed : 0;
    
    return {
      bytesRead: this.currentOffset,
      totalBytes: this.file?.size ?? 0,
      chunksRead: this.currentChunkIndex,
      totalChunks: this.totalChunks,
      percentage: this.file ? (this.currentOffset / this.file.size) * 100 : 0,
      speed,
      eta,
      retries: this.totalRetries,
      isResuming: false,
    };
  }
  
  /**
   * Emit progress event
   */
  private emitProgress(): void {
    const progress = this.getProgress();
    
    this.emit({
      type: 'progress',
      timestamp: Date.now(),
      message: `${progress.percentage.toFixed(1)}% - ${this.formatBytes(progress.bytesRead)} / ${this.formatBytes(progress.totalBytes)}`,
      details: { progress },
    });
  }
  
  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================
  
  /**
   * Classify error type
   */
  private classifyError(error: unknown): StreamError {
    const message = error instanceof Error ? error.message : String(error);
    
    if (message.includes('timeout')) {
      return {
        type: 'timeout',
        message: 'Read operation timed out',
        offset: this.currentOffset,
        retryable: true,
      };
    }
    
    if (message.includes('abort')) {
      return {
        type: 'abort',
        message: 'Operation was aborted',
        offset: this.currentOffset,
        retryable: false,
      };
    }
    
    if (message.includes('NotFoundError') || message.includes('not found')) {
      return {
        type: 'not-found',
        message: 'File not found or was removed',
        offset: this.currentOffset,
        retryable: false,
      };
    }
    
    if (message.includes('permission') || message.includes('NotAllowed')) {
      return {
        type: 'permission',
        message: 'Permission denied to read file',
        offset: this.currentOffset,
        retryable: false,
      };
    }
    
    return {
      type: 'read',
      message: `Read error: ${message}`,
      offset: this.currentOffset,
      retryable: true,
    };
  }
  
  // ==========================================================================
  // EVENTS
  // ==========================================================================
  
  /**
   * Add event handler
   */
  addEventListener(handler: StreamEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }
  
  /**
   * Emit event
   */
  private emit(event: StreamEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[ResilientStreamer] Event handler error:', error);
      }
    }
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
    if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
    if (bytes < 1024 * GB) return `${(bytes / GB).toFixed(2)} GB`;
    return `${(bytes / (1024 * GB)).toFixed(2)} TB`;
  }
  
  /**
   * Get current state
   */
  getState(): {
    isStreaming: boolean;
    isPaused: boolean;
    currentChunk: number;
    totalChunks: number;
    bytesRead: number;
    totalBytes: number;
  } {
    return {
      isStreaming: this.isStreaming,
      isPaused: this.isPaused,
      currentChunk: this.currentChunkIndex,
      totalChunks: this.totalChunks,
      bytesRead: this.currentOffset,
      totalBytes: this.file?.size ?? 0,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalStreamer: ResilientFileStreamer | null = null;

export function getResilientFileStreamer(
  config?: Partial<ResilientStreamerConfig>
): ResilientFileStreamer {
  if (!globalStreamer) {
    globalStreamer = new ResilientFileStreamer(config);
  }
  return globalStreamer;
}

export function resetResilientFileStreamer(): void {
  if (globalStreamer) {
    globalStreamer.reset();
    globalStreamer = null;
  }
}
