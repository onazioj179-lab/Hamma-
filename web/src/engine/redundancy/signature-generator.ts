/**
 * SPK Dynamic Redundancy Detection Engine - Signature Generator
 * Creator: OJ Treasure Onazi
 * 
 * Generates mathematical signatures from chunk binary data
 * without storing or parsing actual content.
 */

import {
  ChunkSignature,
  RedundancyEngineConfig,
  DEFAULT_REDUNDANCY_CONFIG,
  KB,
} from './types';

// ============================================================================
// SIGNATURE GENERATOR
// ============================================================================

export class SignatureGenerator {
  private config: RedundancyEngineConfig;
  
  // Precomputed tables for fast operations
  private readonly crcTable: Uint32Array;
  private readonly primeBase = 31;
  private readonly primeMod = 1000000007;

  constructor(config: Partial<RedundancyEngineConfig> = {}) {
    this.config = { ...DEFAULT_REDUNDANCY_CONFIG, ...config };
    this.crcTable = this.generateCRCTable();
  }

  // ==========================================================================
  // MAIN SIGNATURE GENERATION
  // ==========================================================================

  generateSignature(
    chunk: Uint8Array,
    index: number,
    fileId?: string
  ): ChunkSignature {
    const rollingChecksum = this.computeRollingChecksum(chunk);
    const hash = this.computeFastHash(chunk, rollingChecksum);
    const entropy = this.computeEntropy(chunk);
    const histogram = this.computeHistogram(chunk);
    const fingerprint = this.computeFingerprint(chunk);

    return {
      index,
      hash,
      entropy,
      histogram,
      size: chunk.length,
      timestamp: Date.now(),
      fileId,
      rollingChecksum,
      fingerprint,
    };
  }

  // ==========================================================================
  // ROLLING CHECKSUM (Rabin-Karp style)
  // ==========================================================================

  private computeRollingChecksum(data: Uint8Array): number {
    const windowSize = Math.min(this.config.checksumWindow, data.length);
    let hash = 0;
    let power = 1;

    // Initial window
    for (let i = 0; i < windowSize; i++) {
      hash = (hash * this.primeBase + data[i]) % this.primeMod;
      if (i < windowSize - 1) {
        power = (power * this.primeBase) % this.primeMod;
      }
    }

    // Roll through data, keeping track of min hash (content-defined chunking style)
    let minHash = hash;
    
    for (let i = windowSize; i < data.length; i++) {
      // Remove leading byte, add trailing byte
      hash = (hash - data[i - windowSize] * power % this.primeMod + this.primeMod) % this.primeMod;
      hash = (hash * this.primeBase + data[i]) % this.primeMod;
      
      if (hash < minHash) {
        minHash = hash;
      }
    }

    return minHash >>> 0;
  }

  // ==========================================================================
  // FAST HASH (CRC32-based, non-cryptographic)
  // ==========================================================================

  private computeFastHash(data: Uint8Array, rollingSum: number): number {
    // Combine CRC32 with rolling checksum for uniqueness
    let crc = 0xFFFFFFFF;
    
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ this.crcTable[(crc ^ data[i]) & 0xFF];
    }
    
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    
    // Mix with rolling checksum
    const mixed = (crc ^ rollingSum) >>> 0;
    
