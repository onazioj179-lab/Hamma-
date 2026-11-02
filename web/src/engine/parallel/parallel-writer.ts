/**
 * SPK Ultra-Parallel Throughput Engine - Parallel Writer
 * Creator: OJ Treasure Onazi
 * 
 * Thread-safe parallel chunk writer with BigInt offset tracking,
 * ordered writes, and batched flushing.
 */

import {
  WriterConfig,
  DEFAULT_WRITER_CONFIG,
  WriteQueueItem,
  WriterState,
  ParallelEvent,
  ParallelEventHandler,
  MB,
} from './types';

// ============================================================================
// WRITE BATCH
// ============================================================================

interface WriteBatch {
  items: WriteQueueItem[];
  totalSize: number;
  createdAt: number;
}

// ============================================================================
// PARALLEL WRITER
// ============================================================================

export class ParallelWriter {
  private config: WriterConfig;
  private state: WriterState;
  private eventHandlers: Set<ParallelEventHandler> = new Set();
  private outputBuffer: Uint8Array[] = [];
  private outputBlob: Blob | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private writeCallback: ((data: Uint8Array, offset: bigint) => Promise<void>) | null = null;
  private metadata: Map<number, { hash: string; size: number; offset: bigint }> = new Map();

  constructor(config: Partial<WriterConfig> = {}) {
    this.config = { ...DEFAULT_WRITER_CONFIG, ...config };
    this.state = {
      nextExpectedIndex: 0,
      lastWrittenOffset: BigInt(0),
      pendingWrites: new Map(),
      writeCount: 0,
      bytesWritten: BigInt(0),
      flushCount: 0,
      errors: 0,
    };
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
    writeCallback?: (data: Uint8Array, offset: bigint) => Promise<void>
  ): void {
    this.writeCallback = writeCallback || null;
    this.state = {
      nextExpectedIndex: 0,
      lastWrittenOffset: BigInt(0),
      pendingWrites: new Map(),
      writeCount: 0,
      bytesWritten: BigInt(0),
      flushCount: 0,
      errors: 0,
    };
    this.outputBuffer = [];
    this.outputBlob = null;
    this.metadata.clear();
    
    // Start flush timer
    this.startFlushTimer();
  }

  // ==========================================================================
  // WRITE QUEUE
  // ==========================================================================

  async enqueue(
    chunkIndex: number,
    data: Uint8Array,
    offset: bigint,
    hash?: string
  ): Promise<boolean> {
    // Check queue limit
    if (this.state.pendingWrites.size >= this.config.maxQueueSize) {
      // Force flush
      await this.flush();
    }

    const item: WriteQueueItem = {
      chunkIndex,
      data,
      offset,
      timestamp: Date.now(),
      priority: this.calculatePriority(chunkIndex),
      verified: false,
    };

    // Store metadata
    if (hash) {
      this.metadata.set(chunkIndex, {
        hash,
        size: data.length,
        offset,
      });
    }

    // Verify if enabled
    if (this.config.verifyWrites && hash) {
      const computedHash = await this.computeHash(data);
      item.verified = computedHash === hash;
      if (!item.verified) {
        this.state.errors++;
        return false;
      }
    }

    this.state.pendingWrites.set(chunkIndex, item);

    // Process ordered writes
    if (this.config.orderedWrites) {
      await this.processOrderedWrites();
    } else {
      // Immediate write
      await this.writeChunk(item);
    }

    return true;
  }

  private calculatePriority(chunkIndex: number): number {
    // Earlier chunks have higher priority
    return 1000000 - chunkIndex;
  }

  // ==========================================================================
  // ORDERED WRITE PROCESSING
  // ==========================================================================

  private async processOrderedWrites(): Promise<void> {
    // Write chunks in order
    while (this.state.pendingWrites.has(this.state.nextExpectedIndex)) {
      const item = this.state.pendingWrites.get(this.state.nextExpectedIndex)!;
      await this.writeChunk(item);
      this.state.pendingWrites.delete(this.state.nextExpectedIndex);
      this.state.nextExpectedIndex++;
    }

    // Check for out-of-order buffer overflow
    if (this.state.pendingWrites.size > this.config.maxOutOfOrderBuffer) {
      // Skip missing chunks and continue
      const pending = Array.from(this.state.pendingWrites.keys()).sort((a, b) => a - b);
      if (pending.length > 0 && pending[0] > this.state.nextExpectedIndex) {
        console.warn(`Skipping chunks ${this.state.nextExpectedIndex} to ${pending[0] - 1}`);
        this.state.nextExpectedIndex = pending[0];
        await this.processOrderedWrites();
      }
    }
  }

  // ==========================================================================
  // WRITE OPERATIONS
  // ==========================================================================

