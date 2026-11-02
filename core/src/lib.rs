//! # SPK Core - Singularity Pack Compression Engine V1-V23
//!
//! Enterprise-grade lossless compression platform supporting:
//! - Files up to 1024 TB and beyond
//! - Streaming chunk-based processing
//! - Multi-codec compression (zstd, lz4, brotli)
//! - SHA-256 deduplication
//! - AES-256-GCM encryption (V2)
//! - Partial extraction & preview (V3)
//! - Adaptive chunking & smart codec selection (V4)
//! - Distributed compression & versioning (V5)
//! - Multi-GPU & cluster processing for 50GB/s throughput (V6)
//! - Autonomic optimization & self-healing clusters (V7)
//! - Edge/mobile device support & thermal management (V8)
//! - Autonomous intelligence & self-repair (V9)
//! - Universal interoperability (V10)
//! - Global distributed mesh network (V12)
//! - Semantic compression + data understanding (V13)
//! - Heterogeneous hardware orchestration (V14)
//! - Self-describing, self-transforming containers (V15)
//! - Long-term digital resilience (V16)
//! - Simulation-aware + scientific data modes (V17)
//! - Realtime streaming + low-latency operation (V18)
//! - SPK Virtual Data Layer (SPK-VDL) (V19)
//! - Virtualized Compute + Data Execution Layer (V20)
//! - Autonomous Optimization + Policy Engine (V21)
//! - AI-Assisted Lossless Media Intelligence (V22)
//! - Realtime Ultra-Media Pipeline + Mobile FFI (V23)

#![allow(dead_code)]

pub mod header;
pub mod manifest;
pub mod chunk;
pub mod writer;
pub mod reader;
pub mod codec;
pub mod types;
pub mod utils;

// V2 modules
#[cfg(feature = "encryption")]
pub mod encryption;
#[cfg(feature = "recovery")]
pub mod recovery;
pub mod session;

// V3 modules
pub mod extraction;
pub mod preview;
pub mod multipart;

// V4 modules
pub mod adaptive;
pub mod dedup;
pub mod pipeline;

// V5 modules
pub mod distributed;
pub mod versioning;
pub mod virtual_fs;

// V6 modules - Extreme Performance
pub mod gpu;
pub mod scheduler;
pub mod zerocopy;
pub mod cluster;
pub mod performance;

// V7 modules - Autonomic Optimization
pub mod optimizer;
pub mod healing;

// V8 modules - Edge & Mobile
pub mod edge;

// V9 modules - Autonomous Intelligence & Self-Repair
pub mod autonomous;

// V10 modules - Universal Interoperability
pub mod interop;

// V12 modules - Global Distributed Mesh Network
pub mod mesh;

// V13 modules - Semantic Compression + Data Understanding
pub mod semantic;

// V14 modules - Heterogeneous Hardware Orchestration
pub mod heterogeneous;

// V15 modules - Self-Describing, Self-Transforming Containers
pub mod transform;

// V16 modules - Long-Term Digital Resilience
pub mod resilience;

// V17 modules - Simulation-Aware + Scientific Data Modes
pub mod scientific;

// V18 modules - Realtime Streaming + Low-Latency Operation
pub mod realtime;

// V19 modules - SPK Virtual Data Layer (SPK-VDL)
pub mod vdl;
// V20 modules - Fully Virtualized Compute + Data Execution Layer
pub mod compute;
// V21 modules - Fully Autonomous Optimization + Policy Engine
pub mod policy;
// HAMMA v2 stateful decision engine
pub mod hamma;
// Streaming Engine - Ultra-Fast Universal Compression
pub mod streaming_engine;
// Media-Safe High-Accuracy Compression Pipeline
pub mod media;
// V22 modules - AI-Assisted Lossless Media Intelligence Engine
pub mod ai_media;

// V23 modules - Realtime Ultra-Media Pipeline + Mobile FFI
pub mod realtime_media;
pub mod mobile_ffi;

// V24 modules - 100TB Scale Compression Pipeline
pub mod cdc;
pub mod dedup_store;
pub mod sharded_dedup;
pub mod dictionary;
pub mod checkpoint;
pub mod massive_pipeline;
pub mod snapshot;
pub mod reconstruct;

// V25 modules - Phase 3: Delta + Dictionary Amplification
pub mod similarity;
pub mod delta;
pub mod dict_group;
pub mod enhanced_pipeline;

