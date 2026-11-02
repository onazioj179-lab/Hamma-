/**
 * SPK WASM Core - Module Loader
 * 
 * Handles fetching, validation, and instantiation of WASM compression modules.
 * Ensures all required exports exist and memory meets minimum requirements.
 * 
 * @module core/wasm/loader
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface WasmCompressionCore {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  exports: {
    // Compression
    compress_chunk: (inputPtr: number, inputLen: number, outputPtr: number, outputMax: number) => number;
    flush: (outputPtr: number, outputMax: number) => number;
    finalize: (outputPtr: number, outputMax: number) => number;
    reset: () => void;
    
    // Decompression
    decompress_chunk: (inputPtr: number, inputLen: number, outputPtr: number, outputMax: number) => number;
    decompress_flush: () => number;
    decompress_finalize: () => void;
    
    // Utilities
    get_error_code: () => number;
    get_error_message: (bufPtr: number, bufLen: number) => number;
    get_version: () => number;
    compute_checksum: (dataPtr: number, dataLen: number) => number;
  };
  ready: boolean;
}

export interface LoadOptions {
  minMemoryMB?: number;
  importObject?: WebAssembly.Imports;
  validateExports?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  missingExports: string[];
  memorySize: number;
  version?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum memory size in bytes (64MB) */
const MIN_MEMORY_BYTES = 64 * 1024 * 1024;

/** Required WASM exports for compression */
const REQUIRED_EXPORTS = [
  'compress_chunk',
  'flush',
  'finalize',
  'reset',
  'decompress_chunk',
  'get_error_code',
  'memory',
] as const;

// ============================================================================
// WASM Module Loader
// ============================================================================

/**
 * Load and initialize a WASM compression module.
 * 
 * @param url - URL to the WASM binary
 * @param options - Configuration options
 * @returns Fully initialized and validated WASM core
 * 
 * @example
 * ```typescript
 * const wasm = await loadWasmModule('/wasm/spk_core.wasm', {
 *   minMemoryMB: 64,
 *   validateExports: true
 * });
 * ```
 */
export async function loadWasmModule(
  url: string,
  options: LoadOptions = {}
): Promise<WasmCompressionCore> {
  const {
    minMemoryMB = 64,
    importObject,
    validateExports = true,
  } = options;

  try {
    // Step 1: Fetch WASM binary
    console.log(`[WASM Loader] Fetching module from ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: HTTP ${response.status}`);
    }

    const wasmBytes = await response.arrayBuffer();
    console.log(`[WASM Loader] Loaded ${wasmBytes.byteLength} bytes`);

    // Step 2: Create memory with minimum 64MB
    const minPages = Math.ceil((minMemoryMB * 1024 * 1024) / 65536);
    const memory = new WebAssembly.Memory({
      initial: minPages,
      maximum: 65536, // 4GB max
      shared: false,
    });

    console.log(`[WASM Loader] Created memory: ${minPages} pages (${minPages * 64}KB)`);

    // Step 3: Build import object
    const imports: WebAssembly.Imports = importObject ?? {
      env: {
        memory,
        abort: (_msgPtr: number, _filePtr: number, line: number, col: number) => {
          console.error(`[WASM] Abort at ${line}:${col}`);
          throw new Error(`WASM abort at ${line}:${col}`);
        },
        log: (ptr: number, len: number) => {
          const view = new Uint8Array(memory.buffer, ptr, len);
          const message = new TextDecoder().decode(view);
          console.log(`[WASM Log] ${message}`);
        },
        error: (ptr: number, len: number) => {
          const view = new Uint8Array(memory.buffer, ptr, len);
          const message = new TextDecoder().decode(view);
          console.error(`[WASM Error] ${message}`);
        },
      },
    };

    // Step 4: Instantiate WASM module
    const result = await WebAssembly.instantiate(wasmBytes, imports);
    console.log('[WASM Loader] Module instantiated successfully');

    // Step 5: Extract exports
    const exports = result.instance.exports as any;

    // Step 6: Validate exports (if enabled)
    if (validateExports) {
      const validation = validateWasmExports(exports);
      
      if (!validation.valid) {
        throw new Error(
          `WASM validation failed. Missing exports: ${validation.missingExports.join(', ')}`
        );
      }

      console.log('[WASM Loader] All required exports validated');
      
      if (validation.version) {
        console.log(`[WASM Loader] Module version: ${validation.version}`);
      }
    }

    // Step 7: Build core interface
    const core: WasmCompressionCore = {
      instance: result.instance,
      memory: exports.memory || memory,
      exports: {
        compress_chunk: exports.compress_chunk,
        flush: exports.flush,
        finalize: exports.finalize,
        reset: exports.reset,
        decompress_chunk: exports.decompress_chunk,
        decompress_flush: exports.decompress_flush || (() => 0),
        decompress_finalize: exports.decompress_finalize || (() => {}),
        get_error_code: exports.get_error_code,
        get_error_message: exports.get_error_message,
        get_version: exports.get_version || (() => 0),
        compute_checksum: exports.compute_checksum,
      },
      ready: true,
    };

    console.log('[WASM Loader] Core interface ready');
    return core;

  } catch (error) {
    console.error('[WASM Loader] Failed to load module:', error);
    throw new Error(`WASM module loading failed: ${error}`);
  }
}

