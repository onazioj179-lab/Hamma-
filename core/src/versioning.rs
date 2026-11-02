//! SPK V5 Versioned Archives
//!
//! Version control for archives with delta compression.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::types::manifest_structs::VersionInfo;
use crate::utils::error::{SpkError, SpkResult};
use crate::utils::hashing::sha256_hash;

/// Maximum versions to retain by default
pub const DEFAULT_MAX_VERSIONS: usize = 100;

/// Version entry in the archive
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    /// Version number (1-indexed)
    pub number: u32,
    /// Version tag/label
    pub tag: String,
    /// Parent version (0 for initial)
    pub parent: u32,
    /// Timestamp
    pub timestamp: u64,
    /// Author/creator
    pub author: String,
    /// Comment
    pub comment: String,
    /// Changes in this version
    pub changes: Vec<VersionChange>,
    /// Total size of this version snapshot
    pub total_size: u64,
    /// Number of files in this version
    pub file_count: u64,
}

/// Type of change in a version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VersionChange {
    /// File added
    Added {
        path: String,
        size: u64,
        chunk_start: u64,
        chunk_count: u32,
    },
    /// File modified
    Modified {
        path: String,
        old_size: u64,
        new_size: u64,
        /// Base chunks that are reused
        base_chunks: Vec<u64>,
        /// New/delta chunks
        delta_chunks: Vec<u64>,
    },
    /// File deleted
    Deleted {
        path: String,
    },
    /// File renamed
    Renamed {
        old_path: String,
        new_path: String,
    },
}

/// Version history manager
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionHistory {
    /// All versions
    pub versions: Vec<Version>,
    /// Current/latest version number
    pub current: u32,
    /// Maximum versions to retain
    pub max_versions: usize,
    /// Archive ID
    pub archive_id: String,
}

impl VersionHistory {
    /// Create new version history
    pub fn new(archive_id: String) -> Self {
        Self {
            versions: Vec::new(),
            current: 0,
            max_versions: DEFAULT_MAX_VERSIONS,
            archive_id,
        }
    }

    /// Create initial version
    pub fn create_initial(&mut self, author: String, comment: String) -> &Version {
        let version = Version {
            number: 1,
            tag: "v1".into(),
            parent: 0,
            timestamp: current_timestamp(),
            author,
            comment,
            changes: Vec::new(),
            total_size: 0,
            file_count: 0,
        };
        
        self.versions.push(version);
        self.current = 1;
        self.versions.last().unwrap()
    }

    /// Create a new version
    pub fn create_version(
        &mut self,
        author: String,
        comment: String,
        changes: Vec<VersionChange>,
    ) -> SpkResult<&Version> {
        let new_number = self.current + 1;
        
        // Calculate stats from parent + changes
        let parent = self.get_version(self.current);
        let (total_size, file_count) = if let Some(p) = parent {
            self.calculate_stats(p, &changes)
        } else {
            (0, 0)
        };

        let version = Version {
            number: new_number,
            tag: format!("v{}", new_number),
            parent: self.current,
            timestamp: current_timestamp(),
            author,
            comment,
            changes,
            total_size,
            file_count,
        };

        self.versions.push(version);
        self.current = new_number;

        // Prune old versions if needed
        self.prune_old_versions();

        Ok(self.versions.last().unwrap())
    }

    /// Calculate stats after applying changes
    fn calculate_stats(&self, parent: &Version, changes: &[VersionChange]) -> (u64, u64) {
        let mut total_size = parent.total_size;
        let mut file_count = parent.file_count;

        for change in changes {
            match change {
                VersionChange::Added { size, .. } => {
                    total_size += size;
                    file_count += 1;
                }
                VersionChange::Modified { old_size, new_size, .. } => {
                    total_size = total_size - old_size + new_size;
                }
                VersionChange::Deleted { .. } => {
                    file_count = file_count.saturating_sub(1);
                    // Size reduction handled elsewhere
                }
                VersionChange::Renamed { .. } => {
                    // No size/count change
                }
            }
        }

        (total_size, file_count)
    }

    /// Get a specific version
    pub fn get_version(&self, number: u32) -> Option<&Version> {
        self.versions.iter().find(|v| v.number == number)
    }

    /// Get current version
    pub fn get_current(&self) -> Option<&Version> {
        self.get_version(self.current)
    }

    /// List all versions
    pub fn list_versions(&self) -> &[Version] {
        &self.versions
    }

    /// Set version tag
    pub fn set_tag(&mut self, number: u32, tag: String) -> SpkResult<()> {
        let version = self.versions.iter_mut()
            .find(|v| v.number == number)
            .ok_or_else(|| SpkError::VersionError(format!("Version {} not found", number)))?;
        
        version.tag = tag;
        Ok(())
    }

    /// Get version by tag
    pub fn get_by_tag(&self, tag: &str) -> Option<&Version> {
        self.versions.iter().find(|v| v.tag == tag)
    }

