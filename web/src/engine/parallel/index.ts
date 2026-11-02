/**
 * SPK Ultra-Parallel Throughput Engine
 * Creator: OJ Treasure Onazi
 * 
 * High-throughput parallel compression engine with multi-lane coordination,
 * AI-powered optimization, and dynamic scaling.
 * 
 * Targets:
 * - 8-core: 15-30 GB/min
 * - 16-core: 30-60 GB/min
 * - 32-core: 60-120 GB/min
 */

// Types
export type {
  // Lane types
  Lane,
  LaneStatus,
  LaneProfile,
  
  // Scheduler types
  SchedulerConfig,
  ChunkAssignment,
  
  // Worker profiler types
  ProfilerConfig,
  WorkerProfile,
  
  // Stream types
  StreamConfig,
  StreamBuffer,
  StreamStats,
  
  // Writer types
  WriterConfig,
  WriteQueueItem,
  WriterState,
  
  // Throughput types
  ThroughputConfig,
  ThroughputMetrics,
  ThroughputMode,
  ThroughputTarget,
  
  // Coordinator types
  CoordinatorConfig,
  
  // Event types
  ParallelEvent,
  ParallelEventHandler,
} from './types';

// Constants and values
export {
  DEFAULT_SCHEDULER_CONFIG,
  DEFAULT_PROFILER_CONFIG,
  DEFAULT_STREAM_CONFIG,
  DEFAULT_WRITER_CONFIG,
  DEFAULT_THROUGHPUT_CONFIG,
  DEFAULT_COORDINATOR_CONFIG,
  THROUGHPUT_TARGETS,
  MB,
  GB,
  getThroughputTarget,
  getRecommendedLaneCount,
} from './types';

// Scheduler
export {
  ParallelScheduler,
  createParallelScheduler,
} from './scheduler';

// Worker Profiler
export {
  WorkerProfiler,
  createWorkerProfiler,
} from './worker-profiler';

// Stream Manager
export {
  StreamManager,
  createStreamManager,
} from './stream-manager';

// Parallel Writer
export {
  ParallelWriter,
  createParallelWriter,
} from './parallel-writer';

// Throughput Optimizer
export {
  ThroughputOptimizer,
  createThroughputOptimizer,
} from './throughput-optimizer';

// Coordinator
export {
  ParallelCoordinator,
  createParallelCoordinator,
  processInParallel,
} from './coordinator';

export type {
  ParallelSession,
  ParallelStats,
  CoordinatorEvent,
  CoordinatorEventHandler,
} from './coordinator';
