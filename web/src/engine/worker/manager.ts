/**
 * SPK V25 - Worker Manager
 * Main thread controller for worker communication
 */

import type { CompressionSettings, CompressionMode } from '../wasm/types';
import type { 
  WorkerOutgoingMessage, 
  WorkerMessageHandlers,
  JobId,
  ProgressMessage,
  CompleteMessage,
  ErrorMessage,
} from './messages';
import { generateJobId } from './messages';

// Worker instance type
type WorkerInstance = Worker;

/**
 * Worker state
 */
interface WorkerState {
  worker: WorkerInstance;
  isReady: boolean;
  activeJobId: JobId | null;
  capabilities: {
    hasSharedArrayBuffer: boolean;
    hasRealWasm: boolean;
    maxMemory: number;
  } | null;
}

/**
 * Job state for tracking active compressions
 */
interface JobState {
  id: JobId;
  file: File;
  settings: CompressionSettings;
  startTime: number;
  status: 'pending' | 'running' | 'complete' | 'error' | 'cancelled';
  progress: {
    bytesProcessed: number;
    totalBytes: number;
    chunksProcessed: number;
    totalChunks: number;
    speed: number;
    eta: number;
    compressionRatio: number;
  };
  result?: {
    outputBlob: Blob;
    originalSize: number;
    compressedSize: number;
    totalTime: number;
  };
  error?: {
    message: string;
    code: string;
  };
}

/**
 * Worker manager configuration
 */
interface WorkerManagerConfig {
  maxWorkers: number;
  onProgress?: (jobId: JobId, progress: ProgressMessage) => void;
  onComplete?: (jobId: JobId, result: CompleteMessage) => void;
  onError?: (jobId: JobId, error: ErrorMessage) => void;
  onReady?: () => void;
}

/**
 * Worker Manager
 * Manages worker lifecycle and job processing
 */
export class WorkerManager {
  private workerState: WorkerState | null = null;
  private jobs: Map<JobId, JobState> = new Map();
  private messageHandlers: WorkerMessageHandlers = {};
  private config: WorkerManagerConfig;
  private initPromise: Promise<void> | null = null;
  
  constructor(config: Partial<WorkerManagerConfig> = {}) {
    this.config = {
      maxWorkers: 1, // Single worker for now
      ...config,
    };
    
    this.setupMessageHandlers();
  }
  
  /**
   * Update callbacks dynamically
   */
  setCallbacks(callbacks: Partial<Pick<WorkerManagerConfig, 'onProgress' | 'onComplete' | 'onError'>>) {
    if (callbacks.onProgress) this.config.onProgress = callbacks.onProgress;
    if (callbacks.onComplete) this.config.onComplete = callbacks.onComplete;
    if (callbacks.onError) this.config.onError = callbacks.onError;
  }
  
  /**
   * Setup internal message handlers
   */
  private setupMessageHandlers(): void {
    this.messageHandlers = {
      onWasmReady: (msg) => {
        if (this.workerState) {
          this.workerState.isReady = true;
          this.workerState.capabilities = msg.capabilities;
        }
        this.config.onReady?.();
      },
      
      onProgress: (msg) => {
        const job = this.jobs.get(msg.jobId);
        if (job) {
          job.progress = {
            bytesProcessed: msg.bytesProcessed,
            totalBytes: msg.totalBytes,
            chunksProcessed: msg.chunkIndex + 1,
            totalChunks: msg.totalChunks,
            speed: msg.speed,
            eta: msg.eta,
            compressionRatio: msg.compressionRatio,
          };
        }
        this.config.onProgress?.(msg.jobId, msg);
      },
      
      onComplete: (msg) => {
        const job = this.jobs.get(msg.jobId);
        if (job) {
          job.status = 'complete';
          job.result = {
            outputBlob: msg.outputBlob,
            originalSize: msg.originalSize,
            compressedSize: msg.compressedSize,
            totalTime: msg.totalTime,
          };
        }
        if (this.workerState) {
          this.workerState.activeJobId = null;
        }
        this.config.onComplete?.(msg.jobId, msg);
      },
      
      onError: (msg) => {
        const job = this.jobs.get(msg.jobId);
        if (job) {
          job.status = 'error';
          job.error = {
            message: msg.message,
            code: msg.code,
          };
        }
        if (this.workerState) {
          this.workerState.activeJobId = null;
        }
        this.config.onError?.(msg.jobId, msg);
      },
      
      onCancelled: (msg) => {
        const job = this.jobs.get(msg.jobId);
        if (job) {
          job.status = 'cancelled';
        }
        if (this.workerState) {
          this.workerState.activeJobId = null;
        }
      },
      
      onChunkComplete: () => {
        // Can be used for detailed chunk tracking if needed
      },
    };
  }
  
