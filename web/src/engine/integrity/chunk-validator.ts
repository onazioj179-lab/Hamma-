/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Chunk Validator
 * Creator: OJ Treasure Onazi
 * 
 * Validates individual chunks for hash correctness, size accuracy,
 * offset alignment, and detects chunk-level anomalies.
 */

import {
  ChunkVerificationInfo,
  ChunkStatistics,
  AnomalyType,
  VerificationStatus,
  MB,
  KB,
  IntegrityEvent,
  IntegrityEventHandler,
} from '../core/types/integrity';

// ============================================================================
// CHUNK VALIDATOR CONFIG
// ============================================================================

export interface ChunkValidatorConfig {
  /** Enable parallel hash verification */
  parallelHashing: boolean;
  
  /** Max concurrent hash operations */
  maxConcurrentHashes: number;
  
  /** Use WASM-accelerated SHA-256 */
  wasmHashing: boolean;
  
  /** Timeout per chunk hash (ms) */
  hashTimeout: number;
  
  /** Max acceptable compression ratio deviation */
  maxRatioDeviation: number;
  
  /** Max acceptable size deviation (%) */
  maxSizeDeviation: number;
  
  /** Enable quick validation (hash only) */
  quickValidation: boolean;
  
  /** Sample rate for quick validation (0-1) */
  quickSampleRate: number;
}

export const DEFAULT_CHUNK_VALIDATOR_CONFIG: ChunkValidatorConfig = {
  parallelHashing: true,
  maxConcurrentHashes: 8,
  wasmHashing: true,
  hashTimeout: 30000,
  maxRatioDeviation: 0.5,  // 50% deviation from average
  maxSizeDeviation: 20,    // 20% size deviation
  quickValidation: false,
  quickSampleRate: 0.1,
};

// ============================================================================
// CHUNK HASH CACHE
// ============================================================================

interface HashCacheEntry {
  hash: string;
  timestamp: number;
  verified: boolean;
}

