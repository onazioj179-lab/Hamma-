//! SPK Manifest - File metadata and structure information
//!
//! The manifest contains all file entries with their metadata,
//! stored as zstd-compressed JSON (default) or CBOR (for efficiency).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};

use crate::utils::error::{SpkError, SpkResult};

/// File entry in the manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// File path relative to archive root
    pub path: String,
    /// Original uncompressed size
    pub size: u64,
    /// Unix timestamp of modification
    pub modified: u64,
    /// Unix timestamp of creation (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<u64>,
    /// File permissions (Unix mode)
    pub permissions: u32,
    /// Starting chunk index
    pub chunk_start: u64,
    /// Number of chunks
    pub chunk_count: u32,
    /// SHA-256 hash of original file content
    pub content_hash: String,
    /// Whether this is a directory
    #[serde(default)]
    pub is_directory: bool,
    /// Whether this is a symbolic link
    #[serde(default)]
    pub is_symlink: bool,
    /// Symbolic link target (if is_symlink)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symlink_target: Option<String>,
    /// Extended attributes (V3+)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub xattrs: HashMap<String, Vec<u8>>,
    /// File version (V5 versioned archives)
    #[serde(default = "default_version")]
    pub version: u32,
    /// Previous version hash (V5 delta compression)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version_hash: Option<String>,
}

fn default_version() -> u32 {
    1
}

impl FileEntry {
    /// Create a new file entry
    pub fn new(path: String, size: u64, permissions: u32) -> Self {
        Self {
            path,
            size,
            modified: 0,
            created: None,
            permissions,
            chunk_start: 0,
            chunk_count: 0,
            content_hash: String::new(),
            is_directory: false,
            is_symlink: false,
            symlink_target: None,
            xattrs: HashMap::new(),
            version: 1,
            previous_version_hash: None,
        }
    }

    /// Create a directory entry
    pub fn directory(path: String, permissions: u32) -> Self {
        Self {
            path,
            size: 0,
            modified: 0,
            created: None,
            permissions,
            chunk_start: 0,
            chunk_count: 0,
            content_hash: String::new(),
            is_directory: true,
            is_symlink: false,
            symlink_target: None,
            xattrs: HashMap::new(),
            version: 1,
            previous_version_hash: None,
        }
    }

    /// Create a symbolic link entry
    pub fn symlink(path: String, target: String) -> Self {
        Self {
            path,
            size: 0,
            modified: 0,
            created: None,
            permissions: 0o777,
            chunk_start: 0,
            chunk_count: 0,
            content_hash: String::new(),
            is_directory: false,
            is_symlink: true,
            symlink_target: Some(target),
            xattrs: HashMap::new(),
            version: 1,
            previous_version_hash: None,
        }
    }
}

/// Archive metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveMetadata {
    /// Archive name/title
    pub name: String,
    /// Description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Creator application
    pub creator: String,
    /// Creator version
    pub creator_version: String,
    /// Creation timestamp
    pub created: u64,
    /// Last modified timestamp
    pub modified: u64,
    /// Comment
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Custom tags
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Custom metadata
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub custom: HashMap<String, String>,
}

impl Default for ArchiveMetadata {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: None,
            creator: "SPK".to_string(),
            creator_version: env!("CARGO_PKG_VERSION").to_string(),
            created: 0,
            modified: 0,
            comment: None,
            tags: Vec::new(),
            custom: HashMap::new(),
        }
    }
}

/// Compression statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompressionStats {
    /// Total original size
    pub original_size: u64,
    /// Total compressed size
    pub compressed_size: u64,
    /// Number of files
    pub file_count: u64,
    /// Number of directories
    pub directory_count: u64,
    /// Number of symlinks
    pub symlink_count: u64,
    /// Number of chunks
    pub chunk_count: u64,
    /// Number of deduplicated chunks (V4)
    pub dedup_chunks: u64,
    /// Bytes saved by deduplication
    pub dedup_saved: u64,
    /// Compression ratio (compressed / original)
    pub compression_ratio: f64,
}

impl CompressionStats {
    pub fn calculate_ratio(&mut self) {
        if self.original_size > 0 {
            self.compression_ratio = self.compressed_size as f64 / self.original_size as f64;
        } else {
            self.compression_ratio = 1.0;
        }
    }

    pub fn space_saved_percent(&self) -> f64 {
        if self.original_size > 0 {
            (1.0 - self.compression_ratio) * 100.0
        } else {
            0.0
        }
    }
}

/// SPK Manifest - contains all archive metadata and file entries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// SPK format version this manifest was created with
    pub format_version: u16,
    /// Archive metadata
    pub metadata: ArchiveMetadata,
    /// All file entries
    pub files: Vec<FileEntry>,
    /// Compression statistics
    pub stats: CompressionStats,
    /// Multipart info (V3)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multipart: Option<MultipartInfo>,
    /// Version history (V5)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub version_history: Vec<VersionInfo>,
}

