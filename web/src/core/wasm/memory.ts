/**
 * SPK Implementation Blueprint - WASM Memory Management
 * 
 * Manages WebAssembly memory buffers for compression/decompression operations.
 * Provides pooled memory allocation to minimize GC pressure during large operations.
 * 
 * @module core/wasm/memory
 * @version 1.0.0
 */

// ============================================================================
// Constants
// ============================================================================

/** Default WASM memory page size (64KB) */
export const WASM_PAGE_SIZE = 65536;

/** Initial memory pages (16MB) */
export const INITIAL_PAGES = 256;

/** Maximum memory pages (4GB) */
export const MAX_PAGES = 65536;

/** Default chunk buffer size (4MB) */
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

/** Maximum pooled buffers */
export const MAX_POOL_SIZE = 32;

// ============================================================================
// Types
// ============================================================================

export interface MemoryStats {
  totalAllocated: number;
  pooledBuffers: number;
  activeBuffers: number;
  peakUsage: number;
  currentUsage: number;
}

export interface BufferHandle {
  id: string;
  ptr: number;
  size: number;
  inUse: boolean;
  createdAt: number;
}

export interface MemoryConfig {
  initialPages: number;
  maxPages: number;
  chunkSize: number;
  poolSize: number;
  growthFactor: number;
}

// ============================================================================
// Memory Pool
// ============================================================================

/**
 * Pooled buffer manager for WASM memory.
 * Reduces allocation overhead during streaming operations.
 */
export class WasmBufferPool {
  private pool: Map<string, BufferHandle> = new Map();
  private memory: WebAssembly.Memory | null = null;
  private nextId = 0;
  private stats: MemoryStats = {
    totalAllocated: 0,
    pooledBuffers: 0,
    activeBuffers: 0,
    peakUsage: 0,
    currentUsage: 0,
  };

  constructor(private config: MemoryConfig = {
    initialPages: INITIAL_PAGES,
    maxPages: MAX_PAGES,
    chunkSize: DEFAULT_CHUNK_SIZE,
    poolSize: MAX_POOL_SIZE,
    growthFactor: 1.5,
  }) {}

  /**
   * Initialize the WASM memory instance.
   */
  initialize(memory?: WebAssembly.Memory): void {
    this.memory = memory ?? new WebAssembly.Memory({
      initial: this.config.initialPages,
      maximum: this.config.maxPages,
      shared: true,
    });
  }

  /**
   * Get the underlying WebAssembly.Memory instance.
   */
  getMemory(): WebAssembly.Memory {
    if (!this.memory) {
      throw new Error('WASM memory not initialized');
    }
    return this.memory;
  }

  /**
   * Acquire a buffer from the pool or allocate a new one.
   */
  acquire(size: number = this.config.chunkSize): BufferHandle {
    // Try to find a pooled buffer of sufficient size
    for (const handle of this.pool.values()) {
      if (!handle.inUse && handle.size >= size) {
        handle.inUse = true;
        this.stats.activeBuffers++;
        this.stats.pooledBuffers--;
        this.stats.currentUsage += handle.size;
        this.updatePeakUsage();
        return handle;
      }
    }

    // Allocate new buffer
    return this.allocate(size);
  }

  /**
   * Release a buffer back to the pool.
   */
  release(handle: BufferHandle): void {
    const pooled = this.pool.get(handle.id);
    if (!pooled) {
      console.warn(`Buffer ${handle.id} not found in pool`);
      return;
    }

    pooled.inUse = false;
    this.stats.activeBuffers--;
    this.stats.pooledBuffers++;
    this.stats.currentUsage -= pooled.size;

    // Prune pool if too large
    if (this.stats.pooledBuffers > this.config.poolSize) {
      this.prunePool();
    }
  }

