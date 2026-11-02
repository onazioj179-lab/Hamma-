/**
 * SPK Implementation Blueprint - Chunk Scheduler
 * 
 * Manages chunk queues and dispatches work to available workers.
 * Implements priority queuing and load balancing.
 * 
 * @module core/pipeline/scheduler
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface Chunk {
  id: string;
  jobId: string;
  fileId: string;
  index: number;
  offset: number;
  size: number;
  data?: Uint8Array;
  priority: number;
  state: ChunkState;
  workerId?: number;
  attempts: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export type ChunkState = 
  | 'pending'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retry';

export interface SchedulerConfig {
  maxQueueSize: number;
  maxRetries: number;
  retryDelay: number;
  priorityLevels: number;
  loadBalancing: 'round-robin' | 'least-loaded' | 'adaptive';
}

export interface WorkerLoad {
  workerId: number;
  activeChunks: number;
  completedChunks: number;
  failedChunks: number;
  avgProcessingTime: number;
  currentThroughput: number;
}

export interface SchedulerStats {
  totalChunks: number;
  pendingChunks: number;
  processingChunks: number;
  completedChunks: number;
  failedChunks: number;
  retryChunks: number;
  avgWaitTime: number;
  avgProcessingTime: number;
}

// ============================================================================
// Chunk Scheduler
// ============================================================================

/**
 * Manages chunk scheduling and worker assignment.
 * Implements priority queuing and intelligent load balancing.
 */
export class ChunkScheduler {
  private queues: Map<number, Chunk[]> = new Map(); // Priority -> chunks
  private processingChunks: Map<string, Chunk> = new Map();
  private completedChunks: Set<string> = new Set();
  private workerLoads: Map<number, WorkerLoad> = new Map();
  private stats: SchedulerStats = {
    totalChunks: 0,
    pendingChunks: 0,
    processingChunks: 0,
    completedChunks: 0,
    failedChunks: 0,
    retryChunks: 0,
    avgWaitTime: 0,
    avgProcessingTime: 0,
  };

  constructor(private config: SchedulerConfig) {
    // Initialize priority queues
    for (let i = 0; i < config.priorityLevels; i++) {
      this.queues.set(i, []);
    }
  }

  /**
   * Schedule a chunk for processing.
   */
  async scheduleChunk(chunk: Chunk, jobId: string): Promise<void> {
    chunk.jobId = jobId;
    chunk.state = 'pending';
    chunk.attempts = 0;
    
    // Add to priority queue
    const priority = Math.min(chunk.priority, this.config.priorityLevels - 1);
    const queue = this.queues.get(priority)!;
    queue.push(chunk);
    
    this.stats.totalChunks++;
    this.stats.pendingChunks++;
  }

  /**
   * Get the next chunk for processing.
   */
  getNextChunk(workerId: number): Chunk | null {
    // Check priority queues from highest to lowest
    for (let priority = this.config.priorityLevels - 1; priority >= 0; priority--) {
      const queue = this.queues.get(priority)!;
      
      if (queue.length > 0) {
        const chunk = queue.shift()!;
        
        // Mark as processing
        chunk.state = 'processing';
        chunk.workerId = workerId;
        chunk.startedAt = Date.now();
        chunk.attempts++;
        
        this.processingChunks.set(chunk.id, chunk);
        this.stats.pendingChunks--;
        this.stats.processingChunks++;
        
        // Update worker load
        this.updateWorkerLoad(workerId, 'start');
        
        return chunk;
      }
    }
    
    return null;
  }

  /**
   * Mark a chunk as completed.
   */
  completeChunk(chunkId: string, workerId: number): void {
    const chunk = this.processingChunks.get(chunkId);
    if (!chunk) return;
    
    chunk.state = 'completed';
    chunk.completedAt = Date.now();
    
    this.processingChunks.delete(chunkId);
    this.completedChunks.add(chunkId);
    
    this.stats.processingChunks--;
    this.stats.completedChunks++;
    
    // Update worker load
    this.updateWorkerLoad(workerId, 'complete', chunk);
  }

  /**
   * Mark a chunk as failed and optionally retry.
   */
  failChunk(chunkId: string, workerId: number, _error: string): void {
    const chunk = this.processingChunks.get(chunkId);
    if (!chunk) return;
    
    this.processingChunks.delete(chunkId);
    this.stats.processingChunks--;
    
    // Check retry limit
    if (chunk.attempts < this.config.maxRetries) {
      // Retry with lower priority
      chunk.state = 'retry';
      chunk.priority = Math.max(0, chunk.priority - 1);
      
      const queue = this.queues.get(chunk.priority)!;
      queue.push(chunk);
      
      this.stats.retryChunks++;
      
      // Delay retry
      setTimeout(() => {
        chunk.state = 'pending';
      }, this.config.retryDelay);
      
    } else {
      // Failed permanently
      chunk.state = 'failed';
      this.stats.failedChunks++;
    }
    
    // Update worker load
    this.updateWorkerLoad(workerId, 'fail');
  }

