//! SPK V4 Global Deduplication
//!
//! Cross-file and cross-archive chunk deduplication.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::types::chunk_structs::DedupStats;
use crate::utils::error::SpkResult;
use crate::utils::hashing::SHA256_SIZE;

/// Global deduplication database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedupDatabase {
    /// Index from content hash to chunk references
    pub chunks: HashMap<String, ChunkReference>,
    /// Total unique chunks
    pub unique_count: u64,
    /// Total duplicate references
    pub duplicate_count: u64,
    /// Total bytes saved by deduplication
    pub bytes_saved: u64,
    /// Database version
    pub version: u32,
}

/// Reference to a deduplicated chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkReference {
    /// Archive containing the chunk
    pub archive_id: String,
    /// Chunk index in that archive
    pub chunk_index: u64,
    /// Uncompressed size
    pub size: u32,
    /// Reference count
    pub ref_count: u32,
}

impl DedupDatabase {
    /// Create a new empty database
    pub fn new() -> Self {
        Self {
            chunks: HashMap::new(),
            unique_count: 0,
            duplicate_count: 0,
            bytes_saved: 0,
            version: 1,
        }
    }

    /// Load database from file
    pub fn load<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let db: Self = serde_json::from_reader(reader)?;
        Ok(db)
    }

    /// Save database to file
    pub fn save<P: AsRef<Path>>(&self, path: P) -> SpkResult<()> {
        let file = File::create(path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, self)?;
        Ok(())
    }

    /// Look up a chunk by hash
    pub fn lookup(&self, hash: &[u8]) -> Option<&ChunkReference> {
        let hash_str = hex::encode(hash);
        self.chunks.get(&hash_str)
    }

    /// Register a new unique chunk
    pub fn register_chunk(&mut self, hash: &[u8], archive_id: &str, chunk_index: u64, size: u32) {
        let hash_str = hex::encode(hash);
        
        if let Some(existing) = self.chunks.get_mut(&hash_str) {
            existing.ref_count += 1;
            self.duplicate_count += 1;
            self.bytes_saved += size as u64;
        } else {
            self.chunks.insert(hash_str, ChunkReference {
                archive_id: archive_id.to_string(),
                chunk_index,
                size,
                ref_count: 1,
            });
            self.unique_count += 1;
        }
    }

    /// Get statistics
    pub fn stats(&self) -> DedupStats {
        DedupStats {
            unique_chunks: self.unique_count,
            duplicate_chunks: self.duplicate_count,
            bytes_saved: self.bytes_saved,
        }
    }

    /// Merge another database into this one
    pub fn merge(&mut self, other: &DedupDatabase) {
        for (hash, chunk_ref) in &other.chunks {
            if let Some(existing) = self.chunks.get_mut(hash) {
                existing.ref_count += chunk_ref.ref_count;
                self.duplicate_count += chunk_ref.ref_count as u64;
                self.bytes_saved += (chunk_ref.size as u64) * (chunk_ref.ref_count as u64);
            } else {
                self.chunks.insert(hash.clone(), chunk_ref.clone());
                self.unique_count += 1;
            }
        }
    }

    /// Remove references to an archive
    pub fn remove_archive(&mut self, archive_id: &str) {
        self.chunks.retain(|_, v| v.archive_id != archive_id);
        // Recount
        self.unique_count = self.chunks.len() as u64;
    }
}

impl Default for DedupDatabase {
    fn default() -> Self {
        Self::new()
    }
}

/// In-memory deduplication index for a single compression session
pub struct SessionDedupIndex {
    /// SHA-256 hash to chunk index mapping
    index: HashMap<[u8; SHA256_SIZE], usize>,
    /// BLAKE3 bloom filter for fast negative lookup
    bloom: Vec<u64>,
    /// Statistics
    stats: DedupStats,
}

impl SessionDedupIndex {
    /// Create a new session dedup index
    pub fn new() -> Self {
        Self {
            index: HashMap::new(),
            bloom: vec![0; 65536], // 512KB bloom filter
            stats: DedupStats::default(),
        }
    }

    /// Check if a chunk hash might exist (bloom filter)
    pub fn might_exist(&self, hash: &[u8; SHA256_SIZE]) -> bool {
        let idx1 = u64::from_le_bytes([hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7]]) as usize % (self.bloom.len() * 64);
        let idx2 = u64::from_le_bytes([hash[8], hash[9], hash[10], hash[11], hash[12], hash[13], hash[14], hash[15]]) as usize % (self.bloom.len() * 64);
        
        let word1 = idx1 / 64;
        let bit1 = idx1 % 64;
        let word2 = idx2 / 64;
        let bit2 = idx2 % 64;
        
        (self.bloom[word1] & (1 << bit1)) != 0 && (self.bloom[word2] & (1 << bit2)) != 0
    }

    /// Lookup chunk by hash
    pub fn lookup(&self, hash: &[u8; SHA256_SIZE]) -> Option<usize> {
        // Fast bloom filter check first
        if !self.might_exist(hash) {
            return None;
        }
        self.index.get(hash).copied()
    }

    /// Add a chunk to the index
    pub fn add(&mut self, hash: [u8; SHA256_SIZE], chunk_index: usize) {
        // Add to bloom filter
        let idx1 = u64::from_le_bytes([hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7]]) as usize % (self.bloom.len() * 64);
        let idx2 = u64::from_le_bytes([hash[8], hash[9], hash[10], hash[11], hash[12], hash[13], hash[14], hash[15]]) as usize % (self.bloom.len() * 64);
        
        let word1 = idx1 / 64;
        let bit1 = idx1 % 64;
        let word2 = idx2 / 64;
        let bit2 = idx2 % 64;
        
        self.bloom[word1] |= 1 << bit1;
        self.bloom[word2] |= 1 << bit2;
        
        // Add to main index
        self.index.insert(hash, chunk_index);
        self.stats.unique_chunks += 1;
    }

    /// Record a duplicate found
    pub fn record_duplicate(&mut self, size: u64) {
        self.stats.duplicate_chunks += 1;
        self.stats.bytes_saved += size;
    }

    /// Get statistics
    pub fn stats(&self) -> &DedupStats {
        &self.stats
    }

    /// Get number of unique chunks
    pub fn len(&self) -> usize {
        self.index.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }
}

