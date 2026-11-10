/**
 * SPK Compression Worker
 * 
 * Executes compression operations off the main thread.
 * Handles WASM loading, memory management, and chunk processing.
 * 
 * Performance Target: >100GB/min throughput
 * 
 * @module workers/compressionWorker
 * @version 1.0.0
 */

import { loadWasmModule } from '../core/wasm/loader';
import { MemoryPool } from '../core/wasm/pool';
import {
  compressChunk,
  flushArchive,
  finalizeArchive,
  resetCompression,
  safeWasmCall,
} from '../core/wasm/wrappers';
import type { WasmCompressionCore } from '../core/wasm/loader';

// ============================================================================
// State Management
// ============================================================================

let wasmCore: WasmCompressionCore | null = null;
let memoryPool: MemoryPool | null = null;
let isInitialized = false;
let chunksProcessed = 0;
let totalBytesIn = 0;
let totalBytesOut = 0;
let startTime = 0;

// Telemetry configuration
const TELEMETRY_INTERVAL = 10; // Send progress every N chunks

// ============================================================================
// Message Types
// ============================================================================

interface InitWasmMessage {
  type: 'init-wasm';
  wasmUrl?: string;
  blockSize?: number;
}

interface ProcessChunkMessage {
  type: 'process-chunk';
  index: number;
  buffer: ArrayBuffer;
  fileId?: string;
}

interface FlushMessage {
  type: 'flush';
}

interface FinalizeMessage {
  type: 'finalize';
}

interface CancelMessage {
  type: 'cancel';
}

type WorkerMessage =
  | InitWasmMessage
  | ProcessChunkMessage
  | FlushMessage
  | FinalizeMessage
  | CancelMessage;

interface ProgressEvent {
  chunksProcessed: number;
  bytesIn: number;
  bytesOut: number;
  compressionRatio: number;
  throughputMBps: number;
  elapsedMs: number;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize WASM module and memory pool.
 * This is called once at worker startup.
 */
async function initializeWasm(wasmUrl?: string, blockSize?: number): Promise<void> {
  try {
    // Load WASM module
    const url = wasmUrl || '/spk_core.wasm';
    wasmCore = await loadWasmModule(url, {
      minMemoryMB: 64, // 64MB minimum
      validateExports: true,
    });

    // Create memory pool with optimal block size
    const poolBlockSize = blockSize || 4 * 1024 * 1024; // 4MB default
    memoryPool = new MemoryPool(wasmCore.memory, poolBlockSize, 16);

    isInitialized = true;
    startTime = performance.now();
    chunksProcessed = 0;
    totalBytesIn = 0;
    totalBytesOut = 0;

    // Notify main thread
    self.postMessage({
      type: 'wasm-ready',
      memorySize: wasmCore.memory.buffer.byteLength,
      blockSize: poolBlockSize,
    });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `WASM initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: false,
    });
    throw err;
  }
}

// ============================================================================
// Chunk Processing
// ============================================================================

/**
 * Process a single chunk through compression.
 * 
 * @param index - Chunk sequence number
 * @param buffer - Raw data to compress
 * @param fileId - Optional file identifier
 */
async function processChunk(
  index: number,
  buffer: ArrayBuffer,
  fileId?: string
): Promise<void> {
  if (!isInitialized || !wasmCore || !memoryPool) {
    throw new Error('Worker not initialized');
  }

  const startMs = performance.now();

  try {
    // Convert ArrayBuffer to Uint8Array
    const input = new Uint8Array(buffer);
    
    // Compress chunk using WASM
    const result = await compressChunk(wasmCore, memoryPool, input);

    // Update statistics
    chunksProcessed++;
    totalBytesIn += result.bytesIn;
    totalBytesOut += result.bytesOut;

    const processingTime = performance.now() - startMs;

    // Send result back to coordinator
    self.postMessage(
      {
        type: 'chunk-processed',
        index,
        buffer: result.data.buffer,
        bytesIn: result.bytesIn,
        bytesOut: result.bytesOut,
        ratio: result.ratio,
        processingTime,
        fileId,
      },
      [result.data.buffer] // Transfer ownership
    );

    // Send telemetry periodically
    if (chunksProcessed % TELEMETRY_INTERVAL === 0) {
      sendProgressUpdate();
    }

  } catch (err) {
    // Handle compression errors gracefully
    self.postMessage({
      type: 'error',
      index,
      message: `Chunk ${index} compression failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: true,
    });

    // Attempt recovery
    try {
      resetCompression(wasmCore);
      memoryPool.reset();
    } catch (resetErr) {
      self.postMessage({
        type: 'error',
        message: 'Worker reset failed - restart required',
        recoverable: false,
      });
    }
  }
}

// ============================================================================
// Flush and Finalize
// ============================================================================

/**
 * Flush any buffered compression data.
 */
