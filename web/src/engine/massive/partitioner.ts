/**
 * SPK Hard Constraint Engine - Massive Partitioner
 * Creator: OJ Treasure Onazi
 * 
 * Partitions massive jobs (up to 10TB) into safe-size batches:
 * - 500MB - 2GB per partition
 * - State maintained between partitions
 * - Never loads all file streams at once
 */

import {
  HARD_LIMITS,
  MB, GB,
  type MassiveFileEntry,
  type Partition,
  type PartitionPlan,
  type MassiveJobConfig,
  DEFAULT_MASSIVE_CONFIG,
} from './types';

// ============================================================================
// PARTITIONER
// ============================================================================

export class MassivePartitioner {
  private files: MassiveFileEntry[];
  private config: MassiveJobConfig;
  private partitions: Partition[] = [];
  private currentIndex = 0;
  private totalSize = 0;

  constructor(files: MassiveFileEntry[], config: Partial<MassiveJobConfig> = {}) {
    this.files = [...files];
    this.config = { ...DEFAULT_MASSIVE_CONFIG, ...config };
    this.totalSize = files.reduce((sum, f) => sum + f.size, 0);
  }

  /**
   * Create partition plan for the job
   */
  createPartitions(): PartitionPlan {
    this.partitions = [];
    
    // Sort files by size (largest first for better distribution)
    const sortedFiles = [...this.files].sort((a, b) => b.size - a.size);
    
    // Determine strategy based on file distribution
    const strategy = this.determineStrategy(sortedFiles);
    
    switch (strategy) {
      case 'size-balanced':
        this.createSizeBalancedPartitions(sortedFiles);
        break;
      case 'file-balanced':
        this.createFileBalancedPartitions(sortedFiles);
        break;
      case 'adaptive':
        this.createAdaptivePartitions(sortedFiles);
        break;
    }
    
    // Calculate estimates
    const estimatedDuration = this.estimateDuration();
    
    return {
      partitions: this.partitions,
      totalPartitions: this.partitions.length,
      totalSize: this.totalSize,
      totalFiles: this.files.length,
      estimatedDuration,
      strategy,
    };
  }

  /**
   * Determine best partitioning strategy
   */
  private determineStrategy(files: MassiveFileEntry[]): 'size-balanced' | 'file-balanced' | 'adaptive' {
    if (files.length === 0) return 'size-balanced';
    
    const avgSize = this.totalSize / files.length;
    const maxSize = files[0].size;
    
    // If largest file is > partition size, need adaptive
    if (maxSize > this.config.partitionSize) {
      return 'adaptive';
    }
    
    // If files are roughly equal size, use file-balanced
    const sizeVariance = files.reduce((v, f) => v + Math.abs(f.size - avgSize), 0) / files.length;
    if (sizeVariance < avgSize * 0.5) {
      return 'file-balanced';
    }
    
    return 'size-balanced';
  }

  /**
   * Create partitions balanced by total size
   */
  private createSizeBalancedPartitions(files: MassiveFileEntry[]): void {
    let currentPartition = this.createEmptyPartition(0);
    let currentSize = 0;
    
    for (const file of files) {
      // Check if adding this file exceeds partition size
      if (currentSize + file.size > this.config.partitionSize && currentPartition.files.length > 0) {
        // Finalize current partition
        this.finalizePartition(currentPartition, currentSize);
        this.partitions.push(currentPartition);
        
        // Start new partition
        currentPartition = this.createEmptyPartition(this.partitions.length);
        currentSize = 0;
      }
      
      // Add file to current partition
      file.partitionId = currentPartition.id;
      currentPartition.files.push(file);
      currentSize += file.size;
    }
    
    // Add final partition if not empty
    if (currentPartition.files.length > 0) {
      this.finalizePartition(currentPartition, currentSize);
      this.partitions.push(currentPartition);
    }
  }

  /**
   * Create partitions balanced by file count
   */
  private createFileBalancedPartitions(files: MassiveFileEntry[]): void {
    // Calculate files per partition
    const targetPartitions = Math.ceil(this.totalSize / this.config.partitionSize);
    const filesPerPartition = Math.ceil(files.length / targetPartitions);
    
    for (let i = 0; i < files.length; i += filesPerPartition) {
      const partitionFiles = files.slice(i, i + filesPerPartition);
      const partition = this.createEmptyPartition(this.partitions.length);
      
      let partitionSize = 0;
      for (const file of partitionFiles) {
        file.partitionId = partition.id;
        partition.files.push(file);
        partitionSize += file.size;
      }
      
      this.finalizePartition(partition, partitionSize);
      this.partitions.push(partition);
    }
  }

  /**
   * Create adaptive partitions for mixed file sizes
   */
  private createAdaptivePartitions(files: MassiveFileEntry[]): void {
    const remainingFiles = [...files];
    
    while (remainingFiles.length > 0) {
      const partition = this.createEmptyPartition(this.partitions.length);
      let currentSize = 0;
      const targetSize = this.config.partitionSize;
      
      // First, handle any files larger than partition size
      const largeFileIndex = remainingFiles.findIndex(f => f.size > targetSize);
      if (largeFileIndex !== -1) {
        // Single large file gets its own partition
        const largeFile = remainingFiles.splice(largeFileIndex, 1)[0];
        largeFile.partitionId = partition.id;
        partition.files.push(largeFile);
        currentSize = largeFile.size;
        
        this.finalizePartition(partition, currentSize);
        this.partitions.push(partition);
        continue;
      }
      
      // Pack files using first-fit decreasing
      const indicesToRemove: number[] = [];
      
      for (let i = 0; i < remainingFiles.length; i++) {
        const file = remainingFiles[i];
        
        if (currentSize + file.size <= targetSize) {
          file.partitionId = partition.id;
          partition.files.push(file);
          currentSize += file.size;
          indicesToRemove.push(i);
        }
        
        // Stop if we're within 10% of target
        if (currentSize >= targetSize * 0.9) {
          break;
        }
      }
      
      // Remove added files from remaining
      for (let i = indicesToRemove.length - 1; i >= 0; i--) {
        remainingFiles.splice(indicesToRemove[i], 1);
      }
      
      if (partition.files.length > 0) {
        this.finalizePartition(partition, currentSize);
        this.partitions.push(partition);
      }
    }
  }

