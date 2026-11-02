/**
 * SPK Micro-Optimization Layer - Coordinator Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 4: COORDINATOR OPTIMIZATION
 * - Pre-schedule chunk batches (3-10 chunks ahead per worker)
 * - Predictive chunk distribution (measure worker speed)
 * - Minimal pending queue management
 * - Pipeline overlap (reading → scheduling → processing → writing)
 * - Lock-free operations using atomic flags
 */

import type {
  CoordinatorOptimizationConfig,
  CoordinatorStats,
  ChunkBatch,
  ChunkInfo,
  WorkerPriority,
  SchedulingStrategy,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_COORDINATOR_CONFIG: CoordinatorOptimizationConfig = {
  preScheduleEnabled: true,
  preScheduleBatchSize: 5,
  predictiveEnabled: true,
  measureWorkerSpeed: true,
  weightByPerformance: true,
  minPendingQueue: 2,
  maxPendingQueue: 20,
  overlapReading: true,
  overlapScheduling: true,
  overlapWriting: true,
  useAtomicFlags: true,
  avoidMutexStructures: true,
  lockFreeQueues: true,
};

// ============================================================================
// ATOMIC FLAGS (Simulated with SharedArrayBuffer when available)
// ============================================================================

class AtomicFlag {
  private buffer: Int32Array;
  private useAtomics: boolean;

  constructor() {
    // Try to use SharedArrayBuffer for true atomics
    try {
      const sab = new SharedArrayBuffer(4);
      this.buffer = new Int32Array(sab);
      this.useAtomics = true;
    } catch {
      // Fallback to regular array
      this.buffer = new Int32Array(1);
      this.useAtomics = false;
    }
  }

  set(value: number): void {
    if (this.useAtomics) {
      Atomics.store(this.buffer, 0, value);
    } else {
      this.buffer[0] = value;
    }
  }

  get(): number {
    if (this.useAtomics) {
      return Atomics.load(this.buffer, 0);
    }
    return this.buffer[0];
  }

  compareAndSwap(expected: number, replacement: number): boolean {
    if (this.useAtomics) {
      return Atomics.compareExchange(this.buffer, 0, expected, replacement) === expected;
    }
    if (this.buffer[0] === expected) {
      this.buffer[0] = replacement;
      return true;
    }
    return false;
  }

  increment(): number {
    if (this.useAtomics) {
      return Atomics.add(this.buffer, 0, 1) + 1;
    }
    return ++this.buffer[0];
  }

  decrement(): number {
    if (this.useAtomics) {
      return Atomics.sub(this.buffer, 0, 1) - 1;
    }
    return --this.buffer[0];
  }
}

// ============================================================================
// LOCK-FREE QUEUE
// ============================================================================

class LockFreeQueue<T> {
  private items: T[] = [];
  private head = 0;
  private tail = 0;
  private capacity: number;
  private sizeFlag: AtomicFlag;

  constructor(capacity: number = 1024) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    this.sizeFlag = new AtomicFlag();
  }

  /**
   * Push item to queue
   */
  push(item: T): boolean {
    if (this.sizeFlag.get() >= this.capacity) {
      return false; // Queue full
    }

    const pos = this.tail % this.capacity;
    this.items[pos] = item;
    this.tail++;
    this.sizeFlag.increment();
    return true;
  }

  /**
   * Pop item from queue
   */
  pop(): T | undefined {
    if (this.sizeFlag.get() <= 0) {
      return undefined; // Queue empty
    }

    const pos = this.head % this.capacity;
    const item = this.items[pos];
    this.items[pos] = undefined as unknown as T;
    this.head++;
    this.sizeFlag.decrement();
    return item;
  }

  /**
   * Peek at front item
   */
  peek(): T | undefined {
    if (this.sizeFlag.get() <= 0) {
      return undefined;
    }
    return this.items[this.head % this.capacity];
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.sizeFlag.get();
  }

  /**
   * Check if empty
   */
  isEmpty(): boolean {
    return this.sizeFlag.get() === 0;
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.items = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.sizeFlag.set(0);
  }
}

// ============================================================================
// WORKER PERFORMANCE TRACKER
// ============================================================================

