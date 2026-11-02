/**
 * SPK Ultra-Parallel Throughput Engine - Types
 * Creator: OJ Treasure Onazi
 * 
 * Type definitions for parallel execution lanes, scheduling,
 * worker profiling, and throughput optimization.
 */

// ============================================================================
// SIZE CONSTANTS
// ============================================================================

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

// ============================================================================
// LANE STATUS
// ============================================================================

export type LaneStatus = 
  | 'idle'
  | 'active'
  | 'stalled'
  | 'error'
  | 'warming'
  | 'cooling';

export type WASMState = 'cold' | 'warm' | 'hot';

export type ThroughputMode = 
  | 'conservative'
  | 'balanced'
  | 'aggressive'
  | 'turbo';

export type RebalanceStrategy =
  | 'round-robin'
  | 'fastest-first'
  | 'memory-aware'
  | 'adaptive';

// ============================================================================
// LANE DEFINITIONS
// ============================================================================

export interface Lane {
  /** Unique lane identifier */
  id: string;
  
  /** Associated worker ID */
  workerId: string;
  
  /** Current status */
  status: LaneStatus;
  
  /** Currently processing chunk index (null if idle) */
  currentChunk: number | null;
  
  /** Total chunks processed */
  chunksProcessed: number;
  
  /** Total bytes processed */
  bytesProcessed: bigint;
  
  /** Average processing time per chunk (ms) */
  averageTime: number;
  
  /** Standard deviation of processing time */
  stdDeviation: number;
  
  /** Number of stalls */
  stallCount: number;
  
  /** Number of retries */
  retryCount: number;
  
  /** WASM warm state */
  wasmState: WASMState;
  
  /** Current memory footprint (bytes) */
  memoryFootprint: number;
  
  /** Last activity timestamp */
  lastActivity: number;
  
  /** Processing history (last N times) */
  timeHistory: number[];
  
  /** Error count */
  errorCount: number;
}

export interface LaneProfile {
  /** Lane identifier */
  laneId: string;
  
  /** Speed score (0-1, relative to fastest lane) */
  speedScore: number;
  
  /** Reliability score (0-1, based on errors/retries) */
  reliabilityScore: number;
  
  /** Memory efficiency (0-1, based on footprint) */
  memoryEfficiency: number;
  
  /** Recommended workload level */
  recommendedWorkload: 'high' | 'normal' | 'low' | 'minimal';
  
  /** Estimated throughput (bytes/sec) */
  estimatedThroughput: number;
  
  /** Warmup complete */
  warmupComplete: boolean;
}

// ============================================================================
// SCHEDULER TYPES
// ============================================================================

export interface SchedulerConfig {
  /** Number of physical CPU cores */
  physicalCores: number;
  
  /** Lane multiplier (lanes per core) */
  laneMultiplier: number;
  
  /** Enable adaptive boost */
  adaptiveBoost: boolean;
  
  /** Enable turbo mode (full saturation) */
  turboMode: boolean;
  
  /** Base lane count (auto-calculated if 0) */
  baseLaneCount: number;
  
  /** Max lane count (hard limit) */
  maxLaneCount: number;
  
  /** Min lane count (minimum 1) */
  minLaneCount: number;
  
  /** Rebalance interval (ms) */
  rebalanceInterval: number;
  
  /** Rebalance strategy */
  rebalanceStrategy: RebalanceStrategy;
  
  /** Stall threshold (ms without activity) */
  stallThreshold: number;
  
  /** Max chunk retries */
  maxRetries: number;
  
  /** Warmup chunks per lane */
  warmupChunks: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  physicalCores: typeof navigator !== 'undefined' 
    ? (navigator.hardwareConcurrency || 4) 
    : 4,
  laneMultiplier: 1,
  adaptiveBoost: true,
  turboMode: false,
  baseLaneCount: 0,
  maxLaneCount: 64,
  minLaneCount: 1,
  rebalanceInterval: 200,
  rebalanceStrategy: 'adaptive',
  stallThreshold: 5000,
  maxRetries: 3,
  warmupChunks: 2,
};

