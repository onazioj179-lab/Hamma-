/**
 * SPK Micro-Optimization Layer - Memory Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 5: MEMORY OPTIMIZATION
 * - Reuse all buffers and pointers
 * - Hybrid memory pool (small/medium/large/huge)
 * - Dynamic chunk sizing based on pressure
 * - Never combine large buffers in JS
 * - Stream append only mode
 * 
 * Targets:
 * - Maintain < 300-600MB even on multi-GB files
 * - Automatic fallback to micro-chunks when stressed
 */

import type {
  MemoryOptimizationConfig,
  MemoryPoolStats,
  MemoryOptimizationStats,
  MemoryPressure,
  PoolTier,
  BufferRecycleStrategy,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const KB = 1024;
const MB = 1024 * KB;

const DEFAULT_MEMORY_CONFIG: MemoryOptimizationConfig = {
  reuseAllBuffers: true,
  recycleStrategy: 'aggressive',
  hybridPoolEnabled: true,
  poolTiers: {
    small: { maxSize: 512 * KB, count: 32 },      // <512KB
    medium: { maxSize: 4 * MB, count: 16 },        // 512KB-4MB
    large: { maxSize: 16 * MB, count: 8 },         // 4MB-16MB
    huge: { maxSize: 64 * MB, count: 2 },          // >16MB (special handling)
  },
  dynamicChunkSizing: true,
  chunkSizeMultiplier: 1.25,
  chunkSizeDivider: 2,
  memoryHighThreshold: 0.8,
  memoryLowThreshold: 0.4,
  neverCombineLargeBuffers: true,
  streamAppendOnly: true,
  maxCombineSize: 1 * MB,
};

const MEMORY_LIMITS = {
  soft: 300 * MB,
  hard: 600 * MB,
  critical: 500 * MB,
  micro: 256 * MB,
};

// ============================================================================
// POOL ENTRY
// ============================================================================

interface PoolEntry {
  id: string;
  buffer: ArrayBuffer;
  view: Uint8Array;
  size: number;
  inUse: boolean;
  lastUsed: number;
  useCount: number;
}

// ============================================================================
// TIERED BUFFER POOL
// ============================================================================

class TieredBufferPool {
  private pools: Map<PoolTier, PoolEntry[]> = new Map();
  private tierLimits: Map<PoolTier, { maxSize: number; count: number }>;
  private entryCounter = 0;
  private stats = {
    allocations: 0,
    deallocations: 0,
    hits: 0,
    misses: 0,
    totalAllocated: 0,
    peakAllocated: 0,
  };

  constructor(config: MemoryOptimizationConfig['poolTiers']) {
    this.tierLimits = new Map([
      ['small', config.small],
      ['medium', config.medium],
      ['large', config.large],
      ['huge', config.huge],
    ]);

    // Initialize pools
    for (const tier of ['small', 'medium', 'large', 'huge'] as PoolTier[]) {
      this.pools.set(tier, []);
    }
  }

  /**
   * Get tier for size
   */
  private getTier(size: number): PoolTier {
    if (size <= this.tierLimits.get('small')!.maxSize) return 'small';
    if (size <= this.tierLimits.get('medium')!.maxSize) return 'medium';
    if (size <= this.tierLimits.get('large')!.maxSize) return 'large';
    return 'huge';
  }

  /**
   * Acquire buffer from pool
   */
  acquire(size: number): PoolEntry {
    const tier = this.getTier(size);
    const pool = this.pools.get(tier)!;
    const limits = this.tierLimits.get(tier)!;

    // Find existing buffer that fits
    for (const entry of pool) {
      if (!entry.inUse && entry.size >= size) {
        entry.inUse = true;
        entry.lastUsed = Date.now();
        entry.useCount++;
        this.stats.hits++;
        return entry;
      }
    }

    this.stats.misses++;

    // Check if can create new entry
    const activeCount = pool.filter(e => e.inUse).length;
    if (activeCount >= limits.count && tier === 'huge') {
      // For huge tier, wait or throw
      throw new Error('Memory limit exceeded: too many huge allocations');
    }

    // Create new buffer (round up to power of 2 for efficiency)
    const allocSize = this.roundToPowerOf2(Math.max(size, 64 * KB));
    const buffer = new ArrayBuffer(allocSize);
    const view = new Uint8Array(buffer);

    const entry: PoolEntry = {
      id: `pool-${++this.entryCounter}`,
      buffer,
      view,
      size: allocSize,
      inUse: true,
      lastUsed: Date.now(),
      useCount: 1,
    };

    // Add to pool if under limit
    if (pool.length < limits.count * 2) {
      pool.push(entry);
    }

    this.stats.allocations++;
    this.stats.totalAllocated += allocSize;
    this.stats.peakAllocated = Math.max(this.stats.peakAllocated, this.stats.totalAllocated);

    return entry;
  }

  /**
   * Release buffer back to pool
   */
  release(entryId: string): void {
    for (const pool of this.pools.values()) {
      const entry = pool.find(e => e.id === entryId);
      if (entry) {
        entry.inUse = false;
        entry.lastUsed = Date.now();
        this.stats.deallocations++;
        return;
      }
    }
  }

  /**
   * Get buffer by ID
   */
  get(entryId: string): PoolEntry | undefined {
    for (const pool of this.pools.values()) {
      const entry = pool.find(e => e.id === entryId);
      if (entry) return entry;
    }
    return undefined;
  }

  /**
   * Garbage collect old entries
   */
  gc(maxAge: number = 30000): number {
    const now = Date.now();
    let freedBytes = 0;

    for (const [tier, pool] of this.pools) {
      const limits = this.tierLimits.get(tier)!;
      
      // Keep minimum entries, remove old unused ones
      const toRemove: number[] = [];
      
      for (let i = 0; i < pool.length; i++) {
        const entry = pool[i];
        if (!entry.inUse && now - entry.lastUsed > maxAge) {
          // Keep at least some buffers per tier
          const inUseCount = pool.filter(e => e.inUse).length;
          if (pool.length - toRemove.length > inUseCount + 2) {
            toRemove.push(i);
            freedBytes += entry.size;
          }
        }
      }

      // Remove in reverse order
      for (let i = toRemove.length - 1; i >= 0; i--) {
        pool.splice(toRemove[i], 1);
      }
    }

    this.stats.totalAllocated -= freedBytes;
    return freedBytes;
  }

  /**
   * Get pool statistics
   */
  getStats(): MemoryPoolStats[] {
    const result: MemoryPoolStats[] = [];

    for (const [tier, pool] of this.pools) {
      let totalSize = 0;
      let allocatedSize = 0;
      let availableSize = 0;

      for (const entry of pool) {
        totalSize += entry.size;
        if (entry.inUse) {
          allocatedSize += entry.size;
        } else {
          availableSize += entry.size;
        }
      }

      result.push({
        tier,
        totalSize,
        allocatedSize,
        availableSize,
        bufferCount: pool.length,
        hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
        missRate: this.stats.misses / (this.stats.hits + this.stats.misses) || 0,
        fragmentationRatio: this.calculateFragmentation(pool),
      });
    }

    return result;
  }

  /**
   * Calculate fragmentation
   */
  private calculateFragmentation(pool: PoolEntry[]): number {
    if (pool.length < 2) return 0;

    let totalFree = 0;
    let largestFree = 0;

    for (const entry of pool) {
      if (!entry.inUse) {
        totalFree += entry.size;
        largestFree = Math.max(largestFree, entry.size);
      }
    }

    if (totalFree === 0) return 0;
    return 1 - (largestFree / totalFree);
  }

  /**
   * Get total allocated bytes
   */
  getTotalAllocated(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      for (const entry of pool) {
        if (entry.inUse) {
          total += entry.size;
        }
      }
    }
    return total;
  }

  /**
   * Get total pooled bytes
   */
  getTotalPooled(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      for (const entry of pool) {
        total += entry.size;
      }
    }
    return total;
  }

  /**
   * Clear all pools
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      pool.length = 0;
    }
    this.stats.totalAllocated = 0;
  }

  private roundToPowerOf2(n: number): number {
    let power = 64 * KB;  // Minimum 64KB
    while (power < n) {
      power *= 2;
    }
    return power;
  }
}

// ============================================================================
// DYNAMIC CHUNK SIZER
// ============================================================================

class DynamicChunkSizer {
  private currentSize: number;
  private baseSize: number;
  private minSize: number;
  private maxSize: number;
  private multiplier: number;
  private divider: number;
  private history: number[] = [];
  private maxHistory = 20;

  constructor(
    baseSize: number,
    minSize: number = 64 * KB,
    maxSize: number = 16 * MB,
    multiplier: number = 1.25,
    divider: number = 2
  ) {
    this.baseSize = baseSize;
    this.currentSize = baseSize;
    this.minSize = minSize;
    this.maxSize = maxSize;
    this.multiplier = multiplier;
    this.divider = divider;
  }

  /**
   * Adjust based on memory pressure
   */
  adjust(pressure: MemoryPressure): number {
    const oldSize = this.currentSize;

    switch (pressure) {
      case 'critical':
        // Emergency reduction
        this.currentSize = Math.max(this.minSize, Math.floor(this.currentSize / 4));
        break;

      case 'high':
        // Reduce chunk size
        this.currentSize = Math.max(this.minSize, Math.floor(this.currentSize / this.divider));
        break;

      case 'medium':
        // Slight reduction
        this.currentSize = Math.max(this.minSize, Math.floor(this.currentSize * 0.9));
        break;

      case 'low':
        // Can increase if stable
        if (this.isStable()) {
          this.currentSize = Math.min(this.maxSize, Math.floor(this.currentSize * this.multiplier));
        }
        break;
    }

    this.history.push(this.currentSize);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (oldSize !== this.currentSize) {
      console.log(`[Memory] Chunk size adjusted: ${oldSize} -> ${this.currentSize} (pressure: ${pressure})`);
    }

    return this.currentSize;
  }

  /**
   * Check if size has been stable
   */
  private isStable(): boolean {
    if (this.history.length < 5) return false;

    const recent = this.history.slice(-5);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    // Consider stable if standard deviation is less than 10% of average
    return stdDev < avg * 0.1;
  }

  /**
   * Get current chunk size
   */
  getSize(): number {
    return this.currentSize;
  }

  /**
   * Get micro chunk size (emergency)
   */
  getMicroSize(): number {
    return this.minSize;
  }

  /**
   * Reset to base size
   */
  reset(): void {
    this.currentSize = this.baseSize;
    this.history = [];
  }

  /**
   * Get history
   */
  getHistory(): number[] {
    return [...this.history];
  }
}

