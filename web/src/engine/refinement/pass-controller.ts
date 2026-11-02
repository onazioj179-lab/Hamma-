/**
 * SPK Multi-Pass Entropy Refinement Engine - Pass Controller
 * Creator: OJ Treasure Onazi
 * 
 * EntropyPassController decides whether to refine data and
 * selects the optimal refinement mode for each pass.
 */

import {
  RefinementMode,
  RefinementModeName,
  PassDecision,
  PassResult,
  EntropyAnalysis,
  ByteHistogram,
  StructuralAnalysis,
  StructuralPattern,
  PatternType,
  PassControllerConfig,
  RefinementEngineConfig,
  DEFAULT_PASS_CONTROLLER_CONFIG,
  DEFAULT_REFINEMENT_ENGINE_CONFIG,
  getModeName,
  estimateModeMemory,
  isRefinementWorthwhile,
  selectModeForEntropy,
  KB,
  MB,
  GB,
} from './types';

// ============================================================================
// ENTROPY PASS CONTROLLER
// ============================================================================

export class EntropyPassController {
  private config: PassControllerConfig;
  private engineConfig: RefinementEngineConfig;
  
  // Tracking
  private passHistory: PassResult[] = [];
  private modeSuccess: Map<RefinementMode, { success: number; total: number }> = new Map();
  
  // Memory tracking
  private availableMemory: number;
  private inLiteMode = false;

  constructor(
    config: Partial<PassControllerConfig> = {},
    engineConfig: Partial<RefinementEngineConfig> = {}
  ) {
    this.config = { ...DEFAULT_PASS_CONTROLLER_CONFIG, ...config };
    this.engineConfig = { ...DEFAULT_REFINEMENT_ENGINE_CONFIG, ...engineConfig };
    this.availableMemory = this.config.memoryLimit;
    
    this.initializeModeTracking();
    this.checkLiteModeRequired();
  }

  private initializeModeTracking(): void {
    const modes: RefinementMode[] = ['mode-a', 'mode-b', 'mode-c', 'mode-d'];
    for (const mode of modes) {
      this.modeSuccess.set(mode, { success: 0, total: 0 });
    }
  }

