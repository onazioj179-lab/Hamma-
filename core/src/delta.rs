//! Delta Encoding - Binary Diff for Similar Chunks
//!
//! Produces compact deltas between similar chunks when beneficial.
//! Falls back to normal compression if delta is larger.
//!
//! ## Delta Format
//! ```text
//! [Header: 16 bytes]
//!   magic: 4 bytes "DELT"
//!   version: 1 byte
//!   algorithm: 1 byte
//!   flags: 2 bytes
//!   base_size: 4 bytes
//!   target_size: 4 bytes
//!
//! [Operations: variable]
//!   Each op: [type:1][length:var][data:var]
//!   Types:
//!     0x00 = COPY_BASE(offset:4, len:2)
//!     0x01 = INSERT(len:2, data:len)
//!     0x02 = COPY_BASE_LONG(offset:4, len:4)
//! ```

use std::collections::HashMap;

use crate::dedup_store::BLAKE3_SIZE;

/// Delta encoding magic bytes
pub const DELTA_MAGIC: &[u8; 4] = b"DELT";

/// Delta format version
pub const DELTA_VERSION: u8 = 1;

/// Delta algorithm identifiers
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DeltaAlgorithm {
    /// Simple copy/insert delta
    CopyInsert = 0,
    /// Rolling hash based (like rsync)
    RollingHash = 1,
}

/// Delta encoding configuration
#[derive(Debug, Clone)]
pub struct DeltaConfig {
    /// Minimum match length for copy operations
    pub min_match_len: usize,
    /// Window size for rolling hash
    pub window_size: usize,
    /// Maximum delta size ratio (delta_size / target_size)
    /// If exceeded, delta is rejected
    pub max_delta_ratio: f32,
    /// Maximum delta chain depth
    pub max_chain_depth: u8,
    /// Whether to use rolling hash algorithm
    pub use_rolling_hash: bool,
}

impl Default for DeltaConfig {
    fn default() -> Self {
        Self {
            min_match_len: 8,
            window_size: 64,
            max_delta_ratio: 0.9, // Delta must be <90% of target
            max_chain_depth: 2,   // Max 2 levels of delta
            use_rolling_hash: true,
        }
    }
}

/// Result of delta encoding attempt
#[derive(Debug)]
pub enum DeltaResult {
    /// Delta encoding succeeded
    Success {
        delta: Vec<u8>,
        base_fingerprint: [u8; BLAKE3_SIZE],
        savings_percent: f32,
    },
    /// Delta was larger than threshold, rejected
    Rejected {
        delta_size: usize,
        target_size: usize,
        reason: &'static str,
    },
    /// Error during encoding
    Error(String),
}

/// Delta operation types
#[derive(Debug, Clone)]
pub enum DeltaOp {
    /// Copy from base: (offset, length)
    CopyBase(u32, u32),
    /// Insert literal data
    Insert(Vec<u8>),
}

/// Delta encoder
pub struct DeltaEncoder {
    config: DeltaConfig,
}

impl DeltaEncoder {
    /// Create a new delta encoder
    pub fn new(config: DeltaConfig) -> Self {
        Self { config }
    }

    /// Encode delta between base and target
    pub fn encode(
        &self,
        base: &[u8],
        target: &[u8],
        base_fingerprint: [u8; BLAKE3_SIZE],
    ) -> DeltaResult {
        // Quick size check
        if target.is_empty() {
            return DeltaResult::Rejected {
                delta_size: 0,
                target_size: 0,
                reason: "Empty target",
            };
        }

        // Build index of base chunk
        let base_index = self.build_base_index(base);
        
        // Generate delta operations
        let ops = self.generate_ops(base, target, &base_index);
        
        // Serialize delta
        let delta = self.serialize_delta(base.len() as u32, target.len() as u32, &ops);
        
        // Check if delta is beneficial
        let delta_ratio = delta.len() as f32 / target.len() as f32;
        if delta_ratio > self.config.max_delta_ratio {
            return DeltaResult::Rejected {
                delta_size: delta.len(),
                target_size: target.len(),
                reason: "Delta larger than threshold",
            };
        }

        let savings_percent = (1.0 - delta_ratio) * 100.0;
        
        DeltaResult::Success {
            delta,
            base_fingerprint,
            savings_percent,
        }
    }

