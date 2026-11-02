/**
 * SPK Hyper-Low-Memory Mode - Low-RAM Worker Profile
 * Creator: OJ Treasure Onazi
 * 
 * Section 5: Low-RAM Worker Profile
 * - 1-2 workers max in ultra-low mode
 * - Per-worker memory limits (150-200MB)
 * - WASM page restrictions
 * - Priority-based worker allocation
 */

import {
  KB, MB,
  type WorkerProfile,
  type WorkerProfileName,
  WORKER_PROFILES,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';
import { getMemoryBudgetController } from './memory-budget';

// ============================================================================
// WORKER PROFILE TYPES
// ============================================================================

export interface WorkerInstance {
  id: string;
  worker: Worker;
  profile: WorkerProfile;
  busy: boolean;
  allocated: number;
  tasks: number;
  createdAt: number;
  lastTaskAt: number;
  errors: number;
}

export interface WorkerTask {
  id: string;
  type: 'compress' | 'decompress' | 'hash' | 'transform';
  data: Uint8Array;
  priority: 'high' | 'normal' | 'low';
  timeout?: number;
  resolve: (result: Uint8Array) => void;
  reject: (error: Error) => void;
  queuedAt: number;
}

export interface WorkerPoolStats {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgTaskTime: number;
  totalMemoryAllocated: number;
  currentProfile: string;
}

// ============================================================================
// WORKER PROFILE MANAGER
// ============================================================================

export class WorkerProfileManager {
  private currentProfile: WorkerProfile;
  private workers: Map<string, WorkerInstance> = new Map();
  private taskQueue: WorkerTask[] = [];
  private memoryController = getMemoryBudgetController();
  private eventHandlers: LowMemEventHandler[] = [];
  
  // Stats
  private completedTasks = 0;
  private failedTasks = 0;
  private taskTimes: number[] = [];
  
  // Worker script URL (would be created/loaded externally)
  private workerScriptUrl: string | null = null;

  constructor(profileName: WorkerProfileName = 'ultra_low') {
    this.currentProfile = WORKER_PROFILES[profileName];
    
    // Listen to memory pressure
    this.memoryController.on((event) => {
      if (event.type === 'pressure-change') {
        this.adjustProfileForPressure(event.to as string);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Initialize worker pool
   */
  async initialize(workerScriptUrl: string): Promise<void> {
    this.workerScriptUrl = workerScriptUrl;
    
    // Create initial workers based on profile
    const initialWorkers = Math.min(
      this.currentProfile.workerCount,
      this.currentProfile.workerCount
    );
    
    for (let i = 0; i < initialWorkers; i++) {
      await this.createWorker();
    }
    
    this.emit({ type: 'worker-pool-initialized', workerCount: initialWorkers });
  }

  /**
   * Submit task to worker pool
   */
  async submitTask(
    type: WorkerTask['type'],
    data: Uint8Array,
    priority: WorkerTask['priority'] = 'normal',
    timeout?: number
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        data,
        priority,
        timeout,
        resolve,
        reject,
        queuedAt: Date.now(),
      };
      
      // Check if we can process immediately
      const availableWorker = this.getAvailableWorker();
      if (availableWorker) {
        this.processTask(availableWorker, task);
      } else {
        // Queue task
        this.queueTask(task);
        
        // Maybe spawn another worker if allowed
        this.maybeSpawnWorker();
      }
    });
  }

  /**
   * Get current profile
   */
  getProfile(): WorkerProfile {
    return { ...this.currentProfile };
  }

  /**
   * Set worker profile
   */
  setProfile(profileName: WorkerProfileName): void {
    const newProfile = WORKER_PROFILES[profileName];
    
    if (newProfile.workerCount < this.workers.size) {
      // Need to reduce workers
      this.reduceWorkers(newProfile.workerCount);
    }
    
    this.currentProfile = newProfile;
    this.emit({ type: 'worker-profile-change', profile: profileName });
  }

  // ---------------------------------------------------------------------------
  // WORKER MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Create a new worker
   */
  private async createWorker(): Promise<WorkerInstance | null> {
    if (!this.workerScriptUrl) {
      console.error('[WorkerProfileManager] No worker script URL');
      return null;
    }
    
    // Check if we're at max workers
    if (this.workers.size >= this.currentProfile.workerCount) {
      return null;
    }
    
    // Allocate memory for worker
    const allocResult = this.memoryController.allocate({
      id: `worker_${this.workers.size}`,
      bytes: this.currentProfile.memoryLimit,
      purpose: 'worker',
      priority: 'high',
    });
    
    if (!allocResult.success) {
      console.warn('[WorkerProfileManager] Cannot allocate memory for worker');
      return null;
    }
    
    try {
      const worker = new Worker(this.workerScriptUrl, { type: 'module' });
      
      const instance: WorkerInstance = {
        id: `worker_${Date.now()}_${this.workers.size}`,
        worker,
        profile: this.currentProfile,
        busy: false,
        allocated: this.currentProfile.memoryLimit,
        tasks: 0,
        createdAt: Date.now(),
        lastTaskAt: 0,
        errors: 0,
      };
      
      // Setup message handling
      worker.onmessage = (e) => this.handleWorkerMessage(instance, e);
      worker.onerror = (e) => this.handleWorkerError(instance, e);
      
      this.workers.set(instance.id, instance);
      
      this.emit({ type: 'worker-created', workerId: instance.id });
      
      return instance;
    } catch (error) {
      this.memoryController.release(`worker_${this.workers.size}`);
      console.error('[WorkerProfileManager] Failed to create worker:', error);
      return null;
    }
  }

  /**
   * Terminate a worker
   */
  private terminateWorker(instance: WorkerInstance): void {
    instance.worker.terminate();
    this.workers.delete(instance.id);
    this.memoryController.releaseBytes(instance.allocated);
    
    this.emit({ type: 'worker-terminated', workerId: instance.id });
  }

  /**
   * Reduce worker count
   */
  private reduceWorkers(targetCount: number): void {
    const toRemove = this.workers.size - targetCount;
    if (toRemove <= 0) return;
    
    // Remove idle workers first
    const idle = [...this.workers.values()]
      .filter(w => !w.busy)
      .sort((a, b) => a.lastTaskAt - b.lastTaskAt);
    
    for (let i = 0; i < Math.min(toRemove, idle.length); i++) {
      this.terminateWorker(idle[i]);
    }
  }

  /**
   * Maybe spawn additional worker
   */
  private maybeSpawnWorker(): void {
    if (
      this.workers.size < this.currentProfile.workerCount &&
      this.taskQueue.length > 0
    ) {
      this.createWorker();
    }
  }

  /**
   * Get available (not busy) worker
   */
  private getAvailableWorker(): WorkerInstance | null {
    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        return worker;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // TASK PROCESSING
  // ---------------------------------------------------------------------------

  /**
   * Queue a task
   */
  private queueTask(task: WorkerTask): void {
    // Insert by priority
    let inserted = false;
    
    for (let i = 0; i < this.taskQueue.length; i++) {
      const existing = this.taskQueue[i];
      if (
        task.priority === 'high' && existing.priority !== 'high' ||
        task.priority === 'normal' && existing.priority === 'low'
      ) {
        this.taskQueue.splice(i, 0, task);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.taskQueue.push(task);
    }
    
    this.emit({ type: 'task-queued', taskId: task.id, queueLength: this.taskQueue.length });
  }

  /**
   * Process task on worker
   */
  private processTask(worker: WorkerInstance, task: WorkerTask): void {
    worker.busy = true;
    worker.tasks++;
    worker.lastTaskAt = Date.now();
    
    // Setup timeout if specified
    let timeoutId: number | null = null;
    if (task.timeout) {
      timeoutId = window.setTimeout(() => {
        task.reject(new Error('Task timeout'));
        worker.busy = false;
        worker.errors++;
        this.failedTasks++;
        this.processNextTask();
      }, task.timeout);
    }
    
    // Store task reference for response handling
    (worker as unknown as { currentTask: WorkerTask; timeoutId: number | null }).currentTask = task;
    (worker as unknown as { currentTask: WorkerTask; timeoutId: number | null }).timeoutId = timeoutId;
    
    // Send task to worker
    const transfer = [task.data.buffer];
    worker.worker.postMessage(
      { type: task.type, data: task.data, taskId: task.id },
      transfer
    );
  }

  /**
   * Process next task from queue
   */
  private processNextTask(): void {
    if (this.taskQueue.length === 0) return;
    
    const worker = this.getAvailableWorker();
    if (worker) {
      const task = this.taskQueue.shift()!;
      this.processTask(worker, task);
    }
  }

  /**
   * Handle worker message
   */
  private handleWorkerMessage(worker: WorkerInstance, event: MessageEvent): void {
    const extended = worker as unknown as { currentTask: WorkerTask; timeoutId: number | null };
    const task = extended.currentTask;
    const timeoutId = extended.timeoutId;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    worker.busy = false;
    
    if (event.data.error) {
      task.reject(new Error(event.data.error));
      this.failedTasks++;
      worker.errors++;
    } else {
      const result = new Uint8Array(event.data.result);
      task.resolve(result);
      this.completedTasks++;
      
      // Record task time
      const taskTime = Date.now() - task.queuedAt;
      this.taskTimes.push(taskTime);
      if (this.taskTimes.length > 100) {
        this.taskTimes.shift();
      }
    }
    
    this.processNextTask();
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(worker: WorkerInstance, _event: ErrorEvent): void {
    worker.errors++;
    worker.busy = false;
    
    const extended = worker as unknown as { currentTask?: WorkerTask };
    if (extended.currentTask) {
      extended.currentTask.reject(new Error('Worker error'));
      this.failedTasks++;
    }
    
    // Terminate and recreate if too many errors
    if (worker.errors > 3) {
      this.terminateWorker(worker);
      this.createWorker();
    }
    
    this.processNextTask();
  }

  // ---------------------------------------------------------------------------
  // PRESSURE ADJUSTMENT
  // ---------------------------------------------------------------------------

  /**
   * Adjust profile based on memory pressure
   */
  private adjustProfileForPressure(pressure: string): void {
    switch (pressure) {
      case 'emergency':
      case 'critical':
        this.setProfile('ultra_low');
        break;
      case 'high':
        this.setProfile('low');
        break;
      case 'medium':
        this.setProfile('normal');
        break;
      default:
        // Don't auto-upgrade to high
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // STATS
  // ---------------------------------------------------------------------------

  /**
   * Get worker pool statistics
   */
  getStats(): WorkerPoolStats {
    let totalAllocated = 0;
    let activeCount = 0;
    
    for (const worker of this.workers.values()) {
      totalAllocated += worker.allocated;
      if (worker.busy) activeCount++;
    }
    
    const avgTaskTime = this.taskTimes.length > 0
      ? this.taskTimes.reduce((a, b) => a + b, 0) / this.taskTimes.length
      : 0;
    
    return {
      totalWorkers: this.workers.size,
      activeWorkers: activeCount,
      idleWorkers: this.workers.size - activeCount,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      avgTaskTime,
      totalMemoryAllocated: totalAllocated,
      currentProfile: this.getProfileName(),
    };
  }

  /**
   * Get current profile name
   */
  private getProfileName(): string {
    for (const [name, profile] of Object.entries(WORKER_PROFILES)) {
      if (profile.workerCount === this.currentProfile.workerCount &&
          profile.memoryLimit === this.currentProfile.memoryLimit) {
        return name;
      }
    }
    return 'custom';
  }

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers.values()) {
      this.terminateWorker(worker);
    }
    
    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error('Worker pool terminated'));
    }
    this.taskQueue = [];
    
    this.emit({ type: 'worker-pool-terminated' });
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.taskTimes = [];
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  on(handler: LowMemEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: LowMemEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[WorkerProfileManager] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Recommend worker profile based on system
 */
export function recommendWorkerProfile(): WorkerProfileName {
  // Check hardware concurrency
  const cores = navigator.hardwareConcurrency || 2;
  
  // Check device memory
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 2;
  
  if (deviceMemory <= 1 || cores <= 2) {
    return 'ultra_low';
  }
  if (deviceMemory <= 2 || cores <= 4) {
    return 'low';
  }
  if (deviceMemory <= 4) {
    return 'normal';
  }
  return 'high';
}

/**
 * Calculate max WASM pages for profile
 */
export function calculateMaxWasmPages(profile: WorkerProfile): number {
  // WASM page = 64KB
  return profile.wasmPages;
}

/**
 * Estimate worker memory overhead
 */
export function estimateWorkerOverhead(workerCount: number): number {
  // Base overhead per worker (context, stack, etc.)
  const baseOverhead = 5 * MB;
  return workerCount * baseOverhead;
}

// ============================================================================
// SINGLETON
// ============================================================================

let managerInstance: WorkerProfileManager | null = null;

export function getWorkerProfileManager(
  profileName?: WorkerProfileName
): WorkerProfileManager {
  if (!managerInstance) {
    managerInstance = new WorkerProfileManager(profileName);
  }
  return managerInstance;
}

export function resetWorkerProfileManager(): void {
  managerInstance?.terminate();
  managerInstance = null;
}
