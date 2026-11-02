//! SPK Error Types and Result Alias
//!
//! Unified error handling for all V1-V5 operations.

use std::io;
use thiserror::Error;

/// Result type alias for SPK operations
pub type SpkResult<T> = Result<T, SpkError>;

/// SPK Error types covering all V1-V5 scenarios
#[derive(Debug, Error)]
pub enum SpkError {
    // V1 Core Errors
    #[error("Invalid header: {0}")]
    InvalidHeader(String),

    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),

    #[error("Invalid chunk: {0}")]
    InvalidChunk(String),

    #[error("Chunk not found: {0}")]
    ChunkNotFound(String),

    #[error("Compression error: {0}")]
    CompressionError(String),

    #[error("Decompression error: {0}")]
    DecompressionError(String),

    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },

    #[error("Invalid format: {0}")]
    InvalidFormat(String),

    #[error("File too large: {size} bytes exceeds maximum {max}")]
    FileTooLarge { size: u64, max: u64 },

    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u16),

    // V2 Encryption/Recovery Errors
    #[error("Encryption error: {0}")]
    EncryptionError(String),

    #[error("Decryption error: {0}")]
    DecryptionError(String),

    #[error("Invalid key: {0}")]
    InvalidKey(String),

    #[error("Recovery failed: {0}")]
    RecoveryFailed(String),

    #[error("Session error: {0}")]
    SessionError(String),

    #[error("Integrity check failed: {0}")]
    IntegrityCheckFailed(String),

    // V3 Multipart/Extraction Errors
    #[error("Part missing: {0}")]
    PartMissing(String),

    #[error("Part corrupted: {0}")]
    PartCorrupted(String),

    #[error("Invalid part sequence: expected {expected}, got {actual}")]
    InvalidPartSequence { expected: u32, actual: u32 },

    #[error("Extraction error: {0}")]
    ExtractionError(String),

    #[error("Preview not available: {0}")]
    PreviewNotAvailable(String),

    // V4 Pipeline/Optimization Errors
    #[error("Pipeline error: {0}")]
    PipelineError(String),

    #[error("Codec selection failed: {0}")]
    CodecSelectionFailed(String),

    #[error("Deduplication error: {0}")]
    DeduplicationError(String),

    #[error("GPU error: {0}")]
    GpuError(String),

    // V5 Distributed/Versioning Errors
    #[error("Distributed operation failed: {0}")]
    DistributedError(String),

    #[error("Cloud sync error: {0}")]
    CloudSyncError(String),

    #[error("Version conflict: {0}")]
    VersionConflict(String),

    #[error("Version error: {0}")]
    VersionError(String),

    #[error("Delta error: {0}")]
    DeltaError(String),

    #[error("Mount error: {0}")]
    MountError(String),

    #[error("VFS error: {0}")]
    VfsError(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Deserialization error: {0}")]
    DeserializationError(String),

    // V6 Performance/Cluster Errors
    #[error("Lock error: {0}")]
    LockError(String),

    #[error("Queue full: {0}")]
    QueueFull(String),

    #[error("Invalid range: {0}")]
    InvalidRange(String),

    #[error("Cluster error: {0}")]
    ClusterError(String),

    #[error("Node error: {0}")]
    NodeError(String),

    #[error("Transport error: {0}")]
    TransportError(String),

    #[error("Scheduler error: {0}")]
    SchedulerError(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    // Generic Errors
    #[error("Operation cancelled")]
    Cancelled,

    #[error("Not implemented: {0}")]
    NotImplemented(String),

    #[error("Internal error: {0}")]
    Internal(String),

    // V13-V19 Advanced Feature Errors
    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("No device available: {0}")]
    NoDeviceAvailable(String),

    #[error("Limit exceeded: {0}")]
    LimitExceeded(String),

    #[error("Data corruption: {0}")]
    DataCorruption(String),

    #[error("Buffer full: {0}")]
    BufferFull(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
}

impl SpkError {
    /// Check if this error is recoverable
    pub fn is_recoverable(&self) -> bool {
        matches!(
            self,
            SpkError::Io(_)
                | SpkError::SessionError(_)
                | SpkError::PartMissing(_)
                | SpkError::CloudSyncError(_)
        )
    }

    /// Check if this error requires user intervention
    pub fn requires_user_action(&self) -> bool {
        matches!(
            self,
            SpkError::InvalidKey(_)
                | SpkError::PermissionDenied(_)
                | SpkError::VersionConflict(_)
                | SpkError::PartMissing(_)
        )
    }

    /// Create hash mismatch error with hex strings
    pub fn hash_mismatch(expected: &[u8], actual: &[u8]) -> Self {
        Self::HashMismatch {
            expected: hex::encode(expected),
            actual: hex::encode(actual),
        }
    }
}

// Conversion implementations for external error types
impl From<serde_json::Error> for SpkError {
    fn from(e: serde_json::Error) -> Self {
        SpkError::Serialization(e.to_string())
    }
}

impl From<ciborium::de::Error<io::Error>> for SpkError {
    fn from(e: ciborium::de::Error<io::Error>) -> Self {
        SpkError::Serialization(format!("CBOR decode error: {}", e))
    }
}

impl From<ciborium::ser::Error<io::Error>> for SpkError {
    fn from(e: ciborium::ser::Error<io::Error>) -> Self {
        SpkError::Serialization(format!("CBOR encode error: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = SpkError::InvalidHeader("test".into());
        assert!(err.to_string().contains("Invalid header"));
    }

    #[test]
    fn test_error_recoverable() {
        assert!(SpkError::Io(io::Error::new(io::ErrorKind::Other, "test")).is_recoverable());
        assert!(!SpkError::InvalidHeader("test".into()).is_recoverable());
    }

    #[test]
    fn test_hash_mismatch() {
        let err = SpkError::hash_mismatch(&[0x01, 0x02], &[0x03, 0x04]);
        let msg = err.to_string();
        assert!(msg.contains("0102"));
        assert!(msg.contains("0304"));
    }
}
