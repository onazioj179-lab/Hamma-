/**
 * SPK Ultra-Parallel Throughput Engine - Stream Manager
 * Creator: OJ Treasure Onazi
 * 
 * High-bandwidth file streaming with predictive prefetch,
 * memory-aware buffering, and adaptive chunk loading.
 */

import {
  StreamConfig,
  DEFAULT_STREAM_CONFIG,
  StreamBuffer,
  StreamStats,
  ParallelEvent,
  ParallelEventHandler,
  MB,
  GB,
} from './types';

// ============================================================================
// BUFFER ENTRY
// ============================================================================

interface BufferEntry {
  chunkIndex: number;
  data: Uint8Array;
  size: number;
  bufferedAt: number;
  readCount: number;
  priority: number;
  prefetched: boolean;
}

// ============================================================================
// STREAM MANAGER
// ============================================================================

export class StreamManager {
  private config: StreamConfig;
  private buffer: Map<number, BufferEntry> = new Map();
  private eventHandlers: Set<ParallelEventHandler> = new Set();
  private totalMemory = 0;
  private hits = 0;
  private misses = 0;
  private prefetchHits = 0;
  private prefetchMisses = 0;
  private readQueue: number[] = [];
  private prefetchQueue: number[] = [];
  private isHighRam: boolean;
  private fileReader: ((chunkIndex: number) => Promise<Uint8Array>) | null = null;
  private totalChunks = 0;
  private chunkSizes: Map<number, number> = new Map();

  constructor(config: Partial<StreamConfig> = {}) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
    this.isHighRam = this.detectRamLevel();
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: ParallelEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: ParallelEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: ParallelEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  initialize(
    totalChunks: number,
    chunkSizes: Map<number, number>,
    reader: (chunkIndex: number) => Promise<Uint8Array>
  ): void {
    this.totalChunks = totalChunks;
    this.chunkSizes = chunkSizes;
    this.fileReader = reader;
    this.buffer.clear();
    this.totalMemory = 0;
    this.hits = 0;
    this.misses = 0;
    this.prefetchHits = 0;
    this.prefetchMisses = 0;
  }