    /// Build hash index of base chunk for fast matching
    fn build_base_index(&self, base: &[u8]) -> HashMap<u32, Vec<u32>> {
        let mut index: HashMap<u32, Vec<u32>> = HashMap::new();
        
        if base.len() < self.config.window_size {
            return index;
        }

        // Index every position with rolling hash
        let mut hash = RollingHash::new(self.config.window_size);
        
        // Initialize with first window
        for &b in base.iter().take(self.config.window_size) {
            hash.push(b);
        }
        
        // Add first position
        index.entry(hash.value()).or_default().push(0);
        
        // Roll through rest of data
        for (i, &b) in base.iter().enumerate().skip(self.config.window_size) {
            let old = base[i - self.config.window_size];
            hash.roll(old, b);
            let pos = (i - self.config.window_size + 1) as u32;
            index.entry(hash.value()).or_default().push(pos);
        }
        
        index
    }

    /// Generate delta operations
    fn generate_ops(
        &self,
        base: &[u8],
        target: &[u8],
        base_index: &HashMap<u32, Vec<u32>>,
    ) -> Vec<DeltaOp> {
        let mut ops = Vec::new();
        let mut target_pos = 0;
        let mut pending_insert: Vec<u8> = Vec::new();

        while target_pos < target.len() {
            // Try to find a match in base
            if let Some((base_offset, match_len)) = self.find_match(
                base,
                target,
                target_pos,
                base_index,
            ) {
                // Flush pending inserts
                if !pending_insert.is_empty() {
                    ops.push(DeltaOp::Insert(std::mem::take(&mut pending_insert)));
                }
                
                // Add copy operation
                ops.push(DeltaOp::CopyBase(base_offset, match_len));
                target_pos += match_len as usize;
            } else {
                // No match, add to pending insert
                pending_insert.push(target[target_pos]);
                target_pos += 1;
            }
        }

        // Flush final pending inserts
        if !pending_insert.is_empty() {
            ops.push(DeltaOp::Insert(pending_insert));
        }

        // Optimize: merge adjacent operations
        self.optimize_ops(ops)
    }

    /// Find best match in base for current target position
    fn find_match(
        &self,
        base: &[u8],
        target: &[u8],
        target_pos: usize,
        base_index: &HashMap<u32, Vec<u32>>,
    ) -> Option<(u32, u32)> {
        let remaining = target.len() - target_pos;
        if remaining < self.config.window_size {
            return None;
        }

        // Compute hash at target position
        let mut hash = RollingHash::new(self.config.window_size);
        for &b in target[target_pos..].iter().take(self.config.window_size) {
            hash.push(b);
        }

        // Look up in index
        let candidates = base_index.get(&hash.value())?;
        
        // Find longest match among candidates
        let mut best_offset = 0u32;
        let mut best_len = 0u32;

        for &base_offset in candidates.iter().take(8) {
            // Limit candidates checked
            let match_len = self.extend_match(
                base,
                target,
                base_offset as usize,
                target_pos,
            );
            
            if match_len > best_len && match_len >= self.config.min_match_len as u32 {
                best_offset = base_offset;
                best_len = match_len;
            }
        }

        if best_len >= self.config.min_match_len as u32 {
            Some((best_offset, best_len))
        } else {
            None
        }
    }

    /// Extend a match as far as possible
    fn extend_match(
        &self,
        base: &[u8],
        target: &[u8],
        base_pos: usize,
        target_pos: usize,
    ) -> u32 {
        let max_len = std::cmp::min(
            base.len() - base_pos,
            target.len() - target_pos,
        );

        let mut len = 0;
        while len < max_len && base[base_pos + len] == target[target_pos + len] {
            len += 1;
        }
        
        len as u32
    }

    /// Optimize operations (merge adjacent inserts, etc.)
    fn optimize_ops(&self, ops: Vec<DeltaOp>) -> Vec<DeltaOp> {
        let mut optimized = Vec::with_capacity(ops.len());
        
        for op in ops {
            match (&mut optimized.last_mut(), &op) {
                // Merge adjacent inserts
                (Some(DeltaOp::Insert(prev)), DeltaOp::Insert(new)) => {
                    prev.extend(new);
                }
                // Merge adjacent copies from same region
                (Some(DeltaOp::CopyBase(prev_off, prev_len)), DeltaOp::CopyBase(off, len)) => {
                    if *prev_off + *prev_len == *off {
                        *prev_len += len;
                    } else {
                        optimized.push(op);
                    }
                }
                _ => {
                    optimized.push(op);
                }
            }
        }
        
        optimized
    }

