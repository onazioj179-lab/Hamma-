/**
 * SPK Partition-Level Resume System
 * 
 * Enables resumption at partition boundaries for 10TB+ workloads.
 * Tracks partition index, byte offsets, and pending chunks.
 * 
 * Features:
 * - Partition-aware checkpoint granularity
 * - Byte-level offset tracking
 * - Pending chunk queue persistence
 * - Failed chunk retry logic
 * 
 * Creator: Onazi Treasure (OJ)
 */

import type { ChunkTableEntry } from './checkpoint-manager';

// ============================================================================
// Types
// ============================================================================

export interface Partition {
  index: number;
  startChunk: number;
  endChunk: number;
  startByte: number;
  endByte: number;
  status: PartitionStatus;
  chunksCompleted: number;
  totalChunks: number;
  bytesProcessed: number;
  totalBytes: number;
  checksum: string;
}

export type PartitionStatus = 
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'paused';

export interface PartitionResumeState {
  partitions: Partition[];
  currentPartitionIndex: number;
  pendingChunks: number[];
  failedChunks: FailedChunk[];
  totalPartitions: number;
  completedPartitions: number;
  byteOffsets: PartitionByteOffsets;
}

export interface PartitionByteOffsets {
  sourceOffset: number;      // Current read position
  destOffset: number;        // Current write position
  lastFlushedOffset: number; // Last committed write
  partitionBoundaries: number[]; // Byte positions of partition starts
}

export interface FailedChunk {
  chunkIndex: number;
  partitionIndex: number;
  error: string;
  retryCount: number;
  lastAttempt: number;
}

export interface PartitionConfig {
  partitionSizeBytes: number;  // Size of each partition
  maxRetries: number;          // Max retries per chunk
  retryDelayMs: number;        // Delay between retries
  concurrentPartitions: number; // Max partitions to process in parallel
}

// ============================================================================
// PartitionManager
// ============================================================================

