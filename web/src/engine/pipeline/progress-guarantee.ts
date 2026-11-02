/**
 * SPK Fail-Safe Pipeline - Progress Guarantee System
 * 
 * Ensures the pipeline ALWAYS emits progress with no silent failures:
 * - Continuous progress emission even during recovery
 * - All state transitions are visible
 * - UI-friendly event system
 * - Heartbeat for liveness detection
 * - Comprehensive event types for all scenarios
 * 
 * @module pipeline/progress-guarantee
 * @version 1.0.0
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ProgressGuaranteeConfig {
  /** Minimum interval between progress emissions (ms) */
  minEmitInterval: number;
  /** Maximum time without emission before forcing update (ms) */
  maxSilentPeriod: number;
  /** Heartbeat interval (ms) */
  heartbeatInterval: number;
  /** Enable verbose logging */
  verbose: boolean;
}

export type PipelinePhase = 
  | 'idle'
  | 'initializing'
  | 'reading'
  | 'compressing'
  | 'writing'
  | 'verifying'
  | 'finalizing'
  | 'complete'
  | 'error'
  | 'recovering'
  | 'paused'
  | 'cancelled';

export type PipelineEventType =
  // Lifecycle events
  | 'pipeline-started'
  | 'pipeline-paused'
  | 'pipeline-resumed'
  | 'pipeline-cancelled'
  | 'pipeline-complete'
  | 'pipeline-error'
  // Progress events
  | 'progress-update'
  | 'phase-change'
  | 'chunk-started'
  | 'chunk-completed'
  | 'chunk-retrying'
  | 'chunk-failed'
  // Recovery events
  | 'worker-restarting'
  | 'worker-restarted'
  | 'worker-failed'
  | 'wasm-resetting'
  | 'wasm-reset'
  | 'pipeline-recovering'
  | 'pipeline-stable'
  | 'emergency-recovery'
  // Heartbeat
  | 'heartbeat';

export interface PipelineProgress {
  phase: PipelinePhase;
  bytesProcessed: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  percentage: number;
  speed: number;
  eta: number;
  currentFile?: string;
  filesProcessed?: number;
  totalFiles?: number;
}

export interface PipelineEvent {
  id: string;
  type: PipelineEventType;
  timestamp: number;
  phase: PipelinePhase;
  progress: PipelineProgress;
  message: string;
  details?: Record<string, unknown>;
  isRecovery: boolean;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: ProgressGuaranteeConfig = {
  minEmitInterval: 100,       // At least 100ms between emissions
  maxSilentPeriod: 1000,      // Force update every second
  heartbeatInterval: 500,     // Heartbeat every 500ms
  verbose: false,
};

// ============================================================================
// PROGRESS GUARANTEE SYSTEM
// ============================================================================

export class ProgressGuaranteeSystem {
  private config: ProgressGuaranteeConfig;
  private handlers: PipelineEventHandler[] = [];
  private eventIdCounter = 0;
  private lastEmitTime = 0;
  private heartbeatTimer: number | null = null;
  private silentCheckTimer: number | null = null;
  private isRunning = false;
  private isRecovering = false;
  
  // Current state
  private currentPhase: PipelinePhase = 'idle';
  private currentProgress: PipelineProgress = {
    phase: 'idle',
    bytesProcessed: 0,
    totalBytes: 0,
    chunksProcessed: 0,
    totalChunks: 0,
    percentage: 0,
    speed: 0,
    eta: 0,
  };
  
  // Statistics
  private eventHistory: PipelineEvent[] = [];
  private maxHistorySize = 1000;
  private startTime = 0;
  private totalEvents = 0;
  
  constructor(config: Partial<ProgressGuaranteeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================
  
  /**
   * Start the progress guarantee system
   */
  start(totalBytes: number, totalChunks: number): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.isRecovering = false;
    
    this.currentProgress = {
      phase: 'initializing',
      bytesProcessed: 0,
      totalBytes,
      chunksProcessed: 0,
      totalChunks,
      percentage: 0,
      speed: 0,
      eta: 0,
    };
    
    this.currentPhase = 'initializing';
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Start silent period check
    this.startSilentCheck();
    
    // Emit start event
    this.emit('pipeline-started', 'Pipeline started');
  }
  