  private async writeChunk(item: WriteQueueItem): Promise<void> {
    try {
      if (this.writeCallback) {
        // Use callback for direct writes
        await this.writeCallback(item.data, item.offset);
      } else {
        // Buffer for blob creation
        this.outputBuffer.push(item.data);
      }

      this.state.writeCount++;
      this.state.bytesWritten += BigInt(item.data.length);
      this.state.lastWrittenOffset = item.offset + BigInt(item.data.length);
    } catch (error) {
      this.state.errors++;
      console.error(`Failed to write chunk ${item.chunkIndex}:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // HASH COMPUTATION
  // ==========================================================================

  private async computeHash(data: Uint8Array): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
      const hashArray = new Uint8Array(hashBuffer);
      return Array.from(hashArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Fallback DJB2
    let hash = 5381;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) + hash) ^ data[i];
      hash = hash >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  // ==========================================================================
  // FLUSHING
  // ==========================================================================

  private startFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.checkFlushThreshold();
    }, this.config.flushInterval);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private checkFlushThreshold(): void {
    // Calculate pending size
    let pendingSize = 0;
    for (const item of this.state.pendingWrites.values()) {
      pendingSize += item.data.length;
    }

    if (pendingSize >= this.config.flushThreshold) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    // Process all ordered writes first
    if (this.config.orderedWrites) {
      await this.processOrderedWrites();
    } else {
      // Write all pending
      const items = Array.from(this.state.pendingWrites.values())
        .sort((a, b) => a.chunkIndex - b.chunkIndex);

      for (const item of items) {
        await this.writeChunk(item);
        this.state.pendingWrites.delete(item.chunkIndex);
      }
    }

    this.state.flushCount++;
    this.emit({
      type: 'write-flush',
      count: this.state.writeCount,
      bytes: Number(this.state.bytesWritten),
    });
  }

  // ==========================================================================
  // BLOB GENERATION
  // ==========================================================================

  async finalize(): Promise<Blob> {
    // Flush remaining writes
    await this.flush();
    this.stopFlushTimer();

    // Create blob from buffer
    if (this.outputBuffer.length > 0) {
      this.outputBlob = new Blob(this.outputBuffer.map(u8 => u8.buffer as ArrayBuffer), { type: 'application/octet-stream' });
      this.outputBuffer = [];
    }

    return this.outputBlob || new Blob();
  }

  async getPartialBlob(startChunk: number, endChunk: number): Promise<Blob> {
    const chunks: ArrayBuffer[] = [];
    
    for (let i = startChunk; i <= endChunk; i++) {
      const item = this.state.pendingWrites.get(i);
      if (item) {
        chunks.push(item.data.buffer as ArrayBuffer);
      }
    }

    return new Blob(chunks, { type: 'application/octet-stream' });
  }

  // ==========================================================================
  // STATE ACCESS
  // ==========================================================================

  getState(): WriterState {
    return { ...this.state };
  }

  getStats(): {
    writeCount: number;
    bytesWritten: bigint;
    pendingCount: number;
    pendingBytes: number;
    errorCount: number;
    flushCount: number;
  } {
    let pendingBytes = 0;
    for (const item of this.state.pendingWrites.values()) {
      pendingBytes += item.data.length;
    }

    return {
      writeCount: this.state.writeCount,
      bytesWritten: this.state.bytesWritten,
      pendingCount: this.state.pendingWrites.size,
      pendingBytes,
      errorCount: this.state.errors,
      flushCount: this.state.flushCount,
    };
  }

  getProgress(): {
    chunksWritten: number;
    nextExpected: number;
    outOfOrder: number;
    bytesWritten: bigint;
  } {
    return {
      chunksWritten: this.state.writeCount,
      nextExpected: this.state.nextExpectedIndex,
      outOfOrder: this.state.pendingWrites.size,
      bytesWritten: this.state.bytesWritten,
    };
  }

  getMetadata(): Map<number, { hash: string; size: number; offset: bigint }> {
    return this.metadata;
  }

  // ==========================================================================
  // VERIFICATION
  // ==========================================================================

  async verifyWrittenChunks(): Promise<{
    verified: number;
    failed: number;
    missingHashes: number;
  }> {
    let verified = 0;
    let failed = 0;
    let missingHashes = 0;

    // This would need access to the written data
    // For now, just return stats based on metadata
    for (const [chunkIndex, meta] of this.metadata) {
      if (!meta.hash) {
        missingHashes++;
      } else {
        const item = this.state.pendingWrites.get(chunkIndex);
        if (item?.verified) {
          verified++;
        } else if (item) {
          failed++;
        }
      }
    }

    return { verified, failed, missingHashes };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  reset(): void {
    this.stopFlushTimer();
    this.state = {
      nextExpectedIndex: 0,
      lastWrittenOffset: BigInt(0),
      pendingWrites: new Map(),
      writeCount: 0,
      bytesWritten: BigInt(0),
      flushCount: 0,
      errors: 0,
    };
    this.outputBuffer = [];
    this.outputBlob = null;
    this.metadata.clear();
    this.writeCallback = null;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createParallelWriter(
  config?: Partial<WriterConfig>
): ParallelWriter {
  return new ParallelWriter(config);
}