    /// Checkout/switch to a version
    pub fn checkout(&mut self, number: u32) -> SpkResult<&Version> {
        if self.versions.iter().any(|v| v.number == number) {
            self.current = number;
            Ok(self.get_version(number).unwrap())
        } else {
            Err(SpkError::VersionError(format!("Version {} not found", number)))
        }
    }

    /// Prune old versions beyond max_versions
    fn prune_old_versions(&mut self) {
        if self.versions.len() > self.max_versions {
            let to_remove = self.versions.len() - self.max_versions;
            // Keep first version and remove oldest non-tagged versions
            let mut removable: Vec<usize> = self.versions.iter()
                .enumerate()
                .skip(1) // Skip initial version
                .filter(|(_, v)| v.number != self.current)
                .map(|(i, _)| i)
                .collect();
            
            removable.truncate(to_remove);
            for i in removable.into_iter().rev() {
                self.versions.remove(i);
            }
        }
    }

    /// Convert to version info for manifest
    pub fn to_version_info(&self) -> VersionInfo {
        VersionInfo {
            current_version: self.current,
            version_count: self.versions.len() as u32,
            latest_tag: self.get_current().map(|v| v.tag.clone()).unwrap_or_default(),
            created: self.versions.first().map(|v| v.timestamp).unwrap_or(0),
            modified: self.get_current().map(|v| v.timestamp).unwrap_or(0),
        }
    }

    /// Serialize version history
    pub fn serialize(&self) -> SpkResult<Vec<u8>> {
        serde_json::to_vec(self)
            .map_err(|e| SpkError::SerializationError(e.to_string()))
    }

    /// Deserialize version history
    pub fn deserialize(data: &[u8]) -> SpkResult<Self> {
        serde_json::from_slice(data)
            .map_err(|e| SpkError::DeserializationError(e.to_string()))
    }
}

/// Delta compression for versioned files
pub struct DeltaCompressor {
    /// Block size for diff calculation
    block_size: usize,
}

impl DeltaCompressor {
    /// Create new delta compressor
    pub fn new() -> Self {
        Self {
            block_size: 4096,
        }
    }

    /// Create new with custom block size
    pub fn with_block_size(block_size: usize) -> Self {
        Self { block_size }
    }

    /// Compute delta between old and new data
    pub fn compute_delta(&self, old_data: &[u8], new_data: &[u8]) -> DeltaResult {
        // Build hash index of old blocks
        let mut old_index: HashMap<[u8; 32], Vec<usize>> = HashMap::new();
        for (i, chunk) in old_data.chunks(self.block_size).enumerate() {
            let hash = sha256_hash(chunk);
            old_index.entry(hash).or_default().push(i);
        }

        let mut instructions = Vec::new();
        let mut pos = 0;

        while pos < new_data.len() {
            let end = (pos + self.block_size).min(new_data.len());
            let block = &new_data[pos..end];
            let hash = sha256_hash(block);

            if let Some(old_positions) = old_index.get(&hash) {
                // Block exists in old data - reference it
                let old_pos = old_positions[0];
                instructions.push(DeltaInstruction::Copy {
                    source_offset: old_pos * self.block_size,
                    length: block.len(),
                });
            } else {
                // New block - include raw data
                instructions.push(DeltaInstruction::Insert {
                    data: block.to_vec(),
                });
            }

            pos = end;
        }

        // Optimize: merge consecutive inserts
        let optimized = self.optimize_instructions(instructions);

        DeltaResult {
            old_size: old_data.len() as u64,
            new_size: new_data.len() as u64,
            instructions: optimized,
        }
    }

    /// Optimize delta instructions
    fn optimize_instructions(&self, instructions: Vec<DeltaInstruction>) -> Vec<DeltaInstruction> {
        let mut optimized = Vec::new();
        let mut pending_insert: Option<Vec<u8>> = None;

        for inst in instructions {
            match inst {
                DeltaInstruction::Insert { data } => {
                    if let Some(ref mut pending) = pending_insert {
                        pending.extend(data);
                    } else {
                        pending_insert = Some(data);
                    }
                }
                DeltaInstruction::Copy { source_offset, length } => {
                    if let Some(data) = pending_insert.take() {
                        optimized.push(DeltaInstruction::Insert { data });
                    }
                    optimized.push(DeltaInstruction::Copy { source_offset, length });
                }
            }
        }

        if let Some(data) = pending_insert {
            optimized.push(DeltaInstruction::Insert { data });
        }

        optimized
    }

