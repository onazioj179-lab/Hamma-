/**
 * SPK AI State Restoration System
 * 
 * Restores AI engine state including entropy signatures, throughput curves,
 * redundancy maps, optimizer modes, and predictive model weights.
 * 
 * Features:
 * - Full AI state serialization/deserialization
 * - Entropy signature restoration
 * - Throughput curve reconstruction
 * - Redundancy map recovery
 * - Optimizer mode continuation
 * - Predictive model state restoration
 * 
 * Creator: Onazi Treasure (OJ)
 */

import type { AIStateSnapshot, PredictiveModelState } from './checkpoint-manager';

// ============================================================================
// Types
// ============================================================================

export interface EntropySignature {
  chunkIndex: number;
  entropy: number;
  timestamp: number;
}

export interface ThroughputSample {
  timestamp: number;
  chunksPerSecond: number;
  bytesPerSecond: number;
}

export interface RedundancyGroup {
  hash: string;
  chunkIndices: number[];
  savedBytes: number;
}

export interface AIEngineConfig {
  entropyWindowSize: number;
  throughputWindowSize: number;
  memoryHistorySize: number;
  refinementPatternSize: number;
  learningRate: number;
}

export interface AIRestorationResult {
  success: boolean;
  entropySignaturesRestored: number;
  throughputSamplesRestored: number;
  redundancyGroupsRestored: number;
  optimizerMode: string;
  predictiveAccuracy: number;
  errors: string[];
}

// ============================================================================
// AIStateManager
// ============================================================================

const DEFAULT_CONFIG: AIEngineConfig = {
  entropyWindowSize: 1000,
  throughputWindowSize: 100,
  memoryHistorySize: 50,
  refinementPatternSize: 100,
  learningRate: 0.01,
};

export class AIStateManager {
  private config: AIEngineConfig;
  
  // State components
  private entropySignatures: Map<number, number> = new Map();
  private throughputCurve: number[] = [];
  private redundancyMap: Map<string, number[]> = new Map();
  private memoryPressureHistory: number[] = [];
  private refinementSuccessPatterns: boolean[] = [];
  private predictiveModel: PredictiveModelState;
  private optimizerMode: 'speed' | 'balanced' | 'ratio' = 'balanced';
  private isWarmedUp = false;
  
  constructor(config: Partial<AIEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.predictiveModel = this.createDefaultModel();
  }
  
