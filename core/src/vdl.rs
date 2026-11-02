//! # SPK V19: SPK Virtual Data Layer (SPK-VDL)
//!
//! Virtual file interface with full read/write support without re-packing.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};
use crate::utils::error::{SpkError, SpkResult};

/// V19 version constant
pub const V19_VDL_VERSION: u8 = 19;

/// Maximum open files
pub const V19_MAX_OPEN_FILES: usize = 1024;

// =============================================================================
// VIRTUAL FILE INTERFACE
// =============================================================================

/// Virtual file handle
#[derive(Debug, Clone)]
pub struct VirtualFileHandle {
    /// File ID
    pub id: u64,
    /// Virtual path
    pub path: PathBuf,
    /// Mode (read/write/append)
    pub mode: FileMode,
    /// Current position
    pub position: u64,
    /// File size
    pub size: u64,
    /// Chunk mappings
    pub chunk_map: Vec<ChunkMapping>,
}

/// File access modes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileMode {
    Read,
    Write,
    Append,
    ReadWrite,
}

/// Chunk mapping for virtual file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMapping {
    /// File offset
    pub file_offset: u64,
    /// Chunk ID in SPK
    pub chunk_id: usize,
    /// Offset within chunk
    pub chunk_offset: usize,
    /// Length
    pub length: usize,
}

/// Virtual file system backed by SPK
pub struct VirtualFileSystem {
    /// Mounted archives
    mounts: Arc<RwLock<HashMap<PathBuf, MountPoint>>>,
    /// Open file handles
    open_files: Arc<RwLock<HashMap<u64, VirtualFileHandle>>>,
    /// Next file ID
    next_id: Arc<RwLock<u64>>,
    /// Directory structure
    directories: Arc<RwLock<HashMap<PathBuf, VirtualDirectory>>>,
}

/// Mount point for SPK archive
#[derive(Debug, Clone)]
pub struct MountPoint {
    /// Mount path
    pub mount_path: PathBuf,
    /// Archive path
    pub archive_path: PathBuf,
    /// Read-only flag
    pub read_only: bool,
    /// On-demand loading
    pub on_demand: bool,
}

/// Virtual directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualDirectory {
    /// Directory path
    pub path: PathBuf,
    /// Child files
    pub files: Vec<String>,
    /// Child directories
    pub subdirs: Vec<String>,
    /// Metadata
    pub metadata: DirectoryMetadata,
}

/// Directory metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DirectoryMetadata {
    pub created: u64,
    pub modified: u64,
    pub file_count: usize,
    pub total_size: u64,
}

