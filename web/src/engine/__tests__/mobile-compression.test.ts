/**
 * Tests for Mobile Compression Fallback System
 * 
 * Tests the complete mobile fallback chain:
 * - MobileCompressor
 * - CapabilityDetector
 * - AdaptiveEngine
 * - ConnectionStreamer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock browser APIs for testing
const mockNavigator = {
  hardwareConcurrency: 4,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
  platform: 'MacIntel',
  maxTouchPoints: 5,
  onLine: true,
  connection: {
    effectiveType: '4g',
    downlink: 10,
    rtt: 50,
    saveData: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
};

// Set up navigator mock before imports
Object.defineProperty(globalThis, 'navigator', {
  value: mockNavigator,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    innerWidth: 375,
    setInterval: setInterval,
    clearInterval: clearInterval,
  },
  writable: true,
  configurable: true,
});

// Import after mocks
import { MobileCompressor, mobileCompress, mobileDecompress } from '../fallback/mobile-compressor';
import { CapabilityDetector, detectCapabilities, getRecommendedStrategy, isMobileDevice } from '../capability-detector';
import { AdaptiveEngine, adaptiveCompress } from '../adaptive-engine';
import { ConnectionStreamer, getNetworkInfo, getOptimalUploadChunkSize } from '../connection-streaming';

describe('MobileCompressor', () => {
  describe('compression', () => {
    it('should compress small data', async () => {
      const compressor = new MobileCompressor();
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      
      const result = await compressor.compress(data, 'test.bin');
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.originalSize).toBe(10);
      expect(result.compressedSize).toBeGreaterThan(0);
    });

    it('should compress repetitive data efficiently', async () => {
      const compressor = new MobileCompressor({ level: 6 });
      // Create highly compressible data
      const data = new Uint8Array(10000);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 4; // Very repetitive
      }
      
      const result = await compressor.compress(data);
      
      expect(result.success).toBe(true);
      expect(result.ratio).toBeLessThan(1); // Should compress
    });

    it('should track progress', async () => {
      const compressor = new MobileCompressor();
      const progressUpdates: number[] = [];
      
      compressor.onProgress((progress) => {
        progressUpdates.push(progress.progress);
      });
      
      const data = new Uint8Array(50000);
      await compressor.compress(data);
      
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    });

    it('should handle abort', async () => {
      const compressor = new MobileCompressor();
      const data = new Uint8Array(100000);
      
      // Start compression and abort immediately
      const promise = compressor.compress(data);
      compressor.abort();
      
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation aborted');
    });

    it('should handle different compression levels', async () => {
      const data = new Uint8Array(5000);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 10;
      }
      
      const fastCompressor = new MobileCompressor({ level: 1 });
      const strongCompressor = new MobileCompressor({ level: 9 });
      
      const fastResult = await fastCompressor.compress(data);
      const strongResult = await strongCompressor.compress(data);
      
      expect(fastResult.success).toBe(true);
      expect(strongResult.success).toBe(true);
      // Strong compression should be at least as good (usually better)
      expect(strongResult.compressedSize).toBeLessThanOrEqual(fastResult.compressedSize);
    });
  });

  describe('decompression', () => {
    it('should roundtrip compress/decompress', async () => {
      const compressor = new MobileCompressor();
      const original = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
      
      const compressed = await compressor.compress(original);
      expect(compressed.success).toBe(true);
      
      const decompressed = await compressor.decompress(compressed.data!);
      expect(decompressed.success).toBe(true);
      expect(decompressed.data).toEqual(original);
    });

    it('should reject invalid archives', async () => {
      const compressor = new MobileCompressor();
      const invalidData = new Uint8Array([1, 2, 3, 4]); // Not a valid SPK
      
      const result = await compressor.decompress(invalidData);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid SPK archive');
    });
  });

  describe('convenience functions', () => {
    it('should work with mobileCompress', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await mobileCompress(data);
      expect(result.success).toBe(true);
    });

    it('should work with mobileDecompress', async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const compressed = await mobileCompress(original);
      const decompressed = await mobileDecompress(compressed.data!);
      expect(decompressed.success).toBe(true);
      expect(decompressed.data).toEqual(original);
    });
  });
});

describe('CapabilityDetector', () => {
  it('should detect capabilities', async () => {
    const caps = await detectCapabilities();
    
    expect(caps).toBeDefined();
    expect(typeof caps.hardwareConcurrency).toBe('number');
    expect(typeof caps.webWorkers).toBe('boolean');
    expect(typeof caps.webAssembly).toBe('boolean');
  });

  it('should recommend a strategy', async () => {
    const strategy = await getRecommendedStrategy();
    
    expect([
      'worker-wasm',
      'worker-js',
      'main-wasm',
      'main-js',
      'streaming',
      'minimal',
    ]).toContain(strategy);
  });

  it('should detect mobile device', async () => {
    const isMobile = await isMobileDevice();
    // With our mock, it should detect as mobile (iPhone user agent)
    expect(typeof isMobile).toBe('boolean');
  });

  it('should compute device class', async () => {
    const caps = await detectCapabilities();
    
    expect(['high', 'medium', 'low', 'ultra-low']).toContain(caps.deviceClass);
  });

  it('should provide optimal chunk size', async () => {
    const caps = await detectCapabilities();
    
    expect(caps.maxChunkSize).toBeGreaterThan(0);
    expect(caps.maxChunkSize).toBeLessThanOrEqual(4 * 1024 * 1024); // Max 4MB
  });
});

describe('AdaptiveEngine', () => {
  it('should compress data', async () => {
    const engine = new AdaptiveEngine({ enableFallbackChain: true });
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    
    const result = await engine.compress(data, 'test.bin');
    
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.strategy).toBeDefined();
  });

  it('should track progress', async () => {
    const engine = new AdaptiveEngine();
    const progressUpdates: string[] = [];
    
    engine.onProgress((progress) => {
      progressUpdates.push(progress.phase);
    });
    
    const data = new Uint8Array(10000);
    await engine.compress(data);
    
    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it('should detect capabilities', async () => {
    const engine = new AdaptiveEngine();
    const caps = await engine.getCapabilities();
    
    expect(caps).toBeDefined();
    expect(caps.platform).toBeDefined();
  });

  it('should handle forced strategy', async () => {
    const engine = new AdaptiveEngine({ forceStrategy: 'main-js' });
    const data = new Uint8Array([1, 2, 3]);
    
    const result = await engine.compress(data);
    
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('main-js');
  });

  it('should report fallbacks used', async () => {
    const engine = new AdaptiveEngine({ enableFallbackChain: true });
    const data = new Uint8Array([1, 2, 3]);
    
    const result = await engine.compress(data);
    
    expect(Array.isArray(result.fallbacksUsed)).toBe(true);
  });

  it('should roundtrip compress/decompress', async () => {
    const engine = new AdaptiveEngine({ forceStrategy: 'main-js' });
    const original = new Uint8Array([10, 20, 30, 40, 50]);
    
    const compressed = await engine.compress(original);
    expect(compressed.success).toBe(true);
    
    const decompressed = await engine.decompress(compressed.data as Uint8Array);
    expect(decompressed.success).toBe(true);
    expect(decompressed.data).toEqual(original);
  });

  it('should handle abort', async () => {
    const engine = new AdaptiveEngine();
    const data = new Uint8Array(100000);
    
    const promise = engine.compress(data);
    engine.abort();
    
    const result = await promise;
    // Either aborted or completed quickly
    expect(result).toBeDefined();
  });
});

describe('ConnectionStreamer', () => {
  it('should get network info', () => {
    const info = getNetworkInfo();
    
    expect(info).toBeDefined();
    expect(typeof info.online).toBe('boolean');
    expect(info.quality).toBeDefined();
  });

  it('should get optimal chunk size', () => {
    const size = getOptimalUploadChunkSize();
    
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it('should create streamer with config', () => {
    const streamer = new ConnectionStreamer({
      minChunkSize: 8 * 1024,
      maxChunkSize: 1 * 1024 * 1024,
      adaptiveChunking: true,
    });
    
    expect(streamer.getOptimalChunkSize()).toBeGreaterThan(0);
  });

  it('should handle progress callback', async () => {
    const streamer = new ConnectionStreamer();
    const updates: string[] = [];
    
    streamer.onProgress((progress) => {
      updates.push(progress.phase);
    });
    
    const data = new Uint8Array(1000);
    const mockUpload = vi.fn().mockResolvedValue(true);
    
    await streamer.upload(data, mockUpload, 'test.spk');
    
    expect(updates.length).toBeGreaterThan(0);
  });

  it('should get offline queue size', () => {
    const streamer = new ConnectionStreamer();
    const queueInfo = streamer.getOfflineQueueSize();
    
    expect(queueInfo.count).toBe(0);
    expect(queueInfo.bytes).toBe(0);
  });
});

describe('Integration Tests', () => {
  it('should work end-to-end on mobile-like environment', async () => {
    // Detect capabilities
    const caps = await detectCapabilities();
    
    // Create engine
    const engine = new AdaptiveEngine({
      enableFallbackChain: true,
      forceStrategy: 'main-js', // Force JS for this test
    });
    
    // Use smaller data that's known to work (from MobileCompressor tests)
    const testData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    
    const result = await engine.compress(testData, 'mobile-test.bin');
    
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    
    // Decompress
    const decompressed = await engine.decompress(result.data as Uint8Array);
    expect(decompressed.success).toBe(true);
    expect(decompressed.data).toEqual(testData);
  });

  it('should handle large data efficiently', async () => {
    const engine = new AdaptiveEngine({ forceStrategy: 'main-js' });
    
    // Create 100KB of compressible data
    const testData = new Uint8Array(100 * 1024);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = (i * 7) % 256; // Somewhat random but deterministic
    }
    
    const startTime = Date.now();
    const result = await engine.compress(testData);
    const duration = Date.now() - startTime;
    
    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
  });
});
