/**
 * SPK V25 - WASM Bridge Types
 * Production-grade type definitions for WASM compression engine
 */

// Compression modes
export type CompressionMode = 'fast' | 'strong' | 'auto';

// WASM module exports interface
export interface SpkWasmModule {
  memory: WebAssembly.Memory;
  
  // Memory management
  alloc(size: number): number;
  dealloc(ptr: number, size: number): void;
  
  // Core compression functions
  compress_chunk(
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number,
    mode: number // 0=fast, 1=strong, 2=auto
  ): number; // Returns compressed length
  
  decompress_chunk(
    inputPtr: number,
    inputLen: number,
    outputPtr: number,
    outputMaxLen: number
  ): number; // Returns decompressed length
  
  // Archive management
  init_archive(mode: number): number; // Returns archive handle
  add_chunk(handle: number, chunkIndex: number, compressedPtr: number, compressedLen: number): number;
  finalize_archive(handle: number, outputPtr: number, outputMaxLen: number): number;
  free_archive(handle: number): void;
  
  // Utilities
  get_compression_ratio(): number;
  get_last_error(): number;
  get_version(): number;
}

// Compression settings
export interface CompressionSettings {
  mode: CompressionMode;
  chunkSize: number; // bytes
  enableDedup: boolean;
  enableEncryption: boolean;
  password?: string;
}

// Default settings
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
export const MIN_CHUNK_SIZE = 64 * 1024; // 64KB minimum
export const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // 64MB maximum

// WASM error codes
export enum WasmErrorCode {
  SUCCESS = 0,
  MEMORY_ALLOCATION_FAILED = 1,
  INVALID_INPUT = 2,
  COMPRESSION_FAILED = 3,
  DECOMPRESSION_FAILED = 4,
  ARCHIVE_CORRUPTED = 5,
  CHUNK_SIZE_EXCEEDED = 6,
  OUT_OF_MEMORY = 7,
  WASM_INIT_FAILED = 8,
}

// Error code to message mapping
export const WASM_ERROR_MESSAGES: Record<WasmErrorCode, string> = {
  [WasmErrorCode.SUCCESS]: 'Success',
  [WasmErrorCode.MEMORY_ALLOCATION_FAILED]: 'Memory allocation failed',
  [WasmErrorCode.INVALID_INPUT]: 'Invalid input data',
  [WasmErrorCode.COMPRESSION_FAILED]: 'Compression failed',
  [WasmErrorCode.DECOMPRESSION_FAILED]: 'Decompression failed',
  [WasmErrorCode.ARCHIVE_CORRUPTED]: 'Archive is corrupted',
  [WasmErrorCode.CHUNK_SIZE_EXCEEDED]: 'Chunk size exceeded maximum',
  [WasmErrorCode.OUT_OF_MEMORY]: 'Out of memory',
  [WasmErrorCode.WASM_INIT_FAILED]: 'WASM initialization failed',
};

// Compression result for a single chunk
export interface ChunkResult {
  index: number;
  originalSize: number;
  compressedSize: number;
  compressedData: Uint8Array;
  processingTimeMs: number;
  checksum: number;
}

// Mode to WASM enum mapping
export function modeToWasmEnum(mode: CompressionMode): number {
  switch (mode) {
    case 'fast': return 0;
    case 'strong': return 1;
    case 'auto': return 2;
  }
}
