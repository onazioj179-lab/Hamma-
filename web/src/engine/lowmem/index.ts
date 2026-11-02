/**
 * SPK Hyper-Low-Memory Mode - Module Index
 * Creator: OJ Treasure Onazi
 * 
 * Barrel exports for the lowmem module
 * Provides ultra-optimized compression for 1GB RAM devices
 */

// Types
export {
  KB, MB, GB,
  MEMORY_CONSTANTS,
  type ChunkMode,
  CHUNK_SIZES,
  type MemoryPressureLevel,
  type MemoryState,
  type AllocationRequest,
  type AllocationResult,
  type PooledBuffer,
  type BufferPoolConfig,
  DEFAULT_BUFFER_POOL_CONFIG,
  type StreamingReaderConfig,
  type StreamChunk,
  DEFAULT_STREAMING_READER_CONFIG,
  type WorkerProfile,
  type WorkerProfileName,
  WORKER_PROFILES,
  type LowMemWriterConfig,
  type WriterMetrics,
  DEFAULT_LOW_MEM_WRITER_CONFIG,
  type LowMemAIConfig,
  type AIRecommendation,
  DEFAULT_LOW_MEM_AI_CONFIG,
  type SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  type LowMemConfig,
  DEFAULT_LOWMEM_CONFIG,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';

// Memory Budget Controller (Section 1)
export {
  MemoryBudgetController,
  getMemoryBudgetController,
  resetMemoryBudgetController,
  detectSystemMemory,
  recommendTargetRAM,
  formatMemory,
} from './memory-budget';

// Micro-Chunk Pipeline (Section 2)
export {
  ChunkModeController,
  MicroChunkPipeline,
  getMicroChunkPipeline,
  resetMicroChunkPipeline,
  calculateChunkCount,
  recommendChunkMode,
  estimateChunkingMemory,
  type ChunkMetrics,
  type ChunkResult,
  type ChunkRequest,
} from './micro-chunk';

// Zero-Copy Buffer Pool (Section 3)
export {
  ZeroCopyBufferPool,
  getBufferPool,
  resetBufferPool,
  concatTypedArrays,
  splitIntoViews,
  createSharedBuffer,
  supportsTransferable,
  type BufferStats,
  type BufferAcquisition,
} from './buffer-pool';

// Streaming File Reader (Section 4)
export {
  LowMemoryStreamingReader,
  getStreamingReader,
  resetStreamingReader,
  createAbortableFileReader,
  readFileWithProgress,
  estimateOptimalChunkSize,
  type ReaderProgress,
  type ReaderOptions,
} from './streaming-reader';

// Worker Profile Manager (Section 5)
export {
  WorkerProfileManager,
  getWorkerProfileManager,
  resetWorkerProfileManager,
  recommendWorkerProfile,
  calculateMaxWasmPages,
  estimateWorkerOverhead,
  type WorkerInstance,
  type WorkerTask,
  type WorkerPoolStats,
} from './worker-profile';

// Low-Memory Archive Writer (Section 6)
export {
  LowMemoryArchiveWriter,
  getLowMemoryWriter,
  resetLowMemoryWriter,
  createSingleFileArchive,
  estimateArchiveSize,
  type ChunkEntry,
  type FileEntry,
  type WriterState,
} from './low-mem-writer';

// Low-RAM AI Optimizer (Section 7)
export {
  LowRAMAIOptimizer,
  getLowRAMAIOptimizer,
  resetLowRAMAIOptimizer,
  getAlgorithmForFile,
  isCompressedFileType,
  getCompressionLevel,
  type FileAnalysis,
  type OptimizationContext,
  type OptimizationResult,
} from './low-mem-optimizer';

// Safety Enforcer (Section 8)
export {
  SafetyEnforcer,
  getSafetyEnforcer,
  resetSafetyEnforcer,
  DEVICE_PROFILES,
  createTestEnvironment,
  runSafetyStressTest,
  type SafetyViolation,
  type SafetyState,
  type DeviceProfile,
} from './safety-enforcer';

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

import type { MemoryPressureLevel, ChunkMode, LowMemEvent } from './types';
import { getMemoryBudgetController, resetMemoryBudgetController } from './memory-budget';
import { getMicroChunkPipeline, resetMicroChunkPipeline } from './micro-chunk';
import { getBufferPool, resetBufferPool } from './buffer-pool';
import { getStreamingReader, resetStreamingReader } from './streaming-reader';
import { getWorkerProfileManager, resetWorkerProfileManager } from './worker-profile';
import { getLowRAMAIOptimizer, resetLowRAMAIOptimizer } from './low-mem-optimizer';
import { getSafetyEnforcer, resetSafetyEnforcer } from './safety-enforcer';

/**
 * Initialize the low-memory mode system
 */
export function initializeLowMemoryMode(options?: {
  targetRAM?: number;
  autoDetectProfile?: boolean;
}): void {
  // Initialize singletons
  const memoryController = getMemoryBudgetController(options?.targetRAM);
  const safetyEnforcer = getSafetyEnforcer();
  
  // Auto-detect device profile if requested
  if (options?.autoDetectProfile !== false) {
    safetyEnforcer.autoDetectProfile();
  }
  
  // Setup cross-module event handling
  memoryController.on((event: LowMemEvent) => {
    if (event.type === 'pressure-change') {
      // Propagate to other modules
      getMicroChunkPipeline().getModeController().updateModeForPressure(
        event.to as MemoryPressureLevel
      );
    }
  });
}

/**
 * Reset all low-memory mode state
 */
export function resetLowMemoryMode(): void {
  resetMemoryBudgetController();
  resetMicroChunkPipeline();
  resetBufferPool();
  resetStreamingReader();
  resetWorkerProfileManager();
  // resetLowMemoryWriter is async, call separately if needed
  resetLowRAMAIOptimizer();
  resetSafetyEnforcer();
}

/**
 * Get comprehensive system status
 */
export function getLowMemoryStatus(): {
  memory: {
    allocated: number;
    available: number;
    pressure: string;
    usagePercent: number;
  };
  chunks: {
    mode: ChunkMode;
    size: number;
    active: number;
    pending: number;
  };
  buffers: {
    total: number;
    inUse: number;
    hitRate: number;
  };
  safety: {
    violations: number;
    emergencyStop: boolean;
    safeMode: boolean;
  };
} {
  const memController = getMemoryBudgetController();
  const chunkPipeline = getMicroChunkPipeline();
  const bufferPool = getBufferPool();
  const safety = getSafetyEnforcer();
  
  const memState = memController.estimateRAM();
  const bufferStats = bufferPool.getStats();
  const safetyState = safety.getState();
  
  return {
    memory: {
      allocated: memState.allocated,
      available: memState.available,
      pressure: memState.pressureLevel,
      usagePercent: memState.usagePercent,
    },
    chunks: {
      mode: chunkPipeline.getCurrentMode(),
      size: chunkPipeline.getCurrentChunkSize(),
      active: chunkPipeline.getActiveCount(),
      pending: chunkPipeline.getPendingCount(),
    },
    buffers: {
      total: bufferStats.totalBuffers,
      inUse: bufferStats.inUseBuffers,
      hitRate: bufferStats.hitRate,
    },
    safety: {
      violations: safetyState.violations.length,
      emergencyStop: safetyState.emergencyStopActive,
      safeMode: safetyState.safeMode,
    },
  };
}