impl Default for SessionDedupIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Deduplication strategy
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DedupStrategy {
    /// No deduplication
    None,
    /// File-level (within single file)
    File,
    /// Archive-level (within single archive)
    Archive,
    /// Global (across multiple archives using database)
    Global,
}

impl Default for DedupStrategy {
    fn default() -> Self {
        Self::Archive
    }
}

/// Deduplication processor
pub struct DedupProcessor {
    strategy: DedupStrategy,
    session_index: SessionDedupIndex,
    global_db: Option<DedupDatabase>,
}

impl DedupProcessor {
    /// Create a new dedup processor
    pub fn new(strategy: DedupStrategy) -> Self {
        Self {
            strategy,
            session_index: SessionDedupIndex::new(),
            global_db: None,
        }
    }

    /// Load global database
    pub fn with_global_db<P: AsRef<Path>>(mut self, path: P) -> SpkResult<Self> {
        self.global_db = Some(DedupDatabase::load(path)?);
        Ok(self)
    }

    /// Process a chunk for deduplication
    pub fn process_chunk(&mut self, hash: &[u8; SHA256_SIZE], size: u64) -> DedupResult {
        if self.strategy == DedupStrategy::None {
            return DedupResult::Unique;
        }

        // Check session index first
        if let Some(chunk_index) = self.session_index.lookup(hash) {
            self.session_index.record_duplicate(size);
            return DedupResult::Duplicate(chunk_index);
        }

        // Check global database
        if self.strategy == DedupStrategy::Global {
            if let Some(ref db) = self.global_db {
                if let Some(chunk_ref) = db.lookup(hash) {
                    self.session_index.record_duplicate(size);
                    return DedupResult::GlobalDuplicate(GlobalDupRef {
                        archive_id: chunk_ref.archive_id.clone(),
                        chunk_index: chunk_ref.chunk_index,
                    });
                }
            }
        }

        DedupResult::Unique
    }

    /// Register a new unique chunk
    pub fn register_chunk(&mut self, hash: [u8; SHA256_SIZE], chunk_index: usize) {
        self.session_index.add(hash, chunk_index);
    }

    /// Get statistics
    pub fn stats(&self) -> &DedupStats {
        self.session_index.stats()
    }

    /// Get session index
    pub fn session_index(&self) -> &SessionDedupIndex {
        &self.session_index
    }
}

/// Result of deduplication check
#[derive(Debug, Clone)]
pub enum DedupResult {
    /// Chunk is unique
    Unique,
    /// Chunk is duplicate within session
    Duplicate(usize),
    /// Chunk is duplicate from global database
    GlobalDuplicate(GlobalDupRef),
}

/// Reference to global duplicate
#[derive(Debug, Clone)]
pub struct GlobalDupRef {
    pub archive_id: String,
    pub chunk_index: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::hashing::sha256_hash;

    #[test]
    fn test_dedup_database() {
        let mut db = DedupDatabase::new();
        
        let hash1 = sha256_hash(b"chunk1");
        let hash2 = sha256_hash(b"chunk2");
        let hash3 = sha256_hash(b"chunk1"); // Same as hash1
        
        db.register_chunk(&hash1, "archive1", 0, 1000);
        db.register_chunk(&hash2, "archive1", 1, 2000);
        db.register_chunk(&hash3, "archive1", 2, 1000); // Duplicate
        
        assert_eq!(db.unique_count, 2);
        assert_eq!(db.duplicate_count, 1);
        assert_eq!(db.bytes_saved, 1000);
        
        assert!(db.lookup(&hash1).is_some());
        assert!(db.lookup(&hash2).is_some());
    }

    #[test]
    fn test_session_dedup_index() {
        let mut index = SessionDedupIndex::new();
        
        let hash1 = sha256_hash(b"chunk1");
        let hash2 = sha256_hash(b"chunk2");
        
        index.add(hash1, 0);
        index.add(hash2, 1);
        
        assert_eq!(index.lookup(&hash1), Some(0));
        assert_eq!(index.lookup(&hash2), Some(1));
        assert_eq!(index.lookup(&sha256_hash(b"nonexistent")), None);
    }

    #[test]
    fn test_dedup_processor() {
        let mut processor = DedupProcessor::new(DedupStrategy::Archive);
        
        let hash1 = sha256_hash(b"chunk1");
        let hash2 = sha256_hash(b"chunk1"); // Same content
        
        // First occurrence
        assert!(matches!(processor.process_chunk(&hash1, 1000), DedupResult::Unique));
        processor.register_chunk(hash1, 0);
        
        // Duplicate
        assert!(matches!(processor.process_chunk(&hash2, 1000), DedupResult::Duplicate(0)));
        
        assert_eq!(processor.stats().duplicate_chunks, 1);
        assert_eq!(processor.stats().bytes_saved, 1000);
    }

    #[test]
    fn test_bloom_filter() {
        let mut index = SessionDedupIndex::new();
        
        let hash = sha256_hash(b"test chunk");
        
        // Before adding
        assert!(!index.might_exist(&hash));
        
        // After adding
        index.add(hash, 0);
        assert!(index.might_exist(&hash));
    }
}
