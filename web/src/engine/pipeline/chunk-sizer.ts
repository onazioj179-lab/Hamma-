/**
 * SPK Fail-Safe Pipeline - Dynamic Chunk Sizer
 * 
 * Automatically adjusts chunk sizes for optimal performance:
 * - Increases chunk size when processing is fast
 * - Decreases chunk size when processing slows
 * - Drops chunk size immediately on memory pressure
 * - Uses safe minimal size after worker restarts
 * - Guarantees forward progress on any hardware
 * 
 * @module pipeline/chunk-sizer
 * @version 1.0.0
 */

import { getMemoryGovernor, type MemoryStats } from '../memory/governor';

// ============================================================================
// TYPES
// ============================================================================

export interface ChunkSizerConfig {
  /** Minimum chunk size (bytes) */
  minChunkSize: number;
  /** Maximum chunk size (bytes) */
  maxChunkSize: number;
  /** Default chunk size (bytes) */
  defaultChunkSize: number;
  /** Safe mode chunk size (bytes) - used after errors */
  safeChunkSize: number;
  /** Micro chunk size (bytes) - emergency mode */
  microChunkSize: number;
  /** Target processing time per chunk (ms) */
  targetProcessingTime: number;
  /** Minimum processing time before considering increase (ms) */
  minProcessingTime: number;
  /** Maximum processing time before reducing (ms) */
  maxProcessingTime: number;
  /** How aggressively to adjust chunk size (0.1 = 10% per adjustment) */
  adjustmentFactor: number;
  /** Number of samples for averaging */
  sampleWindow: number;
  /** Memory pressure threshold (0-1) to trigger reduction */
  memoryPressureThreshold: number;
  /** Time in safe mode after recovery (ms) */
  safeModeRecoveryTime: number;
}

export interface ChunkSizeRecommendation {
  size: number;
  mode: 'normal' | 'safe' | 'micro' | 'degraded';
  reason: string;
  confidence: number;
}

export interface ProcessingSample {
  chunkSize: number;
  processingTime: number;
  throughputMBps: number;
  timestamp: number;
  success: boolean;
  memoryPressure: MemoryStats['pressure'];
}

export interface ChunkSizerStats {
  currentChunkSize: number;
  recommendedChunkSize: number;
  mode: ChunkSizeRecommendation['mode'];
  avgProcessingTime: number;
  avgThroughput: number;
  samplesCollected: number;
  adjustments: number;
  lastAdjustmentReason: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const KB = 1024;
const MB = 1024 * KB;

const DEFAULT_CONFIG: ChunkSizerConfig = {
  minChunkSize: 64 * KB,           // 64KB minimum
  maxChunkSize: 256 * MB,          // 256MB maximum
  defaultChunkSize: 4 * MB,        // 4MB default
  safeChunkSize: 1 * MB,           // 1MB safe mode
  microChunkSize: 256 * KB,        // 256KB micro mode
  targetProcessingTime: 500,       // 500ms per chunk ideal
  minProcessingTime: 100,          // Under 100ms = can increase
  maxProcessingTime: 2000,         // Over 2s = must decrease
  adjustmentFactor: 0.25,          // 25% adjustment per step
  sampleWindow: 10,                // Last 10 samples
  memoryPressureThreshold: 0.75,   // 75% memory = reduce
  safeModeRecoveryTime: 5000,      // 5 seconds in safe mode
};

// ============================================================================
// SIZE CALCULATION HELPERS
// ============================================================================

/**
 * Calculate optimal chunk size based on file size
 */
export function calculateFileSizeBasedChunk(fileSize: number): number {
  // Very small files: use entire file as single chunk
  if (fileSize <= MB) {
    return Math.max(DEFAULT_CONFIG.minChunkSize, fileSize);
  }
  
  // Small files (< 10MB): 1MB chunks
  if (fileSize < 10 * MB) {
    return MB;
  }
  
  // Medium files (10MB - 100MB): 4MB chunks
  if (fileSize < 100 * MB) {
    return 4 * MB;
  }
  
  // Large files (100MB - 1GB): 16MB chunks
  if (fileSize < 1024 * MB) {
    return 16 * MB;
  }
  
  // Very large files (1GB - 10GB): 64MB chunks
  if (fileSize < 10 * 1024 * MB) {
    return 64 * MB;
  }
  
  // Huge files (10GB - 100GB): 128MB chunks
  if (fileSize < 100 * 1024 * MB) {
    return 128 * MB;
  }
  
  // TB-scale files: 256MB chunks
  return 256 * MB;
}

/**
 * Round chunk size to power of 2 for memory efficiency
 */
function roundToPowerOf2(size: number): number {
  if (size <= 0) return DEFAULT_CONFIG.minChunkSize;
  const power = Math.round(Math.log2(size));
  return Math.pow(2, power);
}

/**
 * Clamp chunk size to valid range
 */
function clampChunkSize(size: number, config: ChunkSizerConfig): number {
  return Math.max(config.minChunkSize, Math.min(config.maxChunkSize, size));
}

// ============================================================================
// DYNAMIC CHUNK SIZER
// ============================================================================

export class DynamicChunkSizer {
  private config: ChunkSizerConfig;
  private samples: ProcessingSample[] = [];
  private currentChunkSize: number;
  private mode: ChunkSizeRecommendation['mode'] = 'normal';
  private safeModeUntil = 0;
  private adjustmentCount = 0;
  private lastAdjustmentReason = '';
  private fileSize = 0;
  
