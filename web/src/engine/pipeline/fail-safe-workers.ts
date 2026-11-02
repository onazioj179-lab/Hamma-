/**
 * SPK Fail-Safe Pipeline - Worker Manager
 * 
 * Manages worker lifecycle with automatic recovery:
 * - Worker pool with auto-respawn
 * - WASM state management and reset
 * - Chunk reassignment on failure
 * - Health monitoring integration
 * - Graceful degradation on low resources
 * 
 * @module pipeline/fail-safe-workers
 * @version 1.0.0
 */

import type { WatchdogEvent } from './watchdog';

// ============================================================================
// TYPES
// ============================================================================

export interface FailSafeWorkerConfig {
  /** Minimum number of workers */
  minWorkers: number;
  /** Maximum number of workers */
  maxWorkers: number;
  /** Worker initialization timeout (ms) */
  initTimeout: number;
  /** Max consecutive failures before worker is marked dead */
  maxWorkerFailures: number;
  /** Delay before restarting a failed worker (ms) */
  restartDelay: number;
  /** WASM reset timeout (ms) */
  wasmResetTimeout: number;
  /** Worker respawn cooldown (ms) */
  respawnCooldown: number;
  /** Enable degraded mode on low resources */
  enableDegradedMode: boolean;
}

export interface WorkerInstance {
  id: string;
  worker: Worker;
  status: 'initializing' | 'ready' | 'busy' | 'recovering' | 'dead';
  createdAt: number;
  lastActivity: number;
  chunksProcessed: number;
  errorsRecovered: number;
  consecutiveFailures: number;
  wasmResets: number;
  pendingChunk: string | null;
  messageHandlers: Map<string, (response: unknown) => void>;
}

export interface ChunkAssignment {
  taskId: string;
  chunkIndex: number;
  workerId: string;
  buffer: ArrayBuffer;
  startTime: number;
  assigned: boolean;
}

export interface WorkerManagerStats {
  totalWorkers: number;
  activeWorkers: number;
  deadWorkers: number;
  recoveringWorkers: number;
  totalChunksProcessed: number;
  totalErrorsRecovered: number;
  totalWasmResets: number;
  totalRespawns: number;
  isDegraded: boolean;
}

export type WorkerMessageType = 
  | 'init-wasm'
  | 'process-chunk'
  | 'reset'
  | 'status'
  | 'shutdown';

export interface WorkerMessage {
  type: WorkerMessageType;
  id: string;
  payload?: unknown;
}

export interface WorkerResponse {
  type: 'ready' | 'chunk-result' | 'error' | 'reset-complete' | 'status';
  id: string;
  success: boolean;
  payload?: unknown;
  error?: string;
}

export type ManagerEventHandler = (event: WatchdogEvent) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: FailSafeWorkerConfig = {
  minWorkers: 2,
  maxWorkers: navigator.hardwareConcurrency || 4,
  initTimeout: 10000,
  maxWorkerFailures: 3,
  restartDelay: 500,
  wasmResetTimeout: 5000,
  respawnCooldown: 2000,
  enableDegradedMode: true,
};

// ============================================================================
// INLINE WORKER CODE
// ============================================================================

/**
 * Create inline worker code that's resilient to failures
 */
