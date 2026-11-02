/**
 * SPK Background Checkpointing System
 * 
 * Automatic checkpointing triggered by various events:
 * - Every N chunks (configurable)
 * - On partition boundaries
 * - On visibility change (tab switch, minimize)
 * - On memory pressure
 * - Periodic time-based
 * 
 * Features:
 * - Non-blocking checkpoint saves
 * - Debounced frequent triggers
 * - Priority-based checkpoint scheduling
 * - Checkpoint compression for large states
 * 
 * Creator: Onazi Treasure (OJ)
 */

import { 
  getCheckpointManager, 
  CheckpointState,
} from './checkpoint-manager';
import { getMetadataBuilder } from './incremental-metadata';
import { getPartitionManager } from './partition-resume';
import { getAIStateManager } from './ai-state-restoration';
import { getSafeWriter } from './checkpoint-safe-writer';

// ============================================================================
// Types
// ============================================================================

export type CheckpointTrigger = 
  | 'chunk-count'
  | 'partition-boundary'
  | 'visibility-change'
  | 'memory-pressure'
  | 'periodic'
  | 'manual'
  | 'error';

export interface CheckpointConfig {
  chunkInterval: number;         // Save every N chunks
  timeIntervalMs: number;        // Save every N milliseconds
  minIntervalMs: number;         // Minimum time between saves
  enableVisibilityTrigger: boolean;
  enableMemoryTrigger: boolean;
  memoryThreshold: number;       // 0-1, trigger at this memory pressure
  debounceMs: number;            // Debounce rapid triggers
  maxPendingCheckpoints: number; // Queue limit
}

export interface CheckpointEvent {
  trigger: CheckpointTrigger;
  timestamp: number;
  priority: number; // Higher = more urgent
  metadata: Record<string, unknown>;
}

export interface CheckpointResult {
  success: boolean;
  trigger: CheckpointTrigger;
  duration: number;
  bytesWritten: number;
  error?: string;
}

// ============================================================================
// BackgroundCheckpointer
// ============================================================================

const DEFAULT_CONFIG: CheckpointConfig = {
  chunkInterval: 100,
  timeIntervalMs: 30000, // 30 seconds
  minIntervalMs: 5000,   // 5 seconds minimum
  enableVisibilityTrigger: true,
  enableMemoryTrigger: true,
  memoryThreshold: 0.8,
  debounceMs: 1000,
  maxPendingCheckpoints: 3,
};

export class BackgroundCheckpointer {
  private config: CheckpointConfig;
  private checkpointManager = getCheckpointManager();
  
  // Current job state
  private currentJobId: string | null = null;
  private currentJobName: string = '';
  private totalFiles: number = 0;
  private totalChunks: number = 0;
  
  // Tracking
  private chunksSinceLastCheckpoint = 0;
  private lastCheckpointTime = 0;
  private pendingCheckpoints: CheckpointEvent[] = [];
  private isCheckpointing = false;
  
  // Timers and listeners
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityHandler: (() => void) | null = null;
  
  // Callbacks
  private onCheckpointCallbacks: ((result: CheckpointResult) => void)[] = [];
  