  constructor(config: Partial<ChunkSizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentChunkSize = this.config.defaultChunkSize;
  }
  
  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  
  /**
   * Initialize sizer for a specific file
   */
  initializeForFile(fileSize: number): void {
    this.fileSize = fileSize;
    this.samples = [];
    this.mode = 'normal';
    this.safeModeUntil = 0;
    this.adjustmentCount = 0;
    
    // Calculate initial chunk size based on file size
    const fileBased = calculateFileSizeBasedChunk(fileSize);
    this.currentChunkSize = roundToPowerOf2(fileBased);
    
    this.lastAdjustmentReason = `Initialized for ${this.formatBytes(fileSize)} file`;
  }
  
  /**
   * Reset to defaults
   */
  reset(): void {
    this.samples = [];
    this.currentChunkSize = this.config.defaultChunkSize;
    this.mode = 'normal';
    this.safeModeUntil = 0;
    this.adjustmentCount = 0;
    this.lastAdjustmentReason = '';
    this.fileSize = 0;
  }
  
  // ==========================================================================
  // SAMPLE COLLECTION
  // ==========================================================================
  
  /**
   * Record a processing sample
   */
  recordSample(
    chunkSize: number,
    processingTime: number,
    success: boolean
  ): void {
    const governor = getMemoryGovernor();
    const memoryStats = governor.getStats();
    
    const throughputMBps = processingTime > 0
      ? (chunkSize / MB) / (processingTime / 1000)
      : 0;
    
    const sample: ProcessingSample = {
      chunkSize,
      processingTime,
      throughputMBps,
      timestamp: Date.now(),
      success,
      memoryPressure: memoryStats.pressure,
    };
    
    this.samples.push(sample);
    
    // Keep only recent samples
    if (this.samples.length > this.config.sampleWindow) {
      this.samples.shift();
    }
    
    // Adjust based on new sample
    this.adjustChunkSize(sample);
  }
  
  // ==========================================================================
  // SIZE ADJUSTMENT
  // ==========================================================================
  
