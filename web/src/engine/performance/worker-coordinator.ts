/**
 * Parallel Worker Coordinator
 * Manages worker pool with CPU/GPU workers for parallel compression
 */

import type {
  WorkerPoolConfig,
  WorkerStatus,
  ChunkDescriptor,
  PerformanceResult,
  PipelineMetrics,
} from './types';

// Message types for worker communication
interface WorkerMessage {
  type: 'compress' | 'decompress' | 'status' | 'shutdown';
  chunkId?: string;
  data?: ArrayBuffer;
  config?: {
    mode: string;
    level: number;
  };
}

interface WorkerResponse {
  type: 'result' | 'progress' | 'error' | 'ready';
  chunkId?: string;
  data?: ArrayBuffer;
  originalSize?: number;
  compressedSize?: number;
  hash?: string;
  error?: string;
  processingTime?: number;
}

// Worker wrapper with status tracking
class ManagedWorker {
  readonly id: number;
  readonly type: 'cpu' | 'gpu';
  private worker: Worker | null = null;
  private status: WorkerStatus;
  private pendingResolves: Map<string, (response: WorkerResponse) => void> = new Map();
  private startTime = 0;
  private totalProcessingTime = 0;

  constructor(id: number, type: 'cpu' | 'gpu') {
    this.id = id;
    this.type = type;
    this.status = {
      id,
      type,
      active: false,
      currentChunk: null,
      bytesProcessed: 0,
      chunksProcessed: 0,
      avgProcessingTime: 0,
    };
  }

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    // Create inline worker for compression
    const workerCode = this.createWorkerCode();
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);

    // Set up message handler
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error(`[Worker ${this.id}] Error:`, error);
    };

    // Wait for ready signal
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          this.worker?.removeEventListener('message', handler);
          resolve();
        }
      };
      this.worker?.addEventListener('message', handler);
    });

    this.status.active = true;
    this.startTime = Date.now();
  }

  /**
   * Process a chunk
   */
  async processChunk(chunk: ChunkDescriptor, config: { mode: string; level: number }): Promise<WorkerResponse> {
    if (!this.worker || !chunk.buffer) {
      throw new Error('Worker not ready or no buffer');
    }

    this.status.currentChunk = chunk.id;

    return new Promise((resolve, reject) => {
      this.pendingResolves.set(chunk.id, resolve);

      // Send chunk to worker (transfer buffer ownership for zero-copy)
      const message: WorkerMessage = {
        type: 'compress',
        chunkId: chunk.id,
        data: chunk.buffer!,
        config,
      };

      try {
        this.worker!.postMessage(message, [chunk.buffer!]);
      } catch (error) {
        this.pendingResolves.delete(chunk.id);
        reject(error);
      }
    });
  }

  /**
   * Handle message from worker
   */
  private handleMessage(response: WorkerResponse): void {
    if (response.type === 'result' && response.chunkId) {
      const resolve = this.pendingResolves.get(response.chunkId);
      if (resolve) {
        this.pendingResolves.delete(response.chunkId);
        
        // Update stats
        this.status.bytesProcessed += response.originalSize || 0;
        this.status.chunksProcessed++;
        this.totalProcessingTime += response.processingTime || 0;
        this.status.avgProcessingTime = this.totalProcessingTime / this.status.chunksProcessed;
        this.status.currentChunk = null;

        resolve(response);
      }
    } else if (response.type === 'error' && response.chunkId) {
      const resolve = this.pendingResolves.get(response.chunkId);
      if (resolve) {
        this.pendingResolves.delete(response.chunkId);
        this.status.currentChunk = null;
        resolve(response);
      }
    }
  }

  /**
   * Shutdown worker
   */
  shutdown(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'shutdown' });
      this.worker.terminate();
      this.worker = null;
    }
    this.status.active = false;
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerStatus {
    return { ...this.status };
  }

  /**
   * Check if worker is idle
   */
  isIdle(): boolean {
    return this.status.currentChunk === null;
  }

  /**
   * Create worker code (inline)
   */
  private createWorkerCode(): string {
    return `
      // Compression worker
      const ZSTD_MAGIC = 0xFD2FB528;
      
      // Simple compression simulation (real impl uses WASM)
      function compress(data, level) {
        // In production, this calls WASM ZSTD
        // For now, simulate compression with timing
        const start = performance.now();
        
        // Simulate work based on data size
        const iterations = Math.ceil(data.byteLength / 1024);
        let hash = 0;
        const view = new Uint8Array(data);
        for (let i = 0; i < Math.min(iterations, 1000); i++) {
          hash ^= view[i % view.length];
        }
        
        // Simulate compression ratio
        const ratio = 0.4 + Math.random() * 0.2;
        const compressedSize = Math.floor(data.byteLength * ratio);
        const compressed = new ArrayBuffer(compressedSize);
        
        // Copy some data to make it realistic
        const src = new Uint8Array(data);
        const dst = new Uint8Array(compressed);
        for (let i = 0; i < compressedSize; i++) {
          dst[i] = src[i % src.length];
        }
        
        const duration = performance.now() - start;
        
        return {
          data: compressed,
          originalSize: data.byteLength,
          compressedSize,
          processingTime: duration,
          hash: hash.toString(16).padStart(8, '0'),
        };
      }
      
      self.onmessage = function(event) {
        const msg = event.data;
        
        if (msg.type === 'compress') {
          try {
            const result = compress(msg.data, msg.config?.level || 3);
            self.postMessage({
              type: 'result',
              chunkId: msg.chunkId,
              data: result.data,
              originalSize: result.originalSize,
              compressedSize: result.compressedSize,
              hash: result.hash,
              processingTime: result.processingTime,
            }, [result.data]);
          } catch (error) {
            self.postMessage({
              type: 'error',
              chunkId: msg.chunkId,
              error: error.message,
            });
          }
        } else if (msg.type === 'shutdown') {
          self.close();
        }
      };
      
      // Signal ready
      self.postMessage({ type: 'ready' });
    `;
  }
}

