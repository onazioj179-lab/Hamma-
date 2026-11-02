/**
 * SPK WASM Core - Worker Integration Example
 * 
 * Demonstrates how to use WASM compression in a Web Worker.
 * This pattern ensures main thread remains responsive during compression.
 * 
 * @module core/wasm/worker-example
 * @version 1.0.0
 */

import { loadWasmModule } from './loader';
import { MemoryPool } from './pool';
import { compressChunk, flushArchive, finalizeArchive, resetCompression } from './wrappers';
import type { WasmCompressionCore } from './loader';

// ============================================================================
// Worker Message Types
// ============================================================================

export interface WorkerMessage {
  type: 'init' | 'compress' | 'flush' | 'finalize' | 'reset' | 'terminate';
  id: string;
  data?: any;
}

export interface WorkerResponse {
  type: 'ready' | 'result' | 'error' | 'progress';
  id: string;
  data?: any;
  error?: string;
}

// ============================================================================
// Worker State
// ============================================================================

let wasmCore: WasmCompressionCore | null = null;
let memoryPool: MemoryPool | null = null;
let initialized = false;

// ============================================================================
// Worker Message Handler
// ============================================================================

/**
 * Main worker message handler.
 * 
 * This runs in the Web Worker context and processes compression requests.
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, data } = event.data;

  try {
    switch (type) {
      case 'init':
        await handleInit(id, data);
        break;

      case 'compress':
        await handleCompress(id, data);
        break;

      case 'flush':
        await handleFlush(id);
        break;

      case 'finalize':
        await handleFinalize(id);
        break;

      case 'reset':
        await handleReset(id);
        break;

      case 'terminate':
        await handleTerminate(id);
        break;

      default:
        sendError(id, `Unknown message type: ${type}`);
    }
  } catch (err) {
    sendError(id, err instanceof Error ? err.message : String(err));
  }
};

// ============================================================================
// Message Handlers
// ============================================================================

/**
 * Initialize WASM module in worker.
 * 
 * Load WASM once and create a persistent MemoryPool.
 * This setup is reused across all compression jobs.
 */
async function handleInit(id: string, config: any): Promise<void> {
  if (initialized) {
    sendResponse(id, 'ready', { status: 'already-initialized' });
    return;
  }

  try {
    // Load WASM module
    const wasmUrl = config.wasmUrl || '/spk_core.wasm';
    wasmCore = await loadWasmModule(wasmUrl, {
      minMemoryMB: Math.ceil((config.minMemory || 64 * 1024 * 1024) / (1024 * 1024)),
    });

    // Create memory pool
    const blockSize = config.blockSize || 4 * 1024 * 1024; // 4 MB blocks
    const initialBlocks = config.initialBlocks || 8;
    memoryPool = new MemoryPool(wasmCore.memory, blockSize, initialBlocks);

    initialized = true;

    sendResponse(id, 'ready', {
      status: 'initialized',
      memorySize: wasmCore.memory.buffer.byteLength,
      blockSize,
      poolCapacity: initialBlocks * blockSize,
    });

  } catch (err) {
    sendError(id, `Initialization failed: ${err}`);
  }
}

/**
 * Compress a chunk of data.
 * 
 * Uses the shared WASM module and memory pool.
 */
async function handleCompress(id: string, chunk: Uint8Array): Promise<void> {
  if (!initialized || !wasmCore || !memoryPool) {
    sendError(id, 'Worker not initialized');
    return;
  }

  try {
    const result = await compressChunk(wasmCore, memoryPool, chunk);

    // Send result (transfer compressed data for efficiency)
    sendResponse(id, 'result', {
      data: result.data,
      bytesIn: result.bytesIn,
      bytesOut: result.bytesOut,
      ratio: result.ratio,
    }, [result.data.buffer]);

  } catch (err) {
    sendError(id, `Compression failed: ${err}`);
  }
}

/**
 * Flush buffered compression data.
 */
async function handleFlush(id: string): Promise<void> {
  if (!initialized || !wasmCore || !memoryPool) {
    sendError(id, 'Worker not initialized');
    return;
  }

  try {
    const flushedData = await flushArchive(wasmCore, memoryPool);

    sendResponse(id, 'result', {
      data: flushedData,
      bytesOut: flushedData.length,
    }, flushedData.length > 0 ? [flushedData.buffer] : []);

  } catch (err) {
    sendError(id, `Flush failed: ${err}`);
  }
}

/**
 * Finalize compression and get trailer.
 */
async function handleFinalize(id: string): Promise<void> {
  if (!initialized || !wasmCore || !memoryPool) {
    sendError(id, 'Worker not initialized');
    return;
  }

  try {
    const trailerData = await finalizeArchive(wasmCore, memoryPool);

    sendResponse(id, 'result', {
      data: trailerData,
      bytesOut: trailerData.length,
    }, trailerData.length > 0 ? [trailerData.buffer] : []);

  } catch (err) {
    sendError(id, `Finalize failed: ${err}`);
  }
}

/**
 * Reset compression state.
 * 
 * Call this between jobs to reuse the worker without re-initialization.
 */
async function handleReset(id: string): Promise<void> {
  if (!initialized || !wasmCore || !memoryPool) {
    sendError(id, 'Worker not initialized');
    return;
  }

  try {
    resetCompression(wasmCore);
    memoryPool.reset();

    sendResponse(id, 'result', { status: 'reset' });

  } catch (err) {
    sendError(id, `Reset failed: ${err}`);
  }
}

/**
 * Terminate worker and cleanup resources.
 */
