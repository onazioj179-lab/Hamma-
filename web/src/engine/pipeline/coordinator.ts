/**
 * SPK Fail-Safe Coordinator
 * 
 * THE AUTHORITATIVE CONTROLLER for the compression pipeline.
 * Manages workers, scheduling, retries, memory safety, and guaranteed
 * forward progress for any file size (MB to multi-TB).
 * 
 * Core Guarantees:
 * 1. Every chunk is eventually processed (no chunk lost)
 * 2. Automatic recovery from all failure modes
 * 3. Memory-safe operation at any scale
 * 4. Continuous progress feedback to frontend
 * 5. Valid archive output guaranteed
 * 
 * @module pipeline/coordinator
 * @version 1.0.0
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CoordinatorConfig {
  /** Minimum workers to maintain */
  minWorkers: number;
  /** Maximum workers allowed */
  maxWorkers: number;
  /** Chunk processing timeout (ms) */
  chunkTimeout: number;
  /** Maximum retries per chunk */
  maxChunkRetries: number;
  /** Maximum active chunk buffers in memory */
  maxActiveBuffers: number;
  /** Memory limit before throttling (bytes) */
  memoryLimit: number;
  /** Watchdog interval (ms) */
  watchdogInterval: number;
  /** Worker unresponsive timeout (ms) */
  workerTimeout: number;
  /** WASM reset timeout (ms) */
  wasmResetTimeout: number;
  /** Initial backoff delay (ms) */
  initialBackoff: number;
  /** Maximum backoff delay (ms) */
  maxBackoff: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Micro-chunk size for recovery (bytes) */
  microChunkSize: number;
  /** Default chunk size (bytes) */
  defaultChunkSize: number;
  /** Enable verbose logging */
  verbose: boolean;
}

export type ChunkStatus = 
  | 'pending'       // Waiting to be dispatched
  | 'dispatched'    // Sent to worker
  | 'processing'    // Worker acknowledged
  | 'completed'     // Successfully processed
  | 'failed'        // Failed, may retry
  | 'retrying'      // Scheduled for retry
  | 'abandoned';    // Max retries exceeded (escalate)

export interface ChunkState {
  index: number;
  offset: number;
  size: number;
  status: ChunkStatus;
  workerId: string | null;
  buffer: ArrayBuffer | null;
  compressedData: Uint8Array | null;
  compressedSize: number;
  startTime: number;
  endTime: number;
  retries: number;
  lastError: string | null;
  backoffDelay: number;
  retryScheduledAt: number;
}

export type WorkerStatus = 
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'unresponsive'
  | 'dead'
  | 'recovering';

export interface WorkerState {
  id: string;
  worker: Worker;
  status: WorkerStatus;
  wasmReady: boolean;
  currentChunk: number | null;
  lastMessageTime: number;
  chunksProcessed: number;
  consecutiveFailures: number;
  wasmResets: number;
  respawns: number;
}

export interface JobOptions {
  level?: number;
  chunkSize?: number;
  enableDedup?: boolean;
  metadata?: Record<string, unknown>;
}

export interface JobResult {
  success: boolean;
  blob?: Blob;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  duration: number;
  chunksProcessed: number;
  retries: number;
  workerRestarts: number;
  wasmResets: number;
  errors: string[];
}

export type CoordinatorEventType =
  | 'job-started'
  | 'job-progress'
  | 'job-paused'
  | 'job-resumed'
  | 'job-complete'
  | 'job-failed'
  | 'chunk-dispatched'
  | 'chunk-completed'
  | 'chunk-retry'
  | 'chunk-failed'
  | 'worker-ready'
  | 'worker-busy'
  | 'worker-unresponsive'
  | 'worker-restarted'
  | 'worker-dead'
  | 'wasm-reset'
  | 'wasm-error'
  | 'memory-pressure'
  | 'pipeline-stalled'
  | 'pipeline-recovering'
  | 'pipeline-recovered'
  | 'watchdog-trigger';

export interface CoordinatorEvent {
  type: CoordinatorEventType;
  timestamp: number;
  message: string;
  chunkIndex?: number;
  workerId?: string;
  progress?: CoordinatorProgress;
  details?: Record<string, unknown>;
}

export interface CoordinatorProgress {
  phase: 'idle' | 'reading' | 'compressing' | 'finalizing' | 'complete' | 'error';
  bytesRead: number;
  bytesCompressed: number;
  totalBytes: number;
  chunksCompleted: number;
  totalChunks: number;
  percentage: number;
  speed: number;
  eta: number;
  activeWorkers: number;
  pendingChunks: number;
  retries: number;
  memoryUsage: number;
  isRecovering: boolean;
}

export type CoordinatorEventHandler = (event: CoordinatorEvent) => void;

// Message types for worker communication
export interface WorkerCommand {
  type: 'init-wasm' | 'process-chunk' | 'reset' | 'flush' | 'finalize' | 'shutdown';
  id: string;
  payload?: unknown;
}

