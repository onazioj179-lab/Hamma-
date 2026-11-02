//! Chunking utilities for SPK
//!
//! V1: Fixed 4-8MB chunks
//! V4: Adaptive 1-16MB chunks with content-defined boundaries

use std::io::{Read, BufReader};

use super::error::SpkResult;
use super::hashing::sha256_hash;

/// Default chunk size: 4MB
pub const DEFAULT_CHUNK_SIZE: usize = 4 * 1024 * 1024;

/// Minimum chunk size: 1MB (V4 adaptive)
pub const MIN_CHUNK_SIZE: usize = 1024 * 1024;

/// Maximum chunk size: 16MB (V4 adaptive)
pub const MAX_CHUNK_SIZE: usize = 16 * 1024 * 1024;

/// Configuration for chunking behavior
#[derive(Debug, Clone)]
pub struct ChunkConfig {
    /// Target chunk size
    pub target_size: usize,
    /// Minimum chunk size (for adaptive chunking)
    pub min_size: usize,
    /// Maximum chunk size (for adaptive chunking)
    pub max_size: usize,
    /// Use content-defined chunking (V4)
    pub adaptive: bool,
    /// Window size for content-defined chunking
    pub window_size: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            target_size: DEFAULT_CHUNK_SIZE,
            min_size: DEFAULT_CHUNK_SIZE,
            max_size: DEFAULT_CHUNK_SIZE,
            adaptive: false,
            window_size: 48,
        }
    }
}

impl ChunkConfig {
    /// V1 fixed-size chunking
    pub fn fixed(size: usize) -> Self {
        Self {
            target_size: size,
            min_size: size,
            max_size: size,
            adaptive: false,
            window_size: 48,
        }
    }

    /// V4 adaptive content-defined chunking
    pub fn adaptive() -> Self {
        Self {
            target_size: DEFAULT_CHUNK_SIZE,
            min_size: MIN_CHUNK_SIZE,
            max_size: MAX_CHUNK_SIZE,
            adaptive: true,
            window_size: 48,
        }
    }
}

/// A single chunk with its data and metadata
#[derive(Debug, Clone)]
pub struct RawChunk {
    /// Chunk index (0-based)
    pub index: u64,
    /// Raw chunk data
    pub data: Vec<u8>,
    /// SHA-256 hash of raw data
    pub hash: [u8; 32],
    /// Offset in original file
    pub file_offset: u64,
}

impl RawChunk {
    /// Create a new chunk from data
    pub fn new(index: u64, data: Vec<u8>, file_offset: u64) -> Self {
        let hash = sha256_hash(&data);
        Self {
            index,
            data,
            hash,
            file_offset,
        }
    }

    /// Get chunk size
    pub fn size(&self) -> usize {
        self.data.len()
    }
}

/// Iterator that yields chunks from a reader
/// 
/// Streams data without loading the entire file into memory.
pub struct ChunkIterator<R: Read> {
    reader: BufReader<R>,
    config: ChunkConfig,
    current_index: u64,
    current_offset: u64,
    finished: bool,
}

impl<R: Read> ChunkIterator<R> {
    /// Create a new chunk iterator
    pub fn new(reader: R, config: ChunkConfig) -> Self {
        Self {
            reader: BufReader::with_capacity(config.target_size, reader),
            config,
            current_index: 0,
            current_offset: 0,
            finished: false,
        }
    }

    /// Create with default fixed chunking
    pub fn fixed(reader: R) -> Self {
        Self::new(reader, ChunkConfig::default())
    }

    /// Create with V4 adaptive chunking
    pub fn adaptive(reader: R) -> Self {
        Self::new(reader, ChunkConfig::adaptive())
    }

    /// Read the next chunk using fixed-size chunking
    fn read_fixed_chunk(&mut self) -> SpkResult<Option<RawChunk>> {
        let mut buffer = vec![0u8; self.config.target_size];
        let mut total_read = 0;

        // Read up to target size
        while total_read < self.config.target_size {
            let bytes_read = self.reader.read(&mut buffer[total_read..])?;
            if bytes_read == 0 {
                break;
            }
            total_read += bytes_read;
        }

        if total_read == 0 {
            self.finished = true;
            return Ok(None);
        }

        buffer.truncate(total_read);
        
        let chunk = RawChunk::new(self.current_index, buffer, self.current_offset);
        self.current_index += 1;
        self.current_offset += total_read as u64;

        Ok(Some(chunk))
    }

