/**
 * SPK V45 - WASM Interface Definitions
 * Type-safe interface for WASM compression core
 */

// ============================================================================
// PART 4 — WASM INTERFACE DEFINITIONS
// ============================================================================

/**
 * Core WASM compression engine interface
 * All methods operate on WebAssembly memory
 */
export interface WasmCompressionCore {
  /**
   * WebAssembly linear memory
   * All buffer operations use this memory
   */
  readonly memory: WebAssembly.Memory;

  /**
   * Compress a single chunk
   * @param inputPtr - Pointer to input data in WASM memory
   * @param inputLen - Length of input data
   * @param outputPtr - Pointer to output buffer in WASM memory
   * @param outputMaxLen - Maximum output buffer size
   * @returns Compressed size, or negative value on error
   */
  compress_chunk(
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): number;

  /**
   * Decompress a single chunk
   * @param inputPtr - Pointer to compressed data
   * @param inputLen - Length of compressed data
   * @param outputPtr - Pointer to output buffer
   * @param outputMaxLen - Maximum output size
   * @returns Decompressed size, or negative value on error
   */
  decompress_chunk(
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): number;

  /**
   * Flush internal buffers
   * @param outputPtr - Pointer to output buffer
   * @param outputMaxLen - Maximum output size
   * @returns Bytes written, or negative value on error
   */
  flush(outputPtr: number, outputMaxLen: number): number;

  /**
   * Finalize compression and write archive footer
   * @param outputPtr - Pointer to output buffer
   * @param outputMaxLen - Maximum output size
   * @returns Footer size, or negative value on error
   */
  finalize(outputPtr: number, outputMaxLen: number): number;

  /**
   * Reset compressor state for new operation
   */
  reset(): void;

  /**
   * Allocate memory in WASM heap
   * @param size - Number of bytes to allocate
   * @returns Pointer to allocated memory, or 0 on failure
   */
  alloc(size: number): number;

  /**
   * Free previously allocated memory
   * @param ptr - Pointer to memory to free
   */
  free(ptr: number): void;

  /**
   * Get last error code
   * @returns Error code (0 = no error)
   */
  get_last_error(): number;

  /**
   * Get last error message
   * @param outputPtr - Pointer to output buffer
   * @param maxLen - Maximum message length
   * @returns Length of error message
   */
  get_error_message(outputPtr: number, maxLen: number): number;

  /**
   * Set compression level
   * @param level - Compression level (1-22)
   */
  set_compression_level(level: number): void;

  /**
   * Get current compression level
   * @returns Current level
   */
  get_compression_level(): number;
}

/**
 * Extended WASM interface with deduplication
 */
export interface WasmCompressionCoreWithDedup extends WasmCompressionCore {
  /**
   * Compute content hash for dedup
   * @param inputPtr - Pointer to data
   * @param inputLen - Length of data
   * @param hashPtr - Pointer to output hash buffer (32 bytes)
   */
  compute_hash(inputPtr: number, inputLen: number, hashPtr: number): void;

  /**
   * Check if chunk exists in dedup table
   * @param hashPtr - Pointer to hash (32 bytes)
   * @returns 1 if exists, 0 if not
   */
  check_dedup(hashPtr: number): number;

  /**
   * Add chunk to dedup table
   * @param hashPtr - Pointer to hash
   * @param chunkIndex - Index of the chunk
   */
  add_to_dedup(hashPtr: number, chunkIndex: number): void;

  /**
   * Clear dedup table
   */
  clear_dedup(): void;
}

/**
 * WASM memory buffer pool interface
 */
export interface WasmBufferPool {
  /**
   * Acquire a buffer of at least the specified size
   * @param minSize - Minimum buffer size
   * @returns Buffer handle with pointer and actual size
   */
  acquire(minSize: number): WasmBufferHandle;

  /**
   * Release a buffer back to the pool
   * @param handle - Buffer handle to release
   */
  release(handle: WasmBufferHandle): void;

  /**
   * Get total allocated memory
   */
  getTotalAllocated(): number;

  /**
   * Get available memory
   */
  getAvailable(): number;

  /**
   * Compact the pool (merge free blocks)
   */
  compact(): void;

  /**
   * Clear all buffers
   */
  clear(): void;
}

/**
 * Handle to a WASM buffer
 */
export interface WasmBufferHandle {
  /** Pointer in WASM memory */
  ptr: number;
  /** Actual buffer size */
  size: number;
  /** Whether buffer is in use */
  inUse: boolean;
}

/**
 * WASM module loader interface
 */
export interface WasmModuleLoader {
  /**
   * Load WASM module from URL
   * @param url - URL to WASM file
   * @returns Loaded module instance
   */
  loadFromUrl(url: string): Promise<WasmCompressionCore>;

  /**
   * Load WASM module from bytes
   * @param bytes - WASM binary
   * @returns Loaded module instance
   */
  loadFromBytes(bytes: ArrayBuffer): Promise<WasmCompressionCore>;

  /**
   * Check if module is loaded
   */
  isLoaded(): boolean;

  /**
   * Get module version
   */
  getVersion(): string | null;

  /**
   * Unload module
   */
  unload(): void;
}

/**
 * WASM capability detection
 */