export interface ChunkAssignment {
  chunkIndex: number;
  laneId: string;
  priority: number;
  assignedAt: number;
  deadline?: number;
}

export interface WorkloadDistribution {
  laneId: string;
  assignedChunks: number[];
  pendingChunks: number;
  completedChunks: number;
  workloadScore: number;  // Relative workload vs others
}

// ============================================================================
// WORKER PROFILER TYPES
// ============================================================================

export interface WorkerProfile {
  /** Worker identifier */
  workerId: string;
  
  /** Associated lane */
  laneId: string;
  
  /** Average chunk processing time */
  averageChunkTime: number;
  
  /** Standard deviation of timing */
  stdDeviation: number;
  
  /** WASM warmup state */
  wasmWarmState: WASMState;
  
  /** Current memory footprint */
  memoryFootprint: number;
  
  /** Sustained throughput (bytes/sec) */
  sustainedThroughput: number;
  
  /** Peak throughput observed */
  peakThroughput: number;
  
  /** Total chunks processed */
  chunksProcessed: number;
  
  /** Total bytes processed */
  bytesProcessed: bigint;
  
  /** Error rate */
  errorRate: number;
  
  /** Stall rate */
  stallRate: number;
  
  /** Efficiency score (0-1) */
  efficiencyScore: number;
}

export interface ProfilerConfig {
  /** Sample window size */
  sampleWindow: number;
  
  /** Update interval (ms) */
  updateInterval: number;
  
  /** Track memory usage */
  trackMemory: boolean;
  
  /** Track WASM state */
  trackWasmState: boolean;
  
  /** Outlier threshold (standard deviations) */
  outlierThreshold: number;
}

export const DEFAULT_PROFILER_CONFIG: ProfilerConfig = {
  sampleWindow: 50,
  updateInterval: 100,
  trackMemory: true,
  trackWasmState: true,
  outlierThreshold: 3,
};

// ============================================================================
// STREAM MANAGER TYPES
// ============================================================================

export interface StreamConfig {
  /** Pre-buffer depth (chunks ahead to buffer) */
  preBufferDepth: number;
  
  /** High RAM pre-buffer depth */
  highRamPreBuffer: number;
  
  /** Low RAM pre-buffer depth */
  lowRamPreBuffer: number;
  
  /** Max buffer memory (bytes) */
  maxBufferMemory: number;
  
  /** Chunk read timeout (ms) */
  readTimeout: number;
  
  /** Enable predictive prefetch */
  predictivePrefetch: boolean;
  
  /** Prefetch lookahead */
  prefetchLookahead: number;
  
  /** Stream chunk size */
  streamChunkSize: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  preBufferDepth: 10,
  highRamPreBuffer: 50,
  lowRamPreBuffer: 3,
  maxBufferMemory: 500 * MB,
  readTimeout: 30000,
  predictivePrefetch: true,
  prefetchLookahead: 5,
  streamChunkSize: 4 * MB,
};

export interface StreamBuffer {
  chunkIndex: number;
  data: Uint8Array;
  size: number;
  bufferedAt: number;
  readCount: number;
}

export interface StreamStats {
  bufferedChunks: number;
  bufferMemory: number;
  hitRate: number;
  missRate: number;
  prefetchAccuracy: number;
  avgBufferTime: number;
}

// ============================================================================
// PARALLEL WRITER TYPES
// ============================================================================

export interface WriterConfig {
  /** Max items in write queue */
  maxQueueSize: number;
  
  /** Flush threshold (bytes) */
  flushThreshold: number;
  
  /** Flush interval (ms) */
  flushInterval: number;
  
  /** Enable ordered writes */
  orderedWrites: boolean;
  
