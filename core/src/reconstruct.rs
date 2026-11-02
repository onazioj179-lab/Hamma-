//! Reconstruction Engine - Byte-Perfect File Recovery from Snapshots
//!
//! Resolves the chunk graph, fetches chunks from store, and reassembles files.
//!
//! ## Reconstruction Flow
//! ```text
//! 1. Load snapshot file (small, metadata only)
//! 2. Parse file manifest
//! 3. For each file to restore:
//!    a. Get chunk list from manifest
//!    b. Fetch each chunk from store (parallel)
//!    c. Decompress chunks
//!    d. Apply deltas if any
//!    e. Concatenate in order
//!    f. Verify file hash
//! 4. Set permissions/timestamps
//! ```

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::dedup_store::{DedupStore, BLAKE3_SIZE};
use crate::snapshot::{FileEntry, Snapshot, SnapshotError};

/// Reconstruction configuration
#[derive(Debug, Clone)]
pub struct ReconstructConfig {
    /// Number of parallel chunk fetches
    pub parallel_fetches: usize,
    /// Verify file hashes after reconstruction
    pub verify_integrity: bool,
    /// Restore file permissions (Unix only)
    pub restore_permissions: bool,
    /// Restore timestamps
    pub restore_timestamps: bool,
    /// Overwrite existing files
    pub overwrite: bool,
    /// Buffer size for writing
    pub buffer_size: usize,
}

impl Default for ReconstructConfig {
    fn default() -> Self {
        Self {
            parallel_fetches: num_cpus::get().min(8),
            verify_integrity: true,
            restore_permissions: true,
            restore_timestamps: true,
            overwrite: false,
            buffer_size: 4 * 1024 * 1024, // 4MB
        }
    }
}

/// Reconstruction progress
#[derive(Debug, Clone)]
pub struct ReconstructProgress {
    pub total_files: u64,
    pub completed_files: u64,
    pub total_bytes: u64,
    pub completed_bytes: u64,
    pub current_file: String,
    pub errors: Vec<String>,
}

/// Progress callback type
pub type ProgressCallback = Box<dyn Fn(&ReconstructProgress) + Send + Sync>;

/// Reconstruction engine
pub struct Reconstructor {
    config: ReconstructConfig,
    dedup_store: DedupStore,
    /// Chunk cache for repeated access
    chunk_cache: HashMap<[u8; BLAKE3_SIZE], Vec<u8>>,
    /// Statistics
    chunks_fetched: AtomicU64,
    cache_hits: AtomicU64,
}

impl Reconstructor {
    /// Create a new reconstructor
    pub fn new(dedup_store: DedupStore, config: ReconstructConfig) -> Self {
        Self {
            config,
            dedup_store,
            chunk_cache: HashMap::new(),
            chunks_fetched: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
        }
    }

    /// Reconstruct all files from a snapshot to target directory
    pub fn reconstruct_all<P: AsRef<Path>>(
        &mut self,
        snapshot: &Snapshot,
        target_dir: P,
        progress_cb: Option<ProgressCallback>,
    ) -> Result<ReconstructStats, SnapshotError> {
        let target_dir = target_dir.as_ref();
        fs::create_dir_all(target_dir)?;

        let total_files = snapshot.header.total_files;
        let total_bytes = snapshot.header.total_bytes;
        let completed_files = AtomicU64::new(0);
        let completed_bytes = AtomicU64::new(0);
        let errors: Arc<parking_lot::Mutex<Vec<String>>> = Arc::new(parking_lot::Mutex::new(Vec::new()));

        // First pass: create directories
        for entry in &snapshot.files {
            if entry.is_dir {
                let dir_path = target_dir.join(&entry.path);
                if let Err(e) = fs::create_dir_all(&dir_path) {
                    errors.lock().push(format!("Failed to create dir {}: {}", entry.path, e));
                }
            }
        }

        // Second pass: reconstruct files (sequential for now, can parallelize file fetches)
        for entry in &snapshot.files {
            if entry.is_dir {
                continue;
            }

            if entry.is_symlink {
                #[cfg(unix)]
                if let Some(ref target) = entry.symlink_target {
                    let link_path = target_dir.join(&entry.path);
                    if let Err(e) = std::os::unix::fs::symlink(target, &link_path) {
                        errors.lock().push(format!("Failed to create symlink {}: {}", entry.path, e));
                    }
                }
                completed_files.fetch_add(1, Ordering::Relaxed);
                continue;
            }

            // Reconstruct regular file
            let file_path = target_dir.join(&entry.path);
            
            // Check if exists and overwrite policy
            if file_path.exists() && !self.config.overwrite {
                errors.lock().push(format!("File exists, skipping: {}", entry.path));
                completed_files.fetch_add(1, Ordering::Relaxed);
                continue;
            }

            // Ensure parent directory exists
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent)?;
            }

