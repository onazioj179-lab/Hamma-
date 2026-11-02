/**
 * SPK V36 - Memory Governor System
 * 
 * Provides strict memory control:
 * - Hard cap memory usage (target <300MB)
 * - Streaming buffers recycled aggressively
 * - Worker memory map monitoring
 * - Automatic fallback to micro-chunks when memory tight
 * - Prevents crashes on low-end devices
 */

// ============================================================================
// TYPES
// ============================================================================

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  external: number;
  estimatedUsage: number;
  available: number;
  pressure: 'low' | 'medium' | 'high' | 'critical';
}

export interface MemoryConfig {
  hardLimit: number;           // Absolute max memory
  softLimit: number;           // Start throttling here
  warningThreshold: number;    // Show warnings here
  criticalThreshold: number;   // Emergency measures here
  minChunkSize: number;        // Minimum allowed chunk
  microChunkSize: number;      // Emergency tiny chunks
  gcInterval: number;          // Buffer cleanup interval
}

export interface BufferPool {
  id: string;
  size: number;
  allocated: number;
  available: number;
  buffers: ArrayBuffer[];
}

export type MemoryPressureCallback = (stats: MemoryStats) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: MemoryConfig = {
  hardLimit: 300 * 1024 * 1024,      // 300MB hard limit
  softLimit: 200 * 1024 * 1024,      // 200MB soft limit
  warningThreshold: 0.7,              // 70% usage warning
  criticalThreshold: 0.9,             // 90% critical
  minChunkSize: 64 * 1024,            // 64KB minimum
  microChunkSize: 16 * 1024,          // 16KB micro-chunks
  gcInterval: 5000,                   // 5 second cleanup
};

// ============================================================================
// BUFFER POOL
// ============================================================================

class RecyclableBufferPool {
  private pools = new Map<number, ArrayBuffer[]>();
  private totalAllocated = 0;
  private maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  /**
   * Acquire a buffer of given size
   */
  acquire(size: number): ArrayBuffer {
    // Round up to nearest power of 2 for pooling efficiency
    const poolSize = this.roundToPowerOf2(size);
    
    // Check if we have a recycled buffer
    const pool = this.pools.get(poolSize);
    if (pool && pool.length > 0) {
      return pool.pop()!;
    }
    
    // Check memory budget
    if (this.totalAllocated + poolSize > this.maxSize) {
      // Try to free some memory first
      this.gc();
      
      if (this.totalAllocated + poolSize > this.maxSize) {
        throw new MemoryLimitError(
          `Cannot allocate ${poolSize} bytes: would exceed limit of ${this.maxSize}`
        );
      }
    }
    
    // Allocate new buffer
    this.totalAllocated += poolSize;
    return new ArrayBuffer(poolSize);
  }
  
  /**
   * Release a buffer back to the pool
   */
  release(buffer: ArrayBuffer): void {
    const size = buffer.byteLength;
    
    if (!this.pools.has(size)) {
      this.pools.set(size, []);
    }
    
    const pool = this.pools.get(size)!;
    
    // Limit pool size to prevent unbounded growth
    if (pool.length < 10) {
      pool.push(buffer);
    } else {
      // Let it be GC'd
      this.totalAllocated -= size;
    }
  }
  
  /**
   * Force garbage collection of all pools
   */
  gc(): void {
    for (const [size, pool] of this.pools.entries()) {
      // Keep only 2 buffers per size
      while (pool.length > 2) {
        pool.pop();
        this.totalAllocated -= size;
      }
    }
  }
  
  /**
   * Clear all pools
   */
  clear(): void {
    this.pools.clear();
    this.totalAllocated = 0;
  }
  
  /**
   * Get current allocation stats
   */
  getStats(): { allocated: number; pooled: number; pools: number } {
    let pooled = 0;
    for (const [size, pool] of this.pools.entries()) {
      pooled += size * pool.length;
    }
    
    return {
      allocated: this.totalAllocated,
      pooled,
      pools: this.pools.size,
    };
  }
  
  private roundToPowerOf2(n: number): number {
    let power = 1;
    while (power < n) {
      power *= 2;
    }
    return power;
  }
}

// ============================================================================
// MEMORY LIMIT ERROR
// ============================================================================

export class MemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryLimitError';
  }
}

// ============================================================================
// MEMORY GOVERNOR
// ============================================================================

export class MemoryGovernor {
  private config: MemoryConfig;
  private bufferPool: RecyclableBufferPool;
  private trackedAllocations = new Map<string, number>();
  private pressureCallbacks: MemoryPressureCallback[] = [];
  private gcTimer: number | null = null;
  private lastStats: MemoryStats | null = null;
  
  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bufferPool = new RecyclableBufferPool(this.config.hardLimit);
    
