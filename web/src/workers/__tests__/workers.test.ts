/**
 * SPK Workers - Unit Tests
 * 
 * Comprehensive test suite for compression and decompression workers.
 * Tests WASM loading, chunk processing, error handling, and performance.
 * 
 * @module workers/__tests__/workers.test
 * @version 1.0.0
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ============================================================================
// Test Configuration
// ============================================================================

const WASM_URL = '/spk_core.wasm';
const TEST_TIMEOUT = 30000; // 30 seconds for WASM operations

// Check if Worker is available AND we're in a browser environment
// Workers require actual browser environment to function properly
const hasWorkerSupport = typeof Worker !== 'undefined' && 
  typeof window !== 'undefined' && 
  typeof window.Worker !== 'undefined' &&
  // Additional check: in jsdom, Worker is defined but doesn't work
  typeof globalThis.importScripts === 'function';

// Sample test data
const SMALL_CHUNK = new Uint8Array(1024).fill(42); // 1KB
const MEDIUM_CHUNK = new Uint8Array(1024 * 1024).fill(123); // 1MB
const LARGE_CHUNK = new Uint8Array(10 * 1024 * 1024).fill(255); // 10MB

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a worker and wait for it to load.
 */
async function createWorker(workerPath: string): Promise<Worker> {
  if (!hasWorkerSupport) {
    throw new Error('Worker not available in test environment');
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(workerPath, import.meta.url), {
      type: 'module',
    });

    const timeout = setTimeout(() => {
      reject(new Error('Worker load timeout'));
    }, 5000);

    worker.onmessage = (event) => {
      if (event.data.type === 'worker-loaded') {
        clearTimeout(timeout);
        resolve(worker);
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
}

/**
 * Initialize WASM in a worker.
 */
async function initializeWorker(worker: Worker, wasmUrl?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('WASM init timeout'));
    }, 10000);

    const handler = (event: MessageEvent) => {
      if (event.data.type === 'wasm-ready') {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve();
      } else if (event.data.type === 'error') {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        reject(new Error(event.data.message));
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ type: 'init-wasm', wasmUrl });
  });
}

/**
 * Process a chunk and wait for result.
 */
async function processChunk(
  worker: Worker,
  index: number,
  data: Uint8Array
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Chunk processing timeout'));
    }, 15000);

    const handler = (event: MessageEvent) => {
      if (event.data.type === 'chunk-processed' && event.data.index === index) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve(event.data);
      } else if (event.data.type === 'error' && event.data.index === index) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        reject(new Error(event.data.message));
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage(
      { type: 'process-chunk', index, buffer: data.buffer },
      [data.buffer]
    );
  });
}

// ============================================================================
// Compression Worker Tests
// ============================================================================

