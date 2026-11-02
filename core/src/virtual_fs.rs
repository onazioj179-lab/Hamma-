//! SPK V5 Virtual Filesystem
//!
//! Mount archives as virtual folders (FUSE/WebFS).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::reader::SpkReader;
use crate::utils::error::{SpkError, SpkResult};

/// Virtual filesystem node types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VfsNode {
    /// Directory node
    Directory {
        name: String,
        children: Vec<String>,
        created: u64,
        modified: u64,
    },
    /// File node
    File {
        name: String,
        size: u64,
        created: u64,
        modified: u64,
        chunk_start: u64,
        chunk_count: u32,
        /// Cached content (optional)
        cache: Option<Vec<u8>>,
    },
    /// Symlink node
    Symlink {
        name: String,
        target: String,
    },
}

impl VfsNode {
    /// Get node name
    pub fn name(&self) -> &str {
        match self {
            VfsNode::Directory { name, .. } => name,
            VfsNode::File { name, .. } => name,
            VfsNode::Symlink { name, .. } => name,
        }
    }

    /// Check if directory
    pub fn is_dir(&self) -> bool {
        matches!(self, VfsNode::Directory { .. })
    }

    /// Check if file
    pub fn is_file(&self) -> bool {
        matches!(self, VfsNode::File { .. })
    }

    /// Get size (0 for directories)
    pub fn size(&self) -> u64 {
        match self {
            VfsNode::File { size, .. } => *size,
            _ => 0,
        }
    }
}

/// Virtual filesystem statistics
#[derive(Debug, Clone, Default)]
pub struct VfsStat {
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_size: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
}

/// Virtual filesystem for SPK archives
pub struct VirtualFs {
    /// Archive path
    archive_path: PathBuf,
    /// Node index (path -> node)
    nodes: HashMap<String, VfsNode>,
    /// Root children
    root_children: Vec<String>,
    /// Read cache
    cache: Arc<RwLock<VfsCache>>,
    /// Statistics
    stats: Arc<RwLock<VfsStat>>,
    /// Configuration
    config: VfsConfig,
}

/// VFS configuration
#[derive(Debug, Clone)]
pub struct VfsConfig {
    /// Maximum cache size in bytes
    pub max_cache_size: usize,
    /// Cache entry TTL
    pub cache_ttl: Duration,
    /// Enable read-ahead
    pub read_ahead: bool,
    /// Read-ahead size
    pub read_ahead_size: usize,
}

impl Default for VfsConfig {
    fn default() -> Self {
        Self {
            max_cache_size: 256 * 1024 * 1024, // 256 MB
            cache_ttl: Duration::from_secs(300), // 5 minutes
            read_ahead: true,
            read_ahead_size: 1024 * 1024, // 1 MB
        }
    }
}

/// VFS cache
#[derive(Debug, Default)]
pub struct VfsCache {
    /// Cached file contents
    entries: HashMap<String, CacheEntry>,
    /// Current cache size
    current_size: usize,
}

/// Cache entry
#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub data: Vec<u8>,
    pub timestamp: SystemTime,
    pub access_count: u64,
}

impl VfsCache {
    /// Get cached data
    pub fn get(&mut self, path: &str, ttl: Duration) -> Option<Vec<u8>> {
        if let Some(entry) = self.entries.get_mut(path) {
            if entry.timestamp.elapsed().unwrap_or(Duration::MAX) < ttl {
                entry.access_count += 1;
                entry.timestamp = SystemTime::now();
                return Some(entry.data.clone());
            }
            // Expired, remove it
            let size = entry.data.len();
            self.entries.remove(path);
            self.current_size -= size;
        }
        None
    }

    /// Put data in cache
    pub fn put(&mut self, path: String, data: Vec<u8>, max_size: usize) {
        let data_size = data.len();
        
        // Evict if necessary
        while self.current_size + data_size > max_size && !self.entries.is_empty() {
            self.evict_lru();
        }

        if data_size <= max_size {
            self.entries.insert(path, CacheEntry {
                data,
                timestamp: SystemTime::now(),
                access_count: 1,
            });
            self.current_size += data_size;
        }
    }

