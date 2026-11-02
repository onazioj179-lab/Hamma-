/**
 * SPK V46 - AI Optimization Types
 * Type definitions for AI-driven pipeline optimization
 */

// ============================================================================
// AI INPUT SIGNALS (Telemetry)
// ============================================================================

/**
 * Telemetry signals sent to AI optimizer
 * Contains ONLY metadata - never user content
 */
export interface AITelemetrySignals {
  /** File type/MIME type */
  fileType: string;
  /** File size in bytes */
  fileSize: number;
  /** Average chunk processing time in ms */
  avgChunkTimeMs: number;
  /** Worker load percentage (0-100) */
  workerLoadPercent: number;
  /** Number of WASM stall events */
  wasmStallCount: number;
  /** Current memory usage in bytes */
  memoryUsage: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Current throughput in bytes/sec */
  throughputBps: number;
  /** Number of files in archive */
  fileCount: number;
  /** Total chunk count */
  chunkCount: number;
  /** Hardware profile */
  hardware: HardwareProfile;
  /** Historical performance data */
  history?: HistoricalPerformance;
}

/**
 * Hardware profile for optimization
 */
export interface HardwareProfile {
  /** Logical CPU cores */
  cpuCores: number;
  /** Available memory in bytes */
  availableMemory: number;
  /** Device type */
  deviceType: 'desktop' | 'laptop' | 'tablet' | 'mobile' | 'unknown';
  /** GPU available for compute */
  gpuAvailable: boolean;
  /** WASM SIMD support */
  simdSupported: boolean;
  /** WASM threads support */
  threadsSupported: boolean;
  /** Estimated CPU speed tier (1-10) */
  cpuSpeedTier: number;
  /** Estimated I/O speed tier (1-10) */
  ioSpeedTier: number;
}

/**
 * Historical performance from past jobs
 */
export interface HistoricalPerformance {
  /** Average compression ratio achieved */
  avgCompressionRatio: number;
  /** Average throughput achieved in MB/s */
  avgThroughputMBps: number;
  /** Best performing chunk size */
  bestChunkSize: number;
  /** Best performing worker count */
  bestWorkerCount: number;
  /** Total jobs completed */
  totalJobs: number;
  /** Success rate (0-1) */
  successRate: number;
  /** File type performance map */
  fileTypePerformance: Map<string, FileTypeStats>;
}

/**
 * Per-file-type statistics
 */
export interface FileTypeStats {
  /** File type/MIME */
  fileType: string;
  /** Sample count */
  sampleCount: number;
  /** Average compression ratio */
  avgRatio: number;
  /** Best chunk size for this type */
  bestChunkSize: number;
  /** Best mode for this type */
  bestMode: 'fast' | 'strong' | 'auto';
  /** Average processing speed MB/s */
  avgSpeedMBps: number;
}

// ============================================================================
// AI OUTPUT - OPTIMIZATION RECOMMENDATIONS
// ============================================================================

/**
 * AI optimization recommendations
 */
export interface AIOptimizationOutput {
  /** Recommended chunk size in bytes */
  chunkSize: number;
  /** Number of concurrent processing lanes */
  concurrentLanes: number;
  /** Number of worker threads */
  workerCount: number;
  /** WASM batch size */
  wasmBatchSize: number;
  /** I/O buffer strategy */
  ioBufferStrategy: IOBufferStrategy;
  /** Compression mode */
  compressionMode: 'fast' | 'strong' | 'auto';
  /** Predicted total job time in ms */
  predictedTimeMs: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Optimization reasoning (for debugging) */
  reasoning?: string[];
}

/**
 * I/O buffer strategy
 */
export type IOBufferStrategy = 
  | 'minimal'      // Low memory, slower
  | 'balanced'     // Default
  | 'aggressive'   // High memory, faster
  | 'streaming';   // For very large files

/**
 * Real-time adjustment recommendation
 */
export interface AIRealTimeAdjustment {
  /** Adjustment type */
  type: AdjustmentType;
  /** New value to apply */
  newValue: number | string;
  /** Urgency (0-1, higher = apply faster) */
  urgency: number;
  /** Reason for adjustment */
  reason: string;
}

/**
 * Types of real-time adjustments
 */
export type AdjustmentType =
  | 'chunk-size'
  | 'worker-count'
  | 'concurrency'
  | 'memory-limit'
  | 'batch-size'
  | 'mode-switch';

// ============================================================================
// AI STATE & LIFECYCLE
// ============================================================================

/**
 * AI optimizer state
 */
