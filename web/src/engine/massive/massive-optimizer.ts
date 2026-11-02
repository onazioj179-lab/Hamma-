/**
 * SPK Hard Constraint Engine - AI Optimizer for Massive Mode
 * Creator: OJ Treasure Onazi
 * 
 * Section 7: AI Optimization for Huge Jobs (Mode="massive")
 * - Auto-detect chunk sizes based on file types
 * - Balance memory vs speed tradeoffs
 * - Predict and prevent stalls
 */

import {
  HARD_LIMITS,
  KB, MB, GB,
  type MassiveJobConfig,
  type MassiveFileEntry,
  type Partition,
  type CompressionProfile,
  type OptimizerState,
  FILE_TYPE_PROFILES,
  DEFAULT_MASSIVE_CONFIG,
} from './types';

// ============================================================================
// OPTIMIZER CONSTANTS
// ============================================================================

/**
 * Default optimization parameters
 */
export const OPTIMIZER_DEFAULTS = {
  // Chunk size bounds
  MIN_CHUNK_SIZE: HARD_LIMITS.MASSIVE_MIN_CHUNK,
  MAX_CHUNK_SIZE: HARD_LIMITS.MASSIVE_MAX_CHUNK,
  DEFAULT_CHUNK_SIZE: HARD_LIMITS.MASSIVE_DEFAULT_CHUNK,
  
  // Concurrency bounds
  MIN_WORKERS: HARD_LIMITS.MIN_WORKERS_MASSIVE,
  MAX_WORKERS: HARD_LIMITS.MAX_WORKERS_MASSIVE,
  DEFAULT_WORKERS: 4,
  
  // Throughput targets
  TARGET_THROUGHPUT: 50 * MB, // 50 MB/s target
  MIN_THROUGHPUT: 10 * MB,    // 10 MB/s minimum before adjustment
  
  // Memory safety margins
  HEAP_SAFETY_MARGIN: 0.8,  // Use max 80% of available heap
  WASM_SAFETY_MARGIN: 0.7,  // Use max 70% of WASM pages
  
  // Stall detection
  STALL_THRESHOLD_MS: 5000,  // 5 second stall
  MAX_STALLS_BEFORE_ADJUST: 3,
  
  // History sizes
  THROUGHPUT_HISTORY_SIZE: 100,
  CHUNK_TIME_HISTORY_SIZE: 50,
};

// ============================================================================
// OPTIMIZATION STRATEGY TYPES
// ============================================================================

export type OptimizationMode = 'balanced' | 'speed' | 'memory' | 'compression';

export interface OptimizationStrategy {
  mode: OptimizationMode;
  chunkSize: number;
  concurrency: number;
  compressionLevel: number;
  bufferPoolSize: number;
  checkpointInterval: number;
}

export interface OptimizationRecommendation {
  action: 'increase' | 'decrease' | 'maintain' | 'switch';
  target: 'chunk_size' | 'concurrency' | 'compression' | 'buffer' | 'mode';
  currentValue: number;
  recommendedValue: number;
  reason: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface FileTypeAnalysis {
  profile: CompressionProfile;
  count: number;
  totalSize: number;
  avgSize: number;
  recommendedChunkSize: number;
  expectedRatio: number;
}

export interface OptimizationMetrics {
  avgChunkTime: number;
  avgThroughput: number;
  peakThroughput: number;
  memoryEfficiency: number;
  compressionEfficiency: number;
  stallRate: number;
  utilization: number;
}

// ============================================================================
// MASSIVE MODE OPTIMIZER
// ============================================================================

export class MassiveModeOptimizer {
  private config: MassiveJobConfig;
  private state: OptimizerState;
  private strategy: OptimizationStrategy;
  
  // History tracking
  private chunkTimes: number[] = [];
  private throughputHistory: number[] = [];
  private memorySnapshots: { heap: number; wasm: number; time: number }[] = [];
  private stallTimestamps: number[] = [];
  
  // File type analysis cache
  private fileTypeCache: Map<CompressionProfile, FileTypeAnalysis> = new Map();
  
  // Learning state
  private learningEnabled = true;
  private adjustmentHistory: OptimizationRecommendation[] = [];

