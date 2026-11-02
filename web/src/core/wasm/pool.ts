/**
 * SPK WASM Core - Memory Pool
 * 
 * Reusable memory allocation pool for WASM operations.
 * Eliminates per-chunk allocations and fragmentation.
 * 
 * @module core/wasm/pool
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface PoolStats {
  totalBlocks: number;
  freeBlocks: number;
  usedBlocks: number;
  blockSize: number;
  totalMemory: number;
  usedMemory: number;
  allocations: number;
  deallocations: number;
}

export interface PoolConfig {
  blockSize: number;
  blockCount: number;
  allowGrowth: boolean;
}

// ============================================================================
// Memory Pool Implementation
// ============================================================================

/**
 * Reusable memory pool for WASM pointer management.
 * Prevents fragmentation and eliminates per-chunk allocations.
 * 
 * @example
 * ```typescript
 * const pool = new MemoryPool(wasmMemory, 4 * 1024 * 1024); // 4MB blocks
 * 
 * const ptr = pool.alloc(1024 * 1024); // Allocate 1MB
 * pool.write(ptr, data);
 * const result = pool.read(ptr, 1024 * 1024);
 * pool.free(ptr); // Return to pool
 * ```
 */
export class MemoryPool {
  memory: WebAssembly.Memory;
  buffer: Uint8Array;
  pool: number[];
  blockSize: number;
  private nextPtr: number;
  private allocCount: number;
  private deallocCount: number;
  private config: PoolConfig;

  /**
   * Create a memory pool.
   * 
   * @param memory - WebAssembly.Memory instance
   * @param blockSize - Size of each block in bytes
   * @param initialBlocks - Number of blocks to pre-allocate
   */
  constructor(
    memory: WebAssembly.Memory,
    blockSize: number = 4 * 1024 * 1024,
    initialBlocks: number = 8
  ) {
    this.memory = memory;
    this.blockSize = blockSize;
    this.buffer = new Uint8Array(memory.buffer);
    this.pool = [];
    this.nextPtr = 0;
    this.allocCount = 0;
    this.deallocCount = 0;

    this.config = {
      blockSize,
      blockCount: initialBlocks,
      allowGrowth: true,
    };

    // Pre-allocate blocks
    this.initializePool(initialBlocks);
  }

  /**
   * Initialize pool with pre-allocated blocks.
   */
  private initializePool(count: number): void {
    console.log(`[MemoryPool] Initializing ${count} blocks of ${this.blockSize} bytes`);
    
    for (let i = 0; i < count; i++) {
      const ptr = this.nextPtr;
      this.pool.push(ptr);
      this.nextPtr += this.blockSize;
    }

    console.log(`[MemoryPool] Pool ready: ${this.pool.length} blocks, ${this.nextPtr} bytes reserved`);
  }

  /**
   * Allocate a memory block.
   * Returns pointer to the start of the block.
   * 
   * @param size - Size needed (must be <= blockSize)
   * @returns Pointer to allocated memory
   */
  alloc(size: number): number {
    if (size > this.blockSize) {
      throw new Error(
        `Allocation size ${size} exceeds block size ${this.blockSize}. ` +
        `Increase blockSize or split data into smaller chunks.`
      );
    }

    // Try to get a free block from pool
    const ptr = this.pool.pop();
    
    if (ptr !== undefined) {
      this.allocCount++;
      return ptr;
    }

    // Pool exhausted - grow if allowed
    if (this.config.allowGrowth) {
      const newPtr = this.growPool();
      this.allocCount++;
      return newPtr;
    }

    throw new Error(
      `Memory pool exhausted. ${this.allocCount} allocations, ${this.deallocCount} deallocations. ` +
      `Consider increasing initial block count or enabling growth.`
    );
  }

  /**
   * Free a memory block back to the pool.
   * 
   * @param ptr - Pointer to free
   */
  free(ptr: number): void {
    // Validate pointer is from this pool
    if (ptr < 0 || ptr >= this.nextPtr || ptr % this.blockSize !== 0) {
      console.warn(`[MemoryPool] Invalid pointer freed: ${ptr}`);
      return;
    }

    // Check for double-free
    if (this.pool.includes(ptr)) {
      console.warn(`[MemoryPool] Double-free detected: ${ptr}`);
      return;
    }

    this.pool.push(ptr);
    this.deallocCount++;
  }

  /**
   * Write data to allocated memory.
   * 
   * @param ptr - Pointer to write to
   * @param data - Data to write
   */
  write(ptr: number, data: Uint8Array): void {
    if (data.length > this.blockSize) {
      throw new Error(`Data size ${data.length} exceeds block size ${this.blockSize}`);
    }

    // Refresh buffer view (memory may have grown)
    this.refreshBuffer();

    // Write data
    this.buffer.set(data, ptr);
  }

