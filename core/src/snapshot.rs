//! Snapshot File Format for 100TB-scale Reconstruction
//!
//! A snapshot is metadata + chunk references, NOT raw compressed payload.
//! It enables byte-perfect reconstruction when the chunk store is accessible.
//!
//! ## Format Overview
//! ```text
//! ┌─────────────────────────────────────────┐
//! │ Header (64 bytes)                       │
//! │   - Magic: "SPK_SNAP"                   │
//! │   - Version, flags, timestamps          │
//! ├─────────────────────────────────────────┤
//! │ Metadata Section                        │
//! │   - Total files, total bytes            │
//! │   - Chunk store location                │
//! │   - Dictionary references               │
//! ├─────────────────────────────────────────┤
//! │ File Manifest (variable)                │
//! │   - Path, size, mode, timestamps        │
//! │   - Chunk recipe (ordered fingerprints) │
//! ├─────────────────────────────────────────┤
//! │ Chunk Index (variable)                  │
//! │   - Fingerprint → location mapping      │
//! │   - Delta references if applicable      │
//! ├─────────────────────────────────────────┤
//! │ Integrity Footer                        │
//! │   - Section checksums                   │
//! │   - Root hash of entire snapshot        │
//! └─────────────────────────────────────────┘
//! ```

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::dedup_store::BLAKE3_SIZE;

/// Snapshot file magic bytes
pub const SNAPSHOT_MAGIC: &[u8; 8] = b"SPK_SNAP";

/// Current snapshot format version
pub const SNAPSHOT_VERSION: u32 = 1;

/// Snapshot header (64 bytes fixed)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotHeader {
    /// Magic bytes (8)
    pub magic: [u8; 8],
    /// Format version (4)
    pub version: u32,
    /// Feature flags (4)
    pub flags: u32,
    /// Creation timestamp Unix seconds (8)
    pub created_at: u64,
    /// Total files in snapshot (8)
    pub total_files: u64,
    /// Total bytes represented (8)
    pub total_bytes: u64,
    /// Total unique chunks (8)
    pub unique_chunks: u64,
    /// Bytes after dedup+compression (8)
    pub stored_bytes: u64,
    /// Reserved for future use (8)
    pub reserved: u64,
}

impl SnapshotHeader {
    /// Create a new snapshot header
    pub fn new() -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            magic: *SNAPSHOT_MAGIC,
            version: SNAPSHOT_VERSION,
            flags: 0,
            created_at: now,
            total_files: 0,
            total_bytes: 0,
            unique_chunks: 0,
            stored_bytes: 0,
            reserved: 0,
        }
    }

    /// Validate the header
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if &self.magic != SNAPSHOT_MAGIC {
            return Err(SnapshotError::InvalidMagic);
        }
        if self.version > SNAPSHOT_VERSION {
            return Err(SnapshotError::UnsupportedVersion(self.version));
        }
        Ok(())
    }

    /// Calculate effective compression ratio
    pub fn compression_ratio(&self) -> f64 {
        if self.stored_bytes == 0 {
            return 1.0;
        }
        self.total_bytes as f64 / self.stored_bytes as f64
    }

    /// Calculate deduplication ratio
    pub fn dedup_savings_percent(&self) -> f64 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        let saved = self.total_bytes.saturating_sub(self.stored_bytes);
        (saved as f64 / self.total_bytes as f64) * 100.0
    }
}

impl Default for SnapshotHeader {
    fn default() -> Self {
        Self::new()
    }
}

/// Snapshot metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMetadata {
    /// Human-readable name/description
    pub name: String,
    /// Source path(s) that were snapshotted
    pub source_paths: Vec<String>,
    /// Chunk store location (path or URL)
    pub chunk_store: String,
    /// Map of shard id -> store path/URL
    #[serde(default)]
    pub shard_map: HashMap<u16, String>,
    /// Dictionary IDs used in this snapshot
    pub dictionaries: Vec<u32>,
    /// Custom key-value metadata
    pub custom: HashMap<String, String>,
    /// Hostname where snapshot was created
    pub hostname: String,
    /// User who created snapshot
    pub username: String,
}

impl Default for SnapshotMetadata {
    fn default() -> Self {
        Self {
            name: String::new(),
            source_paths: Vec::new(),
            chunk_store: String::new(),
            shard_map: HashMap::new(),
            dictionaries: Vec::new(),
            custom: HashMap::new(),
            hostname: hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string()),
            username: whoami::username(),
        }
    }
}

