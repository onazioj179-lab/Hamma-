/**
 * SPK WASM Core - Call Wrappers
 * 
 * High-level wrappers around raw WASM exports.
 * Handles pointer management, error checking, and memory safety.
 * 
 * @module core/wasm/wrappers
 * @version 1.0.0
 */

import type { WasmCompressionCore } from './loader';
import { MemoryPool } from './pool';

// ============================================================================
// Types
// ============================================================================

export interface CompressionResult {
  data: Uint8Array;
  bytesIn: number;
  bytesOut: number;
  ratio: number;
}

export interface WasmError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: any;
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Safely execute a WASM call with error handling.
 * 
 * @param fn - Function to execute
 * @returns Result of function
 * @throws Error on failure with wasm-failure code
 */
export function safeWasmCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    const errorMessage = `wasm-failure: WASM engine error - ${details}`;
    
    console.error('[WASM] Call failed:', { code: 'wasm-failure', message: errorMessage });
    throw new Error(errorMessage);
  }
}

/**
 * Check WASM error code and throw if non-zero.
 */
function checkWasmError(wasm: WasmCompressionCore, operation: string): void {
  const errorCode = safeWasmCall(() => wasm.exports.get_error_code());
  
  if (errorCode !== 0) {
    // Try to get error message
    const pool = new MemoryPool(wasm.memory, 256);
    const msgPtr = pool.alloc(256);
    
    try {
      const msgLen = safeWasmCall(() => 
        wasm.exports.get_error_message(msgPtr, 256)
      );
      
      const msgView = pool.read(msgPtr, msgLen);
      const message = new TextDecoder().decode(msgView);
      
      throw {
        code: `wasm-error-${errorCode}`,
        message: `${operation} failed: ${message}`,
        recoverable: errorCode < 100, // Errors < 100 are recoverable
        details: { errorCode, operation },
      } as WasmError;
      
    } finally {
      pool.free(msgPtr);
    }
  }
}

// ============================================================================
// Compression Wrappers
// ============================================================================

/**
 * Compress a chunk of data using WASM.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @param chunk - Data to compress
 * @returns Compressed data
 * 
 * @example
 * ```typescript
 * const compressed = await compressChunk(wasm, pool, inputData);
 * console.log(`Compressed ${inputData.length} -> ${compressed.data.length} bytes`);
 * ```
 */
export async function compressChunk(
  wasm: WasmCompressionCore,
  pool: MemoryPool,
  chunk: Uint8Array
): Promise<CompressionResult> {
  // Allocate input buffer
  const ptrIn = pool.alloc(chunk.length);
  
  try {
    // Write input data
    pool.write(ptrIn, chunk);

    // Allocate output buffer (conservative: 2x input size)
    const maxOutputSize = chunk.length * 2;
    const ptrOut = pool.alloc(maxOutputSize);

    try {
      // Call WASM compression
      const outputLength = safeWasmCall(() =>
        wasm.exports.compress_chunk(ptrIn, chunk.length, ptrOut, maxOutputSize)
      );

      // Check for errors
      checkWasmError(wasm, 'compress_chunk');

      // Validate output
      if (outputLength < 0 || outputLength > maxOutputSize) {
        throw {
          code: 'invalid-output',
          message: `Invalid output length: ${outputLength}`,
          recoverable: false,
        } as WasmError;
      }

      // Read compressed data
      const compressedData = pool.read(ptrOut, outputLength);

      return {
        data: compressedData,
        bytesIn: chunk.length,
        bytesOut: outputLength,
        ratio: outputLength / chunk.length,
      };

    } finally {
      pool.free(ptrOut);
    }

  } finally {
    pool.free(ptrIn);
  }
}

/**
 * Flush any buffered compression data.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @returns Flushed data (if any)
 */
export async function flushArchive(
  wasm: WasmCompressionCore,
  pool: MemoryPool
): Promise<Uint8Array> {
  const maxOutputSize = pool.blockSize;
  const ptrOut = pool.alloc(maxOutputSize);

  try {
    // Call WASM flush
    const outputLength = safeWasmCall(() =>
      wasm.exports.flush(ptrOut, maxOutputSize)
    );

    checkWasmError(wasm, 'flush');

    if (outputLength === 0) {
      return new Uint8Array(0);
    }

    return pool.read(ptrOut, outputLength);

  } finally {
    pool.free(ptrOut);
  }
}

/**
 * Finalize compression and get trailer data.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @returns Finalization data (checksum, footer, etc.)
 */
export async function finalizeArchive(
  wasm: WasmCompressionCore,
  pool: MemoryPool
): Promise<Uint8Array> {
  const maxOutputSize = pool.blockSize;
  const ptrOut = pool.alloc(maxOutputSize);

  try {
    // Call WASM finalize
    const outputLength = safeWasmCall(() =>
      wasm.exports.finalize(ptrOut, maxOutputSize)
    );

    checkWasmError(wasm, 'finalize');

    if (outputLength === 0) {
      return new Uint8Array(0);
    }

    return pool.read(ptrOut, outputLength);

  } finally {
    pool.free(ptrOut);
  }
}