    /// Evict least recently used entry
    fn evict_lru(&mut self) {
        if let Some((path, _)) = self.entries.iter()
            .min_by_key(|(_, e)| e.timestamp)
            .map(|(p, e)| (p.clone(), e.clone()))
        {
            if let Some(entry) = self.entries.remove(&path) {
                self.current_size -= entry.data.len();
            }
        }
    }

    /// Clear all cache
    pub fn clear(&mut self) {
        self.entries.clear();
        self.current_size = 0;
    }
}

impl VirtualFs {
    /// Create virtual filesystem from archive
    pub fn new<P: AsRef<Path>>(archive_path: P, config: VfsConfig) -> SpkResult<Self> {
        let mut vfs = Self {
            archive_path: archive_path.as_ref().to_path_buf(),
            nodes: HashMap::new(),
            root_children: Vec::new(),
            cache: Arc::new(RwLock::new(VfsCache::default())),
            stats: Arc::new(RwLock::new(VfsStat::default())),
            config,
        };

        vfs.build_tree()?;
        Ok(vfs)
    }

    /// Build directory tree from manifest
    fn build_tree(&mut self) -> SpkResult<()> {
        let file = std::fs::File::open(&self.archive_path)?;
        let mut spk_reader = SpkReader::new(file)?;
        spk_reader.read_manifest()?;
        let manifest = spk_reader.get_manifest()
            .ok_or_else(|| SpkError::Internal("No manifest loaded".into()))?;

        let mut total_files = 0u64;
        let mut total_dirs = 0u64;
        let mut total_size = 0u64;

        // Create directory nodes first
        let mut all_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();
        
        for entry in &manifest.files {
            let path = Path::new(&entry.path);
            let mut current = PathBuf::new();
            
            for component in path.parent().unwrap_or(Path::new("")).components() {
                current.push(component);
                all_dirs.insert(current.to_string_lossy().to_string().replace('\\', "/"));
            }
        }

        // Create directory nodes
        for dir in &all_dirs {
            let name = Path::new(dir)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            
            self.nodes.insert(dir.clone(), VfsNode::Directory {
                name,
                children: Vec::new(),
                created: 0,
                modified: 0,
            });
            total_dirs += 1;
        }

        // Create file nodes and populate directory children
        for entry in &manifest.files {
            let path = entry.path.replace('\\', "/");
            let name = Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            self.nodes.insert(path.clone(), VfsNode::File {
                name: name.clone(),
                size: entry.size,
                created: entry.created.unwrap_or(0),
                modified: entry.modified,
                chunk_start: entry.chunk_start,
                chunk_count: entry.chunk_count,
                cache: None,
            });

            total_files += 1;
            total_size += entry.size;

            // Add to parent's children
            if let Some(parent) = Path::new(&path).parent() {
                let parent_str = parent.to_string_lossy().to_string().replace('\\', "/");
                if parent_str.is_empty() {
                    self.root_children.push(path);
                } else if let Some(VfsNode::Directory { children, .. }) = self.nodes.get_mut(&parent_str) {
                    children.push(path);
                }
            } else {
                self.root_children.push(path);
            }
        }

        // Add directories to their parents
        for dir in &all_dirs {
            let dir_path = Path::new(dir);
            if let Some(parent) = dir_path.parent() {
                let parent_str = parent.to_string_lossy().to_string().replace('\\', "/");
                if parent_str.is_empty() {
                    if !self.root_children.contains(dir) {
                        self.root_children.push(dir.clone());
                    }
                } else if let Some(VfsNode::Directory { children, .. }) = self.nodes.get_mut(&parent_str) {
                    if !children.contains(dir) {
                        children.push(dir.clone());
                    }
                }
            }
        }

        // Update stats
        {
            let mut stats = futures::executor::block_on(self.stats.write());
            stats.total_files = total_files;
            stats.total_dirs = total_dirs;
            stats.total_size = total_size;
        }

        Ok(())
    }

