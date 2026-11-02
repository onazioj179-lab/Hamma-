/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Types
 * Creator: OJ Treasure Onazi
 * 
 * Type definitions for integrity verification, anomaly detection,
 * repair tracking, and parallel throughput optimization.
 */

// ============================================================================
// SIZE CONSTANTS
// ============================================================================

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

// ============================================================================
// VERIFICATION STATUS
// ============================================================================

export type VerificationStatus = 
  | 'pending'
  | 'in-progress'
  | 'passed'
  | 'failed'
  | 'repaired'
  | 'skipped';

export type VerificationStep =
  | 'chunk-count'
  | 'chunk-hashes'
  | 'chunk-sizes'
  | 'sequential-offsets'
  | 'file-boundaries'
  | 'metadata-block'
  | 'footer-validation'
  | 'reconstructability'
  | 'compression-ratio';

export type AnomalyType =
  | 'missing-chunk'
  | 'corrupt-chunk'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'offset-gap'
  | 'offset-overlap'
  | 'metadata-corrupt'
  | 'footer-invalid'
  | 'ratio-suspicious'
  | 'boundary-error'
  | 'reconstruction-failure';

export type RepairAction =
  | 'recompress-chunk'
  | 'rebuild-metadata'
  | 'regenerate-footer'
  | 'recalculate-offsets'
  | 'fix-boundaries'
  | 'full-reprocess';

// ============================================================================
// CHUNK VERIFICATION
// ============================================================================

export interface ChunkVerificationInfo {
  chunkIndex: number;
  expectedHash: string;
  actualHash?: string;
  expectedSize: number;
  actualSize?: number;
  expectedOffset: bigint;
  actualOffset?: bigint;
  compressionRatio: number;
  processingTime: number;
  workerRetries: number;
  status: VerificationStatus;
  anomalies: AnomalyType[];
}

export interface ChunkAnomalyScore {
  chunkIndex: number;
  score: number;  // 0-1, higher = more likely anomaly
  factors: {
    ratioSuspicion: number;
    sizeSuspicion: number;
    timingSuspicion: number;
    retrySuspicion: number;
    patternSuspicion: number;
  };
  predictedAnomalies: AnomalyType[];
  recommendedAction: RepairAction | 'verify-only' | 'skip';
}

// ============================================================================
// FILE VERIFICATION
// ============================================================================

export interface FileVerificationInfo {
  fileIndex: number;
  filePath: string;
  expectedSize: number;
  startChunk: number;
  endChunk: number;
  chunkCount: number;
  status: VerificationStatus;
  boundaryValid: boolean;
  reconstructable: boolean;
}

// ============================================================================
// ARCHIVE VERIFICATION
// ============================================================================

export interface ArchiveVerificationResult {
  archiveId: string;
  status: VerificationStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  
  // Step results
  steps: Map<VerificationStep, StepResult>;
  
  // Chunk analysis
  totalChunks: number;
  verifiedChunks: number;
  failedChunks: number;
  repairedChunks: number;
  
  // File analysis
  totalFiles: number;
  verifiedFiles: number;
  failedFiles: number;
  
  // Anomalies
  anomalies: VerificationAnomaly[];
  anomalyScore: number;  // 0-1, overall archive health
  
  // Repairs
  repairsAttempted: number;
  repairsSuccessful: number;
  repairHistory: RepairRecord[];
  
  // Metadata
  metadataValid: boolean;
  footerValid: boolean;
  
  // Final state
  archiveReady: boolean;
  downloadAllowed: boolean;
}

export interface StepResult {
  step: VerificationStep;
  status: VerificationStatus;
  startTime: number;
  endTime: number;
  passed: boolean;
  details: string;
  affectedItems?: number[];
}

export interface VerificationAnomaly {
  id: string;
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: {
    chunkIndex?: number;
    fileIndex?: number;
    offset?: bigint;
    metadataField?: string;
  };
  description: string;
  detectedAt: number;
  repairAttempted: boolean;
  repairSuccessful: boolean;
}

export interface RepairRecord {
  id: string;
  anomalyId: string;
  action: RepairAction;
  targetChunks: number[];
  startTime: number;
  endTime: number;
  successful: boolean;
  bytesReprocessed: number;
  details: string;
}

// ============================================================================
// AI ANALYSIS TYPES
// ============================================================================

export interface AIVerificationConfig {
  /** Enable AI-assisted anomaly prediction */
  enablePrediction: boolean;
  
  /** Anomaly score threshold for deep verification */
  anomalyThreshold: number;
  
  /** Max chunks to sample for pattern analysis */
  sampleSize: number;
  
  /** Skip verification for low-risk chunks */
  skipLowRisk: boolean;
  