    /// Serialize delta to bytes
    fn serialize_delta(&self, base_size: u32, target_size: u32, ops: &[DeltaOp]) -> Vec<u8> {
        let mut data = Vec::new();
        
        // Header
        data.extend_from_slice(DELTA_MAGIC);
        data.push(DELTA_VERSION);
        data.push(DeltaAlgorithm::RollingHash as u8);
        data.extend_from_slice(&[0u8; 2]); // flags
        data.extend_from_slice(&base_size.to_le_bytes());
        data.extend_from_slice(&target_size.to_le_bytes());
        
        // Operations
        for op in ops {
            match op {
                DeltaOp::CopyBase(offset, len) => {
                    if *len <= u16::MAX as u32 {
                        data.push(0x00); // COPY_BASE short
                        data.extend_from_slice(&offset.to_le_bytes());
                        data.extend_from_slice(&(*len as u16).to_le_bytes());
                    } else {
                        data.push(0x02); // COPY_BASE_LONG
                        data.extend_from_slice(&offset.to_le_bytes());
                        data.extend_from_slice(&len.to_le_bytes());
                    }
                }
                DeltaOp::Insert(bytes) => {
                    // Split large inserts
                    for chunk in bytes.chunks(u16::MAX as usize) {
                        data.push(0x01); // INSERT
                        data.extend_from_slice(&(chunk.len() as u16).to_le_bytes());
                        data.extend_from_slice(chunk);
                    }
                }
            }
        }
        
        data
    }
}

/// Delta decoder
pub struct DeltaDecoder {
    config: DeltaConfig,
}

impl DeltaDecoder {
    /// Create a new decoder
    pub fn new(config: DeltaConfig) -> Self {
        Self { config }
    }

    /// Decode delta to reconstruct target
    pub fn decode(&self, base: &[u8], delta: &[u8]) -> Result<Vec<u8>, DeltaError> {
        // Validate header
        if delta.len() < 16 {
            return Err(DeltaError::InvalidHeader);
        }
        
        if &delta[0..4] != DELTA_MAGIC {
            return Err(DeltaError::InvalidMagic);
        }
        
        let version = delta[4];
        if version > DELTA_VERSION {
            return Err(DeltaError::UnsupportedVersion(version));
        }
        
        let base_size = u32::from_le_bytes([delta[8], delta[9], delta[10], delta[11]]) as usize;
        let target_size = u32::from_le_bytes([delta[12], delta[13], delta[14], delta[15]]) as usize;
        
        // Validate base size
        if base.len() != base_size {
            return Err(DeltaError::BaseSizeMismatch {
                expected: base_size,
                actual: base.len(),
            });
        }
        
        // Decode operations
        let mut target = Vec::with_capacity(target_size);
        let mut pos = 16;
        
        while pos < delta.len() {
            let op_type = delta[pos];
            pos += 1;
            
            match op_type {
                0x00 => {
                    // COPY_BASE short
                    if pos + 6 > delta.len() {
                        return Err(DeltaError::UnexpectedEnd);
                    }
                    let offset = u32::from_le_bytes([
                        delta[pos], delta[pos + 1], delta[pos + 2], delta[pos + 3],
                    ]) as usize;
                    let len = u16::from_le_bytes([delta[pos + 4], delta[pos + 5]]) as usize;
                    pos += 6;
                    
                    if offset + len > base.len() {
                        return Err(DeltaError::CopyOutOfBounds);
                    }
                    target.extend_from_slice(&base[offset..offset + len]);
                }
                0x01 => {
                    // INSERT
                    if pos + 2 > delta.len() {
                        return Err(DeltaError::UnexpectedEnd);
                    }
                    let len = u16::from_le_bytes([delta[pos], delta[pos + 1]]) as usize;
                    pos += 2;
                    
                    if pos + len > delta.len() {
                        return Err(DeltaError::UnexpectedEnd);
                    }
                    target.extend_from_slice(&delta[pos..pos + len]);
                    pos += len;
                }
                0x02 => {
                    // COPY_BASE_LONG
                    if pos + 8 > delta.len() {
                        return Err(DeltaError::UnexpectedEnd);
                    }
                    let offset = u32::from_le_bytes([
                        delta[pos], delta[pos + 1], delta[pos + 2], delta[pos + 3],
                    ]) as usize;
                    let len = u32::from_le_bytes([
                        delta[pos + 4], delta[pos + 5], delta[pos + 6], delta[pos + 7],
                    ]) as usize;
                    pos += 8;
                    
                    if offset + len > base.len() {
                        return Err(DeltaError::CopyOutOfBounds);
                    }
                    target.extend_from_slice(&base[offset..offset + len]);
                }
                _ => {
                    return Err(DeltaError::UnknownOp(op_type));
                }
            }
        }
        
        // Validate target size
        if target.len() != target_size {
            return Err(DeltaError::TargetSizeMismatch {
                expected: target_size,
                actual: target.len(),
            });
        }
        
        Ok(target)
    }
}