/**
 * Reset WASM compression state.
 * Call this between jobs to reuse the module.
 */
export function resetCompression(wasm: WasmCompressionCore): void {
  safeWasmCall(() => wasm.exports.reset());
  checkWasmError(wasm, 'reset');
}

// ============================================================================
// Decompression Wrappers
// ============================================================================

/**
 * Decompress a chunk of data using WASM.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @param chunk - Compressed data
 * @param maxOutputSize - Maximum expected decompressed size
 * @returns Decompressed data
 */
export async function decompressChunk(
  wasm: WasmCompressionCore,
  pool: MemoryPool,
  chunk: Uint8Array,
  maxOutputSize?: number
): Promise<Uint8Array> {
  const outputSize = maxOutputSize ?? pool.blockSize;
  
  // Allocate input buffer
  const ptrIn = pool.alloc(chunk.length);
  
  try {
    pool.write(ptrIn, chunk);

    // Allocate output buffer
    const ptrOut = pool.alloc(outputSize);

    try {
      // Call WASM decompression
      const outputLength = safeWasmCall(() =>
        wasm.exports.decompress_chunk(ptrIn, chunk.length, ptrOut, outputSize)
      );

      checkWasmError(wasm, 'decompress_chunk');

      if (outputLength < 0 || outputLength > outputSize) {
        throw {
          code: 'invalid-output',
          message: `Invalid decompressed length: ${outputLength}`,
          recoverable: false,
        } as WasmError;
      }

      return pool.read(ptrOut, outputLength);

    } finally {
      pool.free(ptrOut);
    }

  } finally {
    pool.free(ptrIn);
  }
}

/**
 * Flush decompression buffer.
 */
export async function flushDecompression(
  wasm: WasmCompressionCore
): Promise<number> {
  const result = safeWasmCall(() => wasm.exports.decompress_flush());
  checkWasmError(wasm, 'decompress_flush');
  return result;
}

/**
 * Finalize decompression.
 */
export function finalizeDecompression(wasm: WasmCompressionCore): void {
  safeWasmCall(() => wasm.exports.decompress_finalize());
  checkWasmError(wasm, 'decompress_finalize');
}

// ============================================================================
// Utility Wrappers
// ============================================================================

/**
 * Compute checksum for data using WASM.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @param data - Data to checksum
 * @returns Checksum value
 */
export function computeChecksum(
  wasm: WasmCompressionCore,
  pool: MemoryPool,
  data: Uint8Array
): number {
  const ptr = pool.alloc(data.length);
  
  try {
    pool.write(ptr, data);
    
    const checksum = safeWasmCall(() =>
      wasm.exports.compute_checksum(ptr, data.length)
    );
    
    checkWasmError(wasm, 'compute_checksum');
    return checksum;
    
  } finally {
    pool.free(ptr);
  }
}

/**
 * Get WASM module version.
 */
export function getWasmVersion(wasm: WasmCompressionCore): number {
  return safeWasmCall(() => wasm.exports.get_version());
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Compress multiple chunks in sequence.
 * More efficient than calling compressChunk repeatedly.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @param chunks - Array of chunks to compress
 * @param onProgress - Progress callback
 * @returns Array of compression results
 */
export async function compressChunks(
  wasm: WasmCompressionCore,
  pool: MemoryPool,
  chunks: Uint8Array[],
  onProgress?: (index: number, total: number) => void
): Promise<CompressionResult[]> {
  const results: CompressionResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const result = await compressChunk(wasm, pool, chunks[i]);
    results.push(result);
    
    if (onProgress) {
      onProgress(i + 1, chunks.length);
    }
  }

  return results;
}

/**
 * Decompress multiple chunks in sequence.
 * 
 * @param wasm - WASM core instance
 * @param pool - Memory pool
 * @param chunks - Array of compressed chunks
 * @param onProgress - Progress callback
 * @returns Array of decompressed data
 */
export async function decompressChunks(
  wasm: WasmCompressionCore,
  pool: MemoryPool,
  chunks: Uint8Array[],
  onProgress?: (index: number, total: number) => void
): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const result = await decompressChunk(wasm, pool, chunks[i]);
    results.push(result);
    
    if (onProgress) {
      onProgress(i + 1, chunks.length);
    }
  }

  return results;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  safeWasmCall,
  compressChunk,
  flushArchive,
  finalizeArchive,
  resetCompression,
  decompressChunk,
  flushDecompression,
  finalizeDecompression,
  computeChecksum,
  getWasmVersion,
  compressChunks,
  decompressChunks,
};
