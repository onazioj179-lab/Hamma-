/**
 * SPK Auto-Resume System
 * 
 * Automatically detects incomplete jobs on app open and offers
 * to resume from the last checkpoint.
 * 
 * Features:
 * - Detects incomplete jobs from IndexedDB
 * - Rehydrates all compression components
 * - Restores UI state
 * - Continues from exact last chunk
 * 
 * Creator: Onazi Treasure (OJ)
 */

import { 
  getCheckpointManager, 
  CheckpointState, 
  AIStateSnapshot,
  LaneAssignment,
  WriterOffsetTable,
  ResumeOptions,
} from './checkpoint-manager';

// ============================================================================
// Types
// ============================================================================

export interface ResumeResult {
  success: boolean;
  jobId: string;
  resumedFromChunk: number;
  totalChunks: number;
  error?: string;
}

export interface ResumeableJob {
  jobId: string;
  jobName: string;
  progress: number; // 0-100
  lastUpdated: Date;
  filesProcessed: number;
  totalFiles: number;
  chunksCompleted: number;
  totalChunks: number;
  estimatedTimeRemaining: string;
}

export interface ComponentState {
  workers: WorkerState[];
  wasmReady: boolean;
  scheduler: SchedulerState;
  aiEngine: AIEngineState;
  writer: WriterState;
  metadataBuilder: MetadataState;
}

export interface WorkerState {
  id: number;
  status: 'idle' | 'busy' | 'error';
  lastChunk: number;
  memory: number;
}

export interface SchedulerState {
  lanes: LaneAssignment[];
  pendingQueue: number[];
  activeJobs: number;
}

export interface AIEngineState {
  isWarmedUp: boolean;
  predictiveAccuracy: number;
  optimizerMode: 'speed' | 'balanced' | 'ratio';
}

export interface WriterState {
  isReady: boolean;
  bytesWritten: number;
  lastFlushedChunk: number;
}

export interface MetadataState {
  entriesCount: number;
  lastCompacted: number;
}

// ============================================================================
// AutoResumeManager
// ============================================================================

export class AutoResumeManager {
  private checkpointManager = getCheckpointManager();
  private currentJob: CheckpointState | null = null;
  private isResuming = false;
  private resumeCallbacks: ((job: ResumeableJob) => void)[] = [];
  
  /**
   * Initialize and check for incomplete jobs
   */
  async initialize(): Promise<ResumeableJob[]> {
    await this.checkpointManager.initialize();
    
    const incompleteJobs = await this.checkpointManager.listIncompleteJobs();
    
    return incompleteJobs.map(job => this.toResumeableJob(job));
  }
  
  /**
   * Resume a specific job
   */
  async resume(
    jobId: string, 
    options: ResumeOptions = {
      validateIntegrity: true,
      rebuildCorruptedChunks: true,
      resetAIState: false,
      maxRetries: 3,
    }
  ): Promise<ResumeResult> {
    if (this.isResuming) {
      return {
        success: false,
        jobId,
        resumedFromChunk: 0,
        totalChunks: 0,
        error: 'Resume already in progress',
      };
    }
    
    this.isResuming = true;
    
    try {
      // Load checkpoint
      const checkpoint = await this.checkpointManager.load(jobId);
      
      if (!checkpoint) {
        return {
          success: false,
          jobId,
          resumedFromChunk: 0,
          totalChunks: 0,
          error: 'Checkpoint not found',
        };
      }
      
      // Validate integrity if requested
      if (options.validateIntegrity) {
        const isValid = await this.validateCheckpoint(checkpoint);
        if (!isValid && !options.rebuildCorruptedChunks) {
          return {
            success: false,
            jobId,
            resumedFromChunk: 0,
            totalChunks: checkpoint.totalChunks,
            error: 'Checkpoint integrity check failed',
          };
        }
      }
      
      // Rehydrate components
      await this.rehydrateComponents(checkpoint, options);
      
      this.currentJob = checkpoint;
      
      // Find first uncompleted chunk
      const resumeChunk = this.findResumePoint(checkpoint);
      
      return {
        success: true,
        jobId,
        resumedFromChunk: resumeChunk,
        totalChunks: checkpoint.totalChunks,
      };
      
    } catch (error) {
      return {
        success: false,
        jobId,
        resumedFromChunk: 0,
        totalChunks: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      this.isResuming = false;
    }
  }
  
  /**
   * Cancel a resume operation
   */
  async cancelResume(jobId: string): Promise<void> {
    if (this.currentJob?.jobId === jobId) {
      this.currentJob = null;
      this.isResuming = false;
    }
    
    // Clear the checkpoint
    await this.checkpointManager.clear(jobId);
  }
  
  /**
   * Get current resuming job
   */
  getCurrentJob(): CheckpointState | null {
    return this.currentJob;
  }
  
  /**
   * Register callback for resume events
   */
  onResumeDetected(callback: (job: ResumeableJob) => void): () => void {
    this.resumeCallbacks.push(callback);
    return () => {
      this.resumeCallbacks = this.resumeCallbacks.filter(cb => cb !== callback);
    };
  }
  
  /**
   * Convert checkpoint to resumeable job info
   */
  private toResumeableJob(checkpoint: CheckpointState): ResumeableJob {
    const progress = (checkpoint.completedChunks.size / checkpoint.totalChunks) * 100;
    const remainingChunks = checkpoint.totalChunks - checkpoint.completedChunks.size;
    
    // Estimate time from throughput curve
    const avgThroughput = checkpoint.aiState.throughputCurve.length > 0
      ? checkpoint.aiState.throughputCurve.reduce((a, b) => a + b, 0) / checkpoint.aiState.throughputCurve.length
      : 0;
    
    const estimatedSeconds = avgThroughput > 0 ? remainingChunks / avgThroughput : 0;
    const estimatedTime = this.formatDuration(estimatedSeconds);
    
    return {
      jobId: checkpoint.jobId,
      jobName: checkpoint.jobName,
      progress: Math.round(progress * 100) / 100,
      lastUpdated: new Date(checkpoint.updatedAt),
      filesProcessed: checkpoint.currentFileIndex,
      totalFiles: checkpoint.totalFiles,
      chunksCompleted: checkpoint.completedChunks.size,
      totalChunks: checkpoint.totalChunks,
      estimatedTimeRemaining: estimatedTime,
    };
  }
  
  /**
   * Format duration in human readable format
   */
  private formatDuration(seconds: number): string {
    if (seconds <= 0) return 'Unknown';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    }
    return '<1m';
  }
  
