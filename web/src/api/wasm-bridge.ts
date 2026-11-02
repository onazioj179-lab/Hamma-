/**
 * SPK V44 - WASM Bridge Interface
 * Function map and bridge for WebAssembly communication
 */

import type { 
  ApiError, 
  CompressionQuality,
} from './types';

// ============================================================================
// WASM Function Signatures
// ============================================================================

/**
 * WASM compression functions
 */
export interface WasmCompressionFunctions {
  /**
   * Initialize compression context
   */
  init_compression(
    quality: WasmCompressionLevel,
    chunkSize: number,
    enableDedup: boolean
  ): WasmResult<WasmContextHandle>;
  
  /**
   * Compress a chunk of data
   */
  compress_chunk(
    context: WasmContextHandle,
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): WasmResult<WasmCompressedChunk>;
  
  /**
   * Finalize compression and get footer
   */
  finalize_compression(
    context: WasmContextHandle,
    outputPtr: number,
    outputMaxLen: number
  ): WasmResult<WasmArchiveFooter>;
  
  /**
   * Release compression context
   */
  free_compression_context(context: WasmContextHandle): void;
}

/**
 * WASM decompression functions
 */
export interface WasmDecompressionFunctions {
  /**
   * Initialize decompression context
   */
  init_decompression(
    headerPtr: number,
    headerLen: number
  ): WasmResult<WasmContextHandle>;
  
  /**
   * Read archive manifest
   */
  read_manifest(
    context: WasmContextHandle,
    manifestPtr: number,
    manifestLen: number
  ): WasmResult<WasmManifestInfo>;
  
  /**
   * Decompress a chunk
   */
  decompress_chunk(
    context: WasmContextHandle,
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): WasmResult<WasmDecompressedChunk>;
  
  /**
   * Extract specific file by offset
   */
  extract_file(
    context: WasmContextHandle,
    archivePtr: number,
    archiveLen: number,
    fileOffset: number,
    fileLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): WasmResult<WasmExtractedFile>;
  
  /**
   * Release decompression context
   */
  free_decompression_context(context: WasmContextHandle): void;
}

/**
 * WASM encryption functions
 */
export interface WasmEncryptionFunctions {
  /**
   * Derive key from password
   */
  derive_key(
    passwordPtr: number,
    passwordLen: number,
    saltPtr: number,
    saltLen: number,
    iterations: number,
    keyPtr: number
  ): WasmResult<void>;
  
  /**
   * Encrypt data with AES-GCM
   */
  encrypt_aes_gcm(
    keyPtr: number,
    keyLen: number,
    dataPtr: number,
    dataLen: number,
    ivPtr: number,
    outputPtr: number,
    tagPtr: number
  ): WasmResult<WasmEncryptedData>;
  
  /**
   * Decrypt data with AES-GCM
   */
  decrypt_aes_gcm(
    keyPtr: number,
    keyLen: number,
    dataPtr: number,
    dataLen: number,
    ivPtr: number,
    tagPtr: number,
    outputPtr: number
  ): WasmResult<WasmDecryptedData>;
  
  /**
   * Encrypt data with ChaCha20-Poly1305
   */
  encrypt_chacha20(
    keyPtr: number,
    keyLen: number,
    dataPtr: number,
    dataLen: number,
    noncePtr: number,
    outputPtr: number,
    tagPtr: number
  ): WasmResult<WasmEncryptedData>;
  
  /**
   * Decrypt data with ChaCha20-Poly1305
   */
  decrypt_chacha20(
    keyPtr: number,
    keyLen: number,
    dataPtr: number,
    dataLen: number,
    noncePtr: number,
    tagPtr: number,
    outputPtr: number
  ): WasmResult<WasmDecryptedData>;
}

/**
 * WASM utility functions
 */
export interface WasmUtilityFunctions {
  /**
   * Allocate memory in WASM heap
   */
  alloc(size: number): number;
  
  /**
   * Free memory in WASM heap
   */
  free(ptr: number): void;
  
  /**
   * Calculate checksum (xxHash64)
   */
  checksum_xxhash64(
    dataPtr: number,
    dataLen: number
  ): WasmResult<bigint>;
  
  /**
   * Calculate SHA-256 hash
   */
  hash_sha256(
    dataPtr: number,
    dataLen: number,
    outputPtr: number
  ): WasmResult<void>;
  
  /**
   * Verify data integrity
   */
  verify_integrity(
    dataPtr: number,
    dataLen: number,
    checksumPtr: number,
    checksumLen: number
  ): WasmResult<boolean>;
  
  /**
   * Get WASM memory usage
   */
  get_memory_usage(): WasmMemoryInfo;
}

// ============================================================================
// WASM Types
// ============================================================================

/**
 * Opaque handle for WASM contexts
 */
export type WasmContextHandle = number;

/**
 * WASM compression levels
 */
export type WasmCompressionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * WASM result wrapper
 */
export type WasmResult<T> = 
  | { ok: true; value: T }
  | { ok: false; error: WasmError };

/**
 * WASM error
 */
export interface WasmError {
  code: WasmErrorCode;
  message: string;
  details?: string;
}

/**
 * WASM error codes
 */
export type WasmErrorCode =
  | 'ALLOCATION_FAILED'
  | 'INVALID_INPUT'
  | 'BUFFER_TOO_SMALL'
  | 'COMPRESSION_FAILED'
  | 'DECOMPRESSION_FAILED'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'INVALID_FORMAT'
  | 'OUT_OF_MEMORY'
  | 'INTERNAL_ERROR';