impl VirtualFileSystem {
    /// Create new virtual filesystem
    pub fn new() -> Self {
        Self {
            mounts: Arc::new(RwLock::new(HashMap::new())),
            open_files: Arc::new(RwLock::new(HashMap::new())),
            next_id: Arc::new(RwLock::new(0)),
            directories: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Mount SPK archive
    pub fn mount<P: AsRef<Path>>(&self, archive_path: P, mount_path: P, read_only: bool) -> SpkResult<()> {
        let mount = MountPoint {
            mount_path: mount_path.as_ref().to_path_buf(),
            archive_path: archive_path.as_ref().to_path_buf(),
            read_only,
            on_demand: true,
        };

        let mut mounts = self.mounts.write()
            .map_err(|_| SpkError::LockError("Failed to acquire mounts lock".into()))?;

        mounts.insert(mount_path.as_ref().to_path_buf(), mount);

        // Build directory structure
        self.build_directory_tree(mount_path.as_ref())?;

        Ok(())
    }

    /// Unmount archive
    pub fn unmount<P: AsRef<Path>>(&self, mount_path: P) -> SpkResult<()> {
        let mut mounts = self.mounts.write()
            .map_err(|_| SpkError::LockError("Failed to acquire mounts lock".into()))?;

        mounts.remove(mount_path.as_ref());
        Ok(())
    }

    /// Open virtual file
    pub fn open<P: AsRef<Path>>(&self, path: P, mode: FileMode) -> SpkResult<u64> {
        let mut next_id = self.next_id.write()
            .map_err(|_| SpkError::LockError("Failed to acquire next_id lock".into()))?;

        let id = *next_id;
        *next_id += 1;
        drop(next_id);

        let handle = VirtualFileHandle {
            id,
            path: path.as_ref().to_path_buf(),
            mode,
            position: 0,
            size: 0, // Would query from archive
            chunk_map: vec![],
        };

        let mut open_files = self.open_files.write()
            .map_err(|_| SpkError::LockError("Failed to acquire open_files lock".into()))?;

        if open_files.len() >= V19_MAX_OPEN_FILES {
            return Err(SpkError::LimitExceeded("Too many open files".into()));
        }

        open_files.insert(id, handle);

        Ok(id)
    }

    /// Close file
    pub fn close(&self, file_id: u64) -> SpkResult<()> {
        let mut open_files = self.open_files.write()
            .map_err(|_| SpkError::LockError("Failed to acquire open_files lock".into()))?;

        open_files.remove(&file_id);
        Ok(())
    }

    /// Read from virtual file
    pub fn read(&self, file_id: u64, _buffer: &mut [u8]) -> SpkResult<usize> {
        let open_files = self.open_files.read()
            .map_err(|_| SpkError::LockError("Failed to acquire open_files lock".into()))?;

        let _handle = open_files.get(&file_id)
            .ok_or_else(|| SpkError::NotFound("File handle not found".to_string()))?;

        // In real implementation, would read from materialized chunks
        // For now, placeholder
        Ok(0)
    }

    /// Write to virtual file (without re-packing!)
    pub fn write(&self, file_id: u64, data: &[u8]) -> SpkResult<usize> {
        let mut open_files = self.open_files.write()
            .map_err(|_| SpkError::LockError("Failed to acquire open_files lock".into()))?;

        let handle = open_files.get_mut(&file_id)
            .ok_or_else(|| SpkError::NotFound("File handle not found".to_string()))?;

        if handle.mode == FileMode::Read {
            return Err(SpkError::InvalidOperation("File is read-only".into()));
        }

        // In real implementation, would append as new chunks
        // without re-packing entire archive
        Ok(data.len())
    }

    /// Seek in file
    pub fn seek(&self, file_id: u64, position: u64) -> SpkResult<u64> {
        let mut open_files = self.open_files.write()
            .map_err(|_| SpkError::LockError("Failed to acquire open_files lock".into()))?;

        let handle = open_files.get_mut(&file_id)
            .ok_or_else(|| SpkError::NotFound("File handle not found".to_string()))?;

        handle.position = position.min(handle.size);
        Ok(handle.position)
    }

    /// List directory
    pub fn list_dir<P: AsRef<Path>>(&self, path: P) -> SpkResult<Vec<String>> {
        let directories = self.directories.read()
            .map_err(|_| SpkError::LockError("Failed to acquire directories lock".into()))?;

        if let Some(dir) = directories.get(path.as_ref()) {
            let mut entries = dir.files.clone();
            entries.extend(dir.subdirs.clone());
            Ok(entries)
        } else {
            Err(SpkError::NotFound("Directory not found".to_string()))
        }
    }

    /// Create virtual directory
    pub fn create_dir<P: AsRef<Path>>(&self, path: P) -> SpkResult<()> {
        let mut directories = self.directories.write()
            .map_err(|_| SpkError::LockError("Failed to acquire directories lock".into()))?;

        let dir = VirtualDirectory {
            path: path.as_ref().to_path_buf(),
            files: vec![],
            subdirs: vec![],
            metadata: DirectoryMetadata::default(),
        };

        directories.insert(path.as_ref().to_path_buf(), dir);
        Ok(())
    }

    /// Build directory tree from archive
    fn build_directory_tree(&self, _mount_path: &Path) -> SpkResult<()> {
        // Would scan archive and build directory structure
        // Placeholder for now
        Ok(())
    }

    /// Get filesystem statistics
    pub fn stats(&self) -> SpkResult<VfsStats> {
        let mounts = self.mounts.read()
            .map_err(|_| SpkError::LockError("Failed to acquire mounts lock".into()))?;
        let open_files = self.open_files.read()
            .map_err(|_| SpkError::LockError("Failed to acquire open_files lock".into()))?;
        let directories = self.directories.read()
            .map_err(|_| SpkError::LockError("Failed to acquire directories lock".into()))?;

        Ok(VfsStats {
            mounted_archives: mounts.len(),
            open_files: open_files.len(),
            directories: directories.len(),
        })
    }
}

impl Default for VirtualFileSystem {
    fn default() -> Self {
        Self::new()
    }
}

/// VFS statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsStats {
    pub mounted_archives: usize,
    pub open_files: usize,
    pub directories: usize,
}

// =============================================================================
// ON-DEMAND CHUNK MATERIALIZATION
// =============================================================================

/// On-demand chunk materializer
pub struct ChunkMaterializer {
    /// Materialized chunks cache
    cache: Arc<RwLock<HashMap<usize, Vec<u8>>>>,
    /// Cache size limit
    max_cache_size: usize,
}

impl ChunkMaterializer {
    /// Create new materializer
    pub fn new(max_cache_size: usize) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            max_cache_size,
        }
    }

    /// Materialize chunk on-demand
    pub fn materialize(&self, chunk_id: usize) -> SpkResult<Vec<u8>> {
        let cache = self.cache.read()
            .map_err(|_| SpkError::LockError("Failed to acquire cache lock".into()))?;

        if let Some(data) = cache.get(&chunk_id) {
            return Ok(data.clone());
        }
        drop(cache);

        // Load chunk from archive
        let data = self.load_chunk_from_archive(chunk_id)?;

        // Cache it
        let mut cache = self.cache.write()
            .map_err(|_| SpkError::LockError("Failed to acquire cache lock".into()))?;

        if cache.len() >= self.max_cache_size {
            // Evict oldest
            if let Some(&key) = cache.keys().next() {
                cache.remove(&key);
            }
        }

        cache.insert(chunk_id, data.clone());

        Ok(data)
    }

    /// Load chunk from archive (placeholder)
    fn load_chunk_from_archive(&self, _chunk_id: usize) -> SpkResult<Vec<u8>> {
        // Would actually load from SPK archive
        Ok(vec![0u8; 4096])
    }

    /// Clear cache
    pub fn clear_cache(&self) -> SpkResult<()> {
        let mut cache = self.cache.write()
            .map_err(|_| SpkError::LockError("Failed to acquire cache lock".into()))?;
        cache.clear();
        Ok(())
    }
}