async function handleTerminate(id: string): Promise<void> {
  try {
    if (memoryPool) {
      memoryPool.reset();
    }

    wasmCore = null;
    memoryPool = null;
    initialized = false;

    sendResponse(id, 'result', { status: 'terminated' });

    // Terminate worker
    self.close();

  } catch (err) {
    sendError(id, `Terminate failed: ${err}`);
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

function sendResponse(
  id: string,
  type: WorkerResponse['type'],
  data?: any,
  transfer?: Transferable[]
): void {
  const response: WorkerResponse = { type, id, data };
  if (transfer && transfer.length > 0) {
    self.postMessage(response, { transfer });
  } else {
    self.postMessage(response);
  }
}

function sendError(id: string, error: string): void {
  const response: WorkerResponse = { type: 'error', id, error };
  self.postMessage(response);
}

// ============================================================================
// Main Thread Integration Example
// ============================================================================

/**
 * Example: Using the worker from the main thread.
 * 
 * ```typescript
 * // Create worker
 * const worker = new Worker(new URL('./worker-example.ts', import.meta.url), {
 *   type: 'module'
 * });
 * 
 * // Initialize
 * await sendWorkerMessage(worker, 'init', {
 *   wasmUrl: '/spk_core.wasm',
 *   blockSize: 4 * 1024 * 1024,
 * });
 * 
 * // Compress chunks
 * const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
 * const result = await sendWorkerMessage(worker, 'compress', chunk1);
 * console.log('Compressed:', result.bytesIn, '->', result.bytesOut);
 * 
 * // Finalize
 * const trailer = await sendWorkerMessage(worker, 'finalize');
 * 
 * // Reset for next job
 * await sendWorkerMessage(worker, 'reset');
 * ```
 */

export interface WorkerPool {
  workers: Worker[];
  nextWorker: number;
  messageHandlers: Map<string, (response: WorkerResponse) => void>;
}

/**
 * Create a pool of compression workers.
 * 
 * @param count - Number of workers to create
 * @param config - Worker configuration
 * @returns Worker pool
 */
export async function createWorkerPool(
  count: number,
  config: any
): Promise<WorkerPool> {
  const pool: WorkerPool = {
    workers: [],
    nextWorker: 0,
    messageHandlers: new Map(),
  };

  // Create workers
  for (let i = 0; i < count; i++) {
    const worker = new Worker(new URL('./worker-example.ts', import.meta.url), {
      type: 'module',
      name: `spk-worker-${i}`,
    });

    // Setup message handler
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const handler = pool.messageHandlers.get(event.data.id);
      if (handler) {
        handler(event.data);
        pool.messageHandlers.delete(event.data.id);
      }
    };

    pool.workers.push(worker);

    // Initialize worker
    await sendWorkerMessage(worker, pool.messageHandlers, 'init', config);
  }

  return pool;
}

/**
 * Send message to worker and wait for response.
 */
export function sendWorkerMessage(
  worker: Worker,
  handlers: Map<string, (response: WorkerResponse) => void>,
  type: WorkerMessage['type'],
  data?: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random()}`;

    // Register handler
    handlers.set(id, (response: WorkerResponse) => {
      if (response.type === 'error') {
        reject(new Error(response.error));
      } else {
        resolve(response.data);
      }
    });

    // Send message
    const message: WorkerMessage = { type, id, data };
    
    // Transfer ownership of large buffers
    const transfer: Transferable[] = [];
    if (data instanceof Uint8Array && data.length > 1024) {
      transfer.push(data.buffer);
    }
    
    worker.postMessage(message, transfer);
  });
}

/**
 * Get next available worker from pool (round-robin).
 */
export function getNextWorker(pool: WorkerPool): Worker {
  const worker = pool.workers[pool.nextWorker];
  pool.nextWorker = (pool.nextWorker + 1) % pool.workers.length;
  return worker;
}

/**
 * Terminate all workers in pool.
 */
export async function terminateWorkerPool(pool: WorkerPool): Promise<void> {
  await Promise.all(
    pool.workers.map(worker =>
      sendWorkerMessage(worker, pool.messageHandlers, 'terminate')
    )
  );
}

// ============================================================================
// Usage Pattern Documentation
// ============================================================================

/**
 * RECOMMENDED PATTERN:
 * 
 * 1. Create worker pool at app startup:
 *    const pool = await createWorkerPool(navigator.hardwareConcurrency || 4, {
 *      wasmUrl: '/spk_core.wasm',
 *      blockSize: 4 * 1024 * 1024,
 *    });
 * 
 * 2. For each compression job:
 *    const worker = getNextWorker(pool);
 *    const results = [];
 *    
 *    for (const chunk of chunks) {
 *      const result = await sendWorkerMessage(worker, pool.messageHandlers, 'compress', chunk);
 *      results.push(result.data);
 *    }
 *    
 *    const flushed = await sendWorkerMessage(worker, pool.messageHandlers, 'flush');
 *    const trailer = await sendWorkerMessage(worker, pool.messageHandlers, 'finalize');
 *    
 *    // Reset for next job
 *    await sendWorkerMessage(worker, pool.messageHandlers, 'reset');
 * 
 * 3. Cleanup on app shutdown:
 *    await terminateWorkerPool(pool);
 * 
 * BENEFITS:
 * - WASM loaded once per worker (not per job)
 * - MemoryPool reused across jobs (no allocation overhead)
 * - Main thread stays responsive
 * - Parallel compression across multiple workers
 * - Memory-efficient with Transferable objects
 */
