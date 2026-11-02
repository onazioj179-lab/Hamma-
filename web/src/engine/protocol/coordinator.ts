/**
 * SPK V29 - Pipeline Coordinator
 * 
 * Central orchestrator for compression pipeline:
 * - Manages job lifecycle
 * - Enforces chunk ordering
 * - Controls backpressure
 * - Handles error recovery
 * - Provides real-time telemetry
 * 
 * Memory-safe for 1TB+ files
 */

import {
  type JobId,
  type ChunkSeq,
  type CompressionSettings,
  type JobContext,
  type JobState,
  type JobProgress,
  type JobTelemetry,
  type JobResult,
  type JobError,
  type PendingChunk,
  type RetryState,
  type CompressedChunk,
  type SpeedSample,
  type ArchiveManifest,
  type ChunkInfo,
  type CoordinatorStats,
  type WorkerStatus,
  type UIMessage,
  type CoordinatorToWorkerMessage,
  type WorkerToCoordinatorMessage,
  type CoordinatorToUIMessage,
  type WorkerCapabilities,
  ErrorCode,
  DEFAULT_SETTINGS,
  BACKPRESSURE_HIGH_WATER,
  BACKPRESSURE_LOW_WATER,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_MS,
  TELEMETRY_INTERVAL_MS,
  WORKER_MEMORY_LIMIT,
  generateJobId,
} from './types';

import { calculateAdaptiveChunkSize } from '../pipeline/universal';

// ============================================================================
// COORDINATOR CONFIGURATION
// ============================================================================

export interface CoordinatorConfig {
  /** Path to WASM file */
  wasmPath?: string;
  /** Maximum concurrent pending chunks */
  maxPendingChunks: number;
  /** Telemetry update interval in ms */
  telemetryIntervalMs: number;
  /** Maximum retry attempts per chunk */
  maxRetries: number;
  /** Backpressure high water mark */
  backpressureHighWater: number;
  /** Backpressure low water mark */
  backpressureLowWater: number;
  /** Memory limit for worker */
  workerMemoryLimit: number;
  /** Speed sample window size */
  speedSampleWindow: number;
  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  wasmPath: '/spk_core.wasm',
  maxPendingChunks: BACKPRESSURE_HIGH_WATER,
  telemetryIntervalMs: TELEMETRY_INTERVAL_MS,
  maxRetries: MAX_RETRY_ATTEMPTS,
  backpressureHighWater: BACKPRESSURE_HIGH_WATER,
  backpressureLowWater: BACKPRESSURE_LOW_WATER,
  workerMemoryLimit: WORKER_MEMORY_LIMIT,
  speedSampleWindow: 50, // 50 samples
  debug: false,
};

// ============================================================================
// COORDINATOR EVENTS
// ============================================================================

export type CoordinatorEventType = 
  | 'ready'
  | 'jobStarted'
  | 'progress'
  | 'jobComplete'
  | 'jobCancelled'
  | 'jobError'
  | 'workerStatus'
  | 'backpressure';

export interface CoordinatorEvents {
  ready: () => void;
  jobStarted: (jobId: JobId, totalBytes: number, totalChunks: number) => void;
  progress: (jobId: JobId, progress: JobProgress, telemetry: JobTelemetry) => void;
  jobComplete: (jobId: JobId, result: JobResult) => void;
  jobCancelled: (jobId: JobId, bytesProcessed: number, chunksProcessed: number) => void;
  jobError: (jobId: JobId, error: JobError) => void;
  workerStatus: (status: WorkerStatus) => void;
  backpressure: (jobId: JobId, on: boolean) => void;
}

// ============================================================================
// COORDINATOR CLASS
// ============================================================================

export class Coordinator {
  private config: CoordinatorConfig;
  private worker: Worker | null = null;
  private workerReady = false;
  private wasmReady = false;
  private workerCapabilities: WorkerCapabilities | null = null;
  
  // Job management
  private activeJob: JobContext | null = null;
  private jobQueue: JobContext[] = [];
  
  // Backpressure
  private backpressureActive = false;
  private pendingChunkCount = 0;
  
  // Telemetry
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private totalBytesProcessed = 0;
  
  // Event listeners
  private eventListeners: Map<CoordinatorEventType, Set<Function>> = new Map();
  