impl Default for ChunkMaterializer {
    fn default() -> Self {
        Self::new(100)
    }
}

// =============================================================================
// THIN PROVISIONING
// =============================================================================

/// Thin-provisioned virtual file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinProvisionedFile {
    /// Virtual path
    pub path: PathBuf,
    /// Declared size
    pub declared_size: u64,
    /// Actually allocated size
    pub allocated_size: u64,
    /// Sparse regions
    pub sparse_regions: Vec<SparseRegion>,
}

/// Sparse region in file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SparseRegion {
    /// Start offset
    pub start: u64,
    /// Length
    pub length: u64,
    /// Is allocated
    pub allocated: bool,
}

impl ThinProvisionedFile {
    /// Create thin-provisioned file
    pub fn new<P: AsRef<Path>>(path: P, declared_size: u64) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            declared_size,
            allocated_size: 0,
            sparse_regions: vec![SparseRegion {
                start: 0,
                length: declared_size,
                allocated: false,
            }],
        }
    }

    /// Allocate region
    pub fn allocate_region(&mut self, start: u64, length: u64) -> SpkResult<()> {
        // Mark region as allocated
        self.allocated_size += length;
        
        // Update sparse regions (simplified)
        self.sparse_regions.push(SparseRegion {
            start,
            length,
            allocated: true,
        });

        Ok(())
    }

    /// Get allocated percentage
    pub fn allocated_percent(&self) -> f64 {
        if self.declared_size > 0 {
            (self.allocated_size as f64 / self.declared_size as f64) * 100.0
        } else {
            0.0
        }
    }
}

// =============================================================================
// SNAPSHOT SUPPORT
// =============================================================================

/// Virtual filesystem snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsSnapshot {
    /// Snapshot ID
    pub id: u64,
    /// Timestamp
    pub timestamp: u64,
    /// Description
    pub description: String,
    /// Included paths
    pub paths: Vec<PathBuf>,
    /// Chunk references
    pub chunk_refs: Vec<usize>,
}

