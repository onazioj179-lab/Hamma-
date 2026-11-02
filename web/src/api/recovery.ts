/**
 * SPK V44 - Error & Recovery Framework
 * Safe recovery for large jobs (up to 10TB)
 */

import type {
  JobId,
  ChunkId,
  ApiError,
  ApiResult,
  RecoveryInstruction,
  RecoveryAction,
  CompressionState,
  DecompressionState,
} from './types';

// ============================================================================
// Recovery Types
// ============================================================================

/**
 * Job checkpoint for recovery
 */
export interface JobCheckpoint {
  jobId: JobId;
  timestamp: number;
  state: CompressionState | DecompressionState;
  bytesProcessed: number;
  totalBytes: number;
  chunksCompleted: ChunkId[];
  lastSuccessfulChunk: ChunkId | null;
  pendingChunks: ChunkId[];
  failedChunks: FailedChunk[];
  options: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/**
 * Failed chunk info
 */
export interface FailedChunk {
  chunkId: ChunkId;
  failedAt: number;
  retryCount: number;
  lastError: ApiError;
  recoverable: boolean;
}

/**
 * Recovery attempt result
 */
export interface RecoveryAttempt {
  jobId: JobId;
  attemptNumber: number;
  startedAt: number;
  completedAt?: number;
  success: boolean;
  action: RecoveryAction;
  chunksRecovered: number;
  bytesRecovered: number;
  error?: ApiError;
}

/**
 * Safe mode configuration
 */
export interface SafeModeConfig {
  enabled: boolean;
  maxChunkSize: number;
  maxMemoryMB: number;
  singleWorker: boolean;
  disableSimd: boolean;
  disableDedup: boolean;
  reducedParallelism: boolean;
  checkpointInterval: number;
}

/**
 * Recovery strategy
 */
export interface RecoveryStrategy {
  action: RecoveryAction;
  priority: number;
  conditions: RecoveryCondition[];
  execute: (context: RecoveryContext) => Promise<ApiResult<void>>;
}

/**
 * Recovery condition
 */
export interface RecoveryCondition {
  type: 'error_code' | 'state' | 'retry_count' | 'memory' | 'custom';
  value: unknown;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'matches';
}

/**
 * Recovery context
 */
export interface RecoveryContext {
  jobId: JobId;
  checkpoint: JobCheckpoint;
  error: ApiError;
  retryCount: number;
  memoryUsage: number;
  safeModeEnabled: boolean;
}

// ============================================================================
// Recovery Manager
// ============================================================================

/**
 * Default safe mode configuration
 */
export const DEFAULT_SAFE_MODE: SafeModeConfig = {
  enabled: false,
  maxChunkSize: 8 * 1024 * 1024, // 8MB
  maxMemoryMB: 512,
  singleWorker: true,
  disableSimd: true,
  disableDedup: true,
  reducedParallelism: true,
  checkpointInterval: 100, // chunks
};

/**
 * Recovery manager for handling job failures
 */
export class RecoveryManager {
  private checkpoints: Map<JobId, JobCheckpoint> = new Map();
  private attempts: Map<JobId, RecoveryAttempt[]> = new Map();
  private safeModeConfig: SafeModeConfig = { ...DEFAULT_SAFE_MODE };
  private strategies: RecoveryStrategy[] = [];
  private maxRetries = 3;

  constructor() {
    this.initializeStrategies();
  }

  /**
   * Initialize recovery strategies
   */
  private initializeStrategies(): void {
    this.strategies = [
      // Retry chunk strategy
      {
        action: 'RETRY_CHUNK',
        priority: 1,
        conditions: [
          { type: 'error_code', value: ['WASM_ERROR', 'INTERNAL_ERROR'], operator: 'matches' },
          { type: 'retry_count', value: 3, operator: 'less_than' },
        ],
        execute: async (ctx) => this.retryChunkStrategy(ctx),
      },
      // Reduce memory strategy
      {
        action: 'REDUCE_MEMORY',
        priority: 2,
        conditions: [
          { type: 'error_code', value: 'INSUFFICIENT_MEMORY', operator: 'equals' },
        ],
        execute: async (ctx) => this.reduceMemoryStrategy(ctx),
      },
      // Restart worker strategy
      {
        action: 'RESTART_WORKER',
        priority: 3,
        conditions: [
          { type: 'error_code', value: 'WORKER_CRASHED', operator: 'equals' },
        ],
        execute: async (ctx) => this.restartWorkerStrategy(ctx),
      },
      // Split input strategy
      {
        action: 'SPLIT_INPUT',
        priority: 4,
        conditions: [
          { type: 'error_code', value: 'FILE_TOO_LARGE', operator: 'equals' },
        ],
        execute: async (ctx) => this.splitInputStrategy(ctx),
      },
      // Fallback mode strategy
      {
        action: 'FALLBACK_MODE',
        priority: 5,
        conditions: [
          { type: 'retry_count', value: 3, operator: 'greater_than' },
        ],
        execute: async (ctx) => this.fallbackModeStrategy(ctx),
      },
    ];
  }

