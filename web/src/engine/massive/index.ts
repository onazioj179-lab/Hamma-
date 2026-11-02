/**
 * SPK Hard Constraint Engine - Massive Module Index
 * Creator: OJ Treasure Onazi
 * 
 * Barrel exports for the massive job handling system.
 * Supports 10TB input, 5000 files, 100KB-multi-TB file sizes.
 */

// ============================================================================
// TYPES
// ============================================================================

export {
  // Constants
  HARD_LIMITS,
  KB, MB, GB, TB,
  
  // Type exports
  type ValidationResult,
  type ValidationError,
  type MassiveFileEntry,
  type Partition,
  type PartitionPlan,
  type Checkpoint,
  type ChunkMetadataEntry,
  type OffsetEntry,
  type MemorySnapshot,
  type MemoryBudget,
  type MassiveJob,
  type MassiveJobState,
  type MassiveJobConfig,
  type OptimizerState,
  type CompressionProfile,
  type FileTypeProfile,
  type MassiveJobEvent,
  type MassiveJobEventHandler,
  type ValidationErrorCode,
  
  // Profile data
  FILE_TYPE_PROFILES,
  DEFAULT_MASSIVE_CONFIG,
} from './types';

// ============================================================================
// VALIDATOR
// ============================================================================

export {
  InputValidator,
  getInputValidator,
  detectCompressionProfile,
  getExpectedRatio,
} from './validator';

// ============================================================================
// PARTITIONER
// ============================================================================

export {
  MassivePartitioner,
  createPartitioner,
} from './partitioner';

// ============================================================================
// MEMORY MANAGER
// ============================================================================

export {
  MassiveMemoryManager,
  getMassiveMemoryManager,
  resetMassiveMemoryManager,
} from './memory-manager';

// ============================================================================
// CHECKPOINT
// ============================================================================

export {
  CheckpointManager,
  getCheckpointManager,
  initializeCheckpointManager,
  resetCheckpointManager,
} from './checkpoint';

// ============================================================================
// OFFSET MANAGER
// ============================================================================

export {
  // Classes
  OffsetValidator,
  OffsetTableManager,
  FooterManager,
  
  // Singleton
  getOffsetManager,
  createFooterManager,
  resetOffsetManager,
  
  // Types
  type ChunkOffset,
  type FileOffset,
  type PartitionOffset,
  type JumpOffset,
  type FooterStructure,
  
  // Constants
  MAX_SAFE_OFFSET,
  MAX_JS_NUMBER_OFFSET,
  FOOTER_SIGNATURE,
  FOOTER_VERSION,
  
  // Utilities
  toBigInt,
  toNumber,
  formatOffset,
  calculateOffsetChecksum,
} from './offset-manager';

// ============================================================================
// MASSIVE OPTIMIZER
// ============================================================================

export {
  MassiveModeOptimizer,
  getMassiveModeOptimizer,
  resetMassiveModeOptimizer,
  
  // Types
  type OptimizationMode,
  type OptimizationStrategy,
  type OptimizationRecommendation,
  type FileTypeAnalysis,
  type OptimizationMetrics,
  
  // Constants
  OPTIMIZER_DEFAULTS,
} from './massive-optimizer';

// ============================================================================
// COMPRESSION PROFILER
// ============================================================================

export {
  CompressionProfiler,
  getCompressionProfiler,
  resetCompressionProfiler,
  
  // Types
  type CompressionSettings,
  type CompressionResult,
  type ProfileStatistics,
  
  // Constants
  TARGET_RATIO,
  RATIO_TOLERANCE,
  PRE_COMPRESSED_FORMATS,
  PRE_COMPRESSED_EXTENSIONS,
  
  // Utilities
  isCompressedMimeType,
  isCompressedExtension,
  getOptimalLevel,
  calculateTargetSize,
  ratioMeetsTarget,
} from './compression-profiler';

// ============================================================================
// COORDINATOR
// ============================================================================

export {
  MassiveJobCoordinator,
  getMassiveJobCoordinator,
  initializeMassiveJobCoordinator,
  resetMassiveJobCoordinator,
} from './coordinator';

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

import { getMassiveJobCoordinator, initializeMassiveJobCoordinator, resetMassiveJobCoordinator } from './coordinator';
import { getInputValidator } from './validator';
import { getCompressionProfiler, resetCompressionProfiler } from './compression-profiler';
import { getMassiveModeOptimizer, resetMassiveModeOptimizer } from './massive-optimizer';
import { resetMassiveMemoryManager } from './memory-manager';
import { resetCheckpointManager } from './checkpoint';
import { resetOffsetManager } from './offset-manager';
import type { MassiveJobConfig, MassiveJob, ValidationResult } from './types';

/**
 * Quick validation of files against hard constraints
 */
export function validateMassiveJob(files: File[]): ValidationResult {
  return getInputValidator().validate(files);
}

/**
 * Start a massive compression job
 */
export async function startMassiveJob(
  files: File[],
  config?: Partial<MassiveJobConfig>
): Promise<MassiveJob> {
  const coordinator = await initializeMassiveJobCoordinator(config);
  return coordinator.start(files);
}

/**
 * Get predicted compressed size for files
 */
export function predictMassiveJobSize(files: File[]): number {
  const validator = getInputValidator();
  const validation = validator.validate(files);
  
  if (!validation.valid) {
    throw new Error(validation.errors.map(e => e.message).join('; '));
  }
  
  const entries = validator.createFileEntries(files);
  return getCompressionProfiler().predictArchiveSize(entries);
}

/**
 * Get optimization recommendations
 */
export function getMassiveJobRecommendations(): string[] {
  const optimizerRecs = getMassiveModeOptimizer().getRecommendations();
  const profilerRecs = getCompressionProfiler().getRecommendations();
  
  return [
    ...optimizerRecs.map(r => `[Optimizer] ${r.reason}`),
    ...profilerRecs,
  ];
}

/**
 * Reset all massive module singletons
 */
export function resetMassiveModule(): void {
  resetMassiveJobCoordinator();
  resetMassiveMemoryManager();
  resetCheckpointManager();
  resetOffsetManager();
  resetMassiveModeOptimizer();
  resetCompressionProfiler();
}