  /** Max out-of-order buffer */
  maxOutOfOrderBuffer: number;
  
  /** Write batch size */
  batchSize: number;
  
  /** Enable compression verification */
  verifyWrites: boolean;
}

export const DEFAULT_WRITER_CONFIG: WriterConfig = {
  maxQueueSize: 100,
  flushThreshold: 16 * MB,
  flushInterval: 1000,
  orderedWrites: true,
  maxOutOfOrderBuffer: 50,
  batchSize: 10,
  verifyWrites: true,
};

export interface WriteQueueItem {
  chunkIndex: number;
  data: Uint8Array;
  offset: bigint;
  timestamp: number;
  priority: number;
  verified: boolean;
}

export interface WriterState {
  nextExpectedIndex: number;
  lastWrittenOffset: bigint;
  pendingWrites: Map<number, WriteQueueItem>;
  writeCount: number;
  bytesWritten: bigint;
  flushCount: number;
  errors: number;
}

// ============================================================================
// THROUGHPUT OPTIMIZER TYPES
// ============================================================================

export interface ThroughputConfig {
  /** Target throughput (bytes/sec) */
  targetThroughput: number;
  
  /** Minimum throughput (bytes/sec) */
  minThroughput: number;
  
  /** Max memory usage */
  maxMemory: number;
  
  /** Throughput mode */
  mode: ThroughputMode;
  
  /** Enable dynamic lane scaling */
  dynamicScaling: boolean;
  
  /** Scale up threshold (throughput ratio) */
  scaleUpThreshold: number;
  
  /** Scale down threshold */
  scaleDownThreshold: number;
  
  /** Measurement window (ms) */
  measurementWindow: number;
  
  /** History window size */
  historySize: number;
}

export const DEFAULT_THROUGHPUT_CONFIG: ThroughputConfig = {
  targetThroughput: 100 * MB,  // 100 MB/s
  minThroughput: 10 * MB,      // 10 MB/s minimum
  maxMemory: 2 * GB,
  mode: 'balanced',
  dynamicScaling: true,
  scaleUpThreshold: 0.9,
  scaleDownThreshold: 0.5,
  measurementWindow: 1000,
  historySize: 100,
};

export interface ThroughputMetrics {
  /** Current throughput (bytes/sec) */
  currentThroughput: number;
  
  /** Peak throughput achieved */
  peakThroughput: number;
  
  /** Average throughput */
  avgThroughput: number;
  
  /** Throughput history */
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
  
  /** Current memory usage */
  memoryUsage: number;
}

export interface ThroughputTarget {
  coreCount: number;
  minThroughput: number;  // bytes/sec
  maxThroughput: number;  // bytes/sec
  recommendedLanes: number;
}

// Target throughput by core count
export const THROUGHPUT_TARGETS: ThroughputTarget[] = [
  { coreCount: 4, minThroughput: 7 * MB, maxThroughput: 15 * MB, recommendedLanes: 4 },
  { coreCount: 8, minThroughput: 15 * MB, maxThroughput: 30 * MB, recommendedLanes: 8 },
  { coreCount: 16, minThroughput: 30 * MB, maxThroughput: 60 * MB, recommendedLanes: 16 },
  { coreCount: 32, minThroughput: 60 * MB, maxThroughput: 120 * MB, recommendedLanes: 32 },
];

// ============================================================================
// COORDINATOR TYPES
// ============================================================================

export interface CoordinatorConfig extends SchedulerConfig {
  /** Stream config */
  stream: StreamConfig;
  
  /** Writer config */
  writer: WriterConfig;
  
  /** Throughput config */
  throughput: ThroughputConfig;
  
  /** Profiler config */
  profiler: ProfilerConfig;
  
  /** Enable memory governor */
  memoryGovernor: boolean;
  
  /** Memory safety margin */
  memorySafetyMargin: number;
  
