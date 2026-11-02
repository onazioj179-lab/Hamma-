/**
 * SPK Micro-Optimization Layer - Type Definitions
 * Creator: OJ Treasure Onazi
 * 
 * Complete type system for optimization across all subsystems:
 * WASM, Workers, Coordinator, Memory, I/O, AI, Archive
 * 
 * Targets:
 * - Low-end: 500MB/min
 * - Average: 5-20GB/min
 * - High-end: 50-100GB/min+
 * - Enterprise: 200GB/min+ (cluster mode)
 */

// ============================================================================
// SECTION 1: GLOBAL OPTIMIZATION TYPES
// ============================================================================

export type ThroughputTier = 'low-end' | 'average' | 'high-end' | 'enterprise';
export type MemoryPressure = 'low' | 'medium' | 'high' | 'critical';
export type OptimizationMode = 'balanced' | 'speed' | 'memory' | 'stability' | 'burst';
export type DeviceProfile = 'mobile' | 'laptop' | 'desktop' | 'workstation' | 'server';

export interface GlobalOptimizationTargets {
  // Throughput targets (bytes/sec)
  throughput: {
    lowEnd: number;      // 500MB/min = 8.33MB/s
    average: number;     // 5-20GB/min = 83-333MB/s
    highEnd: number;     // 50-100GB/min = 833-1667MB/s
    enterprise: number;  // 200GB/min+ = 3.33GB/s+
  };
  
  // Latency targets (ms)
  latency: {
    chunkPipeline: number;      // < 3-5ms average
    workerRoundtrip: number;    // < 1ms overhead
    aiDecisionLoop: number;     // < 100ms per adjustment
    uiUpdate: number;           // 16ms (60fps) / 33ms (30fps)
  };
  
  // Memory targets (bytes)
  memory: {
    maxUsage: number;           // 300-600MB
    softLimit: number;          // Start throttling
    criticalLimit: number;      // Emergency measures
    microChunkThreshold: number; // When to use micro-chunks
  };
}

export interface OptimizationMetrics {
  timestamp: number;
  throughputBps: number;
  throughputMBps: number;
  latencyMs: number;
  memoryUsage: number;
  memoryPressure: MemoryPressure;
  cpuUsage: number;
  workerUtilization: number;
  wasmEfficiency: number;
  ioEfficiency: number;
  errorRate: number;
  stallCount: number;
}

export interface OptimizationResult {
  success: boolean;
  metricsImproved: string[];
  metricsDeclined: string[];
  recommendations: string[];
  appliedOptimizations: string[];
}

// ============================================================================
// SECTION 2: WASM OPTIMIZATION TYPES
// ============================================================================

export type WasmOptimizationLevel = 'O0' | 'O1' | 'O2' | 'O3' | 'Oz' | 'Os';
export type SimdSupport = 'none' | 'basic' | 'full' | 'avx';
export type WasmMemoryStrategy = 'fixed' | 'growable' | 'pooled';

export interface WasmOptimizationConfig {
  // Compilation flags
  optimizationLevel: WasmOptimizationLevel;
  ltoEnabled: boolean;           // Link-time optimization
  simdEnabled: boolean;          // SIMD instructions
  boundaryAlignment: number;     // Memory alignment (64KB)
  
  // Fast paths for common chunk sizes
  fastPathChunkSizes: number[];  // [1MB, 2MB, 4MB]
  
  // Memory management
  memoryStrategy: WasmMemoryStrategy;
  initialMemoryPages: number;    // 64KB per page
  maxMemoryPages: number;
  pageAlignment: number;         // 64KB alignment
  
  // Pointer pooling
  pointerPoolEnabled: boolean;
  pointerPoolSize: number;
  reduceAllocChurn: boolean;
  
  // Streaming
  streamingWriteEnabled: boolean;
  zeroCopyEnabled: boolean;
  exposePointersToJs: boolean;
}

export interface WasmPerformanceStats {
  moduleLoadTime: number;
  jitWarmupTime: number;
  avgChunkProcessTime: number;
  simdOperations: number;
  memoryAllocations: number;
  memoryDeallocations: number;
  pointerPoolHits: number;
  pointerPoolMisses: number;
  fastPathHits: number;
  slowPathHits: number;
}

export interface WasmMemoryPool {
  id: string;
  basePtr: number;
  size: number;
  allocated: number;
  available: number;
  fragmentationRatio: number;
}

// ============================================================================
// SECTION 3: WORKER OPTIMIZATION TYPES
// ============================================================================

