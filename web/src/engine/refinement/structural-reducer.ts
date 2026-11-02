/**
 * SPK Multi-Pass Entropy Refinement Engine - Structural Reducer
 * Creator: OJ Treasure Onazi
 * 
 * Mode C: Pattern-based structural reduction for data with
 * repetitive patterns, runs, and structural redundancy.
 */

import {
  StructuralConfig,
  StructuralPattern,
  StructuralAnalysis,
  PatternType,
  PassResult,
  DEFAULT_STRUCTURAL_CONFIG,
  KB,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

// Encoding markers
const MARKER_RUN = 0xFE;        // Run-length encoding marker
const MARKER_DELTA = 0xFD;     // Delta encoding marker
const MARKER_PATTERN = 0xFC;   // Pattern repeat marker
const MARKER_DICT = 0xFB;      // Dictionary reference marker
const MARKER_LITERAL = 0xFA;   // Literal sequence marker
const MARKER_ESCAPE = 0xF9;    // Escape byte (for markers in data)

// ============================================================================
// STRUCTURAL REDUCER
// ============================================================================

export class StructuralReducer {
  private config: StructuralConfig;
  
  // Dictionary
  private dictionary: Map<string, number> = new Map();
  private dictEntries: Uint8Array[] = [];
  
  // Pattern cache
  private patternCache: Map<string, StructuralPattern> = new Map();
  
  // Stats
  private bytesProcessed = 0;
  private bytesSaved = 0;

  constructor(config: Partial<StructuralConfig> = {}) {
    this.config = { ...DEFAULT_STRUCTURAL_CONFIG, ...config };
  }

  // ==========================================================================
  // ANALYSIS
  // ==========================================================================

  /**
   * Analyze data for structural patterns
   */
  analyze(data: Uint8Array): StructuralAnalysis {
    const patterns: StructuralPattern[] = [];
    let patternBytes = 0;
    const typeBytes = new Map<PatternType, number>();

    // Detect runs
    const runs = this.detectRuns(data);
    for (const run of runs) {
      patterns.push(run);
      patternBytes += run.length;
      typeBytes.set('run', (typeBytes.get('run') || 0) + run.length);
    }

    // Detect delta sequences
    if (this.config.enableDelta) {
      const deltas = this.detectDeltas(data, patterns);
      for (const delta of deltas) {
        patterns.push(delta);
        patternBytes += delta.length;
        typeBytes.set('delta', (typeBytes.get('delta') || 0) + delta.length);
      }
    }

    // Detect periodic patterns
    const periodic = this.detectPeriodic(data, patterns);
    for (const p of periodic) {
      patterns.push(p);
      patternBytes += p.length;
      typeBytes.set('periodic', (typeBytes.get('periodic') || 0) + p.length);
    }

    // Find dominant type
    let dominantType: PatternType = 'none';
    let maxBytes = 0;
    for (const [type, bytes] of typeBytes) {
      if (bytes > maxBytes) {
        maxBytes = bytes;
        dominantType = type;
      }
    }

    const patternCoverage = data.length > 0 ? patternBytes / data.length : 0;
    const estimatedSavings = this.estimateSavings(patterns, data.length);

    return {
      patterns,
      patternBytes,
      patternCoverage: Math.min(1, patternCoverage),
      estimatedSavings,
      dominantType,
      recommended: patternCoverage > 0.15 && estimatedSavings > 0.05,
    };
  }

  // ==========================================================================
  // PATTERN DETECTION
  // ==========================================================================

  /**
   * Detect run-length patterns
   */
  private detectRuns(data: Uint8Array): StructuralPattern[] {
    const runs: StructuralPattern[] = [];
    const minLen = this.config.minRunLength;

    let runStart = 0;
    let runByte = data[0];

    for (let i = 1; i <= data.length; i++) {
      if (i === data.length || data[i] !== runByte) {
        const runLength = i - runStart;
        
        if (runLength >= minLen) {
          // Calculate savings: original = runLength, encoded = 3 (marker + byte + length)
          const savings = runLength - 3;
          
          if (savings > 0) {
            runs.push({
              type: 'run',
              offset: runStart,
              length: runLength,
              pattern: new Uint8Array([runByte]),
              repetitions: runLength,
              savings,
              cost: 3,
              beneficial: true,
            });
          }
        }

        if (i < data.length) {
          runStart = i;
          runByte = data[i];
        }
      }
    }

    return runs;
  }

  /**
   * Detect delta-encodable sequences
   */
  private detectDeltas(data: Uint8Array, existing: StructuralPattern[]): StructuralPattern[] {
    const deltas: StructuralPattern[] = [];
    const minLen = 8;

    for (let i = 0; i < data.length - minLen; i++) {
      // Skip if overlaps with existing pattern
      if (this.overlaps(i, minLen, existing)) continue;

      const delta = (data[i + 1] - data[i] + 256) % 256;
      
      // Check if delta continues
      let length = 2;
      while (
        i + length < data.length &&
        ((data[i + length] - data[i + length - 1] + 256) % 256) === delta
      ) {
        length++;
      }

      if (length >= minLen) {
        // Encoding: marker + start + delta + length (4 bytes)
        const savings = length - 4;
        
        if (savings > 0 && !this.overlaps(i, length, existing)) {
          deltas.push({
            type: 'delta',
            offset: i,
            length,
            pattern: new Uint8Array([data[i], delta]),
            repetitions: length,
            savings,
            cost: 4,
            beneficial: true,
          });
          
          i += length - 1; // Skip ahead
        }
      }
    }

    return deltas;
  }

  /**
   * Detect periodic/repeating patterns
   */
  private detectPeriodic(data: Uint8Array, existing: StructuralPattern[]): StructuralPattern[] {
    const periodic: StructuralPattern[] = [];
    const minPatternLen = this.config.minPatternLength;
    const maxPatternLen = Math.min(this.config.maxPatternLength, 64);

    // Check a sample of the data for patterns
    const sampleSize = Math.min(4000, data.length);

    for (let patternLen = minPatternLen; patternLen <= maxPatternLen; patternLen++) {
      for (let start = 0; start < sampleSize - patternLen * 3; start++) {
        if (this.overlaps(start, patternLen, existing)) continue;

        const pattern = data.slice(start, start + patternLen);
        const patternKey = this.patternKey(pattern);

        // Check cache
        if (this.patternCache.has(patternKey)) continue;

        // Count repetitions
        let reps = 1;
        let pos = start + patternLen;

        while (pos + patternLen <= data.length) {
          let matches = true;
          for (let j = 0; j < patternLen; j++) {
            if (data[pos + j] !== pattern[j]) {
              matches = false;
              break;
            }
          }
          if (!matches) break;
          reps++;
          pos += patternLen;
        }

        if (reps >= 3) {
          const totalLength = reps * patternLen;
          // Encoding: marker + patternLen + pattern + repCount (2 + patternLen + 2)
          const cost = 4 + patternLen;
          const savings = totalLength - cost;

          if (savings > 0 && !this.overlaps(start, totalLength, [...existing, ...periodic])) {
            const structPattern: StructuralPattern = {
              type: 'periodic',
              offset: start,
              length: totalLength,
              pattern: new Uint8Array(pattern),
              repetitions: reps,
              savings,
              cost,
              beneficial: true,
            };

            periodic.push(structPattern);
            this.patternCache.set(patternKey, structPattern);
            
            start = pos - 1; // Skip ahead
          }
        }
      }
    }

    return periodic;
  }

  /**
   * Check if position overlaps with existing patterns
   */
  private overlaps(offset: number, length: number, patterns: StructuralPattern[]): boolean {
    const end = offset + length;
    
    for (const p of patterns) {
      const pEnd = p.offset + p.length;
      if (offset < pEnd && end > p.offset) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Generate pattern key for caching
   */
  private patternKey(pattern: Uint8Array): string {
    let hash = 0;
    for (let i = 0; i < pattern.length; i++) {
      hash = ((hash << 5) - hash + pattern[i]) | 0;
    }
    return `${pattern.length}:${hash}`;
  }

  /**
   * Estimate savings from patterns
   */
  private estimateSavings(patterns: StructuralPattern[], totalSize: number): number {
    if (totalSize === 0) return 0;
    
    let totalSavings = 0;
    for (const p of patterns) {
      if (p.beneficial) {
        totalSavings += p.savings;
      }
    }
    
    return totalSavings / totalSize;
  }

  // ==========================================================================
  // ENCODING
  // ==========================================================================

  /**
   * Encode data using structural reduction
   */
  encode(data: Uint8Array): Uint8Array {
    const analysis = this.analyze(data);
    
    if (!analysis.recommended || analysis.patterns.length === 0) {
      // No beneficial patterns, return original with header
      return this.wrapOriginal(data);
    }

    // Sort patterns by offset
    const patterns = analysis.patterns
      .filter(p => p.beneficial)
      .sort((a, b) => a.offset - b.offset);

    // Build dictionary if enabled
    if (this.config.enableDictionary) {
      this.buildDictionary(data, patterns);
    }

    // Encode
    const output: number[] = [];
    
    // Header: original size (4 bytes) + pattern count (2 bytes)
    output.push((data.length >> 24) & 0xFF);
    output.push((data.length >> 16) & 0xFF);
    output.push((data.length >> 8) & 0xFF);
    output.push(data.length & 0xFF);
    
    output.push((patterns.length >> 8) & 0xFF);
    output.push(patterns.length & 0xFF);

    // Write dictionary if used
    if (this.dictEntries.length > 0) {
      output.push(this.dictEntries.length & 0xFF);
      for (const entry of this.dictEntries) {
        output.push(entry.length & 0xFF);
        for (let i = 0; i < entry.length; i++) {
          output.push(entry[i]);
        }
      }
    } else {
      output.push(0);
    }

    let pos = 0;

    for (const pattern of patterns) {
      // Write literal data before pattern
      if (pattern.offset > pos) {
        this.writeLiteral(output, data, pos, pattern.offset);
      }

      // Write pattern
      this.writePattern(output, pattern, data);
      
      pos = pattern.offset + pattern.length;
    }

    // Write remaining literal data
    if (pos < data.length) {
      this.writeLiteral(output, data, pos, data.length);
    }

    this.bytesProcessed = data.length;
    this.bytesSaved = data.length - output.length;

    return new Uint8Array(output);
  }

  /**
   * Wrap original data with header (no patterns)
   */
  private wrapOriginal(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length + 7);
    
    // Header
    output[0] = (data.length >> 24) & 0xFF;
    output[1] = (data.length >> 16) & 0xFF;
    output[2] = (data.length >> 8) & 0xFF;
    output[3] = data.length & 0xFF;
    output[4] = 0; // Pattern count high
    output[5] = 0; // Pattern count low
    output[6] = 0; // Dictionary size
    
    // Copy data
    output.set(data, 7);
    
    return output;
  }

  /**
   * Write literal bytes
   */
  private writeLiteral(output: number[], data: Uint8Array, start: number, end: number): void {
    const length = end - start;
    
    if (length <= 0) return;

    // Format: MARKER_LITERAL + length (2 bytes) + data
    output.push(MARKER_LITERAL);
    output.push((length >> 8) & 0xFF);
    output.push(length & 0xFF);
    
    for (let i = start; i < end; i++) {
      const byte = data[i];
      // Escape marker bytes
      if (byte >= MARKER_ESCAPE && byte <= MARKER_RUN) {
        output.push(MARKER_ESCAPE);
      }
      output.push(byte);
    }
  }

  /**
   * Write encoded pattern
   */
  private writePattern(output: number[], pattern: StructuralPattern, data: Uint8Array): void {
    switch (pattern.type) {
      case 'run':
        // Format: MARKER_RUN + byte + length (2 bytes)
        output.push(MARKER_RUN);
        output.push(pattern.pattern[0]);
        output.push((pattern.length >> 8) & 0xFF);
        output.push(pattern.length & 0xFF);
        break;

      case 'delta':
        // Format: MARKER_DELTA + start + delta + length (2 bytes)
        output.push(MARKER_DELTA);
        output.push(pattern.pattern[0]); // Start value
        output.push(pattern.pattern[1]); // Delta
        output.push((pattern.length >> 8) & 0xFF);
        output.push(pattern.length & 0xFF);
        break;

      case 'periodic':
        // Format: MARKER_PATTERN + patternLen + pattern + repCount (2 bytes)
        output.push(MARKER_PATTERN);
        output.push(pattern.pattern.length & 0xFF);
        for (let i = 0; i < pattern.pattern.length; i++) {
          output.push(pattern.pattern[i]);
        }
        output.push((pattern.repetitions >> 8) & 0xFF);
        output.push(pattern.repetitions & 0xFF);
        break;

      case 'dictionary':
        // Format: MARKER_DICT + dictIndex (2 bytes) + repCount (2 bytes)
        const dictKey = this.patternKey(pattern.pattern);
        const dictIndex = this.dictionary.get(dictKey) ?? 0;
        output.push(MARKER_DICT);
        output.push((dictIndex >> 8) & 0xFF);
        output.push(dictIndex & 0xFF);
        output.push((pattern.repetitions >> 8) & 0xFF);
        output.push(pattern.repetitions & 0xFF);
        break;
    }
  }

  /**
   * Build dictionary from common patterns
   */
  private buildDictionary(data: Uint8Array, patterns: StructuralPattern[]): void {
    this.dictionary.clear();
    this.dictEntries = [];

    // Find patterns that appear multiple times
    const patternCounts = new Map<string, { pattern: Uint8Array; count: number }>();
    
    for (const p of patterns) {
      if (p.type === 'periodic' && p.pattern.length >= 4) {
        const key = this.patternKey(p.pattern);
        const existing = patternCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          patternCounts.set(key, { pattern: p.pattern, count: 1 });
        }
      }
    }

    // Add frequent patterns to dictionary
    const sorted = [...patternCounts.entries()]
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count);

    let dictSize = 0;
    for (const [key, { pattern }] of sorted) {
      if (dictSize + pattern.length > this.config.maxDictionarySize) break;
      if (this.dictEntries.length >= 255) break;

      this.dictionary.set(key, this.dictEntries.length);
      this.dictEntries.push(pattern);
      dictSize += pattern.length;
    }
  }

  // ==========================================================================
  // DECODING
  // ==========================================================================

  /**
   * Decode structurally reduced data
   */
  decode(encoded: Uint8Array): Uint8Array {
    let pos = 0;

    // Read header
    const originalSize = 
      (encoded[pos++] << 24) |
      (encoded[pos++] << 16) |
      (encoded[pos++] << 8) |
      encoded[pos++];

    const patternCount = (encoded[pos++] << 8) | encoded[pos++];

    // Read dictionary
    const dictSize = encoded[pos++];
    const dictionary: Uint8Array[] = [];
    
    for (let i = 0; i < dictSize; i++) {
      const entryLen = encoded[pos++];
      const entry = encoded.slice(pos, pos + entryLen);
      dictionary.push(entry);
      pos += entryLen;
    }

    // If no patterns, data is after header
    if (patternCount === 0) {
      return encoded.slice(pos, pos + originalSize);
    }

    // Decode data
    const output = new Uint8Array(originalSize);
    let outPos = 0;

    while (pos < encoded.length && outPos < originalSize) {
      const marker = encoded[pos++];

      switch (marker) {
        case MARKER_RUN: {
          const byte = encoded[pos++];
          const length = (encoded[pos++] << 8) | encoded[pos++];
          for (let i = 0; i < length && outPos < originalSize; i++) {
            output[outPos++] = byte;
          }
          break;
        }

        case MARKER_DELTA: {
          const start = encoded[pos++];
          const delta = encoded[pos++];
          const length = (encoded[pos++] << 8) | encoded[pos++];
          let value = start;
          for (let i = 0; i < length && outPos < originalSize; i++) {
            output[outPos++] = value;
            value = (value + delta) & 0xFF;
          }
          break;
        }

        case MARKER_PATTERN: {
          const patternLen = encoded[pos++];
          const pattern = encoded.slice(pos, pos + patternLen);
          pos += patternLen;
          const reps = (encoded[pos++] << 8) | encoded[pos++];
          for (let r = 0; r < reps; r++) {
            for (let i = 0; i < patternLen && outPos < originalSize; i++) {
              output[outPos++] = pattern[i];
            }
          }
          break;
        }

        case MARKER_DICT: {
          const dictIndex = (encoded[pos++] << 8) | encoded[pos++];
          const reps = (encoded[pos++] << 8) | encoded[pos++];
          const pattern = dictionary[dictIndex] || new Uint8Array(0);
          for (let r = 0; r < reps; r++) {
            for (let i = 0; i < pattern.length && outPos < originalSize; i++) {
              output[outPos++] = pattern[i];
            }
          }
          break;
        }

        case MARKER_LITERAL: {
          const length = (encoded[pos++] << 8) | encoded[pos++];
          let remaining = length;
          while (remaining > 0 && pos < encoded.length && outPos < originalSize) {
            let byte = encoded[pos++];
            if (byte === MARKER_ESCAPE && pos < encoded.length) {
              byte = encoded[pos++];
            }
            output[outPos++] = byte;
            remaining--;
          }
          break;
        }

        case MARKER_ESCAPE: {
          if (pos < encoded.length) {
            output[outPos++] = encoded[pos++];
          }
          break;
        }

        default:
          // Unknown marker, treat as literal
          output[outPos++] = marker;
      }
    }

    return output.slice(0, outPos);
  }

  // ==========================================================================
  // PASS INTERFACE
  // ==========================================================================

  /**
   * Execute structural reduction pass
   */
  executePass(data: Uint8Array): PassResult {
    const startTime = performance.now();
    const inputSize = data.length;
    const entropyBefore = this.estimateEntropy(data);

    try {
      const encoded = this.encode(data);
      const timeMs = performance.now() - startTime;

      // Only verify if we actually compressed
      if (encoded.length >= inputSize) {
        return {
          mode: 'mode-c',
          status: 'skipped',
          inputSize,
          outputSize: inputSize,
          ratio: 1.0,
          timeMs,
          memoryUsed: this.estimateMemoryUsed(),
          wasSignificant: false,
          entropyBefore,
          entropyAfter: entropyBefore,
        };
      }

      // Verify by decoding
      const decoded = this.decode(encoded);

      // Verify correctness
      let correct = decoded.length === data.length;
      if (correct) {
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== decoded[i]) {
            correct = false;
            break;
          }
        }
      }

      if (!correct) {
        return {
          mode: 'mode-c',
          status: 'failed',
          inputSize,
          outputSize: inputSize,
          ratio: 1.0,
          timeMs,
          memoryUsed: this.estimateMemoryUsed(),
          wasSignificant: false,
          entropyBefore,
          entropyAfter: entropyBefore,
          error: 'Decode verification failed',
        };
      }

      const outputSize = encoded.length;
      const ratio = outputSize / inputSize;
      const entropyAfter = this.estimateEntropy(encoded);
      const wasSignificant = ratio < 0.95;

      return {
        mode: 'mode-c',
        status: 'success',
        inputSize,
        outputSize,
        ratio,
        timeMs,
        memoryUsed: this.estimateMemoryUsed(),
        wasSignificant,
        entropyBefore,
        entropyAfter,
      };
    } catch (error) {
      return {
        mode: 'mode-c',
        status: 'failed',
        inputSize,
        outputSize: inputSize,
        ratio: 1.0,
        timeMs: performance.now() - startTime,
        memoryUsed: this.estimateMemoryUsed(),
        wasSignificant: false,
        entropyBefore,
        entropyAfter: entropyBefore,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Estimate entropy of data
   */
  private estimateEntropy(data: Uint8Array): number {
    if (data.length === 0) return 0;

    const counts = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) {
      counts[data[i]]++;
    }

    let entropy = 0;
    const total = data.length;

    for (let i = 0; i < 256; i++) {
      if (counts[i] > 0) {
        const p = counts[i] / total;
        entropy -= p * Math.log2(p);
      }
    }

    return entropy / 8;
  }

  /**
   * Estimate memory used
   */
  private estimateMemoryUsed(): number {
    let memory = 0;
    
    // Dictionary
    for (const entry of this.dictEntries) {
      memory += entry.length + 20;
    }
    
    // Pattern cache
    memory += this.patternCache.size * 100;
    
    return memory;
  }

  /**
   * Get stats
   */
  getStats(): { bytesProcessed: number; bytesSaved: number } {
    return {
      bytesProcessed: this.bytesProcessed,
      bytesSaved: this.bytesSaved,
    };
  }

  /**
   * Reset state
   */
  reset(): void {
    this.dictionary.clear();
    this.dictEntries = [];
    this.patternCache.clear();
    this.bytesProcessed = 0;
    this.bytesSaved = 0;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createStructuralReducer(config?: Partial<StructuralConfig>): StructuralReducer {
  return new StructuralReducer(config);
}