  /** Low-risk threshold (chunks below this are skipped) */
  lowRiskThreshold: number;
  
  /** Enable parallel hash verification */
  parallelHashing: boolean;
  
  /** Max parallel hash operations */
  maxParallelHashes: number;
  
  /** Enable WASM-accelerated hashing */
  wasmHashing: boolean;
  
  /** Auto-repair on failure */
  autoRepair: boolean;
  
  /** Max repair attempts per chunk */
  maxRepairAttempts: number;
}

export const DEFAULT_AI_VERIFICATION_CONFIG: AIVerificationConfig = {
  enablePrediction: true,
  anomalyThreshold: 0.3,
  sampleSize: 100,
  skipLowRisk: true,
  lowRiskThreshold: 0.1,
  parallelHashing: true,
  maxParallelHashes: 8,
  wasmHashing: true,
  autoRepair: true,
  maxRepairAttempts: 3,
};

export interface AIAnalysisResult {
  /** Overall archive health score (0-1) */
  healthScore: number;
  
  /** Predicted failure probability */
  failureProbability: number;
  
  /** Chunks flagged for detailed verification */
  flaggedChunks: number[];
  
  /** Chunks safe to skip detailed verification */
  safeChunks: number[];
  
  /** Pattern-based anomaly predictions */
  predictions: ChunkAnomalyScore[];
  
  /** Recommended verification strategy */
  strategy: 'full' | 'targeted' | 'lightweight';
  
  /** Estimated verification time (ms) */
  estimatedTime: number;
  
  /** Confidence in analysis */
  confidence: number;
}

// ============================================================================
// STATISTICAL SIGNALS (AI Input)
// ============================================================================

export interface ChunkStatistics {
  chunkIndex: number;
  compressedSize: number;
  originalSize: number;
  compressionRatio: number;
  processingTime: number;
  workerRetries: number;
  workerStalls: number;
  wasmErrors: number;
  memoryPressure: number;
}

export interface ArchiveStatistics {
  totalChunks: number;
  totalFiles: number;
  totalCompressedSize: bigint;
  totalOriginalSize: bigint;
  avgCompressionRatio: number;
  avgProcessingTime: number;
  stdDevRatio: number;
  stdDevTime: number;
  workerCrashes: number;
  memoryPressureEvents: number;
  chunkStats: ChunkStatistics[];
}

// ============================================================================
// PARALLEL THROUGHPUT TYPES
// ============================================================================

export type LaneStatus = 'idle' | 'active' | 'stalled' | 'error' | 'warming';

export interface Lane {
  id: string;
  workerId: string;
  status: LaneStatus;
  currentChunk: number | null;
  chunksProcessed: number;
  bytesProcessed: bigint;
  averageTime: number;
  stdDeviation: number;
  stallCount: number;
  retryCount: number;
  wasmWarmState: 'cold' | 'warm' | 'hot';
  memoryFootprint: number;
  lastActivity: number;
}

export interface LaneProfile {
  laneId: string;
  speedScore: number;  // 0-1, relative to fastest lane
  reliabilityScore: number;  // 0-1, based on errors/retries
  memoryEfficiency: number;  // 0-1, based on footprint
  recommendedWorkload: 'high' | 'normal' | 'low' | 'minimal';
}

export interface ParallelConfig {
  /** Number of physical cores */
  physicalCores: number;
  
  /** Number of execution lanes */
  laneCount: number;
  
  /** Lane multiplier (lanes per core) */
  laneMultiplier: number;
  
  /** Enable adaptive boost mode */
  adaptiveBoost: boolean;
  
  /** Enable turbo execution */
  turboMode: boolean;
  
  /** Target throughput (bytes/sec) */
  targetThroughput: number;
  
  /** Max memory per lane */
  maxLaneMemory: number;
  
  /** Chunk pre-buffer depth */
  preBufferDepth: number;
  
  /** Rebalance interval (ms) */
  rebalanceInterval: number;
}

export const DEFAULT_PARALLEL_CONFIG: ParallelConfig = {
  physicalCores: typeof navigator !== 'undefined' 
    ? (navigator.hardwareConcurrency || 4) 
    : 4,
  laneCount: 0,  // Auto-calculated
  laneMultiplier: 1,
  adaptiveBoost: true,
  turboMode: false,
  targetThroughput: 100 * MB,  // 100 MB/s target
  maxLaneMemory: 200 * MB,
  preBufferDepth: 10,
  rebalanceInterval: 200,
};

// ============================================================================
// THROUGHPUT METRICS
// ============================================================================

export interface ThroughputMetrics {
  /** Current throughput (bytes/sec) */
  currentThroughput: number;
  