  /**
   * Stop the progress guarantee system
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.silentCheckTimer !== null) {
      clearInterval(this.silentCheckTimer);
      this.silentCheckTimer = null;
    }
  }
  
  /**
   * Reset the system
   */
  reset(): void {
    this.stop();
    this.currentPhase = 'idle';
    this.currentProgress = {
      phase: 'idle',
      bytesProcessed: 0,
      totalBytes: 0,
      chunksProcessed: 0,
      totalChunks: 0,
      percentage: 0,
      speed: 0,
      eta: 0,
    };
    this.eventHistory = [];
    this.totalEvents = 0;
  }
  
  // ==========================================================================
  // HEARTBEAT
  // ==========================================================================
  
  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isRunning) {
        this.emit('heartbeat', 'Pipeline heartbeat', {}, true);
      }
    }, this.config.heartbeatInterval);
  }
  
  /**
   * Start silent period check
   */
  private startSilentCheck(): void {
    if (this.silentCheckTimer !== null) return;
    
    this.silentCheckTimer = window.setInterval(() => {
      if (this.isRunning) {
        const timeSinceEmit = Date.now() - this.lastEmitTime;
        
        if (timeSinceEmit > this.config.maxSilentPeriod) {
          // Force a progress update
          this.emit(
            'progress-update',
            'Progress update (forced - no activity)',
            { forced: true }
          );
        }
      }
    }, this.config.maxSilentPeriod);
  }
  
  // ==========================================================================
  // PHASE MANAGEMENT
  // ==========================================================================
  
  /**
   * Change pipeline phase
   */
  setPhase(phase: PipelinePhase): void {
    if (phase === this.currentPhase) return;
    
    const previousPhase = this.currentPhase;
    this.currentPhase = phase;
    this.currentProgress.phase = phase;
    
    this.emit('phase-change', `Phase changed: ${previousPhase} → ${phase}`, {
      previousPhase,
      newPhase: phase,
    });
  }
  
  /**
   * Enter recovery mode
   */
  enterRecoveryMode(reason: string): void {
    this.isRecovering = true;
    const previousPhase = this.currentPhase;
    this.currentPhase = 'recovering';
    this.currentProgress.phase = 'recovering';
    
    this.emit('pipeline-recovering', `Entering recovery mode: ${reason}`, {
      previousPhase,
      reason,
    });
  }
  
  /**
   * Exit recovery mode
   */
  exitRecoveryMode(): void {
    if (!this.isRecovering) return;
    
    this.isRecovering = false;
    this.currentPhase = 'compressing';
    this.currentProgress.phase = 'compressing';
    
    this.emit('pipeline-stable', 'Pipeline recovered - returning to stable state');
  }
  
  // ==========================================================================
  // PROGRESS UPDATES
  // ==========================================================================
  
  /**
   * Update progress
   */
  updateProgress(
    bytesProcessed: number,
    chunksProcessed: number,
    speed?: number
  ): void {
    // Calculate derived values
    const percentage = this.currentProgress.totalBytes > 0
      ? (bytesProcessed / this.currentProgress.totalBytes) * 100
      : 0;
    
    const calculatedSpeed = speed ?? this.calculateSpeed(bytesProcessed);
    const remaining = this.currentProgress.totalBytes - bytesProcessed;
    const eta = calculatedSpeed > 0 ? remaining / calculatedSpeed : 0;
    
    this.currentProgress = {
      ...this.currentProgress,
      bytesProcessed,
      chunksProcessed,
      percentage,
      speed: calculatedSpeed,
      eta,
    };
    
    // Throttle emissions
    const now = Date.now();
    if (now - this.lastEmitTime >= this.config.minEmitInterval) {
      this.emit('progress-update', this.formatProgressMessage());
    }
  }
  
  /**
   * Set current file
   */
  setCurrentFile(fileName: string, fileIndex?: number, totalFiles?: number): void {
    this.currentProgress.currentFile = fileName;
    if (fileIndex !== undefined) {
      this.currentProgress.filesProcessed = fileIndex;
    }
    if (totalFiles !== undefined) {
      this.currentProgress.totalFiles = totalFiles;
    }
  }
  
  // ==========================================================================
  // CHUNK EVENTS
  // ==========================================================================
  
  /**
   * Report chunk started
   */
  chunkStarted(chunkIndex: number, workerId?: string): void {
    this.emit('chunk-started', `Chunk ${chunkIndex} started`, {
      chunkIndex,
      workerId,
    });
  }
  
  /**
   * Report chunk completed
   */
  chunkCompleted(
    chunkIndex: number,
    bytesIn: number,
    bytesOut: number,
    processingTime: number
  ): void {
    this.emit('chunk-completed', `Chunk ${chunkIndex} completed (${processingTime.toFixed(0)}ms)`, {
      chunkIndex,
      bytesIn,
      bytesOut,
      processingTime,
      compressionRatio: bytesIn > 0 ? bytesOut / bytesIn : 1,
    });
  }
  
  /**
   * Report chunk retrying
   */
  chunkRetrying(chunkIndex: number, attempt: number, reason: string): void {
    this.emit('chunk-retrying', `Retrying chunk ${chunkIndex} (attempt ${attempt})`, {
      chunkIndex,
      attempt,
      reason,
    });
  }
  
  /**
   * Report chunk failed
   */
  chunkFailed(chunkIndex: number, error: string): void {
    this.emit('chunk-failed', `Chunk ${chunkIndex} failed: ${error}`, {
      chunkIndex,
      error,
    });
  }
  
  // ==========================================================================
  // WORKER EVENTS
  // ==========================================================================
  
  /**
   * Report worker restarting
   */
  workerRestarting(workerId: string, reason: string): void {
    this.emit('worker-restarting', `Worker ${workerId} restarting: ${reason}`, {
      workerId,
      reason,
    });
  }
  
  /**
   * Report worker restarted
   */
  workerRestarted(workerId: string, newWorkerId?: string): void {
    this.emit('worker-restarted', `Worker ${workerId} restarted successfully`, {
      workerId,
      newWorkerId,
    });
  }
  
  /**
   * Report worker failed permanently
   */
  workerFailed(workerId: string, error: string): void {
    this.emit('worker-failed', `Worker ${workerId} failed permanently: ${error}`, {
      workerId,
      error,
    });
  }
  
  // ==========================================================================
  // WASM EVENTS
  // ==========================================================================
  
  /**
   * Report WASM resetting
   */
  wasmResetting(workerId: string): void {
    this.emit('wasm-resetting', `Resetting WASM for worker ${workerId}`, {
      workerId,
    });
  }
  
  /**
   * Report WASM reset complete
   */
  wasmReset(workerId: string): void {
    this.emit('wasm-reset', `WASM reset complete for worker ${workerId}`, {
      workerId,
    });
  }
  
  // ==========================================================================
  // COMPLETION EVENTS
  // ==========================================================================
  
  /**
   * Report pipeline complete
   */
  complete(stats: {
    bytesIn: number;
    bytesOut: number;
    chunksProcessed: number;
    duration: number;
    retries: number;
    workerRestarts: number;
  }): void {
    this.currentPhase = 'complete';
    this.currentProgress.phase = 'complete';
    this.currentProgress.percentage = 100;
    
    this.emit('pipeline-complete', 'Compression complete!', {
      ...stats,
      compressionRatio: stats.bytesIn > 0 ? stats.bytesOut / stats.bytesIn : 1,
    });
    
    this.stop();
  }
  
  /**
   * Report pipeline error
   */
  error(message: string, details?: Record<string, unknown>): void {
    this.currentPhase = 'error';
    this.currentProgress.phase = 'error';
    
    this.emit('pipeline-error', `Error: ${message}`, details);
    
    this.stop();
  }
  
  /**
   * Report pipeline cancelled
   */
  cancelled(): void {
    this.currentPhase = 'cancelled';
    this.currentProgress.phase = 'cancelled';
    
    this.emit('pipeline-cancelled', 'Pipeline cancelled by user');
    
    this.stop();
  }
  
  /**
   * Report emergency recovery
   */
  emergencyRecovery(reason: string): void {
    this.emit('emergency-recovery', `EMERGENCY: ${reason}`, {
      reason,
    });
  }
  
  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================
  
  /**
   * Emit an event
   */
  private emit(
    type: PipelineEventType,
    message: string,
    details?: Record<string, unknown>,
    isHeartbeat = false
  ): void {
    const now = Date.now();
    
    // Skip heartbeats if there was recent activity
    if (isHeartbeat && now - this.lastEmitTime < this.config.heartbeatInterval / 2) {
      return;
    }
    
    const event: PipelineEvent = {
      id: `evt-${++this.eventIdCounter}`,
      type,
      timestamp: now,
      phase: this.currentPhase,
      progress: { ...this.currentProgress },
      message,
      details,
      isRecovery: this.isRecovering,
    };
    
    // Update last emit time
    this.lastEmitTime = now;
    this.totalEvents++;
    
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
    
    // Log if verbose
    if (this.config.verbose) {
      console.log(`[Progress] ${type}: ${message}`);
    }
    
    // Notify all handlers
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[ProgressGuarantee] Handler error:', error);
      }
    }
  }
  
  // ==========================================================================
  // EVENT SUBSCRIPTION
  // ==========================================================================
  
  /**
   * Subscribe to events
   */
  subscribe(handler: PipelineEventHandler): () => void {
    this.handlers.push(handler);
    
    // Send current state immediately
    handler({
      id: `evt-${++this.eventIdCounter}`,
      type: 'progress-update',
      timestamp: Date.now(),
      phase: this.currentPhase,
      progress: { ...this.currentProgress },
      message: 'Current progress state',
      isRecovery: this.isRecovering,
    });
    
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  /**
   * Calculate speed from history
   */
  private calculateSpeed(currentBytes: number): number {
    // Find progress updates in last 5 seconds
    const now = Date.now();
    const cutoff = now - 5000;
    
    const recentUpdates = this.eventHistory.filter(
      e => e.type === 'progress-update' && e.timestamp > cutoff
    );
    
    if (recentUpdates.length < 2) {
      // Use overall average
      const elapsed = (now - this.startTime) / 1000;
      return elapsed > 0 ? currentBytes / elapsed : 0;
    }
    
    const oldest = recentUpdates[0];
    const newest = recentUpdates[recentUpdates.length - 1];
    const timeDiff = (newest.timestamp - oldest.timestamp) / 1000;
    const bytesDiff = newest.progress.bytesProcessed - oldest.progress.bytesProcessed;
    
    return timeDiff > 0 ? bytesDiff / timeDiff : 0;
  }
  
  /**
   * Format progress message
   */
  private formatProgressMessage(): string {
    const p = this.currentProgress;
    const percent = p.percentage.toFixed(1);
    const speed = this.formatBytes(p.speed);
    const eta = this.formatDuration(p.eta);
    
    return `${percent}% complete - ${speed}/s - ETA: ${eta}`;
  }
  
  /**
   * Format bytes
   */
  private formatBytes(bytes: number): string {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
    if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${(bytes / GB).toFixed(2)} GB`;
  }
  
  /**
   * Format duration
   */
  private formatDuration(seconds: number): string {
    if (!isFinite(seconds) || seconds <= 0) return '--:--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  
  // ==========================================================================
  // STATISTICS
  // ==========================================================================
  
  /**
   * Get current state
   */
  getState(): {
    isRunning: boolean;
    isRecovering: boolean;
    phase: PipelinePhase;
    progress: PipelineProgress;
  } {
    return {
      isRunning: this.isRunning,
      isRecovering: this.isRecovering,
      phase: this.currentPhase,
      progress: { ...this.currentProgress },
    };
  }
  
  /**
   * Get event history
   */
  getHistory(limit = 100): PipelineEvent[] {
    return this.eventHistory.slice(-limit);
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    totalEvents: number;
    duration: number;
    eventsPerSecond: number;
  } {
    const duration = (Date.now() - this.startTime) / 1000;
    return {
      totalEvents: this.totalEvents,
      duration,
      eventsPerSecond: duration > 0 ? this.totalEvents / duration : 0,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalProgressSystem: ProgressGuaranteeSystem | null = null;

export function getProgressGuaranteeSystem(
  config?: Partial<ProgressGuaranteeConfig>
): ProgressGuaranteeSystem {
  if (!globalProgressSystem) {
    globalProgressSystem = new ProgressGuaranteeSystem(config);
  }
  return globalProgressSystem;
}

export function resetProgressGuaranteeSystem(): void {
  if (globalProgressSystem) {
    globalProgressSystem.reset();
    globalProgressSystem = null;
  }
}