/**
 * Compressed chunk info
 */
export interface WasmCompressedChunk {
  outputLen: number;
  checksum: bigint;
  ratio: number;
}

/**
 * Decompressed chunk info
 */
export interface WasmDecompressedChunk {
  outputLen: number;
  checksumValid: boolean;
}

/**
 * Archive footer info
 */
export interface WasmArchiveFooter {
  footerLen: number;
  manifestOffset: number;
  manifestLen: number;
  totalChunks: number;
  totalOriginalSize: bigint;
  totalCompressedSize: bigint;
}

/**
 * Manifest info from WASM
 */
export interface WasmManifestInfo {
  version: number;
  fileCount: number;
  totalSize: bigint;
  compressedSize: bigint;
  encrypted: boolean;
  signed: boolean;
  entriesPtr: number;
  entriesLen: number;
}

/**
 * Extracted file info
 */
export interface WasmExtractedFile {
  outputLen: number;
  mimeType: string;
  checksum: bigint;
  checksumValid: boolean;
}

/**
 * Encrypted data info
 */
export interface WasmEncryptedData {
  outputLen: number;
  tagLen: number;
}

/**
 * Decrypted data info
 */
export interface WasmDecryptedData {
  outputLen: number;
  authValid: boolean;
}

/**
 * WASM memory info
 */
export interface WasmMemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  peakUsedBytes: number;
}

// ============================================================================
// Bridge Interface
// ============================================================================

/**
 * Complete WASM bridge interface
 */
export interface WasmBridge {
  compression: WasmCompressionFunctions;
  decompression: WasmDecompressionFunctions;
  encryption: WasmEncryptionFunctions;
  utility: WasmUtilityFunctions;
  memory: WebAssembly.Memory;
}

/**
 * WASM module loader configuration
 */
export interface WasmLoaderConfig {
  wasmUrl: string;
  sharedMemory?: SharedArrayBuffer;
  maxMemoryPages: number;
  enableSimd: boolean;
  enableThreads: boolean;
}

/**
 * WASM module initialization result
 */
export interface WasmInitResult {
  bridge: WasmBridge;
  capabilities: WasmCapabilities;
}

/**
 * WASM runtime capabilities
 */
export interface WasmCapabilities {
  version: string;
  simdEnabled: boolean;
  threadsEnabled: boolean;
  memoryPages: number;
  maxMemoryPages: number;
  features: string[];
}

// ============================================================================
// Bridge Utilities
// ============================================================================

/**
 * Convert quality preset to WASM compression level
 */
export function qualityToWasmLevel(quality: CompressionQuality): WasmCompressionLevel {
  switch (quality) {
    case 'fast': return 3;
    case 'balanced': return 6;
    case 'maximum': return 12;
  }
}

/**
 * Convert WASM error to API error
 */
export function wasmErrorToApiError(wasmError: WasmError): ApiError {
  const codeMap: Record<WasmErrorCode, ApiError['code']> = {
    ALLOCATION_FAILED: 'INSUFFICIENT_MEMORY',
    INVALID_INPUT: 'INVALID_INPUT',
    BUFFER_TOO_SMALL: 'INTERNAL_ERROR',
    COMPRESSION_FAILED: 'WASM_ERROR',
    DECOMPRESSION_FAILED: 'WASM_ERROR',
    ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
    DECRYPTION_FAILED: 'DECRYPTION_FAILED',
    CHECKSUM_MISMATCH: 'INTEGRITY_CHECK_FAILED',
    INVALID_FORMAT: 'UNSUPPORTED_FORMAT',
    OUT_OF_MEMORY: 'INSUFFICIENT_MEMORY',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  };
  
  return {
    code: codeMap[wasmError.code] || 'WASM_ERROR',
    message: wasmError.message,
    details: wasmError.details ? { wasmDetails: wasmError.details } : undefined,
    recoverable: ['ALLOCATION_FAILED', 'OUT_OF_MEMORY', 'BUFFER_TOO_SMALL'].includes(wasmError.code),
    recovery: wasmError.code === 'OUT_OF_MEMORY' 
      ? { action: 'REDUCE_MEMORY' }
      : undefined,
  };
}

/**
 * Copy data to WASM memory
 */
export function copyToWasm(
  memory: WebAssembly.Memory,
  ptr: number,
  data: Uint8Array
): void {
  const view = new Uint8Array(memory.buffer, ptr, data.length);
  view.set(data);
}

/**
 * Copy data from WASM memory
 */
export function copyFromWasm(
  memory: WebAssembly.Memory,
  ptr: number,
  length: number
): Uint8Array {
  const view = new Uint8Array(memory.buffer, ptr, length);
  return new Uint8Array(view); // Copy to avoid detached buffer issues
}

/**
 * Read string from WASM memory
 */
export function readStringFromWasm(
  memory: WebAssembly.Memory,
  ptr: number,
  length: number
): string {
  const view = new Uint8Array(memory.buffer, ptr, length);
  return new TextDecoder().decode(view);
}

/**
 * Write string to WASM memory
 */
export function writeStringToWasm(
  memory: WebAssembly.Memory,
  ptr: number,
  str: string
): number {
  const encoded = new TextEncoder().encode(str);
  const view = new Uint8Array(memory.buffer, ptr, encoded.length);
  view.set(encoded);
  return encoded.length;
}