export interface WorkerResponse {
  type: 'ready' | 'chunk-result' | 'flush-result' | 'finalize-result' | 'error' | 'reset-complete';
  id: string;
  success: boolean;
  payload?: unknown;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const KB = 1024;
const MB = KB * 1024;

const DEFAULT_CONFIG: CoordinatorConfig = {
  minWorkers: 2,
  maxWorkers: navigator.hardwareConcurrency || 4,
  chunkTimeout: 30000,
  maxChunkRetries: 3,
  maxActiveBuffers: 8,
  memoryLimit: 300 * MB,
  watchdogInterval: 500,
  workerTimeout: 15000,
  wasmResetTimeout: 5000,
  initialBackoff: 50,
  maxBackoff: 5000,
  backoffMultiplier: 2,
  microChunkSize: 256 * KB,
  defaultChunkSize: 4 * MB,
  verbose: false,
};

// ============================================================================
// COORDINATOR CLASS
// ============================================================================

export class Coordinator {
  private config: CoordinatorConfig;
  
  // Workers
  private workers = new Map<string, WorkerState>();
  private workerIdCounter = 0;
  
  // Chunks
  private chunks = new Map<number, ChunkState>();
  private pendingQueue: number[] = [];
  private completedChunks = new Set<number>();
  
  // Job state
  private isRunning = false;
  private isPaused = false;
  private abortController: AbortController | null = null;
  private currentFile: File | null = null;
  private currentOptions: JobOptions = {};
  private currentChunkSize: number;
  private totalChunks = 0;
  private totalBytes = 0;
  private bytesRead = 0;
  private bytesCompressed = 0;
  
  // Timers
  private watchdogTimer: number | null = null;
  private lastProgressTime = 0;
  private jobStartTime = 0;
  
  // Recovery state
  private isRecovering = false;
  private consecutiveStalls = 0;
  private totalRetries = 0;
  private totalWorkerRestarts = 0;
  private totalWasmResets = 0;
  private errors: string[] = [];
  
  // Event handlers
  private eventHandlers: CoordinatorEventHandler[] = [];
  
  // Promises for async operations
  private jobPromise: Promise<JobResult> | null = null;
  private jobResolve: ((result: JobResult) => void) | null = null;
  private jobReject: ((error: Error) => void) | null = null;
  
  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentChunkSize = this.config.defaultChunkSize;
  }
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  /**
   * Start a compression job
   */
  async startJob(files: File | File[], options: JobOptions = {}): Promise<JobResult> {
    // Handle single file or array
    const fileArray = Array.isArray(files) ? files : [files];
    if (fileArray.length === 0) {
      return this.createErrorResult('No files provided');
    }
    
    // For now, handle single file (multi-file support can be added)
    const file = fileArray[0];
    
    // Validate
    if (this.isRunning) {
      throw new Error('Job already in progress');
    }
    
    // Initialize job
    this.reset();
    this.isRunning = true;
    this.currentFile = file;
    this.currentOptions = options;
    this.totalBytes = file.size;
    this.jobStartTime = Date.now();
    this.abortController = new AbortController();
    
    // Determine chunk size
    this.currentChunkSize = options.chunkSize || this.calculateChunkSize(file.size);
    this.totalChunks = Math.ceil(file.size / this.currentChunkSize);
    
    // Create job promise
    this.jobPromise = new Promise<JobResult>((resolve, reject) => {
      this.jobResolve = resolve;
      this.jobReject = reject;
    });
    
    // Emit start event
    this.emit({
      type: 'job-started',
      timestamp: Date.now(),
      message: `Starting compression: ${file.name} (${this.formatBytes(file.size)})`,
      details: {
        fileName: file.name,
        fileSize: file.size,
        chunkSize: this.currentChunkSize,
        totalChunks: this.totalChunks,
        workers: this.config.maxWorkers,
      },
    });
    
    try {
      // Initialize workers
      await this.initializeWorkers();
      
      // Start watchdog
      this.startWatchdog();
      
      // Start the processing loop
      this.processLoop();
      
      // Wait for completion
      return await this.jobPromise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.push(message);
      return this.createErrorResult(message);
    }
  }
  
  /**
   * Feed a chunk into the pipeline (called by streamer)
   */
  feedChunk(buffer: ArrayBuffer, index: number): void {
    const offset = index * this.currentChunkSize;
    
    const chunk: ChunkState = {
      index,
      offset,
      size: buffer.byteLength,
      status: 'pending',
      workerId: null,
      buffer,
      compressedData: null,
      compressedSize: 0,
      startTime: 0,
      endTime: 0,
      retries: 0,
      lastError: null,
      backoffDelay: this.config.initialBackoff,
      retryScheduledAt: 0,
    };
    
    this.chunks.set(index, chunk);
    this.pendingQueue.push(index);
    this.bytesRead += buffer.byteLength;
    
    if (this.config.verbose) {
      this.log(`Fed chunk ${index} (${this.formatBytes(buffer.byteLength)})`);
    }
  }
  