/**
 * Validate that WASM exports contain all required functions.
 */
export function validateWasmExports(exports: any): ValidationResult {
  const missingExports: string[] = [];

  // Check required exports
  for (const exportName of REQUIRED_EXPORTS) {
    if (!(exportName in exports)) {
      missingExports.push(exportName);
    } else if (exportName !== 'memory' && typeof exports[exportName] !== 'function') {
      missingExports.push(`${exportName} (not a function)`);
    }
  }

  // Check memory
  let memorySize = 0;
  if (exports.memory instanceof WebAssembly.Memory) {
    memorySize = exports.memory.buffer.byteLength;
    
    if (memorySize < MIN_MEMORY_BYTES) {
      missingExports.push(`memory (too small: ${memorySize} < ${MIN_MEMORY_BYTES})`);
    }
  }

  // Get version if available
  let version: number | undefined;
  if (typeof exports.get_version === 'function') {
    try {
      version = exports.get_version();
    } catch {
      // Version check failed, non-critical
    }
  }

  return {
    valid: missingExports.length === 0,
    missingExports,
    memorySize,
    version,
  };
}

/**
 * Create a fallback WASM module for development/testing.
 * Returns a minimal mock that satisfies the interface.
 */
export function createFallbackModule(): WasmCompressionCore {
  console.warn('[WASM Loader] Using fallback mock module');

  const memory = new WebAssembly.Memory({
    initial: 1024, // 64MB
    maximum: 65536,
  });

  // Mock implementation that passes through data unchanged
  const mockExports = {
    compress_chunk: (inputPtr: number, inputLen: number, outputPtr: number, _outputMax: number) => {
      const input = new Uint8Array(memory.buffer, inputPtr, inputLen);
      const output = new Uint8Array(memory.buffer, outputPtr, inputLen);
      output.set(input);
      return inputLen; // "Compressed" size (no compression)
    },
    flush: (_outputPtr: number, _outputMax: number) => 0,
    finalize: (_outputPtr: number, _outputMax: number) => 0,
    reset: () => {},
    decompress_chunk: (inputPtr: number, inputLen: number, outputPtr: number, _outputMax: number) => {
      const input = new Uint8Array(memory.buffer, inputPtr, inputLen);
      const output = new Uint8Array(memory.buffer, outputPtr, inputLen);
      output.set(input);
      return inputLen;
    },
    decompress_flush: () => 0,
    decompress_finalize: () => {},
    get_error_code: () => 0,
    get_error_message: (_bufPtr: number, _bufLen: number) => 0,
    get_version: () => 1,
    compute_checksum: (_dataPtr: number, _dataLen: number) => 0,
  };

  return {
    instance: { exports: mockExports } as any,
    memory,
    exports: mockExports,
    ready: true,
  };
}

/**
 * Preload WASM module for faster subsequent loads.
 * Caches the compiled module in browser memory.
 */
export async function preloadWasmModule(url: string): Promise<WebAssembly.Module> {
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  return WebAssembly.compile(bytes);
}

// ============================================================================
// Exports
// ============================================================================

export default loadWasmModule;
