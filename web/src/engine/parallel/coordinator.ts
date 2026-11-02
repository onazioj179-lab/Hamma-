/**
 * SPK Ultra-Parallel Throughput Engine - Coordinator
 * Creator: OJ Treasure Onazi
 * 
 * Multi-lane coordination with lane spawning/killing, memory throttling,
 * safety enforcement, and event emission for maximum throughput.
 */

import {
  Lane,
  LaneStatus,
  WASMState,
  CoordinatorConfig,
  DEFAULT_COORDINATOR_CONFIG,
  ThroughputMode,
  ParallelEvent,
  ParallelEventHandler,
  MB,
  GB,
  ThroughputMetrics,
  getRecommendedLaneCount,
} from './types';
import { ParallelScheduler } from './scheduler';
import { WorkerProfiler } from './worker-profiler';
import { StreamManager } from './stream-manager';
import { ParallelWriter } from './parallel-writer';
import { ThroughputOptimizer } from './throughput-optimizer';

// ============================================================================
// SESSION & STATS TYPES
// ============================================================================

export interface ParallelSession {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  startTime: number;
  endTime?: number;
  totalChunks: number;
  completedChunks: number;
  bytesProcessed: bigint;
}

export interface ParallelStats {
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  bytesProcessed: bigint;
  totalBytes: bigint;
  startTime: number;
  elapsedTime: number;
  estimatedRemaining: number;
  activeLanes: number;
  peakLanes: number;
  throughput: number;
  peakThroughput: number;
}

// Extended event types for coordinator
export type CoordinatorEvent = ParallelEvent
  | { type: 'session-started'; sessionId: string }
  | { type: 'session-paused' }
  | { type: 'session-resumed' }
  | { type: 'session-cancelled'; sessionId: string }
  | { type: 'session-completed'; sessionId: string; stats: ParallelStats }
  | { type: 'lane-spawned'; laneId: string }
  | { type: 'lane-killed'; laneId: string }
  | { type: 'chunk-completed'; laneId: string; chunkId: string; duration: number; bytes: number }
  | { type: 'chunk-failed'; laneId: string; chunkId: string; error: string }
  | { type: 'status-update'; stats: ParallelStats }
  | { type: 'throttled-memory'; removed: number };

export type CoordinatorEventHandler = (event: CoordinatorEvent) => void;

// ============================================================================
// INTERNAL LANE TYPE
// ============================================================================

interface InternalLane extends Lane {
  /** Current chunk ID (null if idle) */
  currentChunkId: string | null;
  
  /** Is WASM warm */
  wasmWarm: boolean;
  
  /** Error count */
  errors: number;
}

// ============================================================================
// COORDINATOR STATE
// ============================================================================

interface CoordinatorState {
  session: ParallelSession | null;
  isRunning: boolean;
  isPaused: boolean;
  isStopping: boolean;
  lanes: Map<string, InternalLane>;
  stats: ParallelStats;
  startTime: number;
  lastStatusReport: number;
}

// ============================================================================
// SIMPLE COORDINATOR CONFIG
// ============================================================================

interface SimpleCoordinatorConfig {
  mode: ThroughputMode;
  maxLanes: number;
  minLanes: number;
  initialLanes: number;
  maxMemory: number;
  maxQueuedChunks: number;
  autoRebalance: boolean;
  memoryThrottle: number;
}

const DEFAULT_SIMPLE_CONFIG: SimpleCoordinatorConfig = {
  mode: 'balanced',
  maxLanes: 16,
  minLanes: 2,
  initialLanes: 4,
  maxMemory: 2 * GB,
  maxQueuedChunks: 50,
  autoRebalance: true,
  memoryThrottle: 0.85,
};

// ============================================================================
// PARALLEL COORDINATOR
// ============================================================================