export type WorkerState = 'idle' | 'warming' | 'ready' | 'busy' | 'stalled' | 'error';
export type WorkerPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type MessageBatchStrategy = 'none' | 'time' | 'count' | 'adaptive';

export interface WorkerOptimizationConfig {
  // Persistence
  persistentWorkers: boolean;
  neverRecreatePerChunk: boolean;
  
  // Transferables
  useTransferables: boolean;
  transferableTypes: string[];   // ['ArrayBuffer', 'MessagePort', etc.]
  
  // WASM pre-loading
  preloadWasm: boolean;
  wasmWarmupEnabled: boolean;
  warmupChunkCount: number;      // 2-3 tiny test chunks
  warmupChunkSize: number;       // Size for warmup
  
  // Message batching
  batchStrategy: MessageBatchStrategy;
  batchSize: number;             // Send progress every N chunks
  batchIntervalMs: number;       // Or every N ms
  reduceEventSpam: boolean;
  
  // Worker count
  workerCountStrategy: 'fixed' | 'auto' | 'adaptive';
  compressionWorkerCount: number;    // cores - 1
  decompressionWorkerCount: number;  // cores
  maxWorkers: number;
  minWorkers: number;
}

export interface WorkerStats {
  workerId: string;
  state: WorkerState;
  chunksProcessed: number;
  bytesProcessed: number;
  avgProcessingTime: number;
  stallCount: number;
  errorCount: number;
  lastActivityMs: number;
  throughputBps: number;
  cpuTime: number;
  memoryUsage: number;
}

export interface WorkerPoolStats {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  stalledWorkers: number;
  totalChunksProcessed: number;
  totalBytesProcessed: number;
  avgThroughputBps: number;
  loadBalance: number;  // 0-1, 1 = perfectly balanced
}

// ============================================================================
// SECTION 4: COORDINATOR OPTIMIZATION TYPES
// ============================================================================

export type SchedulingStrategy = 'round-robin' | 'least-loaded' | 'predictive' | 'adaptive';
export type ChunkDistribution = 'equal' | 'weighted' | 'dynamic';

export interface CoordinatorOptimizationConfig {
  // Pre-scheduling
  preScheduleEnabled: boolean;
  preScheduleBatchSize: number;  // 3-10 chunks ahead per worker
  
  // Predictive distribution
  predictiveEnabled: boolean;
  measureWorkerSpeed: boolean;
  weightByPerformance: boolean;
  
  // Queue management
  minPendingQueue: number;       // Avoid starvation
  maxPendingQueue: number;       // Avoid memory bloat
  
  // Overlap pipeline
  overlapReading: boolean;
  overlapScheduling: boolean;
  overlapWriting: boolean;
  
  // Contention reduction
  useAtomicFlags: boolean;
  avoidMutexStructures: boolean;
  lockFreeQueues: boolean;
}

export interface CoordinatorStats {
  chunksScheduled: number;
  chunksCompleted: number;
  chunksPending: number;
  chunksInFlight: number;
  avgSchedulingLatency: number;
  avgCompletionLatency: number;
  workerUtilization: number[];
  pipelineEfficiency: number;
  starvationEvents: number;
  backpressureEvents: number;
}

export interface ChunkBatch {
  batchId: string;
  chunks: ChunkInfo[];
  targetWorkerId: string;
  priority: WorkerPriority;
  scheduledAt: number;
  deadline: number;
}

export interface ChunkInfo {
  chunkId: string;
  offset: number;
  size: number;
  checksum?: number;
  priority: WorkerPriority;
  estimatedProcessTime: number;
}

// ============================================================================
// SECTION 5: MEMORY OPTIMIZATION TYPES
// ============================================================================

export type PoolTier = 'small' | 'medium' | 'large' | 'huge';
export type BufferRecycleStrategy = 'immediate' | 'deferred' | 'aggressive';

export interface MemoryOptimizationConfig {
  // Buffer reuse
  reuseAllBuffers: boolean;
  recycleStrategy: BufferRecycleStrategy;
  
  // Hybrid pool configuration
  hybridPoolEnabled: boolean;
  poolTiers: {
    small: { maxSize: number; count: number };    // <512KB
    medium: { maxSize: number; count: number };   // 512KB-4MB
    large: { maxSize: number; count: number };    // 4MB-16MB
    huge: { maxSize: number; count: number };     // >16MB (special handling)
  };
  
  // Dynamic chunk sizing
  dynamicChunkSizing: boolean;
  chunkSizeMultiplier: number;      // 1.25 when memory low & stable
  chunkSizeDivider: number;         // 2 when memory high
  memoryHighThreshold: number;      // % of limit
  memoryLowThreshold: number;       // % of limit
  
