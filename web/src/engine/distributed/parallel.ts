/**
 * SPK V37 - Distributed Local Execution
 * 
 * Enables multi-worker parallelism:
 * - Launch multiple Web Workers or native threads
 * - Coordinator load-balances chunk assignment
 * - Map-reduce style aggregation of compressed chunks
 * - Guarantee deterministic ordering and final result
 * - Speed boost on multi-core devices
 */

// ============================================================================
// TYPES
// ============================================================================

export interface WorkerInstance {
  id: string;
  worker: Worker;
  status: 'idle' | 'busy' | 'error' | 'terminated';
  currentChunk: number | null;
  chunksProcessed: number;
  bytesProcessed: number;
  errors: number;
  lastActivity: number;
}

export interface ChunkTask {
  index: number;
  data: ArrayBuffer;
  assignedWorker: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result: ArrayBuffer | null;
  attempts: number;
  startTime: number;
  endTime: number;
}

export interface DistributedJobConfig {
  maxWorkers: number;
  minWorkers: number;
  chunkSize: number;
  maxRetries: number;
  workerTimeout: number;
  balanceInterval: number;
}

export interface DistributedProgress {
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  pendingChunks: number;
  activeWorkers: number;
  totalWorkers: number;
  throughput: number;
  eta: number;
}

export type WorkerMessageHandler = (workerId: string, message: unknown) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: DistributedJobConfig = {
  maxWorkers: navigator.hardwareConcurrency || 4,
  minWorkers: 1,
  chunkSize: 4 * 1024 * 1024, // 4MB
  maxRetries: 3,
  workerTimeout: 60000, // 60 seconds
  balanceInterval: 1000, // 1 second
};

// ============================================================================
// WORKER POOL
// ============================================================================

export class WorkerPool {
  private workers = new Map<string, WorkerInstance>();
  private workerScript: string | URL;
  private onMessage: WorkerMessageHandler;
  private maxWorkers: number;
  private idCounter = 0;
  
  constructor(
    workerScript: string | URL,
    onMessage: WorkerMessageHandler,
    maxWorkers: number = DEFAULT_CONFIG.maxWorkers
  ) {
    this.workerScript = workerScript;
    this.onMessage = onMessage;
    this.maxWorkers = maxWorkers;
  }
  
  /**
   * Spawn a new worker
   */
  spawn(): WorkerInstance | null {
    if (this.workers.size >= this.maxWorkers) {
      return null;
    }
    
    const id = `worker_${++this.idCounter}`;
    const worker = new Worker(this.workerScript, { type: 'module' });
    
    const instance: WorkerInstance = {
      id,
      worker,
      status: 'idle',
      currentChunk: null,
      chunksProcessed: 0,
      bytesProcessed: 0,
      errors: 0,
      lastActivity: Date.now(),
    };
    
    // Set up message handler
    worker.onmessage = (e) => {
      instance.lastActivity = Date.now();
      this.onMessage(id, e.data);
    };
    
    worker.onerror = (e) => {
      instance.status = 'error';
      instance.errors++;
      console.error(`Worker ${id} error:`, e);
    };
    
    // Initialize worker
    worker.postMessage({ type: 'INIT' });
    
    this.workers.set(id, instance);
    return instance;
  }
  
  /**
   * Get an idle worker
   */
  getIdleWorker(): WorkerInstance | null {
    for (const instance of this.workers.values()) {
      if (instance.status === 'idle') {
        return instance;
      }
    }
    return null;
  }
  
  /**
   * Get worker by ID
   */
  getWorker(id: string): WorkerInstance | undefined {
    return this.workers.get(id);
  }
  
  /**
   * Get all workers
   */
  getAllWorkers(): WorkerInstance[] {
    return Array.from(this.workers.values());
  }
  
  /**
   * Get active worker count
   */
  getActiveCount(): number {
    let count = 0;
    for (const instance of this.workers.values()) {
      if (instance.status === 'busy') count++;
    }
    return count;
  }
  
  /**
   * Get idle worker count
   */
  getIdleCount(): number {
    let count = 0;
    for (const instance of this.workers.values()) {
      if (instance.status === 'idle') count++;
    }
    return count;
  }
  
  /**
   * Terminate a worker
   */
  terminate(id: string): void {
    const instance = this.workers.get(id);
    if (instance) {
      instance.worker.terminate();
      instance.status = 'terminated';
      this.workers.delete(id);
    }
  }
  