  /**
   * Allocate a new buffer in WASM memory.
   */
  private allocate(size: number): BufferHandle {
    if (!this.memory) {
      throw new Error('WASM memory not initialized');
    }

    const currentSize = this.memory.buffer.byteLength;
    const requiredSize = this.stats.totalAllocated + size;

    // Grow memory if needed
    if (requiredSize > currentSize) {
      const pagesNeeded = Math.ceil((requiredSize - currentSize) / WASM_PAGE_SIZE);
      const growPages = Math.ceil(pagesNeeded * this.config.growthFactor);
      
      try {
        this.memory.grow(growPages);
      } catch (error) {
        throw new Error(`Failed to grow WASM memory: ${error}`);
      }
    }

    const id = `buf_${++this.nextId}`;
    const ptr = this.stats.totalAllocated;
    
    const handle: BufferHandle = {
      id,
      ptr,
      size,
      inUse: true,
      createdAt: Date.now(),
    };

    this.pool.set(id, handle);
    this.stats.totalAllocated += size;
    this.stats.activeBuffers++;
    this.stats.currentUsage += size;
    this.updatePeakUsage();

    return handle;
  }

  /**
   * Get a view into a buffer's memory region.
   */
  getView(handle: BufferHandle): Uint8Array {
    if (!this.memory) {
      throw new Error('WASM memory not initialized');
    }
    return new Uint8Array(this.memory.buffer, handle.ptr, handle.size);
  }

  /**
   * Copy data into a buffer.
   */
  write(handle: BufferHandle, data: Uint8Array, offset = 0): void {
    const view = this.getView(handle);
    if (data.length + offset > handle.size) {
      throw new Error(`Data exceeds buffer size: ${data.length + offset} > ${handle.size}`);
    }
    view.set(data, offset);
  }

  /**
   * Read data from a buffer.
   */
  read(handle: BufferHandle, length?: number, offset = 0): Uint8Array {
    const view = this.getView(handle);
    const readLength = length ?? handle.size - offset;
    return view.slice(offset, offset + readLength);
  }

  /**
   * Remove unused buffers from the pool.
   */
  private prunePool(): void {
    const now = Date.now();
    const maxAge = 30000; // 30 seconds
    const toRemove: string[] = [];

    for (const [id, handle] of this.pool) {
      if (!handle.inUse && now - handle.createdAt > maxAge) {
        toRemove.push(id);
      }
    }

    // Keep at least some buffers
    const removeCount = Math.min(toRemove.length, this.stats.pooledBuffers - 4);
    for (let i = 0; i < removeCount; i++) {
      this.pool.delete(toRemove[i]);
      this.stats.pooledBuffers--;
    }
  }

  /**
   * Update peak memory usage statistic.
   */
  private updatePeakUsage(): void {
    if (this.stats.currentUsage > this.stats.peakUsage) {
      this.stats.peakUsage = this.stats.currentUsage;
    }
  }

  /**
   * Get current memory statistics.
   */
  getStats(): MemoryStats {
    return { ...this.stats };
  }

  /**
   * Reset the memory pool.
   */
  reset(): void {
    this.pool.clear();
    this.stats = {
      totalAllocated: 0,
      pooledBuffers: 0,
      activeBuffers: 0,
      peakUsage: 0,
      currentUsage: 0,
    };
    this.nextId = 0;
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.reset();
    this.memory = null;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalPool: WasmBufferPool | null = null;

export function getBufferPool(): WasmBufferPool {
  if (!globalPool) {
    globalPool = new WasmBufferPool();
  }
  return globalPool;
}

export function initializeBufferPool(config?: Partial<MemoryConfig>): WasmBufferPool {
  globalPool = new WasmBufferPool({
    initialPages: config?.initialPages ?? INITIAL_PAGES,
    maxPages: config?.maxPages ?? MAX_PAGES,
    chunkSize: config?.chunkSize ?? DEFAULT_CHUNK_SIZE,
    poolSize: config?.poolSize ?? MAX_POOL_SIZE,
    growthFactor: config?.growthFactor ?? 1.5,
  });
  return globalPool;
}

// ============================================================================
// Exports
// ============================================================================

export default WasmBufferPool;