interface WorkerPerformance {
  workerId: string;
  avgProcessingTime: number;
  throughputBps: number;
  reliability: number;  // 0-1
  lastUpdateMs: number;
  samples: number;
  recentTimes: number[];
}

class WorkerPerformanceTracker {
  private performances: Map<string, WorkerPerformance> = new Map();
  private maxSamples = 50;

  /**
   * Record processing time for worker
   */
  recordTime(workerId: string, processingTimeMs: number, bytesProcessed: number): void {
    let perf = this.performances.get(workerId);
    
    if (!perf) {
      perf = {
        workerId,
        avgProcessingTime: processingTimeMs,
        throughputBps: bytesProcessed / processingTimeMs * 1000,
        reliability: 1.0,
        lastUpdateMs: Date.now(),
        samples: 0,
        recentTimes: [],
      };
      this.performances.set(workerId, perf);
    }

    // Update recent times
    perf.recentTimes.push(processingTimeMs);
    if (perf.recentTimes.length > this.maxSamples) {
      perf.recentTimes.shift();
    }

    // Calculate average
    perf.avgProcessingTime = 
      perf.recentTimes.reduce((a, b) => a + b, 0) / perf.recentTimes.length;

    // Update throughput (exponential moving average)
    const instantThroughput = bytesProcessed / processingTimeMs * 1000;
    perf.throughputBps = perf.throughputBps * 0.8 + instantThroughput * 0.2;

    perf.samples++;
    perf.lastUpdateMs = Date.now();
  }

  /**
   * Record worker failure
   */
  recordFailure(workerId: string): void {
    const perf = this.performances.get(workerId);
    if (perf) {
      perf.reliability = Math.max(0, perf.reliability - 0.1);
      perf.lastUpdateMs = Date.now();
    }
  }

  /**
   * Record worker success
   */
  recordSuccess(workerId: string): void {
    const perf = this.performances.get(workerId);
    if (perf) {
      perf.reliability = Math.min(1, perf.reliability + 0.02);
      perf.lastUpdateMs = Date.now();
    }
  }

  /**
   * Get performance for worker
   */
  getPerformance(workerId: string): WorkerPerformance | undefined {
    return this.performances.get(workerId);
  }

  /**
   * Get all performances sorted by throughput
   */
  getRankedWorkers(): WorkerPerformance[] {
    return Array.from(this.performances.values())
      .sort((a, b) => b.throughputBps * b.reliability - a.throughputBps * a.reliability);
  }

  /**
   * Get weight for worker (for weighted distribution)
   */
  getWeight(workerId: string): number {
    const perf = this.performances.get(workerId);
    if (!perf || perf.samples < 3) {
      return 1.0; // Default weight for new workers
    }

    // Weight based on throughput and reliability
    const maxThroughput = Math.max(
      ...Array.from(this.performances.values()).map(p => p.throughputBps)
    );

    const normalizedThroughput = maxThroughput > 0 
      ? perf.throughputBps / maxThroughput 
      : 1;

    return normalizedThroughput * perf.reliability;
  }

  /**
   * Get estimated processing time
   */
  estimateTime(workerId: string, bytes: number): number {
    const perf = this.performances.get(workerId);
    if (!perf || perf.throughputBps === 0) {
      return bytes / (100 * 1024 * 1024) * 1000; // Default: 100MB/s
    }
    return bytes / perf.throughputBps * 1000;
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.performances.clear();
  }
}

// ============================================================================
// CHUNK SCHEDULER
// ============================================================================

interface ScheduledChunk extends ChunkInfo {
  scheduledAt: number;
  targetWorkerId: string;
  batchId: string;
}

class ChunkScheduler {
  private pending: LockFreeQueue<ScheduledChunk>;
  private inFlight: Map<string, ScheduledChunk> = new Map();
  private completed: Set<string> = new Set();
  private performanceTracker: WorkerPerformanceTracker;
  private config: CoordinatorOptimizationConfig;
  private batchCounter = 0;
  private chunkCounter = 0;

  constructor(config: CoordinatorOptimizationConfig) {
    this.config = config;
    this.pending = new LockFreeQueue(config.maxPendingQueue * 2);
    this.performanceTracker = new WorkerPerformanceTracker();
  }

