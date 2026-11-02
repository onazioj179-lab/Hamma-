/**
 * SPK Implementation Blueprint - Pipeline Coordinator
 * 
 * Orchestrates the entire compression/decompression pipeline.
 * Manages workers, chunks, AI optimization, and recovery.
 * 
 * @module core/pipeline/coordinator
 * @version 1.0.0
 */

import { WasmInterface, CompressionLevel } from '../wasm/interface';
import { ChunkScheduler, SchedulerConfig } from './scheduler';
import { ChunkReader, ReadConfig } from './chunkReader';
import { ArchiveWriter, WriterConfig } from './writer';
import { IntegrityChecker } from './integrity';

// ============================================================================
// Types
// ============================================================================

export interface CompressionJob {
  id: string;
  files: File[];
  options: CompressionOptions;
  state: JobState;
  progress: JobProgress;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface CompressionOptions {
  level: CompressionLevel;
  chunkSize: number;
  workerCount: number;
  encryption?: EncryptionOptions;
  metadata?: Record<string, string>;
  aiOptimization: boolean;
}

export interface EncryptionOptions {
  enabled: boolean;
  password?: string;
  algorithm: 'AES-256-GCM' | 'ChaCha20-Poly1305';
}

export interface JobProgress {
  stage: JobStage;
  bytesRead: number;
  bytesWritten: number;
  bytesTotal: number;
  bytesProcessed: number;
  chunksProcessed: number;
  chunksTotal: number;
  filesProcessed: number;
  filesTotal: number;
  throughputBps: number;
  estimatedTimeRemaining: number;
  currentFile?: string;
}

export type JobState = 
  | 'pending'
  | 'reading'
  | 'compressing'
  | 'writing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type JobStage = 
  | 'initializing'
  | 'scanning'
  | 'processing'
  | 'finalizing'
  | 'complete';

export interface DecompressionJob {
  id: string;
  archive: Blob;
  options: DecompressionOptions;
  state: JobState;
  progress: JobProgress;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface DecompressionOptions {
  targetFiles?: string[]; // For selective extraction
  outputDir?: string;
  verifyIntegrity: boolean;
  decryption?: EncryptionOptions;
  workerCount: number;
}

export interface CoordinatorConfig {
  scheduler: SchedulerConfig;
  reader: ReadConfig;
  writer: WriterConfig;
  maxConcurrentJobs: number;
  checkpointInterval: number;
  recoveryEnabled: boolean;
}

export interface WorkerMessage {
  type: 'chunk-processed' | 'error' | 'progress';
  jobId: string;
  workerId: number;
  chunkId?: string;
  data?: Uint8Array;
  error?: string;
  bytesProcessed?: number;
}

export interface Checkpoint {
  jobId: string;
  timestamp: number;
  chunksCompleted: string[];
  bytesProcessed: number;
  state: JobState;
}

// ============================================================================
// Pipeline Coordinator
// ============================================================================

/**
 * Main coordinator for compression/decompression pipelines.
 * Manages the entire lifecycle of jobs from start to completion.
 */
export class PipelineCoordinator {
  private jobs: Map<string, CompressionJob | DecompressionJob> = new Map();
  private workers: Worker[] = [];
  private scheduler: ChunkScheduler;
  private reader: ChunkReader;
  private writer: ArchiveWriter;
  private integrity: IntegrityChecker;
  private _wasm: WasmInterface;
  private nextJobId = 0;
  private checkpoints: Map<string, Checkpoint> = new Map();

  constructor(
    private config: CoordinatorConfig,
    wasm: WasmInterface
  ) {
    this._wasm = wasm;
    this.scheduler = new ChunkScheduler(config.scheduler);
    this.reader = new ChunkReader(config.reader);
    this.writer = new ArchiveWriter(config.writer);
    this.integrity = new IntegrityChecker();
  }

  /**
   * Start a compression job.
   */
  async startCompression(
    files: File[],
    options: CompressionOptions
  ): Promise<string> {
    const jobId = `job_${++this.nextJobId}`;
    
    const job: CompressionJob = {
      id: jobId,
      files,
      options,
      state: 'pending',
      progress: {
        stage: 'initializing',
        bytesRead: 0,
        bytesWritten: 0,
        bytesTotal: files.reduce((sum, f) => sum + f.size, 0),
        bytesProcessed: 0,
        chunksProcessed: 0,
        chunksTotal: 0,
        filesProcessed: 0,
        filesTotal: files.length,
        throughputBps: 0,
        estimatedTimeRemaining: 0,
      },
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, job);

    // Start processing asynchronously
    this.processCompressionJob(job).catch(error => {
      job.state = 'failed';
      job.error = error.message;
    });

    return jobId;
  }

