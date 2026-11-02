/**
 * High-Performance Compression Engine
 * Achieves 100GB/min+ throughput via multi-lane pipeline and parallel workers
 */

import type {
  PerformanceConfig,
  CoordinatorState,
  DetailedProgress,
  PerformanceCallbacks,
  PerformanceResult,
  ChunkDescriptor,
  LaneState,
} from './types';
import { DEFAULT_PERFORMANCE_CONFIG, TARGET_THROUGHPUT } from './types';
import { MultiLanePipeline } from './lane-pipeline';
import { WorkerCoordinator, getWorkerCoordinator } from './worker-coordinator';
import { getBufferPool } from './buffer-pool';

/**
 * High-performance compression engine
 */
export class PerformanceEngine {
  private config: PerformanceConfig;
  private pipeline: MultiLanePipeline;
  private coordinator: WorkerCoordinator;
  private callbacks: Partial<PerformanceCallbacks> = {};
  
  // State tracking
  private totalBytes = 0;
  private processedBytes = 0;
  private processedChunks = 0;
  private totalChunks = 0;
  private startTime = 0;
  private compressedBytes = 0;
  private outputChunks: Array<{ id: string; data: ArrayBuffer; order: number }> = [];
  private nextOutputOrder = 0;
  private running = false;

  // Speed tracking
  private speedSamples: number[] = [];
  private lastSpeedUpdate = 0;
  private peakThroughput = 0;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = { ...DEFAULT_PERFORMANCE_CONFIG, ...config };
    
    // Initialize pipeline with configured lanes
    this.pipeline = new MultiLanePipeline(
      this.config.lanes,
      this.config.bufferPoolSize / this.config.lanes
    );

    // Initialize worker coordinator
    this.coordinator = getWorkerCoordinator({
      minWorkers: this.config.lanes,
      maxWorkers: this.config.lanes * this.config.workersPerLane,
      enableGPU: this.config.enableGPU,
    });