  /**
   * Schedule chunk for processing
   */
  scheduleChunk(
    offset: number,
    size: number,
    priority: WorkerPriority = 'normal',
    targetWorkerId?: string
  ): string {
    const chunkId = `chunk-${++this.chunkCounter}`;
    
    const chunk: ScheduledChunk = {
      chunkId,
      offset,
      size,
      priority,
      estimatedProcessTime: targetWorkerId 
        ? this.performanceTracker.estimateTime(targetWorkerId, size)
        : size / (100 * 1024 * 1024) * 1000,
      scheduledAt: Date.now(),
      targetWorkerId: targetWorkerId || '',
      batchId: '',
    };

    this.pending.push(chunk);
    return chunkId;
  }

  /**
   * Create batch for worker
   */
  createBatch(workerId: string, maxChunks?: number): ChunkBatch | null {
    const batchSize = maxChunks || this.config.preScheduleBatchSize;
    const chunks: ChunkInfo[] = [];

    for (let i = 0; i < batchSize; i++) {
      const chunk = this.pending.pop();
      if (!chunk) break;

      // Update target worker
      chunk.targetWorkerId = workerId;
      chunk.batchId = `batch-${++this.batchCounter}`;
      
      this.inFlight.set(chunk.chunkId, chunk);
      chunks.push(chunk);
    }

    if (chunks.length === 0) {
      return null;
    }

    const deadline = Date.now() + Math.max(...chunks.map(c => c.estimatedProcessTime)) * 2;

    return {
      batchId: `batch-${this.batchCounter}`,
      chunks,
      targetWorkerId: workerId,
      priority: chunks[0].priority,
      scheduledAt: Date.now(),
      deadline,
    };
  }

  /**
   * Mark chunk as completed
   */
  completeChunk(chunkId: string, processingTimeMs: number, bytesProcessed: number): void {
    const chunk = this.inFlight.get(chunkId);
    if (chunk) {
      this.performanceTracker.recordTime(
        chunk.targetWorkerId,
        processingTimeMs,
        bytesProcessed
      );
      this.performanceTracker.recordSuccess(chunk.targetWorkerId);
      
      this.inFlight.delete(chunkId);
      this.completed.add(chunkId);
    }
  }

  /**
   * Mark chunk as failed
   */
  failChunk(chunkId: string, requeue: boolean = true): void {
    const chunk = this.inFlight.get(chunkId);
    if (chunk) {
      this.performanceTracker.recordFailure(chunk.targetWorkerId);
      this.inFlight.delete(chunkId);

      if (requeue) {
        // Re-add to pending queue
        this.pending.push(chunk);
      }
    }
  }

  /**
   * Get best worker for next chunk
   */
  getBestWorker(availableWorkers: string[]): string | null {
    if (availableWorkers.length === 0) {
      return null;
    }

    if (!this.config.weightByPerformance) {
      // Simple round-robin
      return availableWorkers[0];
    }

    // Weight-based selection
    const weights = availableWorkers.map(id => ({
      id,
      weight: this.performanceTracker.getWeight(id),
    }));

    // Sort by weight descending
    weights.sort((a, b) => b.weight - a.weight);

    // Weighted random selection (faster workers get more work)
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;

    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) {
        return w.id;
      }
    }

    return weights[0].id;
  }

  /**
   * Get scheduling statistics
   */
  getStats(): {
    pending: number;
    inFlight: number;
    completed: number;
    workerPerformances: WorkerPerformance[];
  } {
    return {
      pending: this.pending.size(),
      inFlight: this.inFlight.size,
      completed: this.completed.size,
      workerPerformances: this.performanceTracker.getRankedWorkers(),
    };
  }

  /**
   * Check if can schedule more
   */
  canScheduleMore(): boolean {
    return this.pending.size() < this.config.maxPendingQueue;
  }

  /**
   * Check if has pending work
   */
  hasPendingWork(): boolean {
    return !this.pending.isEmpty() || this.inFlight.size > 0;
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.pending.size();
  }

  /**
   * Get in-flight count
   */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.pending.clear();
    this.inFlight.clear();
    this.completed.clear();
    this.performanceTracker.clear();
  }
}

// ============================================================================
// PIPELINE COORDINATOR
// ============================================================================

type PipelineStage = 'reading' | 'scheduling' | 'processing' | 'writing';

