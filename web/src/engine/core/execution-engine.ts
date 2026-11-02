/**
 * SPK V30-V31 - Execution Engine
 * 
 * Unified compression engine that:
 * 1. Streams file chunks (no full memory load)
 * 2. Compresses each chunk in real-time
 * 3. Builds valid SPK archive
 * 4. Provides progress callbacks
 * 5. Handles errors with recovery
 * 6. Supports cancellation
 * 
 * This is the MAIN entry point for compression operations.
 */

import { ChunkProcessor, type ProcessedChunk, type CompressionMode } from './chunk-processor';
import { StreamReader, type StreamChunk } from './stream-reader';
import { ArchiveBuilder, type BuiltArchive, type ArchiveInfo } from './archive-builder';

// ============================================================================
// TYPES
// ============================================================================

export interface CompressionJob {
  id: string;
  file: File;
  settings: CompressionSettings;
  state: JobState;
  startTime: number;
  endTime?: number;
  
  // Progress
  bytesRead: number;
  bytesCompressed: number;
  chunksProcessed: number;
  totalChunks: number;
  
  // Result
  result?: BuiltArchive;
  error?: Error;
}

export interface CompressionSettings {
  mode: CompressionMode;
  chunkSize: number;
  enableDedup?: boolean;
  verifyHash?: boolean;
}

export type JobState = 
  | 'pending'
  | 'reading'
  | 'compressing'
  | 'finalizing'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface JobProgress {
  jobId: string;
  state: JobState;
  percent: number;
  bytesRead: number;
  bytesCompressed: number;
  chunksProcessed: number;
  totalChunks: number;
  speed: number; // bytes/sec
  eta: number; // seconds
  compressionRatio: number;
}

export interface JobResult {
  jobId: string;
  blob: Blob;
  downloadUrl: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  durationMs: number;
  averageSpeed: number;
  manifest: any;
}

export interface EngineCallbacks {
  onProgress?: (progress: JobProgress) => void;
  onComplete?: (result: JobResult) => void;
  onError?: (error: Error, jobId: string) => void;
  onStateChange?: (state: JobState, jobId: string) => void;
}

export interface EngineStats {
  isProcessing: boolean;
  activeJobId: string | null;
  jobsCompleted: number;
  jobsFailed: number;
  totalBytesProcessed: number;
  averageRatio: number;
}

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

const DEFAULT_SETTINGS: CompressionSettings = {
  mode: 'balanced',
  chunkSize: 4 * 1024 * 1024, // 4MB
  enableDedup: false,
  verifyHash: true,
};

// ============================================================================
// EXECUTION ENGINE CLASS
// ============================================================================

export class ExecutionEngine {
  private processor: ChunkProcessor;
  private callbacks: EngineCallbacks = {};
  
  // State
  private activeJob: CompressionJob | null = null;
  private abortController: AbortController | null = null;
  
  // Stats
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private totalBytesProcessed = 0;
  
  // Speed tracking
  private speedSamples: Array<{ time: number; bytes: number }> = [];
  private lastProgressUpdate = 0;
  private readonly progressThrottleMs = 33; // ~30Hz
  
  constructor() {
    this.processor = new ChunkProcessor();
  }
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  /**
   * Initialize the engine
   */
  async initialize(): Promise<void> {
    await this.processor.initWasm();
  }
  
  /**
   * Set callbacks for progress/completion
   */
  setCallbacks(callbacks: EngineCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }
  
  /**
   * Compress a file
   * Returns job ID immediately, results via callbacks
   */
  async compress(
    file: File, 
    settings?: Partial<CompressionSettings>
  ): Promise<string> {
    if (this.activeJob) {
      throw new Error('Engine is busy with another job');
    }
    
    const finalSettings = { ...DEFAULT_SETTINGS, ...settings };
    const jobId = this.generateJobId();
    
    // Create job
    this.activeJob = {
      id: jobId,
      file,
      settings: finalSettings,
      state: 'pending',
      startTime: Date.now(),
      bytesRead: 0,
      bytesCompressed: 0,
      chunksProcessed: 0,
      totalChunks: Math.ceil(file.size / finalSettings.chunkSize),
    };
    
    this.abortController = new AbortController();
    this.speedSamples = [];
    
    // Start compression in background
    this.runCompression(this.activeJob, finalSettings)
      .catch(error => {
        if (error.name !== 'AbortError') {
          this.handleError(error, jobId);
        }
      });
    
    return jobId;
  }
  