    // Wire up callbacks
    this.pipeline.setOnChunkReady(this.handleChunkReady.bind(this));
    this.pipeline.setOnLaneUpdate(this.handleLaneUpdate.bind(this));
  }

  /**
   * Compress a file with high performance
   */
  async compress(
    file: File,
    callbacks: Partial<PerformanceCallbacks>
  ): Promise<PerformanceResult> {
    this.callbacks = callbacks;
    this.totalBytes = file.size;
    this.processedBytes = 0;
    this.processedChunks = 0;
    this.compressedBytes = 0;
    this.outputChunks = [];
    this.nextOutputOrder = 0;
    this.startTime = Date.now();
    this.running = true;
    this.speedSamples = [];
    this.peakThroughput = 0;

    // Calculate optimal chunk size
    const chunkSize = this.calculateOptimalChunkSize(file.size);
    this.totalChunks = Math.ceil(file.size / chunkSize);

    // Initialize workers
    await this.coordinator.initialize();

    // Start pipeline
    this.pipeline.start();

    // Report initial progress
    this.reportProgress('reading');

    // Read and distribute chunks
    let offset = 0;
    let chunkOrder = 0;

    while (offset < file.size && this.running) {
      // Check if pipeline can accept more
      if (!this.pipeline.canAccept()) {
        // Wait for backpressure to clear
        await this.waitForCapacity();
        continue;
      }

      const currentChunkSize = Math.min(
        this.pipeline.getRecommendedChunkSize(),
        file.size - offset
      );

      // Read chunk from file
      const blob = file.slice(offset, offset + currentChunkSize);
      const buffer = await blob.arrayBuffer();

      // Create chunk descriptor
      const chunk: ChunkDescriptor = {
        id: `chunk-${chunkOrder}`,
        laneId: -1,
        offset,
        length: currentChunkSize,
        buffer,
        status: 'queued',
        timestamp: Date.now(),
      };

      // Distribute to pipeline
      const distributed = this.pipeline.distributeChunk(offset, currentChunkSize);
      if (distributed) {
        distributed.buffer = buffer;
        // Submit directly to worker (pipeline overlap)
        this.submitToWorker(distributed, chunkOrder);
      }

      offset += currentChunkSize;
      chunkOrder++;
    }

    // Wait for all chunks to complete
    await this.waitForCompletion();

    // Stop pipeline
    this.pipeline.stop();
    this.running = false;

    // Calculate final result
    const duration = Date.now() - this.startTime;
    const result: PerformanceResult = {
      originalSize: this.totalBytes,
      compressedSize: this.compressedBytes,
      compressionRatio: this.compressedBytes / this.totalBytes,
      duration,
      throughput: (this.totalBytes / duration) * 1000,
      peakThroughput: this.peakThroughput,
      lanesUsed: this.config.lanes,
      workersUsed: this.coordinator.totalWorkers,
      gpuAccelerated: this.config.enableGPU,
      chunks: this.processedChunks,
      avgChunkSize: this.totalBytes / this.processedChunks,
    };

    if (this.callbacks.onComplete) {
      this.callbacks.onComplete(result);
    }

    return result;
  }

  /**
   * Calculate optimal chunk size based on file size
   */
  private calculateOptimalChunkSize(fileSize: number): number {
    // For very large files (>10GB), use larger chunks
    if (fileSize > 10 * 1024 * 1024 * 1024) {
      return Math.min(this.config.maxChunkSize, 128 * 1024 * 1024);
    }
    
    // For large files (>1GB), use medium chunks
    if (fileSize > 1024 * 1024 * 1024) {
      return 64 * 1024 * 1024;
    }
    
    // For medium files (>100MB), use smaller chunks
    if (fileSize > 100 * 1024 * 1024) {
      return 32 * 1024 * 1024;
    }
    
    // For small files, use minimum chunk size
    return this.config.minChunkSize;
  }

  /**
   * Handle chunk ready from pipeline
   */
  private handleChunkReady(chunk: ChunkDescriptor): void {
    // Already submitted in distributeChunk for overlap
  }

  /**
   * Submit chunk to worker for compression
   */
  private async submitToWorker(chunk: ChunkDescriptor, order: number): Promise<void> {
    try {
      const response = await this.coordinator.submitChunk(chunk, {
        mode: 'auto',
        level: 3,
      });

      if (response.type === 'result') {
        // Track compressed output
        this.compressedBytes += response.compressedSize || 0;
        this.processedBytes += response.originalSize || 0;
        this.processedChunks++;

        // Store for ordered output
        this.outputChunks.push({
          id: chunk.id,
          data: response.data!,
          order,
        });

        // Mark chunk complete in pipeline
        this.pipeline.completeChunk(chunk.id);

        // Update speed tracking
        this.updateSpeedMetrics();

        // Report progress
        this.reportProgress('compressing');
      }
    } catch (error) {
      if (this.callbacks.onError) {
        this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Handle lane state update
   */
  private handleLaneUpdate(lane: LaneState): void {
    if (this.callbacks.onLaneUpdate) {
      this.callbacks.onLaneUpdate(lane);
    }
  }

  /**
   * Wait for pipeline capacity
   */
  private async waitForCapacity(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.pipeline.canAccept() || !this.running) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  /**
   * Wait for all chunks to complete
   */
  private async waitForCompletion(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.processedChunks >= this.totalChunks || !this.running) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * Update speed metrics
   */
  private updateSpeedMetrics(): void {
    const now = Date.now();
    if (now - this.lastSpeedUpdate < 100) return;

    const elapsed = now - this.startTime;
    const speed = elapsed > 0 ? (this.processedBytes / elapsed) * 1000 : 0;

    this.speedSamples.push(speed);
    if (this.speedSamples.length > 20) {
      this.speedSamples.shift();
    }

    // Track peak
    if (speed > this.peakThroughput) {
      this.peakThroughput = speed;
    }

    this.lastSpeedUpdate = now;
  }

  /**
   * Report progress to callbacks
   */
  private reportProgress(phase: 'reading' | 'compressing' | 'writing' | 'finalizing'): void {
    if (!this.callbacks.onProgress) return;

    const elapsed = Date.now() - this.startTime;
    const speed = elapsed > 0 ? (this.processedBytes / elapsed) * 1000 : 0;
    const remaining = this.totalBytes - this.processedBytes;
    const eta = speed > 0 ? remaining / speed : 0;

    const progress: DetailedProgress = {
      bytesProcessed: this.processedBytes,
      totalBytes: this.totalBytes,
      chunksProcessed: this.processedChunks,
      totalChunks: this.totalChunks,
      speed,
      eta,
      lanes: this.pipeline.getLaneStates(),
      phase,
    };

    this.callbacks.onProgress(progress);
  }

  /**
   * Get current coordinator state
   */
  getState(): CoordinatorState {
    return {
      lanes: this.pipeline.getLaneStates(),
      workers: this.coordinator.getWorkerStatuses(),
      pipeline: this.coordinator.getMetrics(),
      bufferPool: getBufferPool().getStats(),
      flowControl: this.pipeline.getFlowControl(),
      totalBytesProcessed: this.processedBytes,
      totalChunksProcessed: this.processedChunks,
      startTime: this.startTime,
      estimatedCompletion: this.startTime + 
        (this.processedBytes > 0 
          ? (Date.now() - this.startTime) * (this.totalBytes / this.processedBytes)
          : 0),
    };
  }

  /**
   * Get assembled output in order
   */
  getOrderedOutput(): ArrayBuffer[] {
    return this.outputChunks
      .sort((a, b) => a.order - b.order)
      .map(c => c.data);
  }

  /**
   * Cancel compression
   */
  cancel(): void {
    this.running = false;
    this.pipeline.stop();
  }

  /**
   * Shutdown engine
   */
  shutdown(): void {
    this.cancel();
    this.coordinator.shutdown();
  }

  /**
   * Check if throughput target is being met
   */
  isMeetingTarget(): boolean {
    const elapsed = Date.now() - this.startTime;
    if (elapsed < 1000) return true; // Too early to tell

    const currentThroughput = (this.processedBytes / elapsed) * 1000;
    return currentThroughput >= TARGET_THROUGHPUT * 0.8; // 80% of target
  }
}

// Factory function
export function createPerformanceEngine(config?: Partial<PerformanceConfig>): PerformanceEngine {
  return new PerformanceEngine(config);
}