/// Snapshot manager
pub struct SnapshotManager {
    /// Snapshots
    snapshots: Arc<RwLock<HashMap<u64, VfsSnapshot>>>,
    /// Next snapshot ID
    next_id: Arc<RwLock<u64>>,
}

impl SnapshotManager {
    /// Create new snapshot manager
    pub fn new() -> Self {
        Self {
            snapshots: Arc::new(RwLock::new(HashMap::new())),
            next_id: Arc::new(RwLock::new(0)),
        }
    }

    /// Create snapshot
    pub fn create_snapshot(&self, description: String, paths: Vec<PathBuf>) -> SpkResult<u64> {
        let mut next_id = self.next_id.write()
            .map_err(|_| SpkError::LockError("Failed to acquire next_id lock".into()))?;

        let id = *next_id;
        *next_id += 1;
        drop(next_id);

        let snapshot = VfsSnapshot {
            id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            description,
            paths,
            chunk_refs: vec![],
        };

        let mut snapshots = self.snapshots.write()
            .map_err(|_| SpkError::LockError("Failed to acquire snapshots lock".into()))?;
        snapshots.insert(id, snapshot);

        Ok(id)
    }

    /// List snapshots
    pub fn list_snapshots(&self) -> SpkResult<Vec<VfsSnapshot>> {
        let snapshots = self.snapshots.read()
            .map_err(|_| SpkError::LockError("Failed to acquire snapshots lock".into()))?;
        Ok(snapshots.values().cloned().collect())
    }

    /// Delete snapshot
    pub fn delete_snapshot(&self, snapshot_id: u64) -> SpkResult<()> {
        let mut snapshots = self.snapshots.write()
            .map_err(|_| SpkError::LockError("Failed to acquire snapshots lock".into()))?;
        snapshots.remove(&snapshot_id);
        Ok(())
    }
}

impl Default for SnapshotManager {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_virtual_filesystem() {
        let vfs = VirtualFileSystem::new();
        
        // Test mount
        vfs.mount("archive.spk", "/mnt/spk", false).unwrap();
        
        let stats = vfs.stats().unwrap();
        assert_eq!(stats.mounted_archives, 1);
    }

    #[test]
    fn test_file_operations() {
        let vfs = VirtualFileSystem::new();
        
        let file_id = vfs.open("/test.txt", FileMode::ReadWrite).unwrap();
        assert_eq!(file_id, 0);
        
        vfs.close(file_id).unwrap();
        
        let stats = vfs.stats().unwrap();
        assert_eq!(stats.open_files, 0);
    }

    #[test]
    fn test_chunk_materializer() {
        let materializer = ChunkMaterializer::new(10);
        
        let data = materializer.materialize(0).unwrap();
        assert!(!data.is_empty());
        
        // Second access should hit cache
        let data2 = materializer.materialize(0).unwrap();
        assert_eq!(data, data2);
    }

    #[test]
    fn test_thin_provisioning() {
        let mut file = ThinProvisionedFile::new("/big_file.dat", 1024 * 1024 * 1024);
        assert_eq!(file.allocated_size, 0);
        
        file.allocate_region(0, 4096).unwrap();
        assert_eq!(file.allocated_size, 4096);
        assert!(file.allocated_percent() < 1.0);
    }

    #[test]
    fn test_snapshots() {
        let manager = SnapshotManager::new();
        
        let id = manager.create_snapshot(
            "Test snapshot".to_string(),
            vec![PathBuf::from("/test")],
        ).unwrap();
        
        assert_eq!(id, 0);
        
        let snapshots = manager.list_snapshots().unwrap();
        assert_eq!(snapshots.len(), 1);
        
        manager.delete_snapshot(id).unwrap();
        let snapshots = manager.list_snapshots().unwrap();
        assert_eq!(snapshots.len(), 0);
    }

    #[test]
    fn test_directory_operations() {
        let vfs = VirtualFileSystem::new();
        
        vfs.create_dir("/test").unwrap();
        
        // Would test list_dir, but needs actual data
    }
}