// Skip worker tests when Worker API is not available (Node.js/jsdom environment)
describe.skipIf(!hasWorkerSupport)('Compression Worker', () => {
  let worker: Worker;

  beforeAll(async () => {
    worker = await createWorker('../compressionWorker.ts');
  }, TEST_TIMEOUT);

  afterAll(() => {
    worker?.terminate();
  });

  it('should load worker successfully', () => {
    expect(worker).toBeDefined();
  });

  it('should initialize WASM module', async () => {
    await expect(initializeWorker(worker, WASM_URL)).resolves.toBeUndefined();
  }, TEST_TIMEOUT);

  it('should process small chunk', async () => {
    const result = await processChunk(worker, 0, SMALL_CHUNK);

    expect(result).toBeDefined();
    expect(result.index).toBe(0);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.bytesIn).toBe(SMALL_CHUNK.length);
    expect(result.bytesOut).toBeGreaterThan(0);
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.processingTime).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should process medium chunk', async () => {
    const result = await processChunk(worker, 1, MEDIUM_CHUNK);

    expect(result.bytesIn).toBe(MEDIUM_CHUNK.length);
    expect(result.bytesOut).toBeLessThan(MEDIUM_CHUNK.length); // Should compress
  }, TEST_TIMEOUT);

  it('should process large chunk', async () => {
    const result = await processChunk(worker, 2, LARGE_CHUNK);

    expect(result.bytesIn).toBe(LARGE_CHUNK.length);
    expect(result.processingTime).toBeLessThan(5000); // Should be fast
  }, TEST_TIMEOUT);

  it('should produce deterministic output', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    
    const result1 = await processChunk(worker, 10, data.slice());
    
    // Reset worker
    worker.postMessage({ type: 'cancel' });
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const result2 = await processChunk(worker, 11, data.slice());

    expect(new Uint8Array(result1.buffer)).toEqual(new Uint8Array(result2.buffer));
  }, TEST_TIMEOUT);

  it('should handle flush command', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Flush timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'flush-complete') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          expect(event.data.buffer).toBeInstanceOf(ArrayBuffer);
          resolve();
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'flush' });
    });
  }, TEST_TIMEOUT);

  it('should handle finalize command', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Finalize timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'finalize-complete') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          expect(event.data.footer).toBeInstanceOf(ArrayBuffer);
          expect(event.data.table).toBeDefined();
          expect(event.data.stats).toBeDefined();
          expect(event.data.stats.chunksProcessed).toBeGreaterThan(0);
          resolve();
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'finalize' });
    });
  }, TEST_TIMEOUT);

  it('should handle cancel command', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Cancel timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'cancelled') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          expect(event.data.timestamp).toBeGreaterThan(0);
          resolve();
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'cancel' });
    });
  }, TEST_TIMEOUT);

  it('should send progress updates', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Progress timeout')), 10000);
      let progressReceived = false;

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'progress') {
          progressReceived = true;
          expect(event.data.progress).toBeDefined();
          expect(event.data.progress.chunksProcessed).toBeGreaterThan(0);
          expect(event.data.progress.throughputMBps).toBeGreaterThanOrEqual(0);
        }
        
        if (event.data.type === 'chunk-processed' && event.data.index === 20) {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          expect(progressReceived).toBe(true);
          resolve();
        }
      };

      worker.addEventListener('message', handler);

      // Process multiple chunks to trigger progress
      for (let i = 10; i <= 20; i++) {
        const data = new Uint8Array(1024).fill(i);
        worker.postMessage(
          { type: 'process-chunk', index: i, buffer: data.buffer },
          [data.buffer]
        );
      }
    });
  }, TEST_TIMEOUT);

  it('should handle malformed input gracefully', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Error handling timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'error' || event.data.type === 'chunk-processed') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          // Should either error gracefully or process without crashing
          resolve();
        }
      };

      worker.addEventListener('message', handler);
      
      // Send invalid data
      const invalidData = new ArrayBuffer(0);
      worker.postMessage({ type: 'process-chunk', index: 999, buffer: invalidData }, [invalidData]);
    });
  }, TEST_TIMEOUT);
});

// ============================================================================
// Decompression Worker Tests
// ============================================================================

describe.skipIf(!hasWorkerSupport)('Decompression Worker', () => {
  let compressWorker: Worker;
  let decompressWorker: Worker;
  let compressedData: ArrayBuffer;

  beforeAll(async () => {
    // Create both workers for round-trip testing
    compressWorker = await createWorker('../compressionWorker.ts');
    decompressWorker = await createWorker('../decompressionWorker.ts');

    // Initialize both
    await initializeWorker(compressWorker, WASM_URL);
    await initializeWorker(decompressWorker, WASM_URL);

    // Compress test data for decompression tests
    const testData = new Uint8Array(1024).fill(42);
    const result = await processChunk(compressWorker, 0, testData);
    compressedData = result.buffer;
  }, TEST_TIMEOUT);

  afterAll(() => {
    compressWorker?.terminate();
    decompressWorker?.terminate();
  });

  it('should load worker successfully', () => {
    expect(decompressWorker).toBeDefined();
  });

  it('should decompress chunk', async () => {
    const result = await processChunk(
      decompressWorker,
      0,
      new Uint8Array(compressedData)
    );

    expect(result).toBeDefined();
    expect(result.index).toBe(0);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.bytesOut).toBe(1024); // Should match original size
    expect(result.expansionRatio).toBeGreaterThan(1);
  }, TEST_TIMEOUT);

  it('should handle round-trip compression', async () => {
    const originalData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Compress
    const compressed = await processChunk(compressWorker, 100, originalData.slice());

    // Decompress
    const decompressed = await processChunk(
      decompressWorker,
      100,
      new Uint8Array(compressed.buffer)
    );

    // Verify data integrity
    const result = new Uint8Array(decompressed.buffer);
    expect(result.length).toBe(originalData.length);
    expect(Array.from(result)).toEqual(Array.from(originalData));
  }, TEST_TIMEOUT);

  it('should support selective extraction', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Selection timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'selection-updated') {
          clearTimeout(timeout);
          decompressWorker.removeEventListener('message', handler);
          expect(event.data.selectedCount).toBe(2);
          expect(event.data.fileIds).toEqual(['file1.txt', 'file2.txt']);
          resolve();
        }
      };

      decompressWorker.addEventListener('message', handler);
      decompressWorker.postMessage({
        type: 'set-selection',
        fileIds: ['file1.txt', 'file2.txt'],
      });
    });
  }, TEST_TIMEOUT);

  it('should skip unselected chunks', async () => {
    // Set selection
    decompressWorker.postMessage({
      type: 'set-selection',
      fileIds: ['file1.txt'],
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Skip timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'chunk-skipped') {
          clearTimeout(timeout);
          decompressWorker.removeEventListener('message', handler);
          expect(event.data.reason).toBe('not-selected');
          resolve();
        }
      };

      decompressWorker.addEventListener('message', handler);
      
      const data = new Uint8Array(compressedData);
      decompressWorker.postMessage(
        { type: 'process-chunk', index: 200, buffer: data.buffer, fileId: 'file2.txt' },
        [data.buffer]
      );
    });
  }, TEST_TIMEOUT);

  it('should handle prefetch hints', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Prefetch timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'prefetch-acknowledged') {
          clearTimeout(timeout);
          decompressWorker.removeEventListener('message', handler);
          expect(event.data.nextIndex).toBe(300);
          resolve();
        }
      };

      decompressWorker.addEventListener('message', handler);
      decompressWorker.postMessage({
        type: 'prefetch-hint',
        nextIndex: 300,
      });
    });
  }, TEST_TIMEOUT);

  it('should reject invalid compressed data', async () => {
    const invalidData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Error handling timeout')), 5000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'error') {
          clearTimeout(timeout);
          decompressWorker.removeEventListener('message', handler);
          expect(event.data.message).toContain('decompression failed');
          resolve();
        }
      };

      decompressWorker.addEventListener('message', handler);
      decompressWorker.postMessage(
        { type: 'process-chunk', index: 400, buffer: invalidData.buffer },
        [invalidData.buffer]
      );
    });
  }, TEST_TIMEOUT);
});