/// File entry in the manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Relative path from snapshot root
    pub path: String,
    /// Original file size in bytes
    pub size: u64,
    /// File mode/permissions (Unix-style)
    pub mode: u32,
    /// Modification time (Unix seconds)
    pub mtime: u64,
    /// Creation time (Unix seconds)
    pub ctime: u64,
    /// Whether this is a directory
    pub is_dir: bool,
    /// Whether this is a symlink
    pub is_symlink: bool,
    /// Symlink target (if is_symlink)
    pub symlink_target: Option<String>,
    /// Ordered list of chunk fingerprints that make up this file
    /// Empty for directories and symlinks
    pub chunks: Vec<ChunkRef>,
    /// BLAKE3 hash of entire file (for integrity verification)
    pub file_hash: [u8; BLAKE3_SIZE],
}

impl FileEntry {
    /// Create entry for a directory
    pub fn directory(path: String, mode: u32, mtime: u64) -> Self {
        Self {
            path,
            size: 0,
            mode,
            mtime,
            ctime: mtime,
            is_dir: true,
            is_symlink: false,
            symlink_target: None,
            chunks: Vec::new(),
            file_hash: [0u8; BLAKE3_SIZE],
        }
    }

    /// Create entry for a symlink
    pub fn symlink(path: String, target: String, mtime: u64) -> Self {
        Self {
            path,
            size: 0,
            mode: 0o777,
            mtime,
            ctime: mtime,
            is_dir: false,
            is_symlink: true,
            symlink_target: Some(target),
            chunks: Vec::new(),
            file_hash: [0u8; BLAKE3_SIZE],
        }
    }

    /// Create entry for a regular file
    pub fn file(path: String, size: u64, mode: u32, mtime: u64, chunks: Vec<ChunkRef>, file_hash: [u8; BLAKE3_SIZE]) -> Self {
        Self {
            path,
            size,
            mode,
            mtime,
            ctime: mtime,
            is_dir: false,
            is_symlink: false,
            symlink_target: None,
            chunks,
            file_hash,
        }
    }

    /// Calculate expected size from chunks
    pub fn expected_size_from_chunks(&self) -> u64 {
        self.chunks.iter().map(|c| c.size as u64).sum()
    }

    /// Validate that chunks sum to file size
    pub fn validate_size(&self) -> bool {
        if self.is_dir || self.is_symlink {
            return true;
        }
        self.expected_size_from_chunks() == self.size
    }
}

/// Reference to a chunk in the store
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkRef {
    /// BLAKE3 fingerprint of chunk content
    pub fingerprint: [u8; BLAKE3_SIZE],
    /// Offset within the file where this chunk starts
    pub offset: u64,
    /// Uncompressed size of this chunk
    pub size: u32,
    /// If this chunk is a delta, reference to base chunk
    pub delta_base: Option<[u8; BLAKE3_SIZE]>,
    /// Shard where the chunk is stored
    #[serde(default)]
    pub shard_id: u16,
}

impl ChunkRef {
    /// Create a new chunk reference
    pub fn new(fingerprint: [u8; BLAKE3_SIZE], offset: u64, size: u32) -> Self {
        Self {
            fingerprint,
            offset,
            size,
            delta_base: None,
            shard_id: 0,
        }
    }

    /// Create a delta chunk reference
    pub fn delta(fingerprint: [u8; BLAKE3_SIZE], offset: u64, size: u32, base: [u8; BLAKE3_SIZE]) -> Self {
        Self {
            fingerprint,
            offset,
            size,
            delta_base: Some(base),
            shard_id: 0,
        }
    }
}

/// Chunk index entry (for quick lookup)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkIndexEntry {
    /// Volume ID in chunk store
    pub volume_id: u32,
    /// Offset within volume
    pub volume_offset: u64,
    /// Compressed size on disk
    pub compressed_size: u32,
    /// Dictionary ID used (0xFFFFFFFF = none)
    pub dict_id: u32,
    /// Reference count in this snapshot
    pub refcount: u32,
    /// Shard identifier
    #[serde(default)]
    pub shard_id: u16,
}