  /**
   * Adjust chunk size based on sample
   */
  private adjustChunkSize(sample: ProcessingSample): void {
    // Check if in safe mode recovery
    if (Date.now() < this.safeModeUntil) {
      this.mode = 'safe';
      this.currentChunkSize = this.config.safeChunkSize;
      return;
    }
    
    // Check memory pressure first
    if (sample.memoryPressure === 'critical') {
      this.enterMicroMode('Critical memory pressure');
      return;
    }
    
    if (sample.memoryPressure === 'high') {
      this.reduceChunkSize('High memory pressure');
      return;
    }
    
    // Check for failure
    if (!sample.success) {
      this.handleFailure();
      return;
    }
    
    // Adjust based on processing time
    if (sample.processingTime < this.config.minProcessingTime) {
      // Processing too fast - increase chunk size
      this.increaseChunkSize('Processing under target time');
    } else if (sample.processingTime > this.config.maxProcessingTime) {
      // Processing too slow - decrease chunk size
      this.reduceChunkSize('Processing over max time');
    } else if (sample.processingTime > this.config.targetProcessingTime * 1.5) {
      // Processing slower than ideal - slight reduction
      this.reduceChunkSize('Processing slower than target');
    } else {
      // In good range - check trend
      this.checkTrendAdjustment();
    }
  }
  
  /**
   * Increase chunk size
   */
  private increaseChunkSize(reason: string): void {
    if (this.mode === 'micro' || this.mode === 'safe') {
      // Gradually exit safe/micro mode
      this.mode = 'degraded';
      this.currentChunkSize = this.config.safeChunkSize;
      this.lastAdjustmentReason = `Exiting ${this.mode} mode`;
      return;
    }
    
    if (this.mode === 'degraded') {
      // Return to normal mode
      this.mode = 'normal';
      this.currentChunkSize = this.config.defaultChunkSize;
      this.lastAdjustmentReason = 'Returning to normal mode';
      return;
    }
    
    const increase = Math.ceil(this.currentChunkSize * (1 + this.config.adjustmentFactor));
    const newSize = clampChunkSize(roundToPowerOf2(increase), this.config);
    
    if (newSize !== this.currentChunkSize) {
      this.currentChunkSize = newSize;
      this.adjustmentCount++;
      this.lastAdjustmentReason = `Increased: ${reason}`;
    }
  }
  
  /**
   * Reduce chunk size
   */
  private reduceChunkSize(reason: string): void {
    const decrease = Math.floor(this.currentChunkSize * (1 - this.config.adjustmentFactor));
    const newSize = clampChunkSize(roundToPowerOf2(decrease), this.config);
    
    if (newSize !== this.currentChunkSize) {
      this.currentChunkSize = newSize;
      this.adjustmentCount++;
      this.lastAdjustmentReason = `Reduced: ${reason}`;
    }
    
    // Update mode
    if (this.currentChunkSize <= this.config.safeChunkSize) {
      this.mode = 'safe';
    } else if (this.currentChunkSize < this.config.defaultChunkSize) {
      this.mode = 'degraded';
    } else {
      this.mode = 'normal';
    }
  }
  
  /**
   * Enter micro mode for emergency
   */
  private enterMicroMode(reason: string): void {
    this.mode = 'micro';
    this.currentChunkSize = this.config.microChunkSize;
    this.adjustmentCount++;
    this.lastAdjustmentReason = `Micro mode: ${reason}`;
  }
  
  /**
   * Handle chunk processing failure
   */
  private handleFailure(): void {
    // Enter safe mode
    this.mode = 'safe';
    this.currentChunkSize = this.config.safeChunkSize;
    this.safeModeUntil = Date.now() + this.config.safeModeRecoveryTime;
    this.adjustmentCount++;
    this.lastAdjustmentReason = 'Safe mode: Chunk processing failure';
  }
  