// ============================================================================
// STREAM BUFFER
// ============================================================================

class StreamBuffer {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;
  private maxCombineSize: number;
  private streamOnly: boolean;

  constructor(maxCombineSize: number, streamOnly: boolean) {
    this.maxCombineSize = maxCombineSize;
    this.streamOnly = streamOnly;
  }

  /**
   * Append data
   */
  append(data: Uint8Array): void {
    this.chunks.push(data);
    this.totalSize += data.byteLength;
  }

  /**
   * Get combined data (only if small enough)
   */
  getCombined(): Uint8Array | null {
    if (this.streamOnly || this.totalSize > this.maxCombineSize) {
      return null;
    }

    const result = new Uint8Array(this.totalSize);
    let offset = 0;
    
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  }

  /**
   * Get as Blob (for large data)
   */
  getBlob(mimeType: string = 'application/octet-stream'): Blob {
    return new Blob(this.chunks as BlobPart[], { type: mimeType });
  }

  /**
   * Get iterator for streaming
   */
  *stream(): Generator<Uint8Array> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }

  /**
   * Get total size
   */
  getSize(): number {
    return this.totalSize;
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.chunks = [];
    this.totalSize = 0;
  }
}

// ============================================================================
// MEMORY OPTIMIZER
// ============================================================================

