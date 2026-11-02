/**
 * SPK Dynamic Redundancy Detection Engine - Redundancy Map
 * Creator: OJ Treasure Onazi
 * 
 * Maintains efficient data structures for fast duplicate lookup,
 * similarity detection, and entropy-based categorization.
 */

import {
  ChunkSignature,
  RedundancyMap,
  RedundancyStats,
  RedundancyEngineConfig,
  DEFAULT_REDUNDANCY_CONFIG,
  RedundancyClass,
  CompressionFamily,
  RedundancyEvent,
  RedundancyEventHandler,
  MB,
} from './types';
import { SignatureGenerator } from './signature-generator';

// ============================================================================
// REDUNDANCY MAP MANAGER
// ============================================================================

export class RedundancyMapManager {
  private config: RedundancyEngineConfig;
  private generator: SignatureGenerator;
  private map: RedundancyMap;
  private eventHandlers: Set<RedundancyEventHandler> = new Set();
  
  // Sliding window for recent signatures
  private recentSignatures: ChunkSignature[] = [];
  private signatureIndex: Map<string, ChunkSignature> = new Map();
  
  // Memory tracking
  private currentMemory = 0;
  
  // Compression families
  private families: Map<string, CompressionFamily> = new Map();

  constructor(config: Partial<RedundancyEngineConfig> = {}) {
    this.config = { ...DEFAULT_REDUNDANCY_CONFIG, ...config };
    this.generator = new SignatureGenerator(config);
    this.map = this.createEmptyMap();
  }

  private createEmptyMap(): RedundancyMap {
    return {
      hashBuckets: new Map(),
      fingerprintBuckets: new Map(),
      lowEntropyList: [],
      highEntropyList: [],
      patternGroups: new Map(),
      stats: this.createEmptyStats(),
    };
  }

  private createEmptyStats(): RedundancyStats {
    return {
      totalChunks: 0,
      duplicateChunks: 0,
      similarChunks: 0,
      uniqueChunks: 0,
      averageEntropy: 0,
      entropyTrend: [],
      bytesProcessed: BigInt(0),
      bytesSaved: BigInt(0),
      compressionFamilies: 0,
    };
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: RedundancyEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: RedundancyEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: RedundancyEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // SIGNATURE MANAGEMENT
  // ==========================================================================

  addSignature(signature: ChunkSignature): {
    redundancyClass: RedundancyClass;
    matchingSignature?: ChunkSignature;
    similarity: number;
  } {
    // Check memory pressure
    this.checkMemoryPressure();

    // Check for duplicates
    const hashBucket = this.map.hashBuckets.get(signature.hash);
    if (hashBucket && hashBucket.length > 0) {
      // Exact duplicate found
      const match = hashBucket[0];
      this.map.stats.duplicateChunks++;
      this.map.stats.bytesSaved += BigInt(signature.size);
      
      this.emit({
        type: 'duplicate-found',
        index: signature.index,
        matchIndex: match.index,
        savings: signature.size,
      });

      return {
        redundancyClass: 'duplicate',
        matchingSignature: match,
        similarity: 1.0,
      };
    }

    // Check for near-duplicates via fingerprint
    const result = this.findSimilar(signature);
    
    // Add to maps
    this.insertSignature(signature);
    
    // Update stats
    this.updateStats(signature, result.redundancyClass);

    return result;
  }

  private findSimilar(signature: ChunkSignature): {
    redundancyClass: RedundancyClass;
    matchingSignature?: ChunkSignature;
    similarity: number;
  } {
    let bestMatch: ChunkSignature | undefined;
    let bestSimilarity = 0;

    // Check fingerprint bucket
    const fpPrefix = signature.fingerprint.substring(0, 8);
    const fpBucket = this.map.fingerprintBuckets.get(fpPrefix);
    
    if (fpBucket) {
      for (const candidate of fpBucket) {
        const sim = this.generator.compareSignatures(signature, candidate);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestMatch = candidate;
        }
      }
    }

    // Also check recent signatures for cross-file patterns
    if (this.config.crossFileDetection && signature.fileId) {
      const sampleSize = Math.min(100, this.recentSignatures.length);
      for (let i = 0; i < sampleSize; i++) {
        const idx = this.recentSignatures.length - 1 - i;
        if (idx < 0) break;
        
        const candidate = this.recentSignatures[idx];
        if (candidate.fileId !== signature.fileId) {
          const sim = this.generator.compareSignatures(signature, candidate);
          if (sim > bestSimilarity) {
            bestSimilarity = sim;
            bestMatch = candidate;
          }
        }
      }
    }

    // Classify based on similarity
    if (bestSimilarity >= 0.95) {
      this.map.stats.duplicateChunks++;
      return {
        redundancyClass: 'near-duplicate',
        matchingSignature: bestMatch,
        similarity: bestSimilarity,
      };
    }
    
    if (bestSimilarity >= 0.70) {
      this.map.stats.similarChunks++;
      return {
        redundancyClass: 'similar',
        matchingSignature: bestMatch,
        similarity: bestSimilarity,
      };
    }
    
    if (bestSimilarity >= 0.40) {
      return {
        redundancyClass: 'related',
        matchingSignature: bestMatch,
        similarity: bestSimilarity,
      };
    }

    this.map.stats.uniqueChunks++;
    return {
      redundancyClass: 'unique',
      similarity: bestSimilarity,
    };
  }