  // File reader for streaming
  private fileReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readBuffer: Uint8Array[] = [];
  private bufferOffset = 0;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Initialize coordinator and worker
   */
  async initialize(): Promise<void> {
    this.log('Initializing coordinator...');
    
    // Create worker
    this.worker = new Worker(
      new URL('../worker/v29.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    // Setup message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
    this.worker.onerror = this.handleWorkerError.bind(this);
    
    // Wait for worker ready
    await this.waitForWorkerReady();
    
    // Initialize WASM
    this.sendToWorker({ type: 'INIT_WASM', wasmPath: this.config.wasmPath });
    await this.waitForWasmReady();
    
    this.log('Coordinator initialized');
    this.emit('ready');
  }

  /**
   * Shutdown coordinator
   */
  async shutdown(): Promise<void> {
    this.log('Shutting down coordinator...');
    
    // Cancel active job
    if (this.activeJob) {
      await this.cancelJob(this.activeJob.id);
    }
    
    // Stop telemetry
    this.stopTelemetry();
    
    // Terminate worker
    if (this.worker) {
      this.sendToWorker({ type: 'SHUTDOWN' });
      this.worker.terminate();
      this.worker = null;
    }
    
    this.workerReady = false;
    this.wasmReady = false;
  }

  /**
   * Check if coordinator is ready
   */
  isReady(): boolean {
    return this.workerReady && this.wasmReady;
  }

  // ==========================================================================
  // JOB MANAGEMENT
  // ==========================================================================

  /**
   * Start a compression job
   */
  async startJob(file: File, settings: Partial<CompressionSettings> = {}): Promise<JobId> {
    if (!this.isReady()) {
      throw new Error('Coordinator not ready');
    }
    
    const jobId = generateJobId();
    const finalSettings: CompressionSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      chunkSize: settings.chunkSize || calculateAdaptiveChunkSize(file.size),
    };
    
    const totalChunks = Math.ceil(file.size / finalSettings.chunkSize);
    
    // Create job context
    const job: JobContext = {
      id: jobId,
      state: 'pending',
      file,
      settings: finalSettings,
      startTime: Date.now(),
      totalChunks,
      chunksProcessed: new Set(),
      chunksPending: new Map(),
      chunksRetrying: new Map(),
      compressedChunks: new Map(),
      bytesRead: 0,
      bytesCompressed: 0,
      speedSamples: [],
      memoryPeak: 0,
      errors: [],
      abortController: new AbortController(),
    };
    
    // If no active job, start immediately
    if (!this.activeJob) {
      this.activeJob = job;
      await this.processJob(job);
    } else {
      // Queue the job
      this.jobQueue.push(job);
    }
    
    return jobId;
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: JobId): Promise<void> {
    const job = this.findJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    
    this.log(`Cancelling job ${jobId}`);
    
    // Signal abort
    job.abortController.abort();
    job.state = 'cancelled';
    
    // Cancel on worker
    this.sendToWorker({ type: 'CANCEL', jobId, reason: 'User cancelled' });
    
    // Cleanup
    this.cleanupJob(job);
    
    // Emit event
    this.emit('jobCancelled', jobId, job.bytesRead, job.chunksProcessed.size);
    
    // Process next job in queue
    await this.processNextJob();
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: JobId): JobState | null {
    const job = this.findJob(jobId);
    return job?.state || null;
  }

  // ==========================================================================
  // JOB PROCESSING
  // ==========================================================================

  /**
   * Process a job (streaming)
   */
  private async processJob(job: JobContext): Promise<void> {
    this.log(`Processing job ${job.id}, file: ${job.file.name}, size: ${job.file.size}`);
    
    job.state = 'reading';
    
    // Start telemetry
    this.startTelemetry(job);
    
    // Emit start event
    this.emit('jobStarted', job.id, job.file.size, job.totalChunks);
    
    // Start stream on worker
    this.sendToWorker({
      type: 'START_STREAM',
      jobId: job.id,
      totalBytes: job.file.size,
      totalChunks: job.totalChunks,
      settings: job.settings,
      fileName: job.file.name,
      mimeType: job.file.type || 'application/octet-stream',
    });
    
    // Stream chunks
    try {
      await this.streamChunks(job);
    } catch (error) {
      // Job state may have changed during async streaming
      const currentState = job.state as string;
      if (currentState !== 'cancelled') {
        this.handleJobError(job, {
          code: ErrorCode.FILE_READ_FAILED,
          message: error instanceof Error ? error.message : 'File read failed',
          recoverable: false,
        });
      }
    }
  }

  /**
   * Stream chunks from file to worker
   */
  private async streamChunks(job: JobContext): Promise<void> {
    const { file, settings, abortController } = job;
    const chunkSize = settings.chunkSize;
    
    let offset = 0;
    let seq = 0;
    
    job.state = 'compressing';
    
    while (offset < file.size) {
      // Check for abort
      if (abortController.signal.aborted) {
        throw new Error('Job cancelled');
      }
      
      // Apply backpressure
      await this.waitForBackpressure(job);
      
      // Read chunk
      const end = Math.min(offset + chunkSize, file.size);
      const blob = file.slice(offset, end);
      const arrayBuffer = await blob.arrayBuffer();
      
      // Compute hash if verification enabled
      let hash: string | undefined;
      if (settings.verifyHash) {
        hash = await this.computeHash(new Uint8Array(arrayBuffer));
      }
      
      // Track pending chunk
      const pendingChunk: PendingChunk = {
        seq,
        data: arrayBuffer,
        hash,
        sentAt: Date.now(),
      };
      job.chunksPending.set(seq, pendingChunk);
      this.pendingChunkCount++;
      
      // Send to worker
      this.sendToWorker({
        type: 'SEND_CHUNK',
        jobId: job.id,
        seq,
        data: arrayBuffer,
        hash,
        isLast: end >= file.size,
      }, [arrayBuffer]);
      
      job.bytesRead += arrayBuffer.byteLength;
      offset = end;
      seq++;
    }
    
    this.log(`All ${seq} chunks sent for job ${job.id}`);
  }

  /**
   * Wait for backpressure to clear
   */
  private async waitForBackpressure(job: JobContext): Promise<void> {
    if (this.pendingChunkCount >= this.config.backpressureHighWater) {
      this.backpressureActive = true;
      this.emit('backpressure', job.id, true);
      
      await new Promise<void>(resolve => {
        const check = () => {
          if (this.pendingChunkCount <= this.config.backpressureLowWater ||
              job.abortController.signal.aborted) {
            this.backpressureActive = false;
            this.emit('backpressure', job.id, false);
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        setTimeout(check, 10);
      });
    }
  }

  /**
   * Handle chunk processed from worker
   */
  private handleChunkProcessed(msg: Extract<WorkerToCoordinatorMessage, { type: 'CHUNK_PROCESSED' }>): void {
    const job = this.activeJob;
    if (!job || job.id !== msg.jobId) return;
    
    // Remove from pending
    job.chunksPending.delete(msg.seq);
    this.pendingChunkCount--;
    
    // Mark as processed
    job.chunksProcessed.add(msg.seq);
    
    // Store compressed chunk
    const compressedChunk: CompressedChunk = {
      seq: msg.seq,
      data: new Uint8Array(0), // Data stays in worker
      originalSize: msg.originalSize,
      compressedSize: msg.compressedSize,
      hash: msg.hash,
      checksum: msg.checksum,
      durationMs: msg.durationMs,
    };
    job.compressedChunks.set(msg.seq, compressedChunk);
    
    job.bytesCompressed += msg.compressedSize;
    
    // Add speed sample
    job.speedSamples.push({
      timestamp: Date.now(),
      bytes: msg.originalSize,
    });
    
    // Trim old samples
    while (job.speedSamples.length > this.config.speedSampleWindow) {
      job.speedSamples.shift();
    }
    
    this.log(`Chunk ${msg.seq} processed: ${msg.originalSize} → ${msg.compressedSize} bytes`);
  }

  /**
   * Handle final blob from worker
   */
  private handleFinalBlob(msg: Extract<WorkerToCoordinatorMessage, { type: 'FINAL_BLOB' }>): void {
    const job = this.activeJob;
    if (!job || job.id !== msg.jobId) return;
    
    job.state = 'complete';
    
    // Create download URL
    const downloadUrl = URL.createObjectURL(msg.blob);
    
    const result: JobResult = {
      outputBlob: msg.blob,
      downloadUrl,
      originalSize: msg.originalSize,
      compressedSize: msg.compressedSize,
      compressionRatio: msg.compressionRatio,
      totalChunks: msg.totalChunks,
      durationMs: msg.durationMs,
      averageSpeed: msg.averageSpeed,
      peakSpeed: this.calculatePeakSpeed(job),
      manifest: msg.manifest,
    };
    
    this.jobsCompleted++;
    this.totalBytesProcessed += msg.originalSize;
    
    // Cleanup
    this.cleanupJob(job);
    
    // Emit event
    this.emit('jobComplete', job.id, result);
    
    // Process next job
    this.processNextJob();
  }

  /**
   * Handle worker error
   */
  private handleError(msg: Extract<WorkerToCoordinatorMessage, { type: 'ERROR' }>): void {
    const job = this.activeJob;
    if (!job || job.id !== msg.jobId) return;
    
    const error: JobError = {
      code: msg.code,
      message: msg.message,
      recoverable: msg.recoverable,
      seq: msg.seq,
      stack: msg.stack,
    };
    
    if (msg.recoverable && msg.seq !== undefined) {
      // Try to retry chunk
      this.retryChunk(job, msg.seq, error);
    } else {
      this.handleJobError(job, error);
    }
  }

  /**
   * Handle fatal job error
   */
  private handleJobError(job: JobContext, error: JobError): void {
    job.state = 'error';
    job.errors.push(error);
    
    this.jobsFailed++;
    
    // Cleanup
    this.cleanupJob(job);
    
    // Emit event
    this.emit('jobError', job.id, error);
    
    // Process next job
    this.processNextJob();
  }

  /**
   * Retry a failed chunk
   */
  private retryChunk(job: JobContext, seq: ChunkSeq, error: JobError): void {
    let retryState = job.chunksRetrying.get(seq);
    
    if (!retryState) {
      retryState = {
        seq,
        attempts: 0,
        lastError: error.message,
        nextRetryAt: Date.now(),
      };
      job.chunksRetrying.set(seq, retryState);
    }
    
    retryState.attempts++;
    retryState.lastError = error.message;
    
    if (retryState.attempts > this.config.maxRetries) {
      // Max retries exceeded
      this.handleJobError(job, {
        code: ErrorCode.MAX_RETRIES_EXCEEDED,
        message: `Chunk ${seq} failed after ${retryState.attempts} attempts: ${error.message}`,
        recoverable: false,
        seq,
        attempts: retryState.attempts,
      });
      return;
    }
    
    // Exponential backoff
    const delay = RETRY_BACKOFF_MS * Math.pow(2, retryState.attempts - 1);
    retryState.nextRetryAt = Date.now() + delay;
    
    this.log(`Retrying chunk ${seq}, attempt ${retryState.attempts} in ${delay}ms`);
    
    setTimeout(() => {
      const pending = job.chunksPending.get(seq);
      if (pending) {
        this.sendToWorker({
          type: 'RETRY_CHUNK',
          jobId: job.id,
          seq,
          data: pending.data,
          attempt: retryState!.attempts,
        }, [pending.data]);
      }
    }, delay);
  }

  // ==========================================================================
  // TELEMETRY
  // ==========================================================================

  /**
   * Start telemetry updates
   */
  private startTelemetry(job: JobContext): void {
    this.stopTelemetry();
    
    this.telemetryTimer = setInterval(() => {
      if (job.state === 'compressing' || job.state === 'reading') {
        const progress = this.calculateProgress(job);
        const telemetry = this.calculateTelemetry(job);
        this.emit('progress', job.id, progress, telemetry);
      }
    }, this.config.telemetryIntervalMs);
  }

  /**
   * Stop telemetry updates
   */
  private stopTelemetry(): void {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
  }

  /**
   * Calculate job progress
   */
  private calculateProgress(job: JobContext): JobProgress {
    const chunksProcessed = job.chunksProcessed.size;
    const percent = job.totalChunks > 0 ? (chunksProcessed / job.totalChunks) * 100 : 0;
    
    let totalCompressed = 0;
    for (const chunk of job.compressedChunks.values()) {
      totalCompressed += chunk.compressedSize;
    }
    
    return {
      phase: job.state as JobProgress['phase'],
      bytesProcessed: job.bytesRead,
      totalBytes: job.file.size,
      chunksProcessed,
      totalChunks: job.totalChunks,
      compressionRatio: job.bytesRead > 0 ? totalCompressed / job.bytesRead : 1,
      percent,
    };
  }

  /**
   * Calculate telemetry
   */
  private calculateTelemetry(job: JobContext): JobTelemetry {
    const samples = job.speedSamples;
    const now = Date.now();
    
    // Instant speed (last sample)
    let instantSpeed = 0;
    if (samples.length >= 2) {
      const last = samples[samples.length - 1];
      const prev = samples[samples.length - 2];
      const dt = (last.timestamp - prev.timestamp) / 1000;
      if (dt > 0) {
        instantSpeed = last.bytes / dt;
      }
    }
    
    // Rolling average (5 second window)
    const windowStart = now - 5000;
    const windowSamples = samples.filter(s => s.timestamp >= windowStart);
    let rollingAvgSpeed = 0;
    if (windowSamples.length >= 2) {
      const first = windowSamples[0];
      const last = windowSamples[windowSamples.length - 1];
      const dt = (last.timestamp - first.timestamp) / 1000;
      const bytes = windowSamples.reduce((sum, s) => sum + s.bytes, 0);
      if (dt > 0) {
        rollingAvgSpeed = bytes / dt;
      }
    }
    
    // ETA
    const remaining = job.file.size - job.bytesRead;
    const eta = rollingAvgSpeed > 0 ? remaining / rollingAvgSpeed : Infinity;
    
    // Chunk timings
    const chunkTimings = Array.from(job.compressedChunks.values())
      .slice(-10)
      .map(c => ({
        seq: c.seq,
        readMs: 0, // TODO: track read time
        compressMs: c.durationMs,
        totalMs: c.durationMs,
        size: c.originalSize,
      }));
    
    // Worker load
    const workerLoad = (this.pendingChunkCount / this.config.maxPendingChunks) * 100;
    
    // Memory usage estimate
    let memoryUsage = 0;
    for (const pending of job.chunksPending.values()) {
      memoryUsage += pending.data.byteLength;
    }
    job.memoryPeak = Math.max(job.memoryPeak, memoryUsage);
    
    return {
      instantSpeed,
      rollingAvgSpeed,
      eta,
      chunkTimings,
      workerLoad: Math.min(100, workerLoad),
      wasmThroughput: instantSpeed,
      memoryUsage,
      memoryPeak: job.memoryPeak,
      timestamp: now,
    };
  }

  /**
   * Calculate peak speed
   */
  private calculatePeakSpeed(job: JobContext): number {
    const samples = job.speedSamples;
    let peak = 0;
    
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].timestamp - samples[i - 1].timestamp) / 1000;
      if (dt > 0) {
        const speed = samples[i].bytes / dt;
        peak = Math.max(peak, speed);
      }
    }
    
    return peak;
  }