export class MemoryOptimizer {
  private config: MemoryOptimizationConfig;
  private pool: TieredBufferPool;
  private chunkSizer: DynamicChunkSizer;
  private streamBuffers: Map<string, StreamBuffer> = new Map();
  private gcTimer: number | null = null;
  private lastGcTime = 0;
  private gcInterval = 5000;
  
  private stats: MemoryOptimizationStats = {
    totalAllocated: 0,
    totalAvailable: 0,
    peakUsage: 0,
    currentUsage: 0,
    pressure: 'low',
    gcCycles: 0,
    poolStats: [],
    chunkSizeHistory: [],
    allocationRate: 0,
    deallocationRate: 0,
  };

  private allocationHistory: number[] = [];
  private deallocationHistory: number[] = [];

  constructor(config: Partial<MemoryOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.pool = new TieredBufferPool(this.config.poolTiers);
    this.chunkSizer = new DynamicChunkSizer(
      4 * MB,  // Base chunk size
      64 * KB,  // Min
      16 * MB,  // Max
      this.config.chunkSizeMultiplier,
      this.config.chunkSizeDivider
    );
  }

  /**
   * Initialize optimizer
   */
  initialize(): void {
    // Start GC timer
    this.startGcTimer();
  }

  /**
   * Start automatic GC
   */
  private startGcTimer(): void {
    if (this.gcTimer) return;

    this.gcTimer = window.setInterval(() => {
      this.checkAndGc();
    }, this.gcInterval);
  }