  private insertSignature(signature: ChunkSignature): void {
    // Add to hash bucket
    const hashBucket = this.map.hashBuckets.get(signature.hash);
    if (hashBucket) {
      hashBucket.push(signature);
    } else {
      this.map.hashBuckets.set(signature.hash, [signature]);
    }

    // Add to fingerprint bucket
    const fpPrefix = signature.fingerprint.substring(0, 8);
    const fpBucket = this.map.fingerprintBuckets.get(fpPrefix);
    if (fpBucket) {
      fpBucket.push(signature);
    } else {
      this.map.fingerprintBuckets.set(fpPrefix, [signature]);
    }

    // Categorize by entropy
    if (signature.entropy < 0.4) {
      this.map.lowEntropyList.push(signature);
    } else if (signature.entropy > 0.6) {
      this.map.highEntropyList.push(signature);
    }

    // Add to recent window
    this.recentSignatures.push(signature);
    this.signatureIndex.set(`${signature.fileId || ''}-${signature.index}`, signature);

    // Track memory
    this.currentMemory += this.generator.estimateSignatureMemory(signature);

    // Update pattern groups for cross-file detection
    if (this.config.crossFileDetection && signature.fileId) {
      const patternKey = signature.fingerprint.substring(0, 16);
      let group = this.map.patternGroups.get(patternKey);
      if (!group) {
        group = new Set();
        this.map.patternGroups.set(patternKey, group);
      }
      
      const prevSize = group.size;
      group.add(signature.fileId);
      
      if (group.size > 1 && group.size !== prevSize) {
        this.emit({
          type: 'pattern-detected',
          pattern: patternKey,
          fileCount: group.size,
        });
        
        // Update compression families
        this.updateCompressionFamily(patternKey, signature.fileId);
      }
    }
  }

  private updateStats(signature: ChunkSignature, redundancyClass: RedundancyClass): void {
    this.map.stats.totalChunks++;
    this.map.stats.bytesProcessed += BigInt(signature.size);

    // Update running average entropy
    const n = this.map.stats.totalChunks;
    this.map.stats.averageEntropy = 
      ((this.map.stats.averageEntropy * (n - 1)) + signature.entropy) / n;

    // Update entropy trend (keep last 100 values)
    this.map.stats.entropyTrend.push(signature.entropy);
    if (this.map.stats.entropyTrend.length > 100) {
      this.map.stats.entropyTrend.shift();
    }
  }

  // ==========================================================================
  // COMPRESSION FAMILIES
  // ==========================================================================

  private updateCompressionFamily(pattern: string, fileId: string): void {
    // Find or create family for this pattern
    let family = this.families.get(pattern);
    
    if (!family) {
      family = {
        id: `family-${this.families.size + 1}`,
        name: `Pattern Group ${this.families.size + 1}`,
        fileIds: new Set(),
        commonPatterns: [pattern],
        sharedBlocks: [],
        recommendedMode: 'structural',
        averageRatio: 0.4,
        memberCount: 0,
      };
      this.families.set(pattern, family);
      this.map.stats.compressionFamilies++;
      
      this.emit({
        type: 'family-created',
        familyId: family.id,
        memberCount: 1,
      });
    }

    family.fileIds.add(fileId);
    family.memberCount = family.fileIds.size;
  }

  getCompressionFamily(fileId: string): CompressionFamily | null {
    for (const family of this.families.values()) {
      if (family.fileIds.has(fileId)) {
        return family;
      }
    }
    return null;
  }

  // ==========================================================================
  // MEMORY MANAGEMENT
  // ==========================================================================

  private checkMemoryPressure(): void {
    if (this.currentMemory >= this.config.memoryLimit) {
      this.emit({
        type: 'memory-pressure',
        current: this.currentMemory,
        limit: this.config.memoryLimit,
      });
      
      this.evictSignatures();
    }
  }

