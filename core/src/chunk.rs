//! SPK Chunk and Chunk Table
//!
//! Each chunk entry: offset u64, size u32, uncompressed u32, codec u8, hash[32]
//! Total: 8 + 4 + 4 + 1 + 32 = 49 bytes per entry

use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use std::io::{Cursor, Read, Write};

use crate::codec::Codec;
use crate::utils::error::{SpkError, SpkResult};
use crate::utils::hashing::SHA256_SIZE;

/// Size of each chunk table entry in bytes
pub const CHUNK_ENTRY_SIZE: usize = 49;

/// Chunk ID type (index into chunk table)
pub type ChunkId = u64;

/// Chunk table entry
/// 
/// Layout (49 bytes):
/// - offset: u64 (8 bytes) - offset in data section
/// - compressed_size: u32 (4 bytes)
/// - uncompressed_size: u32 (4 bytes)
/// - codec: u8 (1 byte)
/// - hash: [u8; 32] (32 bytes) - SHA-256 of uncompressed data
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChunkEntry {
    /// Offset within the data section
    pub offset: u64,
    /// Compressed size in bytes
    pub compressed_size: u32,
    /// Original uncompressed size in bytes
    pub uncompressed_size: u32,
    /// Compression codec used
    pub codec: Codec,
    /// SHA-256 hash of uncompressed chunk data
    pub hash: [u8; SHA256_SIZE],
}

impl ChunkEntry {
    /// Create a new chunk entry
    pub fn new(
        offset: u64,
        compressed_size: u32,
        uncompressed_size: u32,
        codec: Codec,
        hash: [u8; SHA256_SIZE],
    ) -> Self {
        Self {
            offset,
            compressed_size,
            uncompressed_size,
            codec,
            hash,
        }
    }

    /// Serialize chunk entry to bytes (49 bytes)
    pub fn to_bytes(&self) -> [u8; CHUNK_ENTRY_SIZE] {
        let mut buffer = [0u8; CHUNK_ENTRY_SIZE];
        let mut cursor = Cursor::new(&mut buffer[..]);

        cursor.write_u64::<LittleEndian>(self.offset).unwrap();
        cursor.write_u32::<LittleEndian>(self.compressed_size).unwrap();
        cursor.write_u32::<LittleEndian>(self.uncompressed_size).unwrap();
        cursor.write_u8(self.codec.as_u8()).unwrap();
        cursor.write_all(&self.hash).unwrap();

        buffer
    }

    /// Parse chunk entry from bytes
    pub fn from_bytes(data: &[u8]) -> SpkResult<Self> {
        if data.len() < CHUNK_ENTRY_SIZE {
            return Err(SpkError::InvalidChunk(format!(
                "Chunk entry too small: {} bytes, expected {}",
                data.len(),
                CHUNK_ENTRY_SIZE
            )));
        }

        let mut cursor = Cursor::new(data);

        let offset = cursor.read_u64::<LittleEndian>()?;
        let compressed_size = cursor.read_u32::<LittleEndian>()?;
        let uncompressed_size = cursor.read_u32::<LittleEndian>()?;
        let codec_byte = cursor.read_u8()?;
        let codec = Codec::from_u8(codec_byte)?;
        
        let mut hash = [0u8; SHA256_SIZE];
        cursor.read_exact(&mut hash)?;

        Ok(Self {
            offset,
            compressed_size,
            uncompressed_size,
            codec,
            hash,
        })
    }

    /// Get compression ratio for this chunk
    pub fn compression_ratio(&self) -> f64 {
        if self.uncompressed_size == 0 {
            1.0
        } else {
            self.compressed_size as f64 / self.uncompressed_size as f64
        }
    }

    /// Check if this chunk was actually compressed
    pub fn is_compressed(&self) -> bool {
        self.codec != Codec::None && self.compressed_size < self.uncompressed_size
    }

    /// Get hash as hex string
    pub fn hash_hex(&self) -> String {
        hex::encode(&self.hash)
    }
}

/// Chunk table containing all chunk entries
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ChunkTable {
    /// All chunk entries
    pub entries: Vec<ChunkEntry>,
}