    /// Get node at path
    pub fn get_node(&self, path: &str) -> Option<&VfsNode> {
        let normalized = path.trim_start_matches('/').replace('\\', "/");
        if normalized.is_empty() {
            return None; // Root is special
        }
        self.nodes.get(&normalized)
    }

    /// List directory contents
    pub fn read_dir(&self, path: &str) -> SpkResult<Vec<&VfsNode>> {
        let normalized = path.trim_start_matches('/').replace('\\', "/");
        
        if normalized.is_empty() {
            // Root directory
            return Ok(self.root_children.iter()
                .filter_map(|p| self.nodes.get(p))
                .collect());
        }

        match self.nodes.get(&normalized) {
            Some(VfsNode::Directory { children, .. }) => {
                Ok(children.iter()
                    .filter_map(|p| self.nodes.get(p))
                    .collect())
            }
            Some(_) => Err(SpkError::VfsError("Not a directory".into())),
            None => Err(SpkError::VfsError(format!("Path not found: {}", path))),
        }
    }

    /// Read file contents
    pub async fn read_file(&self, path: &str) -> SpkResult<Vec<u8>> {
        let normalized = path.trim_start_matches('/').replace('\\', "/");
        
        // Check cache first
        {
            let mut cache = self.cache.write().await;
            if let Some(data) = cache.get(&normalized, self.config.cache_ttl) {
                let mut stats = self.stats.write().await;
                stats.cache_hits += 1;
                return Ok(data);
            }
        }

        // Cache miss, read from archive
        {
            let mut stats = self.stats.write().await;
            stats.cache_misses += 1;
        }

        let node = self.nodes.get(&normalized)
            .ok_or_else(|| SpkError::VfsError(format!("File not found: {}", path)))?;

        let (chunk_start, chunk_count) = match node {
            VfsNode::File { chunk_start, chunk_count, .. } => (*chunk_start, *chunk_count),
            _ => return Err(SpkError::VfsError("Not a file".into())),
        };

        // Read from archive
        let data = self.read_chunks(chunk_start, chunk_count)?;

        // Cache the result
        {
            let mut cache = self.cache.write().await;
            cache.put(normalized, data.clone(), self.config.max_cache_size);
        }

        Ok(data)
    }

    /// Read chunks from archive
    fn read_chunks(&self, chunk_start: u64, chunk_count: u32) -> SpkResult<Vec<u8>> {
        let file = std::fs::File::open(&self.archive_path)?;
        let mut spk_reader = SpkReader::new(file)?;
        spk_reader.read_manifest()?;
        
        let mut data = Vec::new();
        for i in 0..chunk_count {
            let chunk_data = spk_reader.read_chunk((chunk_start as usize) + (i as usize))?;
            data.extend(chunk_data);
        }
        
        Ok(data)
    }

    /// Get file attributes
    pub fn get_attr(&self, path: &str) -> SpkResult<VfsAttr> {
        let normalized = path.trim_start_matches('/').replace('\\', "/");
        
        if normalized.is_empty() {
            // Root directory
            return Ok(VfsAttr {
                size: 0,
                is_dir: true,
                is_file: false,
                is_symlink: false,
                created: 0,
                modified: 0,
                accessed: 0,
            });
        }

        let node = self.nodes.get(&normalized)
            .ok_or_else(|| SpkError::VfsError(format!("Path not found: {}", path)))?;

        Ok(match node {
            VfsNode::Directory { created, modified, .. } => VfsAttr {
                size: 0,
                is_dir: true,
                is_file: false,
                is_symlink: false,
                created: *created,
                modified: *modified,
                accessed: *modified,
            },
            VfsNode::File { size, created, modified, .. } => VfsAttr {
                size: *size,
                is_dir: false,
                is_file: true,
                is_symlink: false,
                created: *created,
                modified: *modified,
                accessed: *modified,
            },
            VfsNode::Symlink { .. } => VfsAttr {
                size: 0,
                is_dir: false,
                is_file: false,
                is_symlink: true,
                created: 0,
                modified: 0,
                accessed: 0,
            },
        })
    }

