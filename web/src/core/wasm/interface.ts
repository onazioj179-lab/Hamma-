/**
 * SPK Implementation Blueprint - WASM Interface
 * 
 * Provides the low-level interface to WASM compression/decompression modules.
 * Manages module initialization, function bindings, and error handling.
 * 
 * @module core/wasm/interface
 * @version 1.0.0
 */

import { WasmBufferPool, getBufferPool, BufferHandle } from './memory';

// ============================================================================
// Types
// ============================================================================

export interface WasmExports {
  // Memory
  memory: WebAssembly.Memory;
  
  // Compression
  compress_init: (level: number) => number;
  compress_chunk: (inputPtr: number, inputLen: number, outputPtr: number, outputMax: number) => number;
  compress_finish: (outputPtr: number, outputMax: number) => number;
  compress_reset: () => void;
  
  // Decompression
  decompress_init: () => number;
  decompress_chunk: (inputPtr: number, inputLen: number, outputPtr: number, outputMax: number) => number;
  decompress_finish: () => void;
  decompress_reset: () => void;
  
  // Utilities
  get_error_code: () => number;
  get_error_message: (bufPtr: number, bufLen: number) => number;
  get_version: () => number;
  compute_checksum: (dataPtr: number, dataLen: number) => number;
}

export interface WasmModule {
  instance: WebAssembly.Instance;
  exports: WasmExports;
  ready: boolean;
}

export interface CompressionContext {
  id: string;
  level: number;
  inputBuffer: BufferHandle;
  outputBuffer: BufferHandle;
  bytesIn: number;
  bytesOut: number;
  checksum: number;
}

export interface DecompressionContext {
  id: string;
  inputBuffer: BufferHandle;
  outputBuffer: BufferHandle;
  bytesIn: number;
  bytesOut: number;
  verified: boolean;
}

export type CompressionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface InitOptions {
  wasmPath?: string;
  poolConfig?: {
    chunkSize?: number;
    poolSize?: number;
  };
}

// ============================================================================
// Error Codes
// ============================================================================

export const WASM_ERROR_CODES = {
  SUCCESS: 0,
  INVALID_INPUT: 1,
  BUFFER_TOO_SMALL: 2,
  COMPRESSION_FAILED: 3,
  DECOMPRESSION_FAILED: 4,
  CHECKSUM_MISMATCH: 5,
  OUT_OF_MEMORY: 6,
  NOT_INITIALIZED: 7,
  INVALID_STATE: 8,
} as const;

export type WasmErrorCode = typeof WASM_ERROR_CODES[keyof typeof WASM_ERROR_CODES];

// ============================================================================
// WASM Interface Class
// ============================================================================

/**
 * Main interface to WASM compression/decompression modules.
 * Handles initialization, memory management, and function calls.
 */
export class WasmInterface {
  private module: WasmModule | null = null;
  private pool: WasmBufferPool;
  private contexts: Map<string, CompressionContext | DecompressionContext> = new Map();
  private nextContextId = 0;
  private initialized = false;

  constructor() {
    this.pool = getBufferPool();
  }

  /**
   * Check if the WASM module is initialized and ready.
   */
  isReady(): boolean {
    return this.initialized && this.module?.ready === true;
  }