export interface AIOptimizerState {
  /** Whether AI is enabled */
  enabled: boolean;
  /** Current status */
  status: AIStatus;
  /** Current recommendations */
  currentRecommendations: AIOptimizationOutput | null;
  /** Pending adjustments */
  pendingAdjustments: AIRealTimeAdjustment[];
  /** Last update timestamp */
  lastUpdateMs: number;
  /** Total optimizations applied */
  optimizationsApplied: number;
  /** Estimated performance gain */
  estimatedGainPercent: number;
}

/**
 * AI status
 */
export type AIStatus =
  | 'idle'
  | 'analyzing'
  | 'optimizing'
  | 'monitoring'
  | 'disabled'
  | 'error';

/**
 * AI configuration
 */
export interface AIConfig {
  /** Enable AI optimization */
  enabled: boolean;
  /** Learning mode (learn from jobs) */
  learningEnabled: boolean;
  /** Aggressiveness (0-1, higher = more aggressive changes) */
  aggressiveness: number;
  /** Minimum confidence to apply recommendation */
  minConfidence: number;
  /** Maximum memory budget for AI */
  maxMemoryBudget: number;
  /** Enable real-time adjustments */
  realTimeAdjustments: boolean;
}

/**
 * Default AI configuration
 */
export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: true,
  learningEnabled: true,
  aggressiveness: 0.5,
  minConfidence: 0.7,
  maxMemoryBudget: 50 * 1024 * 1024, // 50MB
  realTimeAdjustments: true,
};

// ============================================================================
// TRAINING DATA (LOCAL ONLY)
// ============================================================================

/**
 * Training sample from a completed job
 */
export interface TrainingSample {
  /** Unique sample ID */
  id: string;
  /** Timestamp */
  timestamp: number;
  /** Input signals */
  input: AITelemetrySignals;
  /** Configuration used */
  config: AIOptimizationOutput;
  /** Actual outcome */
  outcome: JobOutcome;
}

/**
 * Job outcome for training
 */
export interface JobOutcome {
  /** Job succeeded */
  success: boolean;
  /** Actual duration in ms */
  actualDurationMs: number;
  /** Actual throughput MB/s */
  actualThroughputMBps: number;
  /** Actual compression ratio */
  actualRatio: number;
  /** Peak memory usage */
  peakMemoryUsage: number;
  /** Any errors encountered */
  errorCount: number;
  /** Worker stall count */
  workerStallCount: number;
}

/**
 * Local training data store
 */
export interface LocalTrainingData {
  /** Data version */
  version: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last updated */
  updatedAt: number;
  /** Training samples */
  samples: TrainingSample[];
  /** Hardware profile */
  hardwareProfile: HardwareProfile;
  /** Aggregated statistics */
  aggregatedStats: AggregatedStats;
}

/**
 * Aggregated statistics from training
 */
export interface AggregatedStats {
  /** Total jobs processed */
  totalJobs: number;
  /** Total bytes processed */
  totalBytesProcessed: number;
  /** Average compression ratio */
  avgCompressionRatio: number;
  /** Average throughput */
  avgThroughputMBps: number;
  /** Success rate */
  successRate: number;
  /** Best settings discovered */
  bestSettings: Partial<AIOptimizationOutput>;
}

// ============================================================================
// SAFETY & FALLBACK
// ============================================================================

/**
 * Fallback configuration when AI fails
 */
export const FALLBACK_CONFIG: AIOptimizationOutput = {
  chunkSize: 4 * 1024 * 1024, // 4MB
  concurrentLanes: 4,
  workerCount: 4,
  wasmBatchSize: 8,
  ioBufferStrategy: 'balanced',
  compressionMode: 'auto',
  predictedTimeMs: 0,
  confidence: 0,
  reasoning: ['Fallback: Using default configuration'],
};

/**
 * Safety constraints for AI recommendations
 */
export const AI_SAFETY_CONSTRAINTS = {
  /** Minimum chunk size (1MB) */
  minChunkSize: 1 * 1024 * 1024,
  /** Maximum chunk size (64MB) */
  maxChunkSize: 64 * 1024 * 1024,
  /** Minimum workers */
  minWorkers: 1,
  /** Maximum workers */
  maxWorkers: 16,
  /** Minimum concurrent lanes */
  minLanes: 1,
  /** Maximum concurrent lanes */
  maxLanes: 32,
  /** Maximum memory percentage */
  maxMemoryPercent: 0.75,
  /** Minimum confidence to apply */
  minConfidence: 0.5,
} as const;