/// Integrity footer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotFooter {
    /// BLAKE3 hash of header
    pub header_hash: [u8; BLAKE3_SIZE],
    /// BLAKE3 hash of metadata
    pub metadata_hash: [u8; BLAKE3_SIZE],
    /// BLAKE3 hash of file manifest
    pub manifest_hash: [u8; BLAKE3_SIZE],
    /// BLAKE3 hash of chunk index
    pub index_hash: [u8; BLAKE3_SIZE],
    /// Root hash (hash of all above hashes)
    pub root_hash: [u8; BLAKE3_SIZE],
}

impl SnapshotFooter {
    /// Compute root hash from section hashes
    pub fn compute_root_hash(&mut self) {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&self.header_hash);
        hasher.update(&self.metadata_hash);
        hasher.update(&self.manifest_hash);
        hasher.update(&self.index_hash);
        self.root_hash = *hasher.finalize().as_bytes();
    }

    /// Verify root hash
    pub fn verify(&self) -> bool {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&self.header_hash);
        hasher.update(&self.metadata_hash);
        hasher.update(&self.manifest_hash);
        hasher.update(&self.index_hash);
        *hasher.finalize().as_bytes() == self.root_hash
    }
}

/// Complete snapshot structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub header: SnapshotHeader,
    pub metadata: SnapshotMetadata,
    pub files: Vec<FileEntry>,
    /// Chunk index: fingerprint (hex) -> location
    pub chunk_index: HashMap<String, ChunkIndexEntry>,
    pub footer: SnapshotFooter,
}

impl Snapshot {
    /// Create a new empty snapshot
    pub fn new(name: &str, chunk_store: &str) -> Self {
        let mut metadata = SnapshotMetadata::default();
        metadata.name = name.to_string();
        metadata.chunk_store = chunk_store.to_string();

        Self {
            header: SnapshotHeader::new(),
            metadata,
            files: Vec::new(),
            chunk_index: HashMap::new(),
            footer: SnapshotFooter {
                header_hash: [0u8; BLAKE3_SIZE],
                metadata_hash: [0u8; BLAKE3_SIZE],
                manifest_hash: [0u8; BLAKE3_SIZE],
                index_hash: [0u8; BLAKE3_SIZE],
                root_hash: [0u8; BLAKE3_SIZE],
            },
        }
    }

    /// Add a file entry to the snapshot
    pub fn add_file(&mut self, entry: FileEntry) {
        if !entry.is_dir && !entry.is_symlink {
            self.header.total_bytes += entry.size;
            
            // Track unique chunks
            for chunk in &entry.chunks {
                let fp_hex = hex::encode(chunk.fingerprint);
                if !self.chunk_index.contains_key(&fp_hex) {
                    // Placeholder - actual location comes from dedup store
                    self.chunk_index.insert(fp_hex, ChunkIndexEntry {
                        shard_id: chunk.shard_id,
                        volume_id: 0,
                        volume_offset: 0,
                        compressed_size: 0,
                        dict_id: 0xFFFFFFFF,
                        refcount: 1,
                    });
                    self.header.unique_chunks += 1;
                } else {
                    if let Some(entry) = self.chunk_index.get_mut(&hex::encode(chunk.fingerprint)) {
                        entry.refcount += 1;
                    }
                }
            }
        }
        
        self.header.total_files += 1;
        self.files.push(entry);
    }

    /// Update chunk index with actual locations from dedup store
    pub fn update_chunk_location(
        &mut self,
        fingerprint: &[u8; BLAKE3_SIZE],
        volume_id: u32,
        volume_offset: u64,
        compressed_size: u32,
        dict_id: u32,
    ) {
        self.update_chunk_location_sharded(fingerprint, volume_id, volume_offset, compressed_size, dict_id, 0);
    }

    /// Update chunk index with shard-awareness
    pub fn update_chunk_location_sharded(
        &mut self,
        fingerprint: &[u8; BLAKE3_SIZE],
        volume_id: u32,
        volume_offset: u64,
        compressed_size: u32,
        dict_id: u32,
        shard_id: u16,
    ) {
        let fp_hex = hex::encode(fingerprint);
        if let Some(entry) = self.chunk_index.get_mut(&fp_hex) {
            entry.volume_id = volume_id;
            entry.volume_offset = volume_offset;
            entry.compressed_size = compressed_size;
            entry.dict_id = dict_id;
            entry.shard_id = shard_id;
            self.header.stored_bytes += compressed_size as u64;
        }
    }