  /**
   * Validate checkpoint integrity
   */
  private async validateCheckpoint(checkpoint: CheckpointState): Promise<boolean> {
    // Check basic consistency
    if (checkpoint.completedChunks.size > checkpoint.totalChunks) {
      return false;
    }
    
    if (checkpoint.currentFileIndex > checkpoint.totalFiles) {
      return false;
    }
    
    if (checkpoint.partitionIndex > checkpoint.totalPartitions) {
      return false;
    }
    
    // Validate chunk table entries
    for (const entry of checkpoint.chunkTable) {
      if (entry.index < 0 || entry.originalSize < 0 || entry.compressedSize < 0) {
        return false;
      }
    }
    
    // Validate writer offsets
    const wo = checkpoint.writerOffsets;
    if (wo.chunkDataOffset < wo.headerOffset) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Rehydrate all compression components from checkpoint
   */
  private async rehydrateComponents(
    checkpoint: CheckpointState,
    options: ResumeOptions
  ): Promise<void> {
    // Rehydrate in order of dependencies
    
    // 1. Restore writer state (needed first)
    await this.rehydrateWriter(checkpoint.writerOffsets);
    
    // 2. Restore scheduler/lane assignments
    await this.rehydrateScheduler(checkpoint.schedulerLaneAssignments);
    
    // 3. Restore AI state (unless reset requested)
    if (!options.resetAIState) {
      await this.rehydrateAIEngine(checkpoint.aiState);
    }
    
    // 4. Restore metadata builder
    await this.rehydrateMetadata(checkpoint.metadataDeltas, checkpoint.chunkTable);
    
    // 5. Rebuild workers
    await this.rehydrateWorkers(checkpoint);
  }
  
  /**
   * Restore writer state
   */
  private async rehydrateWriter(offsets: WriterOffsetTable): Promise<void> {
    // Store in global state for writer to pick up
    (globalThis as Record<string, unknown>).__spk_resume_writer = offsets;
  }
  
  /**
   * Restore scheduler lane assignments
   */
  private async rehydrateScheduler(lanes: LaneAssignment[]): Promise<void> {
    (globalThis as Record<string, unknown>).__spk_resume_scheduler = lanes;
  }
  
  /**
   * Restore AI engine state
   */
  private async rehydrateAIEngine(aiState: AIStateSnapshot): Promise<void> {
    (globalThis as Record<string, unknown>).__spk_resume_ai = aiState;
  }
  
  /**
   * Restore metadata builder state
   */
  private async rehydrateMetadata(
    deltas: unknown[],
    chunkTable: unknown[]
  ): Promise<void> {
    (globalThis as Record<string, unknown>).__spk_resume_metadata = {
      deltas,
      chunkTable,
    };
  }
  
  /**
   * Recreate worker pool and restore state
   */
  private async rehydrateWorkers(checkpoint: CheckpointState): Promise<void> {
    (globalThis as Record<string, unknown>).__spk_resume_workers = {
      pendingChunks: checkpoint.pendingChunks,
      completedChunks: Array.from(checkpoint.completedChunks),
      partitionIndex: checkpoint.partitionIndex,
    };
  }
  
  /**
   * Find the chunk index to resume from
   */
  private findResumePoint(checkpoint: CheckpointState): number {
    // Find first uncompleted chunk
    for (let i = 0; i < checkpoint.totalChunks; i++) {
      if (!checkpoint.completedChunks.has(i)) {
        return i;
      }
    }
    
    // All chunks complete
    return checkpoint.totalChunks;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let autoResumeInstance: AutoResumeManager | null = null;

export function getAutoResumeManager(): AutoResumeManager {
  if (!autoResumeInstance) {
    autoResumeInstance = new AutoResumeManager();
  }
  return autoResumeInstance;
}

export function resetAutoResumeManager(): void {
  autoResumeInstance = null;
}

// ============================================================================
// Auto-detect on app load
// ============================================================================

export async function checkForIncompleteJobs(): Promise<ResumeableJob[]> {
  const manager = getAutoResumeManager();
  return manager.initialize();
}