  constructor(config: Partial<MassiveJobConfig> = {}) {
    this.config = { ...DEFAULT_MASSIVE_CONFIG, ...config };
    
    this.state = {
      mode: 'massive',
      chunkSize: OPTIMIZER_DEFAULTS.DEFAULT_CHUNK_SIZE,
      concurrency: OPTIMIZER_DEFAULTS.DEFAULT_WORKERS,
      memoryPressure: 'low',
      throughputHistory: [],
      stallCount: 0,
    };
    
    this.strategy = this.createInitialStrategy();
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Analyze files and create initial optimization strategy
   */
  analyzeFiles(files: MassiveFileEntry[]): OptimizationStrategy {
    // Clear cache
    this.fileTypeCache.clear();
    
    // Analyze by file type
    for (const file of files) {
      const existing = this.fileTypeCache.get(file.compressionProfile);
      if (existing) {
        existing.count++;
        existing.totalSize += file.size;
        existing.avgSize = existing.totalSize / existing.count;
      } else {
        const profileInfo = FILE_TYPE_PROFILES[file.compressionProfile];
        this.fileTypeCache.set(file.compressionProfile, {
          profile: file.compressionProfile,
          count: 1,
          totalSize: file.size,
          avgSize: file.size,
          recommendedChunkSize: profileInfo.optimalChunk,
          expectedRatio: profileInfo.expectedRatio,
        });
      }
    }
    
    // Calculate optimal chunk size based on file distribution
    const optimalChunk = this.calculateOptimalChunkSize();
    
    // Calculate optimal concurrency
    const optimalConcurrency = this.calculateOptimalConcurrency(files);
    
    // Create strategy
    this.strategy = {
      mode: this.determineMode(files),
      chunkSize: optimalChunk,
      concurrency: optimalConcurrency,
      compressionLevel: this.config.compressionLevel,
      bufferPoolSize: this.calculateBufferPoolSize(optimalChunk, optimalConcurrency),
      checkpointInterval: this.calculateCheckpointInterval(files),
    };
    
    return this.strategy;
  }

  /**
   * Create initial strategy without file analysis
   */
  private createInitialStrategy(): OptimizationStrategy {
    return {
      mode: 'balanced',
      chunkSize: OPTIMIZER_DEFAULTS.DEFAULT_CHUNK_SIZE,
      concurrency: OPTIMIZER_DEFAULTS.DEFAULT_WORKERS,
      compressionLevel: this.config.compressionLevel,
      bufferPoolSize: 4,
      checkpointInterval: 100,
    };
  }

  // ---------------------------------------------------------------------------
  // CHUNK SIZE OPTIMIZATION
  // ---------------------------------------------------------------------------

  /**
   * Calculate optimal chunk size based on file type distribution
   */
  private calculateOptimalChunkSize(): number {
    if (this.fileTypeCache.size === 0) {
      return OPTIMIZER_DEFAULTS.DEFAULT_CHUNK_SIZE;
    }
    
    // Weighted average by total size
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const analysis of this.fileTypeCache.values()) {
      const weight = analysis.totalSize;
      weightedSum += analysis.recommendedChunkSize * weight;
      totalWeight += weight;
    }
    
    const weighted = totalWeight > 0 ? weightedSum / totalWeight : OPTIMIZER_DEFAULTS.DEFAULT_CHUNK_SIZE;
    
    // Clamp to bounds
    return Math.max(
      OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE,
      Math.min(OPTIMIZER_DEFAULTS.MAX_CHUNK_SIZE, weighted)
    );
  }

  /**
   * Get recommended chunk size for specific file
   */
  getChunkSizeForFile(file: MassiveFileEntry): number {
    // Start with file type recommendation
    const profileInfo = FILE_TYPE_PROFILES[file.compressionProfile];
    let chunkSize = profileInfo.optimalChunk;
    
    // Adjust for file size
    if (file.size < chunkSize * 4) {
      // Small file: smaller chunks for granularity
      chunkSize = Math.max(OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE, Math.floor(file.size / 4));
    } else if (file.size > GB) {
      // Large file: larger chunks for efficiency
      chunkSize = Math.min(OPTIMIZER_DEFAULTS.MAX_CHUNK_SIZE, chunkSize * 2);
    }
    
    // Adjust for memory pressure
    if (this.state.memoryPressure === 'high') {
      chunkSize = Math.floor(chunkSize * 0.75);
    } else if (this.state.memoryPressure === 'critical') {
      chunkSize = Math.floor(chunkSize * 0.5);
    }
    
    // Clamp to bounds
    return Math.max(
      OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE,
      Math.min(OPTIMIZER_DEFAULTS.MAX_CHUNK_SIZE, chunkSize)
    );
  }