function createWorkerCode(): string {
  return `
    // Fail-safe compression worker
    let wasmModule = null;
    let wasmMemory = null;
    let isInitialized = false;
    let workerId = null;
    
    // Error recovery state
    let lastGoodState = null;
    
    /**
     * Initialize WASM module
     */
    async function initWasm(wasmUrl) {
      try {
        // Simulate WASM loading (real impl loads actual module)
        isInitialized = true;
        lastGoodState = { initialized: true };
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    
    /**
     * Reset WASM state
     */
    function resetWasm() {
      try {
        // Clear any locked state
        wasmModule = null;
        wasmMemory = null;
        isInitialized = false;
        
        // Reinitialize
        isInitialized = true;
        lastGoodState = { initialized: true, resetAt: Date.now() };
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    
    /**
     * Process a chunk with timeout protection
     */
    async function processChunk(chunkData, chunkIndex) {
      if (!isInitialized) {
        throw new Error('WASM not initialized');
      }
      
      const start = performance.now();
      
      try {
        // Simulate compression (real impl calls WASM)
        const input = new Uint8Array(chunkData);
        
        // Simulate work
        let hash = 0;
        for (let i = 0; i < Math.min(input.length, 1000); i++) {
          hash = (hash * 31 + input[i]) | 0;
        }
        
        // Simulate compression ratio
        const ratio = 0.4 + Math.random() * 0.2;
        const outputSize = Math.floor(input.length * ratio);
        const output = new ArrayBuffer(outputSize);
        const outputView = new Uint8Array(output);
        
        // Copy data with simple transform
        for (let i = 0; i < outputSize; i++) {
          outputView[i] = input[i % input.length] ^ (hash & 0xFF);
        }
        
        const processingTime = performance.now() - start;
        
        return {
          success: true,
          chunkIndex,
          inputSize: input.length,
          outputSize,
          buffer: output,
          processingTime,
          hash: hash.toString(16).padStart(8, '0'),
        };
      } catch (error) {
        throw error;
      }
    }
    
    // Message handler with error boundary
    self.onmessage = async function(event) {
      const msg = event.data;
      workerId = msg.workerId || workerId;
      
      try {
        switch (msg.type) {
          case 'init-wasm':
            const initResult = await initWasm(msg.payload?.wasmUrl);
            self.postMessage({
              type: 'ready',
              id: msg.id,
              success: initResult.success,
              error: initResult.error,
            });
            break;
            
          case 'process-chunk':
            const chunkResult = await processChunk(
              msg.payload.buffer,
              msg.payload.chunkIndex
            );
            self.postMessage({
              type: 'chunk-result',
              id: msg.id,
              success: true,
              payload: chunkResult,
            }, [chunkResult.buffer]);
            break;
            
          case 'reset':
            const resetResult = resetWasm();
            self.postMessage({
              type: 'reset-complete',
              id: msg.id,
              success: resetResult.success,
              error: resetResult.error,
            });
            break;
            
          case 'status':
            self.postMessage({
              type: 'status',
              id: msg.id,
              success: true,
              payload: {
                initialized: isInitialized,
                workerId,
              },
            });
            break;
            
          case 'shutdown':
            self.close();
            break;
            
          default:
            self.postMessage({
              type: 'error',
              id: msg.id,
              success: false,
              error: 'Unknown message type: ' + msg.type,
            });
        }
      } catch (error) {
        // Always respond even on error
        self.postMessage({
          type: 'error',
          id: msg.id,
          success: false,
          error: error.message || 'Unknown worker error',
        });
      }
    };
    
    // Global error handlers - catch everything
    self.onerror = function(error) {
      self.postMessage({
        type: 'error',
        id: 'global',
        success: false,
        error: 'Uncaught error: ' + (error.message || error),
      });
    };
    
    self.onunhandledrejection = function(event) {
      self.postMessage({
        type: 'error',
        id: 'global',
        success: false,
        error: 'Unhandled promise rejection: ' + event.reason,
      });
    };
  `;
}

// ============================================================================
// FAIL-SAFE WORKER MANAGER
// ============================================================================

export class FailSafeWorkerManager {
  private config: FailSafeWorkerConfig;
  private workers = new Map<string, WorkerInstance>();
  private pendingChunks = new Map<string, ChunkAssignment>();
  private eventHandlers: ManagerEventHandler[] = [];
  private workerIdCounter = 0;
  private messageIdCounter = 0;
  private totalRespawns = 0;
  private isDegraded = false;
  private respawnCooldowns = new Map<string, number>();
  private running = false;
  
