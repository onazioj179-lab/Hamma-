/**
 * SPK Decompression Worker
 * 
 * Executes decompression operations off the main thread.
 * Supports selective extraction and streaming decompression.
 * 
 * Performance Target: >100GB/min throughput
 * 
 * @module workers/decompressionWorker
 * @version 1.0.0
 */

import { loadWasmModule } from '../core/wasm/loader';
import { MemoryPool } from '../core/wasm/pool';
import {
  decompressChunk,
  flushDecompression,
  finalizeDecompression,
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

// Selective extraction state
let selectedFiles: Set<string> = new Set();
let chunkFileMap: Map<number, string> = new Map();

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
  maxOutputSize?: number;
  fileId?: string;
}

interface SetSelectionMessage {
  type: 'set-selection';
  fileIds: string[];
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
  | SetSelectionMessage
  | FlushMessage
  | FinalizeMessage
  | CancelMessage;

interface ProgressEvent {
  chunksProcessed: number;
  bytesIn: number;
  bytesOut: number;
  expansionRatio: number;
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

    // Clear selection state
    selectedFiles.clear();
    chunkFileMap.clear();

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
// Selective Extraction
// ============================================================================

/**
 * Set which files should be extracted.
 * Only chunks belonging to these files will be decompressed.
 * 
 * @param fileIds - Array of file identifiers to extract
 */
function setFileSelection(fileIds: string[]): void {
  selectedFiles.clear();
  fileIds.forEach(id => selectedFiles.add(id));

  self.postMessage({
    type: 'selection-updated',
    selectedCount: selectedFiles.size,
    fileIds: Array.from(selectedFiles),
  });
}

/**
 * Check if a chunk should be processed based on selection.
 * 
 * @param index - Chunk index
 * @param fileId - File identifier (if known)
 * @returns true if chunk should be processed
 */
function shouldProcessChunk(index: number, fileId?: string): boolean {
  // If no selection, process all chunks
  if (selectedFiles.size === 0) {
    return true;
  }

  // If fileId provided, check against selection
  if (fileId) {
    return selectedFiles.has(fileId);
  }

  // Check chunk-file map
  const mappedFileId = chunkFileMap.get(index);
  if (mappedFileId) {
    return selectedFiles.has(mappedFileId);
  }

  // Default: process if we don't have mapping info
  return true;
}

// ============================================================================
// Chunk Processing
// ============================================================================

/**
 * Process a single chunk through decompression.
 * 
 * @param index - Chunk sequence number
 * @param buffer - Compressed data
 * @param maxOutputSize - Expected output size (optional)
 * @param fileId - Optional file identifier
 */
async function processChunk(
  index: number,
  buffer: ArrayBuffer,
  maxOutputSize?: number,
  fileId?: string
): Promise<void> {
  if (!isInitialized || !wasmCore || !memoryPool) {
    throw new Error('Worker not initialized');
  }

  // Store chunk-file mapping
  if (fileId) {
    chunkFileMap.set(index, fileId);
  }

  // Check if this chunk should be processed
  if (!shouldProcessChunk(index, fileId)) {
    self.postMessage({
      type: 'chunk-skipped',
      index,
      reason: 'not-selected',
      fileId,
    });
    return;
  }

  const startMs = performance.now();

  try {
    // Convert ArrayBuffer to Uint8Array
    const input = new Uint8Array(buffer);
    
    // Decompress chunk using WASM
    const result = await decompressChunk(wasmCore, memoryPool, input, maxOutputSize);

    // Update statistics
    chunksProcessed++;
    totalBytesIn += input.length;
    totalBytesOut += result.length;

    const processingTime = performance.now() - startMs;

    // Send result back to coordinator
    self.postMessage(
      {
        type: 'chunk-processed',
        index,
        buffer: result.buffer,
        bytesIn: input.length,
        bytesOut: result.length,
        expansionRatio: result.length / input.length,
        processingTime,
        fileId,
      },
      [result.buffer] // Transfer ownership
    );

    // Send telemetry periodically
    if (chunksProcessed % TELEMETRY_INTERVAL === 0) {
      sendProgressUpdate();
    }

  } catch (err) {
    // Handle decompression errors gracefully
    self.postMessage({
      type: 'error',
      index,
      message: `Chunk ${index} decompression failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: true,
    });

    // Attempt recovery
    try {
      if (wasmCore) {
        safeWasmCall(() => wasmCore!.exports.reset());
      }
      if (memoryPool) {
        memoryPool.reset();
      }
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
 * Flush any buffered decompression data.
 */
async function handleFlush(): Promise<void> {
  if (!isInitialized || !wasmCore || !memoryPool) {
    throw new Error('Worker not initialized');
  }

  try {
    const result = await flushDecompression(wasmCore);

    self.postMessage({
      type: 'flush-complete',
      bytesOut: result,
    });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: `Flush failed: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: true,
    });
  }
}

/**
 * Finalize decompression.
 */
async function handleFinalize(): Promise<void> {
  if (!isInitialized || !wasmCore || !memoryPool) {
    throw new Error('Worker not initialized');
  }

  try {
    finalizeDecompression(wasmCore);

    self.postMessage({
      type: 'finalize-complete',
      stats: {
        chunksProcessed,
        totalBytesIn,
        totalBytesOut,
        expansionRatio: totalBytesIn > 0 ? totalBytesOut / totalBytesIn : 1,
        elapsedMs: performance.now() - startTime,
      },
    });

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
      safeWasmCall(() => wasmCore!.exports.reset());
    }

    if (memoryPool) {
      memoryPool.reset();
    }

    // Reset statistics
    chunksProcessed = 0;
    totalBytesIn = 0;
    totalBytesOut = 0;
    startTime = performance.now();

    // Clear selection state
    selectedFiles.clear();
    chunkFileMap.clear();

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
  const throughputMBps = elapsed > 0 ? (totalBytesOut / (1024 * 1024)) / (elapsed / 1000) : 0;

  const progress: ProgressEvent = {
    chunksProcessed,
    bytesIn: totalBytesIn,
    bytesOut: totalBytesOut,
    expansionRatio: totalBytesIn > 0 ? totalBytesOut / totalBytesIn : 1,
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

  const hasLeaks = memoryPool.checkLeaks();
  
  if (hasLeaks) {
    self.postMessage({
      type: 'warning',
      message: 'Memory leaks detected in worker',
      stats: memoryPool.getStats(),
    });
  }
}

// ============================================================================
// Pre-fetching Support
// ============================================================================

/**
 * Pre-fetch next chunk (optional optimization).
 * This can be called by the coordinator to hint that the next chunk will be needed soon.
 */
interface PrefetchMessage {
  type: 'prefetch-hint';
  nextIndex: number;
  fileId?: string;
}

function handlePrefetchHint(nextIndex: number, fileId?: string): void {
  // Store hint for potential optimization
  // In a real implementation, this could trigger:
  // - Memory pre-allocation
  // - Cache warming
  // - Predictive loading
  
  // For now, just acknowledge
  self.postMessage({
    type: 'prefetch-acknowledged',
    nextIndex,
    fileId,
  });
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Main message handler for worker.
 */
self.onmessage = async (event: MessageEvent<WorkerMessage | PrefetchMessage>) => {
  const { type } = event.data;

  try {
    switch (type) {
      case 'init-wasm': {
        const { wasmUrl, blockSize } = event.data as InitWasmMessage;
        await initializeWasm(wasmUrl, blockSize);
        break;
      }

      case 'process-chunk': {
        const { index, buffer, maxOutputSize, fileId } = event.data as ProcessChunkMessage;
        await processChunk(index, buffer, maxOutputSize, fileId);
        break;
      }

      case 'set-selection': {
        const { fileIds } = event.data as SetSelectionMessage;
        setFileSelection(fileIds);
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

      case 'prefetch-hint': {
        const { nextIndex, fileId } = event.data as PrefetchMessage;
        handlePrefetchHint(nextIndex, fileId);
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