interface PipelineState {
  reading: boolean;
  scheduling: boolean;
  processing: boolean;
  writing: boolean;
  activeChunks: Map<PipelineStage, Set<string>>;
}

class PipelineCoordinator {
  private state: PipelineState;
  private config: CoordinatorOptimizationConfig;
  private stageFlags: Map<PipelineStage, AtomicFlag> = new Map();

  constructor(config: CoordinatorOptimizationConfig) {
    this.config = config;
    
    this.state = {
      reading: false,
      scheduling: false,
      processing: false,
      writing: false,
      activeChunks: new Map([
        ['reading', new Set()],
        ['scheduling', new Set()],
        ['processing', new Set()],
        ['writing', new Set()],
      ]),
    };

    // Initialize atomic flags for each stage
    for (const stage of ['reading', 'scheduling', 'processing', 'writing'] as PipelineStage[]) {
      this.stageFlags.set(stage, new AtomicFlag());
    }
  }

  /**
   * Enter pipeline stage
   */
  enterStage(stage: PipelineStage, chunkId: string): boolean {
    // Check overlap configuration
    if (stage === 'reading' && !this.config.overlapReading && this.state.reading) {
      return false;
    }
    if (stage === 'scheduling' && !this.config.overlapScheduling && this.state.scheduling) {
      return false;
    }
    if (stage === 'writing' && !this.config.overlapWriting && this.state.writing) {
      return false;
    }

    // Use atomic flag if enabled
    if (this.config.useAtomicFlags) {
      const flag = this.stageFlags.get(stage)!;
      flag.increment();
    }

    this.state[stage] = true;
    this.state.activeChunks.get(stage)!.add(chunkId);
    return true;
  }

  /**
   * Exit pipeline stage
   */
  exitStage(stage: PipelineStage, chunkId: string): void {
    this.state.activeChunks.get(stage)!.delete(chunkId);
    
    if (this.state.activeChunks.get(stage)!.size === 0) {
      this.state[stage] = false;
    }

    if (this.config.useAtomicFlags) {
      const flag = this.stageFlags.get(stage)!;
      flag.decrement();
    }
  }

  /**
   * Move chunk between stages
   */
  moveStage(chunkId: string, from: PipelineStage, to: PipelineStage): boolean {
    if (!this.enterStage(to, chunkId)) {
      return false;
    }
    this.exitStage(from, chunkId);
    return true;
  }

  /**
   * Get stage load
   */
  getStageLoad(stage: PipelineStage): number {
    return this.state.activeChunks.get(stage)!.size;
  }

  /**
   * Get pipeline efficiency
   */
  getEfficiency(): number {
    // Calculate how well the pipeline is utilized
    // Higher is better (more parallel stages active)
    let activeStages = 0;
    if (this.state.reading) activeStages++;
    if (this.state.scheduling) activeStages++;
    if (this.state.processing) activeStages++;
    if (this.state.writing) activeStages++;
    
    return activeStages / 4;
  }

  /**
   * Check if pipeline is idle
   */
  isIdle(): boolean {
    return !this.state.reading && 
           !this.state.scheduling && 
           !this.state.processing && 
           !this.state.writing;
  }

  /**
   * Get full state
   */
  getState(): PipelineState {
    return { ...this.state };
  }
}

// ============================================================================
// COORDINATOR OPTIMIZER
// ============================================================================

export class CoordinatorOptimizer {
  private config: CoordinatorOptimizationConfig;
  private scheduler: ChunkScheduler;
  private pipeline: PipelineCoordinator;
  private stats: CoordinatorStats;
  private startTime = 0;

  constructor(config: Partial<CoordinatorOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_COORDINATOR_CONFIG, ...config };
    this.scheduler = new ChunkScheduler(this.config);
    this.pipeline = new PipelineCoordinator(this.config);
    
