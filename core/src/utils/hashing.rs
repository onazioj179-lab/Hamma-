//! Hashing utilities for SPK
//!
//! Provides SHA-256, CRC32, and BLAKE3 hashing with streaming support.
//! V1: SHA-256 for chunk integrity
//! V2: CRC32 + SHA-256 double hashing

use sha2::{Sha256, Digest as Sha256Digest};
use crc32fast::Hasher as Crc32Hasher;
use blake3::Hasher as Blake3Hasher;
use std::io::{Read, BufReader};

use super::error::SpkResult;

/// SHA-256 hash (32 bytes) - primary hash for V1
pub const SHA256_SIZE: usize = 32;

/// CRC32 checksum size
pub const CRC32_SIZE: usize = 4;

/// BLAKE3 hash size (32 bytes)
pub const BLAKE3_SIZE: usize = 32;

/// Compute SHA-256 hash of data
pub fn sha256_hash(data: &[u8]) -> [u8; SHA256_SIZE] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Compute SHA-256 hash from a reader (streaming)
pub fn sha256_hash_reader<R: Read>(reader: R) -> SpkResult<[u8; SHA256_SIZE]> {
    let mut hasher = Sha256::new();
    let mut buf_reader = BufReader::with_capacity(64 * 1024, reader);
    let mut buffer = [0u8; 64 * 1024];
    
    loop {
        let bytes_read = buf_reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    
    Ok(hasher.finalize().into())
}

/// Compute CRC32 checksum of data (for V2 double-hashing)
pub fn crc32_checksum(data: &[u8]) -> u32 {
    let mut hasher = Crc32Hasher::new();
    hasher.update(data);
    hasher.finalize()
}

/// Compute CRC32 from a reader (streaming)
pub fn crc32_checksum_reader<R: Read>(reader: R) -> SpkResult<u32> {
    let mut hasher = Crc32Hasher::new();
    let mut buf_reader = BufReader::with_capacity(64 * 1024, reader);
    let mut buffer = [0u8; 64 * 1024];
    
    loop {
        let bytes_read = buf_reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    
    Ok(hasher.finalize())
}

/// Compute BLAKE3 hash (fast hashing for dedup in V4)
pub fn blake3_hash(data: &[u8]) -> [u8; BLAKE3_SIZE] {
    let mut hasher = Blake3Hasher::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Compute BLAKE3 hash from a reader (streaming)
pub fn blake3_hash_reader<R: Read>(reader: R) -> SpkResult<[u8; BLAKE3_SIZE]> {
    let mut hasher = Blake3Hasher::new();
    let mut buf_reader = BufReader::with_capacity(64 * 1024, reader);
    let mut buffer = [0u8; 64 * 1024];
    
    loop {
        let bytes_read = buf_reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    
    Ok(hasher.finalize().into())
}

/// V2 Double Hash: combines CRC32 (fast) + SHA-256 (secure)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoubleHash {
    pub crc32: u32,
    pub sha256: [u8; SHA256_SIZE],
}

impl DoubleHash {
    /// Compute double hash of data
    pub fn compute(data: &[u8]) -> Self {
        Self {
            crc32: crc32_checksum(data),
            sha256: sha256_hash(data),
        }
    }

    /// Verify data matches this double hash
    pub fn verify(&self, data: &[u8]) -> bool {
        // Fast CRC32 check first
        if crc32_checksum(data) != self.crc32 {
            return false;
        }
        // Then full SHA-256
        sha256_hash(data) == self.sha256
    }

    /// Convert to bytes (4 + 32 = 36 bytes)
    pub fn to_bytes(&self) -> [u8; 36] {
        let mut bytes = [0u8; 36];
        bytes[0..4].copy_from_slice(&self.crc32.to_le_bytes());
        bytes[4..36].copy_from_slice(&self.sha256);
        bytes
    }

    /// Parse from bytes
    pub fn from_bytes(data: &[u8; 36]) -> Self {
        let crc32 = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        let mut sha256 = [0u8; SHA256_SIZE];
        sha256.copy_from_slice(&data[4..36]);
        Self { crc32, sha256 }
    }
}

/// Hash a file content identifier for deduplication (V4)
pub fn content_hash_for_dedup(data: &[u8]) -> [u8; BLAKE3_SIZE] {
    // BLAKE3 is faster than SHA-256 for dedup purposes
    blake3_hash(data)
}

/// Incremental hasher for streaming operations
pub struct IncrementalSha256 {
    hasher: Sha256,
}

impl IncrementalSha256 {
    pub fn new() -> Self {
        Self {
            hasher: Sha256::new(),
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        self.hasher.update(data);
    }

    pub fn finalize(self) -> [u8; SHA256_SIZE] {
        self.hasher.finalize().into()
    }
}

impl Default for IncrementalSha256 {
    fn default() -> Self {
        Self::new()
    }
}

/// Incremental BLAKE3 hasher
pub struct IncrementalBlake3 {
    hasher: Blake3Hasher,
}

impl IncrementalBlake3 {
    pub fn new() -> Self {
        Self {
            hasher: Blake3Hasher::new(),
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        self.hasher.update(data);
    }

    pub fn finalize(self) -> [u8; BLAKE3_SIZE] {
        self.hasher.finalize().into()
    }
}

impl Default for IncrementalBlake3 {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_hash() {
        let data = b"hello world";
        let hash = sha256_hash(data);
        assert_eq!(hash.len(), SHA256_SIZE);
        
        // Same data should produce same hash
        let hash2 = sha256_hash(data);
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_crc32() {
        let data = b"hello world";
        let checksum = crc32_checksum(data);
        
        // Should be consistent
        assert_eq!(checksum, crc32_checksum(data));
    }

    #[test]
    fn test_blake3() {
        let data = b"hello world";
        let hash = blake3_hash(data);
        assert_eq!(hash.len(), BLAKE3_SIZE);
    }

    #[test]
    fn test_double_hash() {
        let data = b"test data for double hashing";
        let hash = DoubleHash::compute(data);
        
        assert!(hash.verify(data));
        assert!(!hash.verify(b"different data"));

        // Test serialization
        let bytes = hash.to_bytes();
        let parsed = DoubleHash::from_bytes(&bytes);
        assert_eq!(hash, parsed);
    }

    #[test]
    fn test_incremental_hasher() {
        let full_data = b"hello world";
        let full_hash = sha256_hash(full_data);

        let mut incremental = IncrementalSha256::new();
        incremental.update(b"hello ");
        incremental.update(b"world");
        let incremental_hash = incremental.finalize();

        assert_eq!(full_hash, incremental_hash);
    }

    #[test]
    fn test_streaming_hash() {
        use std::io::Cursor;
        
        let data = b"hello world streaming test";
        let direct_hash = sha256_hash(data);
        
        let cursor = Cursor::new(data);
        let streaming_hash = sha256_hash_reader(cursor).unwrap();
        
        assert_eq!(direct_hash, streaming_hash);
    }
}
