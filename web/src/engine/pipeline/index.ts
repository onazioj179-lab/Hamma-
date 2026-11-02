/**
 * SPK V28 - Fail-Safe Pipeline Layer
 * 
 * Ensures compression/decompression NEVER stops:
 * - Handles any file type, any size (100MB - 10TB+)
 * - Automatic recovery from all failure modes
 * - Guaranteed completion with valid output
 * - No manual tuning required
 */

// ============================================================================
// UNIVERSAL PIPELINE (V27)
// ============================================================================

export {
  // Chunk sizing
  calculateAdaptiveChunkSize,
  calculateTotalChunks,
  getOptimalChunkSize,
  
  // Hashing
  computeSHA256,
  computeChunkHash,
  
  // File reader
  UniversalFileReader,
  
  // Manifest
  createChunkManifest,
  verifyChunk,
  
  // File detection
  detectFileType,
  
  // Progress tracking
  ProgressTracker,
  
  // Backpressure
  BackpressureController,
  
  // Types
  type UniversalChunk,
  type ChunkHash,
  type ChunkManifest,
  type FileTypeInfo,
  type FileCategory,
  type PipelineProgress,
} from './universal';

// ============================================================================
// FAIL-SAFE WATCHDOG (SECTION 1)
// ============================================================================

export {
  PipelineWatchdog,
  getPipelineWatchdog,
  resetPipelineWatchdog,
  type WatchdogConfig,
  type ChunkTask,
  type WorkerHealth,
  type WatchdogEvent,
  type WatchdogEventHandler,
} from './watchdog';

// ============================================================================
// FAIL-SAFE WORKER MANAGER (SECTION 6)
// ============================================================================

export {
  FailSafeWorkerManager,
  getFailSafeWorkerManager,
  resetFailSafeWorkerManager,
  type FailSafeWorkerConfig,
  type WorkerInstance,
  type ChunkAssignment,
  type WorkerManagerStats,
} from './fail-safe-workers';

// ============================================================================
// DYNAMIC CHUNK SIZER (SECTION 3 & 4)
// ============================================================================

export {
  DynamicChunkSizer,
  getDynamicChunkSizer,
  resetDynamicChunkSizer,
  calculateFileSizeBasedChunk,
  type ChunkSizerConfig,
  type ChunkSizeRecommendation,
  type ProcessingSample,
  type ChunkSizerStats,
} from './chunk-sizer';

// ============================================================================
// RESILIENT FILE STREAMER (SECTION 5)
// ============================================================================

export {
  ResilientFileStreamer,
  getResilientFileStreamer,
  resetResilientFileStreamer,
  type ResilientStreamerConfig,
  type StreamChunk,
  type StreamCheckpoint,
  type StreamProgress,
  type StreamError,
  type StreamEvent,
  type StreamEventHandler,
} from './resilient-streamer';

// ============================================================================
// PROGRESS GUARANTEE SYSTEM (SECTION 7)
// ============================================================================

export {
  ProgressGuaranteeSystem,
  getProgressGuaranteeSystem,
  resetProgressGuaranteeSystem,
  type ProgressGuaranteeConfig,
  type PipelinePhase,
  type PipelineEventType,
  type PipelineEvent,
  type PipelineEventHandler,
} from './progress-guarantee';

// ============================================================================
// ARCHIVE ASSEMBLY GUARANTOR (SECTION 8)
// ============================================================================

export {
  ArchiveAssemblyGuarantor,
  getArchiveAssemblyGuarantor,
  resetArchiveAssemblyGuarantor,
  type ArchiveGuarantorConfig,
  type ChunkRecord,
  type ChunkTable,
  type ArchiveHeader,
  type ArchiveFooter,
  type AssemblyResult,
  type GuarantorEvent,
  type GuarantorEventHandler,
} from './archive-guarantor';

// ============================================================================
// FAIL-SAFE PIPELINE ORCHESTRATOR (MAIN)
// ============================================================================

export {
  FailSafePipelineOrchestrator,
  getFailSafePipelineOrchestrator,
  resetFailSafePipelineOrchestrator,
  compressFile,
  onCompressionProgress,
  type FailSafePipelineConfig,
  type CompressionOptions,
  type CompressionResult,
  type DecompressionOptions,
  type DecompressionResult,
  type PipelineStats,
} from './fail-safe-orchestrator';

// ============================================================================
// AUTHORITATIVE COORDINATOR (SECTIONS 1-11)
// ============================================================================

export {
  // Main class
  Coordinator,
  getCoordinator,
  resetCoordinator,
  
  // Convenience functions
  compressWithCoordinator,
  onCoordinatorEvent,
  
  // Types
  type CoordinatorConfig,
  type ChunkStatus,
  type ChunkState,
  type WorkerStatus,
  type WorkerState,
  type JobOptions,
  type JobResult,
  type CoordinatorEventType,
  type CoordinatorEvent,
  type CoordinatorProgress,
  type CoordinatorEventHandler,
  type WorkerCommand,
  type WorkerResponse,
} from './coordinator';

// ============================================================================
// ARCHIVE WRITER & METADATA TABLE (SECTIONS 1-9)
// ============================================================================

export {
  // Main classes
  ArchiveWriter,
  MetadataTableBuilder,
  ArchiveReader,
  
  // Factory functions
  getArchiveWriter,
  resetArchiveWriter,
  createFileEntry,
  
  // Constants
  ArchiveFlags,
  
  // Types
  type ChunkInfo,
  type FileEntry,
  type MetadataPayload,
  type ArchiveHeaderData,
  type ArchiveFooterData,
  type ArchiveWriterConfig,
  type WriterEventType,
  type WriterEvent,
  type WriterEventHandler,
} from './writer';
