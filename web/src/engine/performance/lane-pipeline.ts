/**
 * Multi-Lane Streaming Pipeline
 * High-throughput chunk distribution across parallel lanes
 */

import type {
  LaneConfig,
  LaneState,
  ChunkDescriptor,
  ChunkStatus,
  FlowControlState,
} from './types';
import { getBufferPool, ZeroCopyBufferPool } from './buffer-pool';

// Lane processor handles one streaming lane
export class LaneProcessor {
  readonly id: number;
  private queue: ChunkDescriptor[] = [];
  private processing: ChunkDescriptor | null = null;
  private bufferPool: ZeroCopyBufferPool;
  private bytesProcessed = 0;
  private chunksProcessed = 0;
  private startTime = 0;
  private active = false;
  private priority: number;
  private maxQueueSize: number;

  // Callbacks
  private onChunkReady?: (chunk: ChunkDescriptor) => void;
  private onStateChange?: (state: LaneState) => void;

  constructor(config: LaneConfig) {
    this.id = config.id;
    this.priority = config.priority;
    this.maxQueueSize = Math.ceil(config.bufferSize / (64 * 1024 * 1024)); // Chunks based on 64MB
    this.bufferPool = getBufferPool();
  }

  /**
   * Enqueue a chunk for processing
   */
  enqueue(chunk: ChunkDescriptor): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      return false; // Backpressure
    }

    chunk.laneId = this.id;
    chunk.status = 'queued';
    chunk.timestamp = Date.now();
    this.queue.push(chunk);
    
    this.notifyStateChange();
    return true;
  }

  /**
   * Start processing the lane
   */
  start(): void {
    if (this.active) return;
    
    this.active = true;
    this.startTime = Date.now();
    this.processNext();
  }

  /**
   * Stop the lane
   */
  stop(): void {
    this.active = false;
  }

  /**
   * Process next chunk in queue
   */
  private async processNext(): Promise<void> {
    if (!this.active || this.processing) return;

    const chunk = this.queue.shift();
    if (!chunk) {
      // Queue empty, wait for more
      return;
    }

    this.processing = chunk;
    chunk.status = 'reading';
    this.notifyStateChange();

    try {
      // Simulate reading (in real impl, this reads from file)
      await this.readChunk(chunk);
      
      chunk.status = 'compressing';
      this.notifyStateChange();

      // Chunk is ready for compression worker
      if (this.onChunkReady) {
        this.onChunkReady(chunk);
      }

      this.bytesProcessed += chunk.length;
      this.chunksProcessed++;
      
    } catch (error) {
      chunk.status = 'failed';
    } finally {
      this.processing = null;
      this.notifyStateChange();
      
      // Continue with next chunk
      if (this.active) {
        // Use microtask to avoid stack overflow
        queueMicrotask(() => this.processNext());
      }
    }
  }

  /**
   * Read chunk data into buffer (placeholder - real impl uses File API)
   */
  private async readChunk(chunk: ChunkDescriptor): Promise<void> {
    // Acquire buffer from pool
    const acquired = this.bufferPool.acquire(chunk.length);
    if (!acquired) {
      throw new Error('Failed to acquire buffer from pool');
    }

    // In real implementation, read from file here
    // For now, buffer is ready - ensure we get a proper ArrayBuffer
    const viewBuffer = acquired.view.buffer;
    // TypeScript strict mode requires explicit type handling
    chunk.buffer = viewBuffer instanceof SharedArrayBuffer 
      ? new ArrayBuffer(acquired.view.byteLength)
      : (viewBuffer as ArrayBuffer);
  }

  /**
   * Mark chunk as completed
   */
  completeChunk(_chunkId: string, _compressedSize: number, _hash: string): void {
    // Release buffer back to pool if we have it tracked
    // The actual buffer management is handled by the coordinator
  }

  /**
   * Get current lane state
   */
  getState(): LaneState {
    const elapsed = Date.now() - this.startTime;
    const speed = elapsed > 0 ? (this.bytesProcessed / elapsed) * 1000 : 0;

    return {
      id: this.id,
      active: this.active,
      queueSize: this.queue.length,
      bytesProcessed: this.bytesProcessed,
      chunksProcessed: this.chunksProcessed,
      currentSpeed: speed,
      bufferUtilization: this.queue.length / this.maxQueueSize,
    };
  }

  /**
   * Set callback for when chunk is ready for compression
   */
  setOnChunkReady(callback: (chunk: ChunkDescriptor) => void): void {
    this.onChunkReady = callback;
  }

  /**
   * Set callback for state changes
   */
  setOnStateChange(callback: (state: LaneState) => void): void {
    this.onStateChange = callback;
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  /**
   * Check if lane can accept more chunks
   */
  canAccept(): boolean {
    return this.queue.length < this.maxQueueSize;
  }

  /**
   * Get queue depth
   */
  get queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Get priority
   */
  get lanePriority(): number {
    return this.priority;
  }
}

/**
 * Multi-lane coordinator
 * Distributes chunks across lanes with load balancing
 */
