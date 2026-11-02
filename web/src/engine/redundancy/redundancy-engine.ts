/**
 * SPK Dynamic Redundancy Detection Engine - Main Engine
 * Creator: OJ Treasure Onazi
 * 
 * Core redundancy detection engine that analyzes chunks,
 * detects patterns, and provides compression recommendations.
 */

import {
  ChunkSignature,
  ChunkRecommendation,
  RedundancyEngineConfig,
  DEFAULT_REDUNDANCY_CONFIG,
  RedundancyClass,
  EntropyClass,
  CompressionMode,
  PatternAnalysis,
  FilePattern,
  RedundancyEvent,
  RedundancyEventHandler,
  classifyEntropy,
  recommendMode,
  estimateRatio,
  MB,
} from './types';
import { SignatureGenerator } from './signature-generator';
import { RedundancyMapManager } from './redundancy-map';

// ============================================================================
// REDUNDANCY ENGINE
// ============================================================================

export class RedundancyEngine {
  private config: RedundancyEngineConfig;
  private generator: SignatureGenerator;
  private mapManager: RedundancyMapManager;
  private eventHandlers: Set<RedundancyEventHandler> = new Set();
  
  // Model state
  private modelVersion = 0;
  private predictionAccuracy = 0.5;
  private modeSuccessRates: Map<CompressionMode, { success: number; total: number }> = new Map();
  
  // File patterns
  private filePatterns: Map<string, FilePattern> = new Map();
  
  // Trend tracking
  private lastEntropyClass: EntropyClass | null = null;

  constructor(config: Partial<RedundancyEngineConfig> = {}) {
    this.config = { ...DEFAULT_REDUNDANCY_CONFIG, ...config };
    this.generator = new SignatureGenerator(config);
    this.mapManager = new RedundancyMapManager(config);
    
    // Forward events from map manager
    this.mapManager.addEventListener((event) => this.emit(event));
    
    this.initializeModeTracking();
  }