  /**
   * Initialize the WASM module from a URL or ArrayBuffer.
   */
  async initialize(options: InitOptions = {}): Promise<void> {
    if (this.initialized) {
      console.warn('WASM interface already initialized');
      return;
    }

    try {
      // Initialize memory pool
      this.pool.initialize();

      // Load WASM module
      const wasmPath = options.wasmPath ?? '/wasm/spk_core.wasm';
      const wasmSource = await this.loadWasmSource(wasmPath);
      
      const importObject: WebAssembly.Imports = {
        env: {
          memory: this.pool.getMemory(),
          abort: (_msgPtr: number, _filePtr: number, line: number, col: number) => {
            console.error(`WASM abort at ${line}:${col}`);
          },
          log_debug: (_ptr: number, _len: number) => {
            // Debug logging hook
          },
          log_error: (_ptr: number, _len: number) => {
            // Error logging hook
          },
        },
      };

      const result = await WebAssembly.instantiate(wasmSource, importObject);
      
      this.module = {
        instance: result.instance,
        exports: result.instance.exports as unknown as WasmExports,
        ready: true,
      };

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize WASM module: ${error}`);
    }
  }

  /**
   * Load WASM source from URL or use embedded fallback.
   */
  private async loadWasmSource(path: string): Promise<ArrayBuffer> {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.arrayBuffer();
    } catch {
      // Return minimal valid WASM module for development
      console.warn('Using fallback WASM module');
      return this.createFallbackModule();
    }
  }

  /**
   * Create a minimal fallback WASM module for development.
   */
  private createFallbackModule(): ArrayBuffer {
    // Minimal valid WASM binary (empty module)
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // Magic number
      0x01, 0x00, 0x00, 0x00, // Version 1
    ]);
    return bytes.buffer;
  }

  /**
   * Create a new compression context.
   */
  createCompressionContext(level: CompressionLevel = 6): CompressionContext {
    this.ensureReady();

    const id = `comp_${++this.nextContextId}`;
    const inputBuffer = this.pool.acquire();
    const outputBuffer = this.pool.acquire();

    const context: CompressionContext = {
      id,
      level,
      inputBuffer,
      outputBuffer,
      bytesIn: 0,
      bytesOut: 0,
      checksum: 0,
    };

    this.contexts.set(id, context);

    // Initialize compression in WASM
    if (this.module) {
      const result = this.module.exports.compress_init(level);
      if (result !== WASM_ERROR_CODES.SUCCESS) {
        this.destroyContext(id);
        throw new Error(`Failed to init compression: error ${result}`);
      }
    }

    return context;
  }

  /**
   * Create a new decompression context.
   */
  createDecompressionContext(): DecompressionContext {
    this.ensureReady();

    const id = `decomp_${++this.nextContextId}`;
    const inputBuffer = this.pool.acquire();
    const outputBuffer = this.pool.acquire();

    const context: DecompressionContext = {
      id,
      inputBuffer,
      outputBuffer,
      bytesIn: 0,
      bytesOut: 0,
      verified: false,
    };

    this.contexts.set(id, context);

    // Initialize decompression in WASM
    if (this.module) {
      const result = this.module.exports.decompress_init();
      if (result !== WASM_ERROR_CODES.SUCCESS) {
        this.destroyContext(id);
        throw new Error(`Failed to init decompression: error ${result}`);
      }
    }

    return context;
  }

  /**
   * Compress a chunk of data.
   */
  compressChunk(context: CompressionContext, data: Uint8Array): Uint8Array {
    this.ensureReady();

    // Write input data to buffer
    this.pool.write(context.inputBuffer, data);

    // Call WASM compression
    if (this.module) {
      const outputLen = this.module.exports.compress_chunk(
        context.inputBuffer.ptr,
        data.length,
        context.outputBuffer.ptr,
        context.outputBuffer.size
      );

      if (outputLen < 0) {
        const errorCode = this.module.exports.get_error_code();
        throw new Error(`Compression failed: error ${errorCode}`);
      }

      context.bytesIn += data.length;
      context.bytesOut += outputLen;

      return this.pool.read(context.outputBuffer, outputLen);
    }

    // Fallback: return data as-is
    return data;
  }

  /**
   * Finish compression and get final output.
   */
  finishCompression(context: CompressionContext): Uint8Array {
    this.ensureReady();

    if (this.module) {
      const outputLen = this.module.exports.compress_finish(
        context.outputBuffer.ptr,
        context.outputBuffer.size
      );

      if (outputLen < 0) {
        const errorCode = this.module.exports.get_error_code();
        throw new Error(`Compression finish failed: error ${errorCode}`);
      }

      context.bytesOut += outputLen;
      return this.pool.read(context.outputBuffer, outputLen);
    }

    return new Uint8Array(0);
  }

  /**
   * Decompress a chunk of data.
   */
  decompressChunk(context: DecompressionContext, data: Uint8Array): Uint8Array {
    this.ensureReady();

    // Write input data to buffer
    this.pool.write(context.inputBuffer, data);

    // Call WASM decompression
    if (this.module) {
      const outputLen = this.module.exports.decompress_chunk(
        context.inputBuffer.ptr,
        data.length,
        context.outputBuffer.ptr,
        context.outputBuffer.size
      );

      if (outputLen < 0) {
        const errorCode = this.module.exports.get_error_code();
        throw new Error(`Decompression failed: error ${errorCode}`);
      }

      context.bytesIn += data.length;
      context.bytesOut += outputLen;

      return this.pool.read(context.outputBuffer, outputLen);
    }

    // Fallback: return data as-is
    return data;
  }

  /**
   * Finish decompression.
   */
  finishDecompression(context: DecompressionContext): void {
    this.ensureReady();

    if (this.module) {
      this.module.exports.decompress_finish();
    }

    context.verified = true;
  }

  /**
   * Compute checksum for data.
   */
  computeChecksum(data: Uint8Array): number {
    this.ensureReady();

    const buffer = this.pool.acquire(data.length);
    try {
      this.pool.write(buffer, data);

      if (this.module) {
        return this.module.exports.compute_checksum(buffer.ptr, data.length);
      }

      // Fallback: simple checksum
      return data.reduce((acc, byte) => (acc + byte) & 0xffffffff, 0);
    } finally {
      this.pool.release(buffer);
    }
  }

  /**
   * Destroy a context and release its resources.
   */
  destroyContext(contextId: string): void {
    const context = this.contexts.get(contextId);
    if (!context) return;

    this.pool.release(context.inputBuffer);
    this.pool.release(context.outputBuffer);
    this.contexts.delete(contextId);

    // Reset WASM state
    if (this.module) {
      if ('level' in context) {
        this.module.exports.compress_reset();
      } else {
        this.module.exports.decompress_reset();
      }
    }
  }

  /**
   * Get WASM module version.
   */
  getVersion(): number {
    if (!this.module) return 0;
    return this.module.exports.get_version();
  }

  /**
   * Ensure the module is ready for operations.
   */
  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error('WASM interface not initialized');
    }
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    // Destroy all contexts
    for (const id of this.contexts.keys()) {
      this.destroyContext(id);
    }

    // Reset state
    this.module = null;
    this.initialized = false;
    this.pool.dispose();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalInterface: WasmInterface | null = null;

export function getWasmInterface(): WasmInterface {
  if (!globalInterface) {
    globalInterface = new WasmInterface();
  }
  return globalInterface;
}

export async function initializeWasm(options?: InitOptions): Promise<WasmInterface> {
  const wasmInterface = getWasmInterface();
  await wasmInterface.initialize(options);
  return wasmInterface;
}

// ============================================================================
// Exports
// ============================================================================

export default WasmInterface;