  // Streaming
  neverCombineLargeBuffers: boolean;
  streamAppendOnly: boolean;
  maxCombineSize: number;           // Max size to combine
}

export interface MemoryPoolStats {
  tier: PoolTier;
  totalSize: number;
  allocatedSize: number;
  availableSize: number;
  bufferCount: number;
  hitRate: number;
  missRate: number;
  fragmentationRatio: number;
}

export interface MemoryOptimizationStats {
  totalAllocated: number;
  totalAvailable: number;
  peakUsage: number;
  currentUsage: number;
  pressure: MemoryPressure;
  gcCycles: number;
  poolStats: MemoryPoolStats[];
  chunkSizeHistory: number[];
  allocationRate: number;
  deallocationRate: number;
}

// ============================================================================
// SECTION 6: FILE I/O OPTIMIZATION TYPES
// ============================================================================

export type StreamMode = 'native' | 'chunked' | 'mapped' | 'direct';
export type BackpressureStrategy = 'pause' | 'drop' | 'buffer' | 'throttle';

export interface IOOptimizationConfig {
  // Native streaming
  useNativeStreams: boolean;
  neverLoadFullFile: boolean;
  
  // Chunk boundaries
  preCalculateBoundaries: boolean;
  boundaryAlignment: number;        // Align to this size
  
  // Backpressure
  backpressureStrategy: BackpressureStrategy;
  coordinateWithWorkers: boolean;
  onlyReadWhenCapacity: boolean;
  
  // Zero-copy
  zeroCopySlicing: boolean;
  useSubarray: boolean;             // view.subarray(offset, offset + size)
  avoidBufferCopies: boolean;
}

export interface IOStats {
  bytesRead: number;
  bytesWritten: number;
  readOperations: number;
  writeOperations: number;
  avgReadLatency: number;
  avgWriteLatency: number;
  backpressureEvents: number;
  zeroCopyOperations: number;
  bufferCopies: number;
  streamEfficiency: number;
}

export interface StreamHandle {
  id: string;
  mode: StreamMode;
  position: number;
  size: number;
  chunkSize: number;
  buffered: number;
  backpressure: boolean;
}

// ============================================================================
// SECTION 7: ARCHIVE WRITER OPTIMIZATION TYPES
// ============================================================================

export type AccumulationStrategy = 'blob-builder' | 'stream-writer' | 'memory-mapped';
export type MetadataCompression = 'none' | 'lz4' | 'zstd' | 'auto';

export interface ArchiveWriterConfig {
  // Streaming accumulation
  accumulationStrategy: AccumulationStrategy;
  avoidLargeConcatenations: boolean;
  
  // Metadata handling
  writeMetadataLate: boolean;
  generateFooterOnce: boolean;
  avoidRecalculations: boolean;
  
  // TypedArrays for internal tables
  useTypedArrays: boolean;
  offsetArrayType: 'Uint32Array' | 'BigUint64Array';
  metricArrayType: 'Float32Array' | 'Float64Array';
  
  // Metadata compression
  metadataCompression: MetadataCompression;
  metadataCompressionLevel: number;
}

export interface ArchiveWriterStats {
  chunksWritten: number;
  bytesWritten: number;
  metadataSize: number;
  footerSize: number;
  compressionRatio: number;
  writeLatency: number;
  flushCount: number;
  concatenationCount: number;
}

// ============================================================================
// SECTION 8: AI OPTIMIZER TYPES
// ============================================================================

export type AIMode = 'off' | 'passive' | 'active' | 'aggressive';
export type PredictionModel = 'heuristic' | 'statistical' | 'ml-lite' | 'adaptive';

export interface AIOptimizerConfig {
  // Evaluation interval
  evaluationIntervalMs: number;  // 100-300ms
  
  // Predictive models
  predictiveModelsEnabled: boolean;
  workerStallPrediction: boolean;
  bottleneckPrediction: boolean;
  memoryPressurePrediction: boolean;
  
  // Stability mode (for huge datasets)
  stabilityFirstMode: boolean;
  prioritizeRolloverSafe: boolean;
  avoidAggressiveGrowth: boolean;
  maxChunkGrowthRate: number;
  
  // Burst mode (for short jobs)
  burstModeEnabled: boolean;
  burstModeThreshold: number;    // File size threshold
  burstMaxThroughput: boolean;
}

export interface AIPrediction {
  type: 'stall' | 'bottleneck' | 'memory' | 'throughput';
  probability: number;
  timeToEventMs: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  suggestedAction: AIAction;
}