  private detectRamLevel(): boolean {
    if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      const memory = (navigator as { deviceMemory?: number }).deviceMemory || 4;
      return memory >= 4;
    }
    // Default to high RAM if we can't detect
    return true;
  }

  // ==========================================================================
  // BUFFER MANAGEMENT
  // ==========================================================================

  getPreBufferDepth(): number {
    return this.isHighRam 
      ? this.config.highRamPreBuffer 
      : this.config.lowRamPreBuffer;
  }

  async getChunk(chunkIndex: number): Promise<Uint8Array | null> {
    // Check buffer first
    const entry = this.buffer.get(chunkIndex);
    if (entry) {
      entry.readCount++;
      this.hits++;
      if (entry.prefetched) {
        this.prefetchHits++;
      }
      return entry.data;
    }

    this.misses++;
    
    // Load from source
    if (!this.fileReader) return null;

    try {
      const data = await this.readWithTimeout(chunkIndex);
      if (data) {
        this.addToBuffer(chunkIndex, data, false);
        
        // Trigger prefetch for subsequent chunks
        if (this.config.predictivePrefetch) {
          this.triggerPrefetch(chunkIndex);
        }
        
        return data;
      }
    } catch (error) {
      console.error(`Failed to read chunk ${chunkIndex}:`, error);
    }

    return null;
  }

  private async readWithTimeout(chunkIndex: number): Promise<Uint8Array | null> {
    if (!this.fileReader) return null;

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), this.config.readTimeout);
    });

    const readPromise = this.fileReader(chunkIndex);
    return Promise.race([readPromise, timeoutPromise]);
  }

  private addToBuffer(chunkIndex: number, data: Uint8Array, prefetched: boolean): void {
    // Check memory limit
    while (this.totalMemory + data.length > this.config.maxBufferMemory) {
      this.evictOldest();
    }

    const entry: BufferEntry = {
      chunkIndex,
      data,
      size: data.length,
      bufferedAt: Date.now(),
      readCount: 0,
      priority: this.totalChunks - chunkIndex, // Higher priority for earlier chunks
      prefetched,
    };

    this.buffer.set(chunkIndex, entry);
    this.totalMemory += data.length;

    if (this.totalMemory >= this.config.maxBufferMemory * 0.9) {
      this.emit({ type: 'buffer-full' });
    }
  }

  private evictOldest(): void {
    if (this.buffer.size === 0) return;

    // Find entry with lowest priority and oldest
    let toEvict: number | null = null;
    let lowestScore = Infinity;

    for (const [index, entry] of this.buffer) {
      // Score based on age and priority (lower = evict first)
      const age = Date.now() - entry.bufferedAt;
      const score = entry.priority * 1000 + entry.readCount * 500 - age / 1000;
      
      if (score < lowestScore) {
        lowestScore = score;
        toEvict = index;
      }
    }

    if (toEvict !== null) {
      const entry = this.buffer.get(toEvict);
      if (entry) {
        this.totalMemory -= entry.size;
        this.buffer.delete(toEvict);
      }
    }
  }

  // ==========================================================================
  // PREFETCHING
  // ==========================================================================

  private triggerPrefetch(currentChunk: number): void {
    const lookahead = this.config.prefetchLookahead;
    const depth = this.getPreBufferDepth();

    // Clear old prefetch queue
    this.prefetchQueue = [];

    // Add chunks to prefetch
    for (let i = 1; i <= depth && i <= lookahead; i++) {
      const nextChunk = currentChunk + i;
      if (nextChunk < this.totalChunks && !this.buffer.has(nextChunk)) {
        this.prefetchQueue.push(nextChunk);
      }
    }

    // Start prefetching (don't await)
    this.processPrefetchQueue();
  }

  private async processPrefetchQueue(): Promise<void> {
    while (this.prefetchQueue.length > 0) {
      // Check memory
      if (this.totalMemory >= this.config.maxBufferMemory * 0.8) {
        break;
      }

      const chunkIndex = this.prefetchQueue.shift()!;
      
      // Skip if already buffered
      if (this.buffer.has(chunkIndex)) continue;

      try {
        const data = await this.readWithTimeout(chunkIndex);
        if (data) {
          this.addToBuffer(chunkIndex, data, true);
        } else {
          this.prefetchMisses++;
        }
      } catch {
        this.prefetchMisses++;
      }
    }
  }

  async prefetchRange(start: number, end: number): Promise<void> {
    const promises: Promise<void>[] = [];

    for (let i = start; i <= end && i < this.totalChunks; i++) {
      if (!this.buffer.has(i)) {
        promises.push(
          this.getChunk(i).then(() => {})
        );
      }
    }

    await Promise.all(promises);
  }

  // ==========================================================================
  // BUFFER QUERIES
  // ==========================================================================

  isBuffered(chunkIndex: number): boolean {
    return this.buffer.has(chunkIndex);
  }

  getBufferedChunks(): number[] {
    return Array.from(this.buffer.keys());
  }

  getBufferedRange(): { start: number; end: number } | null {
    const chunks = this.getBufferedChunks();
    if (chunks.length === 0) return null;
    
    chunks.sort((a, b) => a - b);
    return { start: chunks[0], end: chunks[chunks.length - 1] };
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  getStats(): StreamStats {
    const totalReads = this.hits + this.misses;
    const totalPrefetch = this.prefetchHits + this.prefetchMisses;

    // Calculate average buffer time
    let totalBufferTime = 0;
    let count = 0;
    const now = Date.now();
    for (const entry of this.buffer.values()) {
      totalBufferTime += now - entry.bufferedAt;
      count++;
    }

    return {
      bufferedChunks: this.buffer.size,
      bufferMemory: this.totalMemory,
      hitRate: totalReads > 0 ? this.hits / totalReads : 0,
      missRate: totalReads > 0 ? this.misses / totalReads : 0,
      prefetchAccuracy: totalPrefetch > 0 ? this.prefetchHits / totalPrefetch : 0,
      avgBufferTime: count > 0 ? totalBufferTime / count : 0,
    };
  }

  getMemoryUsage(): {
    used: number;
    limit: number;
    percentage: number;
  } {
    return {
      used: this.totalMemory,
      limit: this.config.maxBufferMemory,
      percentage: this.config.maxBufferMemory > 0 
        ? (this.totalMemory / this.config.maxBufferMemory) * 100 
        : 0,
    };
  }

  // ==========================================================================
  // BUFFER CONTROL
  // ==========================================================================

  clearBuffer(): void {
    this.buffer.clear();
    this.totalMemory = 0;
    this.emit({ type: 'buffer-empty' });
  }

  releaseChunk(chunkIndex: number): void {
    const entry = this.buffer.get(chunkIndex);
    if (entry) {
      this.totalMemory -= entry.size;
      this.buffer.delete(chunkIndex);
    }
  }

  releaseChunks(chunkIndices: number[]): void {
    for (const index of chunkIndices) {
      this.releaseChunk(index);
    }
  }

  releaseBefore(chunkIndex: number): void {
    const toRelease: number[] = [];
    for (const [index] of this.buffer) {
      if (index < chunkIndex) {
        toRelease.push(index);
      }
    }
    this.releaseChunks(toRelease);
  }

  // ==========================================================================
  // ADAPTIVE CONFIGURATION
  // ==========================================================================

  setHighRamMode(enabled: boolean): void {
    this.isHighRam = enabled;
    
    // Adjust buffer if needed
    if (!enabled && this.totalMemory > this.config.maxBufferMemory * 0.5) {
      // Evict until under 50% capacity
      while (this.totalMemory > this.config.maxBufferMemory * 0.5 && this.buffer.size > 0) {
        this.evictOldest();
      }
    }
  }

  setMaxBufferMemory(bytes: number): void {
    this.config.maxBufferMemory = bytes;
    
    // Evict if over new limit
    while (this.totalMemory > bytes && this.buffer.size > 0) {
      this.evictOldest();
    }
  }

  // ==========================================================================
  // STREAMING READ
  // ==========================================================================

  async *streamChunks(
    start: number,
    end: number
  ): AsyncGenerator<{ index: number; data: Uint8Array }, void, unknown> {
    for (let i = start; i <= end && i < this.totalChunks; i++) {
      const data = await this.getChunk(i);
      if (data) {
        yield { index: i, data };
        
        // Release chunks behind us (with some buffer)
        if (i > start + 5) {
          this.releaseChunk(i - 5);
        }
      }
    }
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  reset(): void {
    this.clearBuffer();
    this.hits = 0;
    this.misses = 0;
    this.prefetchHits = 0;
    this.prefetchMisses = 0;
    this.readQueue = [];
    this.prefetchQueue = [];
    this.totalChunks = 0;
    this.chunkSizes.clear();
    this.fileReader = null;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createStreamManager(
  config?: Partial<StreamConfig>
): StreamManager {
  return new StreamManager(config);
}