  /**
   * Adjust chunk size based on runtime performance
   */
  adjustChunkSize(currentThroughput: number, memoryUsage: number): number {
    const currentChunk = this.strategy.chunkSize;
    
    // Throughput-based adjustment
    if (currentThroughput < OPTIMIZER_DEFAULTS.MIN_THROUGHPUT) {
      // Too slow - check if it's memory or CPU bound
      if (memoryUsage > OPTIMIZER_DEFAULTS.HEAP_SAFETY_MARGIN) {
        // Memory bound - decrease chunk size
        return Math.max(OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE, Math.floor(currentChunk * 0.8));
      } else {
        // CPU bound - might benefit from larger chunks (fewer overhead)
        return Math.min(OPTIMIZER_DEFAULTS.MAX_CHUNK_SIZE, Math.floor(currentChunk * 1.2));
      }
    }
    
    // Performance is acceptable
    return currentChunk;
  }

  // ---------------------------------------------------------------------------
  // CONCURRENCY OPTIMIZATION
  // ---------------------------------------------------------------------------

  /**
   * Calculate optimal concurrency
   */
  private calculateOptimalConcurrency(files: MassiveFileEntry[]): number {
    // Base on available hardware
    const cpuCores = navigator.hardwareConcurrency || 4;
    let optimal = Math.min(cpuCores, OPTIMIZER_DEFAULTS.MAX_WORKERS);
    
    // Adjust for total file count
    if (files.length < optimal) {
      optimal = Math.max(OPTIMIZER_DEFAULTS.MIN_WORKERS, files.length);
    }
    
    // Adjust for total size (larger archives benefit from more workers)
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 10 * GB) {
      optimal = Math.min(optimal + 2, OPTIMIZER_DEFAULTS.MAX_WORKERS);
    }
    
    return optimal;
  }

  /**
   * Adjust concurrency based on runtime metrics
   */
  adjustConcurrency(metrics: OptimizationMetrics): number {
    const current = this.strategy.concurrency;
    
    // If stall rate is high, reduce concurrency
    if (metrics.stallRate > 0.1) {
      return Math.max(OPTIMIZER_DEFAULTS.MIN_WORKERS, current - 1);
    }
    
    // If utilization is low and memory is fine, increase concurrency
    if (metrics.utilization < 0.5 && metrics.memoryEfficiency > 0.5) {
      return Math.min(OPTIMIZER_DEFAULTS.MAX_WORKERS, current + 1);
    }
    
    return current;
  }

  // ---------------------------------------------------------------------------
  // MEMORY OPTIMIZATION
  // ---------------------------------------------------------------------------

  /**
   * Calculate buffer pool size
   */
  private calculateBufferPoolSize(chunkSize: number, concurrency: number): number {
    // Each worker needs at least 2 buffers (input + output)
    const minBuffers = concurrency * 2;
    
    // Add some extra for pipeline
    const optimalBuffers = minBuffers + 2;
    
    // Check memory constraint
    const totalBufferMemory = optimalBuffers * chunkSize;
    const maxAllowedMemory = this.config.memoryBudget * OPTIMIZER_DEFAULTS.HEAP_SAFETY_MARGIN;
    
    if (totalBufferMemory > maxAllowedMemory) {
      return Math.floor(maxAllowedMemory / chunkSize);
    }
    
    return optimalBuffers;
  }

  /**
   * Record memory snapshot
   */
  recordMemorySnapshot(heap: number, wasm: number): void {
    this.memorySnapshots.push({ heap, wasm, time: Date.now() });
    
    // Trim old snapshots
    if (this.memorySnapshots.length > 100) {
      this.memorySnapshots.shift();
    }
  }

  /**
   * Get memory trend
   */
  getMemoryTrend(): 'increasing' | 'stable' | 'decreasing' {
    if (this.memorySnapshots.length < 10) return 'stable';
    
    const recent = this.memorySnapshots.slice(-10);
    const first = recent[0].heap;
    const last = recent[recent.length - 1].heap;
    
    const changePercent = (last - first) / first;
    
    if (changePercent > 0.1) return 'increasing';
    if (changePercent < -0.1) return 'decreasing';
    return 'stable';
  }

  // ---------------------------------------------------------------------------
  // STALL DETECTION & PREVENTION
  // ---------------------------------------------------------------------------

