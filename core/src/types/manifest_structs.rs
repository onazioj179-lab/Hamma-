//! Manifest structure types
//!
//! Extended manifest types for V3-V5 features.

use serde::{Deserialize, Serialize};

/// V3 Preview metadata for files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewMetadata {
    /// MIME type
    pub mime_type: String,
    /// Preview data (thumbnail, first bytes, etc.)
    pub preview_data: Vec<u8>,
    /// Preview type
    pub preview_type: PreviewType,
    /// Dimensions for images
    pub dimensions: Option<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PreviewType {
    /// Thumbnail image (for images/videos)
    Thumbnail,
    /// First N bytes of text
    TextPreview,
    /// File icon based on type
    Icon,
    /// No preview available
    None,
}

impl Default for PreviewType {
    fn default() -> Self {
        Self::None
    }
}

/// V3 Partial extraction request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionRequest {
    /// Files to extract (paths)
    pub files: Vec<String>,
    /// Output directory
    pub output_dir: String,
    /// Preserve directory structure
    pub preserve_structure: bool,
    /// Overwrite existing files
    pub overwrite: bool,
    /// Skip on error
    pub skip_on_error: bool,
}

impl ExtractionRequest {
    pub fn new(output_dir: String) -> Self {
        Self {
            files: Vec::new(),
            output_dir,
            preserve_structure: true,
            overwrite: false,
            skip_on_error: false,
        }
    }

    pub fn add_file(&mut self, path: String) {
        self.files.push(path);
    }

    pub fn add_directory(&mut self, dir_path: String) {
        self.files.push(format!("{}/**", dir_path));
    }
}

/// V3 Extraction result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionResult {
    /// Successfully extracted files
    pub extracted: Vec<String>,
    /// Files that failed
    pub failed: Vec<ExtractionError>,
    /// Total bytes extracted
    pub bytes_extracted: u64,
    /// Time taken in milliseconds
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionError {
    pub path: String,
    pub error: String,
}

/// V5 Version entry for versioned archives
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    /// Version number
    pub version: u32,
    /// Timestamp
    pub timestamp: u64,
    /// Author/creator
    pub author: Option<String>,
    /// Change description
    pub description: String,
    /// Parent version (for branching)
    pub parent_version: Option<u32>,
    /// Files changed in this version
    pub changed_files: Vec<VersionChange>,
    /// Manifest hash for this version
    pub manifest_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionChange {
    pub path: String,
    pub change_type: ChangeType,
    pub old_hash: Option<String>,
    pub new_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed { old_path: String },
}

/// V5 Access control entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessControl {
    /// List of access rules
    pub rules: Vec<AccessRule>,
    /// Default permission level
    pub default_permission: Permission,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRule {
    /// User or group identifier
    pub principal: String,
    /// Permission level
    pub permission: Permission,
    /// Path pattern (glob)
    pub path_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Permission {
    None,
    Read,
    Write,
    Admin,
}

impl Default for Permission {
    fn default() -> Self {
        Self::Read
    }
}

impl Default for AccessControl {
    fn default() -> Self {
        Self {
            rules: Vec::new(),
            default_permission: Permission::Read,
        }
    }
}

/// V5 Version info for manifest
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VersionInfo {
    /// Current version number
    pub current_version: u32,
    /// Total version count
    pub version_count: u32,
    /// Latest tag
    pub latest_tag: String,
    /// Creation timestamp
    pub created: u64,
    /// Last modified timestamp
    pub modified: u64,
}

/// Cloud sync metadata (V5)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSyncMetadata {
    /// Cloud provider
    pub provider: String,
    /// Bucket/container name
    pub bucket: String,
    /// Object key/path
    pub object_key: String,
    /// Last sync timestamp
    pub last_sync: u64,
    /// Sync state
    pub state: SyncState,
    /// Remote etag/version
    pub remote_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncState {
    Synced,
    LocalChanges,
    RemoteChanges,
    Conflict,
    Unknown,
}

impl Default for SyncState {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Virtual filesystem mount info (V5)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualMountInfo {
    /// Mount point path
    pub mount_point: String,
    /// Mount options
    pub options: MountOptions,
    /// Mounted timestamp
    pub mounted_at: Option<u64>,
    /// Process ID that created the mount
    pub mount_pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MountOptions {
    /// Read-only mount
    pub read_only: bool,
    /// Allow other users
    pub allow_other: bool,
    /// Auto-unmount on idle
    pub auto_unmount: bool,
    /// Idle timeout in seconds
    pub idle_timeout: Option<u64>,
    /// Cache strategy
    pub cache_strategy: CacheStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum CacheStrategy {
    /// No caching
    None,
    /// Cache reads only
    #[default]
    ReadOnly,
    /// Full caching (for read-write mounts)
    Full,
}