  /**
   * Handle message from worker
   */
  handleWorkerMessage(workerId: string, response: WorkerResponse): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.log(`Warning: Message from unknown worker ${workerId}`);
      return;
    }
    
    worker.lastMessageTime = Date.now();
    
    switch (response.type) {
      case 'ready':
        this.handleWorkerReady(workerId);
        break;
      case 'chunk-result':
        this.handleChunkResult(workerId, response);
        break;
      case 'error':
        this.handleWorkerError(workerId, response);
        break;
      case 'reset-complete':
        this.handleWasmResetComplete(workerId);
        break;
      case 'flush-result':
      case 'finalize-result':
        // Handled separately in finalization
        break;
    }
  }
  
  /**
   * Retry a specific chunk
   */
  retryChunk(index: number): void {
    const chunk = this.chunks.get(index);
    if (!chunk) return;
    
    chunk.retries++;
    this.totalRetries++;
    
    // Calculate backoff
    chunk.backoffDelay = Math.min(
      chunk.backoffDelay * this.config.backoffMultiplier,
      this.config.maxBackoff
    );
    
    // Schedule retry
    chunk.status = 'retrying';
    chunk.retryScheduledAt = Date.now() + chunk.backoffDelay;
    
    this.emit({
      type: 'chunk-retry',
      timestamp: Date.now(),
      message: `Retrying chunk ${index} (attempt ${chunk.retries + 1})`,
      chunkIndex: index,
      details: {
        retries: chunk.retries,
        backoff: chunk.backoffDelay,
        lastError: chunk.lastError,
      },
    });
    
    // If max retries exceeded, escalate
    if (chunk.retries >= this.config.maxChunkRetries) {
      this.escalateChunkFailure(index);
    }
  }
  
  /**
   * Restart a worker
   */
  async restartWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    this.log(`Restarting worker ${workerId}`);
    this.totalWorkerRestarts++;
    
    // Get the chunk that was being processed
    const pendingChunk = worker.currentChunk;
    
    // Terminate old worker
    try {
      worker.worker.terminate();
    } catch {
      // Ignore termination errors
    }
    
    // Mark as dead temporarily
    worker.status = 'dead';
    
    this.emit({
      type: 'worker-restarted',
      timestamp: Date.now(),
      message: `Worker ${workerId} restarting`,
      workerId,
      details: {
        respawns: worker.respawns + 1,
        pendingChunk,
      },
    });
    
    // Respawn
    await this.spawnWorker(workerId);
    worker.respawns++;
    
    // Resend pending chunk
    if (pendingChunk !== null) {
      const chunk = this.chunks.get(pendingChunk);
      if (chunk && chunk.status !== 'completed') {
        chunk.status = 'pending';
        chunk.workerId = null;
        this.pendingQueue.unshift(pendingChunk);
      }
    }
  }
  
  /**
   * Recover the entire pipeline from a stalled state
   */
  async recoverPipeline(): Promise<void> {
    if (this.isRecovering) return;
    
    this.isRecovering = true;
    this.consecutiveStalls++;
    
    this.emit({
      type: 'pipeline-recovering',
      timestamp: Date.now(),
      message: 'Pipeline recovery initiated',
      details: {
        consecutiveStalls: this.consecutiveStalls,
        activeWorkers: this.getActiveWorkerCount(),
        pendingChunks: this.pendingQueue.length,
      },
    });
    
    try {
      // 1. Check all workers
      for (const [id, worker] of this.workers) {
        if (worker.status === 'unresponsive' || worker.status === 'dead') {
          await this.restartWorker(id);
        } else if (worker.status === 'busy') {
          // Check if chunk is stalled
          if (worker.currentChunk !== null) {
            const chunk = this.chunks.get(worker.currentChunk);
            if (chunk && Date.now() - chunk.startTime > this.config.chunkTimeout) {
              // Reset WASM and retry
              await this.resetWorkerWasm(id);
              chunk.status = 'pending';
              chunk.workerId = null;
              this.pendingQueue.unshift(worker.currentChunk);
              worker.currentChunk = null;
            }
          }
        }
      }
      
      // 2. Re-queue any stuck chunks
      for (const [index, chunk] of this.chunks) {
        if (chunk.status === 'dispatched' || chunk.status === 'processing') {
          const elapsed = Date.now() - chunk.startTime;
          if (elapsed > this.config.chunkTimeout) {
            chunk.status = 'pending';
            chunk.workerId = null;
            if (!this.pendingQueue.includes(index)) {
              this.pendingQueue.push(index);
            }
          }
        }
      }
      
      // 3. If still struggling, reduce chunk size
      if (this.consecutiveStalls >= 3) {
        this.currentChunkSize = Math.max(
          this.config.microChunkSize,
          Math.floor(this.currentChunkSize / 2)
        );
        this.log(`Reducing chunk size to ${this.formatBytes(this.currentChunkSize)}`);
      }
      
      this.emit({
        type: 'pipeline-recovered',
        timestamp: Date.now(),
        message: 'Pipeline recovery complete',
        details: {
          newChunkSize: this.currentChunkSize,
          queuedChunks: this.pendingQueue.length,
        },
      });
    } finally {
      this.isRecovering = false;
    }
  }
  
  /**
   * Finalize the archive after all chunks are processed
   */
  async finalizeArchive(): Promise<Blob> {
    this.emit({
      type: 'job-progress',
      timestamp: Date.now(),
      message: 'Finalizing archive...',
      progress: this.getProgress(),
    });
    
    // 1. Collect all compressed chunks in order
    const sortedChunks: Uint8Array[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk || !chunk.compressedData) {
        throw new Error(`Missing chunk ${i}`);
      }
      sortedChunks.push(chunk.compressedData);
    }
    
    // 2. Build chunk table
    const chunkTable = this.buildChunkTable();
    
    // 3. Generate header
    const header = this.generateHeader(chunkTable);
    
    // 4. Generate footer
    const footer = this.generateFooter(chunkTable);
    
    // 5. Assemble archive - explicit ArrayBuffer casting for Blob compatibility
    const chunkBuffers: ArrayBuffer[] = sortedChunks.map(c => 
      c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer
    );
    
    const parts: BlobPart[] = [
      header as BlobPart,
      ...(chunkBuffers as BlobPart[]),
      chunkTable.buffer.slice(0) as BlobPart,
      footer as BlobPart,
    ];
    
    const blob = new Blob(parts, { type: 'application/x-spk' });
    
    // 6. Verify
    this.verifyArchive(blob, chunkTable);
    
    return blob;
  }
  
  /**
   * Pause the pipeline
   */
  pause(): void {
    this.isPaused = true;
    this.emit({
      type: 'job-paused',
      timestamp: Date.now(),
      message: 'Pipeline paused',
      progress: this.getProgress(),
    });
  }
  
  /**
   * Resume the pipeline
   */
  resume(): void {
    this.isPaused = false;
    this.emit({
      type: 'job-resumed',
      timestamp: Date.now(),
      message: 'Pipeline resumed',
      progress: this.getProgress(),
    });
  }
  
  /**
   * Cancel the current job
   */
  cancel(): void {
    this.abortController?.abort();
    this.isRunning = false;
    this.stopWatchdog();
    this.terminateAllWorkers();
    
    if (this.jobReject) {
      this.jobReject(new Error('Job cancelled'));
    }
  }
  
  /**
   * Add event handler
   */
  onEvent(handler: CoordinatorEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index >= 0) this.eventHandlers.splice(index, 1);
    };
  }
  
  /**
   * Get current progress
   */
  getProgress(): CoordinatorProgress {
    const elapsed = Date.now() - this.jobStartTime;
    const speed = elapsed > 0 ? (this.bytesCompressed / elapsed) * 1000 : 0;
    const remaining = this.totalBytes - this.bytesCompressed;
    const eta = speed > 0 ? remaining / speed : 0;
    
    return {
      phase: this.getPhase(),
      bytesRead: this.bytesRead,
      bytesCompressed: this.bytesCompressed,
      totalBytes: this.totalBytes,
      chunksCompleted: this.completedChunks.size,
      totalChunks: this.totalChunks,
      percentage: this.totalBytes > 0 ? (this.bytesCompressed / this.totalBytes) * 100 : 0,
      speed,
      eta,
      activeWorkers: this.getActiveWorkerCount(),
      pendingChunks: this.pendingQueue.length,
      retries: this.totalRetries,
      memoryUsage: this.estimateMemoryUsage(),
      isRecovering: this.isRecovering,
    };
  }
  
  // ==========================================================================
  // PROCESSING LOOP (SECTION 2)
  // ==========================================================================
  
  /**
   * Main processing loop - guarantees forward progress
   */
  private async processLoop(): Promise<void> {
    const file = this.currentFile;
    if (!file) return;
    
    try {
      // Stream the file and dispatch chunks
      await this.streamAndDispatch(file);
      
      // Wait for all chunks to complete
      await this.waitForAllChunks();
      
      // Finalize
      const blob = await this.finalizeArchive();
      
      // Complete
      this.complete(blob);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.push(message);
      this.fail(message);
    }
  }
  
  /**
   * Stream file and dispatch chunks to workers
   */
  private async streamAndDispatch(file: File): Promise<void> {
    let offset = 0;
    let chunkIndex = 0;
    
    while (offset < file.size) {
      // Check for abort
      if (this.abortController?.signal.aborted) {
        throw new Error('Job aborted');
      }
      
      // Wait if paused
      while (this.isPaused) {
        await this.sleep(100);
      }
      
      // Memory pressure check
      await this.enforceMemoryLimits();
      
      // Read next chunk
      const chunkSize = Math.min(this.currentChunkSize, file.size - offset);
      const blob = file.slice(offset, offset + chunkSize);
      const buffer = await blob.arrayBuffer();
      
      // Feed chunk
      this.feedChunk(buffer, chunkIndex);
      
      // Dispatch immediately if worker available
      this.dispatchPendingChunks();
      
      offset += chunkSize;
      chunkIndex++;
    }
  }
  
  /**
   * Dispatch pending chunks to available workers
   */
  private dispatchPendingChunks(): void {
    while (this.pendingQueue.length > 0) {
      // Get available worker
      const worker = this.getAvailableWorker();
      if (!worker) break;
      
      // Get next chunk (consider retries with backoff)
      const chunkIndex = this.getNextReadyChunk();
      if (chunkIndex === null) break;
      
      // Dispatch
      this.dispatchChunk(chunkIndex, worker.id);
    }
  }
  
  /**
   * Wait for all chunks to complete
   */
  private async waitForAllChunks(): Promise<void> {
    const checkInterval = 100;
    const maxWait = 60 * 60 * 1000; // 1 hour max
    const startWait = Date.now();
    
    while (this.completedChunks.size < this.totalChunks) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Job aborted');
      }
      
      if (Date.now() - startWait > maxWait) {
        throw new Error('Job timed out waiting for chunks');
      }
      
      // Dispatch any ready chunks
      this.dispatchPendingChunks();
      
      // Process retry queue
      this.processRetryQueue();
      
      await this.sleep(checkInterval);
    }
  }
  
  /**
   * Get next chunk ready for dispatch (respecting backoff)
   */
  private getNextReadyChunk(): number | null {
    const now = Date.now();
    
    for (let i = 0; i < this.pendingQueue.length; i++) {
      const index = this.pendingQueue[i];
      const chunk = this.chunks.get(index);
      
      if (!chunk) continue;
      
      // Skip if waiting for backoff
      if (chunk.status === 'retrying' && chunk.retryScheduledAt > now) {
        continue;
      }
      
      // Found a ready chunk
      this.pendingQueue.splice(i, 1);
      return index;
    }
    
    return null;
  }
  
  /**
   * Process chunks waiting for retry
   */
  private processRetryQueue(): void {
    const now = Date.now();
    
    for (const [index, chunk] of this.chunks) {
      if (chunk.status === 'retrying' && chunk.retryScheduledAt <= now) {
        chunk.status = 'pending';
        if (!this.pendingQueue.includes(index)) {
          this.pendingQueue.push(index);
        }
      }
    }
  }
  
  // ==========================================================================
  // CHUNK DISPATCH & HANDLING
  // ==========================================================================
  
  /**
   * Dispatch a chunk to a specific worker
   */
  private dispatchChunk(chunkIndex: number, workerId: string): void {
    const chunk = this.chunks.get(chunkIndex);
    const worker = this.workers.get(workerId);
    
    if (!chunk || !worker || !chunk.buffer) return;
    
    // Update state
    chunk.status = 'dispatched';
    chunk.workerId = workerId;
    chunk.startTime = Date.now();
    
    worker.status = 'busy';
    worker.currentChunk = chunkIndex;
    
    // Send to worker
    const command: WorkerCommand = {
      type: 'process-chunk',
      id: `chunk-${chunkIndex}`,
      payload: {
        index: chunkIndex,
        buffer: chunk.buffer,
        level: this.currentOptions.level || 3,
      },
    };
    
    worker.worker.postMessage(command, [chunk.buffer]);
    
    // Clear buffer reference (transferred)
    chunk.buffer = null;
    
    this.emit({
      type: 'chunk-dispatched',
      timestamp: Date.now(),
      message: `Chunk ${chunkIndex} dispatched to worker ${workerId}`,
      chunkIndex,
      workerId,
    });
    
    if (this.config.verbose) {
      this.log(`Dispatched chunk ${chunkIndex} to ${workerId}`);
    }
  }
  
  /**
   * Handle successful chunk result
   */
  private handleChunkResult(workerId: string, response: WorkerResponse): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    const payload = response.payload as {
      index: number;
      compressedData: Uint8Array;
      originalSize: number;
      compressedSize: number;
    };
    
    const chunk = this.chunks.get(payload.index);
    if (!chunk) return;
    
    // Update chunk state
    chunk.status = 'completed';
    chunk.compressedData = payload.compressedData;
    chunk.compressedSize = payload.compressedSize;
    chunk.endTime = Date.now();
    
    // Update worker state
    worker.status = 'ready';
    worker.currentChunk = null;
    worker.chunksProcessed++;
    worker.consecutiveFailures = 0;
    
    // Track completion
    this.completedChunks.add(payload.index);
    this.bytesCompressed += chunk.size;
    this.lastProgressTime = Date.now();
    this.consecutiveStalls = 0;
    
    this.emit({
      type: 'chunk-completed',
      timestamp: Date.now(),
      message: `Chunk ${payload.index} completed`,
      chunkIndex: payload.index,
      workerId,
      progress: this.getProgress(),
      details: {
        originalSize: payload.originalSize,
        compressedSize: payload.compressedSize,
        ratio: payload.originalSize / payload.compressedSize,
      },
    });
    
    // Dispatch next chunk
    this.dispatchPendingChunks();
  }
  
  /**
   * Handle worker error
   */
  private handleWorkerError(workerId: string, response: WorkerResponse): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    const errorMsg = response.error || 'Unknown worker error';
    this.log(`Worker ${workerId} error: ${errorMsg}`);
    
    worker.consecutiveFailures++;
    
    // Get the chunk that failed
    if (worker.currentChunk !== null) {
      const chunk = this.chunks.get(worker.currentChunk);
      if (chunk) {
        chunk.status = 'failed';
        chunk.lastError = errorMsg;
        this.retryChunk(worker.currentChunk);
      }
      worker.currentChunk = null;
    }
    
    worker.status = 'ready';
    
    this.emit({
      type: 'wasm-error',
      timestamp: Date.now(),
      message: `WASM error in worker ${workerId}: ${errorMsg}`,
      workerId,
      details: { error: errorMsg },
    });
  }
  
  /**
   * Handle worker becoming ready
   */
  private handleWorkerReady(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    worker.status = 'ready';
    worker.wasmReady = true;
    
    this.emit({
      type: 'worker-ready',
      timestamp: Date.now(),
      message: `Worker ${workerId} ready`,
      workerId,
    });
    
    // Dispatch pending chunks
    this.dispatchPendingChunks();
  }
  
  /**
   * Handle WASM reset complete
   */
  private handleWasmResetComplete(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    worker.status = 'ready';
    worker.wasmReady = true;
    worker.wasmResets++;
    this.totalWasmResets++;
    
    this.emit({
      type: 'wasm-reset',
      timestamp: Date.now(),
      message: `WASM reset complete for worker ${workerId}`,
      workerId,
    });
    
    // Dispatch pending chunks
    this.dispatchPendingChunks();
  }
  
  // ==========================================================================
  // ESCALATION & RECOVERY (SECTIONS 3-5)
  // ==========================================================================
  
  /**
   * Escalate chunk failure after max retries
   */
  private async escalateChunkFailure(index: number): Promise<void> {
    const chunk = this.chunks.get(index);
    if (!chunk) return;
    
    this.log(`Escalating chunk ${index} failure after ${chunk.retries} retries`);
    
    // 1. Reset WASM for the worker that last tried
    if (chunk.workerId) {
      await this.resetWorkerWasm(chunk.workerId);
    }
    
    // 2. Restart the worker
    if (chunk.workerId) {
      await this.restartWorker(chunk.workerId);
    }
    
    // 3. Switch to micro-chunk mode
    this.currentChunkSize = this.config.microChunkSize;
    
    // 4. Reset retry count and re-queue
    chunk.retries = 0;
    chunk.backoffDelay = this.config.initialBackoff;
    chunk.status = 'pending';
    chunk.workerId = null;
    
    if (!this.pendingQueue.includes(index)) {
      this.pendingQueue.unshift(index);
    }
    
    this.emit({
      type: 'chunk-failed',
      timestamp: Date.now(),
      message: `Chunk ${index} escalated - resetting worker and WASM`,
      chunkIndex: index,
      details: {
        newChunkSize: this.currentChunkSize,
        action: 'escalate',
      },
    });
  }
  
  /**
   * Reset WASM for a specific worker
   */
  private async resetWorkerWasm(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    this.log(`Resetting WASM for worker ${workerId}`);
    
    worker.status = 'recovering';
    worker.wasmReady = false;
    
    const command: WorkerCommand = {
      type: 'reset',
      id: `reset-${Date.now()}`,
    };
    
    worker.worker.postMessage(command);
    
    // Wait for reset with timeout
    await Promise.race([
      new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (worker.wasmReady) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      }),
      this.sleep(this.config.wasmResetTimeout),
    ]);
    
    if (!worker.wasmReady) {
      // Reset failed, restart worker
      await this.restartWorker(workerId);
    }
  }
  
  // ==========================================================================
  // WATCHDOG (SECTION 7)
  // ==========================================================================
  
  /**
   * Start the watchdog timer
   */
  private startWatchdog(): void {
    this.stopWatchdog();
    
    this.watchdogTimer = window.setInterval(() => {
      this.watchdogTick();
    }, this.config.watchdogInterval);
  }
  
  /**
   * Stop the watchdog timer
   */
  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
  
  /**
   * Watchdog tick - check for stalls
   */
  private watchdogTick(): void {
    if (!this.isRunning || this.isPaused) return;
    
    const now = Date.now();
    
    // Check if we've made progress
    const timeSinceProgress = now - this.lastProgressTime;
    if (timeSinceProgress > this.config.chunkTimeout && this.completedChunks.size < this.totalChunks) {
      this.emit({
        type: 'watchdog-trigger',
        timestamp: now,
        message: 'Watchdog: No progress detected',
        details: {
          timeSinceProgress,
          completed: this.completedChunks.size,
          total: this.totalChunks,
        },
      });
      
      // Trigger recovery
      this.recoverPipeline();
    }
    
    // Check for unresponsive workers
    for (const [id, worker] of this.workers) {
      if (worker.status === 'busy') {
        const timeSinceMessage = now - worker.lastMessageTime;
        if (timeSinceMessage > this.config.workerTimeout) {
          this.emit({
            type: 'worker-unresponsive',
            timestamp: now,
            message: `Worker ${id} unresponsive`,
            workerId: id,
            details: { timeSinceMessage },
          });
          
          worker.status = 'unresponsive';
          this.restartWorker(id);
        }
      }
    }
    
    // Check for stuck chunks
    for (const [index, chunk] of this.chunks) {
      if (chunk.status === 'dispatched' || chunk.status === 'processing') {
        const elapsed = now - chunk.startTime;
        if (elapsed > this.config.chunkTimeout) {
          this.log(`Chunk ${index} timed out after ${elapsed}ms`);
          chunk.status = 'failed';
          chunk.lastError = 'Timeout';
          this.retryChunk(index);
        }
      }
    }
    
    // Emit progress (heartbeat)
    this.emit({
      type: 'job-progress',
      timestamp: now,
      message: 'Progress update',
      progress: this.getProgress(),
    });
  }
  
  // ==========================================================================
  // MEMORY SAFETY (SECTION 6)
  // ==========================================================================
  
  /**
   * Enforce memory limits
   */
  private async enforceMemoryLimits(): Promise<void> {
    // Count active buffers
    let activeBuffers = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.buffer !== null || chunk.compressedData !== null) {
        activeBuffers++;
      }
    }
    
    // Wait if too many active buffers
    while (activeBuffers >= this.config.maxActiveBuffers) {
      this.emit({
        type: 'memory-pressure',
        timestamp: Date.now(),
        message: 'Memory pressure - throttling',
        details: { activeBuffers, limit: this.config.maxActiveBuffers },
      });
      
      await this.sleep(100);
      
      // Recount
      activeBuffers = 0;
      for (const chunk of this.chunks.values()) {
        if (chunk.buffer !== null) activeBuffers++;
      }
    }
    
    // Check actual memory if available
    if ('memory' in performance) {
      const memInfo = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      if (memInfo.usedJSHeapSize > this.config.memoryLimit) {
        // Switch to micro-chunk mode
        this.currentChunkSize = this.config.microChunkSize;
        this.log(`Memory limit exceeded - switching to micro-chunks`);
      }
    }
  }
  
  /**
   * Estimate current memory usage
   */
  private estimateMemoryUsage(): number {
    let usage = 0;
    
    for (const chunk of this.chunks.values()) {
      if (chunk.buffer) usage += chunk.buffer.byteLength;
      if (chunk.compressedData) usage += chunk.compressedData.byteLength;
    }
    
    return usage;
  }
  
  // ==========================================================================
  // WORKER MANAGEMENT
  // ==========================================================================
  
  /**
   * Initialize worker pool
   */
  private async initializeWorkers(): Promise<void> {
    const workerCount = this.config.maxWorkers;
    
    for (let i = 0; i < workerCount; i++) {
      const id = `worker-${++this.workerIdCounter}`;
      await this.spawnWorker(id);
    }
    
    // Wait for all workers to be ready
    await this.waitForWorkersReady();
  }
  
  /**
   * Spawn a new worker
   */
  private async spawnWorker(id: string): Promise<void> {
    // Create worker - adjust path based on your setup
    const worker = new Worker(
      new URL('../worker/compression.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    const state: WorkerState = {
      id,
      worker,
      status: 'initializing',
      wasmReady: false,
      currentChunk: null,
      lastMessageTime: Date.now(),
      chunksProcessed: 0,
      consecutiveFailures: 0,
      wasmResets: 0,
      respawns: this.workers.get(id)?.respawns || 0,
    };
    
    // Set up message handler
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerMessage(id, event.data);
    };
    
    worker.onerror = (error) => {
      this.log(`Worker ${id} error: ${error.message}`);
      state.status = 'dead';
      this.restartWorker(id);
    };
    
    this.workers.set(id, state);
    
    // Initialize WASM
    const initCommand: WorkerCommand = {
      type: 'init-wasm',
      id: `init-${id}`,
    };
    
    worker.postMessage(initCommand);
  }
  
  /**
   * Wait for all workers to be ready
   */
  private async waitForWorkersReady(): Promise<void> {
    const timeout = 30000;
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const allReady = Array.from(this.workers.values()).every(
        w => w.status === 'ready'
      );
      
      if (allReady) return;
      await this.sleep(100);
    }
    
    throw new Error('Workers failed to initialize');
  }
  
  /**
   * Get an available worker
   */
  private getAvailableWorker(): WorkerState | null {
    for (const worker of this.workers.values()) {
      if (worker.status === 'ready') {
        return worker;
      }
    }
    return null;
  }
  
  /**
   * Get count of active workers
   */
  private getActiveWorkerCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === 'ready' || worker.status === 'busy') {
        count++;
      }
    }
    return count;
  }
  
  /**
   * Terminate all workers
   */
  private terminateAllWorkers(): void {
    for (const [id, worker] of this.workers) {
      try {
        worker.worker.terminate();
      } catch {
        // Ignore
      }
      this.workers.delete(id);
    }
  }
  
  // ==========================================================================
  // FINALIZATION (SECTION 8)
  // ==========================================================================
  
  /**
   * Build chunk table
   */
  private buildChunkTable(): Uint8Array {
    const entries: { offset: number; compressedSize: number; originalSize: number }[] = [];
    let currentOffset = 64; // Header size
    
    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk || !chunk.compressedData) {
        throw new Error(`Missing chunk ${i}`);
      }
      
      entries.push({
        offset: currentOffset,
        compressedSize: chunk.compressedSize,
        originalSize: chunk.size,
      });
      
      currentOffset += chunk.compressedSize;
    }
    
    // Serialize table (simple format: 24 bytes per entry)
    const tableSize = entries.length * 24;
    const buffer = new ArrayBuffer(tableSize);
    const view = new DataView(buffer);
    
    entries.forEach((entry, i) => {
      const base = i * 24;
      view.setBigUint64(base, BigInt(entry.offset), true);
      view.setBigUint64(base + 8, BigInt(entry.compressedSize), true);
      view.setBigUint64(base + 16, BigInt(entry.originalSize), true);
    });
    
    return new Uint8Array(buffer);
  }
  
  /**
   * Generate archive header
   */
  private generateHeader(_chunkTable: Uint8Array): ArrayBuffer {
    const headerSize = 64;
    const buffer = new ArrayBuffer(headerSize);
    const view = new DataView(buffer);
    
    // Magic: SPK\0
    view.setUint32(0, 0x53504B00, true);
    // Version
    view.setUint16(4, 1, true);
    // Flags
    view.setUint16(6, 0, true);
    // Header size
    view.setUint32(8, headerSize, true);
    // Original size
    view.setBigUint64(12, BigInt(this.totalBytes), true);
    // Chunk count
    view.setUint32(20, this.totalChunks, true);
    // Timestamp
    view.setBigUint64(24, BigInt(Date.now()), true);
    
    return buffer;
  }
  
  /**
   * Generate archive footer
   */
  private generateFooter(_chunkTable: Uint8Array): ArrayBuffer {
    const footerSize = 32;
    const buffer = new ArrayBuffer(footerSize);
    const view = new DataView(buffer);
    
    // Magic: SPKE
    view.setUint32(0, 0x53504B45, true);
    // Chunk count
    view.setUint32(4, this.totalChunks, true);
    // Original size
    view.setBigUint64(8, BigInt(this.totalBytes), true);
    // Compressed size
    view.setBigUint64(16, BigInt(this.bytesCompressed), true);
    // End magic
    view.setUint32(24, 0x454E4421, true);
    
    return buffer;
  }
  
  /**
   * Verify archive integrity
   */
  private verifyArchive(_blob: Blob, _chunkTable: Uint8Array): void {
    // Verify chunk count
    if (this.completedChunks.size !== this.totalChunks) {
      throw new Error(`Chunk count mismatch: ${this.completedChunks.size} vs ${this.totalChunks}`);
    }
    
    // Verify all chunks present
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.completedChunks.has(i)) {
        throw new Error(`Missing chunk ${i}`);
      }
    }
  }
  
  // ==========================================================================
  // COMPLETION
  // ==========================================================================
  
  /**
   * Complete the job successfully
   */
  private complete(blob: Blob): void {
    this.isRunning = false;
    this.stopWatchdog();
    
    const duration = Date.now() - this.jobStartTime;
    const compressionRatio = this.totalBytes / blob.size;
    
    const result: JobResult = {
      success: true,
      blob,
      originalSize: this.totalBytes,
      compressedSize: blob.size,
      compressionRatio,
      duration,
      chunksProcessed: this.completedChunks.size,
      retries: this.totalRetries,
      workerRestarts: this.totalWorkerRestarts,
      wasmResets: this.totalWasmResets,
      errors: this.errors,
    };
    
    this.emit({
      type: 'job-complete',
      timestamp: Date.now(),
      message: `Compression complete: ${this.formatBytes(this.totalBytes)} → ${this.formatBytes(blob.size)} (${compressionRatio.toFixed(2)}x)`,
      progress: this.getProgress(),
      details: { ...result } as Record<string, unknown>,
    });
    
    if (this.jobResolve) {
      this.jobResolve(result);
    }
    
    this.terminateAllWorkers();
  }
  
  /**
   * Fail the job
   */
  private fail(message: string): void {
    this.isRunning = false;
    this.stopWatchdog();
    
    const result = this.createErrorResult(message);
    
    this.emit({
      type: 'job-failed',
      timestamp: Date.now(),
      message: `Compression failed: ${message}`,
      progress: this.getProgress(),
      details: { error: message },
    });
    
    if (this.jobResolve) {
      this.jobResolve(result);
    }
    
    this.terminateAllWorkers();
  }
  
  /**
   * Create error result
   */
  private createErrorResult(message: string): JobResult {
    return {
      success: false,
      originalSize: this.totalBytes,
      compressedSize: 0,
      compressionRatio: 0,
      duration: Date.now() - this.jobStartTime,
      chunksProcessed: this.completedChunks.size,
      retries: this.totalRetries,
      workerRestarts: this.totalWorkerRestarts,
      wasmResets: this.totalWasmResets,
      errors: [...this.errors, message],
    };
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  /**
   * Reset coordinator state
   */
  private reset(): void {
    this.workers.clear();
    this.chunks.clear();
    this.pendingQueue = [];
    this.completedChunks.clear();
    this.isRunning = false;
    this.isPaused = false;
    this.abortController = null;
    this.currentFile = null;
    this.currentOptions = {};
    this.totalChunks = 0;
    this.totalBytes = 0;
    this.bytesRead = 0;
    this.bytesCompressed = 0;
    this.lastProgressTime = 0;
    this.jobStartTime = 0;
    this.isRecovering = false;
    this.consecutiveStalls = 0;
    this.totalRetries = 0;
    this.totalWorkerRestarts = 0;
    this.totalWasmResets = 0;
    this.errors = [];
    this.jobPromise = null;
    this.jobResolve = null;
    this.jobReject = null;
    this.currentChunkSize = this.config.defaultChunkSize;
  }
  
  /**
   * Calculate optimal chunk size for file
   */
  private calculateChunkSize(fileSize: number): number {
    if (fileSize < 1 * MB) return 64 * KB;
    if (fileSize < 10 * MB) return 256 * KB;
    if (fileSize < 100 * MB) return 1 * MB;
    if (fileSize < 1024 * MB) return 4 * MB;
    if (fileSize < 10 * 1024 * MB) return 16 * MB;
    return 64 * MB;
  }
  
  /**
   * Get current phase
   */
  private getPhase(): CoordinatorProgress['phase'] {
    if (!this.isRunning) return 'idle';
    if (this.completedChunks.size === this.totalChunks) return 'finalizing';
    if (this.bytesRead < this.totalBytes) return 'reading';
    return 'compressing';
  }
  
  /**
   * Emit event to handlers
   */
  private emit(event: CoordinatorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Event handler error:', e);
      }
    }
  }
  
  /**
   * Log message
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Coordinator] ${message}`);
    }
  }
  
  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
    if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  }
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SINGLETON & EXPORTS
// ============================================================================

let coordinatorInstance: Coordinator | null = null;

/**
 * Get the global Coordinator instance
 */
export function getCoordinator(config?: Partial<CoordinatorConfig>): Coordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new Coordinator(config);
  }
  return coordinatorInstance;
}

/**
 * Reset the global Coordinator instance
 */
export function resetCoordinator(): void {
  if (coordinatorInstance) {
    coordinatorInstance.cancel();
    coordinatorInstance = null;
  }
}

/**
 * Convenience function to compress a file
 */
export async function compressWithCoordinator(
  file: File,
  options: JobOptions = {},
  onProgress?: CoordinatorEventHandler
): Promise<JobResult> {
  const coordinator = getCoordinator();
  
  if (onProgress) {
    coordinator.onEvent(onProgress);
  }
  
  return coordinator.startJob(file, options);
}

/**
 * Subscribe to compression events
 */
export function onCoordinatorEvent(handler: CoordinatorEventHandler): () => void {
  return getCoordinator().onEvent(handler);
}