  constructor(config: Partial<CheckpointConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Start checkpointing for a job
   */
  start(
    jobId: string,
    jobName: string,
    totalFiles: number,
    totalChunks: number
  ): void {
    this.currentJobId = jobId;
    this.currentJobName = jobName;
    this.totalFiles = totalFiles;
    this.totalChunks = totalChunks;
    this.chunksSinceLastCheckpoint = 0;
    this.lastCheckpointTime = Date.now();
    
    // Start periodic timer
    this.periodicTimer = setInterval(() => {
      this.queueCheckpoint('periodic', 1);
    }, this.config.timeIntervalMs);
    
    // Add visibility listener
    if (this.config.enableVisibilityTrigger && typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
          this.queueCheckpoint('visibility-change', 3);
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    
    // Add memory pressure listener
    if (this.config.enableMemoryTrigger && typeof performance !== 'undefined') {
      this.startMemoryMonitoring();
    }
  }
  
  /**
   * Stop checkpointing
   */
  stop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    
    this.currentJobId = null;
    this.pendingCheckpoints = [];
  }
  
  /**
   * Notify that a chunk was processed
   */
  onChunkProcessed(chunkIndex: number): void {
    this.chunksSinceLastCheckpoint++;
    
    if (this.chunksSinceLastCheckpoint >= this.config.chunkInterval) {
      this.queueCheckpoint('chunk-count', 2, { chunkIndex });
    }
  }
  
  /**
   * Notify that a partition boundary was reached
   */
  onPartitionBoundary(partitionIndex: number): void {
    this.queueCheckpoint('partition-boundary', 4, { partitionIndex });
  }
  
  /**
   * Trigger manual checkpoint
   */
  triggerManual(): void {
    this.queueCheckpoint('manual', 5);
  }
  
  /**
   * Trigger checkpoint on error
   */
  onError(error: string): void {
    this.queueCheckpoint('error', 5, { error });
  }
  
  /**
   * Register checkpoint callback
   */
  onCheckpoint(callback: (result: CheckpointResult) => void): () => void {
    this.onCheckpointCallbacks.push(callback);
    return () => {
      this.onCheckpointCallbacks = this.onCheckpointCallbacks.filter(
        cb => cb !== callback
      );
    };
  }
  
  /**
   * Queue a checkpoint event
   */
  private queueCheckpoint(
    trigger: CheckpointTrigger,
    priority: number,
    metadata: Record<string, unknown> = {}
  ): void {
    // Check minimum interval
    const now = Date.now();
    if (now - this.lastCheckpointTime < this.config.minIntervalMs) {
      // Too soon, skip unless high priority
      if (priority < 4) return;
    }
    
    // Add to queue
    const event: CheckpointEvent = {
      trigger,
      timestamp: now,
      priority,
      metadata,
    };
    
    this.pendingCheckpoints.push(event);
    
    // Sort by priority (highest first)
    this.pendingCheckpoints.sort((a, b) => b.priority - a.priority);
    
    // Trim queue
    if (this.pendingCheckpoints.length > this.config.maxPendingCheckpoints) {
      this.pendingCheckpoints = this.pendingCheckpoints.slice(
        0, 
        this.config.maxPendingCheckpoints
      );
    }
    
    // Debounce execution
    this.scheduleCheckpoint();
  }
  
  /**
   * Schedule checkpoint execution
   */
  private scheduleCheckpoint(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.executeCheckpoint();
    }, this.config.debounceMs);
  }
  
  /**
   * Execute the highest priority pending checkpoint
   */
  private async executeCheckpoint(): Promise<void> {
    if (this.isCheckpointing || !this.currentJobId) return;
    if (this.pendingCheckpoints.length === 0) return;
    
    this.isCheckpointing = true;
    const startTime = Date.now();
    
    // Get highest priority event
    const event = this.pendingCheckpoints.shift()!;
    
    try {
      // Build checkpoint state
      const state = await this.buildCheckpointState();
      
      // Save to IndexedDB
      await this.checkpointManager.save(state);
      
      const duration = Date.now() - startTime;
      
      // Update tracking
      this.lastCheckpointTime = Date.now();
      this.chunksSinceLastCheckpoint = 0;
      
      // Notify callbacks
      const result: CheckpointResult = {
        success: true,
        trigger: event.trigger,
        duration,
        bytesWritten: 0, // Would need serialized size
      };
      
      this.notifyCallbacks(result);
      
    } catch (error) {
      const result: CheckpointResult = {
        success: false,
        trigger: event.trigger,
        duration: Date.now() - startTime,
        bytesWritten: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      
      this.notifyCallbacks(result);
      
    } finally {
      this.isCheckpointing = false;
      
      // Process next pending if any
      if (this.pendingCheckpoints.length > 0) {
        this.scheduleCheckpoint();
      }
    }
  }
  
  /**
   * Build checkpoint state from all managers
   */
  private async buildCheckpointState(): Promise<CheckpointState> {
    const metadataBuilder = getMetadataBuilder();
    const partitionManager = getPartitionManager();
    const aiStateManager = getAIStateManager();
    const safeWriter = getSafeWriter();
    
    // Get partition state
    const partitionState = partitionManager.exportState();
    
    // Get metadata state
    const metadataState = metadataBuilder.exportState();
    
    // Get AI state
    const aiState = aiStateManager.exportState();
    
    // Get writer state
    const writerOffsets = safeWriter.getOffsetTable();
    
    // Build completed chunks set
    const completedChunks = new Set<number>();
    for (const entry of metadataState.activeEntries) {
      completedChunks.add(entry.index);
    }
    
    return {
      jobId: this.currentJobId!,
      jobName: this.currentJobName,
      createdAt: this.lastCheckpointTime || Date.now(),
      updatedAt: Date.now(),
      
      currentFileIndex: 0, // Would need actual tracking
      totalFiles: this.totalFiles,
      
      currentChunkIndex: metadataState.totals.chunks,
      totalChunks: this.totalChunks,
      completedChunks,
      pendingChunks: partitionState.pendingChunks,
      
      partitionIndex: partitionState.currentPartitionIndex,
      totalPartitions: partitionState.totalPartitions,
      partitionByteOffsets: partitionState.byteOffsets.partitionBoundaries,
      
      chunkTable: metadataState.activeEntries,
      refinedChunks: [],
      refinementPasses: 0,
      
      entropySignatures: new Map(),
      aiState,
      schedulerLaneAssignments: [],
      writerOffsets,
      metadataDeltas: metadataState.deltas,
      
      checksum: '',
      version: 1,
    };
  }
  
  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    // Check memory periodically
    setInterval(() => {
      if ('memory' in performance) {
        const memory = (performance as unknown as { memory: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
        const usage = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        
        if (usage > this.config.memoryThreshold) {
          this.queueCheckpoint('memory-pressure', 4, { memoryUsage: usage });
        }
      }
    }, 5000);
  }
  
  /**
   * Notify all callbacks
   */
  private notifyCallbacks(result: CheckpointResult): void {
    for (const callback of this.onCheckpointCallbacks) {
      try {
        callback(result);
      } catch (error) {
        console.error('Checkpoint callback error:', error);
      }
    }
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let backgroundCheckpointerInstance: BackgroundCheckpointer | null = null;

export function getBackgroundCheckpointer(): BackgroundCheckpointer {
  if (!backgroundCheckpointerInstance) {
    backgroundCheckpointerInstance = new BackgroundCheckpointer();
  }
  return backgroundCheckpointerInstance;
}

export function resetBackgroundCheckpointer(): void {
  backgroundCheckpointerInstance?.stop();
  backgroundCheckpointerInstance = null;
}

export function createBackgroundCheckpointer(
  config?: Partial<CheckpointConfig>
): BackgroundCheckpointer {
  return new BackgroundCheckpointer(config);
}