            match self.reconstruct_file(entry, &file_path) {
                Ok(bytes_written) => {
                    completed_bytes.fetch_add(bytes_written, Ordering::Relaxed);
                    
                    // Restore metadata
                    self.restore_metadata(entry, &file_path);
                }
                Err(e) => {
                    errors.lock().push(format!("Failed to reconstruct {}: {}", entry.path, e));
                }
            }

            completed_files.fetch_add(1, Ordering::Relaxed);

            // Report progress
            if let Some(ref cb) = progress_cb {
                cb(&ReconstructProgress {
                    total_files,
                    completed_files: completed_files.load(Ordering::Relaxed),
                    total_bytes,
                    completed_bytes: completed_bytes.load(Ordering::Relaxed),
                    current_file: entry.path.clone(),
                    errors: errors.lock().clone(),
                });
            }
        }

        let final_errors = errors.lock().clone();
        Ok(ReconstructStats {
            files_restored: completed_files.load(Ordering::Relaxed),
            bytes_restored: completed_bytes.load(Ordering::Relaxed),
            chunks_fetched: self.chunks_fetched.load(Ordering::Relaxed),
            cache_hits: self.cache_hits.load(Ordering::Relaxed),
            errors: final_errors,
        })
    }

    /// Reconstruct a single file
    pub fn reconstruct_file(
        &mut self,
        entry: &FileEntry,
        target_path: &Path,
    ) -> Result<u64, SnapshotError> {
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(target_path)?;
        
        let mut writer = BufWriter::with_capacity(self.config.buffer_size, file);
        let mut hasher = blake3::Hasher::new();
        let mut total_written = 0u64;

        for chunk_ref in &entry.chunks {
            let chunk_data = self.fetch_chunk(&chunk_ref.fingerprint)?;
            
            // Handle delta chunks
            let final_data = if let Some(base_fp) = chunk_ref.delta_base {
                let base_data = self.fetch_chunk(&base_fp)?;
                self.apply_delta(&base_data, &chunk_data)?
            } else {
                chunk_data
            };

            writer.write_all(&final_data)?;
            hasher.update(&final_data);
            total_written += final_data.len() as u64;
        }

        writer.flush()?;

        // Verify integrity
        if self.config.verify_integrity {
            let computed_hash = *hasher.finalize().as_bytes();
            if computed_hash != entry.file_hash {
                return Err(SnapshotError::ReconstructionFailed(format!(
                    "Hash mismatch for {}: expected {}, got {}",
                    entry.path,
                    hex::encode(entry.file_hash),
                    hex::encode(computed_hash)
                )));
            }
        }

        // Verify size
        if total_written != entry.size {
            return Err(SnapshotError::ReconstructionFailed(format!(
                "Size mismatch for {}: expected {}, got {}",
                entry.path, entry.size, total_written
            )));
        }

        Ok(total_written)
    }

    /// Fetch a chunk from the store (with caching)
    fn fetch_chunk(&mut self, fingerprint: &[u8; BLAKE3_SIZE]) -> Result<Vec<u8>, SnapshotError> {
        // Check cache first
        if let Some(data) = self.chunk_cache.get(fingerprint) {
            self.cache_hits.fetch_add(1, Ordering::Relaxed);
            return Ok(data.clone());
        }

        // Fetch from store using fingerprint lookup
        let data = self.dedup_store.fetch_chunk(fingerprint)?
            .ok_or_else(|| SnapshotError::ChunkNotFound(*fingerprint))?;

        self.chunks_fetched.fetch_add(1, Ordering::Relaxed);

        // Cache if small enough
        if data.len() < 1024 * 1024 && self.chunk_cache.len() < 10000 {
            self.chunk_cache.insert(*fingerprint, data.clone());
        }

        Ok(data)
    }

    /// Apply delta to base chunk (placeholder - xdelta3 style)
    fn apply_delta(&self, base: &[u8], delta: &[u8]) -> Result<Vec<u8>, SnapshotError> {
        // Simple delta format: just copy operations for now
        // Real implementation would use xdelta3 or similar
        // Delta format: [op:1][len:4][data/offset]...
        
        let mut result = Vec::new();
        let mut pos = 0;

        while pos < delta.len() {
            if pos + 5 > delta.len() {
                break;
            }

            let op = delta[pos];
            let len = u32::from_le_bytes([
                delta[pos + 1],
                delta[pos + 2],
                delta[pos + 3],
                delta[pos + 4],
            ]) as usize;
            pos += 5;

            match op {
                0 => {
                    // Copy from delta
                    if pos + len > delta.len() {
                        return Err(SnapshotError::ReconstructionFailed(
                            "Delta underflow".to_string()
                        ));
                    }
                    result.extend_from_slice(&delta[pos..pos + len]);
                    pos += len;
                }
                1 => {
                    // Copy from base
                    if pos + 4 > delta.len() {
                        return Err(SnapshotError::ReconstructionFailed(
                            "Delta offset missing".to_string()
                        ));
                    }
                    let offset = u32::from_le_bytes([
                        delta[pos],
                        delta[pos + 1],
                        delta[pos + 2],
                        delta[pos + 3],
                    ]) as usize;
                    pos += 4;

                    if offset + len > base.len() {
                        return Err(SnapshotError::ReconstructionFailed(
                            "Base offset out of bounds".to_string()
                        ));
                    }
                    result.extend_from_slice(&base[offset..offset + len]);
                }
                _ => {
                    return Err(SnapshotError::ReconstructionFailed(
                        format!("Unknown delta op: {}", op)
                    ));
                }
            }
        }

        Ok(result)
    }

    /// Restore file metadata (permissions, timestamps)
    fn restore_metadata(&self, entry: &FileEntry, path: &Path) {
        // Restore timestamps
        if self.config.restore_timestamps {
            let mtime = filetime::FileTime::from_unix_time(entry.mtime as i64, 0);
            let _ = filetime::set_file_mtime(path, mtime);
        }

        // Restore permissions (Unix only)
        #[cfg(unix)]
        if self.config.restore_permissions {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(entry.mode);
            let _ = fs::set_permissions(path, perms);
        }
    }

    /// Get reconstruction statistics
    pub fn stats(&self) -> (u64, u64) {
        (
            self.chunks_fetched.load(Ordering::Relaxed),
            self.cache_hits.load(Ordering::Relaxed),
        )
    }

    /// Clear chunk cache
    pub fn clear_cache(&mut self) {
        self.chunk_cache.clear();
    }
}

