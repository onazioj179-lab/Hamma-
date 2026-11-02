/**
 * Zero-Copy Buffer Pool
 * Reusable buffer management to minimize allocations
 */

import type { BufferPool } from './types';

// Buffer entry with metadata
interface BufferEntry {
  id: number;
  buffer: ArrayBuffer;
  view: Uint8Array;
  inUse: boolean;
  lastUsed: number;
  reuseCount: number;
}

export class ZeroCopyBufferPool {
  private buffers: Map<number, BufferEntry> = new Map();
  private freeList: number[] = [];
  private nextId = 0;
  private totalSize = 0;
  private maxSize: number;
  private defaultBufferSize: number;
  private reuseCount = 0;

  constructor(maxPoolSize: number, defaultBufferSize: number = 64 * 1024 * 1024) {
    this.maxSize = maxPoolSize;
    this.defaultBufferSize = defaultBufferSize;
    
    // Pre-allocate initial buffers
    const initialBuffers = Math.min(4, Math.floor(maxPoolSize / defaultBufferSize));
    for (let i = 0; i < initialBuffers; i++) {
      this.createBuffer(defaultBufferSize);
    }
  }

  private createBuffer(size: number): BufferEntry | null {
    // Check if we have room
    if (this.totalSize + size > this.maxSize) {
      // Try to free old buffers
      this.compact();
      if (this.totalSize + size > this.maxSize) {
        return null;
      }
    }

    const id = this.nextId++;
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    
    const entry: BufferEntry = {
      id,
      buffer,
      view,
      inUse: false,
      lastUsed: Date.now(),
      reuseCount: 0,
    };

    this.buffers.set(id, entry);
    this.freeList.push(id);
    this.totalSize += size;

    return entry;
  }

  /**
   * Acquire a buffer of at least the specified size
   * Returns a view that can be used directly
   */
  acquire(minSize: number): { id: number; view: Uint8Array } | null {
    // Find a suitable free buffer
    for (let i = 0; i < this.freeList.length; i++) {
      const id = this.freeList[i];
      const entry = this.buffers.get(id);
      
      if (entry && entry.buffer.byteLength >= minSize) {
        // Remove from free list
        this.freeList.splice(i, 1);
        entry.inUse = true;
        entry.lastUsed = Date.now();
        entry.reuseCount++;
        this.reuseCount++;
        
        // Return a view of the exact size needed
        return {
          id,
          view: new Uint8Array(entry.buffer, 0, minSize),
        };
      }
    }

    // No suitable buffer found, create new one
    const size = Math.max(minSize, this.defaultBufferSize);
    const entry = this.createBuffer(size);
    
    if (!entry) {
      return null;
    }

    entry.inUse = true;
    this.freeList.pop(); // Remove from free list since we just added it
    
    return {
      id: entry.id,
      view: new Uint8Array(entry.buffer, 0, minSize),
    };
  }

  /**
   * Release a buffer back to the pool
   */
  release(id: number): void {
    const entry = this.buffers.get(id);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
      this.freeList.push(id);
    }
  }

  /**
   * Get a direct reference to the underlying ArrayBuffer
   * Use with caution - for zero-copy transfers
   */
  getBuffer(id: number): ArrayBuffer | null {
    return this.buffers.get(id)?.buffer ?? null;
  }

  /**
   * Transfer buffer ownership (for postMessage with transferables)
   * The buffer is removed from the pool
   */
  transfer(id: number): ArrayBuffer | null {
    const entry = this.buffers.get(id);
    if (!entry) return null;

    // Remove from pool
    this.buffers.delete(id);
    this.totalSize -= entry.buffer.byteLength;
    
    // Remove from free list if present
    const freeIndex = this.freeList.indexOf(id);
    if (freeIndex >= 0) {
      this.freeList.splice(freeIndex, 1);
    }

    return entry.buffer;
  }

  /**
   * Import a buffer into the pool (e.g., from transferables)
   */
  import(buffer: ArrayBuffer): number {
    const id = this.nextId++;
    const entry: BufferEntry = {
      id,
      buffer,
      view: new Uint8Array(buffer),
      inUse: false,
      lastUsed: Date.now(),
      reuseCount: 0,
    };

    this.buffers.set(id, entry);
    this.freeList.push(id);
    this.totalSize += buffer.byteLength;

    return id;
  }

  /**
   * Compact the pool by removing old, unused buffers
   */
  compact(): void {
    const now = Date.now();
    const maxAge = 30000; // 30 seconds

    // Remove old unused buffers
    for (const id of [...this.freeList]) {
      const entry = this.buffers.get(id);
      if (entry && now - entry.lastUsed > maxAge) {
        this.buffers.delete(id);
        this.totalSize -= entry.buffer.byteLength;
        const index = this.freeList.indexOf(id);
        if (index >= 0) {
          this.freeList.splice(index, 1);
        }
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): BufferPool {
    let usedSize = 0;
    let activeBuffers = 0;

    for (const entry of this.buffers.values()) {
      if (entry.inUse) {
        usedSize += entry.buffer.byteLength;
        activeBuffers++;
      }
    }

    return {
      totalSize: this.totalSize,
      usedSize,
      freeBuffers: this.freeList.length,
      activeBuffers,
      reusedCount: this.reuseCount,
    };
  }

  /**
   * Clear all buffers
   */
  clear(): void {
    this.buffers.clear();
    this.freeList = [];
    this.totalSize = 0;
    this.reuseCount = 0;
  }

  /**
   * Get total pool size
   */
  get size(): number {
    return this.totalSize;
  }

  /**
   * Get available space
   */
  get available(): number {
    return this.maxSize - this.totalSize;
  }
}

// Singleton pool instance
let globalPool: ZeroCopyBufferPool | null = null;

export function getBufferPool(maxSize?: number): ZeroCopyBufferPool {
  if (!globalPool) {
    globalPool = new ZeroCopyBufferPool(maxSize ?? 512 * 1024 * 1024);
  }
  return globalPool;
}

export function resetBufferPool(): void {
  if (globalPool) {
    globalPool.clear();
    globalPool = null;
  }
}