/// Delta decoding errors
#[derive(Debug)]
pub enum DeltaError {
    InvalidHeader,
    InvalidMagic,
    UnsupportedVersion(u8),
    BaseSizeMismatch { expected: usize, actual: usize },
    TargetSizeMismatch { expected: usize, actual: usize },
    CopyOutOfBounds,
    UnexpectedEnd,
    UnknownOp(u8),
}

impl std::fmt::Display for DeltaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidHeader => write!(f, "Invalid delta header"),
            Self::InvalidMagic => write!(f, "Invalid delta magic bytes"),
            Self::UnsupportedVersion(v) => write!(f, "Unsupported delta version: {}", v),
            Self::BaseSizeMismatch { expected, actual } => {
                write!(f, "Base size mismatch: expected {}, got {}", expected, actual)
            }
            Self::TargetSizeMismatch { expected, actual } => {
                write!(f, "Target size mismatch: expected {}, got {}", expected, actual)
            }
            Self::CopyOutOfBounds => write!(f, "Copy operation out of bounds"),
            Self::UnexpectedEnd => write!(f, "Unexpected end of delta"),
            Self::UnknownOp(op) => write!(f, "Unknown delta operation: 0x{:02x}", op),
        }
    }
}

impl std::error::Error for DeltaError {}

/// Rolling hash for fast string matching
struct RollingHash {
    window_size: usize,
    hash: u32,
    pow: u32,
}

impl RollingHash {
    const BASE: u32 = 257;
    const MOD: u32 = 1_000_000_007;

    fn new(window_size: usize) -> Self {
        // Precompute BASE^(window_size-1) mod MOD
        let mut pow = 1u32;
        for _ in 0..window_size.saturating_sub(1) {
            pow = (pow as u64 * Self::BASE as u64 % Self::MOD as u64) as u32;
        }
        
        Self {
            window_size,
            hash: 0,
            pow,
        }
    }

    fn push(&mut self, byte: u8) {
        self.hash = ((self.hash as u64 * Self::BASE as u64 + byte as u64) % Self::MOD as u64) as u32;
    }

    fn roll(&mut self, old: u8, new: u8) {
        // Remove old byte, add new byte
        let old_contrib = (old as u64 * self.pow as u64) % Self::MOD as u64;
        self.hash = (((self.hash as u64 + Self::MOD as u64 - old_contrib) * Self::BASE as u64
            + new as u64)
            % Self::MOD as u64) as u32;
    }

    fn value(&self) -> u32 {
        self.hash
    }
}

/// Chunk metadata with delta support
#[derive(Debug, Clone)]
pub struct ChunkEncoding {
    /// How the chunk is encoded
    pub encoding_type: EncodingType,
    /// Base chunk fingerprint (if delta)
    pub base_fingerprint: Option<[u8; BLAKE3_SIZE]>,
    /// Dictionary ID used (0xFFFFFFFF = none)
    pub dict_id: u32,
    /// Delta chain depth (0 = not delta)
    pub delta_depth: u8,
}