    this.stats = {
      chunksScheduled: 0,
      chunksCompleted: 0,
      chunksPending: 0,
      chunksInFlight: 0,
      avgSchedulingLatency: 0,
      avgCompletionLatency: 0,
      workerUtilization: [],
      pipelineEfficiency: 0,
      starvationEvents: 0,
      backpressureEvents: 0,
    };
  }

  /**
   * Start coordination session
   */
  start(): void {
    this.startTime = Date.now();
    this.scheduler.clear();
  }

  /**
   * Schedule chunk for processing
   */
  scheduleChunk(
    offset: number,
    size: number,
    priority: WorkerPriority = 'normal'
  ): string | null {
    if (!this.scheduler.canScheduleMore()) {
      this.stats.backpressureEvents++;
      return null;
    }

    const chunkId = this.scheduler.scheduleChunk(offset, size, priority);
    this.stats.chunksScheduled++;
    this.stats.chunksPending = this.scheduler.getPendingCount();
    
    return chunkId;
  }

  /**
   * Get batch for worker
   */
  getBatchForWorker(workerId: string): ChunkBatch | null {
    if (this.scheduler.getPendingCount() < this.config.minPendingQueue) {
      this.stats.starvationEvents++;
    }

    const batch = this.scheduler.createBatch(workerId);
    
    if (batch) {
      this.stats.chunksInFlight = this.scheduler.getInFlightCount();
      this.stats.chunksPending = this.scheduler.getPendingCount();
    }

    return batch;
  }

  /**
   * Get best worker for next batch
   */
  selectWorker(availableWorkers: string[]): string | null {
    return this.scheduler.getBestWorker(availableWorkers);
  }

  /**
   * Mark chunk as completed
   */
  completeChunk(chunkId: string, processingTimeMs: number, bytesProcessed: number): void {
    this.scheduler.completeChunk(chunkId, processingTimeMs, bytesProcessed);
    this.stats.chunksCompleted++;
    this.stats.chunksInFlight = this.scheduler.getInFlightCount();
    
    // Update completion latency
    const latency = processingTimeMs;
    this.stats.avgCompletionLatency = 
      (this.stats.avgCompletionLatency * (this.stats.chunksCompleted - 1) + latency) / 
      this.stats.chunksCompleted;
  }

  /**
   * Mark chunk as failed
   */
  failChunk(chunkId: string, requeue: boolean = true): void {
    this.scheduler.failChunk(chunkId, requeue);
    this.stats.chunksInFlight = this.scheduler.getInFlightCount();
    this.stats.chunksPending = this.scheduler.getPendingCount();
  }

  /**
   * Enter pipeline stage
   */
  enterPipelineStage(stage: PipelineStage, chunkId: string): boolean {
    return this.pipeline.enterStage(stage, chunkId);
  }

  /**
   * Exit pipeline stage
   */
  exitPipelineStage(stage: PipelineStage, chunkId: string): void {
    this.pipeline.exitStage(stage, chunkId);
  }

  /**
   * Get coordination statistics
   */
  getStats(): CoordinatorStats {
    const schedulerStats = this.scheduler.getStats();
    
    return {
      ...this.stats,
      chunksPending: schedulerStats.pending,
      chunksInFlight: schedulerStats.inFlight,
      pipelineEfficiency: this.pipeline.getEfficiency(),
      workerUtilization: schedulerStats.workerPerformances.map(p => p.reliability),
    };
  }

  /**
   * Check if has work to do
   */
  hasWork(): boolean {
    return this.scheduler.hasPendingWork();
  }

  /**
   * Check if can accept more chunks
   */
  canAcceptChunks(): boolean {
    return this.scheduler.canScheduleMore();
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.scheduler.getPendingCount();
  }

  /**
   * Get configuration
   */
  getConfig(): CoordinatorOptimizationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CoordinatorOptimizationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset coordinator state
   */
  reset(): void {
    this.scheduler.clear();
    this.stats = {
      chunksScheduled: 0,
      chunksCompleted: 0,
      chunksPending: 0,
      chunksInFlight: 0,
      avgSchedulingLatency: 0,
      avgCompletionLatency: 0,
      workerUtilization: [],
      pipelineEfficiency: 0,
      starvationEvents: 0,
      backpressureEvents: 0,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let coordinatorInstance: CoordinatorOptimizer | null = null;

export function getCoordinatorOptimizer(
  config?: Partial<CoordinatorOptimizationConfig>
): CoordinatorOptimizer {
  if (!coordinatorInstance) {
    coordinatorInstance = new CoordinatorOptimizer(config);
  }
  return coordinatorInstance;
}

export function resetCoordinatorOptimizer(): void {
  if (coordinatorInstance) {
    coordinatorInstance.reset();
  }
  coordinatorInstance = null;
}
