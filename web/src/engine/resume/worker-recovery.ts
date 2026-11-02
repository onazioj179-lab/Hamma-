/**
 * SPK Worker and WASM Recovery System
 * 
 * Recreates worker pool, reloads WASM modules, reinitializes memory,
 * and restores scheduler state after interruption.
 * 
 * Features:
 * - Worker pool recreation with state restoration
 * - WASM module reload with memory reinit
 * - Scheduler lane assignment recovery
 * - Graceful degradation on partial failure
 * 
 * Creator: Onazi Treasure (OJ)
 */

import type { LaneAssignment } from './checkpoint-manager';

// ============================================================================
// Types
// ============================================================================

export interface WorkerInfo {
  id: number;
  worker: Worker | null;
  status: WorkerStatus;
  lastChunkIndex: number;
  memoryUsage: number;
  wasmReady: boolean;
  errorCount: number;
  lastError: string | null;
}

export type WorkerStatus = 
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'error'
  | 'terminated';

export interface WasmModuleState {
  isLoaded: boolean;
  memoryPages: number;
  memoryUsed: number;
  exports: string[];
  lastInitTime: number;
}

export interface SchedulerState {
  lanes: LaneAssignment[];
  pendingQueue: number[];
  activeJobs: Map<number, number>; // workerId -> chunkIndex
  roundRobinIndex: number;
  maxConcurrency: number;
}

export interface WorkerRecoveryConfig {
  maxWorkers: number;
  wasmPath: string;
  memoryPages: number;
  retryAttempts: number;
  initTimeoutMs: number;
}

export interface RecoveryResult {
  success: boolean;
  workersRestored: number;
  wasmReady: boolean;
  schedulerReady: boolean;
  errors: string[];
}

// ============================================================================
// WorkerRecoveryManager
// ============================================================================

const DEFAULT_CONFIG: WorkerRecoveryConfig = {
  maxWorkers: navigator.hardwareConcurrency || 4,
  wasmPath: '/wasm/spk_wasm_bg.wasm',
  memoryPages: 256, // 16MB initial
  retryAttempts: 3,
  initTimeoutMs: 10000,
};

export class WorkerRecoveryManager {
  private config: WorkerRecoveryConfig;
  private workers: Map<number, WorkerInfo> = new Map();
  private wasmState: WasmModuleState | null = null;
  private schedulerState: SchedulerState;
  private isRecovering = false;
  
  constructor(config: Partial<WorkerRecoveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.schedulerState = {
      lanes: [],
      pendingQueue: [],
      activeJobs: new Map(),
      roundRobinIndex: 0,
      maxConcurrency: this.config.maxWorkers,
    };
  }
  
  /**
   * Recover all workers and WASM from saved state
   */
  async recover(
    savedLanes: LaneAssignment[],
    pendingChunks: number[],
    completedChunks: number[]
  ): Promise<RecoveryResult> {
    if (this.isRecovering) {
      return {
        success: false,
        workersRestored: 0,
        wasmReady: false,
        schedulerReady: false,
        errors: ['Recovery already in progress'],
      };
    }
    
    this.isRecovering = true;
    const errors: string[] = [];
    
    try {
      // Step 1: Terminate any existing workers
      await this.terminateAll();
      
      // Step 2: Reload WASM module
      const wasmReady = await this.loadWasmModule();
      if (!wasmReady) {
        errors.push('Failed to reload WASM module');
      }
      
      // Step 3: Recreate worker pool
      const workersCreated = await this.createWorkerPool();
      if (workersCreated < this.config.maxWorkers) {
        errors.push(`Only ${workersCreated}/${this.config.maxWorkers} workers created`);
      }
      
      // Step 4: Initialize WASM in each worker
      await this.initializeWorkersWasm();
      
      // Step 5: Restore scheduler state
      this.restoreScheduler(savedLanes, pendingChunks, completedChunks);
      
      const workersReady = Array.from(this.workers.values())
        .filter(w => w.status === 'ready').length;
      
      return {
        success: workersReady > 0 && wasmReady,
        workersRestored: workersReady,
        wasmReady,
        schedulerReady: this.schedulerState.lanes.length > 0,
        errors,
      };
      
    } finally {
      this.isRecovering = false;
    }
  }
  
  /**
   * Get next chunk to process
   */
  getNextChunk(): number | null {
    const queue = this.schedulerState.pendingQueue;
    if (queue.length === 0) return null;
    return queue.shift() ?? null;
  }
  
  /**
   * Assign chunk to available worker
   */
  assignChunk(chunkIndex: number): WorkerInfo | null {
    // Find available worker using round-robin
    const workerCount = this.workers.size;
    if (workerCount === 0) return null;
    
    for (let i = 0; i < workerCount; i++) {
      const workerId = (this.schedulerState.roundRobinIndex + i) % workerCount;
      const worker = this.workers.get(workerId);
      
      if (worker && worker.status === 'ready') {
        worker.status = 'busy';
        worker.lastChunkIndex = chunkIndex;
        this.schedulerState.activeJobs.set(workerId, chunkIndex);
        this.schedulerState.roundRobinIndex = (workerId + 1) % workerCount;
        return worker;
      }
    }
    
    return null;
  }
  
