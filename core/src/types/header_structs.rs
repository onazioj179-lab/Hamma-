//! Header structure types
//!
//! Extended header structures for V2-V5 features.

use serde::{Deserialize, Serialize};

/// Extended header info for V2+ archives
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendedHeaderInfo {
    /// V2: Encryption info
    pub encryption: Option<EncryptionInfo>,
    /// V2: Recovery records info  
    pub recovery: Option<RecoveryInfo>,
    /// V3: Multipart split info
    pub multipart: Option<MultipartSplitInfo>,
    /// V4: Adaptive chunking config
    pub adaptive_config: Option<AdaptiveConfig>,
    /// V5: Distributed compression info
    pub distributed: Option<DistributedInfo>,
}

impl Default for ExtendedHeaderInfo {
    fn default() -> Self {
        Self {
            encryption: None,
            recovery: None,
            multipart: None,
            adaptive_config: None,
            distributed: None,
        }
    }
}

/// V2 Encryption information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionInfo {
    /// Algorithm: "AES-256-GCM"
    pub algorithm: String,
    /// Key derivation function: "argon2id"
    pub kdf: String,
    /// Salt for key derivation
    pub salt: Vec<u8>,
    /// Nonce/IV
    pub nonce: Vec<u8>,
    /// Key derivation iterations
    pub iterations: u32,
    /// Memory cost (KB)
    pub memory_cost: u32,
    /// Parallelism
    pub parallelism: u32,
}

impl EncryptionInfo {
    pub fn new_aes_gcm() -> Self {
        Self {
            algorithm: "AES-256-GCM".to_string(),
            kdf: "argon2id".to_string(),
            salt: vec![0; 32],
            nonce: vec![0; 12],
            iterations: 3,
            memory_cost: 65536,
            parallelism: 4,
        }
    }
}

/// V2 Recovery records info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryInfo {
    /// Recovery record percentage (1-30%)
    pub percentage: u8,
    /// Reed-Solomon block size
    pub block_size: u32,
    /// Number of parity blocks
    pub parity_blocks: u32,
    /// Offset to recovery data
    pub data_offset: u64,
    /// Size of recovery data
    pub data_size: u64,
}

impl Default for RecoveryInfo {
    fn default() -> Self {
        Self {
            percentage: 5,
            block_size: 4096,
            parity_blocks: 0,
            data_offset: 0,
            data_size: 0,
        }
    }
}

/// V3 Multipart split configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultipartSplitInfo {
    /// Maximum size per part
    pub part_size: u64,
    /// Total number of parts
    pub total_parts: u32,
    /// Unique archive ID
    pub archive_id: String,
    /// Part file naming pattern
    pub naming_pattern: String,
}

impl MultipartSplitInfo {
    pub fn new(part_size: u64) -> Self {
        Self {
            part_size,
            total_parts: 0,
            archive_id: uuid::Uuid::new_v4().to_string(),
            naming_pattern: ".{:03}".to_string(),
        }
    }
}

/// V4 Adaptive chunking configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveConfig {
    /// Minimum chunk size
    pub min_chunk: usize,
    /// Maximum chunk size
    pub max_chunk: usize,
    /// Target average chunk size
    pub target_chunk: usize,
    /// Use content-defined boundaries
    pub content_defined: bool,
    /// Window size for CDC
    pub window_size: usize,
}

impl Default for AdaptiveConfig {
    fn default() -> Self {
        Self {
            min_chunk: 1024 * 1024,       // 1MB
            max_chunk: 16 * 1024 * 1024,  // 16MB
            target_chunk: 4 * 1024 * 1024, // 4MB
            content_defined: true,
            window_size: 48,
        }
    }
}

/// V5 Distributed compression info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributedInfo {
    /// Number of worker nodes
    pub worker_count: u32,
    /// Coordinator node ID
    pub coordinator_id: String,
    /// Job ID
    pub job_id: String,
    /// Worker assignments
    pub assignments: Vec<WorkerAssignment>,
}

/// V5 Worker assignment for distributed compression
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerAssignment {
    /// Worker ID
    pub worker_id: String,
    /// Chunk index start
    pub chunk_start: u64,
    /// Chunk count
    pub chunk_count: u64,
    /// Status
    pub status: WorkerStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WorkerStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

impl Default for WorkerStatus {
    fn default() -> Self {
        Self::Pending
    }
}
