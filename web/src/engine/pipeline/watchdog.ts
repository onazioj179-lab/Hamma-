/**
 * SPK Fail-Safe Pipeline - Global Watchdog System
 * 
 * Ensures the compression pipeline NEVER stops:
 * - Monitors every chunk with timeout detection
 * - Automatic retry with exponential backoff
 * - Worker health monitoring and restart
 * - WASM deadlock detection and reset
 * - Guaranteed forward progress
 * 
 * @module pipeline/watchdog
 * @version 1.0.0
 */

// ============================================================================
// TYPES
// ============================================================================

export interface WatchdogConfig {
  /** Maximum time for a single chunk to process (ms) */
  chunkTimeout: number;
  /** Maximum retries per chunk before escalation */
  maxRetries: number;
  /** Backoff multiplier for retries */
  backoffMultiplier: number;
  /** Initial backoff delay (ms) */
  initialBackoff: number;
  /** Maximum backoff delay (ms) */
  maxBackoff: number;
  /** Time before considering worker stalled (ms) */
  workerStallTimeout: number;
  /** Time before considering WASM locked (ms) */
  wasmLockTimeout: number;
  /** Interval for health checks (ms) */
  healthCheckInterval: number;
  /** Maximum consecutive failures before pipeline reset */
  maxConsecutiveFailures: number;
}

export interface ChunkTask {
  id: string;
  chunkIndex: number;
  workerId: string;
  startTime: number;
  timeout: number;
  retries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  lastError?: string;
  buffer?: ArrayBuffer;
}

export interface WorkerHealth {
  workerId: string;
  status: 'healthy' | 'slow' | 'stalled' | 'dead';
  lastResponse: number;
  chunksProcessed: number;
  chunksTimedOut: number;
  avgResponseTime: number;
  consecutiveFailures: number;
}

export interface WatchdogEvent {
  type: 
    | 'chunk-started'
    | 'chunk-completed'
    | 'chunk-timeout'
    | 'chunk-retry'
    | 'chunk-failed'
    | 'worker-stalled'
    | 'worker-restarting'
    | 'worker-restarted'
    | 'wasm-locked'
    | 'wasm-resetting'
    | 'wasm-reset'
    | 'pipeline-recovering'
    | 'pipeline-stable'
    | 'pipeline-emergency'
    | 'heartbeat';
  timestamp: number;
  chunkIndex?: number;
  workerId?: string;
  message: string;
  details?: Record<string, unknown>;
}

export type WatchdogEventHandler = (event: WatchdogEvent) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: WatchdogConfig = {
  chunkTimeout: 30000,           // 30 seconds per chunk
  maxRetries: 3,                  // 3 retries before failure
  backoffMultiplier: 2,           // Double delay each retry
  initialBackoff: 100,            // 100ms initial wait
  maxBackoff: 5000,               // 5 second max wait
  workerStallTimeout: 15000,      // 15 seconds = stalled worker
  wasmLockTimeout: 10000,         // 10 seconds = WASM locked
  healthCheckInterval: 1000,      // 1 second health checks
  maxConsecutiveFailures: 5,      // 5 failures = emergency
};

// ============================================================================
// WATCHDOG TIMER
// ============================================================================

/**
 * Individual chunk timeout timer
 */
class ChunkTimer {
  private timerId: number | null = null;
  private startTime = 0;
  
  constructor(
    public readonly task: ChunkTask,
    private onTimeout: (task: ChunkTask) => void
  ) {}
  
  start(): void {
    this.startTime = Date.now();
    this.task.startTime = this.startTime;
    this.task.status = 'processing';
    
    this.timerId = window.setTimeout(() => {
      this.onTimeout(this.task);
    }, this.task.timeout);
  }
  
  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
  
  getElapsed(): number {
    return Date.now() - this.startTime;
  }
  
  isRunning(): boolean {
    return this.timerId !== null;
  }
}

// ============================================================================
// BACKOFF CALCULATOR
// ============================================================================

/**
 * Calculate backoff delay with jitter
 */
function calculateBackoff(
  attempt: number,
  config: WatchdogConfig
): number {
  const baseDelay = config.initialBackoff * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(baseDelay, config.maxBackoff);
  // Add jitter (±20%)
  const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, cappedDelay + jitter);
}