  /**
   * Check trend and adjust if stable
   */
  private checkTrendAdjustment(): void {
    if (this.samples.length < this.config.sampleWindow / 2) {
      return; // Not enough samples
    }
    
    // Calculate average processing time
    const recentSamples = this.samples.slice(-5);
    const avgTime = recentSamples.reduce((sum, s) => sum + s.processingTime, 0) / recentSamples.length;
    
    // If consistently fast and no memory pressure, try increasing
    const allFast = recentSamples.every(s => s.processingTime < this.config.targetProcessingTime);
    const allSuccess = recentSamples.every(s => s.success);
    const noMemoryIssues = recentSamples.every(
      s => s.memoryPressure === 'low' || s.memoryPressure === 'medium'
    );
    
    if (allFast && allSuccess && noMemoryIssues && avgTime < this.config.targetProcessingTime) {
      this.increaseChunkSize('Stable fast processing');
    }
  }
  
  // ==========================================================================
  // RECOMMENDATIONS
  // ==========================================================================
  
  /**
   * Get current chunk size recommendation
   */
  getRecommendation(): ChunkSizeRecommendation {
    const governor = getMemoryGovernor();
    const memoryStats = governor.getStats();
    
    // Check memory pressure
    if (memoryStats.pressure === 'critical') {
      return {
        size: this.config.microChunkSize,
        mode: 'micro',
        reason: 'Critical memory pressure',
        confidence: 1.0,
      };
    }
    
    if (memoryStats.pressure === 'high') {
      return {
        size: Math.min(this.currentChunkSize, this.config.safeChunkSize),
        mode: 'safe',
        reason: 'High memory pressure',
        confidence: 0.9,
      };
    }
    
    // Calculate confidence based on sample count
    const confidence = Math.min(1.0, this.samples.length / this.config.sampleWindow);
    
    return {
      size: this.currentChunkSize,
      mode: this.mode,
      reason: this.lastAdjustmentReason || 'Initial recommendation',
      confidence,
    };
  }
  
  /**
   * Get chunk size for worker restart (safe mode)
   */
  getWorkerRestartChunkSize(): number {
    this.mode = 'safe';
    this.safeModeUntil = Date.now() + this.config.safeModeRecoveryTime;
    this.currentChunkSize = this.config.safeChunkSize;
    this.lastAdjustmentReason = 'Safe mode: Worker restart';
    return this.currentChunkSize;
  }
  
  /**
   * Get minimum safe chunk size
   */
  getMinimumChunkSize(): number {
    return this.config.minChunkSize;
  }
  
  /**
   * Get maximum chunk size
   */
  getMaximumChunkSize(): number {
    return this.config.maxChunkSize;
  }
  
  // ==========================================================================
  // STATISTICS
  // ==========================================================================
  
  /**
   * Get sizer statistics
   */
  getStats(): ChunkSizerStats & { fileSize: number } {
    const successfulSamples = this.samples.filter(s => s.success);
    
    const avgProcessingTime = successfulSamples.length > 0
      ? successfulSamples.reduce((sum, s) => sum + s.processingTime, 0) / successfulSamples.length
      : 0;
    
    const avgThroughput = successfulSamples.length > 0
      ? successfulSamples.reduce((sum, s) => sum + s.throughputMBps, 0) / successfulSamples.length
      : 0;
    
    return {
      currentChunkSize: this.currentChunkSize,
      recommendedChunkSize: this.getRecommendation().size,
      mode: this.mode,
      avgProcessingTime,
      avgThroughput,
      samplesCollected: this.samples.length,
      adjustments: this.adjustmentCount,
      lastAdjustmentReason: this.lastAdjustmentReason,
      fileSize: this.fileSize,
    };
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
    if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalChunkSizer: DynamicChunkSizer | null = null;

export function getDynamicChunkSizer(
  config?: Partial<ChunkSizerConfig>
): DynamicChunkSizer {
  if (!globalChunkSizer) {
    globalChunkSizer = new DynamicChunkSizer(config);
  }
  return globalChunkSizer;
}

export function resetDynamicChunkSizer(): void {
  if (globalChunkSizer) {
    globalChunkSizer.reset();
    globalChunkSizer = null;
  }
}