class ChunkHashCache {
  private cache = new Map<number, HashCacheEntry>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize = 10000, ttl = 300000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(chunkIndex: number): string | null {
    const entry = this.cache.get(chunkIndex);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(chunkIndex);
      return null;
    }
    return entry.hash;
  }

  set(chunkIndex: number, hash: string, verified = false): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < Math.floor(this.maxSize * 0.1); i++) {
        this.cache.delete(entries[i][0]);
      }
    }
    this.cache.set(chunkIndex, {
      hash,
      timestamp: Date.now(),
      verified,
    });
  }

  markVerified(chunkIndex: number): void {
    const entry = this.cache.get(chunkIndex);
    if (entry) {
      entry.verified = true;
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// CHUNK VALIDATOR
// ============================================================================

export class ChunkValidator {
  private config: ChunkValidatorConfig;
  private hashCache: ChunkHashCache;
  private eventHandlers: Set<IntegrityEventHandler> = new Set();
  private activeHashes = 0;
  private hashQueue: Array<() => Promise<void>> = [];
  private avgCompressionRatio = 0;
  private avgChunkSize = 0;
  private processingStats: Map<number, ChunkStatistics> = new Map();

  constructor(config: Partial<ChunkValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CHUNK_VALIDATOR_CONFIG, ...config };
    this.hashCache = new ChunkHashCache();
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: IntegrityEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: IntegrityEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: IntegrityEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // BASELINE STATISTICS
  // ==========================================================================

  setBaselineStatistics(
    avgRatio: number,
    avgSize: number,
    stats: ChunkStatistics[]
  ): void {
    this.avgCompressionRatio = avgRatio;
    this.avgChunkSize = avgSize;
    this.processingStats.clear();
    for (const stat of stats) {
      this.processingStats.set(stat.chunkIndex, stat);
    }
  }

  // ==========================================================================
  // HASH COMPUTATION
  // ==========================================================================

  private async computeHash(data: Uint8Array): Promise<string> {
    if (this.config.wasmHashing && typeof crypto !== 'undefined') {
      // Use SubtleCrypto (fast, native)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
      const hashArray = new Uint8Array(hashBuffer);
      return Array.from(hashArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Fallback: simple DJB2 hash (fast but not cryptographic)
    return this.djb2Hash(data);
  }

  private djb2Hash(data: Uint8Array): string {
    let hash = 5381;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) + hash) ^ data[i];
      hash = hash >>> 0; // Ensure unsigned
    }
    return hash.toString(16).padStart(8, '0');
  }

  private async queueHash(fn: () => Promise<void>): Promise<void> {
    if (this.activeHashes < this.config.maxConcurrentHashes) {
      this.activeHashes++;
      try {
        await fn();
      } finally {
        this.activeHashes--;
        this.processHashQueue();
      }
    } else {
      return new Promise((resolve, reject) => {
        this.hashQueue.push(async () => {
          try {
            await fn();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    }
  }

  private processHashQueue(): void {
    while (
      this.hashQueue.length > 0 &&
      this.activeHashes < this.config.maxConcurrentHashes
    ) {
      const next = this.hashQueue.shift();
      if (next) {
        this.activeHashes++;
        next().finally(() => {
          this.activeHashes--;
          this.processHashQueue();
        });
      }
    }
  }

  // ==========================================================================
  // SINGLE CHUNK VALIDATION
  // ==========================================================================

  async validateChunk(
    chunkIndex: number,
    data: Uint8Array,
    expectedHash: string,
    expectedSize: number,
    expectedOffset: bigint,
    actualOffset: bigint
  ): Promise<ChunkVerificationInfo> {
    const startTime = performance.now();
    const result: ChunkVerificationInfo = {
      chunkIndex,
      expectedHash,
      expectedSize,
      actualSize: data.length,
      expectedOffset,
      actualOffset,
      compressionRatio: 0,
      processingTime: 0,
      workerRetries: 0,
      status: 'pending',
      anomalies: [],
    };

    try {
      result.status = 'in-progress';

      // Size validation
      if (data.length !== expectedSize) {
        const deviation = Math.abs(data.length - expectedSize) / expectedSize;
        if (deviation > this.config.maxSizeDeviation / 100) {
          result.anomalies.push('size-mismatch');
        }
      }

      // Offset validation
      if (actualOffset !== expectedOffset) {
        const diff = actualOffset > expectedOffset
          ? actualOffset - expectedOffset
          : expectedOffset - actualOffset;
        if (diff > BigInt(0)) {
          result.anomalies.push(
            actualOffset > expectedOffset ? 'offset-gap' : 'offset-overlap'
          );
        }
      }

      // Hash validation
      await this.queueHash(async () => {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Hash timeout')), this.config.hashTimeout);
        });

        try {
          const actualHash = await Promise.race([
            this.computeHash(data),
            timeoutPromise,
          ]);
          result.actualHash = actualHash;
          this.hashCache.set(chunkIndex, actualHash, true);

          if (actualHash !== expectedHash) {
            result.anomalies.push('hash-mismatch');
          }
        } catch {
          result.anomalies.push('corrupt-chunk');
        }
      });

      // Get processing stats if available
      const stats = this.processingStats.get(chunkIndex);
      if (stats) {
        result.compressionRatio = stats.compressionRatio;
        result.workerRetries = stats.workerRetries;

        // Ratio anomaly detection
        if (this.avgCompressionRatio > 0) {
          const ratioDeviation = Math.abs(
            stats.compressionRatio - this.avgCompressionRatio
          ) / this.avgCompressionRatio;
          if (ratioDeviation > this.config.maxRatioDeviation) {
            result.anomalies.push('ratio-suspicious');
          }
        }
      }

      // Determine final status
      result.status = result.anomalies.length === 0 ? 'passed' : 'failed';
    } catch (error) {
      result.status = 'failed';
      result.anomalies.push('corrupt-chunk');
    }

    result.processingTime = performance.now() - startTime;
    return result;
  }

  // ==========================================================================
  // BATCH CHUNK VALIDATION
  // ==========================================================================

  async validateChunks(
    chunks: Array<{
      index: number;
      data: Uint8Array;
      expectedHash: string;
      expectedSize: number;
      expectedOffset: bigint;
      actualOffset: bigint;
    }>
  ): Promise<ChunkVerificationInfo[]> {
    const results: ChunkVerificationInfo[] = [];

    if (this.config.parallelHashing) {
      // Parallel validation
      const promises = chunks.map(chunk =>
        this.validateChunk(
          chunk.index,
          chunk.data,
          chunk.expectedHash,
          chunk.expectedSize,
          chunk.expectedOffset,
          chunk.actualOffset
        )
      );
      const settled = await Promise.allSettled(promises);
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            chunkIndex: chunks[i].index,
            expectedHash: chunks[i].expectedHash,
            expectedSize: chunks[i].expectedSize,
            expectedOffset: chunks[i].expectedOffset,
            compressionRatio: 0,
            processingTime: 0,
            workerRetries: 0,
            status: 'failed',
            anomalies: ['corrupt-chunk'],
          });
        }
      }
    } else {
      // Sequential validation
      for (const chunk of chunks) {
        const result = await this.validateChunk(
          chunk.index,
          chunk.data,
          chunk.expectedHash,
          chunk.expectedSize,
          chunk.expectedOffset,
          chunk.actualOffset
        );
        results.push(result);
      }
    }

    return results;
  }

  // ==========================================================================
  // QUICK VALIDATION (SAMPLE-BASED)
  // ==========================================================================

  async quickValidate(
    chunks: Array<{
      index: number;
      data: Uint8Array;
      expectedHash: string;
      expectedSize: number;
    }>,
    sampleRate?: number
  ): Promise<{
    sampledCount: number;
    passedCount: number;
    failedCount: number;
    estimatedHealthScore: number;
  }> {
    const rate = sampleRate ?? this.config.quickSampleRate;
    const sampleSize = Math.max(1, Math.ceil(chunks.length * rate));
    
    // Random sampling
    const indices = new Set<number>();
    while (indices.size < sampleSize && indices.size < chunks.length) {
      indices.add(Math.floor(Math.random() * chunks.length));
    }

    let passed = 0;
    let failed = 0;

    for (const i of indices) {
      const chunk = chunks[i];
      const hash = await this.computeHash(chunk.data);
      if (hash === chunk.expectedHash && chunk.data.length === chunk.expectedSize) {
        passed++;
      } else {
        failed++;
      }
    }

    const sampledCount = indices.size;
    const passRate = passed / sampledCount;
    // Extrapolate with confidence adjustment
    const confidence = Math.min(1, sampledCount / 100);
    const estimatedHealthScore = passRate * confidence + (1 - confidence) * 0.5;

    return {
      sampledCount,
      passedCount: passed,
      failedCount: failed,
      estimatedHealthScore,
    };
  }

  // ==========================================================================
  // CHUNK OFFSET VALIDATION
  // ==========================================================================

  validateChunkOffsets(
    chunks: Array<{
      index: number;
      size: number;
      offset: bigint;
    }>
  ): {
    valid: boolean;
    gaps: Array<{ afterChunk: number; gapSize: bigint }>;
    overlaps: Array<{ chunks: [number, number]; overlapSize: bigint }>;
  } {
    const sorted = [...chunks].sort((a, b) => 
      a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : 0
    );

    const gaps: Array<{ afterChunk: number; gapSize: bigint }> = [];
    const overlaps: Array<{ chunks: [number, number]; overlapSize: bigint }> = [];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const expectedStart = prev.offset + BigInt(prev.size);

      if (curr.offset > expectedStart) {
        // Gap detected
        gaps.push({
          afterChunk: prev.index,
          gapSize: curr.offset - expectedStart,
        });
      } else if (curr.offset < expectedStart) {
        // Overlap detected
        overlaps.push({
          chunks: [prev.index, curr.index],
          overlapSize: expectedStart - curr.offset,
        });
      }
    }

    return {
      valid: gaps.length === 0 && overlaps.length === 0,
      gaps,
      overlaps,
    };
  }

  // ==========================================================================
  // CHUNK COUNT VALIDATION
  // ==========================================================================

  validateChunkCount(
    expectedCount: number,
    actualCount: number,
    chunkIndices: number[]
  ): {
    valid: boolean;
    missingChunks: number[];
    extraChunks: number[];
    duplicateChunks: number[];
  } {
    const indexSet = new Set(chunkIndices);
    const missingChunks: number[] = [];
    const extraChunks: number[] = [];
    const duplicateChunks: number[] = [];

    // Find duplicates
    const seen = new Set<number>();
    for (const idx of chunkIndices) {
      if (seen.has(idx)) {
        duplicateChunks.push(idx);
      }
      seen.add(idx);
    }

    // Find missing (expected but not present)
    for (let i = 0; i < expectedCount; i++) {
      if (!indexSet.has(i)) {
        missingChunks.push(i);
      }
    }

    // Find extra (present but unexpected)
    for (const idx of chunkIndices) {
      if (idx >= expectedCount || idx < 0) {
        extraChunks.push(idx);
      }
    }

    return {
      valid: missingChunks.length === 0 && 
             extraChunks.length === 0 && 
             duplicateChunks.length === 0,
      missingChunks,
      extraChunks,
      duplicateChunks,
    };
  }

  // ==========================================================================
  // CHUNK SIZE VALIDATION
  // ==========================================================================

  validateChunkSizes(
    chunks: Array<{
      index: number;
      compressedSize: number;
      originalSize: number;
    }>,
    maxChunkSize: number = 4 * MB,
    minChunkSize: number = 1 * KB
  ): {
    valid: boolean;
    oversizedChunks: number[];
    undersizedChunks: number[];
    suspiciousRatios: number[];
  } {
    const oversizedChunks: number[] = [];
    const undersizedChunks: number[] = [];
    const suspiciousRatios: number[] = [];

    for (const chunk of chunks) {
      if (chunk.compressedSize > maxChunkSize) {
        oversizedChunks.push(chunk.index);
      }
      if (chunk.compressedSize < minChunkSize && chunk.originalSize >= minChunkSize) {
        undersizedChunks.push(chunk.index);
      }
      
      // Suspicious ratio: compressed larger than original or negative compression
      const ratio = chunk.compressedSize / chunk.originalSize;
      if (ratio > 1.5 || ratio < 0.01) {
        suspiciousRatios.push(chunk.index);
      }
    }

    return {
      valid: oversizedChunks.length === 0 && 
             undersizedChunks.length === 0 &&
             suspiciousRatios.length === 0,
      oversizedChunks,
      undersizedChunks,
      suspiciousRatios,
    };
  }

  // ==========================================================================
  // HASH COMPARISON UTILITIES
  // ==========================================================================

  async compareHashes(
    data1: Uint8Array,
    data2: Uint8Array
  ): Promise<boolean> {
    const [hash1, hash2] = await Promise.all([
      this.computeHash(data1),
      this.computeHash(data2),
    ]);
    return hash1 === hash2;
  }

  async computeMultipleHashes(
    dataArrays: Uint8Array[]
  ): Promise<string[]> {
    if (this.config.parallelHashing) {
      return Promise.all(dataArrays.map(d => this.computeHash(d)));
    }
    const results: string[] = [];
    for (const data of dataArrays) {
      results.push(await this.computeHash(data));
    }
    return results;
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  clearCache(): void {
    this.hashCache.clear();
    this.processingStats.clear();
  }

  getStats(): {
    cacheSize: number;
    activeHashes: number;
    queuedHashes: number;
  } {
    return {
      cacheSize: this.hashCache['cache'].size,
      activeHashes: this.activeHashes,
      queuedHashes: this.hashQueue.length,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChunkValidator(
  config?: Partial<ChunkValidatorConfig>
): ChunkValidator {
  return new ChunkValidator(config);
}