    /// Read the next chunk using content-defined chunking (V4)
    /// Uses a rolling hash to find natural boundaries
    fn read_adaptive_chunk(&mut self) -> SpkResult<Option<RawChunk>> {
        let mut buffer = Vec::with_capacity(self.config.target_size);
        let mut rolling_hash: u64 = 0;
        let mut byte_buf = [0u8; 1];

        while buffer.len() < self.config.max_size {
            let bytes_read = self.reader.read(&mut byte_buf)?;
            if bytes_read == 0 {
                break;
            }

            let byte = byte_buf[0];
            buffer.push(byte);

            // Only look for boundaries after minimum size
            if buffer.len() >= self.config.min_size {
                // Simple Rabin-like rolling hash
                rolling_hash = rolling_hash.wrapping_mul(31).wrapping_add(byte as u64);
                
                // Check for boundary (when hash matches pattern)
                // Using bottom 18 bits gives ~256KB average for target of 4MB
                let mask = (1u64 << 22) - 1; // ~4MB average
                if rolling_hash & mask == mask {
                    break;
                }
            }
        }

        if buffer.is_empty() {
            self.finished = true;
            return Ok(None);
        }

        let chunk = RawChunk::new(self.current_index, buffer, self.current_offset);
        self.current_index += 1;
        self.current_offset += chunk.size() as u64;

        Ok(Some(chunk))
    }
}

impl<R: Read> Iterator for ChunkIterator<R> {
    type Item = SpkResult<RawChunk>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.finished {
            return None;
        }

        let result = if self.config.adaptive {
            self.read_adaptive_chunk()
        } else {
            self.read_fixed_chunk()
        };

        match result {
            Ok(Some(chunk)) => Some(Ok(chunk)),
            Ok(None) => None,
            Err(e) => {
                self.finished = true;
                Some(Err(e))
            }
        }
    }
}

/// Pre-calculate the number of chunks for a given file size (fixed chunking only)
pub fn estimate_chunks(file_size: u64, chunk_size: usize) -> u64 {
    if file_size == 0 {
        return 0;
    }
    (file_size + chunk_size as u64 - 1) / chunk_size as u64
}

/// Calculate optimal chunk size based on file size (V4)
pub fn optimal_chunk_size(file_size: u64) -> usize {
    match file_size {
        // Small files: 1MB chunks
        0..=10_000_000 => MIN_CHUNK_SIZE,
        // Medium files: 4MB chunks
        10_000_001..=1_000_000_000 => DEFAULT_CHUNK_SIZE,
        // Large files: 8MB chunks
        1_000_000_001..=100_000_000_000 => 8 * 1024 * 1024,
        // Huge files: 16MB chunks
        _ => MAX_CHUNK_SIZE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_fixed_chunking() {
        // Create 10MB of test data
        let data: Vec<u8> = (0..10_000_000).map(|i| (i % 256) as u8).collect();
        let cursor = Cursor::new(&data);
        
        let chunks: Vec<RawChunk> = ChunkIterator::fixed(cursor)
            .map(|r| r.unwrap())
            .collect();

        // 10MB / 4MB = 2.5 => 3 chunks
        assert_eq!(chunks.len(), 3);
        
        // Verify first chunk is full size
        assert_eq!(chunks[0].size(), DEFAULT_CHUNK_SIZE);
        
        // Verify indices
        assert_eq!(chunks[0].index, 0);
        assert_eq!(chunks[1].index, 1);
    }

    #[test]
    fn test_chunk_hashes_unique() {
        let data1 = vec![0u8; 1000];
        let data2 = vec![1u8; 1000];
        
        let chunk1 = RawChunk::new(0, data1, 0);
        let chunk2 = RawChunk::new(1, data2, 0);
        
        assert_ne!(chunk1.hash, chunk2.hash);
    }

    #[test]
    fn test_estimate_chunks() {
        assert_eq!(estimate_chunks(0, DEFAULT_CHUNK_SIZE), 0);
        assert_eq!(estimate_chunks(1, DEFAULT_CHUNK_SIZE), 1);
        assert_eq!(estimate_chunks(DEFAULT_CHUNK_SIZE as u64, DEFAULT_CHUNK_SIZE), 1);
        assert_eq!(estimate_chunks(DEFAULT_CHUNK_SIZE as u64 + 1, DEFAULT_CHUNK_SIZE), 2);
    }

    #[test]
    fn test_optimal_chunk_size() {
        assert_eq!(optimal_chunk_size(1_000_000), MIN_CHUNK_SIZE);
        assert_eq!(optimal_chunk_size(100_000_000), DEFAULT_CHUNK_SIZE);
        assert_eq!(optimal_chunk_size(50_000_000_000), 8 * 1024 * 1024);
        assert_eq!(optimal_chunk_size(500_000_000_000), MAX_CHUNK_SIZE);
    }

    #[test]
    fn test_empty_input() {
        let cursor = Cursor::new(Vec::<u8>::new());
        let chunks: Vec<_> = ChunkIterator::fixed(cursor)
            .map(|r| r.unwrap())
            .collect();
        
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_offsets() {
        let data: Vec<u8> = (0..10_000_000).map(|i| (i % 256) as u8).collect();
        let cursor = Cursor::new(&data);
        
        let chunks: Vec<RawChunk> = ChunkIterator::fixed(cursor)
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(chunks[0].file_offset, 0);
        assert_eq!(chunks[1].file_offset, DEFAULT_CHUNK_SIZE as u64);
        assert_eq!(chunks[2].file_offset, 2 * DEFAULT_CHUNK_SIZE as u64);
    }
}