  /**
   * Stop GC timer
   */
  stopGcTimer(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /**
   * Check memory and GC if needed
   */
  private checkAndGc(): void {
    const pressure = this.calculatePressure();
    this.stats.pressure = pressure;

    if (pressure === 'high' || pressure === 'critical') {
      this.gc();
    }

    // Adjust chunk size based on pressure
    if (this.config.dynamicChunkSizing) {
      const newSize = this.chunkSizer.adjust(pressure);
      this.stats.chunkSizeHistory = this.chunkSizer.getHistory();
    }
  }

  /**
   * Calculate memory pressure
   */
  private calculatePressure(): MemoryPressure {
    const usage = this.getMemoryUsage();
    const ratio = usage / MEMORY_LIMITS.hard;

    if (ratio >= 0.9) return 'critical';
    if (ratio >= this.config.memoryHighThreshold) return 'high';
    if (ratio >= 0.5) return 'medium';
    return 'low';
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    // Try to get actual JS heap usage
    // @ts-expect-error - Chrome-specific API
    if (performance.memory) {
      // @ts-expect-error
      return performance.memory.usedJSHeapSize;
    }

    // Fallback to tracked allocations
    return this.pool.getTotalAllocated();
  }

  /**
   * Acquire buffer from pool
   */
  acquireBuffer(size: number): { id: string; buffer: ArrayBuffer; view: Uint8Array } {
    const entry = this.pool.acquire(size);
    
    this.allocationHistory.push(size);
    if (this.allocationHistory.length > 100) {
      this.allocationHistory.shift();
    }

    this.updateStats();

    return {
      id: entry.id,
      buffer: entry.buffer,
      view: entry.view.subarray(0, size),
    };
  }

  /**
   * Release buffer back to pool
   */
  releaseBuffer(id: string): void {
    const entry = this.pool.get(id);
    if (entry) {
      this.deallocationHistory.push(entry.size);
      if (this.deallocationHistory.length > 100) {
        this.deallocationHistory.shift();
      }
    }

    this.pool.release(id);
    this.updateStats();
  }

  /**
   * Get optimal chunk size
   */
  getOptimalChunkSize(): number {
    const pressure = this.calculatePressure();
    
    if (pressure === 'critical') {
      return this.chunkSizer.getMicroSize();
    }

    return this.chunkSizer.getSize();
  }

  /**
   * Create stream buffer
   */
  createStreamBuffer(id: string): void {
    this.streamBuffers.set(id, new StreamBuffer(
      this.config.maxCombineSize,
      this.config.streamAppendOnly
    ));
  }

  /**
   * Append to stream buffer
   */
  appendToStream(id: string, data: Uint8Array): void {
    const buffer = this.streamBuffers.get(id);
    if (!buffer) {
      throw new Error(`Stream buffer not found: ${id}`);
    }
    buffer.append(data);
  }

  /**
   * Get stream as Blob
   */
  getStreamBlob(id: string): Blob | null {
    const buffer = this.streamBuffers.get(id);
    if (!buffer) return null;
    return buffer.getBlob();
  }

  /**
   * Get stream iterator
   */
  getStreamIterator(id: string): Generator<Uint8Array> | null {
    const buffer = this.streamBuffers.get(id);
    if (!buffer) return null;
    return buffer.stream();
  }

  /**
   * Close stream buffer
   */
  closeStream(id: string): void {
    const buffer = this.streamBuffers.get(id);
    if (buffer) {
      buffer.clear();
      this.streamBuffers.delete(id);
    }
  }

  /**
   * Force garbage collection
   */
  gc(): number {
    const startTime = performance.now();
    
    // GC pool
    const freedFromPool = this.pool.gc();
    
    // Clear old streams
    for (const [id, buffer] of this.streamBuffers) {
      if (buffer.getSize() === 0) {
        this.streamBuffers.delete(id);
      }
    }

    this.stats.gcCycles++;
    this.lastGcTime = performance.now() - startTime;
    this.updateStats();

    console.log(`[Memory] GC completed: freed ${(freedFromPool / MB).toFixed(2)}MB in ${this.lastGcTime.toFixed(2)}ms`);
    
    return freedFromPool;
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const poolStats = this.pool.getStats();
    
    this.stats.poolStats = poolStats;
    this.stats.totalAllocated = this.pool.getTotalAllocated();
    this.stats.totalAvailable = this.pool.getTotalPooled() - this.stats.totalAllocated;
    this.stats.currentUsage = this.getMemoryUsage();
    this.stats.peakUsage = Math.max(this.stats.peakUsage, this.stats.currentUsage);
    
    // Calculate rates
    const recentAlloc = this.allocationHistory.slice(-10);
    const recentDealloc = this.deallocationHistory.slice(-10);
    
    this.stats.allocationRate = recentAlloc.reduce((a, b) => a + b, 0) / Math.max(1, recentAlloc.length);
    this.stats.deallocationRate = recentDealloc.reduce((a, b) => a + b, 0) / Math.max(1, recentDealloc.length);
  }

  /**
   * Get statistics
   */
  getStats(): MemoryOptimizationStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get memory pressure
   */
  getPressure(): MemoryPressure {
    return this.calculatePressure();
  }

  /**
   * Check if can allocate
   */
  canAllocate(size: number): boolean {
    const pressure = this.calculatePressure();
    
    if (pressure === 'critical') {
      return size <= this.chunkSizer.getMicroSize();
    }
    
    if (pressure === 'high') {
      return size <= this.chunkSizer.getSize() / 2;
    }

    return true;
  }

  /**
   * Request memory allocation approval
   */
  requestAllocation(size: number): { approved: boolean; recommendedSize: number } {
    const pressure = this.calculatePressure();
    
    if (pressure === 'critical') {
      return {
        approved: size <= this.chunkSizer.getMicroSize(),
        recommendedSize: this.chunkSizer.getMicroSize(),
      };
    }
    
    if (pressure === 'high') {
      const recommended = Math.min(size, this.chunkSizer.getSize());
      return {
        approved: size <= recommended,
        recommendedSize: recommended,
      };
    }

    return {
      approved: true,
      recommendedSize: size,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryOptimizationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryOptimizationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset optimizer
   */
  reset(): void {
    this.pool.clear();
    this.chunkSizer.reset();
    this.streamBuffers.clear();
    this.allocationHistory = [];
    this.deallocationHistory = [];
    
    this.stats = {
      totalAllocated: 0,
      totalAvailable: 0,
      peakUsage: 0,
      currentUsage: 0,
      pressure: 'low',
      gcCycles: 0,
      poolStats: [],
      chunkSizeHistory: [],
      allocationRate: 0,
      deallocationRate: 0,
    };
  }

  /**
   * Destroy optimizer
   */
  destroy(): void {
    this.stopGcTimer();
    this.reset();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let memoryOptimizerInstance: MemoryOptimizer | null = null;

export function getMemoryOptimizer(config?: Partial<MemoryOptimizationConfig>): MemoryOptimizer {
  if (!memoryOptimizerInstance) {
    memoryOptimizerInstance = new MemoryOptimizer(config);
    memoryOptimizerInstance.initialize();
  }
  return memoryOptimizerInstance;
}

export function resetMemoryOptimizer(): void {
  if (memoryOptimizerInstance) {
    memoryOptimizerInstance.destroy();
  }
  memoryOptimizerInstance = null;
}