  /**
   * Terminate all workers
   */
  terminateAll(): void {
    for (const id of this.workers.keys()) {
      this.terminate(id);
    }
  }
  
  /**
   * Scale pool to target size
   */
  scaleTo(target: number): void {
    const current = this.workers.size;
    
    if (target > current) {
      // Scale up
      for (let i = 0; i < target - current; i++) {
        this.spawn();
      }
    } else if (target < current) {
      // Scale down - remove idle workers first
      const toRemove = current - target;
      let removed = 0;
      
      for (const [id, instance] of this.workers.entries()) {
        if (removed >= toRemove) break;
        if (instance.status === 'idle') {
          this.terminate(id);
          removed++;
        }
      }
    }
  }
}

// ============================================================================
// LOAD BALANCER
// ============================================================================

export class LoadBalancer {
  private pool: WorkerPool;
  private taskQueue: ChunkTask[] = [];
  private completedTasks = new Map<number, ChunkTask>();
  private config: DistributedJobConfig;
  private balanceTimer: number | null = null;
  
  constructor(pool: WorkerPool, config: Partial<DistributedJobConfig> = {}) {
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Start load balancing
   */
  start(): void {
    if (this.balanceTimer) return;
    
    this.balanceTimer = window.setInterval(
      () => this.balance(),
      this.config.balanceInterval
    );
  }
  
  /**
   * Stop load balancing
   */
  stop(): void {
    if (this.balanceTimer) {
      clearInterval(this.balanceTimer);
      this.balanceTimer = null;
    }
  }
  
  /**
   * Add task to queue
   */
  enqueue(task: ChunkTask): void {
    this.taskQueue.push(task);
    this.balance();
  }
  
  /**
   * Balance work across workers
   */
  private balance(): void {
    // Sort pending tasks by index
    const pending = this.taskQueue
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.index - b.index);
    
    for (const task of pending) {
      const worker = this.pool.getIdleWorker();
      
      if (!worker) {
        // No idle workers - try to spawn more
        if (this.pool.getAllWorkers().length < this.config.maxWorkers) {
          this.pool.spawn();
        }
        break;
      }
      
      // Assign task to worker
      task.assignedWorker = worker.id;
      task.status = 'processing';
      task.startTime = Date.now();
      
      worker.status = 'busy';
      worker.currentChunk = task.index;
      
      // Send to worker
      worker.worker.postMessage({
        type: 'PROCESS_CHUNK',
        index: task.index,
        data: task.data,
      }, [task.data]);
    }
    
    // Check for timed out tasks
    const now = Date.now();
    for (const task of this.taskQueue) {
      if (task.status === 'processing' && 
          now - task.startTime > this.config.workerTimeout) {
        this.handleTimeout(task);
      }
    }
  }
  
  /**
   * Handle task timeout
   */
  private handleTimeout(task: ChunkTask): void {
    task.attempts++;
    
    if (task.attempts < this.config.maxRetries) {
      // Retry on different worker
      task.status = 'pending';
      task.assignedWorker = null;
      
      // Mark worker as error
      if (task.assignedWorker) {
        const worker = this.pool.getWorker(task.assignedWorker);
        if (worker) {
          worker.status = 'error';
          worker.errors++;
        }
      }
    } else {
      task.status = 'failed';
    }
  }
  
  /**
   * Handle task completion
   */
  completeTask(workerId: string, chunkIndex: number, result: ArrayBuffer): void {
    const task = this.taskQueue.find(
      t => t.index === chunkIndex && t.assignedWorker === workerId
    );
    
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.endTime = Date.now();
      
      this.completedTasks.set(chunkIndex, task);
    }
    
    // Update worker
    const worker = this.pool.getWorker(workerId);
    if (worker) {
      worker.status = 'idle';
      worker.currentChunk = null;
      worker.chunksProcessed++;
      worker.bytesProcessed += result.byteLength;
    }
    