  // =========================================================================
  // Checkpoint Management
  // =========================================================================

  /**
   * Create a checkpoint for a job
   */
  createCheckpoint(
    jobId: JobId,
    state: CompressionState | DecompressionState,
    progress: {
      bytesProcessed: number;
      totalBytes: number;
      chunksCompleted: ChunkId[];
      pendingChunks: ChunkId[];
    },
    options: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): JobCheckpoint {
    const checkpoint: JobCheckpoint = {
      jobId,
      timestamp: Date.now(),
      state,
      bytesProcessed: progress.bytesProcessed,
      totalBytes: progress.totalBytes,
      chunksCompleted: progress.chunksCompleted,
      lastSuccessfulChunk: progress.chunksCompleted[progress.chunksCompleted.length - 1] || null,
      pendingChunks: progress.pendingChunks,
      failedChunks: [],
      options,
      metadata: metadata || {},
    };

    this.checkpoints.set(jobId, checkpoint);
    this.persistCheckpoint(checkpoint);

    return checkpoint;
  }

  /**
   * Update checkpoint with failed chunk
   */
  recordFailedChunk(
    jobId: JobId,
    chunkId: ChunkId,
    error: ApiError
  ): void {
    const checkpoint = this.checkpoints.get(jobId);
    if (!checkpoint) return;

    const existingFailed = checkpoint.failedChunks.find(c => c.chunkId === chunkId);
    
    if (existingFailed) {
      existingFailed.retryCount++;
      existingFailed.lastError = error;
      existingFailed.failedAt = Date.now();
    } else {
      checkpoint.failedChunks.push({
        chunkId,
        failedAt: Date.now(),
        retryCount: 1,
        lastError: error,
        recoverable: error.recoverable,
      });
    }

    this.persistCheckpoint(checkpoint);
  }

  /**
   * Get checkpoint for a job
   */
  getCheckpoint(jobId: JobId): JobCheckpoint | null {
    return this.checkpoints.get(jobId) || this.loadCheckpoint(jobId);
  }

  /**
   * Clear checkpoint for a job
   */
  clearCheckpoint(jobId: JobId): void {
    this.checkpoints.delete(jobId);
    this.deletePersistedCheckpoint(jobId);
  }

  // =========================================================================
  // Recovery Operations
  // =========================================================================

  /**
   * Attempt to recover a failed job
   */
  async recoverJob(
    jobId: JobId,
    error: ApiError
  ): Promise<ApiResult<RecoveryInstruction>> {
    const checkpoint = this.getCheckpoint(jobId);
    
    if (!checkpoint) {
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'No checkpoint found for job',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
    }

    // Check if error is recoverable
    if (!error.recoverable) {
      return {
        success: false,
        error: {
          code: error.code,
          message: `Non-recoverable error: ${error.message}`,
          recoverable: false,
        },
        timestamp: Date.now(),
      };
    }

    // Find appropriate strategy
    const context: RecoveryContext = {
      jobId,
      checkpoint,
      error,
      retryCount: this.getRetryCount(jobId),
      memoryUsage: this.getMemoryUsage(),
      safeModeEnabled: this.safeModeConfig.enabled,
    };

    const strategy = this.findStrategy(context);
    
    if (!strategy) {
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'No recovery strategy available',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
    }

    // Record attempt
    const attempt: RecoveryAttempt = {
      jobId,
      attemptNumber: this.getRetryCount(jobId) + 1,
      startedAt: Date.now(),
      success: false,
      action: strategy.action,
      chunksRecovered: 0,
      bytesRecovered: 0,
    };

    // Execute strategy
    const result = await strategy.execute(context);

    attempt.completedAt = Date.now();
    attempt.success = result.success;
    if (!result.success) {
      attempt.error = result.error;
    }

    this.recordAttempt(jobId, attempt);

    if (result.success) {
      return {
        success: true,
        data: {
          action: strategy.action,
          jobId,
          retryAfterMs: 1000,
        },
        timestamp: Date.now(),
      };
    }

    return {
      success: false,
      error: result.error,
      timestamp: Date.now(),
    };
  }

  /**
   * Retry a specific failed chunk
   */
  async retryChunk(
    jobId: JobId,
    chunkId: ChunkId
  ): Promise<ApiResult<void>> {
    const checkpoint = this.getCheckpoint(jobId);
    
    if (!checkpoint) {
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'No checkpoint found for job',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
    }

    const failedChunk = checkpoint.failedChunks.find(c => c.chunkId === chunkId);
    
    if (!failedChunk) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Chunk not found in failed chunks',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
    }