export interface AIAction {
  type: 'adjust-chunk-size' | 'adjust-workers' | 'throttle' | 'pause' | 'resume' | 'gc';
  parameter: string;
  oldValue: number | string;
  newValue: number | string;
  confidence: number;
  urgency: number;
}

export interface AIOptimizerStats {
  predictionsGenerated: number;
  predictionsApplied: number;
  predictionAccuracy: number;
  adjustmentsMade: number;
  stallsPrevented: number;
  bottlenecksAvoided: number;
  memoryPressureEvents: number;
  avgDecisionLatency: number;
  modeChanges: number;
}

// ============================================================================
// SECTION 9: UI OPTIMIZATION TYPES
// ============================================================================

export type UpdateFrequency = '60fps' | '30fps' | '15fps' | 'adaptive';
export type RenderStrategy = 'immediate' | 'debounced' | 'batched' | 'virtual';

export interface UIOptimizationConfig {
  // Progress updates
  progressDebounceMs: number;    // 16ms (60fps) or 33ms (30fps)
  updateFrequency: UpdateFrequency;
  
  // List rendering
  virtualizedLists: boolean;
  virtualWindowSize: number;
  
  // Preview loading
  lazyLoadPreviews: boolean;
  previewWorkerEnabled: boolean;
  
  // Main thread protection
  neverBlockMainThread: boolean;
  maxMainThreadWorkMs: number;
  offloadHeavyCompute: boolean;
}

export interface UIPerformanceStats {
  fps: number;
  frameTime: number;
  longTasks: number;
  mainThreadBlocks: number;
  renderTime: number;
  updateLatency: number;
  virtualizedItems: number;
  lazyLoadedItems: number;
}

// ============================================================================
// SECTION 10: TESTING PROFILE TYPES
// ============================================================================

export type TestCategory = 'small' | 'mid' | 'large' | 'ultra-large';
export type TestMetric = 'throughput' | 'error-recovery' | 'worker-stalls' | 
                         'ai-predictions' | 'memory-pressure' | 'cpu-stability' | 
                         'wasm-jit';

export interface TestProfile {
  category: TestCategory;
  minSize: number;
  maxSize: number;
  expectedThroughput: number;
  maxLatency: number;
  maxMemory: number;
  allowedErrors: number;
  allowedStalls: number;
}

export interface TestResult {
  profile: TestProfile;
  metrics: {
    throughput: number;
    errorCount: number;
    recoveryTime: number;
    workerStalls: number;
    aiPredictionAccuracy: number;
    peakMemory: number;
    avgCpu: number;
    wasmJitEfficiency: number;
  };
  passed: boolean;
  issues: string[];
  recommendations: string[];
}

export interface TestSuite {
  profiles: TestProfile[];
  results: TestResult[];
  overallScore: number;
  passRate: number;
  criticalIssues: string[];
}

// ============================================================================
// MASTER OPTIMIZATION CONFIG
// ============================================================================

export interface MicroOptimizationConfig {
  // Global
  mode: OptimizationMode;
  deviceProfile: DeviceProfile;
  targets: GlobalOptimizationTargets;
  
  // Subsystems
  wasm: WasmOptimizationConfig;
  workers: WorkerOptimizationConfig;
  coordinator: CoordinatorOptimizationConfig;
  memory: MemoryOptimizationConfig;
  io: IOOptimizationConfig;
  archive: ArchiveWriterConfig;
  ai: AIOptimizerConfig;
  ui: UIOptimizationConfig;
}

export interface MicroOptimizationStats {
  timestamp: number;
  uptime: number;
  mode: OptimizationMode;
  metrics: OptimizationMetrics;
  wasm: WasmPerformanceStats;
  workers: WorkerPoolStats;
  coordinator: CoordinatorStats;
  memory: MemoryOptimizationStats;
  io: IOStats;
  archive: ArchiveWriterStats;
  ai: AIOptimizerStats;
  ui: UIPerformanceStats;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export type OptimizationEvent = 
  | { type: 'config-changed'; config: Partial<MicroOptimizationConfig> }
  | { type: 'mode-changed'; oldMode: OptimizationMode; newMode: OptimizationMode }
  | { type: 'pressure-changed'; pressure: MemoryPressure }
  | { type: 'worker-stall'; workerId: string; duration: number }
  | { type: 'throughput-change'; oldBps: number; newBps: number }
  | { type: 'ai-adjustment'; action: AIAction }
  | { type: 'gc-triggered'; freed: number }
  | { type: 'error'; subsystem: string; message: string };

export type OptimizationEventHandler = (event: OptimizationEvent) => void;