    return mixed;
  }

  private generateCRCTable(): Uint32Array {
    const table = new Uint32Array(256);
    
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
      table[i] = crc >>> 0;
    }
    
    return table;
  }

  // ==========================================================================
  // ENTROPY CALCULATION
  // ==========================================================================

  computeEntropy(data: Uint8Array): number {
    if (data.length === 0) return 0;

    // Count byte frequencies
    const frequencies = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) {
      frequencies[data[i]]++;
    }

    // Calculate Shannon entropy
    let entropy = 0;
    const length = data.length;
    
    for (let i = 0; i < 256; i++) {
      if (frequencies[i] > 0) {
        const p = frequencies[i] / length;
        entropy -= p * Math.log2(p);
      }
    }

    // Normalize to 0-1 range (max entropy is 8 bits)
    return entropy / 8;
  }

  // ==========================================================================
  // HISTOGRAM (128 bins)
  // ==========================================================================

  private computeHistogram(data: Uint8Array): Uint8Array {
    const bins = this.config.histogramBins;
    const histogram = new Uint8Array(bins);
    
    if (data.length === 0) return histogram;

    // Map 256 possible values to 128 bins
    const counts = new Uint32Array(bins);
    const binSize = 256 / bins;
    
    for (let i = 0; i < data.length; i++) {
      const bin = Math.floor(data[i] / binSize);
      counts[bin]++;
    }

    // Normalize to 0-255 range for compact storage
    const maxCount = Math.max(...counts);
    if (maxCount > 0) {
      for (let i = 0; i < bins; i++) {
        histogram[i] = Math.floor((counts[i] / maxCount) * 255);
      }
    }

    return histogram;
  }

  // ==========================================================================
  // FINGERPRINT (Block-based content fingerprint)
  // ==========================================================================

  private computeFingerprint(data: Uint8Array): string {
    const blockSize = this.config.fingerprintBlockSize;
    const numBlocks = Math.ceil(data.length / blockSize);
    
    // Generate fingerprint from block hashes
    const blockHashes: number[] = [];
    
    for (let b = 0; b < numBlocks && b < 16; b++) {
      const start = b * blockSize;
      const end = Math.min(start + blockSize, data.length);
      
      // Simple block hash
      let blockHash = 0;
      for (let i = start; i < end; i++) {
        blockHash = (blockHash * 31 + data[i]) & 0xFFFFFFFF;
      }
      
      blockHashes.push(blockHash >>> 0);
    }

    // Create fingerprint string
    return blockHashes
      .map(h => h.toString(16).padStart(8, '0'))
      .join('')
      .substring(0, 32);
  }

  // ==========================================================================
  // SIMILARITY COMPARISON
  // ==========================================================================

  compareSignatures(a: ChunkSignature, b: ChunkSignature): number {
    // Quick hash check
    if (a.hash === b.hash) return 1.0;

    // Size similarity
    const sizeSim = 1 - Math.abs(a.size - b.size) / Math.max(a.size, b.size);
    if (sizeSim < 0.5) return 0;

    // Entropy similarity
    const entropySim = 1 - Math.abs(a.entropy - b.entropy);

    // Histogram similarity (cosine similarity)
    const histogramSim = this.histogramSimilarity(a.histogram, b.histogram);

    // Fingerprint similarity (Jaccard-like)
    const fingerprintSim = this.fingerprintSimilarity(a.fingerprint, b.fingerprint);

    // Rolling checksum similarity
    const checksumSim = a.rollingChecksum === b.rollingChecksum ? 1 : 0;

    // Weighted combination
    return (
      sizeSim * 0.1 +
      entropySim * 0.15 +
      histogramSim * 0.35 +
      fingerprintSim * 0.3 +
      checksumSim * 0.1
    );
  }

  private histogramSimilarity(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  private fingerprintSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length !== b.length) return 0;

    let matches = 0;
    const chunkSize = 8; // 8 hex chars per block hash
    const numChunks = Math.floor(a.length / chunkSize);

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      if (a.substring(start, start + chunkSize) === b.substring(start, start + chunkSize)) {
        matches++;
      }
    }

    return matches / numChunks;
  }

  // ==========================================================================
  // PATTERN DETECTION
  // ==========================================================================

  detectPattern(data: Uint8Array): {
    type: 'repeating' | 'sequential' | 'random' | 'structured';
    period: number;
    strength: number;
  } {
    if (data.length < 64) {
      return { type: 'random', period: 0, strength: 0 };
    }

    // Check for repeating patterns
    const repeatInfo = this.detectRepeat(data);
    if (repeatInfo.strength > 0.7) {
      return { type: 'repeating', ...repeatInfo };
    }

    // Check for sequential patterns
    const seqInfo = this.detectSequential(data);
    if (seqInfo.strength > 0.7) {
      return { type: 'sequential', period: seqInfo.period, strength: seqInfo.strength };
    }

    // Check entropy for structured vs random
    const entropy = this.computeEntropy(data);
    if (entropy < 0.5) {
      return { type: 'structured', period: 0, strength: 1 - entropy };
    }

    return { type: 'random', period: 0, strength: entropy };
  }

  private detectRepeat(data: Uint8Array): { period: number; strength: number } {
    const maxPeriod = Math.min(1024, Math.floor(data.length / 4));
    let bestPeriod = 0;
    let bestStrength = 0;

    // Test various period lengths
    for (let period = 1; period <= maxPeriod; period *= 2) {
      let matches = 0;
      let total = 0;

      for (let i = period; i < data.length && total < 1000; i++) {
        if (data[i] === data[i - period]) {
          matches++;
        }
        total++;
      }

      const strength = matches / total;
      if (strength > bestStrength) {
        bestStrength = strength;
        bestPeriod = period;
      }
    }

    return { period: bestPeriod, strength: bestStrength };
  }

  private detectSequential(data: Uint8Array): { period: number; strength: number } {
    let ascending = 0;
    let descending = 0;
    let constant = 0;

    for (let i = 1; i < Math.min(data.length, 1000); i++) {
      if (data[i] === data[i - 1] + 1) ascending++;
      else if (data[i] === data[i - 1] - 1) descending++;
      else if (data[i] === data[i - 1]) constant++;
    }

    const total = Math.min(data.length - 1, 999);
    const seqStrength = Math.max(ascending, descending, constant) / total;

    return {
      period: ascending > descending ? 1 : -1,
      strength: seqStrength,
    };
  }

  // ==========================================================================
  // MEMORY ESTIMATION
  // ==========================================================================

  estimateSignatureMemory(sig: ChunkSignature): number {
    return (
      8 +                          // index (number)
      8 +                          // hash (number)
      8 +                          // entropy (number)
      sig.histogram.byteLength +   // histogram
      8 +                          // size (number)
      8 +                          // timestamp (number)
      (sig.fileId?.length || 0) * 2 + // fileId
      8 +                          // rollingChecksum
      sig.fingerprint.length * 2 + // fingerprint
      64                           // object overhead
    );
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createSignatureGenerator(
  config?: Partial<RedundancyEngineConfig>
): SignatureGenerator {
  return new SignatureGenerator(config);
}
