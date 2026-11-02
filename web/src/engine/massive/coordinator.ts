/**
 * SPK Hard Constraint Engine - Massive Job Coordinator
 * Creator: OJ Treasure Onazi
 * 
 * Multi-phase processing loop for massive jobs:
 * - Layer 1: Partition Input Files
 * - Layer 2: Stream & Chunk
 * - Layer 3: Compress → Write → Commit
 */

import {
  HARD_LIMITS,
  KB, MB, GB,
  type MassiveJob,
  type MassiveJobState,
  type MassiveJobConfig,
  type MassiveFileEntry,
  type Partition,
  type PartitionPlan,
  type Checkpoint,
  type ChunkMetadataEntry,
  type OffsetEntry,
  type OptimizerState,
  type MassiveJobEvent,
  type MassiveJobEventHandler,
  type ValidationResult,
  DEFAULT_MASSIVE_CONFIG,
} from './types';

import { getInputValidator, detectCompressionProfile } from './validator';
import { MassivePartitioner, createPartitioner } from './partitioner';
import { getMassiveMemoryManager, type MassiveMemoryManager } from './memory-manager';
import { getCheckpointManager, initializeCheckpointManager, type CheckpointManager } from './checkpoint';

// ============================================================================
// STREAMING FILE READER
// ============================================================================

class StreamingFileReader {
  private file: File;
  private chunkSize: number;
  private position = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(file: File, chunkSize: number) {
    this.file = file;
    this.chunkSize = chunkSize;
  }

  async *chunks(): AsyncGenerator<{ data: Uint8Array; index: number; isLast: boolean }> {
    const stream = this.file.stream();
    this.reader = stream.getReader();
    
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;
    
    try {
      while (true) {
        const { done, value } = await this.reader.read();
        
        if (done) {
          // Emit remaining buffer
          if (buffer.length > 0) {
            yield { data: buffer, index: chunkIndex, isLast: true };
          }
          break;
        }
        
        // Append to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
        
        // Emit full chunks
        while (buffer.length >= this.chunkSize) {
          const chunk = buffer.slice(0, this.chunkSize);
          buffer = buffer.slice(this.chunkSize);
          
          const isLast = buffer.length === 0;
          yield { data: chunk, index: chunkIndex++, isLast };
        }
      }
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
    }
  }

  cancel(): void {
    this.reader?.cancel();
  }
}

// ============================================================================
// SIMPLE COMPRESSOR (for coordinator - workers handle real compression)
// ============================================================================

class SimpleCompressor {
  private level: number;

  constructor(level: number = 6) {
    this.level = level;
  }

  async compress(data: Uint8Array): Promise<Uint8Array> {
    // LZ77 compression implementation
    const windowSize = this.level < 4 ? 256 : this.level < 7 ? 4096 : 32768;
    return this.lz77Compress(data, windowSize);
  }

  private lz77Compress(data: Uint8Array, windowSize: number): Uint8Array {
    const output: number[] = [];
    let pos = 0;

    while (pos < data.length) {
      let bestLength = 0;
      let bestOffset = 0;

      const searchStart = Math.max(0, pos - windowSize);
      const maxLength = Math.min(258, data.length - pos);

      for (let i = searchStart; i < pos; i++) {
        let length = 0;
        while (length < maxLength && data[i + length] === data[pos + length]) {
          length++;
        }
        if (length > bestLength) {
          bestLength = length;
          bestOffset = pos - i;
        }
      }

      if (bestLength >= 3) {
        output.push(0xFF);
        output.push((bestOffset >> 8) & 0xFF);
        output.push(bestOffset & 0xFF);
        output.push(bestLength);
        pos += bestLength;
      } else {
        if (data[pos] === 0xFF) {
          output.push(0xFF, 0x00, 0x00, 0x01);
        } else {
          output.push(data[pos]);
        }
        pos++;
      }
    }

    return new Uint8Array(output);
  }

  calculateChecksum(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return crc ^ 0xFFFFFFFF;
  }
}

// ============================================================================
// ARCHIVE WRITER
// ============================================================================