export class MultiLanePipeline {
  private lanes: LaneProcessor[] = [];
  private nextChunkId = 0;
  private flowControl: FlowControlState;
  private onLaneUpdate?: (lane: LaneState) => void;
  private onFlowControlUpdate?: (state: FlowControlState) => void;

  constructor(laneCount: number, bufferPerLane: number = 128 * 1024 * 1024) {
    // Create lanes with decreasing priority
    for (let i = 0; i < laneCount; i++) {
      const lane = new LaneProcessor({
        id: i,
        bufferSize: bufferPerLane,
        priority: laneCount - i,
      });
      this.lanes.push(lane);
    }

    this.flowControl = {
      backpressureActive: false,
      currentChunkSize: 64 * 1024 * 1024,
      targetChunkSize: 64 * 1024 * 1024,
      pendingChunks: 0,
      maxPendingChunks: laneCount * 4,
      throttleRatio: 1.0,
    };
  }

  /**
   * Start all lanes
   */
  start(): void {
    for (const lane of this.lanes) {
      lane.start();
    }
  }

  /**
   * Stop all lanes
   */
  stop(): void {
    for (const lane of this.lanes) {
      lane.stop();
    }
  }

  /**
   * Distribute a chunk to the best available lane
   */
  distributeChunk(offset: number, length: number): ChunkDescriptor | null {
    // Check flow control
    if (this.flowControl.backpressureActive) {
      return null;
    }

    // Find best lane (least loaded)
    let bestLane: LaneProcessor | null = null;
    let minQueue = Infinity;

    for (const lane of this.lanes) {
      if (lane.canAccept() && lane.queueDepth < minQueue) {
        bestLane = lane;
        minQueue = lane.queueDepth;
      }
    }

    if (!bestLane) {
      // All lanes full - activate backpressure
      this.setBackpressure(true);
      return null;
    }

    // Create chunk descriptor
    const chunk: ChunkDescriptor = {
      id: `chunk-${this.nextChunkId++}`,
      laneId: bestLane.id,
      offset,
      length,
      buffer: null,
      status: 'queued',
      timestamp: Date.now(),
    };

    // Enqueue to lane
    if (bestLane.enqueue(chunk)) {
      this.flowControl.pendingChunks++;
      this.checkFlowControl();
      return chunk;
    }

    return null;
  }

  /**
   * Set chunk ready callback for all lanes
   */
  setOnChunkReady(callback: (chunk: ChunkDescriptor) => void): void {
    for (const lane of this.lanes) {
      lane.setOnChunkReady(callback);
    }
  }

  /**
   * Set lane update callback
   */
  setOnLaneUpdate(callback: (lane: LaneState) => void): void {
    this.onLaneUpdate = callback;
    for (const lane of this.lanes) {
      lane.setOnStateChange(callback);
    }
  }

  /**
   * Mark chunk as completed
   */
  completeChunk(chunkId: string): void {
    this.flowControl.pendingChunks--;
    this.checkFlowControl();
  }

  /**
   * Check and update flow control state
   */
  private checkFlowControl(): void {
    const ratio = this.flowControl.pendingChunks / this.flowControl.maxPendingChunks;
    
    if (ratio > 0.9 && !this.flowControl.backpressureActive) {
      this.setBackpressure(true);
    } else if (ratio < 0.5 && this.flowControl.backpressureActive) {
      this.setBackpressure(false);
    }

    this.flowControl.throttleRatio = 1 - ratio;

    // Adaptive chunk sizing
    if (ratio > 0.7) {
      // Reduce chunk size to process faster
      this.flowControl.targetChunkSize = Math.max(
        8 * 1024 * 1024,
        this.flowControl.currentChunkSize * 0.8
      );
    } else if (ratio < 0.3) {
      // Increase chunk size for better throughput
      this.flowControl.targetChunkSize = Math.min(
        256 * 1024 * 1024,
        this.flowControl.currentChunkSize * 1.2
      );
    }

    // Gradually adjust current to target
    this.flowControl.currentChunkSize = 
      this.flowControl.currentChunkSize * 0.9 + 
      this.flowControl.targetChunkSize * 0.1;

    if (this.onFlowControlUpdate) {
      this.onFlowControlUpdate(this.flowControl);
    }
  }

  /**
   * Set backpressure state
   */
  private setBackpressure(active: boolean): void {
    this.flowControl.backpressureActive = active;
  }

  /**
   * Get all lane states
   */
  getLaneStates(): LaneState[] {
    return this.lanes.map(lane => lane.getState());
  }

  /**
   * Get flow control state
   */
  getFlowControl(): FlowControlState {
    return { ...this.flowControl };
  }

  /**
   * Get recommended chunk size
   */
  getRecommendedChunkSize(): number {
    return Math.round(this.flowControl.currentChunkSize);
  }

  /**
   * Check if pipeline can accept more data
   */
  canAccept(): boolean {
    return !this.flowControl.backpressureActive;
  }

  /**
   * Get total pending chunks across all lanes
   */
  get pendingChunks(): number {
    return this.flowControl.pendingChunks;
  }

  /**
   * Get lane count
   */
  get laneCount(): number {
    return this.lanes.length;
  }
}