    /// Finalize snapshot (compute hashes)
    pub fn finalize(&mut self) -> Result<(), SnapshotError> {
        // Compute section hashes
        let header_bytes = serde_json::to_vec(&self.header)?;
        self.footer.header_hash = *blake3::hash(&header_bytes).as_bytes();

        let metadata_bytes = serde_json::to_vec(&self.metadata)?;
        self.footer.metadata_hash = *blake3::hash(&metadata_bytes).as_bytes();

        let manifest_bytes = serde_json::to_vec(&self.files)?;
        self.footer.manifest_hash = *blake3::hash(&manifest_bytes).as_bytes();

        let index_bytes = serde_json::to_vec(&self.chunk_index)?;
        self.footer.index_hash = *blake3::hash(&index_bytes).as_bytes();

        // Compute root hash
        self.footer.compute_root_hash();

        Ok(())
    }

    /// Write snapshot to file
    pub fn write<P: AsRef<Path>>(&self, path: P) -> Result<(), SnapshotError> {
        let file = File::create(path)?;
        let writer = BufWriter::new(file);
        
        // Write as compressed JSON (snapshots should be small)
        let json = serde_json::to_vec(self)?;
        let compressed = zstd::encode_all(&json[..], 19)?; // Max compression for small file
        
        let mut writer = writer;
        writer.write_all(&compressed)?;
        writer.flush()?;
        
        Ok(())
    }

    /// Read snapshot from file
    pub fn read<P: AsRef<Path>>(path: P) -> Result<Self, SnapshotError> {
        let file = File::open(path)?;
        let mut reader = BufReader::new(file);
        
        let mut compressed = Vec::new();
        reader.read_to_end(&mut compressed)?;
        
        let json = zstd::decode_all(&compressed[..])?;
        let snapshot: Snapshot = serde_json::from_slice(&json)?;
        
        // Validate
        snapshot.header.validate()?;
        if !snapshot.footer.verify() {
            return Err(SnapshotError::IntegrityError);
        }
        
        Ok(snapshot)
    }

    /// Get deduplication statistics
    pub fn dedup_stats(&self) -> DedupStats {
        let total_chunk_refs: u64 = self.files.iter()
            .filter(|f| !f.is_dir && !f.is_symlink)
            .map(|f| f.chunks.len() as u64)
            .sum();
        
        let unique_chunks = self.chunk_index.len() as u64;
        
        DedupStats {
            total_files: self.header.total_files,
            total_bytes: self.header.total_bytes,
            unique_chunks,
            total_chunk_refs,
            stored_bytes: self.header.stored_bytes,
            dedup_ratio: if unique_chunks > 0 { total_chunk_refs as f64 / unique_chunks as f64 } else { 1.0 },
            compression_ratio: self.header.compression_ratio(),
            effective_ratio: if self.header.stored_bytes > 0 { 
                self.header.total_bytes as f64 / self.header.stored_bytes as f64 
            } else { 1.0 },
        }
    }

    /// List all files in snapshot
    pub fn list_files(&self) -> impl Iterator<Item = &FileEntry> {
        self.files.iter()
    }

    /// Find a file by path
    pub fn find_file(&self, path: &str) -> Option<&FileEntry> {
        self.files.iter().find(|f| f.path == path)
    }

    /// Get all chunk fingerprints needed to reconstruct a file
    pub fn get_file_chunks(&self, path: &str) -> Option<Vec<[u8; BLAKE3_SIZE]>> {
        self.find_file(path).map(|f| {
            f.chunks.iter().map(|c| c.fingerprint).collect()
        })
    }

    /// Estimate snapshot file size (for progress reporting)
    pub fn estimate_snapshot_size(&self) -> usize {
        // Rough estimate: header + metadata + files + index
        let files_estimate = self.files.len() * 500; // ~500 bytes per file entry
        let index_estimate = self.chunk_index.len() * 100; // ~100 bytes per chunk ref
        1024 + files_estimate + index_estimate
    }
}

/// Deduplication statistics
#[derive(Debug, Clone)]
pub struct DedupStats {
    pub total_files: u64,
    pub total_bytes: u64,
    pub unique_chunks: u64,
    pub total_chunk_refs: u64,
    pub stored_bytes: u64,
    pub dedup_ratio: f64,
    pub compression_ratio: f64,
    pub effective_ratio: f64,
}