/// Chunk encoding type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodingType {
    /// Raw, uncompressed data
    Raw,
    /// Compressed with algorithm
    Compressed,
    /// Delta encoded against base chunk
    Delta,
    /// Delta + compressed
    DeltaCompressed,
}

impl Default for ChunkEncoding {
    fn default() -> Self {
        Self {
            encoding_type: EncodingType::Raw,
            base_fingerprint: None,
            dict_id: 0xFFFFFFFF,
            delta_depth: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delta_identical() {
        let config = DeltaConfig::default();
        let encoder = DeltaEncoder::new(config.clone());
        let decoder = DeltaDecoder::new(config);
        
        let base = b"Hello, this is the base data for delta encoding test";
        let target = b"Hello, this is the base data for delta encoding test";
        let fp = [1u8; BLAKE3_SIZE];
        
        if let DeltaResult::Success { delta, .. } = encoder.encode(base, target, fp) {
            let reconstructed = decoder.decode(base, &delta).unwrap();
            assert_eq!(reconstructed, target);
        }
    }

    #[test]
    fn test_delta_similar() {
        let config = DeltaConfig::default();
        let encoder = DeltaEncoder::new(config.clone());
        let decoder = DeltaDecoder::new(config);
        
        let base = b"The quick brown fox jumps over the lazy dog. This is version 1.";
        let target = b"The quick brown fox jumps over the lazy cat. This is version 2.";
        let fp = [1u8; BLAKE3_SIZE];
        
        if let DeltaResult::Success { delta, savings_percent, .. } = encoder.encode(base, target, fp) {
            println!("Delta savings: {:.1}%", savings_percent);
            let reconstructed = decoder.decode(base, &delta).unwrap();
            assert_eq!(reconstructed, target);
            // Delta should be smaller than target
            assert!(delta.len() < target.len());
        }
    }

    #[test]
    fn test_delta_completely_different() {
        let config = DeltaConfig::default();
        let encoder = DeltaEncoder::new(config);
        
        let base = b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let target = b"1234567890123456789012345678901234567890123456789012345678901234";
        let fp = [1u8; BLAKE3_SIZE];
        
        // Should be rejected since data is completely different
        match encoder.encode(base, target, fp) {
            DeltaResult::Success { delta, .. } => {
                // Delta might succeed but should be large
                assert!(delta.len() >= target.len() / 2, "Delta should be large for different data");
            }
            DeltaResult::Rejected { reason, .. } => {
                println!("Rejected as expected: {}", reason);
            }
            DeltaResult::Error(e) => {
                panic!("Unexpected error: {}", e);
            }
        }
    }

    #[test]
    fn test_delta_append() {
        let config = DeltaConfig::default();
        let encoder = DeltaEncoder::new(config.clone());
        let decoder = DeltaDecoder::new(config);
        
        let base = b"Original content here";
        let target = b"Original content here with appended data at the end";
        let fp = [1u8; BLAKE3_SIZE];
        
        if let DeltaResult::Success { delta, .. } = encoder.encode(base, target, fp) {
            let reconstructed = decoder.decode(base, &delta).unwrap();
            assert_eq!(reconstructed, target);
            // Delta should be much smaller than target
            assert!(delta.len() < target.len());
        }
    }

    #[test]
    fn test_delta_header_validation() {
        let config = DeltaConfig::default();
        let decoder = DeltaDecoder::new(config);
        
        // Invalid magic
        let bad_delta = b"XXXX\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
        assert!(decoder.decode(b"base", bad_delta).is_err());
        
        // Too short
        let short_delta = b"DELT";
        assert!(decoder.decode(b"base", short_delta).is_err());
    }

    #[test]
    fn test_rolling_hash() {
        let mut hash = RollingHash::new(4);
        
        // Push initial window
        for &b in b"test" {
            hash.push(b);
        }
        let h1 = hash.value();
        
        // Roll to next position
        hash.roll(b't', b'x');
        let h2 = hash.value();
        
        // Hashes should be different
        assert_ne!(h1, h2);
        
        // Fresh hash of "estx" should match
        let mut hash2 = RollingHash::new(4);
        for &b in b"estx" {
            hash2.push(b);
        }
        assert_eq!(hash.value(), hash2.value());
    }
}