/// Reconstruction statistics
#[derive(Debug, Clone)]
pub struct ReconstructStats {
    pub files_restored: u64,
    pub bytes_restored: u64,
    pub chunks_fetched: u64,
    pub cache_hits: u64,
    pub errors: Vec<String>,
}

impl std::fmt::Display for ReconstructStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "=== Reconstruction Statistics ===")?;
        writeln!(f, "Files restored: {}", self.files_restored)?;
        writeln!(f, "Bytes restored: {}", format_bytes(self.bytes_restored))?;
        writeln!(f, "Chunks fetched: {}", self.chunks_fetched)?;
        writeln!(f, "Cache hits: {}", self.cache_hits)?;
        if !self.errors.is_empty() {
            writeln!(f, "Errors: {}", self.errors.len())?;
            for err in &self.errors {
                writeln!(f, "  - {}", err)?;
            }
        }
        Ok(())
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

/// Selective file reconstruction
pub struct SelectiveReconstructor {
    reconstructor: Reconstructor,
    snapshot: Snapshot,
}

impl SelectiveReconstructor {
    /// Create from snapshot file
    pub fn open<P: AsRef<Path>>(
        snapshot_path: P,
        chunk_store_path: P,
        config: ReconstructConfig,
    ) -> Result<Self, SnapshotError> {
        let snapshot = Snapshot::read(snapshot_path)?;
        let dedup_store = DedupStore::open(chunk_store_path)?;
        let reconstructor = Reconstructor::new(dedup_store, config);

        Ok(Self {
            reconstructor,
            snapshot,
        })
    }