class StreamingArchiveWriter {
  private chunks: Uint8Array[] = [];
  private currentOffset: bigint = BigInt(64); // After header
  private metadataTable: ChunkMetadataEntry[] = [];
  private offsetTable: OffsetEntry[] = [];
  private totalOriginalSize = 0;
  private totalCompressedSize = 0;

  constructor() {
    // Reserve space for header
    this.chunks.push(new Uint8Array(64));
  }

  writeChunk(
    fileId: string,
    chunkIndex: number,
    compressed: Uint8Array,
    originalSize: number,
    checksum: number
  ): void {
    // Add to chunks
    this.chunks.push(compressed);
    
    // Record metadata
    this.metadataTable.push({
      chunkIndex,
      fileId,
      offset: this.currentOffset,
      compressedSize: compressed.length,
      originalSize,
      checksum,
    });
    
    // Record offset
    this.offsetTable.push({
      index: this.offsetTable.length,
      offset: this.currentOffset,
      length: BigInt(compressed.length),
      originalLength: BigInt(originalSize),
      fileId,
    });
    
    // Update offset
    this.currentOffset += BigInt(compressed.length);
    this.totalOriginalSize += originalSize;
    this.totalCompressedSize += compressed.length;
  }

  getCurrentOffset(): bigint {
    return this.currentOffset;
  }

  getMetadataTable(): ChunkMetadataEntry[] {
    return [...this.metadataTable];
  }

  getOffsetTable(): OffsetEntry[] {
    return [...this.offsetTable];
  }

  getTotalOriginalSize(): number {
    return this.totalOriginalSize;
  }

  getTotalCompressedSize(): number {
    return this.totalCompressedSize;
  }

  getCompressionRatio(): number {
    return this.totalOriginalSize > 0 
      ? this.totalCompressedSize / this.totalOriginalSize 
      : 1;
  }

  finalize(): Blob {
    // Write header
    const header = this.chunks[0];
    const view = new DataView(header.buffer);
    
    header[0] = 0x53; // S
    header[1] = 0x50; // P
    header[2] = 0x4B; // K
    header[3] = 0x00;
    view.setUint16(4, 50, true); // Version 50 (massive)
    view.setUint16(6, 0x0001, true); // Flags: multi-file
    view.setBigUint64(8, BigInt(this.totalOriginalSize), true);
    view.setBigUint64(16, BigInt(this.totalCompressedSize), true);
    view.setUint32(24, this.metadataTable.length, true);
    view.setBigUint64(40, BigInt(Date.now()), true);
    
    // Create footer
    const footer = this.createFooter();
    this.chunks.push(footer);
    
    return new Blob(this.chunks as unknown as BlobPart[], { type: 'application/x-spk' });
  }

  private createFooter(): Uint8Array {
    // Serialize offset table
    const offsetData = new Uint8Array(this.offsetTable.length * 32);
    const offsetView = new DataView(offsetData.buffer);
    
    for (let i = 0; i < this.offsetTable.length; i++) {
      const entry = this.offsetTable[i];
      const base = i * 32;
      offsetView.setUint32(base, entry.index, true);
      offsetView.setBigUint64(base + 8, entry.offset, true);
      offsetView.setBigUint64(base + 16, entry.length, true);
      offsetView.setBigUint64(base + 24, entry.originalLength, true);
    }
    
    // Footer structure
    const footerSize = 64 + offsetData.length;
    const footer = new Uint8Array(footerSize);
    const footerView = new DataView(footer.buffer);
    
    footer[0] = 0x45; // E
    footer[1] = 0x4E; // N
    footer[2] = 0x44; // D
    footer[3] = 0x00;
    footerView.setUint32(4, this.offsetTable.length, true);
    footerView.setBigUint64(8, BigInt(offsetData.length), true);
    footerView.setUint16(16, 50, true); // Version
    
    footer.set(offsetData, 64);
    
    return footer;
  }

