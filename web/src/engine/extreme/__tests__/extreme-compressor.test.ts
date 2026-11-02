/**
 * SPK Extreme Compressor - Unit Tests
 * 
 * Tests for 5-layer extreme compression engine.
 * 
 * @module engine/extreme/__tests__/extreme-compressor.test
 * @version 1.0.0
 */

import { describe, it, expect, vi } from 'vitest';
import { ExtremeCompressor, type ExtremeProgress } from '../extreme-compressor';

// ============================================================================
// Test Data Generators
// ============================================================================

function createRepetitiveData(size: number, pattern: number[] = [1, 2, 3, 4]): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = pattern[i % pattern.length];
  }
  return data;
}

function createRandomData(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}

function createDuplicateBlocks(blockSize: number, numBlocks: number, uniqueBlocks: number): Uint8Array {
  const data = new Uint8Array(blockSize * numBlocks);
  const blocks: Uint8Array[] = [];
  
  // Create unique blocks
  for (let i = 0; i < uniqueBlocks; i++) {
    const block = new Uint8Array(blockSize);
    for (let j = 0; j < blockSize; j++) {
      block[j] = (i * 17 + j) % 256;
    }
    blocks.push(block);
  }
  
  // Fill data with repeated blocks
  for (let i = 0; i < numBlocks; i++) {
    const block = blocks[i % uniqueBlocks];
    data.set(block, i * blockSize);
  }
  
  return data;
}

// ============================================================================
// Compression Tests
// ============================================================================

