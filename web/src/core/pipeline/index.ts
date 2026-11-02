/**
 * SPK Implementation Blueprint - Pipeline Module
 * 
 * Exports all pipeline components for compression/decompression coordination.
 * 
 * @module core/pipeline
 * @version 1.0.0
 */

// Coordinator
export {
  PipelineCoordinator,
  type CompressionJob,
  type CompressionOptions,
  type EncryptionOptions,
  type JobProgress,
  type JobState,
  type JobStage,
  type DecompressionJob,
  type DecompressionOptions,
  type CoordinatorConfig,
  type WorkerMessage,
  type Checkpoint,
} from './coordinator';

// Scheduler
export {
  ChunkScheduler,
  type Chunk,
  type ChunkState,
  type SchedulerConfig,
  type WorkerLoad,
  type SchedulerStats,
} from './scheduler';

// Reader
export {
  ChunkReader,
  type ReadConfig,
  type FileManifest,
  type FileEntry,
  type ChunkMetadata,
  type ArchiveMetadata,
  type ReadProgress,
} from './chunkReader';

// Writer
export {
  ArchiveWriter,
  type ChunkInfo,
  type FileEntry as WriterFileEntry,
  type MetadataPayload,
  type ArchiveHeaderData,
  type ArchiveFooterData,
  type WriterConfig,
  type WriteOptions,
  type WriteProgress,
} from './writer';

// Integrity
export {
  IntegrityChecker,
  CRC32,
  XXHash,
  type IntegrityResult,
  type IntegrityError,
  type ChecksumAlgorithm,
} from './integrity';