  /** Peak throughput achieved */
  peakThroughput: number;
  
  /** Average throughput */
  avgThroughput: number;
  
  /** Throughput history (last 100 samples) */
  history: number[];
  
  /** Active lanes count */
  activeLanes: number;
  
  /** Idle lanes count */
  idleLanes: number;
  
  /** Pipeline saturation (0-1) */
  saturation: number;
  
  /** Estimated completion time (ms) */
  estimatedCompletion: number;
  
  /** Bytes remaining */
  bytesRemaining: bigint;
}

export interface WorkloadDistribution {
  laneId: string;
  assignedChunks: number[];
  pendingChunks: number;
  completedChunks: number;
  workloadScore: number;  // Relative workload vs others
}

// ============================================================================
// PARALLEL WRITER TYPES
// ============================================================================

export interface WriteQueueItem {
  chunkIndex: number;
  data: Uint8Array;
  offset: bigint;
  timestamp: number;
  priority: number;
}

export interface ParallelWriterConfig {
  /** Max items in write queue */
  maxQueueSize: number;
  
  /** Flush threshold (bytes) */
  flushThreshold: number;
  
  /** Flush interval (ms) */
  flushInterval: number;
  
  /** Enable ordered writes */
  orderedWrites: boolean;
  
  /** Max out-of-order buffer size */
  maxOutOfOrderBuffer: number;
}

export const DEFAULT_PARALLEL_WRITER_CONFIG: ParallelWriterConfig = {
  maxQueueSize: 100,
  flushThreshold: 16 * MB,
  flushInterval: 1000,
  orderedWrites: true,
  maxOutOfOrderBuffer: 50,
};

export interface WriterState {
  nextExpectedIndex: number;
  lastWrittenOffset: bigint;
  pendingWrites: Map<number, WriteQueueItem>;
  writeCount: number;
  bytesWritten: bigint;
  flushCount: number;
}

// ============================================================================
// DECOMPRESSION TYPES
// ============================================================================

export interface DecompressionLane {
  id: string;
  status: LaneStatus;
  currentChunk: number | null;
  bytesExtracted: bigint;
  averageTime: number;
  prefetchQueue: number[];
}

export interface DecompressionConfig {
  /** Number of parallel lanes */
  laneCount: number;
  
  /** Enable predictive prefetch */
  prefetchEnabled: boolean;
  
  /** Prefetch depth (chunks ahead) */
  prefetchDepth: number;
  
  /** Enable random access optimization */
  randomAccessOptimized: boolean;
  
  /** Cache size for frequently accessed chunks */
  cacheSize: number;
}

export const DEFAULT_DECOMPRESSION_CONFIG: DecompressionConfig = {
  laneCount: 4,
  prefetchEnabled: true,
  prefetchDepth: 5,
  randomAccessOptimized: true,
  cacheSize: 50 * MB,
};

// ============================================================================
// EVENT TYPES
// ============================================================================

export type IntegrityEvent =
  | { type: 'verification-start'; archiveId: string; totalChunks: number }
  | { type: 'verification-progress'; archiveId: string; verified: number; total: number }
  | { type: 'verification-step'; step: VerificationStep; status: VerificationStatus }
  | { type: 'anomaly-detected'; anomaly: VerificationAnomaly }
  | { type: 'repair-start'; repairId: string; action: RepairAction }
  | { type: 'repair-complete'; repairId: string; successful: boolean }
  | { type: 'verification-complete'; result: ArchiveVerificationResult }
  | { type: 'archive-ready'; archiveId: string }
  | { type: 'archive-failed'; archiveId: string; reason: string }
  // Parallel events
  | { type: 'lane-assigned'; laneId: string; chunkIndex: number }
  | { type: 'lane-completed'; laneId: string; chunkIndex: number; time: number }
  | { type: 'lane-stalled'; laneId: string; reason: string }
  | { type: 'rebalance'; from: string; to: string; chunks: number[] }
  | { type: 'throughput-update'; metrics: ThroughputMetrics }
  | { type: 'saturation-warning'; saturation: number }
  | { type: 'memory-pressure'; current: number; limit: number };

export type IntegrityEventHandler = (event: IntegrityEvent) => void;

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface VerificationProgress {
  phase: 'analyzing' | 'verifying' | 'repairing' | 'finalizing';
  currentStep: VerificationStep | null;
  chunksVerified: number;
  totalChunks: number;
  filesVerified: number;
  totalFiles: number;
  anomaliesFound: number;
  repairsAttempted: number;
  estimatedRemaining: number;
  message: string;
}

export interface VerificationSummary {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  anomalies: number;
  repairs: number;
  duration: number;
  archiveSize: bigint;
  compressionRatio: number;
}