  // ==========================================================================
  // WORKER COMMUNICATION
  // ==========================================================================

  /**
   * Send message to worker
   */
  private sendToWorker(msg: CoordinatorToWorkerMessage, transfer?: Transferable[]): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    this.worker.postMessage(msg, { transfer: transfer || [] });
  }

  /**
   * Handle worker message
   */
  private handleWorkerMessage(event: MessageEvent<WorkerToCoordinatorMessage>): void {
    const msg = event.data;
    this.log(`Worker message: ${msg.type}`);
    
    switch (msg.type) {
      case 'READY':
        this.workerReady = true;
        this.workerCapabilities = msg.capabilities;
        break;
        
      case 'WASM_READY':
        this.wasmReady = true;
        this.workerCapabilities = msg.capabilities;
        break;
        
      case 'CHUNK_PROCESSED':
        this.handleChunkProcessed(msg);
        break;
        
      case 'PROGRESS':
        // Progress from worker (supplement to local telemetry)
        break;
        
      case 'FINAL_BLOB':
        this.handleFinalBlob(msg);
        break;
        
      case 'ERROR':
        this.handleError(msg);
        break;
        
      case 'BACKPRESSURE_ON':
        this.backpressureActive = true;
        if (this.activeJob) {
          this.emit('backpressure', this.activeJob.id, true);
        }
        break;
        
      case 'BACKPRESSURE_OFF':
        this.backpressureActive = false;
        if (this.activeJob) {
          this.emit('backpressure', this.activeJob.id, false);
        }
        break;
        
      case 'BUFFER_FULL':
        this.log(`Worker buffer full: ${msg.used}/${msg.capacity}`);
        break;
        
      case 'CANCELLED':
        // Already handled in cancelJob
        break;
        
      case 'CHUNK_RETRY_FAILED':
        if (this.activeJob) {
          this.handleJobError(this.activeJob, {
            code: ErrorCode.MAX_RETRIES_EXCEEDED,
            message: `Chunk ${msg.seq} failed after ${msg.attempts} attempts: ${msg.lastError}`,
            recoverable: false,
            seq: msg.seq,
            attempts: msg.attempts,
          });
        }
        break;
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(error: ErrorEvent): void {
    console.error('[Coordinator] Worker error:', error);
    
    if (this.activeJob) {
      this.handleJobError(this.activeJob, {
        code: ErrorCode.WORKER_CRASHED,
        message: error.message || 'Worker crashed',
        recoverable: false,
      });
    }
  }

  /**
   * Wait for worker ready
   */
  private waitForWorkerReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker ready timeout'));
      }, 10000);
      
      const check = () => {
        if (this.workerReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * Wait for WASM ready
   */
  private waitForWasmReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WASM ready timeout'));
      }, 15000);
      
      const check = () => {
        if (this.wasmReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Find job by ID
   */
  private findJob(jobId: JobId): JobContext | null {
    if (this.activeJob?.id === jobId) {
      return this.activeJob;
    }
    return this.jobQueue.find(j => j.id === jobId) || null;
  }

  /**
   * Cleanup job resources
   */
  private cleanupJob(job: JobContext): void {
    this.stopTelemetry();
    
    // Clear pending chunks
    job.chunksPending.clear();
    this.pendingChunkCount = 0;
    
    // Clear from active
    if (this.activeJob?.id === job.id) {
      this.activeJob = null;
    }
    
    // Remove from queue
    const idx = this.jobQueue.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      this.jobQueue.splice(idx, 1);
    }
  }

  /**
   * Process next job in queue
   */
  private async processNextJob(): Promise<void> {
    if (this.activeJob || this.jobQueue.length === 0) return;
    
    const next = this.jobQueue.shift();
    if (next) {
      this.activeJob = next;
      await this.processJob(next);
    }
  }

  /**
   * Compute SHA-256 hash
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    const buffer = new ArrayBuffer(data.length);
    new Uint8Array(buffer).set(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Get coordinator stats
   */
  getStats(): CoordinatorStats {
    const workerStatus: WorkerStatus = {
      workerId: 'main',
      ready: this.workerReady,
      wasmReady: this.wasmReady,
      activeJobId: this.activeJob?.id || null,
      pendingChunks: this.pendingChunkCount,
      memoryUsage: this.activeJob?.memoryPeak || 0,
      uptime: Date.now() - this.startTime,
      jobsCompleted: this.jobsCompleted,
      jobsFailed: this.jobsFailed,
    };
    
    return {
      activeJobs: this.activeJob ? 1 : 0,
      completedJobs: this.jobsCompleted,
      failedJobs: this.jobsFailed,
      totalBytesProcessed: this.totalBytesProcessed,
      averageSpeed: 0, // TODO: calculate
      workerStatus,
      uptime: Date.now() - this.startTime,
    };
  }

  // ==========================================================================
  // EVENT EMITTER
  // ==========================================================================

  /**
   * Add event listener
   */
  on<K extends CoordinatorEventType>(event: K, listener: CoordinatorEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off<K extends CoordinatorEventType>(event: K, listener: CoordinatorEvents[K]): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit<K extends CoordinatorEventType>(event: K, ...args: Parameters<CoordinatorEvents[K]>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as Function)(...args);
        } catch (e) {
          console.error(`[Coordinator] Event listener error:`, e);
        }
      }
    }
  }

  /**
   * Log message
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[Coordinator] ${message}`);
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let coordinatorInstance: Coordinator | null = null;

/**
 * Get or create coordinator instance
 */
export function getCoordinator(config?: Partial<CoordinatorConfig>): Coordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new Coordinator(config);
  }
  return coordinatorInstance;
}

/**
 * Reset coordinator instance
 */
export async function resetCoordinator(): Promise<void> {
  if (coordinatorInstance) {
    await coordinatorInstance.shutdown();
    coordinatorInstance = null;
  }
}