    /// Apply delta to reconstruct new data
    pub fn apply_delta(&self, old_data: &[u8], delta: &DeltaResult) -> SpkResult<Vec<u8>> {
        let mut result = Vec::with_capacity(delta.new_size as usize);

        for instruction in &delta.instructions {
            match instruction {
                DeltaInstruction::Copy { source_offset, length } => {
                    let end = source_offset + length;
                    if end > old_data.len() {
                        return Err(SpkError::DeltaError("Invalid copy offset".into()));
                    }
                    result.extend_from_slice(&old_data[*source_offset..end]);
                }
                DeltaInstruction::Insert { data } => {
                    result.extend_from_slice(data);
                }
            }
        }

        if result.len() != delta.new_size as usize {
            return Err(SpkError::DeltaError(format!(
                "Size mismatch: expected {}, got {}",
                delta.new_size,
                result.len()
            )));
        }

        Ok(result)
    }
}

impl Default for DeltaCompressor {
    fn default() -> Self {
        Self::new()
    }
}

/// Delta instruction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeltaInstruction {
    /// Copy from old data
    Copy {
        source_offset: usize,
        length: usize,
    },
    /// Insert new data
    Insert {
        data: Vec<u8>,
    },
}

/// Result of delta computation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaResult {
    pub old_size: u64,
    pub new_size: u64,
    pub instructions: Vec<DeltaInstruction>,
}

impl DeltaResult {
    /// Calculate size of delta
    pub fn delta_size(&self) -> usize {
        self.instructions.iter().map(|i| match i {
            DeltaInstruction::Copy { .. } => 16, // offset + length
            DeltaInstruction::Insert { data } => 8 + data.len(), // length + data
        }).sum()
    }

    /// Calculate compression ratio
    pub fn ratio(&self) -> f64 {
        if self.new_size == 0 {
            1.0
        } else {
            self.delta_size() as f64 / self.new_size as f64
        }
    }

    /// Check if delta is worth using
    pub fn is_efficient(&self) -> bool {
        self.ratio() < 0.8 // Delta should be at least 20% smaller
    }

    /// Serialize delta
    pub fn serialize(&self) -> SpkResult<Vec<u8>> {
        bincode::serialize(self)
            .map_err(|e| SpkError::SerializationError(e.to_string()))
    }

    /// Deserialize delta
    pub fn deserialize(data: &[u8]) -> SpkResult<Self> {
        bincode::deserialize(data)
            .map_err(|e| SpkError::DeserializationError(e.to_string()))
    }
}

/// Get current timestamp
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_history_creation() {
        let mut history = VersionHistory::new("test-archive".into());
        history.create_initial("test".into(), "Initial version".into());
        
        assert_eq!(history.current, 1);
        assert_eq!(history.versions.len(), 1);
    }

    #[test]
    fn test_version_creation() {
        let mut history = VersionHistory::new("test-archive".into());
        history.create_initial("test".into(), "Initial".into());
        
        let changes = vec![
            VersionChange::Added {
                path: "file.txt".into(),
                size: 100,
                chunk_start: 0,
                chunk_count: 1,
            },
        ];
        
        history.create_version("test".into(), "Added file".into(), changes).unwrap();
        
        assert_eq!(history.current, 2);
        assert_eq!(history.versions.len(), 2);
    }

    #[test]
    fn test_delta_compression() {
        let compressor = DeltaCompressor::new();
        
        let old_data = b"Hello World! This is some test data.";
        let new_data = b"Hello World! This is some modified test data.";
        
        let delta = compressor.compute_delta(old_data, new_data);
        let reconstructed = compressor.apply_delta(old_data, &delta).unwrap();
        
        assert_eq!(reconstructed, new_data);
    }

    #[test]
    fn test_delta_with_identical_blocks() {
        let compressor = DeltaCompressor::with_block_size(16);
        
        // Create data with some identical blocks
        let mut old_data = vec![0u8; 64];
        let mut new_data = vec![0u8; 64];
        
        // Make first 32 bytes identical, last 32 different
        for i in 0..32 {
            old_data[i] = i as u8;
            new_data[i] = i as u8;
        }
        for i in 32..64 {
            old_data[i] = i as u8;
            new_data[i] = (i + 100) as u8;
        }
        
        let delta = compressor.compute_delta(&old_data, &new_data);
        let reconstructed = compressor.apply_delta(&old_data, &delta).unwrap();
        
        assert_eq!(reconstructed, new_data);
    }

    #[test]
    fn test_version_checkout() {
        let mut history = VersionHistory::new("test-archive".into());
        history.create_initial("test".into(), "v1".into());
        history.create_version("test".into(), "v2".into(), vec![]).unwrap();
        history.create_version("test".into(), "v3".into(), vec![]).unwrap();
        
        assert_eq!(history.current, 3);
        
        history.checkout(1).unwrap();
        assert_eq!(history.current, 1);
        
        history.checkout(2).unwrap();
        assert_eq!(history.current, 2);
    }

    #[test]
    fn test_version_tags() {
        let mut history = VersionHistory::new("test-archive".into());
        history.create_initial("test".into(), "Initial".into());
        
        history.set_tag(1, "release-1.0".into()).unwrap();
        
        let v = history.get_by_tag("release-1.0").unwrap();
        assert_eq!(v.number, 1);
    }
}