  /**
   * Record chunk completion time
   */
  recordChunkTime(timeMs: number): void {
    this.chunkTimes.push(timeMs);
    
    // Trim to history size
    if (this.chunkTimes.length > OPTIMIZER_DEFAULTS.CHUNK_TIME_HISTORY_SIZE) {
      this.chunkTimes.shift();
    }
    
    // Check for stall
    if (timeMs > OPTIMIZER_DEFAULTS.STALL_THRESHOLD_MS) {
      this.recordStall();
    }
  }

  /**
   * Record a stall event
   */
  private recordStall(): void {
    this.stallTimestamps.push(Date.now());
    this.state.stallCount++;
    
    // Trim old stalls (only count recent ones)
    const oneMinuteAgo = Date.now() - 60000;
    this.stallTimestamps = this.stallTimestamps.filter(t => t > oneMinuteAgo);
    
    // If too many stalls, trigger adjustment
    if (this.stallTimestamps.length >= OPTIMIZER_DEFAULTS.MAX_STALLS_BEFORE_ADJUST) {
      this.triggerStallRecovery();
    }
  }

  /**
   * Trigger stall recovery
   */
  private triggerStallRecovery(): void {
    const recommendation: OptimizationRecommendation = {
      action: 'decrease',
      target: 'chunk_size',
      currentValue: this.strategy.chunkSize,
      recommendedValue: Math.floor(this.strategy.chunkSize * 0.7),
      reason: 'Multiple stalls detected, reducing chunk size',
      confidence: 0.8,
      priority: 'high',
    };
    
    this.adjustmentHistory.push(recommendation);
    
    // Apply recommendation
    this.strategy.chunkSize = Math.max(
      OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE,
      recommendation.recommendedValue
    );
    
    // Reset stall tracking
    this.stallTimestamps = [];
  }