  /**
   * Mark worker as done with chunk
   */
  completeChunk(workerId: number): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = 'ready';
      this.schedulerState.activeJobs.delete(workerId);
    }
  }
  
  /**
   * Handle worker error
   */
  handleWorkerError(workerId: number, error: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    
    worker.errorCount++;
    worker.lastError = error;
    
    if (worker.errorCount >= this.config.retryAttempts) {
      worker.status = 'error';
      return false; // Worker is dead
    }
    
    worker.status = 'ready';
    return true; // Worker can retry
  }
  
  /**
   * Get worker pool status
   */
  getPoolStatus(): {
    total: number;
    ready: number;
    busy: number;
    error: number;
    wasmReady: boolean;
    pendingChunks: number;
    activeJobs: number;
  } {
    const workers = Array.from(this.workers.values());
    
    return {
      total: workers.length,
      ready: workers.filter(w => w.status === 'ready').length,
      busy: workers.filter(w => w.status === 'busy').length,
      error: workers.filter(w => w.status === 'error').length,
      wasmReady: this.wasmState?.isLoaded ?? false,
      pendingChunks: this.schedulerState.pendingQueue.length,
      activeJobs: this.schedulerState.activeJobs.size,
    };
  }
  
  /**
   * Export state for checkpointing
   */
  exportState(): {
    lanes: LaneAssignment[];
    pendingQueue: number[];
    activeJobs: [number, number][];
    roundRobinIndex: number;
    workerStatuses: { id: number; status: WorkerStatus; errorCount: number }[];
  } {
    return {
      lanes: this.schedulerState.lanes,
      pendingQueue: [...this.schedulerState.pendingQueue],
      activeJobs: Array.from(this.schedulerState.activeJobs.entries()),
      roundRobinIndex: this.schedulerState.roundRobinIndex,
      workerStatuses: Array.from(this.workers.values()).map(w => ({
        id: w.id,
        status: w.status,
        errorCount: w.errorCount,
      })),
    };
  }
  
  /**
   * Terminate all workers
   */
  async terminateAll(): Promise<void> {
    for (const worker of this.workers.values()) {
      if (worker.worker) {
        worker.worker.terminate();
        worker.worker = null;
      }
      worker.status = 'terminated';
    }
    this.workers.clear();
    this.schedulerState.activeJobs.clear();
  }
  
  /**
   * Load WASM module
   */
  private async loadWasmModule(): Promise<boolean> {
    try {
      // Check if WASM is already loaded globally
      const existingWasm = (globalThis as Record<string, unknown>).__spk_wasm;
      if (existingWasm) {
        this.wasmState = {
          isLoaded: true,
          memoryPages: this.config.memoryPages,
          memoryUsed: 0,
          exports: [],
          lastInitTime: Date.now(),
        };
        return true;
      }
      
      // Attempt to load WASM
      const response = await fetch(this.config.wasmPath);
      if (!response.ok) {
        // WASM not available, will use JS fallback
        console.warn('WASM not available, using JavaScript fallback');
        this.wasmState = {
          isLoaded: false,
          memoryPages: 0,
          memoryUsed: 0,
          exports: [],
          lastInitTime: Date.now(),
        };
        return true; // Allow fallback mode
      }
      
      const wasmBytes = await response.arrayBuffer();
      const memory = new WebAssembly.Memory({
        initial: this.config.memoryPages,
        maximum: this.config.memoryPages * 4,
      });
      
      const { instance } = await WebAssembly.instantiate(wasmBytes, {
        env: { memory },
      });
      
      // Store globally
      (globalThis as Record<string, unknown>).__spk_wasm = instance;
      (globalThis as Record<string, unknown>).__spk_wasm_memory = memory;
      
      this.wasmState = {
        isLoaded: true,
        memoryPages: this.config.memoryPages,
        memoryUsed: 0,
        exports: Object.keys(instance.exports),
        lastInitTime: Date.now(),
      };
      
      return true;
      
    } catch (error) {
      console.warn('WASM load failed, using fallback:', error);
      this.wasmState = {
        isLoaded: false,
        memoryPages: 0,
        memoryUsed: 0,
        exports: [],
        lastInitTime: Date.now(),
      };
      return true; // Allow fallback
    }
  }
  
  /**
   * Create worker pool
   */
  private async createWorkerPool(): Promise<number> {
    let created = 0;
    
    for (let i = 0; i < this.config.maxWorkers; i++) {
      try {
        // Create worker using blob URL for inline worker code
        const workerCode = this.getWorkerCode();
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        
        const worker = new Worker(workerUrl);
        
        // Wait for ready signal
        const ready = await this.waitForWorkerReady(worker, i);
        
        if (ready) {
          this.workers.set(i, {
            id: i,
            worker,
            status: 'ready',
            lastChunkIndex: -1,
            memoryUsage: 0,
            wasmReady: false,
            errorCount: 0,
            lastError: null,
          });
          created++;
        } else {
          worker.terminate();
        }
        
        URL.revokeObjectURL(workerUrl);
        
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }
    
    return created;
  }
  
  /**
   * Wait for worker to signal ready
   */
  private waitForWorkerReady(worker: Worker, id: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, this.config.initTimeoutMs);
      
      worker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          resolve(true);
        }
      };
      
      worker.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
      
      // Send init message
      worker.postMessage({ type: 'init', id });
    });
  }
  
  /**
   * Initialize WASM in all workers
   */
  private async initializeWorkersWasm(): Promise<void> {
    const initPromises: Promise<void>[] = [];
    
    for (const workerInfo of this.workers.values()) {
      if (workerInfo.worker && workerInfo.status === 'ready') {
        initPromises.push(this.initWorkerWasm(workerInfo));
      }
    }
    
    await Promise.all(initPromises);
  }
  
  /**
   * Initialize WASM in a single worker
   */
  private initWorkerWasm(workerInfo: WorkerInfo): Promise<void> {
    return new Promise((resolve) => {
      if (!workerInfo.worker) {
        resolve();
        return;
      }
      
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'wasm-ready') {
          workerInfo.wasmReady = true;
          workerInfo.worker?.removeEventListener('message', handler);
          resolve();
        } else if (e.data.type === 'wasm-failed') {
          workerInfo.wasmReady = false;
          workerInfo.worker?.removeEventListener('message', handler);
          resolve(); // Continue anyway with JS fallback
        }
      };
      
      workerInfo.worker.addEventListener('message', handler);
      workerInfo.worker.postMessage({
        type: 'init-wasm',
        wasmPath: this.config.wasmPath,
        memoryPages: this.config.memoryPages,
      });
      
      // Timeout fallback
      setTimeout(() => {
        workerInfo.worker?.removeEventListener('message', handler);
        resolve();
      }, this.config.initTimeoutMs);
    });
  }
  
  /**
   * Restore scheduler state
   */
  private restoreScheduler(
    savedLanes: LaneAssignment[],
    pendingChunks: number[],
    completedChunks: number[]
  ): void {
    const completedSet = new Set(completedChunks);
    
    // Filter pending chunks to exclude completed ones
    this.schedulerState.pendingQueue = pendingChunks.filter(
      chunk => !completedSet.has(chunk)
    );
    
    // Restore lane assignments, filtering completed ranges
    this.schedulerState.lanes = savedLanes.filter(lane => {
      // Check if any chunks in range are still pending
      for (let i = lane.chunkRange[0]; i <= lane.chunkRange[1]; i++) {
        if (!completedSet.has(i)) {
          return true;
        }
      }
      return false;
    });
    
    // Reset active jobs
    this.schedulerState.activeJobs.clear();
  }
  
  /**
   * Get inline worker code
   */
  private getWorkerCode(): string {
    return `
      let workerId = -1;
      let wasmInstance = null;
      let wasmMemory = null;
      
      self.onmessage = async function(e) {
        const { type, ...data } = e.data;
        
        switch (type) {
          case 'init':
            workerId = data.id;
            self.postMessage({ type: 'ready', id: workerId });
            break;
            
          case 'init-wasm':
            try {
              const response = await fetch(data.wasmPath);
              if (!response.ok) {
                self.postMessage({ type: 'wasm-failed' });
                return;
              }
              const wasmBytes = await response.arrayBuffer();
              wasmMemory = new WebAssembly.Memory({
                initial: data.memoryPages,
                maximum: data.memoryPages * 4,
              });
              const { instance } = await WebAssembly.instantiate(wasmBytes, {
                env: { memory: wasmMemory },
              });
              wasmInstance = instance;
              self.postMessage({ type: 'wasm-ready' });
            } catch (err) {
              self.postMessage({ type: 'wasm-failed', error: err.message });
            }
            break;
            
          case 'process-chunk':
            try {
              // Process chunk (placeholder - actual compression logic here)
              const result = await processChunk(data.chunk, data.options);
              self.postMessage({ type: 'chunk-complete', chunkIndex: data.chunkIndex, result });
            } catch (err) {
              self.postMessage({ type: 'chunk-error', chunkIndex: data.chunkIndex, error: err.message });
            }
            break;
        }
      };
      
      async function processChunk(chunk, options) {
        // Placeholder - actual compression would happen here
        return { compressed: chunk, ratio: 1 };
      }
    `;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let workerRecoveryInstance: WorkerRecoveryManager | null = null;

export function getWorkerRecoveryManager(): WorkerRecoveryManager {
  if (!workerRecoveryInstance) {
    workerRecoveryInstance = new WorkerRecoveryManager();
  }
  return workerRecoveryInstance;
}

export function resetWorkerRecoveryManager(): void {
  workerRecoveryInstance?.terminateAll();
  workerRecoveryInstance = null;
}

export function createWorkerRecoveryManager(
  config?: Partial<WorkerRecoveryConfig>
): WorkerRecoveryManager {
  return new WorkerRecoveryManager(config);
}