  constructor(config: Partial<FailSafeWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================
  
  /**
   * Initialize worker pool
   */
  async initialize(): Promise<void> {
    if (this.running) return;
    this.running = true;
    
    const initPromises: Promise<string>[] = [];
    const workerCount = Math.max(this.config.minWorkers, 2);
    
    for (let i = 0; i < workerCount; i++) {
      initPromises.push(this.spawnWorker());
    }
    
    await Promise.all(initPromises);
    
    this.emit({
      type: 'pipeline-stable',
      timestamp: Date.now(),
      message: `Worker pool initialized with ${this.workers.size} workers`,
    });
  }
  
  /**
   * Shutdown all workers
   */
  shutdown(): void {
    this.running = false;
    
    for (const [, instance] of this.workers.entries()) {
      try {
        instance.worker.postMessage({ type: 'shutdown', id: 'shutdown' });
        instance.worker.terminate();
      } catch {
        // Ignore termination errors
      }
      instance.status = 'dead';
    }
    
    this.workers.clear();
    this.pendingChunks.clear();
  }
  
  // ==========================================================================
  // WORKER SPAWNING
  // ==========================================================================
  
  /**
   * Spawn a new worker
   */
  private async spawnWorker(): Promise<string> {
    const workerId = `worker-${++this.workerIdCounter}`;
    
    // Create worker from inline code
    const blob = new Blob([createWorkerCode()], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    
    const instance: WorkerInstance = {
      id: workerId,
      worker,
      status: 'initializing',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      chunksProcessed: 0,
      errorsRecovered: 0,
      consecutiveFailures: 0,
      wasmResets: 0,
      pendingChunk: null,
      messageHandlers: new Map(),
    };
    
    this.workers.set(workerId, instance);
    
    // Set up message handling
    worker.onmessage = (event) => this.handleWorkerMessage(workerId, event.data);
    worker.onerror = (error) => this.handleWorkerError(workerId, error);
    
    // Initialize WASM
    try {
      await this.sendMessage(workerId, 'init-wasm', { wasmUrl: '/spk_core.wasm' });
      instance.status = 'ready';
      
      this.emit({
        type: 'worker-restarted',
        timestamp: Date.now(),
        workerId,
        message: `Worker ${workerId} spawned and ready`,
      });
      
      return workerId;
    } catch (error) {
      instance.status = 'dead';
      this.workers.delete(workerId);
      throw error;
    }
  }
  
  /**
   * Respawn a dead worker
   */
  async respawnWorker(oldWorkerId: string): Promise<string> {
    // Check cooldown
    const lastRespawn = this.respawnCooldowns.get(oldWorkerId) || 0;
    const now = Date.now();
    
    if (now - lastRespawn < this.config.respawnCooldown) {
      await new Promise(resolve => 
        setTimeout(resolve, this.config.respawnCooldown - (now - lastRespawn))
      );
    }
    
    this.respawnCooldowns.set(oldWorkerId, Date.now());
    
    // Clean up old worker
    const oldInstance = this.workers.get(oldWorkerId);
    if (oldInstance) {
      try {
        oldInstance.worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.workers.delete(oldWorkerId);
    }
    
    // Spawn new worker
    const newWorkerId = await this.spawnWorker();
    this.totalRespawns++;
    
    this.emit({
      type: 'worker-restarted',
      timestamp: Date.now(),
      workerId: newWorkerId,
      message: `Respawned worker ${oldWorkerId} as ${newWorkerId}`,
      details: { oldWorkerId, totalRespawns: this.totalRespawns },
    });
    
    // Reassign pending chunk if any
    const pending = Array.from(this.pendingChunks.values())
      .find(c => c.workerId === oldWorkerId);
    
    if (pending) {
      pending.workerId = newWorkerId;
      pending.assigned = false;
    }
    
    return newWorkerId;
  }
  
  // ==========================================================================
  // MESSAGE HANDLING
  // ==========================================================================
  
  /**
   * Send message to worker with timeout
   */
  private sendMessage(
    workerId: string,
    type: WorkerMessageType,
    payload?: unknown,
    timeout: number = this.config.initTimeout
  ): Promise<WorkerResponse> {
    const instance = this.workers.get(workerId);
    if (!instance) {
      return Promise.reject(new Error(`Worker ${workerId} not found`));
    }
    
    const messageId = `msg-${++this.messageIdCounter}`;
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        instance.messageHandlers.delete(messageId);
        reject(new Error(`Message ${type} timed out after ${timeout}ms`));
      }, timeout);
      
      instance.messageHandlers.set(messageId, (response: unknown) => {
        clearTimeout(timer);
        instance.messageHandlers.delete(messageId);
        resolve(response as WorkerResponse);
      });
      
      try {
        const message: WorkerMessage = { type, id: messageId, payload };
        
        // Transfer buffer if present
        if (payload && typeof payload === 'object' && 'buffer' in payload) {
          const buffer = (payload as { buffer: ArrayBuffer }).buffer;
          instance.worker.postMessage(message, [buffer]);
        } else {
          instance.worker.postMessage(message);
        }
        
        instance.lastActivity = Date.now();
      } catch (error) {
        clearTimeout(timer);
        instance.messageHandlers.delete(messageId);
        reject(error);
      }
    });
  }
  
  /**
   * Handle worker message
   */
  private handleWorkerMessage(workerId: string, response: WorkerResponse): void {
    const instance = this.workers.get(workerId);
    if (!instance) return;
    
    instance.lastActivity = Date.now();
    
    // Route to specific handler
    const handler = instance.messageHandlers.get(response.id);
    if (handler) {
      handler(response);
      return;
    }
    
    // Handle global errors
    if (response.type === 'error' && response.id === 'global') {
      this.handleWorkerError(workerId, new Error(response.error || 'Unknown error'));
    }
  }
  
  /**
   * Handle worker error
   */
  private handleWorkerError(workerId: string, error: unknown): void {
    const instance = this.workers.get(workerId);
    if (!instance) return;
    
    instance.consecutiveFailures++;
    
    this.emit({
      type: 'worker-stalled',
      timestamp: Date.now(),
      workerId,
      message: `Worker ${workerId} error: ${error}`,
      details: { error: String(error), consecutiveFailures: instance.consecutiveFailures },
    });
    
    // Check if worker should be marked dead
    if (instance.consecutiveFailures >= this.config.maxWorkerFailures) {
      instance.status = 'dead';
      
      // Try to respawn if we're below minimum
      const activeCount = this.getActiveWorkerCount();
      if (activeCount < this.config.minWorkers && this.running) {
        this.respawnWorker(workerId).catch(() => {
          // Enter degraded mode if we can't maintain min workers
          if (this.config.enableDegradedMode) {
            this.enterDegradedMode();
          }
        });
      }
    }
  }
  
  // ==========================================================================
  // CHUNK PROCESSING
  // ==========================================================================
  
  /**
   * Submit chunk for processing
   */
  async submitChunk(
    taskId: string,
    chunkIndex: number,
    buffer: ArrayBuffer
  ): Promise<{
    workerId: string;
    result: {
      inputSize: number;
      outputSize: number;
      buffer: ArrayBuffer;
      processingTime: number;
    };
  }> {
    // Get available worker
    const workerId = await this.getAvailableWorker();
    
    const assignment: ChunkAssignment = {
      taskId,
      chunkIndex,
      workerId,
      buffer,
      startTime: Date.now(),
      assigned: true,
    };
    
    this.pendingChunks.set(taskId, assignment);
    
    try {
      const instance = this.workers.get(workerId)!;
      instance.status = 'busy';
      instance.pendingChunk = taskId;
      
      const response = await this.sendMessage(
        workerId,
        'process-chunk',
        { buffer, chunkIndex },
        30000 // 30 second timeout per chunk
      );
      
      if (!response.success) {
        throw new Error(response.error || 'Chunk processing failed');
      }
      
      // Success - update stats
      instance.chunksProcessed++;
      instance.consecutiveFailures = 0;
      instance.status = 'ready';
      instance.pendingChunk = null;
      
      this.pendingChunks.delete(taskId);
      
      const result = response.payload as {
        inputSize: number;
        outputSize: number;
        buffer: ArrayBuffer;
        processingTime: number;
      };
      
      return { workerId, result };
    } catch (error) {
      // Handle failure
      const instance = this.workers.get(workerId);
      if (instance) {
        instance.consecutiveFailures++;
        instance.errorsRecovered++;
        instance.pendingChunk = null;
        
        // Try WASM reset first
        if (instance.consecutiveFailures <= 2) {
          await this.resetWorkerWasm(workerId);
        }
      }
      
      this.pendingChunks.delete(taskId);
      throw error;
    }
  }
  
  /**
   * Get an available worker
   */
  private async getAvailableWorker(): Promise<string> {
    // Find a ready worker
    for (const [id, instance] of this.workers.entries()) {
      if (instance.status === 'ready') {
        return id;
      }
    }
    
    // Wait for any busy worker
    const busyWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'busy');
    
    if (busyWorkers.length > 0) {
      // Wait a bit and try again
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.getAvailableWorker();
    }
    
    // No workers available - try to spawn new one
    if (this.workers.size < this.config.maxWorkers) {
      return this.spawnWorker();
    }
    
    // All workers dead - respawn one
    const deadWorker = Array.from(this.workers.entries())
      .find(([, w]) => w.status === 'dead');
    
    if (deadWorker) {
      return this.respawnWorker(deadWorker[0]);
    }
    
    throw new Error('No workers available');
  }
  
  // ==========================================================================
  // WASM MANAGEMENT
  // ==========================================================================
  
  /**
   * Reset WASM for a worker
   */
  async resetWorkerWasm(workerId: string): Promise<void> {
    const instance = this.workers.get(workerId);
    if (!instance) return;
    
    this.emit({
      type: 'wasm-resetting',
      timestamp: Date.now(),
      workerId,
      message: `Resetting WASM for worker ${workerId}`,
    });
    
    instance.status = 'recovering';
    
    try {
      const response = await this.sendMessage(
        workerId,
        'reset',
        undefined,
        this.config.wasmResetTimeout
      );
      
      if (!response.success) {
        throw new Error(response.error || 'WASM reset failed');
      }
      
      instance.wasmResets++;
      instance.status = 'ready';
      instance.consecutiveFailures = 0;
      
      this.emit({
        type: 'wasm-reset',
        timestamp: Date.now(),
        workerId,
        message: `WASM reset complete for worker ${workerId}`,
        details: { totalResets: instance.wasmResets },
      });
    } catch (error) {
      // WASM reset failed - worker needs respawn
      instance.status = 'dead';
      
      if (this.running) {
        await this.respawnWorker(workerId);
      }
    }
  }
  
  /**
   * Reset all workers
   */
  async resetAllWorkers(): Promise<void> {
    this.emit({
      type: 'pipeline-recovering',
      timestamp: Date.now(),
      message: 'Resetting all workers for emergency recovery',
    });
    
    const resetPromises = Array.from(this.workers.keys())
      .map(id => this.resetWorkerWasm(id).catch(() => {}));
    
    await Promise.all(resetPromises);
    
    this.emit({
      type: 'pipeline-stable',
      timestamp: Date.now(),
      message: 'All workers reset complete',
    });
  }
  
  // ==========================================================================
  // DEGRADED MODE
  // ==========================================================================
  
  /**
   * Enter degraded mode
   */
  private enterDegradedMode(): void {
    if (this.isDegraded) return;
    
    this.isDegraded = true;
    
    this.emit({
      type: 'pipeline-recovering',
      timestamp: Date.now(),
      message: 'Entering degraded mode - reduced concurrency',
      details: { isDegraded: true },
    });
    
    // Reduce max workers
    this.config.maxWorkers = Math.max(1, Math.floor(this.config.maxWorkers / 2));
  }
  
  /**
   * Exit degraded mode
   */
  exitDegradedMode(): void {
    if (!this.isDegraded) return;
    
    this.isDegraded = false;
    this.config.maxWorkers = navigator.hardwareConcurrency || 4;
    
    this.emit({
      type: 'pipeline-stable',
      timestamp: Date.now(),
      message: 'Exiting degraded mode - full concurrency restored',
    });
  }
  
  // ==========================================================================
  // STATISTICS
  // ==========================================================================
  
  /**
   * Get active worker count
   */
  getActiveWorkerCount(): number {
    return Array.from(this.workers.values())
      .filter(w => w.status === 'ready' || w.status === 'busy')
      .length;
  }
  
  /**
   * Get manager statistics
   */
  getStats(): WorkerManagerStats {
    let totalChunks = 0;
    let totalErrors = 0;
    let totalResets = 0;
    let active = 0;
    let dead = 0;
    let recovering = 0;
    
    for (const instance of this.workers.values()) {
      totalChunks += instance.chunksProcessed;
      totalErrors += instance.errorsRecovered;
      totalResets += instance.wasmResets;
      
      switch (instance.status) {
        case 'ready':
        case 'busy':
          active++;
          break;
        case 'dead':
          dead++;
          break;
        case 'recovering':
        case 'initializing':
          recovering++;
          break;
      }
    }
    
    return {
      totalWorkers: this.workers.size,
      activeWorkers: active,
      deadWorkers: dead,
      recoveringWorkers: recovering,
      totalChunksProcessed: totalChunks,
      totalErrorsRecovered: totalErrors,
      totalWasmResets: totalResets,
      totalRespawns: this.totalRespawns,
      isDegraded: this.isDegraded,
    };
  }
  
  // ==========================================================================
  // EVENTS
  // ==========================================================================
  
  /**
   * Add event handler
   */
  addEventListener(handler: ManagerEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }
  
  /**
   * Emit event
   */
  private emit(event: WatchdogEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[WorkerManager] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalWorkerManager: FailSafeWorkerManager | null = null;

export function getFailSafeWorkerManager(
  config?: Partial<FailSafeWorkerConfig>
): FailSafeWorkerManager {
  if (!globalWorkerManager) {
    globalWorkerManager = new FailSafeWorkerManager(config);
  }
  return globalWorkerManager;
}

export function resetFailSafeWorkerManager(): void {
  if (globalWorkerManager) {
    globalWorkerManager.shutdown();
    globalWorkerManager = null;
  }
}