  /**
   * Start a decompression job.
   */
  async startDecompression(
    archive: Blob,
    options: DecompressionOptions
  ): Promise<string> {
    const jobId = `job_${++this.nextJobId}`;
    
    const job: DecompressionJob = {
      id: jobId,
      archive,
      options,
      state: 'pending',
      progress: {
        stage: 'initializing',
        bytesRead: 0,
        bytesWritten: 0,
        bytesTotal: archive.size,
        bytesProcessed: 0,
        chunksProcessed: 0,
        chunksTotal: 0,
        filesProcessed: 0,
        filesTotal: 0,
        throughputBps: 0,
        estimatedTimeRemaining: 0,
      },
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, job);

    // Start processing asynchronously
    this.processDecompressionJob(job).catch(error => {
      job.state = 'failed';
      job.error = error.message;
    });

    return jobId;
  }

  /**
   * Process a compression job through the pipeline.
   */
  private async processCompressionJob(job: CompressionJob): Promise<void> {
    job.state = 'reading';
    job.startedAt = Date.now();

    try {
      // Initialize workers
      await this.initializeWorkers(job.options.workerCount);

      // Scan and chunk files
      job.progress.stage = 'scanning';
      const chunks = await this.reader.scanFiles(job.files, job.options.chunkSize);
      job.progress.chunksTotal = chunks.length;

      // Initialize writer
      await this.writer.initialize({
        encryption: job.options.encryption,
        metadata: {
          ...job.options.metadata,
          fileCount: job.files.length,
          originalSize: job.progress.bytesTotal,
          compressionLevel: job.options.level,
          timestamp: Date.now(),
        },
      });

      // Schedule chunks for processing
      job.state = 'compressing';
      job.progress.stage = 'processing';
      
      for (const chunk of chunks) {
        await this.scheduler.scheduleChunk(chunk, job.id);
      }

      // Process chunks through workers
      await this.processChunks(job);

      // Finalize archive
      job.state = 'writing';
      job.progress.stage = 'finalizing';
      await this.writer.finalize();

      // Verify integrity
      if (job.options.encryption?.enabled) {
        job.state = 'verifying';
        await this.integrity.verifyArchive(await this.writer.getBlob());
      }

      // Complete job
      job.state = 'completed';
      job.progress.stage = 'complete';
      job.completedAt = Date.now();

      // Clean up checkpoint
      this.checkpoints.delete(job.id);

    } catch (error) {
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Process a decompression job through the pipeline.
   */
  private async processDecompressionJob(job: DecompressionJob): Promise<void> {
    job.state = 'reading';
    job.startedAt = Date.now();

    try {
      // Initialize workers
      await this.initializeWorkers(job.options.workerCount);

      // Read archive manifest
      job.progress.stage = 'scanning';
      const manifest = await this.reader.readManifest(job.archive);
      job.progress.filesTotal = manifest.files.length;
      job.progress.chunksTotal = manifest.chunks.length;

      // Filter files for selective extraction
      const targetFiles = job.options.targetFiles 
        ? manifest.files.filter((f: any) => job.options.targetFiles!.includes(f.path))
        : manifest.files;

      // Process chunks
      job.state = 'compressing'; // Reusing state
      job.progress.stage = 'processing';

      for (const file of targetFiles) {
        const chunks = await this.reader.readFileChunks(job.archive, file);
        
        for (const chunk of chunks) {
          await this.scheduler.scheduleChunk(chunk, job.id);
        }
      }

      await this.processChunks(job);

      // Verify integrity
      if (job.options.verifyIntegrity) {
        job.state = 'verifying';
        await this.integrity.verifyExtractedFiles(targetFiles);
      }

      // Complete job
      job.state = 'completed';
      job.progress.stage = 'complete';
      job.completedAt = Date.now();

    } catch (error) {
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Process chunks through workers.
   */
  private async processChunks(job: CompressionJob | DecompressionJob): Promise<void> {
    return new Promise((resolve, reject) => {
      let processedCount = 0;
      const startTime = Date.now();

      const handleWorkerMessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        
        if (msg.jobId !== job.id) return;

        switch (msg.type) {
          case 'chunk-processed':
            processedCount++;
            job.progress.chunksProcessed = processedCount;
            job.progress.bytesProcessed = msg.bytesProcessed ?? 0;
            
            // Update throughput
            const elapsed = (Date.now() - startTime) / 1000;
            job.progress.throughputBps = job.progress.bytesProcessed / elapsed;
            
            // Estimate time remaining
            const remaining = job.progress.chunksTotal - processedCount;
            const avgTimePerChunk = elapsed / processedCount;
            job.progress.estimatedTimeRemaining = remaining * avgTimePerChunk;

            // Checkpoint periodically
            if (processedCount % 100 === 0 && this.config.recoveryEnabled) {
              this.createCheckpoint(job);
            }

            // Check completion
            if (processedCount >= job.progress.chunksTotal) {
              resolve();
            }
            break;

          case 'error':
            reject(new Error(msg.error ?? 'Worker error'));
            break;

          case 'progress':
            // Update progress without counting as completion
            job.progress.bytesProcessed = msg.bytesProcessed ?? 0;
            break;
        }
      };

      // Attach listeners to all workers
      this.workers.forEach(worker => {
        worker.addEventListener('message', handleWorkerMessage);
      });
    });
  }

  /**
   * Initialize web workers for parallel processing.
   */
  private async initializeWorkers(count: number): Promise<void> {
    // Clean up existing workers
    this.workers.forEach(w => w.terminate());
    this.workers = [];

    // Create new workers
    for (let i = 0; i < count; i++) {
      const worker = new Worker(
        new URL('../../workers/compressionWorker.ts', import.meta.url),
        { type: 'module' }
      );
      this.workers.push(worker);
    }

    // Wait for workers to initialize
    await Promise.all(
      this.workers.map(worker => 
        new Promise<void>(resolve => {
          worker.addEventListener('message', function handler(e) {
            if (e.data.type === 'ready') {
              worker.removeEventListener('message', handler);
              resolve();
            }
          });
        })
      )
    );
  }

  /**
   * Create a checkpoint for job recovery.
   */
  private createCheckpoint(job: CompressionJob | DecompressionJob): void {
    const checkpoint: Checkpoint = {
      jobId: job.id,
      timestamp: Date.now(),
      chunksCompleted: [], // Would track actual chunk IDs
      bytesProcessed: job.progress.bytesProcessed,
      state: job.state,
    };

    this.checkpoints.set(job.id, checkpoint);
    
    // Persist to IndexedDB or localStorage
    this.persistCheckpoint(checkpoint);
  }

  /**
   * Persist checkpoint to storage.
   */
  private async persistCheckpoint(checkpoint: Checkpoint): Promise<void> {
    try {
      localStorage.setItem(
        `spk_checkpoint_${checkpoint.jobId}`,
        JSON.stringify(checkpoint)
      );
    } catch (error) {
      console.warn('Failed to persist checkpoint:', error);
    }
  }

  /**
   * Recover a job from checkpoint.
   */
  async recoverJob(jobId: string): Promise<void> {
    const checkpointData = localStorage.getItem(`spk_checkpoint_${jobId}`);
    if (!checkpointData) {
      throw new Error(`No checkpoint found for job ${jobId}`);
    }

    const checkpoint: Checkpoint = JSON.parse(checkpointData);
    
    // Resume job from checkpoint
    // Implementation would restore state and continue processing
    console.log('Recovering job from checkpoint:', checkpoint);
  }

  /**
   * Pause a job.
   */
  pauseJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.state !== 'completed' && job.state !== 'failed') {
      job.state = 'paused';
      this.createCheckpoint(job);
    }
  }

  /**
   * Resume a paused job.
   */
  resumeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.state === 'paused') {
      job.state = 'compressing';
      // Would restart processing
    }
  }

  /**
   * Cancel a job.
   */
  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.state = 'cancelled';
      this.jobs.delete(jobId);
      this.checkpoints.delete(jobId);
    }
  }

  /**
   * Get job status.
   */
  getJob(jobId: string): CompressionJob | DecompressionJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all active jobs.
   */
  getActiveJobs(): Array<CompressionJob | DecompressionJob> {
    return Array.from(this.jobs.values()).filter(
      job => job.state !== 'completed' && job.state !== 'failed'
    );
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.jobs.clear();
    this.checkpoints.clear();
  }
}

// ============================================================================
// Exports
// ============================================================================

export default PipelineCoordinator;
