/**
 * SPK Hard Constraint Engine - Memory Manager
 * Creator: OJ Treasure Onazi
 * 
 * Monitors and enforces memory budgets for massive jobs:
 * - WASM memory pages
 * - Worker memory usage
 * - Buffer pool utilization
 * - JS heap size
 */

import {
  HARD_LIMITS,
  KB, MB, GB,
  type MemorySnapshot,
  type MemoryBudget,
  type MassiveJobConfig,
  DEFAULT_MASSIVE_CONFIG,
} from './types';

// ============================================================================
// MEMORY MANAGER
// ============================================================================

export class MassiveMemoryManager {
  private config: MassiveJobConfig;
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 100;
  
  // Current state
  private currentSnapshot: MemorySnapshot;
  private wasmMemory: WebAssembly.Memory | null = null;
  private bufferPoolSize = 0;
  private workerCount = 0;
  
  // Callbacks
  private onPressureChange?: (pressure: MemorySnapshot['pressure']) => void;
  private onRecoveryNeeded?: (action: string) => void;

  constructor(config: Partial<MassiveJobConfig> = {}) {
    this.config = { ...DEFAULT_MASSIVE_CONFIG, ...config };
    this.currentSnapshot = this.createEmptySnapshot();
  }

  /**
   * Set WASM memory reference for tracking
   */
  setWasmMemory(memory: WebAssembly.Memory): void {
    this.wasmMemory = memory;
  }

  /**
   * Update buffer pool size
   */
  updateBufferPool(size: number): void {
    this.bufferPoolSize = size;
  }

  /**
   * Update worker count
   */
  updateWorkerCount(count: number): void {
    this.workerCount = count;
  }

  /**
   * Set pressure change callback
   */
  onPressureChanged(callback: (pressure: MemorySnapshot['pressure']) => void): void {
    this.onPressureChange = callback;
  }

  /**
   * Set recovery needed callback
   */
  onRecoveryRequired(callback: (action: string) => void): void {
    this.onRecoveryNeeded = callback;
  }

  /**
   * Take memory snapshot
   */
  takeSnapshot(): MemorySnapshot {
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      
      // JS Heap
      jsHeapUsed: 0,
      jsHeapTotal: 0,
      jsHeapLimit: 0,
      
      // WASM
      wasmPages: 0,
      wasmBytesUsed: 0,
      
      // Buffer pools
      bufferPoolUsed: this.bufferPoolSize,
      bufferPoolTotal: this.config.memoryBudget * 0.3, // 30% budget for buffers
      
      // Workers
      workerMemoryEstimate: this.workerCount * 50 * MB, // ~50MB per worker estimate
      
      // Total
      totalEstimate: 0,
      pressure: 'low',
    };