    if (failedChunk.retryCount >= this.maxRetries) {
      return {
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Maximum retry attempts exceeded',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
    }

    // Move chunk back to pending
    checkpoint.pendingChunks.push(chunkId);
    checkpoint.failedChunks = checkpoint.failedChunks.filter(c => c.chunkId !== chunkId);
    this.persistCheckpoint(checkpoint);

    return {
      success: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Enable safe mode for stability
   */
  async enableSafeMode(): Promise<ApiResult<SafeModeConfig>> {
    this.safeModeConfig = {
      ...DEFAULT_SAFE_MODE,
      enabled: true,
    };

    return {
      success: true,
      data: this.safeModeConfig,
      timestamp: Date.now(),
    };
  }

  /**
   * Disable safe mode
   */
  disableSafeMode(): void {
    this.safeModeConfig.enabled = false;
  }

  /**
   * Get current safe mode configuration
   */
  getSafeModeConfig(): SafeModeConfig {
    return { ...this.safeModeConfig };
  }

  // =========================================================================
  // Strategy Implementations
  // =========================================================================

  private async retryChunkStrategy(ctx: RecoveryContext): Promise<ApiResult<void>> {
    // Retry all failed chunks
    for (const failed of ctx.checkpoint.failedChunks) {
      if (failed.retryCount < this.maxRetries) {
        ctx.checkpoint.pendingChunks.push(failed.chunkId);
      }
    }
    ctx.checkpoint.failedChunks = ctx.checkpoint.failedChunks.filter(
      c => c.retryCount >= this.maxRetries
    );
    
    return { success: true, timestamp: Date.now() };
  }

  private async reduceMemoryStrategy(_ctx: RecoveryContext): Promise<ApiResult<void>> {
    // Reduce chunk size and memory limits
    this.safeModeConfig.maxChunkSize = Math.max(
      1 * 1024 * 1024, // 1MB minimum
      this.safeModeConfig.maxChunkSize / 2
    );
    this.safeModeConfig.maxMemoryMB = Math.max(
      256,
      this.safeModeConfig.maxMemoryMB / 2
    );
    
    return { success: true, timestamp: Date.now() };
  }

  private async restartWorkerStrategy(_ctx: RecoveryContext): Promise<ApiResult<void>> {
    // Signal worker restart (actual restart happens in coordinator)
    return { success: true, timestamp: Date.now() };
  }

  private async splitInputStrategy(_ctx: RecoveryContext): Promise<ApiResult<void>> {
    // Signal input splitting (actual split happens in coordinator)
    return { success: true, timestamp: Date.now() };
  }

  private async fallbackModeStrategy(_ctx: RecoveryContext): Promise<ApiResult<void>> {
    await this.enableSafeMode();
    return { success: true, timestamp: Date.now() };
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private findStrategy(ctx: RecoveryContext): RecoveryStrategy | null {
    // Sort by priority
    const sorted = [...this.strategies].sort((a, b) => a.priority - b.priority);
    
    for (const strategy of sorted) {
      if (this.matchesConditions(strategy.conditions, ctx)) {
        return strategy;
      }
    }
    
    return null;
  }

  private matchesConditions(conditions: RecoveryCondition[], ctx: RecoveryContext): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, ctx)) {
        return false;
      }
    }
    return true;
  }

  private evaluateCondition(condition: RecoveryCondition, ctx: RecoveryContext): boolean {
    let actual: unknown;
    
    switch (condition.type) {
      case 'error_code':
        actual = ctx.error.code;
        break;
      case 'state':
        actual = ctx.checkpoint.state;
        break;
      case 'retry_count':
        actual = ctx.retryCount;
        break;
      case 'memory':
        actual = ctx.memoryUsage;
        break;
      default:
        return false;
    }

    switch (condition.operator) {
      case 'equals':
        return actual === condition.value;
      case 'not_equals':
        return actual !== condition.value;
      case 'greater_than':
        return typeof actual === 'number' && actual > (condition.value as number);
      case 'less_than':
        return typeof actual === 'number' && actual < (condition.value as number);
      case 'matches':
        return Array.isArray(condition.value) && condition.value.includes(actual);
      default:
        return false;
    }
  }

  private getRetryCount(jobId: JobId): number {
    const attempts = this.attempts.get(jobId) || [];
    return attempts.length;
  }

  private recordAttempt(jobId: JobId, attempt: RecoveryAttempt): void {
    const attempts = this.attempts.get(jobId) || [];
    attempts.push(attempt);
    this.attempts.set(jobId, attempts);
  }

  private getMemoryUsage(): number {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    }
    return 0;
  }

  private persistCheckpoint(checkpoint: JobCheckpoint): void {
    try {
      const key = `spk_checkpoint_${checkpoint.jobId}`;
      localStorage.setItem(key, JSON.stringify(checkpoint));
    } catch {
      // Ignore storage errors
    }
  }

  private loadCheckpoint(jobId: JobId): JobCheckpoint | null {
    try {
      const key = `spk_checkpoint_${jobId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Ignore storage errors
    }
    return null;
  }

  private deletePersistedCheckpoint(jobId: JobId): void {
    try {
      const key = `spk_checkpoint_${jobId}`;
      localStorage.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Global recovery manager instance
 */
export const recoveryManager = new RecoveryManager();