// ============================================================================
// PIPELINE WATCHDOG
// ============================================================================

export class PipelineWatchdog {
  private config: WatchdogConfig;
  private tasks = new Map<string, ChunkTimer>();
  private workerHealth = new Map<string, WorkerHealth>();
  private eventHandlers: WatchdogEventHandler[] = [];
  private healthCheckTimer: number | null = null;
  private consecutiveFailures = 0;
  private totalChunksProcessed = 0;
  private totalRetries = 0;
  private isRecovering = false;
  private lastHeartbeat = 0;
  private running = false;
  
  // Callbacks for external systems
  private onRetryChunk?: (task: ChunkTask) => Promise<void>;
  private onRestartWorker?: (workerId: string) => Promise<void>;
  private onResetWasm?: (workerId: string) => Promise<void>;
  private onEmergencyRecovery?: () => Promise<void>;
  
  constructor(config: Partial<WatchdogConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================
  
  /**
   * Start the watchdog
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.consecutiveFailures = 0;
    this.isRecovering = false;
    this.lastHeartbeat = Date.now();
    
    // Start health check loop
    this.healthCheckTimer = window.setInterval(
      () => this.performHealthCheck(),
      this.config.healthCheckInterval
    );
    
    this.emit({
      type: 'pipeline-stable',
      timestamp: Date.now(),
      message: 'Watchdog started - pipeline stable',
    });
  }
  
  /**
   * Stop the watchdog
   */
  stop(): void {
    this.running = false;
    
    // Clear all timers
    for (const timer of this.tasks.values()) {
      timer.stop();
    }
    this.tasks.clear();
    
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
  
  /**
   * Reset watchdog state
   */
  reset(): void {
    this.stop();
    this.workerHealth.clear();
    this.consecutiveFailures = 0;
    this.totalChunksProcessed = 0;
    this.totalRetries = 0;
    this.isRecovering = false;
  }
  
  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================
  
  /**
   * Set recovery callbacks
   */
  setRecoveryCallbacks(callbacks: {
    onRetryChunk?: (task: ChunkTask) => Promise<void>;
    onRestartWorker?: (workerId: string) => Promise<void>;
    onResetWasm?: (workerId: string) => Promise<void>;
    onEmergencyRecovery?: () => Promise<void>;
  }): void {
    this.onRetryChunk = callbacks.onRetryChunk;
    this.onRestartWorker = callbacks.onRestartWorker;
    this.onResetWasm = callbacks.onResetWasm;
    this.onEmergencyRecovery = callbacks.onEmergencyRecovery;
  }
  
  /**
   * Add event handler
   */
  addEventListener(handler: WatchdogEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }
  
  // ==========================================================================
  // WORKER MANAGEMENT
  // ==========================================================================
  
  /**
   * Register a worker
   */
  registerWorker(workerId: string): void {
    this.workerHealth.set(workerId, {
      workerId,
      status: 'healthy',
      lastResponse: Date.now(),
      chunksProcessed: 0,
      chunksTimedOut: 0,
      avgResponseTime: 0,
      consecutiveFailures: 0,
    });
  }
  
  /**
   * Unregister a worker
   */
  unregisterWorker(workerId: string): void {
    this.workerHealth.delete(workerId);
    
    // Cancel any tasks assigned to this worker
    for (const [taskId, timer] of this.tasks.entries()) {
      if (timer.task.workerId === workerId) {
        timer.stop();
        this.tasks.delete(taskId);
      }
    }
  }
  
  /**
   * Get worker health status
   */
  getWorkerHealth(workerId: string): WorkerHealth | undefined {
    return this.workerHealth.get(workerId);
  }
  
  /**
   * Get all worker health statuses
   */
  getAllWorkerHealth(): WorkerHealth[] {
    return Array.from(this.workerHealth.values());
  }
  
  // ==========================================================================
  // CHUNK MONITORING
  // ==========================================================================
  
  /**
   * Start monitoring a chunk
   */
  startChunk(
    chunkIndex: number,
    workerId: string,
    buffer?: ArrayBuffer,
    customTimeout?: number
  ): string {
    const taskId = `chunk-${chunkIndex}-${Date.now()}`;
    
    const task: ChunkTask = {
      id: taskId,
      chunkIndex,
      workerId,
      startTime: 0,
      timeout: customTimeout ?? this.config.chunkTimeout,
      retries: 0,
      status: 'pending',
      buffer,
    };
    
    const timer = new ChunkTimer(task, (t) => this.handleChunkTimeout(t));
    this.tasks.set(taskId, timer);
    timer.start();
    
    // Update worker health
    const health = this.workerHealth.get(workerId);
    if (health) {
      health.lastResponse = Date.now();
    }
    
    this.emit({
      type: 'chunk-started',
      timestamp: Date.now(),
      chunkIndex,
      workerId,
      message: `Started processing chunk ${chunkIndex} on worker ${workerId}`,
    });
    
    return taskId;
  }
  
  /**
   * Mark chunk as completed
   */
  completeChunk(taskId: string, processingTime?: number): void {
    const timer = this.tasks.get(taskId);
    if (!timer) return;
    
    timer.stop();
    timer.task.status = 'completed';
    
    const elapsed = processingTime ?? timer.getElapsed();
    
    // Update worker health
    const health = this.workerHealth.get(timer.task.workerId);
    if (health) {
      health.lastResponse = Date.now();
      health.chunksProcessed++;
      health.consecutiveFailures = 0;
      health.status = 'healthy';
      // Update average response time
      health.avgResponseTime = (
        (health.avgResponseTime * (health.chunksProcessed - 1) + elapsed) /
        health.chunksProcessed
      );
    }
    
    // Update global stats
    this.totalChunksProcessed++;
    this.consecutiveFailures = 0;
    this.isRecovering = false;
    
    this.tasks.delete(taskId);
    
    this.emit({
      type: 'chunk-completed',
      timestamp: Date.now(),
      chunkIndex: timer.task.chunkIndex,
      workerId: timer.task.workerId,
      message: `Chunk ${timer.task.chunkIndex} completed in ${elapsed}ms`,
      details: { processingTime: elapsed, retries: timer.task.retries },
    });
  }
  
  /**
   * Mark chunk as failed (after all retries exhausted)
   */
  failChunk(taskId: string, error: string): void {
    const timer = this.tasks.get(taskId);
    if (!timer) return;
    
    timer.stop();
    timer.task.status = 'failed';
    timer.task.lastError = error;
    
    // Update worker health
    const health = this.workerHealth.get(timer.task.workerId);
    if (health) {
      health.consecutiveFailures++;
    }
    
    this.consecutiveFailures++;
    this.tasks.delete(taskId);
    
    this.emit({
      type: 'chunk-failed',
      timestamp: Date.now(),
      chunkIndex: timer.task.chunkIndex,
      workerId: timer.task.workerId,
      message: `Chunk ${timer.task.chunkIndex} failed after ${timer.task.retries} retries: ${error}`,
      details: { error, retries: timer.task.retries },
    });
    
    // Check for emergency
    this.checkEmergencyCondition();
  }
  
  // ==========================================================================
  // TIMEOUT HANDLING
  // ==========================================================================
  
  /**
   * Handle chunk timeout
   */
  private async handleChunkTimeout(task: ChunkTask): Promise<void> {
    const timer = this.tasks.get(task.id);
    if (!timer) return;
    
    timer.stop();
    
    // Update worker health
    const health = this.workerHealth.get(task.workerId);
    if (health) {
      health.chunksTimedOut++;
      health.consecutiveFailures++;
      
      // Determine worker status
      const timeSinceResponse = Date.now() - health.lastResponse;
      if (timeSinceResponse > this.config.workerStallTimeout) {
        health.status = 'stalled';
      } else if (timeSinceResponse > this.config.wasmLockTimeout) {
        health.status = 'slow';
      }
    }
    
    this.emit({
      type: 'chunk-timeout',
      timestamp: Date.now(),
      chunkIndex: task.chunkIndex,
      workerId: task.workerId,
      message: `Chunk ${task.chunkIndex} timed out after ${task.timeout}ms`,
      details: { timeout: task.timeout, retries: task.retries },
    });
    
    // Attempt retry if under limit
    if (task.retries < this.config.maxRetries) {
      await this.retryChunk(task);
    } else {
      // Escalate based on worker health
      if (health?.status === 'stalled') {
        await this.restartWorker(task.workerId, task);
      } else {
        this.failChunk(task.id, 'Max retries exceeded after timeout');
      }
    }
  }
  
  /**
   * Retry a chunk with backoff
   */
  private async retryChunk(task: ChunkTask): Promise<void> {
    task.retries++;
    task.status = 'retrying';
    this.totalRetries++;
    
    const backoff = calculateBackoff(task.retries, this.config);
    
    this.emit({
      type: 'chunk-retry',
      timestamp: Date.now(),
      chunkIndex: task.chunkIndex,
      workerId: task.workerId,
      message: `Retrying chunk ${task.chunkIndex} (attempt ${task.retries + 1}/${this.config.maxRetries + 1}) in ${Math.round(backoff)}ms`,
      details: { attempt: task.retries + 1, backoff },
    });
    
    // Wait for backoff
    await new Promise(resolve => setTimeout(resolve, backoff));
    
    // Reset timer and call retry callback
    if (this.onRetryChunk) {
      try {
        const timer = new ChunkTimer(task, (t) => this.handleChunkTimeout(t));
        this.tasks.set(task.id, timer);
        timer.start();
        
        await this.onRetryChunk(task);
      } catch (error) {
        this.handleChunkTimeout(task);
      }
    } else {
      // No retry callback - just restart the timer
      const timer = new ChunkTimer(task, (t) => this.handleChunkTimeout(t));
      this.tasks.set(task.id, timer);
      timer.start();
    }
  }
  
  // ==========================================================================
  // WORKER RECOVERY
  // ==========================================================================
  
  /**
   * Restart a stalled worker
   */
  private async restartWorker(workerId: string, failedTask?: ChunkTask): Promise<void> {
    this.emit({
      type: 'worker-restarting',
      timestamp: Date.now(),
      workerId,
      message: `Restarting stalled worker ${workerId}`,
    });
    
    this.isRecovering = true;
    
    // Find all tasks on this worker
    const workerTasks: ChunkTask[] = [];
    for (const timer of this.tasks.values()) {
      if (timer.task.workerId === workerId) {
        timer.stop();
        workerTasks.push(timer.task);
      }
    }
    
    try {
      if (this.onRestartWorker) {
        await this.onRestartWorker(workerId);
      }
      
      // Reset worker health
      const health = this.workerHealth.get(workerId);
      if (health) {
        health.status = 'healthy';
        health.lastResponse = Date.now();
        health.consecutiveFailures = 0;
      }
      
      this.emit({
        type: 'worker-restarted',
        timestamp: Date.now(),
        workerId,
        message: `Worker ${workerId} restarted successfully`,
        details: { pendingTasks: workerTasks.length },
      });
      
      // Retry pending tasks
      for (const task of workerTasks) {
        if (task.retries < this.config.maxRetries) {
          await this.retryChunk(task);
        } else {
          this.failChunk(task.id, 'Worker restart did not help');
        }
      }
    } catch (error) {
      // Worker restart failed - try WASM reset
      await this.resetWasm(workerId, failedTask);
    }
  }
  
  /**
   * Reset WASM for a worker
   */
  private async resetWasm(workerId: string, failedTask?: ChunkTask): Promise<void> {
    this.emit({
      type: 'wasm-resetting',
      timestamp: Date.now(),
      workerId,
      message: `Resetting WASM for worker ${workerId}`,
    });
    
    try {
      if (this.onResetWasm) {
        await this.onResetWasm(workerId);
      }
      
      this.emit({
        type: 'wasm-reset',
        timestamp: Date.now(),
        workerId,
        message: `WASM reset complete for worker ${workerId}`,
      });
      
      // Retry the failed task if any
      if (failedTask && failedTask.retries < this.config.maxRetries) {
        await this.retryChunk(failedTask);
      } else if (failedTask) {
        this.failChunk(failedTask.id, 'WASM reset did not help');
      }
    } catch (error) {
      // WASM reset failed
      if (failedTask) {
        this.failChunk(failedTask.id, `WASM reset failed: ${error}`);
      }
      this.checkEmergencyCondition();
    }
  }
  
  // ==========================================================================
  // HEALTH CHECKS
  // ==========================================================================
  
  /**
   * Perform periodic health check
   */
  private performHealthCheck(): void {
    const now = Date.now();
    this.lastHeartbeat = now;
    
    // Check all workers
    for (const [workerId, health] of this.workerHealth.entries()) {
      const timeSinceResponse = now - health.lastResponse;
      
      // Detect stalled workers
      if (timeSinceResponse > this.config.workerStallTimeout) {
        if (health.status !== 'stalled' && health.status !== 'dead') {
          health.status = 'stalled';
          this.emit({
            type: 'worker-stalled',
            timestamp: now,
            workerId,
            message: `Worker ${workerId} appears stalled (no response for ${timeSinceResponse}ms)`,
            details: { timeSinceResponse },
          });
        }
      } else if (timeSinceResponse > this.config.wasmLockTimeout) {
        if (health.status === 'healthy') {
          health.status = 'slow';
          this.emit({
            type: 'wasm-locked',
            timestamp: now,
            workerId,
            message: `Worker ${workerId} may have locked WASM (no response for ${timeSinceResponse}ms)`,
            details: { timeSinceResponse },
          });
        }
      }
    }
    
    // Check for recovery state
    if (this.isRecovering) {
      this.emit({
        type: 'pipeline-recovering',
        timestamp: now,
        message: 'Pipeline is in recovery mode',
        details: {
          pendingTasks: this.tasks.size,
          consecutiveFailures: this.consecutiveFailures,
        },
      });
    }
    
    // Emit heartbeat
    this.emit({
      type: 'heartbeat',
      timestamp: now,
      message: 'Watchdog heartbeat',
      details: {
        activeTasks: this.tasks.size,
        totalProcessed: this.totalChunksProcessed,
        totalRetries: this.totalRetries,
        isRecovering: this.isRecovering,
      },
    });
  }
  
  /**
   * Check for emergency condition
   */
  private checkEmergencyCondition(): void {
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.emit({
        type: 'pipeline-emergency',
        timestamp: Date.now(),
        message: `EMERGENCY: ${this.consecutiveFailures} consecutive failures - initiating full recovery`,
        details: { consecutiveFailures: this.consecutiveFailures },
      });
      
      // Trigger emergency recovery
      if (this.onEmergencyRecovery) {
        this.onEmergencyRecovery().then(() => {
          this.consecutiveFailures = 0;
          this.isRecovering = false;
          this.emit({
            type: 'pipeline-stable',
            timestamp: Date.now(),
            message: 'Pipeline recovered from emergency',
          });
        }).catch(() => {
          // Emergency recovery failed - system is in bad state
          this.emit({
            type: 'pipeline-emergency',
            timestamp: Date.now(),
            message: 'CRITICAL: Emergency recovery failed - manual intervention required',
          });
        });
      }
    }
  }
  
  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================
  
  /**
   * Emit event to all handlers
   */
  private emit(event: WatchdogEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[Watchdog] Event handler error:', error);
      }
    }
  }
  
  // ==========================================================================
  // STATISTICS
  // ==========================================================================
  
  /**
   * Get watchdog statistics
   */
  getStats(): {
    totalChunksProcessed: number;
    totalRetries: number;
    activeTasks: number;
    isRecovering: boolean;
    consecutiveFailures: number;
    workers: WorkerHealth[];
    lastHeartbeat: number;
  } {
    return {
      totalChunksProcessed: this.totalChunksProcessed,
      totalRetries: this.totalRetries,
      activeTasks: this.tasks.size,
      isRecovering: this.isRecovering,
      consecutiveFailures: this.consecutiveFailures,
      workers: this.getAllWorkerHealth(),
      lastHeartbeat: this.lastHeartbeat,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalWatchdog: PipelineWatchdog | null = null;

export function getPipelineWatchdog(config?: Partial<WatchdogConfig>): PipelineWatchdog {
  if (!globalWatchdog) {
    globalWatchdog = new PipelineWatchdog(config);
  }
  return globalWatchdog;
}

export function resetPipelineWatchdog(): void {
  if (globalWatchdog) {
    globalWatchdog.reset();
    globalWatchdog = null;
  }
}
