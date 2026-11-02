/**
 * SPK Resume System - Public API
 * 
 * Unified export for the auto-resume multi-day execution engine.
 * 
 * Creator: Onazi Treasure (OJ)
 */

// Core checkpoint management
export {
  CheckpointManager,
  getCheckpointManager,
  resetCheckpointManager,
  type CheckpointState,
  type ChunkTableEntry,
  type AIStateSnapshot,
  type PredictiveModelState,
  type LaneAssignment,
  type WriterOffsetTable,
  type MetadataDelta,
  type ResumeOptions,
} from './checkpoint-manager';

// Auto-resume system
export {
  AutoResumeManager,
  getAutoResumeManager,
  resetAutoResumeManager,
  checkForIncompleteJobs,
  type ResumeResult,
  type ResumeableJob,
  type ComponentState,
  type WorkerState,
  type SchedulerState,
  type AIEngineState,
  type WriterState,
  type MetadataState,
} from './auto-resume';

// Incremental metadata
export {
  IncrementalMetadataBuilder,
  getMetadataBuilder,
  resetMetadataBuilder,
  createMetadataBuilder,
  type MetadataWindow,
  type CompactedMetadata,
  type MetadataRange,
  type MetadataBuilderConfig,
} from './incremental-metadata';

// Partition-level resume
export {
  PartitionManager,
  getPartitionManager,
  resetPartitionManager,
  createPartitionManager,
  type Partition,
  type PartitionStatus,
  type PartitionResumeState,
  type PartitionByteOffsets,
  type FailedChunk,
  type PartitionConfig,
} from './partition-resume';

// Worker and WASM recovery
export {
  WorkerRecoveryManager,
  getWorkerRecoveryManager,
  resetWorkerRecoveryManager,
  createWorkerRecoveryManager,
  type WorkerInfo,
  type WorkerStatus,
  type WasmModuleState,
  type SchedulerState as WorkerSchedulerState,
  type WorkerRecoveryConfig,
  type RecoveryResult,
} from './worker-recovery';

// AI state restoration
export {
  AIStateManager,
  getAIStateManager,
  resetAIStateManager,
  createAIStateManager,
  type EntropySignature,
  type ThroughputSample,
  type RedundancyGroup,
  type AIEngineConfig,
  type AIRestorationResult,
} from './ai-state-restoration';

// Checkpoint-safe writer
export {
  CheckpointSafeWriter,
  getSafeWriter,
  resetSafeWriter,
  createSafeWriter,
  type WriteOperation,
  type WriterConfig,
  type WriterState as SafeWriterState,
  type FlushResult,
} from './checkpoint-safe-writer';

// Background checkpointing
export {
  BackgroundCheckpointer,
  getBackgroundCheckpointer,
  resetBackgroundCheckpointer,
  createBackgroundCheckpointer,
  type CheckpointTrigger,
  type CheckpointConfig,
  type CheckpointEvent,
  type CheckpointResult,
} from './background-checkpointer';