export class ParallelCoordinator {
  private config: SimpleCoordinatorConfig;
  private state: CoordinatorState;
  private scheduler: ParallelScheduler;
  private profiler: WorkerProfiler;
  private streamManager: StreamManager;
  private writer: ParallelWriter;
  private optimizer: ThroughputOptimizer;
  private eventHandlers: Set<CoordinatorEventHandler> = new Set();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private workers: Map<string, Worker> = new Map();
  private chunkOffsets: Map<string, bigint> = new Map();
  private pendingChunks: Array<{ id: string; data: Uint8Array; offset: bigint }> = [];
  private retryCount: Map<string, number> = new Map();

  constructor(config: Partial<SimpleCoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_SIMPLE_CONFIG, ...config };
    
    this.state = this.createInitialState();

    // Initialize components
    this.scheduler = new ParallelScheduler();
    this.profiler = new WorkerProfiler();
    this.streamManager = new StreamManager();
    this.writer = new ParallelWriter();
    this.optimizer = new ThroughputOptimizer({
      mode: this.config.mode,
      maxMemory: this.config.maxMemory,
    });

    this.setupOptimizerEvents();
  }

  private createInitialState(): CoordinatorState {
    return {
      session: null,
      isRunning: false,
      isPaused: false,
      isStopping: false,
      lanes: new Map(),
      stats: this.createInitialStats(),
      startTime: 0,
      lastStatusReport: 0,
    };
  }

  private createInitialStats(): ParallelStats {
    return {
      totalChunks: 0,
      completedChunks: 0,
      failedChunks: 0,
      bytesProcessed: BigInt(0),
      totalBytes: BigInt(0),
      startTime: 0,
      elapsedTime: 0,
      estimatedRemaining: Infinity,
      activeLanes: 0,
      peakLanes: 0,
      throughput: 0,
      peakThroughput: 0,
    };
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: CoordinatorEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: CoordinatorEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: CoordinatorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  private setupOptimizerEvents(): void {
    this.optimizer.addEventListener((event) => {
      switch (event.type) {
        case 'scale-up':
          this.handleScaleUp(event.newLanes);
          break;
        case 'scale-down':
          this.handleScaleDown(event.removedLanes);
          break;
        case 'memory-pressure':
          this.handleMemoryPressure(event.current, event.limit);
          break;
        case 'saturation-warning':
          this.handleSaturationWarning(event.saturation);
          break;
      }
      // Forward to external handlers
      this.emit(event);
    });
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  async start(
    chunks: Array<{ id: string; data: Uint8Array; offset: bigint }>
  ): Promise<ParallelSession> {
    if (this.state.isRunning) {
      throw new Error('Coordinator is already running');
    }

    this.state = this.createInitialState();
    this.state.isRunning = true;
    this.state.startTime = performance.now();

    // Store chunks
    this.pendingChunks = [...chunks];
    for (const chunk of chunks) {
      this.chunkOffsets.set(chunk.id, chunk.offset);
    }

    // Create session
    const session: ParallelSession = {
      id: this.generateSessionId(),
      status: 'running',
      startTime: Date.now(),
      totalChunks: chunks.length,
      completedChunks: 0,
      bytesProcessed: BigInt(0),
    };
    this.state.session = session;

    // Initialize stats
    this.state.stats.totalChunks = chunks.length;
    this.state.stats.totalBytes = chunks.reduce(
      (sum, c) => sum + BigInt(c.data.length),
      BigInt(0)
    );
    this.state.stats.startTime = session.startTime;

    // Initialize components
    this.streamManager.initialize(
      chunks.length,
      new Map(chunks.map((c, i) => [i, c.data.length])),
      async (i) => chunks[i]?.data || new Uint8Array()
    );
    this.writer.initialize();
    this.optimizer.initialize(chunks.length, this.config.initialLanes);

    // Spawn initial lanes
    await this.spawnLanes(this.config.initialLanes);

    // Start monitoring
    this.startMonitoring();

    // Start processing
    this.processChunks();

    this.emit({ type: 'session-started', sessionId: session.id });

    return session;
  }

  async pause(): Promise<void> {
    if (!this.state.isRunning || this.state.isPaused) return;

    this.state.isPaused = true;
    
    // Update all processing lanes to idle
    for (const [laneId, lane] of this.state.lanes) {
      if (lane.status === 'active') {
        lane.status = 'idle';
      }
    }

    this.emit({ type: 'session-paused' });
  }

  async resume(): Promise<void> {
    if (!this.state.isRunning || !this.state.isPaused) return;

    this.state.isPaused = false;

    // Resume processing
    this.processChunks();

    this.emit({ type: 'session-resumed' });
  }

  async stop(): Promise<void> {
    if (!this.state.isRunning) return;

    this.state.isStopping = true;
    this.stopMonitoring();

    // Kill all lanes
    await this.killAllLanes();

    // Flush writer
    await this.writer.flush();

    // Update session
    if (this.state.session) {
      this.state.session.status = 'cancelled';
      this.state.session.endTime = Date.now();
    }

    this.state.isRunning = false;
    this.state.isStopping = false;

    this.emit({ 
      type: 'session-cancelled', 
      sessionId: this.state.session?.id || '' 
    });
  }

  // ==========================================================================
  // LANE MANAGEMENT
  // ==========================================================================

  private async spawnLanes(count: number): Promise<void> {
    const toSpawn = Math.min(
      count,
      this.config.maxLanes - this.state.lanes.size
    );

    for (let i = 0; i < toSpawn; i++) {
      const lane = this.createLane();
      this.state.lanes.set(lane.id, lane);
      
      // Create worker
      const worker = this.createWorker(lane.id);
      this.workers.set(lane.id, worker);

      this.emit({ type: 'lane-spawned', laneId: lane.id });
    }

    this.updateActiveLanes();
  }

  private createLane(): InternalLane {
    const id = this.generateLaneId();
    return {
      id,
      workerId: `worker-${id}`,
      status: 'idle',
      currentChunk: null,
      currentChunkId: null,
      chunksProcessed: 0,
      bytesProcessed: BigInt(0),
      averageTime: 0,
      stdDeviation: 0,
      stallCount: 0,
      retryCount: 0,
      wasmState: 'cold',
      memoryFootprint: 0,
      lastActivity: performance.now(),
      timeHistory: [],
      errorCount: 0,
      wasmWarm: false,
      errors: 0,
    };
  }

  private createWorker(laneId: string): Worker {
    // Create WASM worker
    const workerCode = `
      self.onmessage = async function(e) {
        const { type, chunk, laneId } = e.data;
        
        if (type === 'process') {
          try {
            // Simulate WASM processing
            const startTime = performance.now();
            
            // Compression simulation
            await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 5));
            
            const endTime = performance.now();
            
            self.postMessage({
              type: 'complete',
              laneId,
              chunkId: chunk.id,
              result: chunk.data,
              duration: endTime - startTime,
            });
          } catch (error) {
            self.postMessage({
              type: 'error',
              laneId,
              chunkId: chunk.id,
              error: error.message,
            });
          }
        } else if (type === 'warmup') {
          // WASM warmup
          await new Promise(resolve => setTimeout(resolve, 50));
          self.postMessage({ type: 'warmup-complete', laneId });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    worker.onmessage = (e) => this.handleWorkerMessage(e);
    worker.onerror = (e) => this.handleWorkerError(laneId, e);

    // Warmup WASM
    worker.postMessage({ type: 'warmup', laneId });

    return worker;
  }

  private handleWorkerMessage(e: MessageEvent): void {
    const { type, laneId, chunkId, result, duration, error } = e.data;

    const lane = this.state.lanes.get(laneId);
    if (!lane) return;

    switch (type) {
      case 'complete':
        this.handleChunkComplete(lane, chunkId, result, duration);
        break;
      case 'error':
        this.handleChunkError(lane, chunkId, error);
        break;
      case 'warmup-complete':
        lane.wasmWarm = true;
        lane.wasmState = 'warm';
        this.emit({ type: 'warmup-complete', laneId });
        break;
    }
  }

  private handleWorkerError(laneId: string, error: ErrorEvent): void {
    const lane = this.state.lanes.get(laneId);
    if (!lane) return;

    lane.errors++;
    lane.errorCount++;
    if (lane.errors >= 3) {
      this.killLane(laneId);
    }
  }

  private async killLane(laneId: string): Promise<void> {
    const lane = this.state.lanes.get(laneId);
    if (!lane) return;

    const worker = this.workers.get(laneId);
    if (worker) {
      worker.terminate();
      this.workers.delete(laneId);
    }

    // Return chunk to queue if processing
    if (lane.currentChunkId) {
      this.returnChunkToQueue(lane.currentChunkId);
    }

    this.state.lanes.delete(laneId);
    this.emit({ type: 'lane-killed', laneId });
    this.updateActiveLanes();
  }

  private async killAllLanes(): Promise<void> {
    for (const laneId of this.state.lanes.keys()) {
      await this.killLane(laneId);
    }
  }

  private returnChunkToQueue(chunkId: string): void {
    const offset = this.chunkOffsets.get(chunkId);
    // Would need to find the original chunk data - simplified for now
  }

  // ==========================================================================
  // CHUNK PROCESSING
  // ==========================================================================

  private async processChunks(): Promise<void> {
    if (this.state.isPaused || this.state.isStopping) return;

    // Assign chunks to idle lanes
    for (const [laneId, lane] of this.state.lanes) {
      if (lane.status === 'idle' && !this.state.isPaused && this.pendingChunks.length > 0) {
        const chunk = this.pendingChunks.shift();
        if (chunk) {
          this.assignChunkToLane(lane, chunk);
        }
      }
    }

    // Check if complete
    if (this.isComplete()) {
      await this.complete();
    }
  }

  private assignChunkToLane(
    lane: InternalLane,
    chunk: { id: string; data: Uint8Array; offset: bigint }
  ): void {
    lane.status = 'active';
    lane.currentChunkId = chunk.id;
    lane.lastActivity = performance.now();

    const worker = this.workers.get(lane.id);
    if (worker) {
      worker.postMessage({
        type: 'process',
        chunk,
        laneId: lane.id,
      });
    }

    this.scheduler.assignChunks(1);
    this.updateActiveLanes();
  }

  private handleChunkComplete(
    lane: InternalLane,
    chunkId: string,
    result: Uint8Array,
    duration: number
  ): void {
    // Update lane stats
    lane.status = 'idle';
    lane.currentChunkId = null;
    lane.currentChunk = null;
    lane.chunksProcessed++;
    lane.bytesProcessed += BigInt(result.length);
    lane.averageTime = (lane.averageTime * (lane.chunksProcessed - 1) + duration) / lane.chunksProcessed;
    lane.lastActivity = performance.now();
    lane.timeHistory.push(duration);
    if (lane.timeHistory.length > 50) lane.timeHistory.shift();

    // Update session stats
    if (this.state.session) {
      this.state.session.completedChunks++;
      this.state.session.bytesProcessed += BigInt(result.length);
    }

    this.state.stats.completedChunks++;
    this.state.stats.bytesProcessed += BigInt(result.length);

    // Profile
    this.profiler.recordSample(
      lane.id,
      duration,
      result.length,
      true
    );

    // Queue write
    const offset = this.chunkOffsets.get(chunkId) || BigInt(0);
    this.writer.enqueue(lane.chunksProcessed - 1, result, offset);

    // Optimizer
    this.optimizer.recordCompletion(result.length);

    this.emit({
      type: 'chunk-completed',
      laneId: lane.id,
      chunkId,
      duration,
      bytes: result.length,
    });

    // Continue processing
    this.processChunks();
  }

  private handleChunkError(lane: InternalLane, chunkId: string, error: string): void {
    lane.status = 'idle';
    lane.currentChunkId = null;
    lane.currentChunk = null;
    lane.errors++;
    lane.errorCount++;

    this.state.stats.failedChunks++;

    this.profiler.recordSample(
      lane.id,
      0,
      0,
      false
    );

    // Retry chunk
    const retries = this.retryCount.get(chunkId) || 0;
    if (retries < 3) {
      this.retryCount.set(chunkId, retries + 1);
      // Would need to re-add chunk to queue
    }

    this.emit({
      type: 'chunk-failed',
      laneId: lane.id,
      chunkId,
      error,
    });

    // Kill lane if too many errors
    if (lane.errors >= 3) {
      this.killLane(lane.id);
    }

    // Continue
    this.processChunks();
  }

  private isComplete(): boolean {
    return (
      this.pendingChunks.length === 0 &&
      Array.from(this.state.lanes.values()).every(l => l.status === 'idle')
    );
  }

  private async complete(): Promise<void> {
    this.stopMonitoring();

    // Flush remaining writes
    await this.writer.flush();

    // Update session
    if (this.state.session) {
      this.state.session.status = 'completed';
      this.state.session.endTime = Date.now();
    }

    this.state.isRunning = false;

    this.emit({
      type: 'session-completed',
      sessionId: this.state.session?.id || '',
      stats: this.getStats(),
    });
  }

  // ==========================================================================
  // SCALING HANDLERS
  // ==========================================================================

  private handleScaleUp(newLanes: number): void {
    const toAdd = newLanes - this.state.lanes.size;
    if (toAdd > 0) {
      this.spawnLanes(toAdd);
    }
  }

  private handleScaleDown(laneIds: string[]): void {
    for (const laneId of laneIds) {
      if (this.state.lanes.size > this.config.minLanes) {
        this.killLane(laneId);
      }
    }
  }

  private handleMemoryPressure(current: number, limit: number): void {
    // Reduce lanes to relieve memory
    const toRemove = Math.ceil(this.state.lanes.size * 0.2);
    let removed = 0;

    for (const [laneId, lane] of this.state.lanes) {
      if (removed >= toRemove) break;
      if (lane.status === 'idle' && this.state.lanes.size > this.config.minLanes) {
        this.killLane(laneId);
        removed++;
      }
    }

    this.emit({ type: 'throttled-memory', removed });
  }

  private handleSaturationWarning(saturation: number): void {
    // Check for stuck lanes
    const now = performance.now();
    for (const [laneId, lane] of this.state.lanes) {
      if (lane.status === 'active' && now - lane.lastActivity > 30000) {
        // Lane stuck for 30s, kill it
        this.killLane(laneId);
      }
    }
  }

  // ==========================================================================
  // MONITORING
  // ==========================================================================

  private startMonitoring(): void {
    // Status updates
    this.statusTimer = setInterval(() => {
      this.updateStats();
      this.emit({ type: 'status-update', stats: this.getStats() });
    }, 1000);

    // Memory monitor
    this.monitorTimer = setInterval(() => {
      this.checkMemory();
      this.rebalanceIfNeeded();
    }, 2000);
  }

  private stopMonitoring(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  private checkMemory(): void {
    const memory = this.getMemoryUsage();
    const pressure = memory / this.config.maxMemory;
    this.optimizer.setMemoryPressure(pressure);

    if (pressure > this.config.memoryThrottle) {
      this.throttle();
    }
  }

  private throttle(): void {
    // Reduce lanes
    this.handleMemoryPressure(this.getMemoryUsage(), this.config.maxMemory);
  }

  private rebalanceIfNeeded(): void {
    if (this.config.autoRebalance) {
      this.scheduler.rebalance();
    }
  }

  private getMemoryUsage(): number {
    if (typeof performance !== 'undefined' && (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory) {
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    }
    return 0;
  }

  private updateActiveLanes(): void {
    let active = 0;
    for (const lane of this.state.lanes.values()) {
      if (lane.status === 'active') active++;
    }
    this.state.stats.activeLanes = active;
    if (active > this.state.stats.peakLanes) {
      this.state.stats.peakLanes = active;
    }
    this.optimizer.setActiveLanes(active);
    this.optimizer.setTotalLanes(this.state.lanes.size);
  }

  private updateStats(): void {
    const now = performance.now();
    this.state.stats.elapsedTime = now - this.state.startTime;

    const metrics = this.optimizer.getMetrics();
    this.state.stats.throughput = metrics.currentThroughput;
    this.state.stats.peakThroughput = metrics.peakThroughput;
    this.state.stats.estimatedRemaining = metrics.estimatedCompletion;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateLaneId(): string {
    return `lane-${Math.random().toString(36).substring(2, 11)}`;
  }

  // ==========================================================================
  // PUBLIC GETTERS
  // ==========================================================================

  getSession(): ParallelSession | null {
    return this.state.session;
  }

  getStats(): ParallelStats {
    return { ...this.state.stats };
  }

  getLaneCount(): number {
    return this.state.lanes.size;
  }

  getActiveLaneCount(): number {
    return this.state.stats.activeLanes;
  }

  isRunning(): boolean {
    return this.state.isRunning;
  }

  isPaused(): boolean {
    return this.state.isPaused;
  }

  // ==========================================================================
  // MODE CONTROL
  // ==========================================================================

  setMode(mode: ThroughputMode): void {
    this.config.mode = mode;
    this.optimizer.setMode(mode);

    // Adjust lanes based on mode
    switch (mode) {
      case 'conservative':
        this.config.maxLanes = Math.max(2, Math.floor(this.config.maxLanes * 0.5));
        break;
      case 'balanced':
        // Default
        break;
      case 'aggressive':
        this.config.maxLanes = Math.floor(this.config.maxLanes * 1.5);
        break;
      case 'turbo':
        this.config.maxLanes = this.config.maxLanes * 2;
        break;
    }
  }

  getMode(): ThroughputMode {
    return this.config.mode;
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  async shutdown(): Promise<void> {
    await this.stop();
    
    this.optimizer.shutdown();
    this.scheduler.reset();
    this.profiler.reset();
    this.streamManager.reset();
    this.writer.reset();
    
    this.eventHandlers.clear();
    this.state = this.createInitialState();
    this.pendingChunks = [];
    this.chunkOffsets.clear();
    this.retryCount.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createParallelCoordinator(
  config?: Partial<SimpleCoordinatorConfig>
): ParallelCoordinator {
  return new ParallelCoordinator(config);
}

// ============================================================================
// QUICK API
// ============================================================================

export async function processInParallel(
  chunks: Array<{ id: string; data: Uint8Array; offset: bigint }>,
  options: {
    mode?: ThroughputMode;
    maxLanes?: number;
    onProgress?: (stats: ParallelStats) => void;
    onComplete?: (stats: ParallelStats) => void;
  } = {}
): Promise<ParallelStats> {
  const coordinator = createParallelCoordinator({
    mode: options.mode || 'balanced',
    maxLanes: options.maxLanes,
  });

  return new Promise((resolve, reject) => {
    coordinator.addEventListener((event) => {
      if (event.type === 'status-update') {
        options.onProgress?.(event.stats);
      } else if (event.type === 'session-completed') {
        options.onComplete?.(event.stats);
        resolve(event.stats);
      } else if (event.type === 'session-cancelled') {
        reject(new Error('Session cancelled'));
      }
    });

    coordinator.start(chunks).catch(reject);
  });
}