    // Start periodic GC
    this.startGcTimer();
  }
  
  /**
   * Start the garbage collection timer
   */
  private startGcTimer(): void {
    if (this.gcTimer) return;
    
    this.gcTimer = window.setInterval(() => {
      this.checkPressure();
      this.bufferPool.gc();
    }, this.config.gcInterval);
  }
  
  /**
   * Stop the garbage collection timer
   */
  stopGcTimer(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }
  
  /**
   * Get current memory statistics
   */
  getStats(): MemoryStats {
    // Try to get actual memory info if available
    let heapUsed = 0;
    let heapTotal = 0;
    let heapLimit = this.config.hardLimit;
    
    // @ts-expect-error - performance.memory is Chrome-specific
    if (performance.memory) {
      // @ts-expect-error
      heapUsed = performance.memory.usedJSHeapSize;
      // @ts-expect-error
      heapTotal = performance.memory.totalJSHeapSize;
      // @ts-expect-error
      heapLimit = performance.memory.jsHeapSizeLimit;
    }
    
    const poolStats = this.bufferPool.getStats();
    const tracked = this.getTotalTracked();
    
    const estimatedUsage = Math.max(heapUsed, poolStats.allocated + tracked);
    const available = this.config.hardLimit - estimatedUsage;
    
    const pressure = this.calculatePressure(estimatedUsage);
    
    this.lastStats = {
      heapUsed,
      heapTotal,
      heapLimit,
      external: poolStats.allocated,
      estimatedUsage,
      available,
      pressure,
    };
    
    return this.lastStats;
  }
  
  /**
   * Calculate memory pressure level
   */
  private calculatePressure(usage: number): MemoryStats['pressure'] {
    const ratio = usage / this.config.hardLimit;
    
    if (ratio >= this.config.criticalThreshold) return 'critical';
    if (ratio >= this.config.warningThreshold) return 'high';
    if (ratio >= 0.5) return 'medium';
    return 'low';
  }
  
  /**
   * Check memory pressure and notify
   */
  private checkPressure(): void {
    const stats = this.getStats();
    
    if (stats.pressure === 'high' || stats.pressure === 'critical') {
      for (const callback of this.pressureCallbacks) {
        callback(stats);
      }
    }
  }
  
  /**
   * Register pressure callback
   */
  onPressure(callback: MemoryPressureCallback): () => void {
    this.pressureCallbacks.push(callback);
    return () => {
      const idx = this.pressureCallbacks.indexOf(callback);
      if (idx >= 0) this.pressureCallbacks.splice(idx, 1);
    };
  }
  
  /**
   * Acquire a buffer from the pool
   */
  acquireBuffer(size: number): ArrayBuffer {
    return this.bufferPool.acquire(size);
  }
  
  /**
   * Release a buffer back to the pool
   */
  releaseBuffer(buffer: ArrayBuffer): void {
    this.bufferPool.release(buffer);
  }
  
  /**
   * Track an external allocation
   */
  track(id: string, size: number): void {
    this.trackedAllocations.set(id, size);
  }
  
  /**
   * Untrack an allocation
   */
  untrack(id: string): void {
    this.trackedAllocations.delete(id);
  }
  
  /**
   * Get total tracked allocations
   */
  private getTotalTracked(): number {
    let total = 0;
    for (const size of this.trackedAllocations.values()) {
      total += size;
    }
    return total;
  }
  
  /**
   * Check if we can allocate the requested size
   */
  canAllocate(size: number): boolean {
    const stats = this.getStats();
    return stats.available >= size;
  }
  
  /**
   * Get recommended chunk size based on memory pressure
   */
  getRecommendedChunkSize(preferredSize: number): number {
    const stats = this.getStats();
    
    switch (stats.pressure) {
      case 'critical':
        return this.config.microChunkSize;
      case 'high':
        return Math.max(this.config.minChunkSize, Math.floor(preferredSize / 4));
      case 'medium':
        return Math.max(this.config.minChunkSize, Math.floor(preferredSize / 2));
      default:
        return preferredSize;
    }
  }
  
  /**
   * Request memory (returns actual available)
   */
  requestMemory(requested: number): number {
    const stats = this.getStats();
    
    if (stats.pressure === 'critical') {
      // Emergency: only allow minimal allocation
      return Math.min(requested, this.config.microChunkSize);
    }
    
    if (stats.pressure === 'high') {
      // Throttle allocation
      return Math.min(requested, stats.available / 2);
    }
    
    // Normal: allow up to soft limit headroom
    const headroom = this.config.softLimit - stats.estimatedUsage;
    return Math.min(requested, Math.max(0, headroom));
  }
  
  /**
   * Force memory cleanup
   */
  forceCleanup(): void {
    this.bufferPool.gc();
    
    // Try to trigger browser GC if available
    const runtime = globalThis as typeof globalThis & { gc?: () => void };
    if (typeof runtime.gc === 'function') {
      runtime.gc();
    }
  }
  
  /**
   * Reset governor state
   */
  reset(): void {
    this.bufferPool.clear();
    this.trackedAllocations.clear();
    this.lastStats = null;
  }
  
  /**
   * Destroy governor
   */
  destroy(): void {
    this.stopGcTimer();
    this.reset();
    this.pressureCallbacks = [];
  }
}

