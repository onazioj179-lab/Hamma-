// SPK V24 - WASM Integration Types

export interface SpkWasm {
  // Core compression functions
  compress(data: Uint8Array, chunkSize: number): Promise<Uint8Array>;
  decompress(data: Uint8Array): Promise<Uint8Array>;
  
  // Streaming functions for large files
  createCompressor(chunkSize: number): CompressorHandle;
  createDecompressor(): DecompressorHandle;
  
  // Utility functions
  getVersion(): string;
  getStats(data: Uint8Array): CompressionStats;
  validateArchive(data: Uint8Array): ValidationResult;
}

export interface CompressorHandle {
  id: number;
  feedChunk(chunk: Uint8Array): Uint8Array | null;
  finish(): Uint8Array;
  getProgress(): number;
  cancel(): void;
}

export interface DecompressorHandle {
  id: number;
  feedChunk(chunk: Uint8Array): Uint8Array | null;
  finish(): Uint8Array;
  getProgress(): number;
  cancel(): void;
}

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  chunks: number;
  algorithm: string;
}

export interface ValidationResult {
  valid: boolean;
  version: number;
  error?: string;
}

// Compression modes
export type CompressionMode = 'auto' | 'fast' | 'balanced' | 'strong';

export interface CompressionOptions {
  mode: CompressionMode;
  chunkSize: number;
  useGpu: boolean;
}

// Progress callback
export interface ProgressEvent {
  bytesProcessed: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  speedMbps: number;
  phase: 'preparing' | 'processing' | 'finalizing';
}

export type ProgressCallback = (event: ProgressEvent) => void;