async function handleFlush(): Promise<void> {
  if (!isInitialized || !wasmCore || !memoryPool) {
    throw new Error('Worker not initialized');
  }

  try {
    const flushedData = await flushArchive(wasmCore, memoryPool);

    self.postMessage(
      {
        type: 'flush-complete',
        buffer: flushedData.buffer,
        bytesOut: flushedData.length,
      },
      flushedData.length > 0 ? [flushedData.buffer] : []
    );

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `Flush failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: true,
    });
  }
}

/**
 * Finalize compression and generate archive footer.
 */
async function handleFinalize(): Promise<void> {
  if (!isInitialized || !wasmCore || !memoryPool) {
    throw new Error('Worker not initialized');
  }

  try {
    const footer = await finalizeArchive(wasmCore, memoryPool);

    // Generate chunk table (placeholder - coordinator will build full table)
    const chunkTable = {
      totalChunks: chunksProcessed,
      totalBytesIn,
      totalBytesOut,
      compressionRatio: totalBytesIn > 0 ? totalBytesOut / totalBytesIn : 1,
    };

    self.postMessage(
      {
        type: 'finalize-complete',
        footer: footer.buffer,
        table: chunkTable,
        stats: {
          chunksProcessed,
          totalBytesIn,
          totalBytesOut,
          compressionRatio: chunkTable.compressionRatio,
          elapsedMs: performance.now() - startTime,
        },
      },
      footer.length > 0 ? [footer.buffer] : []
    );

    // Send final progress update
    sendProgressUpdate();

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `Finalize failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: false,
    });
  }
}

// ============================================================================
// Cancellation and Reset
// ============================================================================

/**
 * Cancel current operation and reset state.
 */
async function handleCancel(): Promise<void> {
  try {
    if (wasmCore) {
      resetCompression(wasmCore);
    }

    if (memoryPool) {
      memoryPool.reset();
    }

    // Reset statistics
    chunksProcessed = 0;
    totalBytesIn = 0;
    totalBytesOut = 0;
    startTime = performance.now();

    self.postMessage({
      type: 'cancelled',
      timestamp: Date.now(),
    });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `Cancel failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: false,
    });
  }
}

// ============================================================================
// Telemetry
// ============================================================================

/**
 * Send progress update to coordinator.
 */
function sendProgressUpdate(): void {
  const elapsed = performance.now() - startTime;
  const throughputMBps = elapsed > 0 ? (totalBytesIn / (1024 * 1024)) / (elapsed / 1000) : 0;

  const progress: ProgressEvent = {
    chunksProcessed,
    bytesIn: totalBytesIn,
    bytesOut: totalBytesOut,
    compressionRatio: totalBytesIn > 0 ? totalBytesOut / totalBytesIn : 1,
    throughputMBps,
    elapsedMs: elapsed,
  };

  self.postMessage({
    type: 'progress',
    progress,
  });
}

// ============================================================================
// Memory Management
// ============================================================================

/**
 * Get current memory statistics.
 */
function getMemoryStats() {
  if (!memoryPool) return null;

  return memoryPool.getStats();
}

/**
 * Check for memory leaks.
 */
function checkMemoryHealth(): void {
  if (!memoryPool) return;

  if (!memoryPool.checkLeaks()) {
    self.postMessage({
      type: 'warning',
      message: 'Memory leaks detected in worker',
      stats: memoryPool.getStats(),
    });
  }
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Main message handler for worker.
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data;

  try {
    switch (type) {
      case 'init-wasm': {
        const { wasmUrl, blockSize } = event.data;
        await initializeWasm(wasmUrl, blockSize);
        break;
      }

      case 'process-chunk': {
        const { index, buffer, fileId } = event.data;
        await processChunk(index, buffer, fileId);
        break;
      }

      case 'flush': {
        await handleFlush();
        break;
      }

      case 'finalize': {
        await handleFinalize();
        break;
      }

      case 'cancel': {
        await handleCancel();
        break;
      }

      default: {
        self.postMessage({
          type: 'error',
          message: `Unknown message type: ${type}`,
          recoverable: true,
        });
      }
    }

    // Periodic memory health check
    if (chunksProcessed % 100 === 0) {
      checkMemoryHealth();
    }

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `Worker error: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: false,
    });
  }
};

// ============================================================================
// Error Handler
// ============================================================================

/**
 * Global error handler for uncaught exceptions.
 */
self.onerror = (error) => {
  self.postMessage({
    type: 'error',
    message: `Uncaught worker error: ${error}`,
    recoverable: false,
  });
};

/**
 * Unhandled promise rejection handler.
 */
self.onunhandledrejection = (event) => {
  self.postMessage({
    type: 'error',
    message: `Unhandled promise rejection: ${event.reason}`,
    recoverable: false,
  });
};

// ============================================================================
// Worker Ready
// ============================================================================

// Signal that worker script loaded successfully
self.postMessage({
  type: 'worker-loaded',
  timestamp: Date.now(),
});
