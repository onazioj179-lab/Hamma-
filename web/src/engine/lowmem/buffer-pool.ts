/**
 * SPK Hyper-Low-Memory Mode - Zero-Copy Buffer Pipeline
 * Creator: OJ Treasure Onazi
 * 
 * Section 3: Zero-Copy Buffer Pipeline
 * - TypedArray views instead of copies
 * - Transferable ownership between workers
 * - WASM linear memory pointer reuse
 * - Buffer pooling to minimize allocations
 */

import {
  KB, MB,
  type PooledBuffer,
  type BufferPoolConfig,
  DEFAULT_BUFFER_POOL_CONFIG,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';
import { getMemoryBudgetController } from './memory-budget';

// ============================================================================
// BUFFER POOL TYPES
// ============================================================================

export interface BufferStats {
  totalBuffers: number;
  inUseBuffers: number;
  availableBuffers: number;
  totalMemory: number;
  usedMemory: number;
  hitRate: number;
  missRate: number;
}

export interface BufferAcquisition {
  buffer: Uint8Array;
  pooled: boolean;
  view: boolean;
  release: () => void;
}

// ============================================================================
// BUFFER POOL
// ============================================================================

export class ZeroCopyBufferPool {
  private pools: Map<number, PooledBuffer[]> = new Map();
  private inUse: Map<number, PooledBuffer[]> = new Map();
  private config: BufferPoolConfig;
  private memoryController = getMemoryBudgetController();
  private eventHandlers: LowMemEventHandler[] = [];
  
  // Stats
  private hits = 0;
  private misses = 0;
  private totalAllocations = 0;
  
  // Standard pool sizes (powers of 2 for efficiency)
  private readonly POOL_SIZES = [
    64 * KB,    // nano chunk
    128 * KB,   // micro chunk
    256 * KB,   // small chunk
    512 * KB,
    1 * MB,     // normal chunk
    2 * MB,
    4 * MB,     // large chunk
  ];

  constructor(config?: Partial<BufferPoolConfig>) {
    this.config = { ...DEFAULT_BUFFER_POOL_CONFIG, ...config };
    this.initializePools();
  }

  /**
   * Initialize buffer pools
   */
  private initializePools(): void {
    for (const size of this.POOL_SIZES) {
      this.pools.set(size, []);
      this.inUse.set(size, []);
    }
    
    // Pre-allocate some buffers if enabled
    if (this.config.preAllocate) {
      this.preAllocateBuffers();
    }
  }

  /**
   * Pre-allocate commonly used buffer sizes
   */
  private preAllocateBuffers(): void {
    const commonSizes = [64 * KB, 128 * KB, 256 * KB];
    const buffersPerSize = 2;
    
    for (const size of commonSizes) {
      const pool = this.pools.get(size)!;
      
      for (let i = 0; i < buffersPerSize; i++) {
        const result = this.memoryController.allocate({
          id: `pool_preallocate_${size}_${i}`,
          bytes: size,
          purpose: 'buffer',
          priority: 'low',
        });
        
        if (result.success) {
          pool.push({
            data: new Uint8Array(size),
            size,
            inUse: false,
            lastUsed: Date.now(),
            useCount: 0,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Acquire a buffer from the pool
   */
  acquire(requestedSize: number): BufferAcquisition {
    this.totalAllocations++;
    
    // Find best fitting pool size
    const poolSize = this.findPoolSize(requestedSize);
    
    // Try to get from pool
    const pool = this.pools.get(poolSize);
    if (pool && pool.length > 0) {
      const buffer = pool.pop()!;
      buffer.inUse = true;
      buffer.lastUsed = Date.now();
      buffer.useCount++;
      
      // Track in use
      this.inUse.get(poolSize)?.push(buffer);
      
      this.hits++;
      this.emit({ type: 'buffer-acquired', size: poolSize, pooled: true });
      
      return {
        buffer: buffer.data.subarray(0, requestedSize),
        pooled: true,
        view: true,
        release: () => this.releaseInternal(buffer, poolSize),
      };
    }
    
    // No buffer available, allocate new
    this.misses++;
    
    // Check memory budget
    const allocResult = this.memoryController.allocate({
      id: `pool_new_${poolSize}_${Date.now()}`,
      bytes: poolSize,
      purpose: 'buffer',
      priority: 'normal',
    });
    
    if (!allocResult.success) {
      // Try to evict old buffers
      this.evictOldBuffers();
      
      // Retry
      const retryResult = this.memoryController.allocate({
        id: `pool_retry_${poolSize}_${Date.now()}`,
        bytes: poolSize,
        purpose: 'buffer',
        priority: 'normal',
      });
      
      if (!retryResult.success) {
        // Return a smaller buffer or throw
        const smallerSize = this.findSmallerPoolSize(poolSize);
        if (smallerSize !== null) {
          return this.acquire(smallerSize);
        }
        throw new Error(`Failed to acquire buffer of size ${requestedSize}`);
      }
    }
    
    // Create new buffer
    const newBuffer: PooledBuffer = {
      data: new Uint8Array(poolSize),
      size: poolSize,
      inUse: true,
      lastUsed: Date.now(),
      useCount: 1,
    };
    
    this.inUse.get(poolSize)?.push(newBuffer);
    this.emit({ type: 'buffer-acquired', size: poolSize, pooled: false });
    
    return {
      buffer: newBuffer.data.subarray(0, requestedSize),
      pooled: false,
      view: true,
      release: () => this.releaseInternal(newBuffer, poolSize),
    };
  }

  /**
   * Release buffer back to pool
   */
  private releaseInternal(buffer: PooledBuffer, poolSize: number): void {
    buffer.inUse = false;
    buffer.lastUsed = Date.now();
    
    // Remove from in-use
    const inUseList = this.inUse.get(poolSize);
    if (inUseList) {
      const idx = inUseList.indexOf(buffer);
      if (idx >= 0) inUseList.splice(idx, 1);
    }
    
    // Add back to pool
    const pool = this.pools.get(poolSize);
    if (pool) {
      // Check if pool is at max
      if (pool.length < this.config.maxPoolSize) {
        pool.push(buffer);
        this.emit({ type: 'buffer-released', size: poolSize });
      } else {
        // Let buffer be garbage collected
        this.memoryController.releaseBytes(poolSize);
      }
    }
  }

  /**
   * Create a zero-copy view of existing buffer
   */
  createView(
    source: Uint8Array,
    offset: number = 0,
    length?: number
  ): Uint8Array {
    const actualLength = length ?? (source.length - offset);
    
    // Return subarray (zero-copy view)
    return source.subarray(offset, offset + actualLength);
  }

  /**
   * Create transferable for worker messaging
   */
  createTransferable(data: Uint8Array): {
    buffer: ArrayBuffer;
    transfer: ArrayBuffer[];
  } {
    // If already backed by an ArrayBuffer we can transfer, use it
    if (data.buffer.byteLength === data.byteLength && data.byteOffset === 0) {
      const buf = data.buffer as ArrayBuffer;
      return {
        buffer: buf,
        transfer: [buf],
      };
    }
    
    // Otherwise, need to copy to a new ArrayBuffer
    const copy = new ArrayBuffer(data.byteLength);
    new Uint8Array(copy).set(data);
    
    return {
      buffer: copy,
      transfer: [copy],
    };
  }

  /**
   * Wrap WASM linear memory pointer as TypedArray
   */
  wrapWasmPointer(
    wasmMemory: WebAssembly.Memory,
    pointer: number,
    length: number
  ): Uint8Array {
    return new Uint8Array(wasmMemory.buffer, pointer, length);
  }

  // ---------------------------------------------------------------------------
  // POOL MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Find best pool size for requested size
   */
  private findPoolSize(requestedSize: number): number {
    for (const size of this.POOL_SIZES) {
      if (size >= requestedSize) return size;
    }
    // Larger than any pool, round up to nearest MB
    return Math.ceil(requestedSize / MB) * MB;
  }

  /**
   * Find smaller pool size
   */
  private findSmallerPoolSize(currentSize: number): number | null {
    for (let i = this.POOL_SIZES.length - 1; i >= 0; i--) {
      if (this.POOL_SIZES[i] < currentSize) {
        return this.POOL_SIZES[i];
      }
    }
    return null;
  }

  /**
   * Evict old unused buffers
   */
  private evictOldBuffers(): number {
    let evicted = 0;
    const now = Date.now();
    const maxAge = 30000; // 30 seconds
    
    for (const [size, pool] of this.pools) {
      const toKeep: PooledBuffer[] = [];
      
      for (const buffer of pool) {
        if (now - buffer.lastUsed > maxAge) {
          // Evict
          this.memoryController.releaseBytes(size);
          evicted += size;
        } else {
          toKeep.push(buffer);
        }
      }
      
      this.pools.set(size, toKeep);
    }
    
    if (evicted > 0) {
      this.emit({ type: 'pool-eviction', evictedBytes: evicted });
    }
    
    return evicted;
  }

  /**
   * Shrink pools to minimum
   */
  shrink(): number {
    let freed = 0;
    
    for (const [size, pool] of this.pools) {
      // Keep only 1 buffer per size
      while (pool.length > 1) {
        pool.pop();
        this.memoryController.releaseBytes(size);
        freed += size;
      }
    }
    
    this.emit({ type: 'pool-shrink', freedBytes: freed });
    return freed;
  }

  /**
   * Clear all pools
   */
  clear(): void {
    let totalFreed = 0;
    
    for (const [size, pool] of this.pools) {
      totalFreed += pool.length * size;
      pool.length = 0;
    }
    
    for (const [size, inUse] of this.inUse) {
      // Can't clear in-use, but track
      if (inUse.length > 0) {
        console.warn(`[BufferPool] ${inUse.length} buffers still in use at size ${size}`);
      }
    }
    
    this.memoryController.forceReleaseByPurpose('pool');
    this.emit({ type: 'pool-clear', totalBytes: totalFreed });
  }

  // ---------------------------------------------------------------------------
  // STATS
  // ---------------------------------------------------------------------------

  /**
   * Get pool statistics
   */
  getStats(): BufferStats {
    let totalBuffers = 0;
    let inUseBuffers = 0;
    let totalMemory = 0;
    let usedMemory = 0;
    
    for (const [size, pool] of this.pools) {
      totalBuffers += pool.length;
      totalMemory += pool.length * size;
    }
    
    for (const [size, inUse] of this.inUse) {
      inUseBuffers += inUse.length;
      usedMemory += inUse.length * size;
    }
    
    totalBuffers += inUseBuffers;
    totalMemory += usedMemory;
    
    const totalRequests = this.hits + this.misses;
    
    return {
      totalBuffers,
      inUseBuffers,
      availableBuffers: totalBuffers - inUseBuffers,
      totalMemory,
      usedMemory,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      missRate: totalRequests > 0 ? this.misses / totalRequests : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.totalAllocations = 0;
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
        console.error('[ZeroCopyBufferPool] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// ZERO-COPY UTILITIES
// ============================================================================

/**
 * Concatenate multiple TypedArrays without intermediate copies
 */
export function concatTypedArrays(
  arrays: Uint8Array[],
  pool?: ZeroCopyBufferPool
): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0);
  
  let result: Uint8Array;
  if (pool) {
    const acquisition = pool.acquire(totalLength);
    result = acquisition.buffer;
  } else {
    result = new Uint8Array(totalLength);
  }
  
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  
  return result;
}

/**
 * Split TypedArray into chunks (zero-copy views)
 */
export function* splitIntoViews(
  data: Uint8Array,
  chunkSize: number
): Generator<Uint8Array> {
  let offset = 0;
  
  while (offset < data.byteLength) {
    const end = Math.min(offset + chunkSize, data.byteLength);
    yield data.subarray(offset, end);
    offset = end;
  }
}

/**
 * Create SharedArrayBuffer for multi-worker access
 */
export function createSharedBuffer(size: number): SharedArrayBuffer | null {
  try {
    if (typeof SharedArrayBuffer !== 'undefined') {
      return new SharedArrayBuffer(size);
    }
  } catch {
    // SharedArrayBuffer not available
  }
  return null;
}

/**
 * Check if transferable is available
 */
export function supportsTransferable(): boolean {
  try {
    const buffer = new ArrayBuffer(1);
    const channel = new MessageChannel();
    channel.port1.postMessage(buffer, [buffer]);
    return buffer.byteLength === 0; // Transferred = detached
  } catch {
    return false;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let poolInstance: ZeroCopyBufferPool | null = null;

export function getBufferPool(config?: Partial<BufferPoolConfig>): ZeroCopyBufferPool {
  if (!poolInstance) {
    poolInstance = new ZeroCopyBufferPool(config);
  }
  return poolInstance;
}

export function resetBufferPool(): void {
  poolInstance?.clear();
  poolInstance = null;
}