/**
 * Worker pool coordinator
 */
export class WorkerCoordinator {
  private workers: ManagedWorker[] = [];
  private config: WorkerPoolConfig;
  private initialized = false;
  private queue: Array<{
    chunk: ChunkDescriptor;
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  private metrics: PipelineMetrics = {
    readSpeed: 0,
    compressSpeed: 0,
    writeSpeed: 0,
    hashSpeed: 0,
    overallThroughput: 0,
    bottleneck: 'none',
  };

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = {
      minWorkers: config.minWorkers ?? 2,
      maxWorkers: config.maxWorkers ?? (navigator.hardwareConcurrency || 4),
      gpuWorkers: config.gpuWorkers ?? 0,
      chunkSizeRange: config.chunkSizeRange ?? [8 * 1024 * 1024, 256 * 1024 * 1024],
      enableGPU: config.enableGPU ?? false,
    };
  }

  /**
   * Initialize worker pool
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create CPU workers
    const cpuCount = Math.max(this.config.minWorkers, this.config.maxWorkers - this.config.gpuWorkers);
    
    const initPromises: Promise<void>[] = [];
    
    for (let i = 0; i < cpuCount; i++) {
      const worker = new ManagedWorker(i, 'cpu');
      this.workers.push(worker);
      initPromises.push(worker.initialize());
    }

    // Create GPU workers if enabled
    if (this.config.enableGPU && this.config.gpuWorkers > 0) {
      for (let i = 0; i < this.config.gpuWorkers; i++) {
        const worker = new ManagedWorker(cpuCount + i, 'gpu');
        this.workers.push(worker);
        initPromises.push(worker.initialize());
      }
    }

    await Promise.all(initPromises);
    this.initialized = true;
  }

  /**
   * Submit chunk for compression
   */
  async submitChunk(chunk: ChunkDescriptor, config: { mode: string; level: number }): Promise<WorkerResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Find idle worker
    let worker = this.workers.find(w => w.isIdle());

    if (worker) {
      return worker.processChunk(chunk, config);
    }

    // No idle worker - queue the chunk
    return new Promise((resolve, reject) => {
      this.queue.push({ chunk, resolve, reject });
    });
  }

  /**
   * Process queued items when workers become available
   */
  private processQueue(): void {
    while (this.queue.length > 0) {
      const worker = this.workers.find(w => w.isIdle());
      if (!worker) break;

      const item = this.queue.shift()!;
      worker.processChunk(item.chunk, { mode: 'auto', level: 3 })
        .then(item.resolve)
        .catch(item.reject);
    }
  }

  /**
   * Get all worker statuses
   */
  getWorkerStatuses(): WorkerStatus[] {
    return this.workers.map(w => w.getStatus());
  }

  /**
   * Get pipeline metrics
   */
  getMetrics(): PipelineMetrics {
    // Calculate metrics from worker stats
    const statuses = this.getWorkerStatuses();
    let totalBytes = 0;
    let totalTime = 0;

    for (const status of statuses) {
      totalBytes += status.bytesProcessed;
      totalTime += status.avgProcessingTime * status.chunksProcessed;
    }

    if (totalTime > 0) {
      this.metrics.compressSpeed = (totalBytes / totalTime) * 1000;
    }

    this.metrics.overallThroughput = this.metrics.compressSpeed;
    
    // Determine bottleneck
    if (this.queue.length > this.workers.length * 2) {
      this.metrics.bottleneck = 'compress';
    } else {
      this.metrics.bottleneck = 'none';
    }

    return { ...this.metrics };
  }

  /**
   * Get active worker count
   */
  get activeWorkers(): number {
    return this.workers.filter(w => !w.isIdle()).length;
  }

  /**
   * Get total worker count
   */
  get totalWorkers(): number {
    return this.workers.length;
  }

  /**
   * Shutdown all workers
   */
  shutdown(): void {
    for (const worker of this.workers) {
      worker.shutdown();
    }
    this.workers = [];
    this.initialized = false;
    this.queue = [];
  }

  /**
   * Scale workers up or down based on load
   */
  async scale(targetWorkers: number): Promise<void> {
    const target = Math.min(
      Math.max(targetWorkers, this.config.minWorkers),
      this.config.maxWorkers
    );

    if (target > this.workers.length) {
      // Scale up
      const toAdd = target - this.workers.length;
      const initPromises: Promise<void>[] = [];
      
      for (let i = 0; i < toAdd; i++) {
        const worker = new ManagedWorker(this.workers.length + i, 'cpu');
        this.workers.push(worker);
        initPromises.push(worker.initialize());
      }
      
      await Promise.all(initPromises);
    } else if (target < this.workers.length) {
      // Scale down - remove idle workers first
      const toRemove = this.workers.length - target;
      let removed = 0;
      
      for (let i = this.workers.length - 1; i >= 0 && removed < toRemove; i--) {
        if (this.workers[i].isIdle()) {
          this.workers[i].shutdown();
          this.workers.splice(i, 1);
          removed++;
        }
      }
    }
  }
}

// Singleton coordinator
let globalCoordinator: WorkerCoordinator | null = null;

export function getWorkerCoordinator(config?: Partial<WorkerPoolConfig>): WorkerCoordinator {
  if (!globalCoordinator) {
    globalCoordinator = new WorkerCoordinator(config);
  }
  return globalCoordinator;
}

export function resetWorkerCoordinator(): void {
  if (globalCoordinator) {
    globalCoordinator.shutdown();
    globalCoordinator = null;
  }
}