    /// List all files in snapshot
    pub fn list_files(&self) -> Vec<&FileEntry> {
        self.snapshot.files.iter().collect()
    }

    /// Reconstruct specific files by path pattern
    pub fn reconstruct_matching<P: AsRef<Path>>(
        &mut self,
        pattern: &str,
        target_dir: P,
    ) -> Result<ReconstructStats, SnapshotError> {
        let target_dir = target_dir.as_ref();
        fs::create_dir_all(target_dir)?;

        let mut stats = ReconstructStats {
            files_restored: 0,
            bytes_restored: 0,
            chunks_fetched: 0,
            cache_hits: 0,
            errors: Vec::new(),
        };

        // Simple glob matching
        let pattern_lower = pattern.to_lowercase();
        let matching_files: Vec<_> = self.snapshot.files.iter()
            .filter(|f| {
                let path_lower = f.path.to_lowercase();
                if pattern.contains('*') {
                    // Simple wildcard matching
                    let parts: Vec<&str> = pattern_lower.split('*').collect();
                    if parts.len() == 2 {
                        path_lower.starts_with(parts[0]) && path_lower.ends_with(parts[1])
                    } else {
                        path_lower.contains(&pattern_lower.replace('*', ""))
                    }
                } else {
                    path_lower.contains(&pattern_lower)
                }
            })
            .collect();

        for entry in matching_files {
            if entry.is_dir || entry.is_symlink {
                continue;
            }

            let target_path = target_dir.join(&entry.path);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }

            match self.reconstructor.reconstruct_file(entry, &target_path) {
                Ok(bytes) => {
                    stats.files_restored += 1;
                    stats.bytes_restored += bytes;
                }
                Err(e) => {
                    stats.errors.push(format!("{}: {}", entry.path, e));
                }
            }
        }

        let (fetched, hits) = self.reconstructor.stats();
        stats.chunks_fetched = fetched;
        stats.cache_hits = hits;

        Ok(stats)
    }

    /// Reconstruct a single file by exact path
    pub fn reconstruct_file<P: AsRef<Path>>(
        &mut self,
        file_path: &str,
        target_path: P,
    ) -> Result<u64, SnapshotError> {
        let entry = self.snapshot.find_file(file_path)
            .ok_or_else(|| SnapshotError::FileNotFound(file_path.to_string()))?
            .clone();

        let target = target_path.as_ref();
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }

        self.reconstructor.reconstruct_file(&entry, target)
    }

    /// Get snapshot statistics
    pub fn snapshot_stats(&self) -> crate::snapshot::DedupStats {
        self.snapshot.dedup_stats()
    }
}

/// Parallel chunk prefetcher for faster reconstruction
pub struct ChunkPrefetcher {
    dedup_store: Arc<parking_lot::RwLock<DedupStore>>,
    prefetch_queue: crossbeam_channel::Sender<[u8; BLAKE3_SIZE]>,
    cache: Arc<parking_lot::RwLock<HashMap<[u8; BLAKE3_SIZE], Vec<u8>>>>,
}

