//! Global Deduplication Store for 100TB-scale compression
//!
//! Content-addressed chunk storage with BLAKE3 fingerprints.
//! Designed for persistent dedup across multiple compression jobs.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cdc::CdcChunk;

/// BLAKE3 hash size in bytes
pub const BLAKE3_SIZE: usize = 32;

/// Chunk location in the store
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkLocation {
    /// Shard identifier (0 for legacy single-shard)
    #[serde(default)]
    pub shard_id: u16,
    /// Volume ID (for sharded storage)
    pub volume_id: u32,
    /// Offset within the volume
    pub offset: u64,
    /// Compressed size
    pub compressed_size: u32,
    /// Original uncompressed size
    pub raw_size: u32,
    /// Dictionary ID used (0xFFFFFFFF if none)
    pub dict_id: u32,
    /// Reference count
    pub refcount: u32,
}

/// Deduplication index entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedupEntry {
    /// Chunk location (if stored)
    pub location: Option<ChunkLocation>,
    /// First seen timestamp (Unix seconds)
    pub first_seen: u64,
    /// Reference count across all archives
    pub total_refs: u64,
}

/// Global deduplication store
/// Uses content-addressed storage with BLAKE3 fingerprints
pub struct DedupStore {
    /// Root directory for the store
    root: PathBuf,
    /// Shard identifier
    shard_id: u16,
    /// In-memory index: fingerprint -> entry
    index: HashMap<[u8; BLAKE3_SIZE], DedupEntry>,
    /// Statistics
    stats: DedupStoreStats,
    /// Current volume ID for writing
    current_volume: u32,
    /// Current offset in the volume
    current_offset: u64,
    /// Maximum volume size (default 10GB)
    max_volume_size: u64,
    /// Dirty flag for persistence
    dirty: bool,
}

/// Dedup store statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DedupStoreStats {
    /// Total unique chunks stored
    pub unique_chunks: u64,
    /// Total references (including duplicates)
    pub total_refs: u64,
    /// Bytes saved by deduplication
    pub bytes_saved: u64,
    /// Total compressed bytes stored
    pub compressed_bytes: u64,
    /// Total raw bytes represented
    pub raw_bytes: u64,
    /// Dedup hit count
    pub hits: u64,
    /// Dedup miss count
    pub misses: u64,
}

impl DedupStoreStats {
    /// Calculate dedup ratio
    pub fn dedup_ratio(&self) -> f64 {
        if self.unique_chunks == 0 {
            return 1.0;
        }
        self.total_refs as f64 / self.unique_chunks as f64
    }

    /// Calculate compression ratio
    pub fn compression_ratio(&self) -> f64 {
        if self.compressed_bytes == 0 {
            return 1.0;
        }
        self.raw_bytes as f64 / self.compressed_bytes as f64
    }

    /// Calculate effective ratio (dedup * compression)
    pub fn effective_ratio(&self) -> f64 {
        self.dedup_ratio() * self.compression_ratio()
    }
}

/// Result of dedup lookup
#[derive(Debug)]
pub enum DedupResult {
    /// Chunk already exists, location returned
    Hit(ChunkLocation),
    /// Chunk is new, needs to be stored
    Miss,
}

impl DedupStore {
    /// Open or create a dedup store at the given path
    pub fn open<P: AsRef<Path>>(root: P) -> std::io::Result<Self> {
        Self::open_with_shard(root, 0)
    }

    /// Open or create a dedup store at the given path for a specific shard
    pub fn open_with_shard<P: AsRef<Path>>(root: P, shard_id: u16) -> std::io::Result<Self> {
        let root = root.as_ref().to_path_buf();
        
        // Create directory structure
        fs::create_dir_all(&root)?;
        fs::create_dir_all(root.join("chunks"))?;
        fs::create_dir_all(root.join("volumes"))?;

        // Load existing index or create new
        let index_path = root.join("index.json");
        let (index, stats) = if index_path.exists() {
            let file = File::open(&index_path)?;
            let reader = BufReader::new(file);
            let state: StoredState = serde_json::from_reader(reader)
                .unwrap_or_else(|_| StoredState::default());
            state.to_runtime()
        } else {
            (HashMap::new(), DedupStoreStats::default())
        };

        // Find current volume
        let (current_volume, current_offset) = Self::find_current_volume(&root)?;

        Ok(Self {
            root,
            shard_id,
            index,
            stats,
            current_volume,
            current_offset,
            max_volume_size: 10 * 1024 * 1024 * 1024, // 10GB
            dirty: false,
        })
    }