/// Multipart archive info (V3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultipartInfo {
    /// Total number of parts
    pub total_parts: u32,
    /// Current part number (1-based)
    pub current_part: u32,
    /// Maximum size per part in bytes
    pub part_size: u64,
    /// Archive ID (same across all parts)
    pub archive_id: String,
}

/// Version info for versioned archives (V5)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    /// Version number
    pub version: u32,
    /// Timestamp
    pub timestamp: u64,
    /// Description
    pub description: String,
    /// Hash of this version's manifest
    pub manifest_hash: String,
}

impl Manifest {
    /// Create a new empty manifest
    pub fn new() -> Self {
        Self {
            format_version: 1,
            metadata: ArchiveMetadata::default(),
            files: Vec::new(),
            stats: CompressionStats::default(),
            multipart: None,
            version_history: Vec::new(),
        }
    }

    /// Create with specific version
    pub fn with_version(version: u16) -> Self {
        let mut manifest = Self::new();
        manifest.format_version = version;
        manifest
    }

    /// Add a file entry
    pub fn add_file(&mut self, entry: FileEntry) {
        if entry.is_directory {
            self.stats.directory_count += 1;
        } else if entry.is_symlink {
            self.stats.symlink_count += 1;
        } else {
            self.stats.file_count += 1;
            self.stats.original_size += entry.size;
        }
        self.files.push(entry);
    }

    /// Get file entry by path
    pub fn get_file(&self, path: &str) -> Option<&FileEntry> {
        self.files.iter().find(|f| f.path == path)
    }

    /// Get all files in a directory
    pub fn files_in_directory(&self, dir_path: &str) -> Vec<&FileEntry> {
        let prefix = if dir_path.ends_with('/') {
            dir_path.to_string()
        } else {
            format!("{}/", dir_path)
        };

        self.files
            .iter()
            .filter(|f| f.path.starts_with(&prefix))
            .collect()
    }

    /// Serialize manifest to JSON bytes
    pub fn to_json(&self) -> SpkResult<Vec<u8>> {
        serde_json::to_vec_pretty(self).map_err(SpkError::from)
    }

    /// Serialize manifest to compressed JSON
    pub fn to_compressed_json(&self) -> SpkResult<Vec<u8>> {
        let json = self.to_json()?;
        compress_zstd(&json)
    }

    /// Serialize manifest to CBOR bytes
    pub fn to_cbor(&self) -> SpkResult<Vec<u8>> {
        let mut buffer = Vec::new();
        ciborium::into_writer(self, &mut buffer)?;
        Ok(buffer)
    }

    /// Serialize manifest to compressed CBOR
    pub fn to_compressed_cbor(&self) -> SpkResult<Vec<u8>> {
        let cbor = self.to_cbor()?;
        compress_zstd(&cbor)
    }

    /// Parse manifest from JSON bytes
    pub fn from_json(data: &[u8]) -> SpkResult<Self> {
        serde_json::from_slice(data).map_err(SpkError::from)
    }

    /// Parse manifest from compressed JSON
    pub fn from_compressed_json(data: &[u8]) -> SpkResult<Self> {
        let json = decompress_zstd(data)?;
        Self::from_json(&json)
    }

    /// Parse manifest from CBOR bytes
    pub fn from_cbor(data: &[u8]) -> SpkResult<Self> {
        ciborium::from_reader(data).map_err(SpkError::from)
    }

    /// Parse manifest from compressed CBOR
    pub fn from_compressed_cbor(data: &[u8]) -> SpkResult<Self> {
        let cbor = decompress_zstd(data)?;
        Self::from_cbor(&cbor)
    }

    /// Update statistics
    pub fn update_stats(&mut self) {
        self.stats.file_count = 0;
        self.stats.directory_count = 0;
        self.stats.symlink_count = 0;
        self.stats.original_size = 0;

        for entry in &self.files {
            if entry.is_directory {
                self.stats.directory_count += 1;
            } else if entry.is_symlink {
                self.stats.symlink_count += 1;
            } else {
                self.stats.file_count += 1;
                self.stats.original_size += entry.size;
            }
        }

        self.stats.calculate_ratio();
    }

    /// Build directory tree structure (for V3 folder tree UI)
    pub fn build_tree(&self) -> DirectoryTree {
        let mut root = DirectoryTree::new_root();
        
        for entry in &self.files {
            root.insert(&entry.path, entry);
        }
        
        root
    }
}

impl Default for Manifest {
    fn default() -> Self {
        Self::new()
    }
}

