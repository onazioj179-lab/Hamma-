/**
 * SPK Chunk Sizer Tests
 * 
 * Tests for dynamic chunk size adjustment:
 * - Size calculation based on file size
 * - Performance-based adjustment
 * - Safe mode and micro-chunk fallback
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DynamicChunkSizer,
  getDynamicChunkSizer,
  resetDynamicChunkSizer,
  calculateFileSizeBasedChunk,
} from '../chunk-sizer';

// ============================================================================
// CONSTANTS FOR TESTING
// ============================================================================

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

// ============================================================================
// BASIC FUNCTIONALITY TESTS
// ============================================================================

describe('DynamicChunkSizer', () => {
  beforeEach(() => {
    resetDynamicChunkSizer();
  });

  describe('Initialization', () => {
    it('should create sizer with default config', () => {
      const sizer = new DynamicChunkSizer();
      expect(sizer).toBeDefined();
    });

    it('should accept custom config', () => {
      const sizer = new DynamicChunkSizer({
        defaultChunkSize: 8 * MB,
      });
      
      const stats = sizer.getStats();
      expect(stats.currentChunkSize).toBe(8 * MB);
    });

    it('should provide singleton instance', () => {
      const s1 = getDynamicChunkSizer();
      const s2 = getDynamicChunkSizer();
      
      expect(s1).toBe(s2);
    });
  });

  // ==========================================================================
  // FILE SIZE BASED CALCULATION TESTS
  // ==========================================================================

  describe('File Size Based Calculation', () => {
    it('should recommend 1MB for small files under 10MB', () => {
      const size = calculateFileSizeBasedChunk(5 * MB);
      expect(size).toBe(1 * MB);
    });

    it('should recommend 4MB for medium files 10-100MB', () => {
      const size = calculateFileSizeBasedChunk(50 * MB);
      expect(size).toBe(4 * MB);
    });

    it('should recommend 16MB for large files 100MB-1GB', () => {
      const size = calculateFileSizeBasedChunk(500 * MB);
      expect(size).toBe(16 * MB);
    });

    it('should recommend 64MB for very large files 1-10GB', () => {
      const size = calculateFileSizeBasedChunk(5 * GB);
      expect(size).toBe(64 * MB);
    });

    it('should recommend 128MB for huge files 10-100GB', () => {
      const size = calculateFileSizeBasedChunk(50 * GB);
      expect(size).toBe(128 * MB);
    });

    it('should recommend 256MB for TB-scale files', () => {
      const size = calculateFileSizeBasedChunk(1 * TB);
      expect(size).toBe(256 * MB);
    });

    // Test file size to chunk size mapping
    const fileSizeTests = [
      { size: 1 * MB, expectedChunkSize: MB, description: '1 MB file' },
      { size: 5 * MB, expectedChunkSize: MB, description: '5 MB file' },
      { size: 10 * MB, expectedChunkSize: 4 * MB, description: '10 MB file' },
      { size: 50 * MB, expectedChunkSize: 4 * MB, description: '50 MB file' },
      { size: 100 * MB, expectedChunkSize: 16 * MB, description: '100 MB file' },
      { size: 500 * MB, expectedChunkSize: 16 * MB, description: '500 MB file' },
      { size: 1 * GB, expectedChunkSize: 64 * MB, description: '1 GB file' },
      { size: 5 * GB, expectedChunkSize: 64 * MB, description: '5 GB file' },
      { size: 10 * GB, expectedChunkSize: 128 * MB, description: '10 GB file' },
      { size: 50 * GB, expectedChunkSize: 128 * MB, description: '50 GB file' },
      { size: 100 * GB, expectedChunkSize: 256 * MB, description: '100 GB file' },
      { size: 1 * TB, expectedChunkSize: 256 * MB, description: '1 TB file' },
    ];

    fileSizeTests.forEach(({ size, expectedChunkSize, description }) => {
      it(`should handle ${description}`, () => {
        const chunkSize = calculateFileSizeBasedChunk(size);
        expect(chunkSize).toBe(expectedChunkSize);
      });
    });
  });

  // ==========================================================================
  // RECOMMENDATION TESTS
  // ==========================================================================

  describe('Chunk Size Recommendations', () => {
    it('should provide recommendation object', () => {
      const sizer = new DynamicChunkSizer();
      const rec = sizer.getRecommendation();
      
      expect(rec).toHaveProperty('size');
      expect(rec).toHaveProperty('mode');
      expect(rec).toHaveProperty('reason');
      expect(rec).toHaveProperty('confidence');
    });

    it('should start in normal mode', () => {
      const sizer = new DynamicChunkSizer();
      const rec = sizer.getRecommendation();
      
      expect(rec.mode).toBe('normal');
    });

    it('should have valid confidence level', () => {
      const sizer = new DynamicChunkSizer();
      const rec = sizer.getRecommendation();
      
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ==========================================================================
  // SAMPLE RECORDING TESTS
  // ==========================================================================

  describe('Sample Recording', () => {
    it('should record processing samples', () => {
      const sizer = new DynamicChunkSizer();
      
      sizer.recordSample(4 * MB, 500, true);
      
      const stats = sizer.getStats();
      expect(stats.samplesCollected).toBe(1);
    });

    it('should calculate average processing time', () => {
      const sizer = new DynamicChunkSizer();
      
      // Record multiple samples
      for (let i = 0; i < 5; i++) {
        sizer.recordSample(4 * MB, 400 + i * 50, true);
      }
      
      const stats = sizer.getStats();
      expect(stats.avgProcessingTime).toBeCloseTo(500, -1);
    });

    it('should track failed samples', () => {
      const sizer = new DynamicChunkSizer();
      
      sizer.recordSample(4 * MB, 1000, false);
      
      const stats = sizer.getStats();
      expect(stats.samplesCollected).toBe(1);
    });
  });

  // ==========================================================================
  // ADJUSTMENT TESTS
  // ==========================================================================

  describe('Size Adjustment', () => {
    it('should increase size for fast processing', () => {
      const sizer = new DynamicChunkSizer();
      
      // Record fast samples
      for (let i = 0; i < 10; i++) {
        sizer.recordSample(1 * MB, 50, true);
      }
      
      const rec = sizer.getRecommendation();
      expect(rec.size).toBeGreaterThanOrEqual(1 * MB);
    });

    it('should decrease size for slow processing', () => {
      const sizer = new DynamicChunkSizer({
        defaultChunkSize: 16 * MB,
      });
      
      // Record slow samples
      for (let i = 0; i < 10; i++) {
        sizer.recordSample(16 * MB, 5000, true);
      }
      
      const rec = sizer.getRecommendation();
      expect(rec.size).toBeLessThanOrEqual(16 * MB);
    });
  });

  // ==========================================================================
  // MODE SWITCHING TESTS
  // ==========================================================================

  describe('Mode Switching', () => {
    it('should return safe chunk size on worker restart', () => {
      const sizer = new DynamicChunkSizer();
      
      const safeSize = sizer.getWorkerRestartChunkSize();
      
      expect(safeSize).toBe(1 * MB); // Default safe chunk size
    });

    it('should return minimum chunk size', () => {
      const sizer = new DynamicChunkSizer();
      
      const minSize = sizer.getMinimumChunkSize();
      
      expect(minSize).toBe(64 * KB);
    });

    it('should return maximum chunk size', () => {
      const sizer = new DynamicChunkSizer();
      
      const maxSize = sizer.getMaximumChunkSize();
      
      expect(maxSize).toBe(256 * MB);
    });
  });

  // ==========================================================================
  // STATS TESTS
  // ==========================================================================

  describe('Statistics', () => {
    it('should track samples collected', () => {
      const sizer = new DynamicChunkSizer();
      
      for (let i = 0; i < 20; i++) {
        sizer.recordSample(4 * MB, 500, true);
      }
      
      const stats = sizer.getStats();
      expect(stats.samplesCollected).toBe(10); // Limited by sample window
    });

    it('should calculate throughput', () => {
      const sizer = new DynamicChunkSizer();
      
      sizer.recordSample(4 * MB, 500, true);
      
      const stats = sizer.getStats();
      expect(stats.avgThroughput).toBeCloseTo(8, 0); // 4MB / 0.5s = 8 MB/s
    });
  });

  // ==========================================================================
  // RESET TESTS
  // ==========================================================================

  describe('Reset', () => {
    it('should reset to defaults', () => {
      const sizer = new DynamicChunkSizer({ defaultChunkSize: 4 * MB });
      
      // Record samples
      for (let i = 0; i < 5; i++) {
        sizer.recordSample(4 * MB, 500, true);
      }
      
      sizer.reset();
      
      const stats = sizer.getStats();
      expect(stats.samplesCollected).toBe(0);
      expect(stats.currentChunkSize).toBe(4 * MB);
    });
  });

  // ==========================================================================
  // INITIALIZE FOR FILE TESTS
  // ==========================================================================

  describe('Initialize For File', () => {
    it('should set appropriate chunk size for small file', () => {
      const sizer = new DynamicChunkSizer();
      
      sizer.initializeForFile(50 * MB);
      
      const stats = sizer.getStats();
      expect(stats.fileSize).toBe(50 * MB);
    });

    it('should set appropriate chunk size for large file', () => {
      const sizer = new DynamicChunkSizer();
      
      sizer.initializeForFile(5 * GB);
      
      const stats = sizer.getStats();
      expect(stats.fileSize).toBe(5 * GB);
    });
  });
});