    /// Find the current volume and offset for writing
    fn find_current_volume(root: &Path) -> std::io::Result<(u32, u64)> {
        let volumes_dir = root.join("volumes");
        let mut max_vol = 0u32;
        let mut offset = 0u64;

        if let Ok(entries) = fs::read_dir(&volumes_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("vol_") && name_str.ends_with(".dat") {
                    if let Ok(vol_id) = name_str[4..7].parse::<u32>() {
                        if vol_id >= max_vol {
                            max_vol = vol_id;
                            offset = entry.metadata()?.len();
                        }
                    }
                }
            }
        }

        Ok((max_vol, offset))
    }

    /// Look up a chunk by fingerprint
    pub fn lookup(&mut self, fingerprint: &[u8; BLAKE3_SIZE]) -> DedupResult {
        if let Some(entry) = self.index.get(fingerprint) {
            if let Some(ref location) = entry.location {
                self.stats.hits += 1;
                return DedupResult::Hit(location.clone());
            }
        }
        self.stats.misses += 1;
        DedupResult::Miss
    }

    /// Look up a chunk location by fingerprint (immutable, no stats update)
    pub fn get_location(&self, fingerprint: &[u8; BLAKE3_SIZE]) -> Option<ChunkLocation> {
        self.index.get(fingerprint)
            .and_then(|e| e.location.clone())
    }

    /// Fetch chunk data by fingerprint (lookup + read)
    pub fn fetch_chunk(&self, fingerprint: &[u8; BLAKE3_SIZE]) -> std::io::Result<Option<Vec<u8>>> {
        if let Some(location) = self.get_location(fingerprint) {
            let data = self.read_chunk(&location)?;
            Ok(Some(data))
        } else {
            Ok(None)
        }
    }

    /// Check if chunk exists without updating stats
    pub fn contains(&self, fingerprint: &[u8; BLAKE3_SIZE]) -> bool {
        self.index.contains_key(fingerprint)
    }

    /// Store a compressed chunk
    pub fn store(
        &mut self,
        fingerprint: [u8; BLAKE3_SIZE],
        compressed_data: &[u8],
        raw_size: u32,
        dict_id: u32,
    ) -> std::io::Result<ChunkLocation> {
        // Check if we need to rotate volumes
        if self.current_offset + compressed_data.len() as u64 > self.max_volume_size {
            self.current_volume += 1;
            self.current_offset = 0;
        }

        // Write to volume file
        let volume_path = self.volume_path(self.current_volume);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&volume_path)?;
        
        file.write_all(compressed_data)?;
        file.flush()?;

        // Create location
        let location = ChunkLocation {
            shard_id: self.shard_id,
            volume_id: self.current_volume,
            offset: self.current_offset,
            compressed_size: compressed_data.len() as u32,
            raw_size,
            dict_id,
            refcount: 1,
        };

        // Update offset
        self.current_offset += compressed_data.len() as u64;

        // Update index
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        self.index.insert(fingerprint, DedupEntry {
            location: Some(location.clone()),
            first_seen: now,
            total_refs: 1,
        });

        // Update stats
        self.stats.unique_chunks += 1;
        self.stats.total_refs += 1;
        self.stats.compressed_bytes += compressed_data.len() as u64;
        self.stats.raw_bytes += raw_size as u64;

        self.dirty = true;
        Ok(location)
    }

    /// Add a reference to an existing chunk
    pub fn add_reference(&mut self, fingerprint: &[u8; BLAKE3_SIZE], raw_size: u32) {
        if let Some(entry) = self.index.get_mut(fingerprint) {
            entry.total_refs += 1;
            if let Some(ref mut loc) = entry.location {
                loc.refcount += 1;
            }
            self.stats.total_refs += 1;
            self.stats.bytes_saved += raw_size as u64;
            self.dirty = true;
        }
    }

    /// Read a chunk from the store
    pub fn read_chunk(&self, location: &ChunkLocation) -> std::io::Result<Vec<u8>> {
        let volume_path = self.volume_path(location.volume_id);
        let mut file = File::open(volume_path)?;
        
        use std::io::Seek;
        file.seek(std::io::SeekFrom::Start(location.offset))?;
        
        let mut buffer = vec![0u8; location.compressed_size as usize];
        file.read_exact(&mut buffer)?;
        
        Ok(buffer)
    }

    /// Get the path to a volume file
    fn volume_path(&self, volume_id: u32) -> PathBuf {
        self.root.join("volumes").join(format!("vol_{:03}.dat", volume_id))
    }

    /// Persist the index to disk
    pub fn persist(&mut self) -> std::io::Result<()> {
        if !self.dirty {
            return Ok(());
        }

        let index_path = self.root.join("index.json");
        let temp_path = self.root.join("index.json.tmp");

        let state = StoredState::from_runtime(&self.index, &self.stats);

        // Write to temp file first
        {
            let file = File::create(&temp_path)?;
            let writer = BufWriter::new(file);
            serde_json::to_writer(writer, &state)?;
        }

        // Atomic rename
        fs::rename(&temp_path, &index_path)?;

        self.dirty = false;
        Ok(())
    }

    /// Get current statistics
    pub fn stats(&self) -> &DedupStoreStats {
        &self.stats
    }

    /// Get number of unique chunks
    pub fn unique_count(&self) -> usize {
        self.index.len()
    }

    /// Process chunks from CDC, deduplicating and storing
    pub fn process_chunks<F>(
        &mut self,
        chunks: Vec<CdcChunk>,
        compress_fn: F,
        dict_id: u32,
    ) -> std::io::Result<Vec<ChunkRef>>
    where
        F: Fn(&[u8]) -> std::io::Result<Vec<u8>>,
    {
        let mut refs = Vec::with_capacity(chunks.len());

        for chunk in chunks {
            let fingerprint = chunk.fingerprint;
            
            match self.lookup(&fingerprint) {
                DedupResult::Hit(location) => {
                    // Duplicate - just add reference
                    self.add_reference(&fingerprint, chunk.data.len() as u32);
                    refs.push(ChunkRef {
                        fingerprint,
                        offset: chunk.offset,
                        raw_size: chunk.data.len() as u32,
                        location,
                    });
                }
                DedupResult::Miss => {
                    // New chunk - compress and store
                    let compressed = compress_fn(&chunk.data)?;
                    let location = self.store(
                        fingerprint,
                        &compressed,
                        chunk.data.len() as u32,
                        dict_id,
                    )?;
                    refs.push(ChunkRef {
                        fingerprint,
                        offset: chunk.offset,
                        raw_size: chunk.data.len() as u32,
                        location,
                    });
                }
            }
        }

        // Persist after batch
        self.persist()?;
        Ok(refs)
    }
}