  /**
   * Predict if next chunk will stall
   */
  predictStall(): { probability: number; reason: string } {
    if (this.chunkTimes.length < 5) {
      return { probability: 0, reason: 'Insufficient data' };
    }
    
    // Calculate average and variance
    const avg = this.chunkTimes.reduce((a, b) => a + b, 0) / this.chunkTimes.length;
    const variance = this.chunkTimes.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / this.chunkTimes.length;
    const stdDev = Math.sqrt(variance);
    
    // Check recent trend
    const recent = this.chunkTimes.slice(-5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    let probability = 0;
    let reason = '';
    
    // High variance indicates instability
    if (stdDev > avg * 0.5) {
      probability += 0.3;
      reason = 'High processing time variance';
    }
    
    // Recent trend is increasing
    if (recentAvg > avg * 1.5) {
      probability += 0.3;
      reason = reason ? `${reason}, increasing trend` : 'Increasing processing time trend';
    }
    
    // Memory trend is increasing
    if (this.getMemoryTrend() === 'increasing') {
      probability += 0.2;
      reason = reason ? `${reason}, memory pressure` : 'Memory pressure building';
    }
    
    return { probability: Math.min(probability, 1), reason: reason || 'No risk factors' };
  }

  // ---------------------------------------------------------------------------
  // THROUGHPUT OPTIMIZATION
  // ---------------------------------------------------------------------------

  /**
   * Record throughput sample
   */
  recordThroughput(bps: number): void {
    this.throughputHistory.push(bps);
    this.state.throughputHistory.push(bps);
    
    // Trim history
    if (this.throughputHistory.length > OPTIMIZER_DEFAULTS.THROUGHPUT_HISTORY_SIZE) {
      this.throughputHistory.shift();
    }
    if (this.state.throughputHistory.length > OPTIMIZER_DEFAULTS.THROUGHPUT_HISTORY_SIZE) {
      this.state.throughputHistory.shift();
    }
  }

  /**
   * Get average throughput
   */
  getAverageThroughput(): number {
    if (this.throughputHistory.length === 0) return 0;
    return this.throughputHistory.reduce((a, b) => a + b, 0) / this.throughputHistory.length;
  }

  /**
   * Check if throughput is healthy
   */
  isThroughputHealthy(): boolean {
    const avg = this.getAverageThroughput();
    return avg >= OPTIMIZER_DEFAULTS.MIN_THROUGHPUT;
  }

  // ---------------------------------------------------------------------------
  // MODE SELECTION
  // ---------------------------------------------------------------------------

  /**
   * Determine optimization mode based on files
   */
  private determineMode(files: MassiveFileEntry[]): OptimizationMode {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const avgSize = totalSize / files.length;
    
    // Very large files - prioritize memory
    if (avgSize > 500 * MB) {
      return 'memory';
    }
    
    // Highly compressible - prioritize compression
    let compressibleCount = 0;
    for (const file of files) {
      const profile = FILE_TYPE_PROFILES[file.compressionProfile];
      if (profile.expectedRatio < 0.4) {
        compressibleCount++;
      }
    }
    if (compressibleCount > files.length * 0.7) {
      return 'compression';
    }
    
    // Many small files - prioritize speed
    if (files.length > 1000 && avgSize < 10 * MB) {
      return 'speed';
    }
    
    return 'balanced';
  }

  /**
   * Switch optimization mode
   */
  switchMode(mode: OptimizationMode): void {
    this.strategy.mode = mode;
    
    switch (mode) {
      case 'speed':
        this.strategy.chunkSize = Math.min(OPTIMIZER_DEFAULTS.MAX_CHUNK_SIZE, this.strategy.chunkSize * 1.5);
        this.strategy.concurrency = OPTIMIZER_DEFAULTS.MAX_WORKERS;
        this.strategy.compressionLevel = Math.max(1, this.config.compressionLevel - 2);
        break;
        
      case 'memory':
        this.strategy.chunkSize = Math.max(OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE, Math.floor(this.strategy.chunkSize * 0.5));
        this.strategy.concurrency = Math.max(OPTIMIZER_DEFAULTS.MIN_WORKERS, Math.floor(this.strategy.concurrency * 0.5));
        break;
        
      case 'compression':
        this.strategy.compressionLevel = Math.min(9, this.config.compressionLevel + 2);
        this.strategy.chunkSize = OPTIMIZER_DEFAULTS.DEFAULT_CHUNK_SIZE;
        break;
        
      case 'balanced':
      default:
        // Reset to initial calculations
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // CHECKPOINT OPTIMIZATION
  // ---------------------------------------------------------------------------

  /**
   * Calculate optimal checkpoint interval
   */
  private calculateCheckpointInterval(files: MassiveFileEntry[]): number {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    
    // More frequent checkpoints for larger archives
    if (totalSize > 100 * GB) {
      return 50; // Every 50 chunks
    } else if (totalSize > 10 * GB) {
      return 100; // Every 100 chunks
    } else {
      return 200; // Every 200 chunks
    }
  }

  // ---------------------------------------------------------------------------
  // RECOMMENDATIONS
  // ---------------------------------------------------------------------------

  /**
   * Get optimization recommendations
   */
  getRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    // Check throughput
    const avgThroughput = this.getAverageThroughput();
    if (avgThroughput < OPTIMIZER_DEFAULTS.MIN_THROUGHPUT && avgThroughput > 0) {
      recommendations.push({
        action: 'increase',
        target: 'chunk_size',
        currentValue: this.strategy.chunkSize,
        recommendedValue: Math.floor(this.strategy.chunkSize * 1.3),
        reason: `Low throughput (${(avgThroughput / MB).toFixed(2)} MB/s)`,
        confidence: 0.7,
        priority: 'medium',
      });
    }
    
    // Check stall rate
    if (this.state.stallCount > 0) {
      const recentStalls = this.stallTimestamps.length;
      if (recentStalls >= 2) {
        recommendations.push({
          action: 'decrease',
          target: 'concurrency',
          currentValue: this.strategy.concurrency,
          recommendedValue: Math.max(1, this.strategy.concurrency - 1),
          reason: `${recentStalls} stalls in last minute`,
          confidence: 0.8,
          priority: 'high',
        });
      }
    }
    
    // Check memory trend
    if (this.getMemoryTrend() === 'increasing') {
      recommendations.push({
        action: 'decrease',
        target: 'buffer',
        currentValue: this.strategy.bufferPoolSize,
        recommendedValue: Math.max(2, this.strategy.bufferPoolSize - 1),
        reason: 'Memory usage increasing',
        confidence: 0.6,
        priority: 'medium',
      });
    }
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Apply recommendation
   */
  applyRecommendation(recommendation: OptimizationRecommendation): void {
    this.adjustmentHistory.push(recommendation);
    
    switch (recommendation.target) {
      case 'chunk_size':
        this.strategy.chunkSize = Math.max(
          OPTIMIZER_DEFAULTS.MIN_CHUNK_SIZE,
          Math.min(OPTIMIZER_DEFAULTS.MAX_CHUNK_SIZE, recommendation.recommendedValue)
        );
        break;
        
      case 'concurrency':
        this.strategy.concurrency = Math.max(
          OPTIMIZER_DEFAULTS.MIN_WORKERS,
          Math.min(OPTIMIZER_DEFAULTS.MAX_WORKERS, recommendation.recommendedValue)
        );
        break;
        
      case 'compression':
        this.strategy.compressionLevel = Math.max(1, Math.min(9, recommendation.recommendedValue));
        break;
        
      case 'buffer':
        this.strategy.bufferPoolSize = Math.max(2, recommendation.recommendedValue);
        break;
        
      case 'mode':
        // Mode changes handled by switchMode
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // METRICS
  // ---------------------------------------------------------------------------

  /**
   * Get current optimization metrics
   */
  getMetrics(): OptimizationMetrics {
    const avgChunkTime = this.chunkTimes.length > 0
      ? this.chunkTimes.reduce((a, b) => a + b, 0) / this.chunkTimes.length
      : 0;
    
    const avgThroughput = this.getAverageThroughput();
    const peakThroughput = this.throughputHistory.length > 0
      ? Math.max(...this.throughputHistory)
      : 0;
    
    // Calculate stall rate (stalls per minute)
    const recentStalls = this.stallTimestamps.filter(t => t > Date.now() - 60000);
    const stallRate = recentStalls.length / 60;
    
    // Memory efficiency (inverse of overhead)
    const memoryEfficiency = this.memorySnapshots.length > 0
      ? 1 - (this.memorySnapshots[this.memorySnapshots.length - 1].heap / this.config.memoryBudget)
      : 1;
    
    // Compression efficiency estimate
    let compressionEfficiency = 0.5;
    for (const analysis of this.fileTypeCache.values()) {
      compressionEfficiency += (1 - analysis.expectedRatio) * (analysis.totalSize / 1);
    }
    const totalSize = Array.from(this.fileTypeCache.values())
      .reduce((sum, a) => sum + a.totalSize, 0);
    if (totalSize > 0) {
      compressionEfficiency = compressionEfficiency / totalSize;
    }
    
    // Utilization (actual vs target throughput)
    const utilization = avgThroughput > 0
      ? Math.min(1, avgThroughput / OPTIMIZER_DEFAULTS.TARGET_THROUGHPUT)
      : 0;
    
    return {
      avgChunkTime,
      avgThroughput,
      peakThroughput,
      memoryEfficiency,
      compressionEfficiency,
      stallRate,
      utilization,
    };
  }

  // ---------------------------------------------------------------------------
  // STATE ACCESS
  // ---------------------------------------------------------------------------

  /**
   * Get current strategy
   */
  getStrategy(): OptimizationStrategy {
    return { ...this.strategy };
  }

  /**
   * Get current state
   */
  getState(): OptimizerState {
    return { ...this.state };
  }

  /**
   * Update memory pressure
   */
  setMemoryPressure(pressure: 'low' | 'medium' | 'high' | 'critical'): void {
    this.state.memoryPressure = pressure;
  }

  /**
   * Get file type analysis
   */
  getFileTypeAnalysis(): Map<CompressionProfile, FileTypeAnalysis> {
    return new Map(this.fileTypeCache);
  }

  // ---------------------------------------------------------------------------
  // RESET
  // ---------------------------------------------------------------------------

  /**
   * Reset optimizer
   */
  reset(): void {
    this.state = {
      mode: 'massive',
      chunkSize: OPTIMIZER_DEFAULTS.DEFAULT_CHUNK_SIZE,
      concurrency: OPTIMIZER_DEFAULTS.DEFAULT_WORKERS,
      memoryPressure: 'low',
      throughputHistory: [],
      stallCount: 0,
    };
    
    this.strategy = this.createInitialStrategy();
    this.chunkTimes = [];
    this.throughputHistory = [];
    this.memorySnapshots = [];
    this.stallTimestamps = [];
    this.fileTypeCache.clear();
    this.adjustmentHistory = [];
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let optimizerInstance: MassiveModeOptimizer | null = null;

export function getMassiveModeOptimizer(config?: Partial<MassiveJobConfig>): MassiveModeOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new MassiveModeOptimizer(config);
  }
  return optimizerInstance;
}

export function resetMassiveModeOptimizer(): void {
  optimizerInstance?.reset();
  optimizerInstance = null;
}