  /**
   * Cancel active job
   */
  cancel(): void {
    if (!this.activeJob) return;
    
    this.abortController?.abort();
    this.activeJob.state = 'cancelled';
    this.updateState('cancelled');
    
    this.cleanup();
  }
  
  /**
   * Get engine statistics
   */
  getStats(): EngineStats {
    return {
      isProcessing: this.activeJob !== null,
      activeJobId: this.activeJob?.id ?? null,
      jobsCompleted: this.jobsCompleted,
      jobsFailed: this.jobsFailed,
      totalBytesProcessed: this.totalBytesProcessed,
      averageRatio: this.processor.getStats().averageRatio,
    };
  }
  
  /**
   * Check if engine is ready
   */
  isReady(): boolean {
    return this.processor.isReady();
  }
  
  /**
   * Check if engine is processing
   */
  isProcessing(): boolean {
    return this.activeJob !== null;
  }
  
  // ==========================================================================
  // COMPRESSION PIPELINE
  // ==========================================================================
  
  /**
   * Main compression pipeline
   */
  private async runCompression(
    job: CompressionJob, 
    settings: CompressionSettings
  ): Promise<void> {
    const { file } = job;
    
    // Update processor mode
    this.processor = new ChunkProcessor({ mode: settings.mode });
    await this.processor.initWasm();
    
    // Create archive builder
    const archiveInfo: ArchiveInfo = {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      originalSize: file.size,
      chunkSize: settings.chunkSize,
      compressionMode: settings.mode,
      createdAt: Date.now(),
    };
    
    const builder = new ArchiveBuilder(archiveInfo);
    
    // Process chunks
    this.updateState('reading');
    
    const processedChunks: ProcessedChunk[] = [];
    
    // Create stream reader with callbacks
    const reader = new StreamReader({
      chunkSize: settings.chunkSize,
      
      onChunk: async (streamChunk: StreamChunk) => {
        // Check for abort
        if (this.abortController?.signal.aborted) {
          throw new Error('AbortError');
        }
        
        job.state = 'compressing';
        
        // Process chunk
        const processed = await this.processor.processChunk(
          streamChunk.data, 
          streamChunk.index
        );
        
        processedChunks.push(processed);
        
        // Update job stats
        job.bytesRead += streamChunk.size;
        job.bytesCompressed += processed.compressedSize;
        job.chunksProcessed++;
        
        // Report progress
        this.reportProgress(job);
      },
      
      onProgress: (_bytesRead, _totalBytes) => {
        // Low-level progress (tracked in onChunk instead)
      },
      
      onError: (error) => {
        throw error;
      },
    });
    
    // Stream and process all chunks
    await reader.read(file);
    
    // Check abort
    if (this.abortController?.signal.aborted) {
      return;
    }
    
    // Finalize
    this.updateState('finalizing');
    
    // Sort chunks by index and add to builder
    processedChunks.sort((a, b) => a.index - b.index);
    builder.addChunks(processedChunks);
    
    // Build archive
    const archive = builder.build();
    
    // Complete
    job.state = 'complete';
    job.endTime = Date.now();
    job.result = archive;
    
    const durationMs = job.endTime - job.startTime;
    const averageSpeed = file.size / (durationMs / 1000);
    
    const result: JobResult = {
      jobId: job.id,
      blob: archive.blob,
      downloadUrl: URL.createObjectURL(archive.blob),
      originalSize: archive.originalSize,
      compressedSize: archive.compressedSize,
      ratio: archive.ratio,
      durationMs,
      averageSpeed,
      manifest: archive.manifest,
    };
    
    // Update stats
    this.jobsCompleted++;
    this.totalBytesProcessed += file.size;
    
    // Notify
    this.updateState('complete');
    this.callbacks.onComplete?.(result);
    
    // Cleanup
    this.cleanup();
  }
  
  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================
  