impl Drop for DedupStore {
    fn drop(&mut self) {
        let _ = self.persist();
    }
}

/// Reference to a chunk in an archive
#[derive(Debug, Clone)]
pub struct ChunkRef {
    /// BLAKE3 fingerprint
    pub fingerprint: [u8; BLAKE3_SIZE],
    /// Offset in original file
    pub offset: u64,
    /// Raw (uncompressed) size
    pub raw_size: u32,
    /// Location in dedup store
    pub location: ChunkLocation,
}

/// Persisted state - uses hex strings for JSON compatibility
#[derive(Serialize, Deserialize, Default)]
struct StoredState {
    /// Index with hex-encoded fingerprints (JSON can't use byte arrays as keys)
    index: HashMap<String, DedupEntry>,
    stats: DedupStoreStats,
}

impl StoredState {
    /// Convert from runtime HashMap
    fn from_runtime(index: &HashMap<[u8; BLAKE3_SIZE], DedupEntry>, stats: &DedupStoreStats) -> Self {
        let hex_index: HashMap<String, DedupEntry> = index
            .iter()
            .map(|(k, v)| (hex::encode(k), v.clone()))
            .collect();
        Self {
            index: hex_index,
            stats: stats.clone(),
        }
    }

    /// Convert to runtime HashMap
    fn to_runtime(self) -> (HashMap<[u8; BLAKE3_SIZE], DedupEntry>, DedupStoreStats) {
        let runtime_index: HashMap<[u8; BLAKE3_SIZE], DedupEntry> = self
            .index
            .into_iter()
            .filter_map(|(k, v)| {
                let bytes = hex::decode(&k).ok()?;
                if bytes.len() != BLAKE3_SIZE {
                    return None;
                }
                let mut arr = [0u8; BLAKE3_SIZE];
                arr.copy_from_slice(&bytes);
                Some((arr, v))
            })
            .collect();
        (runtime_index, self.stats)
    }
}