  /**
   * Initialize worker
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = new Promise((resolve, reject) => {
      try {
        // Create worker
        const worker = new Worker(
          new URL('./compression.worker.ts', import.meta.url),
          { type: 'module' }
        );
        
        this.workerState = {
          worker,
          isReady: false,
          activeJobId: null,
          capabilities: null,
        };
        
        // Setup message handler
        worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
          this.handleWorkerMessage(event.data);
        };
        
        worker.onerror = (error) => {
          console.error('[WorkerManager] Worker error:', error);
          reject(error);
        };
        
        // Wait for WASM ready
        const originalOnReady = this.config.onReady;
        this.config.onReady = () => {
          this.config.onReady = originalOnReady;
          originalOnReady?.();
          resolve();
        };
        
        // Trigger init
        worker.postMessage({ type: 'INIT_WASM' });
        
        // Timeout
        setTimeout(() => {
          if (!this.workerState?.isReady) {
            reject(new Error('Worker initialization timeout'));
          }
        }, 10000);
        
      } catch (error) {
        reject(error);
      }
    });
    
    return this.initPromise;
  }
  
  /**
   * Handle incoming worker messages
   */
  private handleWorkerMessage(message: WorkerOutgoingMessage): void {
    switch (message.type) {
      case 'WASM_READY':
        this.messageHandlers.onWasmReady?.(message);
        break;
      case 'PROGRESS':
        this.messageHandlers.onProgress?.(message);
        break;
      case 'COMPLETE':
        this.messageHandlers.onComplete?.(message);
        break;
      case 'ERROR':
        this.messageHandlers.onError?.(message);
        break;
      case 'CANCELLED':
        this.messageHandlers.onCancelled?.(message);
        break;
      case 'CHUNK_COMPLETE':
        this.messageHandlers.onChunkComplete?.(message);
        break;
    }
  }
  
  /**
   * Start compression job
   */
  async startCompression(file: File, settings: CompressionSettings): Promise<JobId> {
    await this.initialize();
    
    if (!this.workerState?.isReady) {
      throw new Error('Worker not ready');
    }
    
    const jobId = generateJobId();
    
    // Create job state
    const job: JobState = {
      id: jobId,
      file,
      settings,
      startTime: Date.now(),
      status: 'running',
      progress: {
        bytesProcessed: 0,
        totalBytes: file.size,
        chunksProcessed: 0,
        totalChunks: 0,
        speed: 0,
        eta: 0,
        compressionRatio: 1,
      },
    };
    
    this.jobs.set(jobId, job);
    this.workerState.activeJobId = jobId;
    
    // Send to worker
    this.workerState.worker.postMessage({
      type: 'START_COMPRESSION',
      jobId,
      file,
      settings,
    });
    
    return jobId;
  }
  
  /**
   * Start decompression job
   */
  async startDecompression(file: File): Promise<JobId> {
    await this.initialize();
    
    if (!this.workerState?.isReady) {
      throw new Error('Worker not ready');
    }
    
    const jobId = generateJobId();
    
    const job: JobState = {
      id: jobId,
      file,
      settings: { mode: 'auto', chunkSize: 0, enableDedup: false, enableEncryption: false },
      startTime: Date.now(),
      status: 'running',
      progress: {
        bytesProcessed: 0,
        totalBytes: file.size,
        chunksProcessed: 0,
        totalChunks: 0,
        speed: 0,
        eta: 0,
        compressionRatio: 1,
      },
    };
    
    this.jobs.set(jobId, job);
    this.workerState.activeJobId = jobId;
    
    this.workerState.worker.postMessage({
      type: 'START_DECOMPRESSION',
      jobId,
      file,
    });
    
    return jobId;
  }
  
  /**
   * Cancel active job
   */
  cancelJob(jobId: JobId): void {
    if (this.workerState?.activeJobId === jobId) {
      this.workerState.worker.postMessage({
        type: 'CANCEL_JOB',
        jobId,
      });
    }
  }
  
  /**
   * Set chunk size for future jobs
   */
  setChunkSize(chunkSize: number): void {
    if (this.workerState) {
      this.workerState.worker.postMessage({
        type: 'SET_CHUNK_SIZE',
        chunkSize,
      });
    }
  }
  
  /**
   * Set compression mode for future jobs
   */
  setMode(mode: CompressionMode): void {
    if (this.workerState) {
      this.workerState.worker.postMessage({
        type: 'SET_MODE',
        mode,
      });
    }
  }
  
  /**
   * Get job state
   */
  getJob(jobId: JobId): JobState | undefined {
    return this.jobs.get(jobId);
  }
  
  /**
   * Get all jobs
   */
  getAllJobs(): JobState[] {
    return Array.from(this.jobs.values());
  }
  
  /**
   * Check if worker is ready
   */
  isReady(): boolean {
    return this.workerState?.isReady ?? false;
  }
  
  /**
   * Get worker capabilities
   */
  getCapabilities() {
    return this.workerState?.capabilities ?? null;
  }
  
  /**
   * Check if there's an active job
   */
  hasActiveJob(): boolean {
    return this.workerState?.activeJobId !== null;
  }
  
  /**
   * Terminate worker
   */
  terminate(): void {
    if (this.workerState) {
      this.workerState.worker.terminate();
      this.workerState = null;
    }
    this.jobs.clear();
    this.initPromise = null;
  }
}

// Singleton instance
let managerInstance: WorkerManager | null = null;

/**
 * Get or create worker manager instance
 */
export function getWorkerManager(config?: Partial<WorkerManagerConfig>): WorkerManager {
  if (!managerInstance) {
    managerInstance = new WorkerManager(config);
  }
  return managerInstance;
}

/**
 * Reset worker manager (for testing)
 */
export function resetWorkerManager(): void {
  managerInstance?.terminate();
  managerInstance = null;
}