impl ChunkTable {
    /// Create a new empty chunk table
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Create with pre-allocated capacity
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
        }
    }

    /// Add a chunk entry
    pub fn add(&mut self, entry: ChunkEntry) {
        self.entries.push(entry);
    }

    /// Get chunk entry by index
    pub fn get(&self, index: usize) -> Option<&ChunkEntry> {
        self.entries.get(index)
    }

    /// Get number of chunks
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Calculate total size in bytes
    pub fn byte_size(&self) -> usize {
        self.entries.len() * CHUNK_ENTRY_SIZE
    }

    /// Serialize entire chunk table to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buffer = Vec::with_capacity(self.byte_size());
        for entry in &self.entries {
            buffer.extend_from_slice(&entry.to_bytes());
        }
        buffer
    }

    /// Parse chunk table from bytes
    pub fn from_bytes(data: &[u8], count: usize) -> SpkResult<Self> {
        if data.len() < count * CHUNK_ENTRY_SIZE {
            return Err(SpkError::InvalidChunk(format!(
                "Chunk table too small: {} bytes for {} entries",
                data.len(),
                count
            )));
        }

        let mut entries = Vec::with_capacity(count);
        for i in 0..count {
            let start = i * CHUNK_ENTRY_SIZE;
            let entry = ChunkEntry::from_bytes(&data[start..])?;
            entries.push(entry);
        }

        Ok(Self { entries })
    }

    /// Get total compressed size
    pub fn total_compressed_size(&self) -> u64 {
        self.entries.iter().map(|e| e.compressed_size as u64).sum()
    }

    /// Get total uncompressed size
    pub fn total_uncompressed_size(&self) -> u64 {
        self.entries.iter().map(|e| e.uncompressed_size as u64).sum()
    }

    /// Get overall compression ratio
    pub fn compression_ratio(&self) -> f64 {
        let uncompressed = self.total_uncompressed_size();
        if uncompressed == 0 {
            1.0
        } else {
            self.total_compressed_size() as f64 / uncompressed as f64
        }
    }

    /// Find chunk by hash (for deduplication)
    pub fn find_by_hash(&self, hash: &[u8; SHA256_SIZE]) -> Option<usize> {
        self.entries.iter().position(|e| &e.hash == hash)
    }

    /// Get entries for a range of chunks
    pub fn get_range(&self, start: usize, count: usize) -> &[ChunkEntry] {
        let end = (start + count).min(self.entries.len());
        &self.entries[start..end]
    }

    /// Iterate over entries
    pub fn iter(&self) -> impl Iterator<Item = &ChunkEntry> {
        self.entries.iter()
    }

    /// Iterate with indices
    pub fn iter_enumerated(&self) -> impl Iterator<Item = (usize, &ChunkEntry)> {
        self.entries.iter().enumerate()
    }
}

/// Chunk reference for deduplication (V4)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkRef {
    /// Hash of the chunk content
    pub hash: [u8; SHA256_SIZE],
    /// Index in the chunk table (None if not yet added)
    pub table_index: Option<usize>,
    /// Reference count
    pub ref_count: u32,
}

impl ChunkRef {
    pub fn new(hash: [u8; SHA256_SIZE]) -> Self {
        Self {
            hash,
            table_index: None,
            ref_count: 1,
        }
    }

    pub fn with_index(hash: [u8; SHA256_SIZE], index: usize) -> Self {
        Self {
            hash,
            table_index: Some(index),
            ref_count: 1,
        }
    }

    pub fn increment_ref(&mut self) {
        self.ref_count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_entry_size() {
        let entry = ChunkEntry::new(
            0,
            1000,
            2000,
            Codec::Zstd,
            [0u8; SHA256_SIZE],
        );
        let bytes = entry.to_bytes();
        assert_eq!(bytes.len(), CHUNK_ENTRY_SIZE);
    }

    #[test]
    fn test_chunk_entry_roundtrip() {
        let original = ChunkEntry::new(
            12345678,
            4096,
            8192,
            Codec::Zstd,
            [0x42u8; SHA256_SIZE],
        );

        let bytes = original.to_bytes();
        let parsed = ChunkEntry::from_bytes(&bytes).unwrap();

        assert_eq!(original, parsed);
    }

    #[test]
    fn test_chunk_table_roundtrip() {
        let mut table = ChunkTable::new();
        
        for i in 0..10 {
            table.add(ChunkEntry::new(
                i * 4096,
                4000,
                4096,
                Codec::Zstd,
                [i as u8; SHA256_SIZE],
            ));
        }

        let bytes = table.to_bytes();
        let parsed = ChunkTable::from_bytes(&bytes, 10).unwrap();

        assert_eq!(table.len(), parsed.len());
        for (orig, parsed) in table.entries.iter().zip(parsed.entries.iter()) {
            assert_eq!(orig, parsed);
        }
    }

    #[test]
    fn test_compression_ratio() {
        let entry = ChunkEntry::new(
            0,
            1000,  // compressed
            2000,  // uncompressed
            Codec::Zstd,
            [0u8; SHA256_SIZE],
        );

        assert!((entry.compression_ratio() - 0.5).abs() < 0.001);
        assert!(entry.is_compressed());
    }

    #[test]
    fn test_find_by_hash() {
        let mut table = ChunkTable::new();
        
        let hash1 = [1u8; SHA256_SIZE];
        let hash2 = [2u8; SHA256_SIZE];
        let hash3 = [3u8; SHA256_SIZE];

        table.add(ChunkEntry::new(0, 100, 100, Codec::None, hash1));
        table.add(ChunkEntry::new(100, 100, 100, Codec::None, hash2));
        table.add(ChunkEntry::new(200, 100, 100, Codec::None, hash3));

        assert_eq!(table.find_by_hash(&hash1), Some(0));
        assert_eq!(table.find_by_hash(&hash2), Some(1));
        assert_eq!(table.find_by_hash(&hash3), Some(2));
        assert_eq!(table.find_by_hash(&[4u8; SHA256_SIZE]), None);
    }
}