  private initializeModeTracking(): void {
    const modes: CompressionMode[] = ['skip', 'fast', 'structural', 'lightweight', 'strong', 'multi-pass', 'auto'];
    for (const mode of modes) {
      this.modeSuccessRates.set(mode, { success: 0, total: 0 });
    }
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
  // MAIN API
  // ==========================================================================

  /**
   * Analyze a chunk and generate signature
   */
  analyzeChunk(chunk: Uint8Array, index: number, fileId?: string): ChunkSignature {
    const signature = this.generator.generateSignature(chunk, index, fileId);
    
    // Update file patterns if tracking
    if (fileId) {
      this.updateFilePattern(fileId, signature);
    }

    return signature;
  }

  /**
   * Update model with pattern signature and get redundancy info
   */
  updateModel(signature: ChunkSignature): {
    redundancyClass: RedundancyClass;
    matchingChunk?: number;
    similarity: number;
  } {
    const result = this.mapManager.addSignature(signature);
    
    // Track entropy shifts
    const currentEntropy = classifyEntropy(signature.entropy);
    if (this.lastEntropyClass && this.lastEntropyClass !== currentEntropy) {
      const trend = this.mapManager.getEntropyTrend();
      const avgTrend = trend.length > 0 
        ? trend.reduce((a, b) => a + b, 0) / trend.length 
        : 0.5;
      
      this.emit({
        type: 'entropy-shift',
        from: this.lastEntropyClass,
        to: currentEntropy,
        trend: avgTrend,
      });
    }
    this.lastEntropyClass = currentEntropy;

    this.modelVersion++;

    return {
      redundancyClass: result.redundancyClass,
      matchingChunk: result.matchingSignature?.index,
      similarity: result.similarity,
    };
  }

  /**
   * Get compression recommendation for a chunk
   */
  recommendChunkMode(index: number, fileId?: string): ChunkRecommendation {
    const signature = this.mapManager.getSignature(index, fileId);
    
    if (!signature) {
      // No signature found, return default
      return this.getDefaultRecommendation();
    }

    return this.generateRecommendation(signature);
  }

  /**
   * Analyze and recommend in one step (convenience method)
   */
  processChunk(
    chunk: Uint8Array,
    index: number,
    fileId?: string
  ): {
    signature: ChunkSignature;
    recommendation: ChunkRecommendation;
  } {
    const signature = this.analyzeChunk(chunk, index, fileId);
    const modelResult = this.updateModel(signature);
    
    return {
      signature,
      recommendation: this.generateRecommendationFromAnalysis(
        signature,
        modelResult.redundancyClass,
        modelResult.matchingChunk,
        modelResult.similarity
      ),
    };
  }

  // ==========================================================================
  // RECOMMENDATION GENERATION
  // ==========================================================================

  private generateRecommendation(signature: ChunkSignature): ChunkRecommendation {
    // Find best match in map
    const stats = this.mapManager.getStats();
    
    // Estimate redundancy based on hash and fingerprint
    const entropyClass = classifyEntropy(signature.entropy);
    
    // Check if we've seen similar patterns
    let redundancyClass: RedundancyClass = 'unique';
    let matchReference: ChunkRecommendation['matchReference'];
    
    // Use map to find matches (simplified - actual matching done in updateModel)
    const mode = this.selectOptimalMode(signature, redundancyClass, entropyClass);
    const predictedRatio = this.predictRatio(signature, redundancyClass);
    const refinementPasses = this.determineRefinementPasses(signature, entropyClass);

    return {
      chunkMode: mode,
      predictedRatio,
      redundancyScore: this.calculateRedundancyScore(signature, stats),
      structuralHint: redundancyClass,
      entropyClass,
      matchReference,
      refinementPasses,
      memoryEstimate: this.estimateMemoryNeed(signature, mode),
    };
  }

  private generateRecommendationFromAnalysis(
    signature: ChunkSignature,
    redundancyClass: RedundancyClass,
    matchingChunk?: number,
    similarity: number = 0
  ): ChunkRecommendation {
    const entropyClass = classifyEntropy(signature.entropy);
    const mode = this.selectOptimalMode(signature, redundancyClass, entropyClass);
    const predictedRatio = this.predictRatio(signature, redundancyClass);
    const refinementPasses = this.determineRefinementPasses(signature, entropyClass);

    return {
      chunkMode: mode,
      predictedRatio,
      redundancyScore: similarity,
      structuralHint: redundancyClass,
      entropyClass,
      matchReference: matchingChunk !== undefined ? {
        chunkIndex: matchingChunk,
        fileId: signature.fileId,
        similarity,
      } : undefined,
      refinementPasses,
      memoryEstimate: this.estimateMemoryNeed(signature, mode),
    };
  }

  private getDefaultRecommendation(): ChunkRecommendation {
    return {
      chunkMode: 'auto',
      predictedRatio: 0.5,
      redundancyScore: 0,
      structuralHint: 'unique',
      entropyClass: 'medium',
      refinementPasses: 1,
      memoryEstimate: 4 * MB,
    };
  }

  // ==========================================================================
  // MODE SELECTION
  // ==========================================================================

  private selectOptimalMode(
    signature: ChunkSignature,
    redundancyClass: RedundancyClass,
    entropyClass: EntropyClass
  ): CompressionMode {
    // Check for duplicates
    if (redundancyClass === 'duplicate') {
      return 'skip';
    }

    if (redundancyClass === 'near-duplicate') {
      return 'fast';
    }

    // Check mode success rates for adaptive selection
    const modeScores = this.calculateModeScores(signature, entropyClass);
    
    // Get file family recommendation if available
    if (signature.fileId) {
      const family = this.mapManager.getCompressionFamily(signature.fileId);
      if (family) {
        // Boost family's recommended mode score
        const familyMode = family.recommendedMode;
        if (modeScores.has(familyMode)) {
          modeScores.set(familyMode, modeScores.get(familyMode)! * 1.3);
        }
      }
    }

    // Select highest scoring mode
    let bestMode: CompressionMode = 'auto';
    let bestScore = 0;

    for (const [mode, score] of modeScores) {
      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }

    return bestMode;
  }

  private calculateModeScores(
    signature: ChunkSignature,
    entropyClass: EntropyClass
  ): Map<CompressionMode, number> {
    const scores = new Map<CompressionMode, number>();

    // Base scores from entropy
    switch (entropyClass) {
      case 'very-low':
        scores.set('lightweight', 0.9);
        scores.set('fast', 0.7);
        scores.set('structural', 0.5);
        scores.set('multi-pass', 0.8);
        break;
      case 'low':
        scores.set('lightweight', 0.7);
        scores.set('fast', 0.8);
        scores.set('structural', 0.6);
        scores.set('multi-pass', 0.6);
        break;
      case 'medium':
        scores.set('auto', 0.8);
        scores.set('structural', 0.7);
        scores.set('strong', 0.5);
        break;
      case 'high':
        scores.set('strong', 0.8);
        scores.set('auto', 0.6);
        break;
      case 'very-high':
        scores.set('strong', 0.9);
        scores.set('auto', 0.5);
        break;
    }

    // Adjust based on historical success rates
    for (const [mode, rate] of this.modeSuccessRates) {
      if (rate.total > 10) {
        const successRate = rate.success / rate.total;
        const current = scores.get(mode) || 0.5;
        scores.set(mode, current * (0.5 + successRate * 0.5));
      }
    }

    return scores;
  }

  // ==========================================================================
  // RATIO PREDICTION
  // ==========================================================================

  private predictRatio(
    signature: ChunkSignature,
    redundancyClass: RedundancyClass
  ): number {
    // Base estimate
    let ratio = estimateRatio(signature.entropy, redundancyClass);

    // Adjust based on pattern analysis
    const pattern = this.generator.detectPattern(
      new Uint8Array(0) // We don't have chunk data here
    );
    
    // Adjust based on file family
    if (signature.fileId) {
      const family = this.mapManager.getCompressionFamily(signature.fileId);
      if (family && family.averageRatio > 0) {
        ratio = ratio * 0.7 + family.averageRatio * 0.3;
      }
    }

    // Clamp to valid range
    return Math.max(0.01, Math.min(0.99, ratio));
  }

  // ==========================================================================
  // REFINEMENT PASSES
  // ==========================================================================

  private determineRefinementPasses(
    signature: ChunkSignature,
    entropyClass: EntropyClass
  ): number {
    // Duplicates need no refinement
    if (entropyClass === 'very-high') {
      return 0; // High entropy doesn't benefit from refinement
    }

    if (entropyClass === 'very-low') {
      return 3; // Very compressible, multiple passes help
    }

    if (entropyClass === 'low') {
      return 2;
    }

    if (entropyClass === 'medium') {
      return 1;
    }

    return 0;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private calculateRedundancyScore(
    signature: ChunkSignature,
    stats: { duplicateChunks: number; similarChunks: number; totalChunks: number }
  ): number {
    if (stats.totalChunks === 0) return 0;

    // Base score from global redundancy
    const globalRedundancy = (stats.duplicateChunks + stats.similarChunks * 0.5) / stats.totalChunks;
    
    // Adjust based on chunk's own characteristics
    const entropyFactor = 1 - signature.entropy; // Low entropy = more likely redundant
    
    return Math.min(1, (globalRedundancy * 0.5 + entropyFactor * 0.5));
  }

  private estimateMemoryNeed(signature: ChunkSignature, mode: CompressionMode): number {
    const baseMemory = signature.size * 2; // Basic working memory
    
    switch (mode) {
      case 'skip':
        return signature.size; // Minimal
      case 'fast':
        return baseMemory;
      case 'lightweight':
        return baseMemory * 1.5;
      case 'structural':
        return baseMemory * 2;
      case 'strong':
        return baseMemory * 3;
      case 'multi-pass':
        return baseMemory * 4;
      default:
        return baseMemory * 2;
    }
  }

  // ==========================================================================
  // FILE PATTERN TRACKING
  // ==========================================================================

  private updateFilePattern(fileId: string, signature: ChunkSignature): void {
    let pattern = this.filePatterns.get(fileId);
    
    if (!pattern) {
      pattern = {
        fileId,
        chunkCount: 0,
        averageEntropy: 0,
        dominantPattern: '',
        relatedFiles: [],
        compressionHint: 'auto',
      };
      this.filePatterns.set(fileId, pattern);
    }

    // Update running averages
    pattern.chunkCount++;
    pattern.averageEntropy = 
      ((pattern.averageEntropy * (pattern.chunkCount - 1)) + signature.entropy) / pattern.chunkCount;

    // Update compression hint based on average entropy
    const entropyClass = classifyEntropy(pattern.averageEntropy);
    pattern.compressionHint = recommendMode(pattern.averageEntropy, 'unique');

    // Check for related files
    const family = this.mapManager.getCompressionFamily(fileId);
    if (family) {
      pattern.relatedFiles = [...family.fileIds].filter(id => id !== fileId);
    }
  }

  getFilePattern(fileId: string): FilePattern | null {
    return this.filePatterns.get(fileId) || null;
  }

  // ==========================================================================
  // MODEL FEEDBACK
  // ==========================================================================

  recordModeResult(mode: CompressionMode, success: boolean, ratio?: number): void {
    const rate = this.modeSuccessRates.get(mode);
    if (rate) {
      rate.total++;
      if (success) rate.success++;
    }

    // Update prediction accuracy
    if (ratio !== undefined) {
      // Track how close our predictions were
      this.updatePredictionAccuracy(ratio);
    }

    this.emit({
      type: 'model-updated',
      accuracy: this.predictionAccuracy,
    });
  }

  private updatePredictionAccuracy(actualRatio: number): void {
    // Simple exponential moving average
    const alpha = 0.1;
    this.predictionAccuracy = this.predictionAccuracy * (1 - alpha) + 
      (1 - Math.abs(actualRatio - 0.5)) * alpha;
  }

  // ==========================================================================
  // STATS & DIAGNOSTICS
  // ==========================================================================

  getStats(): {
    totalChunks: number;
    duplicates: number;
    similar: number;
    unique: number;
    averageEntropy: number;
    bytesSaved: bigint;
    families: number;
    modelVersion: number;
    predictionAccuracy: number;
    memoryUsage: { current: number; limit: number; percentage: number };
  } {
    const mapStats = this.mapManager.getStats();
    const memoryUsage = this.mapManager.getMemoryUsage();

    return {
      totalChunks: mapStats.totalChunks,
      duplicates: mapStats.duplicateChunks,
      similar: mapStats.similarChunks,
      unique: mapStats.uniqueChunks,
      averageEntropy: mapStats.averageEntropy,
      bytesSaved: mapStats.bytesSaved,
      families: mapStats.compressionFamilies,
      modelVersion: this.modelVersion,
      predictionAccuracy: this.predictionAccuracy,
      memoryUsage,
    };
  }

  // ==========================================================================
  // RESET
  // ==========================================================================

  reset(): void {
    this.mapManager.reset();
    this.filePatterns.clear();
    this.initializeModeTracking();
    this.modelVersion = 0;
    this.predictionAccuracy = 0.5;
    this.lastEntropyClass = null;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createRedundancyEngine(
  config?: Partial<RedundancyEngineConfig>
): RedundancyEngine {
  return new RedundancyEngine(config);
}