  /**
   * Create empty partition structure
   */
  private createEmptyPartition(index: number): Partition {
    return {
      id: `partition_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      index,
      files: [],
      totalSize: 0,
      state: 'pending',
      bytesProcessed: 0,
      chunksProcessed: 0,
      chunksTotal: 0,
      compressedSize: 0,
      startOffset: BigInt(0),
      endOffset: BigInt(0),
    };
  }

  /**
   * Finalize partition with calculated values
   */
  private finalizePartition(partition: Partition, totalSize: number): void {
    partition.totalSize = totalSize;
    
    // Estimate chunk count
    const chunkSize = this.config.chunkSize;
    partition.chunksTotal = partition.files.reduce(
      (total, file) => total + Math.ceil(file.size / chunkSize),
      0
    );
  }

  /**
   * Get next partition to process
   */
  getNextPartition(): Partition | null {
    if (this.currentIndex >= this.partitions.length) {
      return null;
    }
    return this.partitions[this.currentIndex++];
  }

  /**
   * Peek at next partition without advancing
   */
  peekNextPartition(): Partition | null {
    if (this.currentIndex >= this.partitions.length) {
      return null;
    }
    return this.partitions[this.currentIndex];
  }

  /**
   * Reset to start
   */
  reset(): void {
    this.currentIndex = 0;
    for (const partition of this.partitions) {
      partition.state = 'pending';
      partition.bytesProcessed = 0;
      partition.chunksProcessed = 0;
    }
  }

  /**
   * Resume from partition index
   */
  resumeFrom(partitionIndex: number): void {
    this.currentIndex = partitionIndex;
  }

  /**
   * Get all partitions
   */
  getPartitions(): Partition[] {
    return [...this.partitions];
  }

  /**
   * Get partition by ID
   */
  getPartition(id: string): Partition | undefined {
    return this.partitions.find(p => p.id === id);
  }

  /**
   * Get partition by index
   */
  getPartitionByIndex(index: number): Partition | undefined {
    return this.partitions[index];
  }

  /**
   * Get current partition index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get total partition count
   */
  getTotalPartitions(): number {
    return this.partitions.length;
  }

  /**
   * Check if all partitions completed
   */
  isComplete(): boolean {
    return this.partitions.every(p => p.state === 'completed');
  }

  /**
   * Get completed partition count
   */
  getCompletedCount(): number {
    return this.partitions.filter(p => p.state === 'completed').length;
  }

  /**
   * Estimate total duration
   */
  private estimateDuration(): number {
    // Estimate based on:
    // - 100MB/s baseline for generic content
    // - Adjust for compression overhead
    const baselineThroughput = 100 * MB;
    const compressionOverhead = 1.5; // 50% slower due to compression
    
    const effectiveThroughput = baselineThroughput / compressionOverhead;
    return (this.totalSize / effectiveThroughput) * 1000; // ms
  }

  /**
   * Update partition offsets after processing
   */
  updatePartitionOffsets(partitionId: string, startOffset: bigint, endOffset: bigint, compressedSize: number): void {
    const partition = this.getPartition(partitionId);
    if (partition) {
      partition.startOffset = startOffset;
      partition.endOffset = endOffset;
      partition.compressedSize = compressedSize;
    }
  }

  /**
   * Mark partition as processing
   */
  markProcessing(partitionId: string): void {
    const partition = this.getPartition(partitionId);
    if (partition) {
      partition.state = 'processing';
      partition.startTime = Date.now();
    }
  }

  /**
   * Mark partition as completed
   */
  markCompleted(partitionId: string): void {
    const partition = this.getPartition(partitionId);
    if (partition) {
      partition.state = 'completed';
      partition.endTime = Date.now();
    }
  }

  /**
   * Mark partition as failed
   */
  markFailed(partitionId: string, error: string): void {
    const partition = this.getPartition(partitionId);
    if (partition) {
      partition.state = 'failed';
      partition.endTime = Date.now();
    }
  }

  /**
   * Get progress summary
   */
  getProgress(): {
    completedPartitions: number;
    totalPartitions: number;
    bytesProcessed: number;
    totalBytes: number;
    percentage: number;
  } {
    const completedPartitions = this.getCompletedCount();
    const bytesProcessed = this.partitions
      .filter(p => p.state === 'completed')
      .reduce((sum, p) => sum + p.totalSize, 0);
    
    return {
      completedPartitions,
      totalPartitions: this.partitions.length,
      bytesProcessed,
      totalBytes: this.totalSize,
      percentage: this.totalSize > 0 ? (bytesProcessed / this.totalSize) * 100 : 0,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createPartitioner(
  files: MassiveFileEntry[],
  config?: Partial<MassiveJobConfig>
): MassivePartitioner {
  return new MassivePartitioner(files, config);
}