    // Trigger rebalance
    this.balance();
  }
  
  /**
   * Handle task failure
   */
  failTask(workerId: string, chunkIndex: number, error: string): void {
    const task = this.taskQueue.find(
      t => t.index === chunkIndex && t.assignedWorker === workerId
    );
    
    if (task) {
      task.attempts++;
      
      if (task.attempts < this.config.maxRetries) {
        task.status = 'pending';
        task.assignedWorker = null;
      } else {
        task.status = 'failed';
      }
    }
    
    // Update worker
    const worker = this.pool.getWorker(workerId);
    if (worker) {
      worker.status = 'idle';
      worker.currentChunk = null;
      worker.errors++;
    }
    
    console.error(`Task ${chunkIndex} failed on worker ${workerId}: ${error}`);
    this.balance();
  }
  
  /**
   * Get progress
   */
  getProgress(): DistributedProgress {
    const total = this.taskQueue.length;
    const completed = this.completedTasks.size;
    const failed = this.taskQueue.filter(t => t.status === 'failed').length;
    const pending = this.taskQueue.filter(t => t.status === 'pending').length;
    
    const workers = this.pool.getAllWorkers();
    const active = workers.filter(w => w.status === 'busy').length;
    
    // Calculate throughput
    const completedTasks = Array.from(this.completedTasks.values());
    let throughput = 0;
    if (completedTasks.length > 0) {
      const recentTasks = completedTasks.slice(-10);
      const totalBytes = recentTasks.reduce((s, t) => s + (t.result?.byteLength || 0), 0);
      const totalTime = recentTasks.reduce((s, t) => s + (t.endTime - t.startTime), 0);
      throughput = totalTime > 0 ? totalBytes / (totalTime / 1000) : 0;
    }
    
    // Estimate ETA
    const remainingChunks = total - completed;
    const avgTimePerChunk = completedTasks.length > 0
      ? completedTasks.reduce((s, t) => s + (t.endTime - t.startTime), 0) / completedTasks.length
      : 0;
    const eta = avgTimePerChunk > 0 ? (remainingChunks * avgTimePerChunk) / 1000 : 0;
    
    return {
      totalChunks: total,
      completedChunks: completed,
      failedChunks: failed,
      pendingChunks: pending,
      activeWorkers: active,
      totalWorkers: workers.length,
      throughput,
      eta,
    };
  }
  
  /**
   * Get completed results in order
   */
  getOrderedResults(): ArrayBuffer[] {
    const results: ArrayBuffer[] = [];
    
    for (let i = 0; i < this.taskQueue.length; i++) {
      const task = this.completedTasks.get(i);
      if (task?.result) {
        results.push(task.result);
      }
    }
    
    return results;
  }
  
  /**
   * Check if all tasks complete
   */
  isComplete(): boolean {
    return this.completedTasks.size === this.taskQueue.length;
  }
  
  /**
   * Check if any task failed
   */
  hasFailed(): boolean {
    return this.taskQueue.some(t => t.status === 'failed');
  }
  
  /**
   * Reset balancer
   */
  reset(): void {
    this.stop();
    this.taskQueue = [];
    this.completedTasks.clear();
  }
}

// ============================================================================
// MAP-REDUCE AGGREGATOR
// ============================================================================

export class MapReduceAggregator<T> {
  private mappedResults = new Map<number, T>();
  private totalItems: number;
  private reduceFunction: (items: T[]) => T;
  
  constructor(totalItems: number, reduceFn: (items: T[]) => T) {
    this.totalItems = totalItems;
    this.reduceFunction = reduceFn;
  }
  
  /**
   * Add a mapped result
   */
  addMapped(index: number, result: T): void {
    this.mappedResults.set(index, result);
  }
  
  /**
   * Check if all results collected
   */
  isComplete(): boolean {
    return this.mappedResults.size === this.totalItems;
  }
  
  /**
   * Get progress
   */
  getProgress(): number {
    return this.mappedResults.size / this.totalItems;
  }
  
  /**
   * Reduce all results
   */
  reduce(): T {
    // Sort by index
    const sorted: T[] = [];
    for (let i = 0; i < this.totalItems; i++) {
      const result = this.mappedResults.get(i);
      if (result !== undefined) {
        sorted.push(result);
      }
    }
    
    return this.reduceFunction(sorted);
  }
  
  /**
   * Get ordered results
   */
  getOrdered(): T[] {
    const sorted: T[] = [];
    for (let i = 0; i < this.totalItems; i++) {
      const result = this.mappedResults.get(i);
      if (result !== undefined) {
        sorted.push(result);
      }
    }
    return sorted;
  }
}

// ============================================================================
// DISTRIBUTED COMPRESSION COORDINATOR
// ============================================================================