impl std::fmt::Display for DedupStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "=== Snapshot Statistics ===")?;
        writeln!(f, "Files: {}", self.total_files)?;
        writeln!(f, "Total size: {} ({} bytes)", format_bytes(self.total_bytes), self.total_bytes)?;
        writeln!(f, "Stored size: {} ({} bytes)", format_bytes(self.stored_bytes), self.stored_bytes)?;
        writeln!(f, "Unique chunks: {}", self.unique_chunks)?;
        writeln!(f, "Total chunk refs: {}", self.total_chunk_refs)?;
        writeln!(f, "Dedup ratio: {:.2}x", self.dedup_ratio)?;
        writeln!(f, "Compression ratio: {:.2}x", self.compression_ratio)?;
        writeln!(f, "Effective ratio: {:.2}x", self.effective_ratio)?;
        writeln!(f, "Space saved: {:.1}%", 
            if self.total_bytes > 0 { 
                (1.0 - self.stored_bytes as f64 / self.total_bytes as f64) * 100.0 
            } else { 0.0 }
        )
    }
}

/// Format bytes as human-readable
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Snapshot errors
#[derive(Debug)]
pub enum SnapshotError {
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidMagic,
    UnsupportedVersion(u32),
    IntegrityError,
    ChunkNotFound([u8; BLAKE3_SIZE]),
    FileNotFound(String),
    ReconstructionFailed(String),
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "IO error: {}", e),
            Self::Json(e) => write!(f, "JSON error: {}", e),
            Self::InvalidMagic => write!(f, "Invalid snapshot magic bytes"),
            Self::UnsupportedVersion(v) => write!(f, "Unsupported snapshot version: {}", v),
            Self::IntegrityError => write!(f, "Snapshot integrity check failed"),
            Self::ChunkNotFound(fp) => write!(f, "Chunk not found: {}", hex::encode(fp)),
            Self::FileNotFound(p) => write!(f, "File not found in snapshot: {}", p),
            Self::ReconstructionFailed(msg) => write!(f, "Reconstruction failed: {}", msg),
        }
    }
}

impl std::error::Error for SnapshotError {}

impl From<std::io::Error> for SnapshotError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<serde_json::Error> for SnapshotError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

/// Builder for creating snapshots incrementally
pub struct SnapshotBuilder {
    snapshot: Snapshot,
    source_root: PathBuf,
}

impl SnapshotBuilder {
    /// Create a new snapshot builder
    pub fn new(name: &str, source_root: &Path, chunk_store: &str) -> Self {
        let mut snapshot = Snapshot::new(name, chunk_store);
        snapshot.metadata.source_paths.push(source_root.to_string_lossy().to_string());
        
        Self {
            snapshot,
            source_root: source_root.to_path_buf(),
        }
    }

    /// Add a file with its chunks
    pub fn add_file(
        &mut self,
        path: &Path,
        chunks: Vec<ChunkRef>,
        file_hash: [u8; BLAKE3_SIZE],
    ) -> Result<(), SnapshotError> {
        let rel_path = path.strip_prefix(&self.source_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"); // Normalize to Unix paths
        
        let metadata = fs::metadata(path)?;
        let size = metadata.len();
        
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::MetadataExt;
            metadata.mode()
        };
        #[cfg(not(unix))]
        let mode = if metadata.is_dir() { 0o755 } else { 0o644 };
        
        let mtime = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        
        let entry = FileEntry::file(rel_path, size, mode, mtime, chunks, file_hash);
        self.snapshot.add_file(entry);
        
        Ok(())
    }

    /// Add a directory
    pub fn add_directory(&mut self, path: &Path) -> Result<(), SnapshotError> {
        let rel_path = path.strip_prefix(&self.source_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        
        let metadata = fs::metadata(path)?;
        
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::MetadataExt;
            metadata.mode()
        };
        #[cfg(not(unix))]
        let mode = 0o755;
        
        let mtime = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        
        let entry = FileEntry::directory(rel_path, mode, mtime);
        self.snapshot.add_file(entry);
        
        Ok(())
    }