  reset(): void {
    this.chunks = [new Uint8Array(64)];
    this.currentOffset = BigInt(64);
    this.metadataTable = [];
    this.offsetTable = [];
    this.totalOriginalSize = 0;
    this.totalCompressedSize = 0;
  }
}

// ============================================================================
// MASSIVE JOB COORDINATOR
// ============================================================================

export class MassiveJobCoordinator {
  private config: MassiveJobConfig;
  private validator = getInputValidator();
  private memoryManager: MassiveMemoryManager;
  private checkpointManager: CheckpointManager;
  
  // Current job state
  private job: MassiveJob | null = null;
  private partitioner: MassivePartitioner | null = null;
  private writer: StreamingArchiveWriter | null = null;
  private compressor: SimpleCompressor;
  private outputBlob: Blob | null = null;
  
  // Optimizer state
  private optimizerState: OptimizerState = {
    mode: 'massive',
    chunkSize: HARD_LIMITS.MASSIVE_DEFAULT_CHUNK,
    concurrency: 4,
    memoryPressure: 'low',
    throughputHistory: [],
    stallCount: 0,
  };
  
  // Event handlers
  private eventHandlers: MassiveJobEventHandler[] = [];
  
  // Processing state
  private cancelled = false;
  private paused = false;

  constructor(config: Partial<MassiveJobConfig> = {}) {
    this.config = { ...DEFAULT_MASSIVE_CONFIG, ...config };
    this.memoryManager = getMassiveMemoryManager(this.config);
    this.checkpointManager = getCheckpointManager(this.config);
    this.compressor = new SimpleCompressor(this.config.compressionLevel);
  }

  /**
   * Initialize coordinator
   */
  async initialize(): Promise<void> {
    await initializeCheckpointManager(this.config);
    
    // Set up memory pressure callbacks
    this.memoryManager.onPressureChanged((pressure) => {
      this.optimizerState.memoryPressure = pressure;
      this.emit({ type: 'memory-pressure', snapshot: this.memoryManager.getCurrentSnapshot() });
      
      if (pressure === 'high' || pressure === 'critical') {
        this.adjustForMemoryPressure();
      }
    });
    
    this.memoryManager.onRecoveryRequired((action) => {
      this.emit({ type: 'memory-recovery', action });
      this.executeRecoveryAction(action);
    });
  }