// ============================================================================
// Performance Tests
// ============================================================================

describe.skipIf(!hasWorkerSupport)('Worker Performance', () => {
  let worker: Worker;

  beforeAll(async () => {
    worker = await createWorker('../compressionWorker.ts');
    await initializeWorker(worker, WASM_URL);
  }, TEST_TIMEOUT);

  afterAll(() => {
    worker?.terminate();
  });

  it('should achieve >10MB/s throughput', async () => {
    const chunkSize = 10 * 1024 * 1024; // 10MB
    const testData = new Uint8Array(chunkSize).fill(100);

    const startTime = performance.now();
    await processChunk(worker, 0, testData);
    const elapsed = performance.now() - startTime;

    const throughputMBps = (chunkSize / (1024 * 1024)) / (elapsed / 1000);
    
    expect(throughputMBps).toBeGreaterThan(10);
  }, TEST_TIMEOUT);

  it('should handle 100 sequential chunks efficiently', async () => {
    const startTime = performance.now();

    const promises = [];
    for (let i = 0; i < 100; i++) {
      const data = new Uint8Array(10 * 1024).fill(i % 256); // 10KB each
      promises.push(processChunk(worker, 1000 + i, data));
    }

    await Promise.all(promises);

    const elapsed = performance.now() - startTime;
    const avgTimePerChunk = elapsed / 100;

    expect(avgTimePerChunk).toBeLessThan(100); // <100ms per chunk
  }, TEST_TIMEOUT);

  it('should maintain stable memory usage', async () => {
    // Process multiple chunks and check for leaks
    for (let i = 0; i < 50; i++) {
      const data = new Uint8Array(1024 * 1024).fill(i % 256);
      await processChunk(worker, 2000 + i, data);
    }

    // Wait for memory cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Worker should still be responsive
    const testData = new Uint8Array(1024).fill(42);
    const result = await processChunk(worker, 3000, testData);
    
    expect(result).toBeDefined();
  }, TEST_TIMEOUT);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe.skipIf(!hasWorkerSupport)('Worker Error Handling', () => {
  let worker: Worker;

  beforeEach(async () => {
    worker = await createWorker('../compressionWorker.ts');
    await initializeWorker(worker, WASM_URL);
  });

  afterEach(() => {
    worker?.terminate();
  });

  it('should recover from WASM errors', async () => {
    // Trigger an error
    worker.postMessage({
      type: 'process-chunk',
      index: 9999,
      buffer: new ArrayBuffer(0),
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Should still be able to process valid chunks
    const testData = new Uint8Array(1024).fill(42);
    const result = await processChunk(worker, 10000, testData);
    
    expect(result).toBeDefined();
  }, TEST_TIMEOUT);

  it('should handle unknown message types', async () => {
    return new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === 'error') {
          expect(event.data.message).toContain('Unknown message type');
          worker.removeEventListener('message', handler);
          resolve();
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'invalid-type' });
    });
  }, TEST_TIMEOUT);
});
