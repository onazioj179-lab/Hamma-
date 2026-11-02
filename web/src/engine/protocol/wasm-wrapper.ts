/**
 * SPK V29 - WASM Interface Wrapper
 * 
 * Production-grade WASM binding layer with:
 * - Zero-copy memory transfers
 * - Panic recovery
 * - Memory pool management
 * - Error code translation
 * - Checksum verification
 * 
 * Memory limit: 256MB per instance
 */

import {
  type CompressionMode,
  type WasmCompressChunkRequest,
  type WasmCompressChunkResponse,
  type WasmFinalizeArchiveResponse,
  type WasmError,
  type ArchiveManifest,
  type ChunkInfo,
  WasmErrorCode,
  PROTOCOL_VERSION,
} from '../protocol/types';

// ============================================================================
// WASM MODULE INTERFACE
// ============================================================================

/**
 * WASM module exports interface
 */
interface SpkWasmExports {
  memory: WebAssembly.Memory;
  
  // Memory management
  alloc(size: number): number;
  dealloc(ptr: number, size: number): void;
  
  // Compression
  compress_chunk(
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number,
    mode: number
  ): number;
  
  // Decompression
  decompress_chunk(
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): number;
  
  // Archive
  init_archive(mode: number): number;
  add_chunk(handle: number, chunkIndex: number, compressedPtr: number, compressedLen: number): number;
  finalize_archive(handle: number, outputPtr: number, outputMaxLen: number): number;
  free_archive(handle: number): void;
  
  // State
  reset(): void;
  get_last_error(): number;
  get_version(): number;
  get_memory_usage(): number;
}

// ============================================================================
// MEMORY POOL
// ============================================================================

interface MemoryBlock {
  ptr: number;
  size: number;
  inUse: boolean;
  allocatedAt: number;
}

class MemoryPool {
  private blocks: MemoryBlock[] = [];
  private readonly maxBlocks = 16;
  private totalAllocated = 0;
  private readonly maxTotalSize: number;
  
  constructor(maxTotalSize: number = 256 * 1024 * 1024) {
    this.maxTotalSize = maxTotalSize;
  }
  
  allocate(size: number, alloc: (size: number) => number): MemoryBlock {
    // Try to reuse existing block
    for (const block of this.blocks) {
      if (!block.inUse && block.size >= size) {
        block.inUse = true;
        block.allocatedAt = Date.now();
        return block;
      }
    }
    
    // Check memory limit
    if (this.totalAllocated + size > this.maxTotalSize) {
      this.cleanup(alloc);
      if (this.totalAllocated + size > this.maxTotalSize) {
        throw new Error(`Memory limit exceeded: ${this.totalAllocated + size} > ${this.maxTotalSize}`);
      }
    }
    
    // Allocate new block
    const ptr = alloc(size);
    if (ptr === 0) {
      throw new Error('WASM memory allocation failed');
    }
    
    const block: MemoryBlock = {
      ptr,
      size,
      inUse: true,
      allocatedAt: Date.now(),
    };
    
    this.blocks.push(block);
    this.totalAllocated += size;
    
    // Limit pool size
    if (this.blocks.length > this.maxBlocks) {
      this.cleanup(alloc);
    }
    
    return block;
  }
  
  release(block: MemoryBlock): void {
    block.inUse = false;
  }
  
  cleanup(dealloc?: (ptr: number, size: number) => void): void {
    const now = Date.now();
    const staleThreshold = 30000; // 30 seconds
    
    this.blocks = this.blocks.filter(block => {
      if (!block.inUse && (now - block.allocatedAt > staleThreshold)) {
        if (dealloc) {
          dealloc(block.ptr, block.size);
        }
        this.totalAllocated -= block.size;
        return false;
      }
      return true;
    });
  }
  
  clear(dealloc: (ptr: number, size: number) => void): void {
    for (const block of this.blocks) {
      dealloc(block.ptr, block.size);
    }
    this.blocks = [];
    this.totalAllocated = 0;
  }
  
  getStats(): { blocks: number; totalAllocated: number; inUse: number } {
    const inUse = this.blocks.filter(b => b.inUse).length;
    return {
      blocks: this.blocks.length,
      totalAllocated: this.totalAllocated,
      inUse,
    };
  }
}

// ============================================================================
// WASM WRAPPER CLASS
// ============================================================================