  /**
   * Register event handler
   */
  on(handler: MassiveJobEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit event
   */
  private emit(event: MassiveJobEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  /**
   * Validate files against hard constraints
   */
  validate(files: File[]): ValidationResult {
    this.emit({ type: 'validation-start' });
    const result = this.validator.validate(files);
    this.emit({ type: 'validation-complete', result });
    return result;
  }

  /**
   * Start massive job
   */
  async start(files: File[]): Promise<MassiveJob> {
    // Validate
    const validation = this.validate(files);
    if (!validation.valid) {
      throw new Error(validation.errors.map(e => e.message).join('; '));
    }
    
    // Create file entries
    const fileEntries = this.validator.createFileEntries(files);
    
    // Create job
    this.job = this.createJob(fileEntries, validation.stats.totalSize);
    this.job.state = 'partitioning';
    
    // Create partitioner
    this.partitioner = createPartitioner(fileEntries, this.config);
    const partitionPlan = this.partitioner.createPartitions();
    this.job.partitionPlan = partitionPlan;
    this.job.chunksTotal = partitionPlan.partitions.reduce((sum, p) => sum + p.chunksTotal, 0);
    
    this.emit({ type: 'partition-start', totalPartitions: partitionPlan.totalPartitions });
    
    // Create writer
    this.writer = new StreamingArchiveWriter();
    
    // Reset state
    this.cancelled = false;
    this.paused = false;
    
    // Start processing
    this.job.state = 'processing';
    this.job.startTime = Date.now();
    
    await this.processPartitions();
    
    return this.job;
  }

  /**
   * Resume from checkpoint
   */
  async resume(jobId: string): Promise<MassiveJob | null> {
    const checkpoint = await this.checkpointManager.loadLatest(jobId);
    if (!checkpoint) {
      return null;
    }
    
    this.emit({ type: 'checkpoint-restored', checkpoint });
    
    // Restore job state
    // Note: Files need to be re-provided as they can't be stored
    throw new Error('Resume requires files to be re-provided');
  }

  /**
   * Process all partitions
   */
  private async processPartitions(): Promise<void> {
    if (!this.job || !this.partitioner || !this.writer) {
      throw new Error('Job not initialized');
    }
    
    const totalPartitions = this.partitioner.getTotalPartitions();
    
    while (true) {
      // Check cancellation
      if (this.cancelled) {
        this.job.state = 'cancelled';
        this.emit({ type: 'job-cancelled' });
        return;
      }
      
      // Handle pause
      while (this.paused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (this.cancelled) {
          this.job.state = 'cancelled';
          this.emit({ type: 'job-cancelled' });
          return;
        }
      }
      
      // Get next partition
      const partition = this.partitioner.getNextPartition();
      if (!partition) break;
      
      this.emit({ 
        type: 'partition-progress', 
        partitionIndex: partition.index, 
        totalPartitions 
      });
      
      // Process partition
      await this.processPartition(partition);
      
      this.emit({ type: 'partition-complete', partition });
      
      // Update job progress
      this.job.currentPartitionIndex = partition.index + 1;
    }
    
    // Finalize
    await this.finalizeJob();
  }

  /**
   * Process single partition
   */
  private async processPartition(partition: Partition): Promise<void> {
    if (!this.job || !this.writer) {
      throw new Error('Job not initialized');
    }
    
    this.partitioner!.markProcessing(partition.id);
    this.emit({ type: 'processing-start', partition });
    
    const startOffset = this.writer.getCurrentOffset();
    
    // Process each file in partition
    for (const fileEntry of partition.files) {
      if (this.cancelled) return;
      
      await this.processFile(fileEntry, partition);
      
      this.job.filesProcessed++;
      this.emit({ type: 'file-complete', file: fileEntry });
    }
    
    // Update partition offsets
    const endOffset = this.writer.getCurrentOffset();
    const compressedSize = Number(endOffset - startOffset);
    this.partitioner!.updatePartitionOffsets(partition.id, startOffset, endOffset, compressedSize);
    this.partitioner!.markCompleted(partition.id);
    
    // Checkpoint after partition
    if (this.config.checkpointEnabled) {
      await this.saveCheckpoint();
    }
  }

  /**
   * Process single file
   */
  private async processFile(fileEntry: MassiveFileEntry, partition: Partition): Promise<void> {
    if (!this.job || !this.writer) {
      throw new Error('Job not initialized');
    }
    
    fileEntry.state = 'processing';
    
    // Detect compression profile
    const profile = detectCompressionProfile(fileEntry);
    
    // Adjust chunk size based on profile and memory
    const budget = this.memoryManager.getBudget();
    const chunkSize = Math.min(
      budget.recommendedChunkSize,
      this.optimizerState.chunkSize
    );
    
    // Stream file in chunks
    const reader = new StreamingFileReader(fileEntry.file, chunkSize);
    let localChunkIndex = 0;
    let compressedTotal = 0;
    
    for await (const { data, index, isLast } of reader.chunks()) {
      if (this.cancelled) {
        reader.cancel();
        return;
      }
      
      // Take memory snapshot
      this.memoryManager.takeSnapshot();
      
      // Compress chunk
      const compressed = await this.compressor.compress(data);
      const checksum = this.compressor.calculateChecksum(data);
      
      // Write to archive
      this.writer.writeChunk(
        fileEntry.id,
        localChunkIndex++,
        compressed,
        data.length,
        checksum
      );
      
      compressedTotal += compressed.length;
      
      // Update progress
      this.job.bytesProcessed += BigInt(data.length);
      this.job.chunksProcessed++;
      partition.chunksProcessed++;
      partition.bytesProcessed += data.length;
      
      this.emit({
        type: 'chunk-progress',
        chunkIndex: this.job.chunksProcessed,
        totalChunks: this.job.chunksTotal,
        bytesProcessed: this.job.bytesProcessed,
      });
      
      // Update throughput
      this.updateThroughput();
      
      // Checkpoint periodically
      if (this.job.chunksProcessed % 100 === 0 && this.config.checkpointEnabled) {
        await this.saveCheckpoint();
      }
    }
    
    // Update file stats
    fileEntry.state = 'completed';
    fileEntry.chunksTotal = localChunkIndex;
    fileEntry.chunksProcessed = localChunkIndex;
    fileEntry.compressedSize = compressedTotal;
    fileEntry.compressionRatio = compressedTotal / fileEntry.size;
  }

  /**
   * Finalize job and create archive
   */
  private async finalizeJob(): Promise<void> {
    if (!this.job || !this.writer) {
      throw new Error('Job not initialized');
    }
    
    this.job.state = 'finalizing';
    
    // Finalize archive and store the blob
    const blob = this.writer.finalize();
    this.outputBlob = blob;
    
    // Update job stats
    this.job.compressedSize = BigInt(blob.size);
    this.job.compressionRatio = Number(this.job.compressedSize) / this.job.totalSize;
    this.job.endTime = Date.now();
    this.job.state = 'completed';
    
    // Clean up checkpoints
    if (this.config.checkpointEnabled) {
      await this.checkpointManager.deleteJob(this.job.id);
    }
    
    this.emit({ type: 'job-complete', job: this.job });
  }

  /**
   * Save checkpoint
   */
  private async saveCheckpoint(): Promise<void> {
    if (!this.job || !this.partitioner || !this.writer) return;
    
    const checkpoint = await this.checkpointManager.save(
      this.job,
      this.partitioner.getPartitions(),
      this.writer.getMetadataTable(),
      this.writer.getOffsetTable(),
      this.optimizerState
    );
    
    if (checkpoint) {
      this.job.lastCheckpoint = checkpoint;
      this.job.checkpointCount++;
      this.emit({ type: 'checkpoint-saved', checkpoint });
    }
  }

  /**
   * Update throughput calculations
   */
  private updateThroughput(): void {
    if (!this.job) return;
    
    const elapsed = Date.now() - this.job.startTime;
    if (elapsed <= 0) return;
    
    const bytesProcessed = Number(this.job.bytesProcessed);
    const currentThroughput = (bytesProcessed / elapsed) * 1000;
    
    this.job.throughputBps = currentThroughput;
    this.job.peakThroughput = Math.max(this.job.peakThroughput, currentThroughput);
    
    // Update history
    this.optimizerState.throughputHistory.push(currentThroughput);
    if (this.optimizerState.throughputHistory.length > 100) {
      this.optimizerState.throughputHistory.shift();
    }
    
    // Calculate average
    this.job.avgThroughput = this.optimizerState.throughputHistory.reduce((a, b) => a + b, 0) 
      / this.optimizerState.throughputHistory.length;
    
    // Estimate completion
    const remaining = this.job.totalSize - bytesProcessed;
    const eta = remaining / this.job.avgThroughput * 1000;
    this.job.estimatedEndTime = Date.now() + eta;
    
    this.emit({
      type: 'throughput-update',
      bps: currentThroughput,
      eta,
    });
  }

  /**
   * Adjust for memory pressure
   */
  private adjustForMemoryPressure(): void {
    const budget = this.memoryManager.getBudget();
    
    if (budget.shouldReduceChunks) {
      this.optimizerState.chunkSize = budget.recommendedChunkSize;
    }
    
    this.optimizerState.concurrency = budget.recommendedConcurrency;
  }

  /**
   * Execute recovery action
   */
  private executeRecoveryAction(action: string): void {
    switch (action) {
      case 'flush_buffers':
        // Writer handles its own flushing
        break;
        
      case 'gc_wasm':
        // Request WASM GC
        break;
        
      case 'reduce_workers':
        this.optimizerState.concurrency = Math.max(
          HARD_LIMITS.MIN_WORKERS_MASSIVE,
          this.optimizerState.concurrency - 1
        );
        break;
        
      case 'reduce_chunks':
        this.optimizerState.chunkSize = Math.max(
          HARD_LIMITS.MASSIVE_MIN_CHUNK,
          Math.floor(this.optimizerState.chunkSize / 2)
        );
        break;
        
      case 'force_gc':
        this.memoryManager.requestGC();
        break;
    }
  }

  /**
   * Cancel current job
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Pause current job
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume paused job
   */
  unpause(): void {
    this.paused = false;
  }

  /**
   * Get current job
   */
  getJob(): MassiveJob | null {
    return this.job;
  }

  /**
   * Get progress
   */
  getProgress(): {
    bytesProcessed: bigint;
    totalBytes: number;
    percentage: number;
    filesProcessed: number;
    totalFiles: number;
    partitionsCompleted: number;
    totalPartitions: number;
    throughputBps: number;
    eta: number;
  } | null {
    if (!this.job) return null;
    
    return {
      bytesProcessed: this.job.bytesProcessed,
      totalBytes: this.job.totalSize,
      percentage: this.job.totalSize > 0 
        ? (Number(this.job.bytesProcessed) / this.job.totalSize) * 100 
        : 0,
      filesProcessed: this.job.filesProcessed,
      totalFiles: this.job.totalFiles,
      partitionsCompleted: this.partitioner?.getCompletedCount() || 0,
      totalPartitions: this.partitioner?.getTotalPartitions() || 0,
      throughputBps: this.job.throughputBps,
      eta: this.job.estimatedEndTime 
        ? this.job.estimatedEndTime - Date.now() 
        : 0,
    };
  }

  /**
   * Create job object
   */
  private createJob(files: MassiveFileEntry[], totalSize: number): MassiveJob {
    return {
      id: `massive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      state: 'idle',
      files,
      totalSize,
      totalFiles: files.length,
      currentPartitionIndex: 0,
      bytesProcessed: BigInt(0),
      chunksProcessed: 0,
      chunksTotal: 0,
      filesProcessed: 0,
      compressedSize: BigInt(0),
      compressionRatio: 0,
      startTime: 0,
      throughputBps: 0,
      peakThroughput: 0,
      avgThroughput: 0,
      checkpointCount: 0,
      historyId: `history_${Date.now()}`,
    };
  }

  /**
   * Reset coordinator
   */
  reset(): void {
    this.job = null;
    this.partitioner = null;
    this.writer = null;
    this.outputBlob = null;
    this.cancelled = false;
    this.paused = false;
    this.optimizerState = {
      mode: 'massive',
      chunkSize: HARD_LIMITS.MASSIVE_DEFAULT_CHUNK,
      concurrency: 4,
      memoryPressure: 'low',
      throughputHistory: [],
      stallCount: 0,
    };
    this.memoryManager.reset();
    this.checkpointManager.reset();
  }

  /**
   * Destroy coordinator
   */
  destroy(): void {
    this.cancel();
    this.reset();
    this.checkpointManager.close();
    this.eventHandlers = [];
  }

  /**
   * Get the output blob after job completion
   */
  getResult(): Blob | null {
    return this.outputBlob;
  }

  /**
   * Get the output as Uint8Array after job completion
   */
  async getResultAsBytes(): Promise<Uint8Array | null> {
    if (!this.outputBlob) return null;
    return new Uint8Array(await this.outputBlob.arrayBuffer());
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let coordinatorInstance: MassiveJobCoordinator | null = null;

export function getMassiveJobCoordinator(config?: Partial<MassiveJobConfig>): MassiveJobCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new MassiveJobCoordinator(config);
  }
  return coordinatorInstance;
}

export async function initializeMassiveJobCoordinator(config?: Partial<MassiveJobConfig>): Promise<MassiveJobCoordinator> {
  const coordinator = getMassiveJobCoordinator(config);
  await coordinator.initialize();
  return coordinator;
}

export function resetMassiveJobCoordinator(): void {
  coordinatorInstance?.destroy();
  coordinatorInstance = null;
}