export interface WasmCapabilities {
  /** SIMD support */
  simd: boolean;
  /** Multi-threading support */
  threads: boolean;
  /** Bulk memory operations */
  bulkMemory: boolean;
  /** Reference types */
  referenceTypes: boolean;
  /** Maximum memory pages */
  maxMemoryPages: number;
  /** Initial memory pages */
  initialMemoryPages: number;
}

/**
 * Detect WASM capabilities
 */
export async function detectWasmCapabilities(): Promise<WasmCapabilities> {
  const simd = await checkWasmSIMD();
  const threads = await checkWasmThreads();
  const bulkMemory = await checkWasmBulkMemory();
  const referenceTypes = await checkWasmReferenceTypes();

  return {
    simd,
    threads,
    bulkMemory,
    referenceTypes,
    maxMemoryPages: 65536, // 4GB
    initialMemoryPages: 256, // 16MB
  };
}

/**
 * Check SIMD support
 */
async function checkWasmSIMD(): Promise<boolean> {
  try {
    // Minimal WASM SIMD test module
    const simdTest = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section
      0x03, 0x02, 0x01, 0x00, // function section
      0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b, // code section
    ]);
    await WebAssembly.compile(simdTest);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check threads support
 */
async function checkWasmThreads(): Promise<boolean> {
  try {
    if (typeof SharedArrayBuffer === 'undefined') {
      return false;
    }
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    });
    return memory.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

/**
 * Check bulk memory support
 */
async function checkWasmBulkMemory(): Promise<boolean> {
  try {
    const bulkMemTest = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version
      0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section
      0x03, 0x02, 0x01, 0x00, // function section
      0x05, 0x03, 0x01, 0x00, 0x01, // memory section
      0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfc, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x0b, // code with memory.fill
    ]);
    await WebAssembly.compile(bulkMemTest);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check reference types support
 */
async function checkWasmReferenceTypes(): Promise<boolean> {
  try {
    const refTest = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version
      0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section
      0x03, 0x02, 0x01, 0x00, // function section
      0x0a, 0x05, 0x01, 0x03, 0x00, 0xd0, 0x0b, // code with ref.null
    ]);
    await WebAssembly.compile(refTest);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// WASM Error Codes
// ============================================================================

/**
 * WASM error codes
 */
export const WASM_ERROR_CODES = {
  SUCCESS: 0,
  OUT_OF_MEMORY: -1,
  INVALID_INPUT: -2,
  BUFFER_TOO_SMALL: -3,
  COMPRESSION_FAILED: -4,
  DECOMPRESSION_FAILED: -5,
  INVALID_STATE: -6,
  CHECKSUM_MISMATCH: -7,
  UNSUPPORTED_FORMAT: -8,
  INTERNAL_ERROR: -99,
} as const;

export type WasmErrorCode = typeof WASM_ERROR_CODES[keyof typeof WASM_ERROR_CODES];

/**
 * Get error message for WASM error code
 */
export function getWasmErrorMessage(code: WasmErrorCode): string {
  switch (code) {
    case WASM_ERROR_CODES.SUCCESS:
      return 'Success';
    case WASM_ERROR_CODES.OUT_OF_MEMORY:
      return 'Out of memory';
    case WASM_ERROR_CODES.INVALID_INPUT:
      return 'Invalid input data';
    case WASM_ERROR_CODES.BUFFER_TOO_SMALL:
      return 'Output buffer too small';
    case WASM_ERROR_CODES.COMPRESSION_FAILED:
      return 'Compression failed';
    case WASM_ERROR_CODES.DECOMPRESSION_FAILED:
      return 'Decompression failed';
    case WASM_ERROR_CODES.INVALID_STATE:
      return 'Invalid compressor state';
    case WASM_ERROR_CODES.CHECKSUM_MISMATCH:
      return 'Checksum verification failed';
    case WASM_ERROR_CODES.UNSUPPORTED_FORMAT:
      return 'Unsupported archive format';
    case WASM_ERROR_CODES.INTERNAL_ERROR:
      return 'Internal error';
    default:
      return `Unknown error (${code})`;
  }
}

// ============================================================================
// Memory Management Rules
// ============================================================================

/**
 * Memory management rules
 * - All input/output pointers must be managed through a buffer pool
 * - No dynamic memory allocation on JS side
 * - Buffer reuse required
 */
export const MEMORY_RULES = {
  /** Maximum single allocation size (64MB) */
  MAX_SINGLE_ALLOCATION: 64 * 1024 * 1024,
  /** Default chunk size (4MB) */
  DEFAULT_CHUNK_SIZE: 4 * 1024 * 1024,
  /** Minimum buffer size (64KB) */
  MIN_BUFFER_SIZE: 64 * 1024,
  /** Buffer pool initial size (32MB) */
  POOL_INITIAL_SIZE: 32 * 1024 * 1024,
  /** Buffer alignment (16 bytes for SIMD) */
  BUFFER_ALIGNMENT: 16,
} as const;

/**
 * Align size to boundary
 */
export function alignSize(size: number, alignment: number = MEMORY_RULES.BUFFER_ALIGNMENT): number {
  return Math.ceil(size / alignment) * alignment;
}