  private evictSignatures(): void {
    const targetCount = Math.floor(this.config.maxSignatures * 0.7);
    const toEvict = this.recentSignatures.length - targetCount;
    
    if (toEvict <= 0) return;

    let evicted = 0;

    switch (this.config.evictionPolicy) {
      case 'lru':
        evicted = this.evictLRU(toEvict);
        break;
      case 'entropy':
        evicted = this.evictByEntropy(toEvict);
        break;
      case 'hybrid':
      default:
        evicted = this.evictHybrid(toEvict);
        break;
    }

    this.emit({
      type: 'eviction',
      count: evicted,
      policy: this.config.evictionPolicy,
    });
  }

  private evictLRU(count: number): number {
    const evicted = this.recentSignatures.splice(0, count);
    
    for (const sig of evicted) {
      this.removeFromMaps(sig);
      this.currentMemory -= this.generator.estimateSignatureMemory(sig);
    }

    return evicted.length;
  }

  private evictByEntropy(count: number): number {
    // Keep high-entropy (unique) chunks, evict low-entropy (common patterns)
    const sorted = [...this.recentSignatures].sort((a, b) => a.entropy - b.entropy);
    const toEvict = sorted.slice(0, count);
    
    for (const sig of toEvict) {
      const idx = this.recentSignatures.indexOf(sig);
      if (idx >= 0) {
        this.recentSignatures.splice(idx, 1);
        this.removeFromMaps(sig);
        this.currentMemory -= this.generator.estimateSignatureMemory(sig);
      }
    }

    return toEvict.length;
  }

  private evictHybrid(count: number): number {
    // Evict oldest 70%, keep 30% high-entropy
    const lruCount = Math.floor(count * 0.7);
    const entropyCount = count - lruCount;
    
    return this.evictLRU(lruCount) + this.evictByEntropy(entropyCount);
  }

  private removeFromMaps(sig: ChunkSignature): void {
    // Remove from hash bucket
    const hashBucket = this.map.hashBuckets.get(sig.hash);
    if (hashBucket) {
      const idx = hashBucket.indexOf(sig);
      if (idx >= 0) hashBucket.splice(idx, 1);
      if (hashBucket.length === 0) this.map.hashBuckets.delete(sig.hash);
    }

    // Remove from fingerprint bucket
    const fpPrefix = sig.fingerprint.substring(0, 8);
    const fpBucket = this.map.fingerprintBuckets.get(fpPrefix);
    if (fpBucket) {
      const idx = fpBucket.indexOf(sig);
      if (idx >= 0) fpBucket.splice(idx, 1);
      if (fpBucket.length === 0) this.map.fingerprintBuckets.delete(fpPrefix);
    }

    // Remove from entropy lists
    const lowIdx = this.map.lowEntropyList.indexOf(sig);
    if (lowIdx >= 0) this.map.lowEntropyList.splice(lowIdx, 1);
    
    const highIdx = this.map.highEntropyList.indexOf(sig);
    if (highIdx >= 0) this.map.highEntropyList.splice(highIdx, 1);

    // Remove from index
    this.signatureIndex.delete(`${sig.fileId || ''}-${sig.index}`);
  }

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  getSignature(index: number, fileId?: string): ChunkSignature | null {
    return this.signatureIndex.get(`${fileId || ''}-${index}`) || null;
  }

  getLowEntropyChunks(limit?: number): ChunkSignature[] {
    return limit 
      ? this.map.lowEntropyList.slice(0, limit)
      : [...this.map.lowEntropyList];
  }

  getHighEntropyChunks(limit?: number): ChunkSignature[] {
    return limit
      ? this.map.highEntropyList.slice(0, limit)
      : [...this.map.highEntropyList];
  }

  getStats(): RedundancyStats {
    return { ...this.map.stats };
  }

  getEntropyTrend(): number[] {
    return [...this.map.stats.entropyTrend];
  }

  getMemoryUsage(): { current: number; limit: number; percentage: number } {
    return {
      current: this.currentMemory,
      limit: this.config.memoryLimit,
      percentage: this.currentMemory / this.config.memoryLimit,
    };
  }

  // ==========================================================================
  // RESET
  // ==========================================================================

  reset(): void {
    this.map = this.createEmptyMap();
    this.recentSignatures = [];
    this.signatureIndex.clear();
    this.families.clear();
    this.currentMemory = 0;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createRedundancyMapManager(
  config?: Partial<RedundancyEngineConfig>
): RedundancyMapManager {
  return new RedundancyMapManager(config);
}