// 🔥 V24+ NEW MODULES - 100TB Scale + Sharing System
// 💾 Scalable storage with B-tree indexing (replaces JSON)
pub mod storage;
// 🌐 Universal transport (WiFi, Bluetooth, Cellular)
pub mod transport;
// 🔗 Unified sharing system
pub mod sharing;

// 🔐 V26 - Account & Catalog System (HAMMA-managed)
// 👤 Wallet-style user accounts with 100GB storage
pub mod account;
// 📁 File catalog with serial numbers and summoning
pub mod catalog;

// Re-exports
pub use header::{Header, HeaderFlags, HEADER_SIZE, MAGIC_BYTES};
pub use manifest::{Manifest, FileEntry};
pub use chunk::{ChunkTable, ChunkEntry, ChunkId};
pub use codec::{Codec, CompressionLevel};
pub use writer::{SpkWriter, WriterConfig};
pub use reader::{SpkReader, ReaderConfig};
pub use types::*;
pub use utils::error::{SpkError, SpkResult};

// V6 re-exports
pub use gpu::{GpuPipeline, GpuDevice, GpuBackend};
pub use scheduler::{JobScheduler, ScheduledJob, JobPriority};
pub use zerocopy::{SharedBuffer, BufferPool, AlignedBuffer};
pub use cluster::{ClusterManager, ClusterNode, NodeRole};
pub use performance::{PerformanceEngine, PerformanceConfig, PerformanceMode};

// V7 re-exports
pub use optimizer::{AutonomicOptimizer, OptimizationTarget, PerformanceMetrics};
pub use healing::{AutoHealingCluster, NodeHealth, HealingAction, DynamicReconfiguration};

// V8 re-exports
pub use edge::{EdgePipeline, EdgeConfig, DeviceProfile, DeviceType, ThermalState, ThermalMonitor};

// V9 re-exports
pub use autonomous::{
    HealthMonitor, HealthReport, HealthStatus, RedundancyManager, RedundancyLevel,
    AuditTrail, AuditLogEntry, AuditEventType
};

// V10 re-exports
pub use interop::{
    PluginRegistry, CodecPlugin, FormatHandler, MetadataExtractor,
    ContainerManager, ExtensionManager, FormatDetector, InteropConverter
};

// V12 re-exports
pub use mesh::{
    SpkMeshNetwork, NodeIdentity, NodeCapabilities, PeerNode,
    LocationIndex, MeshRouter, MeshRoute, ReplicationManager,
    ReplicationPolicy, FederationBridge, FederationConfig,
    MeshStats, NodeType, RoutingMetric, MeshState
};

// V13 re-exports
pub use semantic::{
    SemanticAnalyzer, SemanticFingerprint, ContentType, LanguageType,
    FunctionIndex, SemanticGroupManager, SemanticStats
};

// V14 re-exports
pub use heterogeneous::{
    HeterogeneousScheduler, AcceleratorType, HardwareCapabilities,
    Workload, WorkloadResult, AcceleratorOp, SchedulerStats
};

// V15 re-exports
pub use transform::{
    MicroRuntime, TransformBlock, TransformType, UpgradeManager,
    TransformSchema, Sandbox
};

// V16 re-exports
pub use resilience::{
    ResilienceManager, MultiFormatChunk, ErrorCorrectionData,
    GenerationStamp, MigrationType, VerificationReport
};

// V17 re-exports
pub use scientific::{
    ScientificDataManager, ScientificDelta, LosslessFloatCompressor,
    TimeseriesCompressor, HpcDistributor, MultiDimMetadata
};

// V18 re-exports
pub use realtime::{
    StreamingPipeline, StreamingChunk, StreamPriority,
    RollingWindowCompressor, PredictiveAllocator, BurstProtector,
    LivePreview, StreamStats
};

// V19 re-exports
pub use vdl::{
    VirtualFileSystem, VirtualFileHandle, FileMode,
    ChunkMaterializer, ThinProvisionedFile, SnapshotManager,
    VfsSnapshot, VfsStats
};

// V20 re-exports
pub use compute::{
    ComputeManager, ExecutionSandbox, FunctionRegistry,
    RegisteredFunction, ArchivePipeline, PipelineStep,
    ComputeHookKind, V20_MAX_SANDBOX_MEMORY, V20_MAX_EXECUTION_MS
};