export class DistributedCoordinator {
  private pool: WorkerPool | null = null;
  private balancer: LoadBalancer | null = null;
  private config: DistributedJobConfig;
  private aggregator: MapReduceAggregator<ArrayBuffer> | null = null;
  private onProgress: ((progress: DistributedProgress) => void) | null = null;
  private _onComplete: ((results: ArrayBuffer[]) => void) | null = null;
  private _onError: ((error: string) => void) | null = null;
  
  constructor(config: Partial<DistributedJobConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Initialize coordinator
   */
  async initialize(workerScript: string | URL): Promise<void> {
    this.pool = new WorkerPool(
      workerScript,
      this.handleWorkerMessage.bind(this),
      this.config.maxWorkers
    );
    
    // Spawn initial workers
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.pool.spawn();
    }
    
    this.balancer = new LoadBalancer(this.pool, this.config);
  }
  
  /**
   * Process chunks in parallel
   */
  async processChunks(chunks: ArrayBuffer[]): Promise<ArrayBuffer[]> {
    if (!this.pool || !this.balancer) {
      throw new Error('Coordinator not initialized');
    }
    
    // Create aggregator
    this.aggregator = new MapReduceAggregator(
      chunks.length,
      (items) => {
        // Simple concatenation for final result
        const totalSize = items.reduce((s, b) => s + b.byteLength, 0);
        const result = new ArrayBuffer(totalSize);
        const view = new Uint8Array(result);
        let offset = 0;
        for (const buffer of items) {
          view.set(new Uint8Array(buffer), offset);
          offset += buffer.byteLength;
        }
        return result;
      }
    );
    
    // Create tasks
    for (let i = 0; i < chunks.length; i++) {
      this.balancer.enqueue({
        index: i,
        data: chunks[i],
        assignedWorker: null,
        status: 'pending',
        result: null,
        attempts: 0,
        startTime: 0,
        endTime: 0,
      });
    }
    
    // Start processing
    this.balancer.start();
    
    // Wait for completion
    return new Promise((resolve, reject) => {
      this._onComplete = resolve;
      this._onError = reject;
      
      // Check completion periodically
      const checkInterval = setInterval(() => {
        if (this.balancer?.isComplete()) {
          clearInterval(checkInterval);
          this.balancer.stop();
          resolve(this.balancer.getOrderedResults());
        } else if (this.balancer?.hasFailed()) {
          clearInterval(checkInterval);
          this.balancer.stop();
          reject(new Error('One or more chunks failed to process'));
        }
      }, 100);
    });
  }
  
  /**
   * Handle worker message
   */
  private handleWorkerMessage(workerId: string, message: unknown): void {
    const msg = message as { type: string; [key: string]: unknown };
    
    switch (msg.type) {
      case 'CHUNK_PROCESSED':
        if (this.balancer) {
          this.balancer.completeTask(
            workerId,
            msg.index as number,
            msg.data as ArrayBuffer
          );
          
          // Update aggregator
          this.aggregator?.addMapped(msg.index as number, msg.data as ArrayBuffer);
          
          // Report progress
          const progress = this.balancer.getProgress();
          this.onProgress?.(progress);
        }
        break;
        
      case 'ERROR':
        if (this.balancer) {
          this.balancer.failTask(
            workerId,
            msg.index as number,
            msg.error as string
          );
        }
        break;
        
      case 'READY':
        // Worker initialized
        break;
    }
  }
  
  /**
   * Set progress callback
   */
  setProgressCallback(callback: (progress: DistributedProgress) => void): void {
    this.onProgress = callback;
  }
  
  /**
   * Get current progress
   */
  getProgress(): DistributedProgress | null {
    return this.balancer?.getProgress() ?? null;
  }
  
  /**
   * Cancel all work
   */
  cancel(): void {
    this.balancer?.stop();
    this.pool?.terminateAll();
  }
  
  /**
   * Shutdown coordinator
   */
  shutdown(): void {
    this.cancel();
    this.balancer?.reset();
    this.aggregator = null;
    this.onProgress = null;
    this._onComplete = null;
    this._onError = null;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function getOptimalWorkerCount(): number {
  return Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
}

export function estimateParallelSpeedup(workerCount: number): number {
  // Amdahl's law approximation
  const parallelFraction = 0.9; // 90% parallelizable
  return 1 / ((1 - parallelFraction) + parallelFraction / workerCount);
}