    // Get JS heap if available
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memInfo = (performance as unknown as { memory: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      }}).memory;
      
      snapshot.jsHeapUsed = memInfo.usedJSHeapSize;
      snapshot.jsHeapTotal = memInfo.totalJSHeapSize;
      snapshot.jsHeapLimit = memInfo.jsHeapSizeLimit;
    }

    // Get WASM memory
    if (this.wasmMemory) {
      snapshot.wasmPages = this.wasmMemory.buffer.byteLength / (64 * KB);
      snapshot.wasmBytesUsed = this.wasmMemory.buffer.byteLength;
    }

    // Calculate total estimate
    snapshot.totalEstimate = 
      snapshot.jsHeapUsed +
      snapshot.wasmBytesUsed +
      snapshot.bufferPoolUsed +
      snapshot.workerMemoryEstimate;

    // Determine pressure level
    snapshot.pressure = this.calculatePressure(snapshot.totalEstimate);

    // Store snapshot
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Check for pressure change
    const previousPressure = this.currentSnapshot.pressure;
    this.currentSnapshot = snapshot;
    
    if (snapshot.pressure !== previousPressure) {
      this.onPressureChange?.(snapshot.pressure);
      
      // Trigger recovery if needed
      if (snapshot.pressure === 'critical') {
        this.triggerRecovery();
      }
    }

    return snapshot;
  }

  /**
   * Calculate memory pressure level
   */
  private calculatePressure(totalUsage: number): MemorySnapshot['pressure'] {
    if (totalUsage >= HARD_LIMITS.MEMORY_CRITICAL_LIMIT) {
      return 'critical';
    }
    if (totalUsage >= HARD_LIMITS.MEMORY_HARD_LIMIT) {
      return 'high';
    }
    if (totalUsage >= HARD_LIMITS.MEMORY_SOFT_LIMIT) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Get memory budget with recommendations
   */
  getBudget(): MemoryBudget {
    const snapshot = this.takeSnapshot();
    
    // Calculate budgets
    const totalBudget = this.config.memoryBudget;
    const wasmBudget = totalBudget * 0.4;      // 40% for WASM
    const workerBudget = totalBudget * 0.3;    // 30% for workers
    const bufferBudget = totalBudget * 0.2;    // 20% for buffers
    const jsBudget = totalBudget * 0.1;        // 10% for JS overhead

    // Calculate recommendations
    let recommendedChunkSize = this.config.chunkSize;
    let recommendedConcurrency = this.config.workerCount;
    let shouldFlush = false;
    let shouldReduceChunks = false;

    switch (snapshot.pressure) {
      case 'critical':
        recommendedChunkSize = HARD_LIMITS.MASSIVE_MIN_CHUNK;
        recommendedConcurrency = HARD_LIMITS.MIN_WORKERS_MASSIVE;
        shouldFlush = true;
        shouldReduceChunks = true;
        break;
        
      case 'high':
        recommendedChunkSize = Math.max(
          HARD_LIMITS.MASSIVE_MIN_CHUNK,
          this.config.chunkSize / 2
        );
        recommendedConcurrency = Math.max(
          HARD_LIMITS.MIN_WORKERS_MASSIVE,
          Math.floor(this.config.workerCount / 2)
        );
        shouldFlush = true;
        shouldReduceChunks = true;
        break;
        
      case 'medium':
        recommendedChunkSize = Math.max(
          256 * KB,
          Math.floor(this.config.chunkSize * 0.75)
        );
        recommendedConcurrency = Math.max(
          HARD_LIMITS.MIN_WORKERS_MASSIVE,
          this.config.workerCount - 1
        );
        shouldFlush = snapshot.bufferPoolUsed > bufferBudget * 0.8;
        break;
        
      case 'low':
      default:
        // Can increase if stable
        if (this.isMemoryStable()) {
          recommendedChunkSize = Math.min(
            HARD_LIMITS.MASSIVE_MAX_CHUNK,
            Math.floor(this.config.chunkSize * 1.25)
          );
        }
        break;
    }

    return {
      totalBudget,
      wasmBudget,
      workerBudget,
      bufferBudget,
      jsBudget,
      current: snapshot,
      recommendedChunkSize,
      recommendedConcurrency,
      shouldFlush,
      shouldReduceChunks,
    };
  }

  /**
   * Check if memory usage is stable
   */
  isMemoryStable(): boolean {
    if (this.snapshots.length < 5) return true;
    
    const recent = this.snapshots.slice(-5);
    const avgUsage = recent.reduce((sum, s) => sum + s.totalEstimate, 0) / recent.length;
    
    // Check variance
    const variance = recent.reduce((sum, s) => 
      sum + Math.abs(s.totalEstimate - avgUsage), 0
    ) / recent.length;
    
    // Stable if variance < 10% of average
    return variance < avgUsage * 0.1;
  }

  /**
   * Trigger memory recovery actions
   */
  private triggerRecovery(): void {
    const actions: string[] = [];

    // Determine recovery actions
    if (this.currentSnapshot.bufferPoolUsed > this.config.memoryBudget * 0.2) {
      actions.push('flush_buffers');
    }
    
    if (this.currentSnapshot.wasmBytesUsed > this.config.memoryBudget * 0.5) {
      actions.push('gc_wasm');
    }
    
    if (this.workerCount > HARD_LIMITS.MIN_WORKERS_MASSIVE) {
      actions.push('reduce_workers');
    }
    
    actions.push('reduce_chunks');
    actions.push('force_gc');

    // Notify about needed recovery
    for (const action of actions) {
      this.onRecoveryNeeded?.(action);
    }
  }

  /**
   * Request GC if available
   */
  requestGC(): void {
    // Try to hint at GC (not guaranteed)
    if (typeof globalThis !== 'undefined' && 'gc' in globalThis) {
      (globalThis as unknown as { gc: () => void }).gc();
    }
  }

  /**
   * Get current snapshot
   */
  getCurrentSnapshot(): MemorySnapshot {
    return { ...this.currentSnapshot };
  }

  /**
   * Get snapshot history
   */
  getHistory(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get memory trend
   */
  getMemoryTrend(): 'increasing' | 'stable' | 'decreasing' {
    if (this.snapshots.length < 3) return 'stable';
    
    const recent = this.snapshots.slice(-3);
    const first = recent[0].totalEstimate;
    const last = recent[recent.length - 1].totalEstimate;
    
    const change = (last - first) / first;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Check if can allocate
   */
  canAllocate(bytes: number): boolean {
    return this.currentSnapshot.totalEstimate + bytes < HARD_LIMITS.MEMORY_HARD_LIMIT;
  }

  /**
   * Get available memory
   */
  getAvailable(): number {
    return Math.max(0, HARD_LIMITS.MEMORY_SOFT_LIMIT - this.currentSnapshot.totalEstimate);
  }

  /**
   * Create empty snapshot
   */
  private createEmptySnapshot(): MemorySnapshot {
    return {
      timestamp: Date.now(),
      jsHeapUsed: 0,
      jsHeapTotal: 0,
      jsHeapLimit: 0,
      wasmPages: 0,
      wasmBytesUsed: 0,
      bufferPoolUsed: 0,
      bufferPoolTotal: 0,
      workerMemoryEstimate: 0,
      totalEstimate: 0,
      pressure: 'low',
    };
  }

  /**
   * Reset manager
   */
  reset(): void {
    this.snapshots = [];
    this.currentSnapshot = this.createEmptySnapshot();
    this.bufferPoolSize = 0;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let memoryManagerInstance: MassiveMemoryManager | null = null;

export function getMassiveMemoryManager(config?: Partial<MassiveJobConfig>): MassiveMemoryManager {
  if (!memoryManagerInstance) {
    memoryManagerInstance = new MassiveMemoryManager(config);
  }
  return memoryManagerInstance;
}

export function resetMassiveMemoryManager(): void {
  memoryManagerInstance?.reset();
  memoryManagerInstance = null;
}