impl ChunkPrefetcher {
    /// Create prefetcher with background workers
    pub fn new(dedup_store: DedupStore, num_workers: usize) -> Self {
        let store = Arc::new(parking_lot::RwLock::new(dedup_store));
        let cache = Arc::new(parking_lot::RwLock::new(HashMap::new()));
        let (tx, rx) = crossbeam_channel::bounded(1000);

        // Spawn worker threads
        for _ in 0..num_workers {
            let store = Arc::clone(&store);
            let cache = Arc::clone(&cache);
            let rx = rx.clone();

            std::thread::spawn(move || {
                while let Ok(fingerprint) = rx.recv() {
                    // Check if already cached
                    if cache.read().contains_key(&fingerprint) {
                        continue;
                    }

                    // Fetch from store
                    if let Ok(Some(data)) = store.read().fetch_chunk(&fingerprint) {
                        cache.write().insert(fingerprint, data);
                    }
                }
            });
        }

        Self {
            dedup_store: store,
            prefetch_queue: tx,
            cache,
        }
    }

    /// Queue chunks for prefetching
    pub fn prefetch(&self, fingerprints: &[[u8; BLAKE3_SIZE]]) {
        for fp in fingerprints {
            let _ = self.prefetch_queue.try_send(*fp);
        }
    }

    /// Get a chunk (blocks if not cached)
    pub fn get(&self, fingerprint: &[u8; BLAKE3_SIZE]) -> Result<Vec<u8>, SnapshotError> {
        // Check cache
        if let Some(data) = self.cache.read().get(fingerprint) {
            return Ok(data.clone());
        }

        // Fetch directly
        self.dedup_store.read()
            .fetch_chunk(fingerprint)?
            .ok_or_else(|| SnapshotError::ChunkNotFound(*fingerprint))
    }

    /// Cache size
    pub fn cache_size(&self) -> usize {
        self.cache.read().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_reconstruct_config_default() {
        let config = ReconstructConfig::default();
        assert!(config.verify_integrity);
        assert!(config.restore_timestamps);
        assert!(!config.overwrite);
    }

    #[test]
    fn test_delta_apply_copy_from_delta() {
        let store_dir = tempdir().unwrap();
        let store = DedupStore::open(store_dir.path()).unwrap();
        let config = ReconstructConfig::default();
        let reconstructor = Reconstructor::new(store, config);

        // Delta: copy 5 bytes from delta data
        let delta = vec![
            0u8, // op = copy from delta
            5, 0, 0, 0, // len = 5
            b'h', b'e', b'l', b'l', b'o', // data
        ];

        let result = reconstructor.apply_delta(&[], &delta).unwrap();
        assert_eq!(result, b"hello");
    }

    #[test]
    fn test_delta_apply_copy_from_base() {
        let store_dir = tempdir().unwrap();
        let store = DedupStore::open(store_dir.path()).unwrap();
        let config = ReconstructConfig::default();
        let reconstructor = Reconstructor::new(store, config);

        let base = b"hello world";
        // Delta: copy 5 bytes from base at offset 6
        let delta = vec![
            1u8, // op = copy from base
            5, 0, 0, 0, // len = 5
            6, 0, 0, 0, // offset = 6
        ];

        let result = reconstructor.apply_delta(base, &delta).unwrap();
        assert_eq!(result, b"world");
    }

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(2048), "2.00 KB");
        assert_eq!(format_bytes(1024 * 1024 * 5), "5.00 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024 * 2), "2.00 GB");
    }

    #[test]
    fn test_reconstruct_stats_display() {
        let stats = ReconstructStats {
            files_restored: 100,
            bytes_restored: 1024 * 1024 * 50,
            chunks_fetched: 200,
            cache_hits: 50,
            errors: vec!["test error".to_string()],
        };

        let display = format!("{}", stats);
        assert!(display.contains("100"));
        assert!(display.contains("50.00 MB"));
        assert!(display.contains("test error"));
    }
}