  /**
   * Read data from memory.
   * 
   * @param ptr - Pointer to read from
   * @param length - Number of bytes to read
   * @returns Copy of the data
   */
  read(ptr: number, length: number): Uint8Array {
    if (length > this.blockSize) {
      throw new Error(`Read length ${length} exceeds block size ${this.blockSize}`);
    }

    // Refresh buffer view
    this.refreshBuffer();

    // Create copy
    const data = new Uint8Array(length);
    data.set(this.buffer.subarray(ptr, ptr + length));
    
    return data;
  }

  /**
   * Get a view into memory without copying.
   * WARNING: View becomes invalid if memory grows.
   * 
   * @param ptr - Pointer to view
   * @param length - Length of view
   * @returns Uint8Array view (not a copy)
   */
  view(ptr: number, length: number): Uint8Array {
    this.refreshBuffer();
    return this.buffer.subarray(ptr, ptr + length);
  }

  /**
   * Zero out a memory block.
   * 
   * @param ptr - Pointer to zero
   * @param length - Number of bytes to zero (default: blockSize)
   */
  zero(ptr: number, length: number = this.blockSize): void {
    this.refreshBuffer();
    this.buffer.fill(0, ptr, ptr + length);
  }

  /**
   * Grow the pool by one block.
   */
  private growPool(): number {
    const currentSize = this.memory.buffer.byteLength;
    const neededSize = this.nextPtr + this.blockSize;

    // Grow memory if needed
    if (neededSize > currentSize) {
      const pagesNeeded = Math.ceil((neededSize - currentSize) / 65536);
      
      try {
        this.memory.grow(pagesNeeded);
        console.log(`[MemoryPool] Grew memory by ${pagesNeeded} pages`);
      } catch (error) {
        throw new Error(`Failed to grow memory: ${error}`);
      }
      
      this.refreshBuffer();
    }

    const newPtr = this.nextPtr;
    this.nextPtr += this.blockSize;
    
    console.log(`[MemoryPool] Grew pool to ${this.nextPtr / this.blockSize} blocks`);
    
    return newPtr;
  }

  /**
   * Refresh buffer view after memory growth.
   */
  private refreshBuffer(): void {
    if (this.buffer.buffer !== this.memory.buffer) {
      this.buffer = new Uint8Array(this.memory.buffer);
    }
  }

  /**
   * Get pool statistics.
   */
  getStats(): PoolStats {
    return {
      totalBlocks: this.nextPtr / this.blockSize,
      freeBlocks: this.pool.length,
      usedBlocks: (this.nextPtr / this.blockSize) - this.pool.length,
      blockSize: this.blockSize,
      totalMemory: this.nextPtr,
      usedMemory: this.nextPtr - (this.pool.length * this.blockSize),
      allocations: this.allocCount,
      deallocations: this.deallocCount,
    };
  }

  /**
   * Check for memory leaks.
   * Returns true if all allocated blocks have been freed.
   */
  checkLeaks(): boolean {
    const stats = this.getStats();
    const leaked = stats.allocations - stats.deallocations;
    
    if (leaked > 0) {
      console.warn(
        `[MemoryPool] Possible leak: ${leaked} blocks not freed ` +
        `(${leaked * this.blockSize} bytes)`
      );
      return false;
    }
    
    return true;
  }

  /**
   * Reset pool to initial state.
   * WARNING: This invalidates all existing pointers.
   */
  reset(): void {
    this.pool = [];
    this.nextPtr = 0;
    this.allocCount = 0;
    this.deallocCount = 0;
    
    this.initializePool(this.config.blockCount);
  }

  /**
   * Get detailed pool state for debugging.
   */
  debug(): string {
    const stats = this.getStats();
    
    return [
      '=== Memory Pool Debug ===',
      `Block size: ${stats.blockSize} bytes (${(stats.blockSize / 1024 / 1024).toFixed(2)} MB)`,
      `Total blocks: ${stats.totalBlocks}`,
      `Free blocks: ${stats.freeBlocks}`,
      `Used blocks: ${stats.usedBlocks}`,
      `Total memory: ${stats.totalMemory} bytes (${(stats.totalMemory / 1024 / 1024).toFixed(2)} MB)`,
      `Used memory: ${stats.usedMemory} bytes (${(stats.usedMemory / 1024 / 1024).toFixed(2)} MB)`,
      `Allocations: ${stats.allocations}`,
      `Deallocations: ${stats.deallocations}`,
      `Leaked blocks: ${stats.allocations - stats.deallocations}`,
    ].join('\n');
  }
}

// ============================================================================
// Exports
// ============================================================================

export default MemoryPool;