/// Batch deduplication processor for parallel operation
pub struct BatchDedupProcessor {
    store: DedupStore,
    pending_chunks: Vec<CdcChunk>,
    batch_size: usize,
}

impl BatchDedupProcessor {
    /// Create a new batch processor
    pub fn new(store: DedupStore, batch_size: usize) -> Self {
        Self {
            store,
            pending_chunks: Vec::with_capacity(batch_size),
            batch_size,
        }
    }

    /// Add a chunk to the pending batch
    pub fn add_chunk(&mut self, chunk: CdcChunk) {
        self.pending_chunks.push(chunk);
    }

    /// Check if batch is full
    pub fn is_full(&self) -> bool {
        self.pending_chunks.len() >= self.batch_size
    }

    /// Process pending batch
    pub fn flush<F>(&mut self, compress_fn: F, dict_id: u32) -> std::io::Result<Vec<ChunkRef>>
    where
        F: Fn(&[u8]) -> std::io::Result<Vec<u8>>,
    {
        let chunks = std::mem::take(&mut self.pending_chunks);
        self.store.process_chunks(chunks, compress_fn, dict_id)
    }

    /// Get the inner store
    pub fn into_store(self) -> DedupStore {
        self.store
    }

    /// Get store reference
    pub fn store(&self) -> &DedupStore {
        &self.store
    }

    /// Get mutable store reference
    pub fn store_mut(&mut self) -> &mut DedupStore {
        &mut self.store
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_store() -> (DedupStore, TempDir) {
        let temp = TempDir::new().unwrap();
        let store = DedupStore::open(temp.path()).unwrap();
        (store, temp)
    }

    #[test]
    fn test_store_open_create() {
        let (store, _temp) = create_test_store();
        assert_eq!(store.unique_count(), 0);
    }

    #[test]
    fn test_store_and_lookup() {
        let (mut store, _temp) = create_test_store();
        
        let fingerprint = [0x42u8; 32];
        let data = b"test compressed data";
        
        // Store chunk
        let location = store.store(fingerprint, data, 100, 0xFFFFFFFF).unwrap();
        assert_eq!(location.compressed_size, data.len() as u32);
        assert_eq!(location.raw_size, 100);

        // Lookup should hit
        match store.lookup(&fingerprint) {
            DedupResult::Hit(loc) => {
                assert_eq!(loc.offset, location.offset);
            }
            DedupResult::Miss => panic!("Expected hit"),
        }
    }

    #[test]
    fn test_dedup_stats() {
        let (mut store, _temp) = create_test_store();
        
        let fingerprint = [0x42u8; 32];
        let data = b"compressed";
        
        // First store
        store.store(fingerprint, data, 1000, 0xFFFFFFFF).unwrap();
        
        // Add reference (simulating duplicate)
        store.add_reference(&fingerprint, 1000);
        
        let stats = store.stats();
        assert_eq!(stats.unique_chunks, 1);
        assert_eq!(stats.total_refs, 2);
        assert_eq!(stats.bytes_saved, 1000);
    }

    #[test]
    fn test_read_chunk() {
        let (mut store, _temp) = create_test_store();
        
        let fingerprint = [0x42u8; 32];
        let data = b"test compressed data for reading";
        
        let location = store.store(fingerprint, data, 100, 0xFFFFFFFF).unwrap();
        
        let read_back = store.read_chunk(&location).unwrap();
        assert_eq!(read_back, data);
    }

    #[test]
    fn test_persistence() {
        let temp = TempDir::new().unwrap();
        let fingerprint = [0x42u8; 32];
        
        // Create, store, and drop
        {
            let mut store = DedupStore::open(temp.path()).unwrap();
            store.store(fingerprint, b"data", 100, 0xFFFFFFFF).unwrap();
            store.persist().unwrap();
        }
        
        // Reopen and verify
        {
            let mut store = DedupStore::open(temp.path()).unwrap();
            match store.lookup(&fingerprint) {
                DedupResult::Hit(_) => (),
                DedupResult::Miss => panic!("Expected hit after reload"),
            }
        }
    }
}