    /// Get statistics
    pub async fn stats(&self) -> VfsStat {
        self.stats.read().await.clone()
    }

    /// Clear cache
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
    }

    /// Check if path exists
    pub fn exists(&self, path: &str) -> bool {
        let normalized = path.trim_start_matches('/').replace('\\', "/");
        normalized.is_empty() || self.nodes.contains_key(&normalized)
    }
}

/// File attributes
#[derive(Debug, Clone)]
pub struct VfsAttr {
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub created: u64,
    pub modified: u64,
    pub accessed: u64,
}

/// WebFS adapter for browser-based virtual filesystem
#[cfg(feature = "web")]
pub mod web {
    use super::*;
    use wasm_bindgen::prelude::*;

    /// WebFS handle for JavaScript
    #[wasm_bindgen]
    pub struct WebVfs {
        inner: Arc<VirtualFs>,
    }

    #[wasm_bindgen]
    impl WebVfs {
        /// List directory
        #[wasm_bindgen(js_name = readDir)]
        pub fn read_dir(&self, path: &str) -> Result<JsValue, JsValue> {
            let entries = self.inner.read_dir(path)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            
            let names: Vec<String> = entries.iter()
                .map(|n| n.name().to_string())
                .collect();
            
            serde_wasm_bindgen::to_value(&names)
                .map_err(|e| JsValue::from_str(&e.to_string()))
        }

        /// Check if path is directory
        #[wasm_bindgen(js_name = isDir)]
        pub fn is_dir(&self, path: &str) -> bool {
            self.inner.get_node(path)
                .map(|n| n.is_dir())
                .unwrap_or(false)
        }

        /// Check if path exists
        pub fn exists(&self, path: &str) -> bool {
            self.inner.exists(path)
        }

        /// Get file size
        #[wasm_bindgen(js_name = getSize)]
        pub fn get_size(&self, path: &str) -> u64 {
            self.inner.get_node(path)
                .map(|n| n.size())
                .unwrap_or(0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vfs_cache() {
        let mut cache = VfsCache::default();
        let max_size = 1024;
        
        cache.put("file1".into(), vec![1, 2, 3], max_size);
        assert!(cache.get("file1", Duration::from_secs(60)).is_some());
        
        cache.put("file2".into(), vec![4, 5, 6], max_size);
        assert!(cache.get("file2", Duration::from_secs(60)).is_some());
    }

    #[test]
    fn test_vfs_cache_eviction() {
        let mut cache = VfsCache::default();
        let max_size = 10;
        
        cache.put("file1".into(), vec![0; 5], max_size);
        cache.put("file2".into(), vec![0; 5], max_size);
        
        // This should evict file1 (LRU)
        cache.put("file3".into(), vec![0; 5], max_size);
        
        assert!(cache.get("file1", Duration::from_secs(60)).is_none());
    }

    #[test]
    fn test_vfs_attr() {
        let attr = VfsAttr {
            size: 1024,
            is_dir: false,
            is_file: true,
            is_symlink: false,
            created: 0,
            modified: 0,
            accessed: 0,
        };
        
        assert!(attr.is_file);
        assert!(!attr.is_dir);
        assert_eq!(attr.size, 1024);
    }

    #[test]
    fn test_vfs_node() {
        let file = VfsNode::File {
            name: "test.txt".into(),
            size: 100,
            created: 0,
            modified: 0,
            chunk_start: 0,
            chunk_count: 1,
            cache: None,
        };
        
        assert_eq!(file.name(), "test.txt");
        assert!(file.is_file());
        assert_eq!(file.size(), 100);
        
        let dir = VfsNode::Directory {
            name: "folder".into(),
            children: vec![],
            created: 0,
            modified: 0,
        };
        
        assert!(dir.is_dir());
        assert_eq!(dir.size(), 0);
    }
}