// ============================================================================
// STREAMING BUFFER MANAGER
// ============================================================================

export class StreamingBufferManager {
  private governor: MemoryGovernor;
  private activeBuffers = new Map<string, { buffer: ArrayBuffer; lastUsed: number }>();
  private maxIdleTime = 10000; // 10 seconds before recycling idle buffer
  
  constructor(governor: MemoryGovernor) {
    this.governor = governor;
  }
  
  /**
   * Get a buffer for streaming
   */
  getBuffer(id: string, size: number): ArrayBuffer {
    // Check if we have an existing buffer
    const existing = this.activeBuffers.get(id);
    if (existing && existing.buffer.byteLength >= size) {
      existing.lastUsed = Date.now();
      return existing.buffer;
    }
    
    // Release old buffer if exists
    if (existing) {
      this.governor.releaseBuffer(existing.buffer);
    }
    
    // Acquire new buffer
    const recommendedSize = this.governor.getRecommendedChunkSize(size);
    const buffer = this.governor.acquireBuffer(recommendedSize);
    
    this.activeBuffers.set(id, {
      buffer,
      lastUsed: Date.now(),
    });
    
    return buffer;
  }
  
  /**
   * Release a buffer
   */
  releaseBuffer(id: string): void {
    const entry = this.activeBuffers.get(id);
    if (entry) {
      this.governor.releaseBuffer(entry.buffer);
      this.activeBuffers.delete(id);
    }
  }
  
  /**
   * Clean up idle buffers
   */
  cleanupIdle(): void {
    const now = Date.now();
    
    for (const [id, entry] of this.activeBuffers.entries()) {
      if (now - entry.lastUsed > this.maxIdleTime) {
        this.governor.releaseBuffer(entry.buffer);
        this.activeBuffers.delete(id);
      }
    }
  }
  
  /**
   * Release all buffers
   */
  releaseAll(): void {
    for (const [, entry] of this.activeBuffers.entries()) {
      this.governor.releaseBuffer(entry.buffer);
    }
    this.activeBuffers.clear();
  }
}

// ============================================================================
// WORKER MEMORY MONITOR
// ============================================================================

export interface WorkerMemoryInfo {
  workerId: string;
  estimatedUsage: number;
  activeChunks: number;
  status: 'healthy' | 'warning' | 'overloaded';
}

export class WorkerMemoryMonitor {
  private workers = new Map<string, WorkerMemoryInfo>();
  private maxPerWorker: number;
  
  constructor(maxPerWorker: number = 100 * 1024 * 1024) {
    this.maxPerWorker = maxPerWorker;
  }
  
  /**
   * Register a worker
   */
  registerWorker(workerId: string): void {
    this.workers.set(workerId, {
      workerId,
      estimatedUsage: 0,
      activeChunks: 0,
      status: 'healthy',
    });
  }
  
  /**
   * Update worker stats
   */
  updateWorker(workerId: string, chunkSize: number, delta: number): void {
    const info = this.workers.get(workerId);
    if (!info) return;
    
    info.estimatedUsage += chunkSize * delta;
    info.activeChunks += delta;
    info.estimatedUsage = Math.max(0, info.estimatedUsage);
    info.activeChunks = Math.max(0, info.activeChunks);
    
    // Update status
    const ratio = info.estimatedUsage / this.maxPerWorker;
    if (ratio >= 0.9) {
      info.status = 'overloaded';
    } else if (ratio >= 0.7) {
      info.status = 'warning';
    } else {
      info.status = 'healthy';
    }
  }
  
  /**
   * Get least loaded worker
   */
  getLeastLoadedWorker(): string | null {
    let minLoad = Infinity;
    let bestWorker: string | null = null;
    
    for (const [id, info] of this.workers.entries()) {
      if (info.status !== 'overloaded' && info.estimatedUsage < minLoad) {
        minLoad = info.estimatedUsage;
        bestWorker = id;
      }
    }
    
    return bestWorker;
  }
  
  /**
   * Check if worker can accept chunk
   */
  canAcceptChunk(workerId: string, chunkSize: number): boolean {
    const info = this.workers.get(workerId);
    if (!info) return false;
    
    return info.estimatedUsage + chunkSize <= this.maxPerWorker;
  }
  
  /**
   * Get all worker stats
   */
  getAllStats(): WorkerMemoryInfo[] {
    return Array.from(this.workers.values());
  }
  
  /**
   * Unregister worker
   */
  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let memoryGovernor: MemoryGovernor | null = null;

export function getMemoryGovernor(config?: Partial<MemoryConfig>): MemoryGovernor {
  if (!memoryGovernor || config) {
    if (memoryGovernor) {
      memoryGovernor.destroy();
    }
    memoryGovernor = new MemoryGovernor(config);
  }
  return memoryGovernor;
}

export function resetMemoryGovernor(): void {
  if (memoryGovernor) {
    memoryGovernor.destroy();
    memoryGovernor = null;
  }
}
