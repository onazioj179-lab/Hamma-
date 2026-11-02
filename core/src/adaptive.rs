//! SPK V4 Adaptive Chunking
//!
//! Content-defined chunking with variable sizes (1-16MB).

use std::io::Read;

use crate::utils::chunker::{RawChunk, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE, DEFAULT_CHUNK_SIZE};
use crate::utils::error::SpkResult;
use crate::utils::hashing::sha256_hash;

/// Rolling hash polynomial
const POLYNOMIAL: u64 = 0x3DA3358B4DC173;

/// Mask for average 4MB chunks (22 bits)
const DEFAULT_MASK: u64 = (1 << 22) - 1;

/// Content-defined chunking configuration
#[derive(Debug, Clone)]
pub struct AdaptiveChunkConfig {
    /// Minimum chunk size
    pub min_size: usize,
    /// Maximum chunk size
    pub max_size: usize,
    /// Target average size
    pub target_size: usize,
    /// Window size for rolling hash
    pub window_size: usize,
    /// Mask for boundary detection
    pub mask: u64,
}

impl Default for AdaptiveChunkConfig {
    fn default() -> Self {
        Self {
            min_size: MIN_CHUNK_SIZE,
            max_size: MAX_CHUNK_SIZE,
            target_size: DEFAULT_CHUNK_SIZE,
            window_size: 48,
            mask: DEFAULT_MASK,
        }
    }
}

impl AdaptiveChunkConfig {
    /// Create config for small files (1-4MB chunks)
    pub fn small() -> Self {
        Self {
            min_size: 512 * 1024,  // 512KB
            max_size: 4 * 1024 * 1024,  // 4MB
            target_size: 1024 * 1024,  // 1MB
            window_size: 48,
            mask: (1 << 20) - 1,  // ~1MB average
        }
    }

    /// Create config for large files (4-16MB chunks)
    pub fn large() -> Self {
        Self {
            min_size: 2 * 1024 * 1024,  // 2MB
            max_size: 16 * 1024 * 1024,  // 16MB
            target_size: 8 * 1024 * 1024,  // 8MB
            window_size: 64,
            mask: (1 << 23) - 1,  // ~8MB average
        }
    }

    /// Select optimal config based on file size
    pub fn for_file_size(size: u64) -> Self {
        match size {
            0..=10_000_000 => Self::small(),
            10_000_001..=1_000_000_000 => Self::default(),
            _ => Self::large(),
        }
    }
}

/// Rolling hash for content-defined chunking (Rabin fingerprint)
pub struct RollingHash {
    hash: u64,
    window: Vec<u8>,
    window_size: usize,
    position: usize,
    out_table: [u64; 256],
}

impl RollingHash {
    /// Create a new rolling hash
    pub fn new(window_size: usize) -> Self {
        // Pre-compute table for removing oldest byte
        let mut out_table = [0u64; 256];
        let _shift_amount = (window_size - 1) * 8;
        for i in 0..256 {
            let mut h = i as u64;
            for _ in 0..window_size {
                h = h.wrapping_mul(POLYNOMIAL);
            }
            out_table[i] = h;
        }

        Self {
            hash: 0,
            window: vec![0; window_size],
            window_size,
            position: 0,
            out_table,
        }
    }

    /// Update hash with a new byte
    pub fn update(&mut self, byte: u8) -> u64 {
        let out_byte = self.window[self.position % self.window_size] as usize;
        self.window[self.position % self.window_size] = byte;
        self.position += 1;

        // Rabin fingerprint rolling
        self.hash = self.hash.wrapping_mul(POLYNOMIAL)
            ^ self.out_table[out_byte]
            ^ (byte as u64);

        self.hash
    }

    /// Reset the hash
    pub fn reset(&mut self) {
        self.hash = 0;
        self.window.fill(0);
        self.position = 0;
    }

    /// Get current hash value
    pub fn value(&self) -> u64 {
        self.hash
    }
}

/// Adaptive chunk iterator
pub struct AdaptiveChunkIterator<R: Read> {
    reader: R,
    config: AdaptiveChunkConfig,
    rolling_hash: RollingHash,
    current_index: u64,
    current_offset: u64,
    buffer: Vec<u8>,
    finished: bool,
}

impl<R: Read> AdaptiveChunkIterator<R> {
    /// Create a new adaptive chunk iterator
    pub fn new(reader: R, config: AdaptiveChunkConfig) -> Self {
        let rolling_hash = RollingHash::new(config.window_size);
        
        Self {
            reader,
            config,
            rolling_hash,
            current_index: 0,
            current_offset: 0,
            buffer: Vec::with_capacity(MAX_CHUNK_SIZE),
            finished: false,
        }
    }

