/**
 * SPK Micro-Optimization Layer - Worker Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 3: WORKER OPTIMIZATION
 * - Persistent workers (never recreate per chunk)
 * - Transferable objects for all buffers
 * - Pre-load WASM before jobs begin
 * - Message batching (reduce event spam)
 * - Warm-up cycles for WASM JIT
 * - Dynamic worker count based on cores
 */

import type {
  WorkerOptimizationConfig,
  WorkerStats,
  WorkerPoolStats,
  WorkerState,
  WorkerPriority,
  MessageBatchStrategy,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_WORKER_CONFIG: WorkerOptimizationConfig = {
  persistentWorkers: true,
  neverRecreatePerChunk: true,
  useTransferables: true,
  transferableTypes: ['ArrayBuffer', 'MessagePort', 'ImageBitmap'],
  preloadWasm: true,
  wasmWarmupEnabled: true,
  warmupChunkCount: 3,
  warmupChunkSize: 64 * 1024,  // 64KB
  batchStrategy: 'adaptive',
  batchSize: 10,
  batchIntervalMs: 50,
  reduceEventSpam: true,
  workerCountStrategy: 'adaptive',
  compressionWorkerCount: 0,  // Will be set based on cores
  decompressionWorkerCount: 0,
  maxWorkers: 16,
  minWorkers: 2,
};

// ============================================================================
// WORKER MESSAGE TYPES
// ============================================================================

interface WorkerMessage {
  id: string;
  type: 'chunk' | 'batch' | 'warmup' | 'config' | 'gc' | 'terminate';
  data?: ArrayBuffer;
  chunks?: ArrayBuffer[];
  config?: Partial<WorkerOptimizationConfig>;
  priority?: WorkerPriority;
}

interface WorkerResponse {
  id: string;
  type: 'result' | 'progress' | 'error' | 'ready' | 'warmup-complete';
  data?: ArrayBuffer;
  results?: ArrayBuffer[];
  progress?: number;
  error?: string;
  stats?: {
    processTime: number;
    bytesProcessed: number;
  };
}

// ============================================================================
// MESSAGE BATCHER
// ============================================================================

class MessageBatcher {
  private queue: WorkerMessage[] = [];
  private timer: number | null = null;
  private config: { batchSize: number; intervalMs: number; strategy: MessageBatchStrategy };
  private onFlush: (messages: WorkerMessage[]) => void;
  private stats = {
    messagesSent: 0,
    batchesSent: 0,
    avgBatchSize: 0,
  };

  constructor(
    config: { batchSize: number; intervalMs: number; strategy: MessageBatchStrategy },
    onFlush: (messages: WorkerMessage[]) => void
  ) {
    this.config = config;
    this.onFlush = onFlush;
  }

  /**
   * Add message to batch
   */
  add(message: WorkerMessage): void {
    if (this.config.strategy === 'none') {
      // Send immediately
      this.onFlush([message]);
      this.stats.messagesSent++;
      this.stats.batchesSent++;
      return;
    }

    this.queue.push(message);

    // Check if should flush by count
    if (this.config.strategy === 'count' || this.config.strategy === 'adaptive') {
      if (this.queue.length >= this.config.batchSize) {
        this.flush();
        return;
      }
    }

    // Set timer for time-based batching
    if (this.config.strategy === 'time' || this.config.strategy === 'adaptive') {
      if (!this.timer) {
        this.timer = window.setTimeout(() => this.flush(), this.config.intervalMs);
      }
    }
  }

  /**
   * Force flush all pending messages
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    this.onFlush(batch);
    
    this.stats.messagesSent += batch.length;
    this.stats.batchesSent++;
    this.stats.avgBatchSize = this.stats.messagesSent / this.stats.batchesSent;
  }

  /**
   * Clear all pending messages
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
  }

  getStats() {
    return { ...this.stats };
  }
}

// ============================================================================
// OPTIMIZED WORKER WRAPPER
// ============================================================================

class OptimizedWorker {
  readonly id: string;
  private worker: Worker;
  private state: WorkerState = 'idle';
  private stats: WorkerStats;
  private pendingJobs: Map<string, { 
    resolve: (data: ArrayBuffer) => void;
    reject: (error: Error) => void;
    startTime: number;
  }> = new Map();
  private batcher: MessageBatcher;
  private jobCounter = 0;
  private config: WorkerOptimizationConfig;
  private wasmReady = false;
  private warmupComplete = false;

  constructor(
    id: string,
    workerUrl: URL,
    config: WorkerOptimizationConfig
  ) {
    this.id = id;
    this.config = config;
    
    this.stats = {
      workerId: id,
      state: 'idle',
      chunksProcessed: 0,
      bytesProcessed: 0,
      avgProcessingTime: 0,
      stallCount: 0,
      errorCount: 0,
      lastActivityMs: Date.now(),
      throughputBps: 0,
      cpuTime: 0,
      memoryUsage: 0,
    };

    // Create persistent worker
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.setupWorkerHandlers();

    // Setup message batcher
    this.batcher = new MessageBatcher(
      {
        batchSize: config.batchSize,
        intervalMs: config.batchIntervalMs,
        strategy: config.batchStrategy,
      },
      (messages) => this.sendBatch(messages)
    );
  }

  /**
   * Setup worker message handlers
   */
  private setupWorkerHandlers(): void {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      this.stats.lastActivityMs = Date.now();

      switch (response.type) {
        case 'ready':
          this.wasmReady = true;
          this.state = 'ready';
          break;

        case 'warmup-complete':
          this.warmupComplete = true;
          break;

        case 'result':
          this.handleResult(response);
          break;

        case 'progress':
          // Progress updates (batched, reduced spam)
          break;

        case 'error':
          this.handleError(response);
          break;
      }
    };

    this.worker.onerror = (error) => {
      console.error(`[Worker ${this.id}] Error:`, error);
      this.state = 'error';
      this.stats.errorCount++;
      
      // Reject all pending jobs
      for (const [jobId, job] of this.pendingJobs) {
        job.reject(new Error(`Worker error: ${error.message}`));
        this.pendingJobs.delete(jobId);
      }
    };
  }

  /**
   * Handle successful result
   */
  private handleResult(response: WorkerResponse): void {
    const job = this.pendingJobs.get(response.id);
    if (!job) return;

    const elapsed = performance.now() - job.startTime;
    this.stats.chunksProcessed++;
    
    if (response.data) {
      this.stats.bytesProcessed += response.data.byteLength;
      this.updateThroughput(response.data.byteLength, elapsed);
    }

    // Update average processing time
    this.stats.avgProcessingTime = 
      (this.stats.avgProcessingTime * (this.stats.chunksProcessed - 1) + elapsed) / 
      this.stats.chunksProcessed;

    this.pendingJobs.delete(response.id);
    this.state = this.pendingJobs.size > 0 ? 'busy' : 'ready';

    if (response.data) {
      job.resolve(response.data);
    }
  }

  /**
   * Handle error response
   */
  private handleError(response: WorkerResponse): void {
    const job = this.pendingJobs.get(response.id);
    if (job) {
      job.reject(new Error(response.error || 'Unknown worker error'));
      this.pendingJobs.delete(response.id);
    }
    this.stats.errorCount++;
    this.state = this.pendingJobs.size > 0 ? 'busy' : 'ready';
  }

  /**
   * Update throughput calculation
   */
  private updateThroughput(bytes: number, elapsedMs: number): void {
    const bps = (bytes / elapsedMs) * 1000;
    // Exponential moving average
    this.stats.throughputBps = this.stats.throughputBps * 0.8 + bps * 0.2;
  }

  /**
   * Initialize worker with WASM
   */
  async initialize(): Promise<void> {
    if (this.config.preloadWasm) {
      this.state = 'warming';
      
      // Send init message
      this.worker.postMessage({
        id: 'init',
        type: 'config',
        config: this.config,
      });

      // Wait for ready
      await this.waitForState('ready', 10000);

      // Perform warmup if enabled
      if (this.config.wasmWarmupEnabled) {
        await this.performWarmup();
      }
    }

    this.state = 'ready';
  }

  /**
   * Perform JIT warmup
   */
  private async performWarmup(): Promise<void> {
    const warmupData = new Uint8Array(this.config.warmupChunkSize);
    
    for (let i = 0; i < this.config.warmupChunkCount; i++) {
      // Fill with varying data
      for (let j = 0; j < warmupData.length; j++) {
        warmupData[j] = (i * 37 + j) & 0xFF;
      }
      
      try {
        await this.processChunk(warmupData.buffer, 'low');
      } catch {
        // Warmup failures are non-fatal
      }
    }

    this.warmupComplete = true;
  }

  /**
   * Wait for specific state
   */
  private waitForState(targetState: WorkerState, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === targetState) {
        resolve();
        return;
      }

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (this.state === targetState) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for worker state: ${targetState}`));
        }
      }, 50);
    });
  }

  /**
   * Process a chunk
   */
  async processChunk(data: ArrayBuffer, priority: WorkerPriority = 'normal'): Promise<ArrayBuffer> {
    if (this.state === 'error') {
      throw new Error('Worker is in error state');
    }

    const jobId = `${this.id}-${++this.jobCounter}`;
    
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(jobId, {
        resolve,
        reject,
        startTime: performance.now(),
      });

      this.state = 'busy';

      const message: WorkerMessage = {
        id: jobId,
        type: 'chunk',
        data,
        priority,
      };

      if (this.config.reduceEventSpam) {
        this.batcher.add(message);
      } else {
        this.sendMessage(message);
      }
    });
  }

  /**
   * Send message with transferables
   */
  private sendMessage(message: WorkerMessage): void {
    const transferables: Transferable[] = [];

    if (this.config.useTransferables && message.data) {
      transferables.push(message.data);
    }

    this.worker.postMessage(message, transferables);
  }

  /**
   * Send batch of messages
   */
  private sendBatch(messages: WorkerMessage[]): void {
    if (messages.length === 1) {
      this.sendMessage(messages[0]);
      return;
    }

    const transferables: Transferable[] = [];
    const chunks: ArrayBuffer[] = [];

    for (const msg of messages) {
      if (msg.data) {
        chunks.push(msg.data);
        if (this.config.useTransferables) {
          transferables.push(msg.data);
        }
      }
    }

    const batchMessage: WorkerMessage = {
      id: `batch-${Date.now()}`,
      type: 'batch',
      chunks,
    };

    this.worker.postMessage(batchMessage, transferables);
  }

  /**
   * Get worker state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get worker statistics
   */
  getStats(): WorkerStats {
    return {
      ...this.stats,
      state: this.state,
    };
  }

  /**
   * Check if worker is available
   */
  isAvailable(): boolean {
    return this.state === 'ready' || this.state === 'idle';
  }

  /**
   * Get pending job count
   */
  getPendingCount(): number {
    return this.pendingJobs.size;
  }

  /**
   * Force flush pending messages
   */
  flush(): void {
    this.batcher.flush();
  }

  /**
   * Trigger garbage collection
   */
  gc(): void {
    this.worker.postMessage({ id: 'gc', type: 'gc' });
  }

  /**
   * Terminate worker
   */
  terminate(): void {
    this.batcher.clear();
    this.worker.terminate();
    this.state = 'idle';
    
    // Reject all pending jobs
    for (const [, job] of this.pendingJobs) {
      job.reject(new Error('Worker terminated'));
    }
    this.pendingJobs.clear();
  }
}

// ============================================================================
// WORKER POOL OPTIMIZER
// ============================================================================

export class WorkerPoolOptimizer {
  private config: WorkerOptimizationConfig;
  private workers: Map<string, OptimizedWorker> = new Map();
  private workerUrl: URL;
  private roundRobinIndex = 0;
  private initialized = false;
  private coreCount: number;

  constructor(workerUrl: URL, config: Partial<WorkerOptimizationConfig> = {}) {
    this.workerUrl = workerUrl;
    this.coreCount = navigator.hardwareConcurrency || 4;
    
    // Calculate worker counts based on cores
    const defaultCompressionWorkers = Math.max(2, this.coreCount - 1);
    const defaultDecompressionWorkers = this.coreCount;

    this.config = {
      ...DEFAULT_WORKER_CONFIG,
      compressionWorkerCount: defaultCompressionWorkers,
      decompressionWorkerCount: defaultDecompressionWorkers,
      ...config,
    };
  }

  /**
   * Initialize worker pool
   */
  async initialize(mode: 'compression' | 'decompression' = 'compression'): Promise<void> {
    if (this.initialized) return;

    const workerCount = mode === 'compression' 
      ? this.config.compressionWorkerCount 
      : this.config.decompressionWorkerCount;

    const actualCount = Math.min(
      Math.max(workerCount, this.config.minWorkers),
      this.config.maxWorkers
    );

    console.log(`[WorkerPool] Initializing ${actualCount} workers for ${mode}`);

    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < actualCount; i++) {
      const workerId = `worker-${i}`;
      const worker = new OptimizedWorker(workerId, this.workerUrl, this.config);
      this.workers.set(workerId, worker);
      initPromises.push(worker.initialize());
    }

    await Promise.all(initPromises);
    this.initialized = true;

    console.log(`[WorkerPool] ${this.workers.size} workers ready`);
  }

  /**
   * Get next worker (round-robin with load awareness)
   */
  private getNextWorker(): OptimizedWorker {
    const workerList = Array.from(this.workers.values());
    
    // Try to find an available worker
    for (const worker of workerList) {
      if (worker.isAvailable()) {
        return worker;
      }
    }

    // Fall back to least loaded
    let minPending = Infinity;
    let bestWorker = workerList[0];

    for (const worker of workerList) {
      const pending = worker.getPendingCount();
      if (pending < minPending) {
        minPending = pending;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  /**
   * Get least loaded worker
   */
  getLeastLoadedWorker(): OptimizedWorker | null {
    let minLoad = Infinity;
    let bestWorker: OptimizedWorker | null = null;

    for (const worker of this.workers.values()) {
      const stats = worker.getStats();
      const load = worker.getPendingCount() + (stats.stallCount * 0.5);
      
      if (load < minLoad && worker.getState() !== 'error') {
        minLoad = load;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  /**
   * Get worker by performance ranking
   */
  getFastestWorker(): OptimizedWorker | null {
    let maxThroughput = -1;
    let bestWorker: OptimizedWorker | null = null;

    for (const worker of this.workers.values()) {
      const stats = worker.getStats();
      
      if (stats.throughputBps > maxThroughput && worker.isAvailable()) {
        maxThroughput = stats.throughputBps;
        bestWorker = worker;
      }
    }

    return bestWorker || this.getLeastLoadedWorker();
  }

  /**
   * Process chunk with automatic worker selection
   */
  async processChunk(
    data: ArrayBuffer,
    priority: WorkerPriority = 'normal'
  ): Promise<ArrayBuffer> {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized');
    }

    const worker = this.getNextWorker();
    return worker.processChunk(data, priority);
  }

  /**
   * Process multiple chunks with load balancing
   */
  async processChunks(
    chunks: ArrayBuffer[],
    priority: WorkerPriority = 'normal'
  ): Promise<ArrayBuffer[]> {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized');
    }

    const promises = chunks.map((chunk) => {
      const worker = this.getNextWorker();
      return worker.processChunk(chunk, priority);
    });

    return Promise.all(promises);
  }

  /**
   * Get pool statistics
   */
  getStats(): WorkerPoolStats {
    const workers = Array.from(this.workers.values());
    const workerStats = workers.map(w => w.getStats());

    let totalChunks = 0;
    let totalBytes = 0;
    let totalThroughput = 0;
    let activeCount = 0;
    let idleCount = 0;
    let stalledCount = 0;

    for (const stats of workerStats) {
      totalChunks += stats.chunksProcessed;
      totalBytes += stats.bytesProcessed;
      totalThroughput += stats.throughputBps;

      switch (stats.state) {
        case 'busy':
          activeCount++;
          break;
        case 'idle':
        case 'ready':
          idleCount++;
          break;
        case 'stalled':
          stalledCount++;
          break;
      }
    }

    // Calculate load balance (variance in throughput)
    const avgThroughput = totalThroughput / workers.length;
    let variance = 0;
    for (const stats of workerStats) {
      variance += Math.pow(stats.throughputBps - avgThroughput, 2);
    }
    variance /= workers.length;
    const stdDev = Math.sqrt(variance);
    const loadBalance = avgThroughput > 0 ? 1 - (stdDev / avgThroughput) : 1;

    return {
      totalWorkers: workers.length,
      activeWorkers: activeCount,
      idleWorkers: idleCount,
      stalledWorkers: stalledCount,
      totalChunksProcessed: totalChunks,
      totalBytesProcessed: totalBytes,
      avgThroughputBps: avgThroughput,
      loadBalance: Math.max(0, Math.min(1, loadBalance)),
    };
  }

  /**
   * Get individual worker stats
   */
  getWorkerStats(): WorkerStats[] {
    return Array.from(this.workers.values()).map(w => w.getStats());
  }

  /**
   * Get configuration
   */
  getConfig(): WorkerOptimizationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WorkerOptimizationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Scale workers up or down
   */
  async scaleWorkers(targetCount: number): Promise<void> {
    const clampedCount = Math.min(
      Math.max(targetCount, this.config.minWorkers),
      this.config.maxWorkers
    );

    const currentCount = this.workers.size;

    if (clampedCount > currentCount) {
      // Scale up
      for (let i = currentCount; i < clampedCount; i++) {
        const workerId = `worker-${i}`;
        const worker = new OptimizedWorker(workerId, this.workerUrl, this.config);
        this.workers.set(workerId, worker);
        await worker.initialize();
      }
    } else if (clampedCount < currentCount) {
      // Scale down (remove least active workers)
      const workerList = Array.from(this.workers.entries())
        .sort((a, b) => a[1].getStats().lastActivityMs - b[1].getStats().lastActivityMs);

      for (let i = 0; i < currentCount - clampedCount; i++) {
        const [workerId, worker] = workerList[i];
        worker.terminate();
        this.workers.delete(workerId);
      }
    }
  }

  /**
   * Flush all worker message queues
   */
  flushAll(): void {
    for (const worker of this.workers.values()) {
      worker.flush();
    }
  }

  /**
   * Trigger GC on all workers
   */
  gcAll(): void {
    for (const worker of this.workers.values()) {
      worker.gc();
    }
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers.values()) {
      worker.terminate();
    }
    this.workers.clear();
    this.initialized = false;
  }

  /**
   * Get available worker count
   */
  getAvailableWorkerCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.isAvailable()) count++;
    }
    return count;
  }

  /**
   * Check if pool is ready
   */
  isReady(): boolean {
    return this.initialized && this.workers.size > 0;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let workerPoolInstance: WorkerPoolOptimizer | null = null;

export function getWorkerPoolOptimizer(
  workerUrl?: URL,
  config?: Partial<WorkerOptimizationConfig>
): WorkerPoolOptimizer {
  if (!workerPoolInstance && workerUrl) {
    workerPoolInstance = new WorkerPoolOptimizer(workerUrl, config);
  }
  if (!workerPoolInstance) {
    throw new Error('Worker pool not initialized. Provide workerUrl on first call.');
  }
  return workerPoolInstance;
}

export function resetWorkerPoolOptimizer(): void {
  if (workerPoolInstance) {
    workerPoolInstance.terminate();
  }
  workerPoolInstance = null;
}