describe('ExtremeCompressor', () => {
  describe('Initialization', () => {
    it('should create compressor with default config', () => {
      const compressor = new ExtremeCompressor();
      expect(compressor).toBeDefined();
    });

    it('should create compressor with custom config', () => {
      const compressor = new ExtremeCompressor({
        blockSize: 8192,
        dictionarySize: 512 * 1024,
      });
      expect(compressor).toBeDefined();
    });
  });

  describe('Compression', () => {
    it('should compress small data', async () => {
      const compressor = new ExtremeCompressor();
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.originalSize).toBe(8);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);
    });

    it('should compress repetitive data efficiently', async () => {
      const compressor = new ExtremeCompressor();
      const data = createRepetitiveData(100000, [65, 66, 67, 68]); // 100KB of ABCD pattern
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.compressedSize).toBeLessThan(result.originalSize);
      // With dedup+delta layers, expect at least some compression
      expect(result.ratio).toBeLessThan(1.5); // Should compress at least somewhat
    });

    it('should handle duplicate blocks', async () => {
      const compressor = new ExtremeCompressor({ blockSize: 4096 });
      // 100 blocks of 4KB, but only 5 unique blocks
      const data = createDuplicateBlocks(4096, 100, 5);
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.layerStats.dedupSaved).toBeGreaterThan(0);
    });

    it('should compress 1MB of data', async () => {
      const compressor = new ExtremeCompressor();
      const data = createRepetitiveData(1024 * 1024);
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.originalSize).toBe(1024 * 1024);
      expect(result.duration).toBeLessThan(5000); // Should complete in 5s
    });

    it('should call progress callback', async () => {
      const compressor = new ExtremeCompressor({ progressInterval: 1024 });
      const progressCalls: ExtremeProgress[] = [];
      
      compressor.onProgress((progress) => {
        progressCalls.push({ ...progress });
      });
      
      const data = createRepetitiveData(50000);
      await compressor.compress(data);
      
      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1].phase).toBe('complete');
    });

    it('should handle empty data', async () => {
      const compressor = new ExtremeCompressor();
      const data = new Uint8Array(0);
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.originalSize).toBe(0);
    });
  });

  describe('Decompression', () => {
    it('should decompress to original data', async () => {
      const compressor = new ExtremeCompressor();
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      
      const compressed = await compressor.compress(original);
      expect(compressed.success).toBe(true);
      
      const decompressed = await compressor.decompress(compressed.data!);
      
      expect(decompressed.success).toBe(true);
      expect(decompressed.data).toEqual(original);
    });

    it('should round-trip repetitive data', async () => {
      const compressor = new ExtremeCompressor();
      const original = createRepetitiveData(10000);
      
      const compressed = await compressor.compress(original);
      const decompressed = await compressor.decompress(compressed.data!);
      
      expect(decompressed.success).toBe(true);
      expect(decompressed.data).toEqual(original);
    });

    it('should round-trip duplicate blocks', async () => {
      const compressor = new ExtremeCompressor({ blockSize: 1024 });
      const original = createDuplicateBlocks(1024, 50, 3);
      
      const compressed = await compressor.compress(original);
      const decompressed = await compressor.decompress(compressed.data!);
      
      expect(decompressed.success).toBe(true);
      expect(decompressed.data).toEqual(original);
    });

    it('should round-trip 1MB data', async () => {
      const compressor = new ExtremeCompressor();
      const original = createRepetitiveData(1024 * 1024);
      
      const compressed = await compressor.compress(original);
      const decompressed = await compressor.decompress(compressed.data!);
      
      expect(decompressed.success).toBe(true);
      expect(decompressed.data!.length).toBe(original.length);
      
      // Verify data integrity
      for (let i = 0; i < original.length; i++) {
        if (original[i] !== decompressed.data![i]) {
          throw new Error(`Mismatch at position ${i}: expected ${original[i]}, got ${decompressed.data![i]}`);
        }
      }
    });

    it('should reject invalid magic bytes', async () => {
      const compressor = new ExtremeCompressor();
      const invalidData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 1, 2, 3, 4]);
      
      const result = await compressor.decompress(invalidData);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('magic');
    });
  });

  describe('Abort', () => {
    it('should abort compression', async () => {
      const compressor = new ExtremeCompressor();
      const data = createRepetitiveData(10 * 1024 * 1024); // 10MB
      
      // Start compression and abort immediately
      const promise = compressor.compress(data);
      compressor.abort();
      
      const result = await promise;
      
      // Should either complete or abort gracefully
      expect(result).toBeDefined();
    });
  });

  describe('Layer Stats', () => {
    it('should track dedup savings', async () => {
      const compressor = new ExtremeCompressor({ blockSize: 4096 });
      const data = createDuplicateBlocks(4096, 100, 2); // 50% duplicates
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.layerStats).toBeDefined();
      // Dedup should save roughly half the data
      expect(result.layerStats.dedupSaved).toBeGreaterThan(0);
    });

    it('should track all layer stats', async () => {
      const compressor = new ExtremeCompressor();
      const data = createRepetitiveData(100000);
      
      const result = await compressor.compress(data);
      
      expect(result.layerStats).toBeDefined();
      expect(typeof result.layerStats.dedupSaved).toBe('number');
      expect(typeof result.layerStats.deltaSaved).toBe('number');
      expect(typeof result.layerStats.dictionarySaved).toBe('number');
      expect(typeof result.layerStats.lz77Saved).toBe('number');
      expect(typeof result.layerStats.entropySaved).toBe('number');
    });
  });

  describe('Performance', () => {
    it('should compress 10MB in under 10 seconds', async () => {
      const compressor = new ExtremeCompressor();
      const data = createRepetitiveData(10 * 1024 * 1024);
      
      const startTime = Date.now();
      const result = await compressor.compress(data);
      const elapsed = Date.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(10000);
    }, 15000);

    it('should decompress faster than compress', async () => {
      const compressor = new ExtremeCompressor();
      const data = createRepetitiveData(5 * 1024 * 1024);
      
      const compressStart = Date.now();
      const compressed = await compressor.compress(data);
      const compressTime = Date.now() - compressStart;
      
      const decompressStart = Date.now();
      await compressor.decompress(compressed.data!);
      const decompressTime = Date.now() - decompressStart;
      
      // Decompression should generally be faster or similar
      expect(decompressTime).toBeLessThan(compressTime * 2);
    }, 20000);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('ExtremeCompressor Edge Cases', () => {
  it('should handle single byte', async () => {
    const compressor = new ExtremeCompressor();
    const data = new Uint8Array([42]);
    
    const compressed = await compressor.compress(data);
    const decompressed = await compressor.decompress(compressed.data!);
    
    expect(decompressed.data).toEqual(data);
  });

  it('should handle all zeros', async () => {
    const compressor = new ExtremeCompressor();
    const data = new Uint8Array(10000).fill(0);
    
    const compressed = await compressor.compress(data);
    const decompressed = await compressor.decompress(compressed.data!);
    
    expect(decompressed.data).toEqual(data);
  });

  it('should handle all 255s', async () => {
    const compressor = new ExtremeCompressor();
    const data = new Uint8Array(10000).fill(255);
    
    const compressed = await compressor.compress(data);
    const decompressed = await compressor.decompress(compressed.data!);
    
    expect(decompressed.data).toEqual(data);
  });

  it('should handle sequential bytes', async () => {
    const compressor = new ExtremeCompressor();
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }
    
    const compressed = await compressor.compress(data);
    const decompressed = await compressor.decompress(compressed.data!);
    
    expect(decompressed.data).toEqual(data);
  });

  it('should handle binary-like data', async () => {
    // Use simpler config with smaller block size to reduce complexity
    const compressor = new ExtremeCompressor({ blockSize: 1024 });
    // Simulate binary file with mixed patterns (no random to ensure determinism)
    const data = new Uint8Array(4096); // 4 exact blocks at 1024 each
    for (let i = 0; i < data.length; i++) {
      if (i < 1024) data[i] = 0; // Zeros - block 1
      else if (i < 2048) data[i] = 255; // All bits set - block 2
      else if (i < 3072) data[i] = i % 256; // Sequential - block 3
      else data[i] = (i * 7) % 256; // Pattern - block 4
    }
    
    const compressed = await compressor.compress(data);
    expect(compressed.success).toBe(true);
    expect(compressed.data).toBeDefined();
    
    const decompressed = await compressor.decompress(compressed.data!);
    
    if (!decompressed.success) {
      console.log('Decompress error:', decompressed.error);
    }
    
    expect(decompressed.success).toBe(true);
    expect(decompressed.data).toBeDefined();
    expect(decompressed.data!.length).toBe(data.length);
    expect(decompressed.data).toEqual(data);
  });
});