  /**
   * Report progress (throttled)
   */
  private reportProgress(job: CompressionJob): void {
    const now = Date.now();
    
    // Throttle updates
    if (now - this.lastProgressUpdate < this.progressThrottleMs) {
      return;
    }
    this.lastProgressUpdate = now;
    
    // Add speed sample
    this.speedSamples.push({ time: now, bytes: job.bytesRead });
    
    // Keep only last 50 samples
    while (this.speedSamples.length > 50) {
      this.speedSamples.shift();
    }
    
    // Calculate speed (5-second rolling average)
    const speed = this.calculateSpeed();
    
    // Calculate ETA
    const remaining = job.file.size - job.bytesRead;
    const eta = speed > 0 ? remaining / speed : Infinity;
    
    // Calculate ratio
    const ratio = job.bytesRead > 0 
      ? job.bytesCompressed / job.bytesRead 
      : 1;
    
    const progress: JobProgress = {
      jobId: job.id,
      state: job.state,
      percent: (job.chunksProcessed / job.totalChunks) * 100,
      bytesRead: job.bytesRead,
      bytesCompressed: job.bytesCompressed,
      chunksProcessed: job.chunksProcessed,
      totalChunks: job.totalChunks,
      speed,
      eta,
      compressionRatio: ratio,
    };
    
    this.callbacks.onProgress?.(progress);
  }
  
  /**
   * Calculate current speed
   */
  private calculateSpeed(): number {
    if (this.speedSamples.length < 2) return 0;
    
    const now = Date.now();
    const windowStart = now - 5000; // 5-second window
    const samples = this.speedSamples.filter(s => s.time >= windowStart);
    
    if (samples.length < 2) return 0;
    
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = (last.time - first.time) / 1000;
    const bytes = last.bytes - first.bytes;
    
    return dt > 0 ? bytes / dt : 0;
  }
  
  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================
  
  /**
   * Update job state and notify
   */
  private updateState(state: JobState): void {
    if (this.activeJob) {
      this.activeJob.state = state;
      this.callbacks.onStateChange?.(state, this.activeJob.id);
    }
  }
  
  /**
   * Handle error
   */
  private handleError(error: Error, jobId: string): void {
    if (this.activeJob) {
      this.activeJob.state = 'error';
      this.activeJob.error = error;
    }
    
    this.jobsFailed++;
    this.callbacks.onError?.(error, jobId);
    this.cleanup();
  }
  
  /**
   * Cleanup after job
   */
  private cleanup(): void {
    this.processor.reset();
    this.activeJob = null;
    this.abortController = null;
    this.speedSamples = [];
  }
  
  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    return `spk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let engineInstance: ExecutionEngine | null = null;

/**
 * Get or create engine instance
 */
export function getEngine(): ExecutionEngine {
  if (!engineInstance) {
    engineInstance = new ExecutionEngine();
  }
  return engineInstance;
}

/**
 * Reset engine instance
 */
export function resetEngine(): void {
  if (engineInstance) {
    engineInstance.cancel();
    engineInstance = null;
  }
}

// ============================================================================
// SIMPLE API
// ============================================================================

/**
 * Simple one-shot compression function
 * For UI integration
 */
export async function compressFile(
  file: File,
  settings?: Partial<CompressionSettings>,
  onProgress?: (progress: JobProgress) => void
): Promise<JobResult> {
  const engine = getEngine();
  
  if (!engine.isReady()) {
    await engine.initialize();
  }
  
  return new Promise((resolve, reject) => {
    engine.setCallbacks({
      onProgress,
      onComplete: resolve,
      onError: (error) => reject(error),
    });
    
    engine.compress(file, settings).catch(reject);
  });
}