const DEFAULT_PARTITION_SIZE = 512 * 1024 * 1024; // 512MB partitions
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class PartitionManager {
  private config: PartitionConfig;
  private partitions: Map<number, Partition> = new Map();
  private pendingChunks: Set<number> = new Set();
  private failedChunks: Map<number, FailedChunk> = new Map();
  private byteOffsets: PartitionByteOffsets;
  private currentPartitionIndex = 0;
  private totalSize = 0;
  
  constructor(config: Partial<PartitionConfig> = {}) {
    this.config = {
      partitionSizeBytes: config.partitionSizeBytes ?? DEFAULT_PARTITION_SIZE,
      maxRetries: config.maxRetries ?? MAX_RETRIES,
      retryDelayMs: config.retryDelayMs ?? RETRY_DELAY_MS,
      concurrentPartitions: config.concurrentPartitions ?? 1,
    };
    
    this.byteOffsets = {
      sourceOffset: 0,
      destOffset: 0,
      lastFlushedOffset: 0,
      partitionBoundaries: [],
    };
  }
  
  /**
   * Initialize partitions for a given total size
   */
  initialize(totalSize: number, chunkSize: number): void {
    this.totalSize = totalSize;
    this.partitions.clear();
    this.pendingChunks.clear();
    this.failedChunks.clear();
    
    const numPartitions = Math.ceil(totalSize / this.config.partitionSizeBytes);
    const chunksPerPartition = Math.ceil(this.config.partitionSizeBytes / chunkSize);
    const totalChunks = Math.ceil(totalSize / chunkSize);
    
    let chunkIndex = 0;
    let byteOffset = 0;
    
    for (let i = 0; i < numPartitions; i++) {
      const startChunk = chunkIndex;
      const remainingChunks = totalChunks - chunkIndex;
      const partitionChunks = Math.min(chunksPerPartition, remainingChunks);
      const endChunk = startChunk + partitionChunks - 1;
      
      const startByte = byteOffset;
      const partitionBytes = Math.min(
        this.config.partitionSizeBytes,
        totalSize - byteOffset
      );
      const endByte = startByte + partitionBytes - 1;
      
      this.partitions.set(i, {
        index: i,
        startChunk,
        endChunk,
        startByte,
        endByte,
        status: 'pending',
        chunksCompleted: 0,
        totalChunks: partitionChunks,
        bytesProcessed: 0,
        totalBytes: partitionBytes,
        checksum: '',
      });
      
      this.byteOffsets.partitionBoundaries.push(startByte);
      
      chunkIndex = endChunk + 1;
      byteOffset = endByte + 1;
    }
    
    this.currentPartitionIndex = 0;
  }
  
  /**
   * Get next partition to process
   */
  getNextPartition(): Partition | null {
    // Find first non-completed partition
    for (const [index, partition] of this.partitions) {
      if (partition.status === 'pending' || partition.status === 'paused') {
        return partition;
      }
    }
    return null;
  }
  
  /**
   * Mark partition as in-progress
   */
  startPartition(index: number): void {
    const partition = this.partitions.get(index);
    if (partition) {
      partition.status = 'in-progress';
      this.currentPartitionIndex = index;
      
      // Add all chunks to pending
      for (let i = partition.startChunk; i <= partition.endChunk; i++) {
        this.pendingChunks.add(i);
      }
    }
  }
  
  /**
   * Mark a chunk as completed
   */
  completeChunk(
    chunkIndex: number, 
    entry: ChunkTableEntry
  ): void {
    this.pendingChunks.delete(chunkIndex);
    this.failedChunks.delete(chunkIndex);
    
    // Find which partition this chunk belongs to
    for (const partition of this.partitions.values()) {
      if (chunkIndex >= partition.startChunk && chunkIndex <= partition.endChunk) {
        partition.chunksCompleted++;
        partition.bytesProcessed += entry.originalSize;
        
        // Check if partition is complete
        if (partition.chunksCompleted >= partition.totalChunks) {
          this.completePartition(partition.index);
        }
        break;
      }
    }
    
    // Update byte offsets
    this.byteOffsets.sourceOffset = Math.max(
      this.byteOffsets.sourceOffset,
      (chunkIndex + 1) * entry.originalSize
    );
  }
  
  /**
   * Mark a chunk as failed
   */
  failChunk(chunkIndex: number, error: string): boolean {
    const existing = this.failedChunks.get(chunkIndex);
    const retryCount = existing ? existing.retryCount + 1 : 1;
    
    if (retryCount > this.config.maxRetries) {
      // Max retries exceeded, mark partition as failed
      for (const partition of this.partitions.values()) {
        if (chunkIndex >= partition.startChunk && chunkIndex <= partition.endChunk) {
          partition.status = 'failed';
          break;
        }
      }
      return false;
    }
    
    // Find partition for this chunk
    let partitionIndex = -1;
    for (const partition of this.partitions.values()) {
      if (chunkIndex >= partition.startChunk && chunkIndex <= partition.endChunk) {
        partitionIndex = partition.index;
        break;
      }
    }
    
    this.failedChunks.set(chunkIndex, {
      chunkIndex,
      partitionIndex,
      error,
      retryCount,
      lastAttempt: Date.now(),
    });
    
    return true; // Can retry
  }
  
  /**
   * Get chunks that need retry
   */
  getRetryableChunks(): number[] {
    const now = Date.now();
    const retryable: number[] = [];
    
    for (const [chunkIndex, failed] of this.failedChunks) {
      if (
        failed.retryCount <= this.config.maxRetries &&
        now - failed.lastAttempt >= this.config.retryDelayMs
      ) {
        retryable.push(chunkIndex);
      }
    }
    
    return retryable;
  }
  
  /**
   * Mark partition as completed
   */
  private completePartition(index: number): void {
    const partition = this.partitions.get(index);
    if (partition) {
      partition.status = 'completed';
      
      // Compute checksum
      partition.checksum = this.computePartitionChecksum(partition);
      
      // Update byte offset
      this.byteOffsets.lastFlushedOffset = partition.endByte;
    }
  }
  
  /**
   * Pause current partition (for checkpointing)
   */
  pauseCurrentPartition(): void {
    const partition = this.partitions.get(this.currentPartitionIndex);
    if (partition && partition.status === 'in-progress') {
      partition.status = 'paused';
    }
  }
  
  /**
   * Export state for checkpointing
   */
  exportState(): PartitionResumeState {
    return {
      partitions: Array.from(this.partitions.values()),
      currentPartitionIndex: this.currentPartitionIndex,
      pendingChunks: Array.from(this.pendingChunks),
      failedChunks: Array.from(this.failedChunks.values()),
      totalPartitions: this.partitions.size,
      completedPartitions: Array.from(this.partitions.values())
        .filter(p => p.status === 'completed').length,
      byteOffsets: { ...this.byteOffsets },
    };
  }
  
  /**
   * Import state from checkpoint
   */
  importState(state: PartitionResumeState): void {
    this.partitions.clear();
    for (const partition of state.partitions) {
      this.partitions.set(partition.index, partition);
    }
    
    this.currentPartitionIndex = state.currentPartitionIndex;
    this.pendingChunks = new Set(state.pendingChunks);
    
    this.failedChunks.clear();
    for (const failed of state.failedChunks) {
      this.failedChunks.set(failed.chunkIndex, failed);
    }
    
    this.byteOffsets = { ...state.byteOffsets };
  }
  
  /**
   * Get progress statistics
   */
  getProgress(): {
    totalPartitions: number;
    completedPartitions: number;
    currentPartition: number;
    overallProgress: number;
    bytesProcessed: number;
    totalBytes: number;
    pendingChunks: number;
    failedChunks: number;
  } {
    let bytesProcessed = 0;
    let completedPartitions = 0;
    
    for (const partition of this.partitions.values()) {
      bytesProcessed += partition.bytesProcessed;
      if (partition.status === 'completed') {
        completedPartitions++;
      }
    }
    
    return {
      totalPartitions: this.partitions.size,
      completedPartitions,
      currentPartition: this.currentPartitionIndex,
      overallProgress: this.totalSize > 0 ? (bytesProcessed / this.totalSize) * 100 : 0,
      bytesProcessed,
      totalBytes: this.totalSize,
      pendingChunks: this.pendingChunks.size,
      failedChunks: this.failedChunks.size,
    };
  }
  
  /**
   * Compute checksum for a partition
   */
  private computePartitionChecksum(partition: Partition): string {
    const data = `${partition.index}-${partition.startChunk}-${partition.endChunk}-${partition.bytesProcessed}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let partitionManagerInstance: PartitionManager | null = null;

export function getPartitionManager(): PartitionManager {
  if (!partitionManagerInstance) {
    partitionManagerInstance = new PartitionManager();
  }
  return partitionManagerInstance;
}

export function resetPartitionManager(): void {
  partitionManagerInstance = null;
}

export function createPartitionManager(
  config?: Partial<PartitionConfig>
): PartitionManager {
  return new PartitionManager(config);
}