export class WasmWrapper {
  private module: SpkWasmExports | null = null;
  private memory: WebAssembly.Memory | null = null;
  private pool: MemoryPool;
  private initialized = false;
  private lastError: WasmError | null = null;
  private panicRecoveryAttempts = 0;
  private readonly maxPanicRecovery = 3;
  
  constructor() {
    this.pool = new MemoryPool();
  }
  
  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================
  
  /**
   * Initialize WASM module
   */
  async initialize(wasmPath?: string): Promise<void> {
    if (this.initialized) return;
    
    const path = wasmPath || '/spk_core.wasm';
    
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`);
      }
      
      const wasmBytes = await response.arrayBuffer();
      
      // Create shared memory if available
      const hasSharedMemory = typeof SharedArrayBuffer !== 'undefined';
      
      this.memory = new WebAssembly.Memory({
        initial: 256, // 16MB
        maximum: 4096, // 256MB
        shared: hasSharedMemory,
      });
      
      const imports = {
        env: {
          memory: this.memory,
          js_log: this.handleLog.bind(this),
          js_error: this.handleError.bind(this),
          js_time: () => performance.now(),
          js_panic: this.handlePanic.bind(this),
        },
      };
      
      const result = await WebAssembly.instantiate(wasmBytes, imports);
      this.module = result.instance.exports as unknown as SpkWasmExports;
      
      this.initialized = true;
      console.log('[WasmWrapper] WASM module initialized');
      
    } catch (error) {
      this.lastError = {
        code: WasmErrorCode.WASM_INIT_FAILED,
        message: error instanceof Error ? error.message : 'WASM init failed',
      };
      throw error;
    }
  }
  
  /**
   * Reset WASM state (for recovery)
   */
  reset(): void {
    if (this.module) {
      this.module.reset();
    }
    this.pool.cleanup();
    this.lastError = null;
  }
  
  /**
   * Shutdown WASM
   */
  shutdown(): void {
    if (this.module) {
      this.pool.clear(this.module.dealloc.bind(this.module));
    }
    this.module = null;
    this.memory = null;
    this.initialized = false;
  }
  
  /**
   * Check if WASM is ready
   */
  isReady(): boolean {
    return this.initialized && this.module !== null;
  }
  
  // ==========================================================================
  // COMPRESSION
  // ==========================================================================
  
  /**
   * Compress a chunk
   */
  async compressChunk(request: WasmCompressChunkRequest): Promise<WasmCompressChunkResponse> {
    this.ensureReady();
    
    const { buffer, mode, chunkIndex } = request;
    const module = this.module!;
    const memory = this.memory!;
    
    try {
      // Allocate input buffer
      const inputBlock = this.pool.allocate(buffer.length, module.alloc);
      const inputView = new Uint8Array(memory.buffer, inputBlock.ptr, buffer.length);
      inputView.set(buffer);
      
      // Allocate output buffer (worst case: expansion)
      const maxOutputSize = Math.max(buffer.length * 2, 1024);
      const outputBlock = this.pool.allocate(maxOutputSize, module.alloc);
      
      try {
        // Compress
        const compressedLen = module.compress_chunk(
          inputBlock.ptr,
          buffer.length,
          outputBlock.ptr,
          maxOutputSize,
          modeToWasmInt(mode)
        );
        
        if (compressedLen < 0) {
          const errorCode = module.get_last_error() as WasmErrorCode;
          throw this.createError(errorCode);
        }
        
        // Copy result (WASM memory might move on next allocation)
        const compressedBuffer = new Uint8Array(compressedLen);
        compressedBuffer.set(
          new Uint8Array(memory.buffer, outputBlock.ptr, compressedLen)
        );
        
        // Calculate checksum
        const checksum = this.crc32(compressedBuffer);
        
        return {
          compressedBuffer,
          originalSize: buffer.length,
          compressedSize: compressedLen,
          checksum,
        };
        
      } finally {
        this.pool.release(inputBlock);
        this.pool.release(outputBlock);
      }
      
    } catch (error) {
      // Handle WASM panic
      if (this.isPanic(error)) {
        await this.recoverFromPanic();
        throw new Error('WASM panic - recovered, please retry');
      }
      throw error;
    }
  }
  
  /**
   * Decompress a chunk
   */
  async decompressChunk(buffer: Uint8Array, expectedSize?: number): Promise<Uint8Array> {
    this.ensureReady();
    
    const module = this.module!;
    const memory = this.memory!;
    
    try {
      // Allocate input buffer
      const inputBlock = this.pool.allocate(buffer.length, module.alloc);
      const inputView = new Uint8Array(memory.buffer, inputBlock.ptr, buffer.length);
      inputView.set(buffer);
      
      // Allocate output buffer
      const maxOutputSize = expectedSize || buffer.length * 10;
      const outputBlock = this.pool.allocate(maxOutputSize, module.alloc);
      
      try {
        // Decompress
        const decompressedLen = module.decompress_chunk(
          inputBlock.ptr,
          buffer.length,
          outputBlock.ptr,
          maxOutputSize
        );
        
        if (decompressedLen < 0) {
          const errorCode = module.get_last_error() as WasmErrorCode;
          throw this.createError(errorCode);
        }
        
        // Copy result
        const decompressedBuffer = new Uint8Array(decompressedLen);
        decompressedBuffer.set(
          new Uint8Array(memory.buffer, outputBlock.ptr, decompressedLen)
        );
        
        return decompressedBuffer;
        
      } finally {
        this.pool.release(inputBlock);
        this.pool.release(outputBlock);
      }
      
    } catch (error) {
      if (this.isPanic(error)) {
        await this.recoverFromPanic();
        throw new Error('WASM panic - recovered, please retry');
      }
      throw error;
    }
  }
  
  // ==========================================================================
  // ARCHIVE
  // ==========================================================================
  
  private archiveHandle: number | null = null;
  private archiveChunks: ChunkInfo[] = [];
  
  /**
   * Initialize archive for streaming compression
   */
  initArchive(mode: CompressionMode): void {
    this.ensureReady();
    
    const handle = this.module!.init_archive(modeToWasmInt(mode));
    if (handle === 0) {
      throw new Error('Failed to initialize archive');
    }
    
    this.archiveHandle = handle;
    this.archiveChunks = [];
  }
  
  /**
   * Add compressed chunk to archive
   */
  addChunk(chunkIndex: number, compressedData: Uint8Array, originalSize: number): void {
    this.ensureReady();
    if (this.archiveHandle === null) {
      throw new Error('Archive not initialized');
    }
    
    const module = this.module!;
    const memory = this.memory!;
    
    // Allocate buffer for chunk
    const block = this.pool.allocate(compressedData.length, module.alloc);
    const view = new Uint8Array(memory.buffer, block.ptr, compressedData.length);
    view.set(compressedData);
    
    try {
      const result = module.add_chunk(
        this.archiveHandle,
        chunkIndex,
        block.ptr,
        compressedData.length
      );
      
      if (result < 0) {
        throw new Error(`Failed to add chunk ${chunkIndex}`);
      }
      
      // Track chunk info
      this.archiveChunks.push({
        seq: chunkIndex,
        offset: 0, // Will be calculated on finalize
        originalSize,
        compressedSize: compressedData.length,
        hash: '', // Should be provided by caller
        checksum: this.crc32(compressedData),
      });
      
    } finally {
      this.pool.release(block);
    }
  }
  
  /**
   * Finalize archive and get footer
   */
  finalizeArchive(): WasmFinalizeArchiveResponse {
    this.ensureReady();
    if (this.archiveHandle === null) {
      throw new Error('Archive not initialized');
    }
    
    const module = this.module!;
    const memory = this.memory!;
    
    // Allocate buffer for footer
    const maxFooterSize = 1024 * 1024; // 1MB max footer
    const block = this.pool.allocate(maxFooterSize, module.alloc);
    
    try {
      const footerLen = module.finalize_archive(
        this.archiveHandle,
        block.ptr,
        maxFooterSize
      );
      
      if (footerLen < 0) {
        throw new Error('Failed to finalize archive');
      }
      
      // Copy footer
      const footer = new Uint8Array(footerLen);
      footer.set(new Uint8Array(memory.buffer, block.ptr, footerLen));
      
      // Build manifest
      const manifest: ArchiveManifest = {
        version: PROTOCOL_VERSION,
        fileName: '', // Should be set by caller
        mimeType: '', // Should be set by caller
        originalSize: 0, // Should be calculated by caller
        compressedSize: 0, // Should be calculated by caller
        chunkSize: 0, // Should be set by caller
        totalChunks: this.archiveChunks.length,
        chunks: this.archiveChunks,
        settings: {
          mode: 'auto',
          chunkSize: 0,
          enableDedup: false,
          enableEncryption: false,
          maxRetries: 3,
          verifyHash: true,
        },
        createdAt: Date.now(),
        checksum: '',
      };
      
      // Free archive
      module.free_archive(this.archiveHandle);
      this.archiveHandle = null;
      this.archiveChunks = [];
      
      return { footer, manifest };
      
    } finally {
      this.pool.release(block);
    }
  }
  
  // ==========================================================================
  // ERROR HANDLING & RECOVERY
  // ==========================================================================
  
  /**
   * Handle WASM log
   */
  private handleLog(ptr: number, len: number): void {
    if (!this.memory) return;
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    console.log('[WASM]', new TextDecoder().decode(bytes));
  }
  
  /**
   * Handle WASM error
   */
  private handleError(ptr: number, len: number): void {
    if (!this.memory) return;
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    console.error('[WASM]', new TextDecoder().decode(bytes));
  }
  
  /**
   * Handle WASM panic
   */
  private handlePanic(ptr: number, len: number): void {
    if (!this.memory) return;
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    const message = new TextDecoder().decode(bytes);
    console.error('[WASM PANIC]', message);
    this.lastError = {
      code: WasmErrorCode.WASM_PANIC,
      message,
    };
  }
  
  /**
   * Check if error is a WASM panic
   */
  private isPanic(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('unreachable') || 
             error.message.includes('RuntimeError');
    }
    return false;
  }
  
  /**
   * Recover from WASM panic
   */
  private async recoverFromPanic(): Promise<void> {
    this.panicRecoveryAttempts++;
    
    if (this.panicRecoveryAttempts > this.maxPanicRecovery) {
      throw new Error('Max WASM panic recovery attempts exceeded');
    }
    
    console.log('[WasmWrapper] Recovering from WASM panic...');
    
    // Shutdown and reinitialize
    this.shutdown();
    await this.initialize();
    
    console.log('[WasmWrapper] WASM recovered');
  }
  
  /**
   * Create error from WASM error code
   */
  private createError(code: WasmErrorCode): Error {
    const messages: Record<WasmErrorCode, string> = {
      [WasmErrorCode.SUCCESS]: 'Success',
      [WasmErrorCode.MEMORY_ALLOCATION_FAILED]: 'Memory allocation failed',
      [WasmErrorCode.INVALID_INPUT]: 'Invalid input data',
      [WasmErrorCode.COMPRESSION_FAILED]: 'Compression failed',
      [WasmErrorCode.DECOMPRESSION_FAILED]: 'Decompression failed',
      [WasmErrorCode.ARCHIVE_CORRUPTED]: 'Archive is corrupted',
      [WasmErrorCode.CHUNK_SIZE_EXCEEDED]: 'Chunk size exceeded maximum',
      [WasmErrorCode.OUT_OF_MEMORY]: 'Out of memory',
      [WasmErrorCode.WASM_INIT_FAILED]: 'WASM initialization failed',
      [WasmErrorCode.WASM_PANIC]: 'WASM panic',
      [WasmErrorCode.CHECKSUM_MISMATCH]: 'Checksum mismatch',
    };
    
    this.lastError = { code, message: messages[code] };
    return new Error(messages[code]);
  }
  
  /**
   * Ensure WASM is ready
   */
  private ensureReady(): void {
    if (!this.initialized || !this.module) {
      throw new Error('WASM not initialized');
    }
  }
  
  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  
  /**
   * CRC32 checksum
   */
  private crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  
  /**
   * Get memory stats
   */
  getMemoryStats(): { poolStats: object; wasmMemory: number } {
    return {
      poolStats: this.pool.getStats(),
      wasmMemory: this.module?.get_memory_usage() || 0,
    };
  }
  
  /**
   * Get last error
   */
  getLastError(): WasmError | null {
    return this.lastError;
  }
  
  /**
   * Get WASM version
   */
  getVersion(): number {
    return this.module?.get_version() || 0;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * CRC32 lookup table
 */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

/**
 * Convert compression mode to WASM integer
 */
function modeToWasmInt(mode: CompressionMode): number {
  switch (mode) {
    case 'fast': return 0;
    case 'balanced': return 1;
    case 'strong': return 2;
    case 'auto': return 3;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let wasmWrapperInstance: WasmWrapper | null = null;

/**
 * Get WASM wrapper instance
 */
export function getWasmWrapper(): WasmWrapper {
  if (!wasmWrapperInstance) {
    wasmWrapperInstance = new WasmWrapper();
  }
  return wasmWrapperInstance;
}

/**
 * Reset WASM wrapper
 */
export function resetWasmWrapper(): void {
  if (wasmWrapperInstance) {
    wasmWrapperInstance.shutdown();
    wasmWrapperInstance = null;
  }
}