// V21 re-exports
pub use policy::{
    GlobalPolicyEngine, PolicyRule, PolicyType, PolicyPriority,
    PolicyCondition, PolicyAction, ConditionOperator, ActionType,
    PolicyContext, PolicyCompiler, PolicyPropagator,
    ResourceBudget, BudgetEnforcer, PolicyMetrics, PolicyEvent,
    V21_POLICY_VERSION, V21_MAX_POLICIES, V21_MAX_POLICY_SIZE
};

// HAMMA v2 re-exports
pub use hamma::{
    HammaState, HammaConfig, HammaStrategy, HammaContextKey,
    StrategyObservation
};

// Streaming Engine re-exports
pub use streaming_engine::{
    StreamingFileReader, AdaptiveChunkSizer, ZeroCopyBufferPool,
    ParallelCompressor, ChunkMetadata, StreamingSPKWriter,
    StreamingConfig, CompressionStats, compress_file_streaming,
    CHUNK_SIZE_SMALL, CHUNK_SIZE_MEDIUM, CHUNK_SIZE_LARGE
};

// Media-Safe Compression re-exports
pub use media::{
    MediaType, MediaCompressionMode, MediaTypeDetector,
    MediaStructure, MediaBoundary, BoundaryType, MediaStructureParser,
    MediaChunk, MediaAwareChunker, DoubleHash, MediaChunkMetadata,
    ParallelMediaPipeline, MediaVerificationEngine,
    MediaCompressionConfig, MediaCompressionStats, compress_media_file,
    MEDIA_CHUNK_SMALL, MEDIA_CHUNK_MEDIUM, MEDIA_CHUNK_LARGE
};

// V22 re-exports - AI-Assisted Lossless Media Intelligence
pub use ai_media::{
    AIStructureAnalyzer, StructuralAnalysis, MediaSegmentType,
    AIChunkOptimizer, DuplicateStructureDetector, DuplicateRegion,
    AICompressionRouter, CompressionRoute, PredictiveReadAhead
};

// V23 re-exports - Realtime Ultra-Media Pipeline + Mobile FFI
pub use realtime_media::{
    RealtimeStreamProcessor, RealtimeConfig, RealtimeStats,
    MediaFrame, MediaFrameType, ResolutionTier,
    FrameTicket, ProcessedFrame, CompressedChunk,
    FrameBoundaryDetector, BackpressureController, PrefetchEngine,
    VolumetricProcessor, VolumetricResult, SpatialPartitioner, SpatialPartition,
    FrameScrubber
};
pub use mobile_ffi::{
    MobileConfig, MobileProgress, MobileResult,
    MobileCompressor, MobileDecompressor, ArchiveInfo
};

// V24 re-exports - 100TB Scale Compression Pipeline
pub use cdc::{CdcConfig, CdcChunk, GearHasher, ContentDefinedChunker, chunk_file, 
              NormalizationLevel, CdcStats, MmapChunker, chunk_file_auto};
#[cfg(target_arch = "x86_64")]
pub use cdc::SimdGearHasher;
pub use dedup_store::{DedupStore, DedupStoreStats, DedupResult, ChunkLocation};
pub use sharded_dedup::{ShardedDedupStore, ShardPolicy};
pub use dictionary::{DictStore, FileCluster, DictMetadata, calculate_entropy};
pub use checkpoint::{CheckpointManager, Checkpoint, JobState, Progress, format_bytes};
pub use massive_pipeline::{MassivePipeline, MassivePipelineConfig, MassivePipelineResult, FileScanner};
pub use snapshot::{Snapshot, SnapshotHeader, SnapshotMetadata, FileEntry as SnapshotFileEntry, ChunkRef as SnapshotChunkRef, SnapshotBuilder, SnapshotError};
pub use reconstruct::{Reconstructor, ReconstructConfig, ReconstructProgress, ReconstructStats, SelectiveReconstructor};

// V25 re-exports - Phase 3: Delta + Dictionary Amplification
pub use similarity::{SimilarityConfig, SimilarityIndex, ChunkSignature, DeltaCandidate, MatchType};
pub use delta::{DeltaConfig, DeltaEncoder, DeltaDecoder, DeltaResult, ChunkEncoding, EncodingType, DeltaOp};
pub use dict_group::{DictGroupConfig, DictGroupManager, VersionedDict, compress_with_dict, decompress_with_dict};
pub use enhanced_pipeline::{EnhancedPipeline, EnhancedPipelineConfig, EnhancedPipelineStats, ProcessedChunk, DeltaDependencyResolver, DependencyError};

