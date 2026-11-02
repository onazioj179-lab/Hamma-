//! Chunk structure types
//!
//! Extended chunk types for deduplication and distributed processing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::utils::hashing::SHA256_SIZE;

/// V4 Deduplication index
#[derive(Debug, Clone, Default)]
pub struct DedupIndex {
    /// Map from content hash to chunk table index
    pub hash_to_index: HashMap<[u8; SHA256_SIZE], usize>,
    /// Total bytes saved by deduplication
    pub bytes_saved: u64,
    /// Number of duplicate chunks found
    pub duplicates_found: u64,
}

impl DedupIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if a hash exists and return its index
    pub fn lookup(&self, hash: &[u8; SHA256_SIZE]) -> Option<usize> {
        self.hash_to_index.get(hash).copied()
    }

    /// Add a hash to the index
    pub fn insert(&mut self, hash: [u8; SHA256_SIZE], index: usize) {
        self.hash_to_index.insert(hash, index);
    }

    /// Record a duplicate was found
    pub fn record_duplicate(&mut self, chunk_size: u64) {
        self.duplicates_found += 1;
        self.bytes_saved += chunk_size;
    }

    /// Get deduplication statistics
    pub fn stats(&self) -> DedupStats {
        DedupStats {
            unique_chunks: self.hash_to_index.len() as u64,
            duplicate_chunks: self.duplicates_found,
            bytes_saved: self.bytes_saved,
        }
    }
}

/// Deduplication statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DedupStats {
    pub unique_chunks: u64,
    pub duplicate_chunks: u64,
    pub bytes_saved: u64,
}

/// Chunk processing state for streaming
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChunkState {
    /// Chunk is pending processing
    Pending,
    /// Chunk is being compressed
    Compressing,
    /// Chunk is compressed and ready to write
    Compressed,
    /// Chunk has been written to output
    Written,
    /// Chunk was deduplicated (reference to existing)
    Deduplicated(usize),
    /// Chunk processing failed
    Failed(String),
}

impl Default for ChunkState {
    fn default() -> Self {
        Self::Pending
    }
}

/// In-progress chunk for streaming compression
#[derive(Debug)]
pub struct PendingChunk {
    /// Chunk index
    pub index: u64,
    /// Original uncompressed data
    pub data: Vec<u8>,
    /// Hash of uncompressed data
    pub hash: [u8; SHA256_SIZE],
    /// File offset where this chunk starts
    pub file_offset: u64,
    /// Processing state
    pub state: ChunkState,
    /// Compressed data (if state is Compressed)
    pub compressed_data: Option<Vec<u8>>,
    /// Compression codec used
    pub codec: Option<crate::codec::Codec>,
}

impl PendingChunk {
    pub fn new(index: u64, data: Vec<u8>, hash: [u8; SHA256_SIZE], file_offset: u64) -> Self {
        Self {
            index,
            data,
            hash,
            file_offset,
            state: ChunkState::Pending,
            compressed_data: None,
            codec: None,
        }
    }

    pub fn uncompressed_size(&self) -> usize {
        self.data.len()
    }

    pub fn compressed_size(&self) -> Option<usize> {
        self.compressed_data.as_ref().map(|d| d.len())
    }

    pub fn is_ready(&self) -> bool {
        matches!(self.state, ChunkState::Compressed | ChunkState::Deduplicated(_))
    }
}

/// Chunk batch for parallel processing (V4)
#[derive(Debug)]
pub struct ChunkBatch {
    /// Batch ID
    pub id: u64,
    /// Chunks in this batch
    pub chunks: Vec<PendingChunk>,
    /// Start index in the overall chunk table
    pub start_index: u64,
}

impl ChunkBatch {
    pub fn new(id: u64, start_index: u64) -> Self {
        Self {
            id,
            chunks: Vec::new(),
            start_index,
        }
    }

    pub fn add_chunk(&mut self, chunk: PendingChunk) {
        self.chunks.push(chunk);
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    pub fn total_size(&self) -> usize {
        self.chunks.iter().map(|c| c.uncompressed_size()).sum()
    }
}

/// Reference to a chunk in another file (V4 global dedup)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalChunkRef {
    /// Archive ID containing the chunk
    pub archive_id: String,
    /// Chunk index within that archive
    pub chunk_index: u64,
    /// Hash for verification
    pub hash: String,
}