/// Directory tree node for UI (V3)
#[derive(Debug, Clone)]
pub struct DirectoryTree {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub file_entry: Option<FileEntry>,
    pub children: Vec<DirectoryTree>,
}

impl DirectoryTree {
    pub fn new_root() -> Self {
        Self {
            name: String::new(),
            path: String::new(),
            is_directory: true,
            file_entry: None,
            children: Vec::new(),
        }
    }

    pub fn insert(&mut self, path: &str, entry: &FileEntry) {
        let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        self.insert_parts(&parts, entry);
    }

    fn insert_parts(&mut self, parts: &[&str], entry: &FileEntry) {
        if parts.is_empty() {
            return;
        }

        let name = parts[0];
        let remaining = &parts[1..];

        // Find or create child
        let child = self.children.iter_mut().find(|c| c.name == name);

        if remaining.is_empty() {
            // This is the final entry
            if let Some(child) = child {
                child.file_entry = Some(entry.clone());
                child.is_directory = entry.is_directory;
            } else {
                self.children.push(DirectoryTree {
                    name: name.to_string(),
                    path: entry.path.clone(),
                    is_directory: entry.is_directory,
                    file_entry: Some(entry.clone()),
                    children: Vec::new(),
                });
            }
        } else {
            // Need to traverse deeper
            if let Some(child) = child {
                child.insert_parts(remaining, entry);
            } else {
                let mut new_child = DirectoryTree {
                    name: name.to_string(),
                    path: parts[..1].join("/"),
                    is_directory: true,
                    file_entry: None,
                    children: Vec::new(),
                };
                new_child.insert_parts(remaining, entry);
                self.children.push(new_child);
            }
        }
    }

    /// Sort children by name (directories first)
    pub fn sort(&mut self) {
        self.children.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.cmp(&b.name),
            }
        });

        for child in &mut self.children {
            child.sort();
        }
    }
}

/// Compress data with zstd
fn compress_zstd(data: &[u8]) -> SpkResult<Vec<u8>> {
    let mut encoder = zstd::Encoder::new(Vec::new(), 3)?;
    encoder.write_all(data)?;
    encoder.finish().map_err(SpkError::from)
}

/// Decompress zstd data
fn decompress_zstd(data: &[u8]) -> SpkResult<Vec<u8>> {
    let mut decoder = zstd::Decoder::new(data)?;
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;
    Ok(decompressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_roundtrip_json() {
        let mut manifest = Manifest::new();
        manifest.add_file(FileEntry::new("test.txt".into(), 1024, 0o644));
        
        let json = manifest.to_json().unwrap();
        let parsed = Manifest::from_json(&json).unwrap();
        
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "test.txt");
    }

    #[test]
    fn test_manifest_roundtrip_cbor() {
        let mut manifest = Manifest::new();
        manifest.add_file(FileEntry::new("test.txt".into(), 1024, 0o644));
        
        let cbor = manifest.to_cbor().unwrap();
        let parsed = Manifest::from_cbor(&cbor).unwrap();
        
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "test.txt");
    }

    #[test]
    fn test_manifest_compressed() {
        let mut manifest = Manifest::new();
        for i in 0..100 {
            manifest.add_file(FileEntry::new(format!("file_{}.txt", i), 1024, 0o644));
        }
        
        let compressed = manifest.to_compressed_json().unwrap();
        let parsed = Manifest::from_compressed_json(&compressed).unwrap();
        
        assert_eq!(parsed.files.len(), 100);
        
        // Compressed should be smaller than uncompressed
        let uncompressed = manifest.to_json().unwrap();
        assert!(compressed.len() < uncompressed.len());
    }

    #[test]
    fn test_directory_tree() {
        let mut manifest = Manifest::new();
        manifest.add_file(FileEntry::new("a/b/c.txt".into(), 100, 0o644));
        manifest.add_file(FileEntry::new("a/b/d.txt".into(), 200, 0o644));
        manifest.add_file(FileEntry::new("a/e.txt".into(), 300, 0o644));
        
        let mut tree = manifest.build_tree();
        tree.sort();
        
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].name, "a");
        assert_eq!(tree.children[0].children.len(), 2);
    }

    #[test]
    fn test_stats_calculation() {
        let mut manifest = Manifest::new();
        manifest.add_file(FileEntry::new("file1.txt".into(), 1000, 0o644));
        manifest.add_file(FileEntry::new("file2.txt".into(), 2000, 0o644));
        manifest.add_file(FileEntry::directory("dir".into(), 0o755));
        
        assert_eq!(manifest.stats.file_count, 2);
        assert_eq!(manifest.stats.directory_count, 1);
        assert_eq!(manifest.stats.original_size, 3000);
    }
}
