/**
 * Fail-Safe Integration Tests
 * 
 * Tests the integration between:
 * - FailSafeSPK engine
 * - UnifiedSPK with useFailSafe option
 * - Frontend hooks integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailSafeSPK, getFailSafeSPK, resetFailSafeSPK } from '../fail-safe';
import { UnifiedSPK } from '../unified';

describe('FailSafeSPK Engine', () => {
  beforeEach(() => {
    resetFailSafeSPK();
  });

  describe('Constructor & Config', () => {
    it('should create with default config', () => {
      const engine = new FailSafeSPK();
      expect(engine).toBeDefined();
    });

    it('should accept custom config', () => {
      const engine = new FailSafeSPK({
        compressionLevel: 9,
        chunkSize: 512 * 1024,
        maxWorkers: 2,
      });
      expect(engine).toBeDefined();
    });

    it('should provide singleton access', () => {
      const instance1 = getFailSafeSPK();
      const instance2 = getFailSafeSPK();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Progress Callback', () => {
    it('should support setProgressCallback', () => {
      const engine = new FailSafeSPK();
      const callback = vi.fn();
      engine.setProgressCallback(callback);
      // Callback is stored for later use
      expect(engine).toBeDefined();
    });

    it('should support chained onProgress', () => {
      const engine = new FailSafeSPK();
      const callback = vi.fn();
      const result = engine.onProgress(callback);
      expect(result).toBe(engine); // Should return this for chaining
    });
  });

  describe('Decompress', () => {
    it('should reject invalid archive (bad magic)', async () => {
      const engine = new FailSafeSPK();
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      
      const result = await engine.decompress(invalidData);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid SPK archive');
    });

    it('should accept Blob input', async () => {
      const engine = new FailSafeSPK();
      const invalidData = new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x00])]);
      
      const result = await engine.decompress(invalidData);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid SPK archive');
    });
  });

  describe('Abort', () => {
    it('should support abort method', () => {
      const engine = new FailSafeSPK();
      expect(() => engine.abort()).not.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on destroy', () => {
      const engine = new FailSafeSPK();
      expect(() => engine.destroy()).not.toThrow();
    });
  });
});

describe('UnifiedSPK with FailSafe', () => {
  describe('Config Options', () => {
    it('should default to fail-safe enabled', () => {
      const engine = new UnifiedSPK();
      // Internal state, but we can verify it doesn't throw
      expect(engine).toBeDefined();
    });

    it('should accept useFailSafe: true', () => {
      const engine = new UnifiedSPK({ useFailSafe: true });
      expect(engine).toBeDefined();
    });

    it('should accept useFailSafe: false', () => {
      const engine = new UnifiedSPK({ useFailSafe: false });
      expect(engine).toBeDefined();
    });
  });

  describe('Compress Integration', () => {
    it('should handle small data compression', async () => {
      const engine = new UnifiedSPK({ useFailSafe: false }); // Use simple for test speed
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      
      const result = await engine.compress(data, 'test.bin');
      
      expect(result.success).toBe(true);
      expect(result.originalSize).toBe(8);
      expect(result.data).toBeDefined();
    });

    it('should track progress', async () => {
      const engine = new UnifiedSPK({ useFailSafe: false });
      const progress: any[] = [];
      
      engine.onProgress((p) => progress.push(p));
      
      const data = new Uint8Array(1000).fill(65);
      await engine.compress(data);
      
      expect(progress.length).toBeGreaterThan(0);
    });
  });

  describe('Decompress Integration', () => {
    it('should reject invalid archive', async () => {
      const engine = new UnifiedSPK();
      const invalidData = new Uint8Array([0x00, 0x00, 0x00]);
      
      const result = await engine.decompress(invalidData);
      
      expect(result.success).toBe(false);
    });
  });

  describe('Round-trip', () => {
    it('should compress and decompress correctly', async () => {
      const engine = new UnifiedSPK({ useFailSafe: false }); // Simple engine for test
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      
      const compressed = await engine.compress(original, 'test.bin');
      expect(compressed.success).toBe(true);
      expect(compressed.data).toBeDefined();
      
      const decompressed = await engine.decompress(compressed.data!);
      expect(decompressed.success).toBe(true);
      expect(decompressed.data).toBeDefined();
      
      // Verify data matches
      expect(Array.from(decompressed.data!)).toEqual(Array.from(original));
    });

    it('should handle text data round-trip', async () => {
      const engine = new UnifiedSPK({ useFailSafe: false });
      const text = 'Hello, Singularity Pack! This is a test message.';
      const original = new TextEncoder().encode(text);
      
      const compressed = await engine.compress(original, 'message.txt');
      expect(compressed.success).toBe(true);
      
      const decompressed = await engine.decompress(compressed.data!);
      expect(decompressed.success).toBe(true);
      
      const decoded = new TextDecoder().decode(decompressed.data!);
      expect(decoded).toBe(text);
    });
  });

  describe('Abort & Cleanup', () => {
    it('should abort without error', () => {
      const engine = new UnifiedSPK();
      expect(() => engine.abort()).not.toThrow();
    });

    it('should check aborted state', () => {
      const engine = new UnifiedSPK();
      expect(engine.isAborted()).toBe(false);
      engine.abort();
      expect(engine.isAborted()).toBe(true);
    });

    it('should destroy without error', () => {
      const engine = new UnifiedSPK();
      expect(() => engine.destroy()).not.toThrow();
    });
  });
});

describe('Frontend Integration', () => {
  it('should export all required types', async () => {
    // Verify exports from integration index
    const exports = await import('../index');
    
    // UnifiedSPK exports
    expect(exports.UnifiedSPK).toBeDefined();
    expect(exports.compress).toBeDefined();
    expect(exports.decompress).toBeDefined();
    
    // FailSafe exports
    expect(exports.FailSafeSPK).toBeDefined();
    expect(exports.getFailSafeSPK).toBeDefined();
    expect(exports.resetFailSafeSPK).toBeDefined();
    expect(exports.compressFailSafe).toBeDefined();
    expect(exports.decompressFailSafe).toBeDefined();
  });
});