// V26 re-exports - Account & Catalog System
pub use account::{
    UserAccount, AccountManager, AccountStatus, StorageTier,
    RecoveryPhrase, Credentials, HammaPreferences, AccountError,
    USER_MAX_STORAGE_BYTES, USER_DEFAULT_STORAGE_BYTES
};
pub use catalog::{
    FileCatalog, CatalogEntry, CatalogStats, CatalogError,
    FileStatus, FileType, CompressionInfo
};

/// Codec type alias for compatibility
pub type CodecType = Codec;

/// SPK Format Version
pub const SPK_VERSION: u16 = 1;

/// Default chunk size: 4MB
pub const DEFAULT_CHUNK_SIZE: usize = 4 * 1024 * 1024;

/// Maximum chunk size: 16MB (V4 adaptive)
pub const MAX_CHUNK_SIZE: usize = 16 * 1024 * 1024;

/// V6 Maximum chunk size: 64MB (for GPU processing)
pub const V6_MAX_CHUNK_SIZE: usize = 64 * 1024 * 1024;

/// Minimum chunk size: 1MB (V4 adaptive)
pub const MIN_CHUNK_SIZE: usize = 1 * 1024 * 1024;

/// Large file threshold for streaming: 2GB
pub const LARGE_FILE_THRESHOLD: u64 = 2 * 1024 * 1024 * 1024;

/// Maximum supported file size: 1024 TB
pub const MAX_FILE_SIZE: u64 = 1024 * 1024 * 1024 * 1024 * 1024;

/// V6 target throughput: 50 GB/sec
pub const V6_TARGET_THROUGHPUT: u64 = 50 * 1024 * 1024 * 1024;

/// V7 optimization interval in milliseconds
pub const V7_OPTIMIZATION_INTERVAL_MS: u64 = 1000;

/// V7 health check interval in seconds
pub const V7_HEALTH_CHECK_INTERVAL_SECS: u64 = 5;

/// V8 minimum chunk size for edge devices: 128KB
pub const V8_EDGE_MIN_CHUNK_SIZE: usize = 128 * 1024;

/// V8 default chunk size for mobile: 512KB
pub const V8_MOBILE_CHUNK_SIZE: usize = 512 * 1024;

/// V8 ultra-low memory limit: 64MB
pub const V8_ULTRA_LOW_MEMORY: usize = 64 * 1024 * 1024;

/// V23 target frame latency: 3ms
pub const V23_TARGET_FRAME_LATENCY_MS: u64 = 3;

/// V23 maximum frame latency: 10ms
pub const V23_MAX_FRAME_LATENCY_MS: u64 = 10;

/// V23 default prefetch frames for video
pub const V23_DEFAULT_PREFETCH_FRAMES: usize = 100;

/// V23 mobile micro-chunk size: 256KB
pub const V23_MOBILE_MICRO_CHUNK: usize = 256 * 1024;

/// V23 mobile default chunk size: 1MB
pub const V23_MOBILE_DEFAULT_CHUNK: usize = 1024 * 1024;

/// V24 default CDC target chunk: 16MB (for 100TB scale)
pub const V24_CDC_TARGET_CHUNK: usize = 16 * 1024 * 1024;

/// V24 default volume size: 10GB
pub const V24_VOLUME_SIZE: u64 = 10 * 1024 * 1024 * 1024;

/// V24 checkpoint interval: 10GB
pub const V24_CHECKPOINT_INTERVAL: u64 = 10 * 1024 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants() {
        assert_eq!(HEADER_SIZE, 64);
        assert_eq!(MAGIC_BYTES, *b"SPK1");
        assert_eq!(DEFAULT_CHUNK_SIZE, 4 * 1024 * 1024);
    }

    #[test]
    fn test_v6_constants() {
        assert_eq!(V6_MAX_CHUNK_SIZE, 64 * 1024 * 1024);
        assert_eq!(V6_TARGET_THROUGHPUT, 50 * 1024 * 1024 * 1024);
    }
}
