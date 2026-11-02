/**
 * SPK Micro-Optimization Layer
 * Creator: OJ Treasure Onazi
 * 
 * High-performance optimization layer for Singularity Pack compression.
 * 
 * Targets:
 * - Low-end: 500MB/min
 * - Average: 5-20GB/min  
 * - High-end: 50-100GB/min+
 * - Enterprise: 200GB/min+ (cluster mode future)
 * 
 * Subsystems:
 * 1. WASM Optimizer - JIT, SIMD, memory alignment
 * 2. Worker Pool - Persistent workers, transferables
 * 3. Coordinator - Pre-scheduling, overlap
 * 4. Memory - Hybrid pools, dynamic sizing
 * 5. I/O - Streaming, zero-copy, backpressure
 * 6. Archive Writer - Late metadata, typed arrays
 * 7. AI Engine - Predictive, stability-first
 * 8. UI - Debounced, virtualized, lazy
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  // Core types
  OptimizationMode,
  DeviceProfile,
  MemoryPressure,
  ThroughputTier,
  
  // Configuration types
  MicroOptimizationConfig,
  WasmOptimizationConfig,
  WorkerOptimizationConfig,
  CoordinatorOptimizationConfig,
  MemoryOptimizationConfig,
  IOOptimizationConfig,
  ArchiveWriterConfig,
  AIOptimizerConfig,
  UIOptimizationConfig,
  
  // Stats types
  MicroOptimizationStats,
  OptimizationMetrics,
  WasmPerformanceStats,
  WorkerPoolStats,
  WorkerStats,
  CoordinatorStats,
  MemoryOptimizationStats,
  MemoryPoolStats,
  IOStats,
  ArchiveWriterStats,
  AIOptimizerStats,
  UIPerformanceStats,
  
  // AI types
  AIPrediction,
  AIAction,
  AIMode,
  
  // Testing types
  TestProfile,
  TestResult,
  TestCategory,
  TestMetric,
  TestSuite,
  
  // Event types
  OptimizationEvent,
  OptimizationEventHandler,
  
  // Target types
  GlobalOptimizationTargets,
  
  // Other types
  ChunkInfo,
  ChunkBatch,
  StreamHandle,
  WasmMemoryPool,
  PoolTier,
  WorkerState,
  WorkerPriority,
} from './types';

// ============================================================================
// WASM OPTIMIZER
// ============================================================================

export {
  WasmOptimizer,
  getWasmOptimizer,
  resetWasmOptimizer,
} from './wasm-optimizer';

// ============================================================================
// WORKER POOL OPTIMIZER
// ============================================================================

export {
  WorkerPoolOptimizer,
  getWorkerPoolOptimizer,
  resetWorkerPoolOptimizer,
} from './worker-optimizer';

// ============================================================================
// COORDINATOR OPTIMIZER
// ============================================================================

export {
  CoordinatorOptimizer,
  getCoordinatorOptimizer,
  resetCoordinatorOptimizer,
} from './coordinator-optimizer';

// ============================================================================
// MEMORY OPTIMIZER
// ============================================================================

export {
  MemoryOptimizer,
  getMemoryOptimizer,
  resetMemoryOptimizer,
} from './memory-optimizer';

// ============================================================================
// I/O OPTIMIZER
// ============================================================================

export {
  IOOptimizer,
  getIOOptimizer,
  resetIOOptimizer,
} from './io-optimizer';

// ============================================================================
// ARCHIVE WRITER OPTIMIZER
// ============================================================================

export {
  ArchiveWriterOptimizer,
  getArchiveWriterOptimizer,
  resetArchiveWriterOptimizer,
} from './archive-optimizer';

// ============================================================================
// AI OPTIMIZER ENGINE
// ============================================================================

export {
  AIOptimizerEngine,
  getAIOptimizerEngine,
  resetAIOptimizerEngine,
} from './ai-optimizer';

// ============================================================================
// UI OPTIMIZER
// ============================================================================

export {
  UIOptimizer,
  getUIOptimizer,
  resetUIOptimizer,
} from './ui-optimizer';

// ============================================================================
// UNIFIED ENGINE
// ============================================================================

export {
  UnifiedOptimizationEngine,
  getUnifiedOptimizationEngine,
  resetUnifiedOptimizationEngine,
} from './unified-engine';

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export { getUnifiedOptimizationEngine as default } from './unified-engine';