  private checkLiteModeRequired(): void {
    if (this.config.enableLiteMode) {
      // Check if we're on a memory-constrained device
      if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
        const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory || 4;
        if (deviceMemory <= 1) {
          this.inLiteMode = true;
          this.availableMemory = Math.min(this.availableMemory, 100 * MB);
        }
      }
    }
  }

  // ==========================================================================
  // MAIN API
  // ==========================================================================

  /**
   * Determine if data should be refined
   */
  shouldRefine(
    data: Uint8Array,
    currentRatio: number,
    passNumber: number
  ): boolean {
    // Check pass limit
    if (passNumber >= this.config.maxPasses) {
      return false;
    }

    // Analyze data
    const analysis = this.analyzeEntropy(data);
    
    // Use utility function
    return isRefinementWorthwhile(currentRatio, analysis.shannon, data.length);
  }

  /**
   * Select the best refinement mode for the data
   */
  selectRefinementMode(
    data: Uint8Array,
    currentRatio: number,
    passNumber: number
  ): PassDecision {
    // Analyze data
    const entropyAnalysis = this.analyzeEntropy(data);
    const structuralAnalysis = this.analyzeStructure(data);

    // Check if refinement is worthwhile
    if (!this.shouldRefine(data, currentRatio, passNumber)) {
      return this.createSkipDecision('No refinement needed');
    }

    // Select mode
    const mode = this.selectOptimalMode(
      entropyAnalysis,
      structuralAnalysis,
      data.length,
      passNumber
    );

    // Estimate improvement
    const estimatedImprovement = this.estimateImprovement(
      mode,
      entropyAnalysis,
      currentRatio
    );

    // Check memory requirement
    const memoryRequirement = estimateModeMemory(mode, data.length, this.engineConfig);
    
    // Switch to lite mode if memory constrained
    let useLiteMode = this.inLiteMode;
    if (memoryRequirement > this.availableMemory) {
      useLiteMode = true;
    }

    // Estimate time
    const estimatedTime = this.estimateTime(mode, data.length, useLiteMode);

    // Calculate confidence
    const confidence = this.calculateConfidence(mode, entropyAnalysis, passNumber);

    // Determine recommended passes
    const recommendedPasses = this.calculateRecommendedPasses(
      entropyAnalysis,
      currentRatio
    );

    return {
      shouldRefine: true,
      mode,
      modeName: getModeName(mode),
      confidence,
      estimatedImprovement,
      memoryRequirement: useLiteMode ? memoryRequirement * 0.5 : memoryRequirement,
      estimatedTime,
      reason: this.generateReason(mode, entropyAnalysis, structuralAnalysis),
      useLiteMode,
      recommendedPasses,
    };
  }

  // ==========================================================================
  // ENTROPY ANALYSIS
  // ==========================================================================

  /**
   * Analyze entropy characteristics of data
   */
  analyzeEntropy(data: Uint8Array): EntropyAnalysis {
    const histogram = this.buildHistogram(data);
    
    // Shannon entropy
    const shannon = this.calculateShannonEntropy(histogram);
    
    // Block entropy (16-byte blocks)
    const block = this.calculateBlockEntropy(data, 16);
    
    // Conditional entropy (context-based)
    const conditional = this.calculateConditionalEntropy(data);
    
    // Cross entropy against uniform distribution
    const cross = this.calculateCrossEntropy(histogram);
    
    // Compressibility estimate
    const compressibility = 1 - shannon;
    
    // Pattern frequency
    const patternFrequency = this.detectPatternFrequency(data);
    
    // Optimal bits per byte
    const optimalBitsPerByte = shannon * 8;

    return {
      shannon,
      block,
      conditional,
      cross,
      compressibility,
      dominantByte: histogram.modeFrequency > 0.5 ? histogram.mode : undefined,
      patternFrequency,
      optimalBitsPerByte,
    };
  }

  /**
   * Build byte histogram
   */
  private buildHistogram(data: Uint8Array): ByteHistogram {
    const counts = new Uint32Array(256);
    
    for (let i = 0; i < data.length; i++) {
      counts[data[i]]++;
    }

    let uniqueBytes = 0;
    let mode = 0;
    let maxCount = 0;

    for (let i = 0; i < 256; i++) {
      if (counts[i] > 0) {
        uniqueBytes++;
        if (counts[i] > maxCount) {
          maxCount = counts[i];
          mode = i;
        }
      }
    }

    return {
      counts,
      total: data.length,
      uniqueBytes,
      mode,
      modeFrequency: data.length > 0 ? maxCount / data.length : 0,
    };
  }

  /**
   * Calculate Shannon entropy (normalized 0-1)
   */
  private calculateShannonEntropy(histogram: ByteHistogram): number {
    if (histogram.total === 0) return 0;

    let entropy = 0;
    const total = histogram.total;

    for (let i = 0; i < 256; i++) {
      if (histogram.counts[i] > 0) {
        const p = histogram.counts[i] / total;
        entropy -= p * Math.log2(p);
      }
    }

    // Normalize to 0-1 (max entropy is 8 bits)
    return entropy / 8;
  }

  /**
   * Calculate block-level entropy
   */
  private calculateBlockEntropy(data: Uint8Array, blockSize: number): number {
    if (data.length < blockSize) {
      return this.calculateShannonEntropy(this.buildHistogram(data));
    }

    const blockCount = Math.floor(data.length / blockSize);
    const blockHashes = new Map<number, number>();

    for (let i = 0; i < blockCount; i++) {
      const offset = i * blockSize;
      let hash = 0;
      
      // Simple hash of block
      for (let j = 0; j < blockSize; j++) {
        hash = ((hash << 5) - hash + data[offset + j]) | 0;
      }
      
      blockHashes.set(hash, (blockHashes.get(hash) || 0) + 1);
    }

    // Calculate entropy of block distribution
    let entropy = 0;
    for (const count of blockHashes.values()) {
      const p = count / blockCount;
      entropy -= p * Math.log2(p);
    }

    // Normalize (max entropy is log2(blockCount))
    const maxEntropy = Math.log2(blockCount);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /**
   * Calculate conditional entropy (order-1)
   */
  private calculateConditionalEntropy(data: Uint8Array): number {
    if (data.length < 2) return 0;

    // Build order-1 frequency table
    const pairCounts = new Map<number, number>();
    const contextCounts = new Uint32Array(256);

    for (let i = 1; i < data.length; i++) {
      const context = data[i - 1];
      const symbol = data[i];
      const pair = (context << 8) | symbol;
      
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      contextCounts[context]++;
    }

    // Calculate conditional entropy: H(X|Y) = -sum P(x,y) log P(x|y)
    let condEntropy = 0;
    const total = data.length - 1;

    for (const [pair, count] of pairCounts) {
      const context = pair >> 8;
      const pJoint = count / total;
      const pConditional = count / contextCounts[context];
      
      condEntropy -= pJoint * Math.log2(pConditional);
    }

    // Normalize to 0-1
    return condEntropy / 8;
  }

  /**
   * Calculate cross entropy against uniform distribution
   */
  private calculateCrossEntropy(histogram: ByteHistogram): number {
    if (histogram.total === 0) return 0;

    // Cross entropy: -sum P(x) log Q(x) where Q is uniform
    // For uniform: Q(x) = 1/256 for all x
    // So: H(P,Q) = -sum P(x) log(1/256) = sum P(x) * 8 = 8

    // But we calculate against the empirical distribution
    let crossEntropy = 0;
    const uniformProb = 1 / 256;

    for (let i = 0; i < 256; i++) {
      if (histogram.counts[i] > 0) {
        const p = histogram.counts[i] / histogram.total;
        crossEntropy -= p * Math.log2(uniformProb);
      }
    }

    // This will be 8 if distribution matches uniform
    // Normalize to 0-1 based on deviation from uniform
    return crossEntropy / 8;
  }

  /**
   * Detect pattern frequency in data
   */
  private detectPatternFrequency(data: Uint8Array): number {
    if (data.length < 8) return 0;

    let patternBytes = 0;

    // Check for runs (repeated bytes)
    let runStart = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i] !== data[runStart]) {
        const runLength = i - runStart;
        if (runLength >= 4) {
          patternBytes += runLength;
        }
        runStart = i;
      }
    }
    // Check final run
    const finalRunLength = data.length - runStart;
    if (finalRunLength >= 4) {
      patternBytes += finalRunLength;
    }

    // Check for short patterns (2-4 bytes)
    const window = Math.min(1000, data.length);
    const patternCounts = new Map<number, number>();

    for (let i = 0; i < window - 2; i++) {
      const pattern = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
    }

    // Count repeating patterns
    for (const count of patternCounts.values()) {
      if (count >= 4) {
        patternBytes += count * 3;
      }
    }

    // Normalize
    return Math.min(1, patternBytes / data.length);
  }

  // ==========================================================================
  // STRUCTURAL ANALYSIS
  // ==========================================================================

  /**
   * Analyze structural patterns in data
   */
  analyzeStructure(data: Uint8Array): StructuralAnalysis {
    const patterns: StructuralPattern[] = [];
    let patternBytes = 0;
    const patternTypes = new Map<PatternType, number>();

    // Detect runs
    const runs = this.detectRuns(data);
    for (const run of runs) {
      patterns.push(run);
      patternBytes += run.length;
      patternTypes.set('run', (patternTypes.get('run') || 0) + run.length);
    }

    // Detect delta patterns (for small data samples)
    if (data.length <= 10000) {
      const deltas = this.detectDeltas(data);
      for (const delta of deltas) {
        if (!this.overlapsExisting(patterns, delta)) {
          patterns.push(delta);
          patternBytes += delta.length;
          patternTypes.set('delta', (patternTypes.get('delta') || 0) + delta.length);
        }
      }
    }

    // Detect periodic patterns
    const periodic = this.detectPeriodic(data);
    for (const period of periodic) {
      if (!this.overlapsExisting(patterns, period)) {
        patterns.push(period);
        patternBytes += period.length;
        patternTypes.set('periodic', (patternTypes.get('periodic') || 0) + period.length);
      }
    }

    // Calculate coverage
    const patternCoverage = data.length > 0 ? Math.min(1, patternBytes / data.length) : 0;

    // Estimate savings
    const estimatedSavings = this.estimateStructuralSavings(patterns);

    // Find dominant type
    let dominantType: PatternType = 'none';
    let maxTypeBytes = 0;
    for (const [type, bytes] of patternTypes) {
      if (bytes > maxTypeBytes) {
        maxTypeBytes = bytes;
        dominantType = type;
      }
    }

    return {
      patterns,
      patternBytes,
      patternCoverage,
      estimatedSavings,
      dominantType,
      recommended: patternCoverage > 0.2 && estimatedSavings > 0.1,
    };
  }

  /**
   * Detect run-length patterns
   */
  private detectRuns(data: Uint8Array): StructuralPattern[] {
    const runs: StructuralPattern[] = [];
    const minRunLength = this.engineConfig.structural.minRunLength;

    let runStart = 0;
    for (let i = 1; i <= data.length; i++) {
      if (i === data.length || data[i] !== data[runStart]) {
        const runLength = i - runStart;
        if (runLength >= minRunLength) {
          const pattern = new Uint8Array([data[runStart]]);
          const savings = runLength - 3; // Encoding overhead ~3 bytes
          
          runs.push({
            type: 'run',
            offset: runStart,
            length: runLength,
            pattern,
            repetitions: runLength,
            savings: Math.max(0, savings),
            cost: 3,
            beneficial: savings > 0,
          });
        }
        runStart = i;
      }
    }

    return runs;
  }

  /**
   * Detect delta-encodable sequences
   */
  private detectDeltas(data: Uint8Array): StructuralPattern[] {
    const deltas: StructuralPattern[] = [];
    const minLength = 8;

    // Look for arithmetic sequences
    for (let i = 0; i < data.length - minLength; i++) {
      const delta = data[i + 1] - data[i];
      
      // Check if this delta continues
      let length = 2;
      while (i + length < data.length && 
             data[i + length] - data[i + length - 1] === delta) {
        length++;
      }

      if (length >= minLength) {
        const pattern = new Uint8Array([data[i], delta & 0xFF]);
        const savings = length - 4; // start + delta + length encoding
        
        if (savings > 0) {
          deltas.push({
            type: 'delta',
            offset: i,
            length,
            pattern,
            repetitions: length,
            savings,
            cost: 4,
            beneficial: true,
          });
        }
        
        i += length - 1; // Skip ahead
      }
    }

    return deltas;
  }

  /**
   * Detect periodic patterns
   */
  private detectPeriodic(data: Uint8Array): StructuralPattern[] {
    const periodic: StructuralPattern[] = [];
    const maxPatternLength = Math.min(
      this.engineConfig.structural.maxPatternLength,
      Math.floor(data.length / 4)
    );

    // Check small window for patterns
    const checkLength = Math.min(1000, data.length);

    for (let patternLen = 2; patternLen <= Math.min(32, maxPatternLength); patternLen++) {
      for (let start = 0; start < checkLength - patternLen * 3; start++) {
        const pattern = data.slice(start, start + patternLen);
        
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

        if (reps >= 4) {
          const totalLength = reps * patternLen;
          const savings = totalLength - patternLen - 4; // pattern + encoding
          
          if (savings > 0) {
            periodic.push({
              type: 'periodic',
              offset: start,
              length: totalLength,
              pattern: new Uint8Array(pattern),
              repetitions: reps,
              savings,
              cost: patternLen + 4,
              beneficial: true,
            });
          }
          
          start = pos - 1; // Skip ahead
        }
      }
    }

    return periodic;
  }

  /**
   * Check if pattern overlaps with existing patterns
   */
  private overlapsExisting(existing: StructuralPattern[], newPattern: StructuralPattern): boolean {
    const newEnd = newPattern.offset + newPattern.length;
    
    for (const pattern of existing) {
      const existingEnd = pattern.offset + pattern.length;
      
      if (newPattern.offset < existingEnd && newEnd > pattern.offset) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Estimate savings from structural reduction
   */
  private estimateStructuralSavings(patterns: StructuralPattern[]): number {
    let totalSavings = 0;
    let totalBytes = 0;

    for (const pattern of patterns) {
      if (pattern.beneficial) {
        totalSavings += pattern.savings;
        totalBytes += pattern.length;
      }
    }

    return totalBytes > 0 ? totalSavings / totalBytes : 0;
  }

  // ==========================================================================
  // MODE SELECTION
  // ==========================================================================

  /**
   * Select optimal refinement mode
   */
  private selectOptimalMode(
    entropyAnalysis: EntropyAnalysis,
    structuralAnalysis: StructuralAnalysis,
    dataSize: number,
    passNumber: number
  ): RefinementMode {
    // Check memory constraints
    const modeMemory: Map<RefinementMode, number> = new Map();
    const modes: RefinementMode[] = ['mode-a', 'mode-b', 'mode-c'];
    
    for (const mode of modes) {
      const memory = estimateModeMemory(mode, dataSize, this.engineConfig);
      modeMemory.set(mode, memory);
      
      // Exclude modes that would exceed memory
      if (memory > this.availableMemory && !this.inLiteMode) {
        modeMemory.delete(mode);
      }
    }

    // If no modes fit, use lite mode
    if (modeMemory.size === 0) {
      this.inLiteMode = true;
      return this.selectLiteMode(entropyAnalysis);
    }

    // Use entropy-based selection
    const selectedMode = selectModeForEntropy(entropyAnalysis, structuralAnalysis);
    
    // Verify selected mode is available
    if (modeMemory.has(selectedMode)) {
      return selectedMode;
    }

    // Fallback to first available mode
    return modeMemory.keys().next().value || 'mode-d';
  }

  /**
   * Select mode for lite/constrained mode
   */
  private selectLiteMode(entropyAnalysis: EntropyAnalysis): RefinementMode {
    // In lite mode, prefer simpler algorithms
    if (entropyAnalysis.shannon < 0.5) {
      return 'mode-b'; // Huffman is memory-efficient
    }
    if (entropyAnalysis.patternFrequency > 0.3) {
      return 'mode-c'; // Structural reduction
    }
    return 'mode-d'; // Skip if too complex
  }

  // ==========================================================================
  // ESTIMATION
  // ==========================================================================

  /**
   * Estimate improvement from a mode
   */
  private estimateImprovement(
    mode: RefinementMode,
    entropyAnalysis: EntropyAnalysis,
    currentRatio: number
  ): number {
    // Theoretical limit is entropy
    const theoreticalLimit = entropyAnalysis.shannon;
    const currentGap = currentRatio - theoreticalLimit;
    
    if (currentGap <= 0) return 0;

    // Estimate how much of the gap each mode can close
    let closeFactor: number;
    
    switch (mode) {
      case 'mode-a': // Range coder - best for moderate entropy
        closeFactor = entropyAnalysis.shannon > 0.3 && entropyAnalysis.shannon < 0.8 
          ? 0.7 : 0.4;
        break;
      case 'mode-b': // Huffman - good for low entropy
        closeFactor = entropyAnalysis.shannon < 0.5 ? 0.6 : 0.3;
        break;
      case 'mode-c': // Structural - good for patterns
        closeFactor = entropyAnalysis.patternFrequency > 0.3 ? 0.8 : 0.2;
        break;
      case 'mode-d':
      default:
        closeFactor = 0;
    }

    // Historical adjustment
    const modeStats = this.modeSuccess.get(mode);
    if (modeStats && modeStats.total > 5) {
      const successRate = modeStats.success / modeStats.total;
      closeFactor *= (0.5 + successRate * 0.5);
    }

    return currentRatio - (currentGap * closeFactor);
  }

  /**
   * Estimate time for a mode
   */
  private estimateTime(
    mode: RefinementMode,
    dataSize: number,
    liteMode: boolean
  ): number {
    const bytesPerMs = liteMode ? 100000 : 200000; // ~100-200KB/ms
    const baseTime = dataSize / bytesPerMs;
    
    // Mode-specific multipliers
    let multiplier: number;
    switch (mode) {
      case 'mode-a': multiplier = 2.0; break;  // Range coder is slower
      case 'mode-b': multiplier = 1.0; break;  // Huffman is fast
      case 'mode-c': multiplier = 1.5; break;  // Structural moderate
      case 'mode-d': multiplier = 0.0; break;  // Skip
      default: multiplier = 1.0;
    }

    return baseTime * multiplier;
  }

  /**
   * Calculate confidence in decision
   */
  private calculateConfidence(
    mode: RefinementMode,
    entropyAnalysis: EntropyAnalysis,
    passNumber: number
  ): number {
    let confidence = 0.5;

    // Higher confidence for clear entropy signals
    if (entropyAnalysis.shannon < 0.3 || entropyAnalysis.shannon > 0.85) {
      confidence += 0.2;
    }

    // Historical success boosts confidence
    const modeStats = this.modeSuccess.get(mode);
    if (modeStats && modeStats.total > 10) {
      const successRate = modeStats.success / modeStats.total;
      confidence += (successRate - 0.5) * 0.2;
    }

    // Later passes have less confidence
    confidence -= passNumber * 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate recommended number of passes
   */
  private calculateRecommendedPasses(
    entropyAnalysis: EntropyAnalysis,
    currentRatio: number
  ): number {
    const gap = currentRatio - entropyAnalysis.shannon;
    
    if (gap < 0.02) return 0;  // Already near optimal
    if (gap < 0.1) return 1;   // One pass should suffice
    if (gap < 0.3) return 2;   // Two passes
    return this.config.maxPasses;  // Full treatment
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Create a skip decision
   */
  private createSkipDecision(reason: string): PassDecision {
    return {
      shouldRefine: false,
      mode: 'mode-d',
      modeName: 'skip',
      confidence: 1.0,
      estimatedImprovement: 0,
      memoryRequirement: 0,
      estimatedTime: 0,
      reason,
      useLiteMode: false,
      recommendedPasses: 0,
    };
  }

  /**
   * Generate human-readable reason for mode selection
   */
  private generateReason(
    mode: RefinementMode,
    entropy: EntropyAnalysis,
    structural: StructuralAnalysis
  ): string {
    switch (mode) {
      case 'mode-a':
        return `Range coder selected: moderate entropy (${(entropy.shannon * 100).toFixed(1)}%) benefits from arithmetic coding`;
      case 'mode-b':
        return `Huffman rebalancing selected: low entropy (${(entropy.shannon * 100).toFixed(1)}%) with ${entropy.patternFrequency > 0.2 ? 'detected patterns' : 'symbol distribution'}`;
      case 'mode-c':
        return `Structural reduction selected: ${(structural.patternCoverage * 100).toFixed(1)}% pattern coverage detected`;
      case 'mode-d':
        return `Skip selected: entropy (${(entropy.shannon * 100).toFixed(1)}%) indicates limited improvement potential`;
      default:
        return 'Unknown mode';
    }
  }

  // ==========================================================================
  // FEEDBACK & TRACKING
  // ==========================================================================

  /**
   * Record pass result for learning
   */
  recordPassResult(result: PassResult): void {
    this.passHistory.push(result);
    
    const stats = this.modeSuccess.get(result.mode);
    if (stats) {
      stats.total++;
      if (result.wasSignificant) {
        stats.success++;
      }
    }

    // Limit history size
    if (this.passHistory.length > 1000) {
      this.passHistory = this.passHistory.slice(-500);
    }
  }

  /**
   * Update available memory
   */
  updateAvailableMemory(bytes: number): void {
    this.availableMemory = bytes;
    
    if (bytes < this.config.liteModeThreshold) {
      this.inLiteMode = true;
    }
  }

  /**
   * Check if in lite mode
   */
  isInLiteMode(): boolean {
    return this.inLiteMode;
  }

  /**
   * Get pass history
   */
  getPassHistory(): PassResult[] {
    return [...this.passHistory];
  }

  /**
   * Reset controller state
   */
  reset(): void {
    this.passHistory = [];
    this.initializeModeTracking();
    this.inLiteMode = false;
    this.availableMemory = this.config.memoryLimit;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createPassController(
  config?: Partial<PassControllerConfig>,
  engineConfig?: Partial<RefinementEngineConfig>
): EntropyPassController {
  return new EntropyPassController(config, engineConfig);
}