    /// Read the next chunk
    fn read_chunk(&mut self) -> SpkResult<Option<RawChunk>> {
        self.buffer.clear();
        self.rolling_hash.reset();
        
        let mut byte_buf = [0u8; 1];
        
        while self.buffer.len() < self.config.max_size {
            let n = self.reader.read(&mut byte_buf)?;
            if n == 0 {
                break;
            }
            
            let byte = byte_buf[0];
            self.buffer.push(byte);
            
            // Only look for boundaries after minimum size
            if self.buffer.len() >= self.config.min_size {
                let hash = self.rolling_hash.update(byte);
                
                // Check if this is a boundary
                if hash & self.config.mask == self.config.mask {
                    break;
                }
            } else {
                self.rolling_hash.update(byte);
            }
        }
        
        if self.buffer.is_empty() {
            self.finished = true;
            return Ok(None);
        }
        
        let data = std::mem::take(&mut self.buffer);
        let hash = sha256_hash(&data);
        let size = data.len() as u64;
        
        let chunk = RawChunk {
            index: self.current_index,
            data,
            hash,
            file_offset: self.current_offset,
        };
        
        self.current_index += 1;
        self.current_offset += size;
        
        Ok(Some(chunk))
    }
}

impl<R: Read> Iterator for AdaptiveChunkIterator<R> {
    type Item = SpkResult<RawChunk>;
    
    fn next(&mut self) -> Option<Self::Item> {
        if self.finished {
            return None;
        }
        
        match self.read_chunk() {
            Ok(Some(chunk)) => Some(Ok(chunk)),
            Ok(None) => None,
            Err(e) => {
                self.finished = true;
                Some(Err(e))
            }
        }
    }
}

/// Analyze data for optimal chunking strategy
pub struct ChunkAnalyzer {
    /// Entropy histogram
    entropy_samples: Vec<f64>,
    /// Size distribution
    size_samples: Vec<usize>,
}

impl ChunkAnalyzer {
    pub fn new() -> Self {
        Self {
            entropy_samples: Vec::new(),
            size_samples: Vec::new(),
        }
    }

    /// Analyze a sample of data
    pub fn analyze_sample(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        // Calculate entropy
        let mut counts = [0u64; 256];
        for &byte in data {
            counts[byte as usize] += 1;
        }

        let len = data.len() as f64;
        let mut entropy = 0.0;
        for &count in &counts {
            if count > 0 {
                let p = count as f64 / len;
                entropy -= p * p.log2();
            }
        }

        self.entropy_samples.push(entropy);
        self.size_samples.push(data.len());
    }

    /// Get recommended chunk configuration
    pub fn recommend_config(&self) -> AdaptiveChunkConfig {
        if self.entropy_samples.is_empty() {
            return AdaptiveChunkConfig::default();
        }

        let avg_entropy: f64 = self.entropy_samples.iter().sum::<f64>() 
            / self.entropy_samples.len() as f64;

        // High entropy (compressed/encrypted) = larger chunks
        // Low entropy (text/code) = smaller chunks for dedup
        if avg_entropy > 7.5 {
            AdaptiveChunkConfig::large()
        } else if avg_entropy < 5.0 {
            AdaptiveChunkConfig::small()
        } else {
            AdaptiveChunkConfig::default()
        }
    }

    /// Get average entropy
    pub fn average_entropy(&self) -> f64 {
        if self.entropy_samples.is_empty() {
            0.0
        } else {
            self.entropy_samples.iter().sum::<f64>() / self.entropy_samples.len() as f64
        }
    }
}

impl Default for ChunkAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_rolling_hash() {
        let mut hash = RollingHash::new(48);
        
        for byte in b"hello world" {
            hash.update(*byte);
        }
        
        let h1 = hash.value();
        
        // Reset and feed same data
        hash.reset();
        for byte in b"hello world" {
            hash.update(*byte);
        }
        
        assert_eq!(h1, hash.value());
    }

    #[test]
    fn test_adaptive_chunking() {
        // Create test data with some patterns
        let mut data = Vec::new();
        for i in 0..5_000_000 {
            data.push((i % 256) as u8);
        }
        
        let config = AdaptiveChunkConfig::default();
        let chunks: Vec<_> = AdaptiveChunkIterator::new(Cursor::new(&data), config)
            .map(|r| r.unwrap())
            .collect();
        
        // Should create multiple chunks
        assert!(!chunks.is_empty());
        
        // All chunks should be within size limits
        for chunk in &chunks {
            assert!(chunk.data.len() >= MIN_CHUNK_SIZE || chunk.index == chunks.len() as u64 - 1);
            assert!(chunk.data.len() <= MAX_CHUNK_SIZE);
        }
    }

    #[test]
    fn test_config_selection() {
        let small = AdaptiveChunkConfig::for_file_size(1_000_000);
        assert!(small.target_size < DEFAULT_CHUNK_SIZE);
        
        let large = AdaptiveChunkConfig::for_file_size(10_000_000_000);
        assert!(large.target_size > DEFAULT_CHUNK_SIZE);
    }

    #[test]
    fn test_chunk_analyzer() {
        let mut analyzer = ChunkAnalyzer::new();
        
        // Low entropy (repeated bytes)
        analyzer.analyze_sample(&[0u8; 1000]);
        assert!(analyzer.average_entropy() < 1.0);
        
        // Higher entropy
        let random_ish: Vec<u8> = (0..1000).map(|i| (i * 17 % 256) as u8).collect();
        analyzer.analyze_sample(&random_ish);
    }
}