  /**
   * Restore AI state from checkpoint
   */
  restore(snapshot: AIStateSnapshot): AIRestorationResult {
    const errors: string[] = [];
    
    try {
      // Restore entropy signatures
      this.entropySignatures.clear();
      for (let i = 0; i < snapshot.lastChunkEntropies.length; i++) {
        this.entropySignatures.set(i, snapshot.lastChunkEntropies[i]);
      }
      
      // Restore throughput curve
      this.throughputCurve = [...snapshot.throughputCurve];
      
      // Restore redundancy map
      this.redundancyMap.clear();
      if (snapshot.redundancyMap instanceof Map) {
        for (const [hash, indices] of snapshot.redundancyMap) {
          this.redundancyMap.set(hash, [...indices]);
        }
      }
      
      // Restore memory pressure history
      this.memoryPressureHistory = [...snapshot.memoryPressureHistory];
      
      // Restore refinement patterns
      this.refinementSuccessPatterns = [...snapshot.refinementSuccessPatterns];
      
      // Restore optimizer mode
      this.optimizerMode = snapshot.optimizerMode;
      
      // Restore predictive model
      if (snapshot.predictiveModel) {
        this.predictiveModel = {
          weights: [...snapshot.predictiveModel.weights],
          learningRate: snapshot.predictiveModel.learningRate,
          epochsTrained: snapshot.predictiveModel.epochsTrained,
          lastAccuracy: snapshot.predictiveModel.lastAccuracy,
        };
      }
      
      // Mark as warmed up if we have enough data
      this.isWarmedUp = this.throughputCurve.length >= 10;
      
      return {
        success: true,
        entropySignaturesRestored: this.entropySignatures.size,
        throughputSamplesRestored: this.throughputCurve.length,
        redundancyGroupsRestored: this.redundancyMap.size,
        optimizerMode: this.optimizerMode,
        predictiveAccuracy: this.predictiveModel.lastAccuracy,
        errors,
      };
      
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        entropySignaturesRestored: 0,
        throughputSamplesRestored: 0,
        redundancyGroupsRestored: 0,
        optimizerMode: 'balanced',
        predictiveAccuracy: 0,
        errors,
      };
    }
  }
  
  /**
   * Export current state for checkpointing
   */
  exportState(): AIStateSnapshot {
    return {
      lastChunkEntropies: Array.from(this.entropySignatures.values()),
      throughputCurve: [...this.throughputCurve],
      redundancyMap: new Map(this.redundancyMap),
      optimizerMode: this.optimizerMode,
      memoryPressureHistory: [...this.memoryPressureHistory],
      refinementSuccessPatterns: [...this.refinementSuccessPatterns],
      predictiveModel: {
        weights: [...this.predictiveModel.weights],
        learningRate: this.predictiveModel.learningRate,
        epochsTrained: this.predictiveModel.epochsTrained,
        lastAccuracy: this.predictiveModel.lastAccuracy,
      },
    };
  }
  
  /**
   * Record entropy for a chunk
   */
  recordEntropy(chunkIndex: number, entropy: number): void {
    this.entropySignatures.set(chunkIndex, entropy);
    
    // Trim to window size
    if (this.entropySignatures.size > this.config.entropyWindowSize) {
      const keys = Array.from(this.entropySignatures.keys()).sort((a, b) => a - b);
      const toRemove = keys.slice(0, keys.length - this.config.entropyWindowSize);
      for (const key of toRemove) {
        this.entropySignatures.delete(key);
      }
    }
  }
  
  /**
   * Record throughput sample
   */
  recordThroughput(chunksPerSecond: number): void {
    this.throughputCurve.push(chunksPerSecond);
    
    // Trim to window size
    if (this.throughputCurve.length > this.config.throughputWindowSize) {
      this.throughputCurve = this.throughputCurve.slice(-this.config.throughputWindowSize);
    }
    
    // Update warm-up status
    if (!this.isWarmedUp && this.throughputCurve.length >= 10) {
      this.isWarmedUp = true;
    }
  }
  
  /**
   * Record redundancy (duplicate detection)
   */
  recordRedundancy(hash: string, chunkIndex: number): void {
    if (!this.redundancyMap.has(hash)) {
      this.redundancyMap.set(hash, []);
    }
    this.redundancyMap.get(hash)!.push(chunkIndex);
  }
  
  /**
   * Record memory pressure
   */
  recordMemoryPressure(pressure: number): void {
    this.memoryPressureHistory.push(pressure);
    
    // Trim to window size
    if (this.memoryPressureHistory.length > this.config.memoryHistorySize) {
      this.memoryPressureHistory = this.memoryPressureHistory.slice(
        -this.config.memoryHistorySize
      );
    }
  }
  
  /**
   * Record refinement result
   */
  recordRefinementResult(success: boolean): void {
    this.refinementSuccessPatterns.push(success);
    
    // Trim to window size
    if (this.refinementSuccessPatterns.length > this.config.refinementPatternSize) {
      this.refinementSuccessPatterns = this.refinementSuccessPatterns.slice(
        -this.config.refinementPatternSize
      );
    }
    
    // Update predictive model
    this.updatePredictiveModel(success);
  }
  
  /**
   * Set optimizer mode
   */
  setOptimizerMode(mode: 'speed' | 'balanced' | 'ratio'): void {
    this.optimizerMode = mode;
  }
  
  /**
   * Get current optimizer mode
   */
  getOptimizerMode(): 'speed' | 'balanced' | 'ratio' {
    return this.optimizerMode;
  }
  
  /**
   * Predict if refinement will be beneficial for given entropy
   */
  predictRefinementBenefit(entropy: number): boolean {
    if (!this.isWarmedUp || this.predictiveModel.weights.length === 0) {
      // Default: refine high-entropy chunks
      return entropy > 7.5;
    }
    
    // Simple linear prediction based on entropy
    const prediction = this.predictiveModel.weights[0] * entropy +
      (this.predictiveModel.weights[1] || 0);
    
    return prediction > 0.5;
  }
  
  /**
   * Get average throughput
   */
  getAverageThroughput(): number {
    if (this.throughputCurve.length === 0) return 0;
    return this.throughputCurve.reduce((a, b) => a + b, 0) / this.throughputCurve.length;
  }
  
  /**
   * Get average entropy
   */
  getAverageEntropy(): number {
    if (this.entropySignatures.size === 0) return 0;
    const values = Array.from(this.entropySignatures.values());
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  /**
   * Get redundancy ratio (deduplication savings)
   */
  getRedundancyRatio(): number {
    let totalChunks = 0;
    let duplicateChunks = 0;
    
    for (const indices of this.redundancyMap.values()) {
      totalChunks += indices.length;
      if (indices.length > 1) {
        duplicateChunks += indices.length - 1;
      }
    }
    
    return totalChunks > 0 ? duplicateChunks / totalChunks : 0;
  }
  
  /**
   * Get memory pressure trend
   */
  getMemoryPressureTrend(): 'increasing' | 'stable' | 'decreasing' {
    if (this.memoryPressureHistory.length < 5) return 'stable';
    
    const recent = this.memoryPressureHistory.slice(-5);
    const older = this.memoryPressureHistory.slice(-10, -5);
    
    if (older.length === 0) return 'stable';
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    const diff = recentAvg - olderAvg;
    
    if (diff > 0.1) return 'increasing';
    if (diff < -0.1) return 'decreasing';
    return 'stable';
  }
  
  /**
   * Check if AI engine is warmed up
   */
  isEngineWarmedUp(): boolean {
    return this.isWarmedUp;
  }
  
  /**
   * Get predictive model accuracy
   */
  getPredictiveAccuracy(): number {
    return this.predictiveModel.lastAccuracy;
  }
  
  /**
   * Update predictive model with new data
   */
  private updatePredictiveModel(actualSuccess: boolean): void {
    // Simple online learning update
    const predicted = this.refinementSuccessPatterns.length > 1
      ? this.predictiveModel.weights[0] > 0
      : true;
    
    const error = (actualSuccess ? 1 : 0) - (predicted ? 1 : 0);
    
    // Update weights
    if (this.predictiveModel.weights.length === 0) {
      this.predictiveModel.weights = [0.5, 0];
    }
    
    this.predictiveModel.weights[0] += this.predictiveModel.learningRate * error;
    this.predictiveModel.epochsTrained++;
    
    // Update accuracy
    const recentResults = this.refinementSuccessPatterns.slice(-20);
    const correctPredictions = recentResults.filter(
      (success, _i) => success === (this.predictiveModel.weights[0] > 0)
    ).length;
    
    this.predictiveModel.lastAccuracy = recentResults.length > 0
      ? correctPredictions / recentResults.length
      : 0.5;
  }
  
  /**
   * Create default predictive model
   */
  private createDefaultModel(): PredictiveModelState {
    return {
      weights: [0.5, 0],
      learningRate: this.config.learningRate,
      epochsTrained: 0,
      lastAccuracy: 0.5,
    };
  }
  
  /**
   * Reset AI state
   */
  reset(): void {
    this.entropySignatures.clear();
    this.throughputCurve = [];
    this.redundancyMap.clear();
    this.memoryPressureHistory = [];
    this.refinementSuccessPatterns = [];
    this.predictiveModel = this.createDefaultModel();
    this.optimizerMode = 'balanced';
    this.isWarmedUp = false;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let aiStateManagerInstance: AIStateManager | null = null;

export function getAIStateManager(): AIStateManager {
  if (!aiStateManagerInstance) {
    aiStateManagerInstance = new AIStateManager();
  }
  return aiStateManagerInstance;
}

export function resetAIStateManager(): void {
  aiStateManagerInstance?.reset();
  aiStateManagerInstance = null;
}

export function createAIStateManager(
  config?: Partial<AIEngineConfig>
): AIStateManager {
  return new AIStateManager(config);
}