  /**
   * Update worker load statistics.
   */
  private updateWorkerLoad(
    workerId: number,
    action: 'start' | 'complete' | 'fail',
    chunk?: Chunk
  ): void {
    let load = this.workerLoads.get(workerId);
    
    if (!load) {
      load = {
        workerId,
        activeChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        avgProcessingTime: 0,
        currentThroughput: 0,
      };
      this.workerLoads.set(workerId, load);
    }
    
    switch (action) {
      case 'start':
        load.activeChunks++;
        break;
        
      case 'complete':
        load.activeChunks--;
        load.completedChunks++;
        
        if (chunk && chunk.startedAt && chunk.completedAt) {
          const processingTime = chunk.completedAt - chunk.startedAt;
          
          // Update running average
          const totalCompleted = load.completedChunks;
          load.avgProcessingTime = 
            (load.avgProcessingTime * (totalCompleted - 1) + processingTime) / totalCompleted;
          
          // Update throughput (bytes per second)
          if (chunk.size) {
            load.currentThroughput = chunk.size / (processingTime / 1000);
          }
        }
        break;
        
      case 'fail':
        load.activeChunks--;
        load.failedChunks++;
        break;
    }
  }

  /**
   * Select best worker for next chunk based on load balancing strategy.
   */
  selectWorker(workerIds: number[]): number {
    switch (this.config.loadBalancing) {
      case 'round-robin':
        return this.selectRoundRobin(workerIds);
        
      case 'least-loaded':
        return this.selectLeastLoaded(workerIds);
        
      case 'adaptive':
        return this.selectAdaptive(workerIds);
        
      default:
        return workerIds[0];
    }
  }

  /**
   * Round-robin worker selection.
   */
  private selectRoundRobin(workerIds: number[]): number {
    const index = this.stats.totalChunks % workerIds.length;
    return workerIds[index];
  }

  /**
   * Select worker with least active chunks.
   */
  private selectLeastLoaded(workerIds: number[]): number {
    let minLoad = Infinity;
    let selectedWorker = workerIds[0];
    
    for (const workerId of workerIds) {
      const load = this.workerLoads.get(workerId);
      const activeChunks = load?.activeChunks ?? 0;
      
      if (activeChunks < minLoad) {
        minLoad = activeChunks;
        selectedWorker = workerId;
      }
    }
    
    return selectedWorker;
  }

  /**
   * Adaptive worker selection based on performance.
   */
  private selectAdaptive(workerIds: number[]): number {
    let bestScore = -Infinity;
    let selectedWorker = workerIds[0];
    
    for (const workerId of workerIds) {
      const load = this.workerLoads.get(workerId);
      
      if (!load) {
        return workerId; // Prefer unused workers
      }
      
      // Score based on throughput and load
      const throughputScore = load.currentThroughput / 1024 / 1024; // MB/s
      const loadPenalty = load.activeChunks * 10;
      const failurePenalty = load.failedChunks * 5;
      
      const score = throughputScore - loadPenalty - failurePenalty;
      
      if (score > bestScore) {
        bestScore = score;
        selectedWorker = workerId;
      }
    }
    
    return selectedWorker;
  }

  /**
   * Get worker load statistics.
   */
  getWorkerLoad(workerId: number): WorkerLoad | undefined {
    return this.workerLoads.get(workerId);
  }

  /**
   * Get all worker loads.
   */
  getAllWorkerLoads(): WorkerLoad[] {
    return Array.from(this.workerLoads.values());
  }

  /**
   * Get scheduler statistics.
   */
  getStats(): SchedulerStats {
    return { ...this.stats };
  }

  /**
   * Get pending queue size.
   */
  getQueueSize(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Clear all queues and reset state.
   */
  reset(): void {
    for (const queue of this.queues.values()) {
      queue.length = 0;
    }
    this.processingChunks.clear();
    this.completedChunks.clear();
    this.workerLoads.clear();
    
    this.stats = {
      totalChunks: 0,
      pendingChunks: 0,
      processingChunks: 0,
      completedChunks: 0,
      failedChunks: 0,
      retryChunks: 0,
      avgWaitTime: 0,
      avgProcessingTime: 0,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export default ChunkScheduler;