  /** Enable auto-recovery */
  autoRecovery: boolean;
  
  /** Recovery timeout (ms) */
  recoveryTimeout: number;
}

export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  ...DEFAULT_SCHEDULER_CONFIG,
  stream: DEFAULT_STREAM_CONFIG,
  writer: DEFAULT_WRITER_CONFIG,
  throughput: DEFAULT_THROUGHPUT_CONFIG,
  profiler: DEFAULT_PROFILER_CONFIG,
  memoryGovernor: true,
  memorySafetyMargin: 0.1,
  autoRecovery: true,
  recoveryTimeout: 10000,
};

// ============================================================================
// EVENT TYPES
// ============================================================================

export type ParallelEvent =
  | { type: 'lane-created'; laneId: string; workerId: string }
  | { type: 'lane-assigned'; laneId: string; chunkIndex: number }
  | { type: 'lane-completed'; laneId: string; chunkIndex: number; time: number; bytes: number }
  | { type: 'lane-stalled'; laneId: string; reason: string }
  | { type: 'lane-error'; laneId: string; error: string }
  | { type: 'lane-recovered'; laneId: string }
  | { type: 'rebalance'; from: string; to: string; chunks: number[] }
  | { type: 'throughput-update'; metrics: ThroughputMetrics }
  | { type: 'saturation-warning'; saturation: number }
  | { type: 'memory-pressure'; current: number; limit: number }
  | { type: 'scale-up'; newLanes: number }
  | { type: 'scale-down'; removedLanes: string[] }
  | { type: 'warmup-complete'; laneId: string }
  | { type: 'buffer-full' }
  | { type: 'buffer-empty' }
  | { type: 'write-flush'; count: number; bytes: number }
  | { type: 'compression-complete'; totalChunks: number; totalBytes: bigint; duration: number }
  | { type: 'decompression-complete'; totalChunks: number; totalBytes: bigint; duration: number };

export type ParallelEventHandler = (event: ParallelEvent) => void;

// ============================================================================
// COMPRESSION JOB TYPES
// ============================================================================

export interface CompressionJob {
  id: string;
  files: File[];
  totalSize: bigint;
  totalChunks: number;
  chunkSize: number;
  algorithm: string;
  level: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  startTime?: number;
  endTime?: number;
}

export interface ChunkJob {
  jobId: string;
  chunkIndex: number;
  data: Uint8Array;
  originalSize: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  assignedLane?: string;
  result?: Uint8Array;
  hash?: string;
  retries: number;
  error?: string;
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
  
  /** Verify decompressed hashes */
  verifyHashes: boolean;
}

export const DEFAULT_DECOMPRESSION_CONFIG: DecompressionConfig = {
  laneCount: 4,
  prefetchEnabled: true,
  prefetchDepth: 5,
  randomAccessOptimized: true,
  cacheSize: 50 * MB,
  verifyHashes: true,
};

// ============================================================================
// UTILITIES
// ============================================================================

export function getRecommendedLaneCount(cores: number, turbo = false): number {
  const base = Math.max(1, cores - 1);
  return turbo ? Math.min(64, cores * 2) : base;
}

export function getThroughputTarget(cores: number): ThroughputTarget {
  // Find closest target
  for (let i = THROUGHPUT_TARGETS.length - 1; i >= 0; i--) {
    if (cores >= THROUGHPUT_TARGETS[i].coreCount) {
      return THROUGHPUT_TARGETS[i];
    }
  }
  return THROUGHPUT_TARGETS[0];
}

export function calculateSaturation(
  activeLanes: number,
  totalLanes: number,
  avgTime: number,
  targetTime: number
): number {
  if (totalLanes === 0) return 0;
  const laneUtilization = activeLanes / totalLanes;
  const timeEfficiency = targetTime > 0 ? Math.min(1, targetTime / avgTime) : 1;
  return (laneUtilization + timeEfficiency) / 2;
}