    /// Add a symlink
    #[cfg(unix)]
    pub fn add_symlink(&mut self, path: &Path) -> Result<(), SnapshotError> {
        let rel_path = path.strip_prefix(&self.source_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        
        let target = fs::read_link(path)?
            .to_string_lossy()
            .to_string();
        
        let metadata = fs::symlink_metadata(path)?;
        let mtime = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        
        let entry = FileEntry::symlink(rel_path, target, mtime);
        self.snapshot.add_file(entry);
        
        Ok(())
    }

    /// Update stored bytes from dedup store
    pub fn set_stored_bytes(&mut self, stored_bytes: u64) {
        self.snapshot.header.stored_bytes = stored_bytes;
    }

    /// Finalize and return the snapshot
    pub fn build(mut self) -> Result<Snapshot, SnapshotError> {
        self.snapshot.finalize()?;
        Ok(self.snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_snapshot_header() {
        let header = SnapshotHeader::new();
        assert_eq!(&header.magic, SNAPSHOT_MAGIC);
        assert_eq!(header.version, SNAPSHOT_VERSION);
        assert!(header.validate().is_ok());
    }

    #[test]
    fn test_snapshot_create_and_read() {
        let dir = tempdir().unwrap();
        let snap_path = dir.path().join("test.snap");
        
        let mut snapshot = Snapshot::new("test", "/tmp/chunks");
        
        // Add a file entry
        let chunks = vec![
            ChunkRef::new([1u8; 32], 0, 1024),
            ChunkRef::new([2u8; 32], 1024, 2048),
        ];
        let entry = FileEntry::file("test.txt".to_string(), 3072, 0o644, 1234567890, chunks, [3u8; 32]);
        snapshot.add_file(entry);
        
        // Finalize and write
        snapshot.finalize().unwrap();
        snapshot.write(&snap_path).unwrap();
        
        // Read back
        let loaded = Snapshot::read(&snap_path).unwrap();
        assert_eq!(loaded.header.total_files, 1);
        assert_eq!(loaded.header.total_bytes, 3072);
        assert_eq!(loaded.files[0].path, "test.txt");
        assert_eq!(loaded.files[0].chunks.len(), 2);
    }

    #[test]
    fn test_dedup_stats() {
        let mut snapshot = Snapshot::new("test", "/tmp/chunks");
        
        // Add files with shared chunks
        let shared_chunk = ChunkRef::new([1u8; 32], 0, 1024);
        
        let entry1 = FileEntry::file("file1.txt".to_string(), 1024, 0o644, 0, vec![shared_chunk.clone()], [2u8; 32]);
        let entry2 = FileEntry::file("file2.txt".to_string(), 1024, 0o644, 0, vec![shared_chunk.clone()], [3u8; 32]);
        
        snapshot.add_file(entry1);
        snapshot.add_file(entry2);
        
        let stats = snapshot.dedup_stats();
        assert_eq!(stats.total_files, 2);
        assert_eq!(stats.total_bytes, 2048);
        assert_eq!(stats.unique_chunks, 1); // Same chunk referenced twice
        assert_eq!(stats.total_chunk_refs, 2);
        assert_eq!(stats.dedup_ratio, 2.0); // 2 refs per unique chunk
    }

    #[test]
    fn test_file_entry_validation() {
        let chunks = vec![
            ChunkRef::new([1u8; 32], 0, 500),
            ChunkRef::new([2u8; 32], 500, 524),
        ];
        let entry = FileEntry::file("test.bin".to_string(), 1024, 0o644, 0, chunks, [0u8; 32]);
        assert!(entry.validate_size());
        
        // Directory should always validate
        let dir = FileEntry::directory("dir".to_string(), 0o755, 0);
        assert!(dir.validate_size());
    }

    #[test]
    fn test_footer_integrity() {
        let mut footer = SnapshotFooter {
            header_hash: [1u8; 32],
            metadata_hash: [2u8; 32],
            manifest_hash: [3u8; 32],
            index_hash: [4u8; 32],
            root_hash: [0u8; 32],
        };
        
        footer.compute_root_hash();
        assert!(footer.verify());
        
        // Tamper with a hash
        footer.header_hash[0] = 99;
        assert!(!footer.verify());
    }

    #[test]
    fn test_chunk_ref_delta() {
        let base = [1u8; 32];
        let delta_ref = ChunkRef::delta([2u8; 32], 0, 100, base);
        
        assert!(delta_ref.delta_base.is_some());
        assert_eq!(delta_ref.delta_base.unwrap(), base);
    }
}
