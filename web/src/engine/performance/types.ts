/**
 * Performance Engine Types
 * High-throughput compression infrastructure (100GB/min+)
 */

// Lane configuration
export interface LaneConfig {
  id: number;
  bufferSize: number;
  priority: number;
}

// Chunk descriptor for lane processing
export interface ChunkDescriptor {
  id: string;
  laneId: number;
  offset: number;
  length: number;
  buffer: ArrayBuffer | null;
  status: ChunkStatus;
  compressedSize?: number;
  hash?: string;
  timestamp: number;
}

export type ChunkStatus = 
  | 'queued' 
  | 'reading' 
  | 'compressing' 
  | 'writing' 
  | 'completed' 
  | 'failed';

// Lane state for monitoring
export interface LaneState {
  id: number;
  active: boolean;
  queueSize: number;
  bytesProcessed: number;
  chunksProcessed: number;
  currentSpeed: number; // bytes/sec
  bufferUtilization: number; // 0-1
}

// Worker pool configuration
export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  gpuWorkers: number;
  chunkSizeRange: [number, number]; // min/max in bytes
  enableGPU: boolean;
}

// Worker status
export interface WorkerStatus {
  id: number;
  type: 'cpu' | 'gpu';
  active: boolean;
  currentChunk: string | null;
  bytesProcessed: number;
  chunksProcessed: number;
  avgProcessingTime: number; // ms per chunk
}

// Pipeline stage metrics
export interface PipelineMetrics {
  readSpeed: number;
  compressSpeed: number;
  writeSpeed: number;
  hashSpeed: number;
  overallThroughput: number;
  bottleneck: 'read' | 'compress' | 'write' | 'hash' | 'none';
}

// Buffer pool for zero-copy operations
export interface BufferPool {
  totalSize: number;
  usedSize: number;
  freeBuffers: number;
  activeBuffers: number;
  reusedCount: number;
}

// Flow control state
export interface FlowControlState {
  backpressureActive: boolean;
  currentChunkSize: number;
  targetChunkSize: number;
  pendingChunks: number;
  maxPendingChunks: number;
  throttleRatio: number; // 0-1
}

// Coordinator state
export interface CoordinatorState {
  lanes: LaneState[];
  workers: WorkerStatus[];
  pipeline: PipelineMetrics;
  bufferPool: BufferPool;
  flowControl: FlowControlState;
  totalBytesProcessed: number;
  totalChunksProcessed: number;
  startTime: number;
  estimatedCompletion: number;
}

// Performance engine configuration
export interface PerformanceConfig {
  lanes: number;
  workersPerLane: number;
  enableGPU: boolean;
  minChunkSize: number; // 8MB default
  maxChunkSize: number; // 256MB default
  bufferPoolSize: number; // Total buffer memory
  backpressureThreshold: number; // 0-1
  adaptiveChunking: boolean;
}

// Progress callback with lane details
export interface DetailedProgress {
  bytesProcessed: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  speed: number;
  eta: number;
  lanes: LaneState[];
  phase: 'reading' | 'compressing' | 'writing' | 'finalizing';
}

// Performance engine callbacks
export interface PerformanceCallbacks {
  onProgress: (progress: DetailedProgress) => void;
  onLaneUpdate: (lane: LaneState) => void;
  onWorkerUpdate: (worker: WorkerStatus) => void;
  onMetricsUpdate: (metrics: PipelineMetrics) => void;
  onComplete: (result: PerformanceResult) => void;
  onError: (error: Error) => void;
}

// Final performance result
export interface PerformanceResult {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  duration: number;
  throughput: number; // bytes/sec
  peakThroughput: number;
  lanesUsed: number;
  workersUsed: number;
  gpuAccelerated: boolean;
  chunks: number;
  avgChunkSize: number;
}

// Default configuration
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  lanes: 4,
  workersPerLane: 2,
  enableGPU: true,
  minChunkSize: 8 * 1024 * 1024, // 8MB
  maxChunkSize: 256 * 1024 * 1024, // 256MB
  bufferPoolSize: 512 * 1024 * 1024, // 512MB
  backpressureThreshold: 0.8,
  adaptiveChunking: true,
};

// Target: 100GB/min = 1.67GB/sec
export const TARGET_THROUGHPUT = 1.67 * 1024 * 1024 * 1024;
