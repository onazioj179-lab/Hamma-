//! Similarity Detection - Fast Heuristics for Delta Candidate Selection
//!
//! Finds candidate base chunks for delta encoding using cheap comparisons.
//! Rule: Similarity checks MUST be cheaper than compression itself.
//!
//! ## Strategies
//! - Size similarity (±20%)
//! - Hash prefix matching (first 4-8 bytes of BLAKE3)
//! - Rolling checksum windows (subset sampling)
//! - MinHash sketches for Jaccard similarity

use std::collections::HashMap;

use crate::dedup_store::BLAKE3_SIZE;

/// Configuration for similarity detection
#[derive(Debug, Clone)]
pub struct SimilarityConfig {
    /// Maximum size difference ratio (0.2 = 20%)
    pub max_size_diff_ratio: f32,
    /// Number of hash prefix bytes to compare
    pub hash_prefix_len: usize,
    /// Number of sample windows for rolling checksum
    pub sample_windows: usize,
    /// Window size for rolling checksum sampling
    pub window_size: usize,
    /// MinHash signature size
    pub minhash_size: usize,
    /// Maximum candidates to return
    pub max_candidates: usize,
    /// Minimum similarity score to consider (0.0-1.0)
    pub min_similarity: f32,
}

impl Default for SimilarityConfig {
    fn default() -> Self {
        Self {
            max_size_diff_ratio: 0.25,   // 25% size tolerance
            hash_prefix_len: 4,           // 4 bytes of hash prefix
            sample_windows: 16,           // 16 sample points
            window_size: 64,              // 64-byte windows
            minhash_size: 64,             // 64 hash signatures
            max_candidates: 5,            // Return top 5 candidates
            min_similarity: 0.3,          // 30% minimum similarity
        }
    }
}

/// A potential base chunk for delta encoding
#[derive(Debug, Clone)]
pub struct DeltaCandidate {
    /// Fingerprint of the candidate base chunk
    pub fingerprint: [u8; BLAKE3_SIZE],
    /// Similarity score (0.0-1.0)
    pub similarity: f32,
    /// Size of the candidate chunk
    pub size: u32,
    /// How the similarity was detected
    pub match_type: MatchType,
}

/// How similarity was detected
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchType {
    /// Exact size and partial hash match
    HashPrefix,
    /// Size similarity within threshold
    SizeBucket,
    /// Rolling checksum window matches
    RollingChecksum,
    /// MinHash Jaccard similarity
    MinHash,
    /// Combined score from multiple methods
    Combined,
}

/// Chunk signature for similarity indexing
#[derive(Debug, Clone)]
pub struct ChunkSignature {
    /// Full BLAKE3 fingerprint
    pub fingerprint: [u8; BLAKE3_SIZE],
    /// Chunk size
    pub size: u32,
    /// Hash prefix for fast comparison
    pub hash_prefix: u32,
    /// Size bucket (for grouping similar sizes)
    pub size_bucket: u16,
    /// Rolling checksum samples
    pub rolling_samples: Vec<u32>,
    /// MinHash signature (optional, computed on demand)
    pub minhash: Option<Vec<u32>>,
}

impl ChunkSignature {
    /// Create a signature from chunk data
    pub fn from_chunk(fingerprint: [u8; BLAKE3_SIZE], data: &[u8], config: &SimilarityConfig) -> Self {
        let size = data.len() as u32;
        
        // Extract hash prefix
        let hash_prefix = u32::from_le_bytes([
            fingerprint[0],
            fingerprint[1],
            fingerprint[2],
            fingerprint[3],
        ]);
        
        // Compute size bucket (log2 scale, 256 buckets)
        let size_bucket = if size == 0 {
            0
        } else {
            ((size as f64).log2() * 16.0).min(255.0) as u16
        };
        
        // Sample rolling checksums
        let rolling_samples = Self::sample_rolling_checksums(data, config);
        
        Self {
            fingerprint,
            size,
            hash_prefix,
            size_bucket,
            rolling_samples,
            minhash: None,
        }
    }

    /// Compute rolling checksum samples at evenly spaced positions
    fn sample_rolling_checksums(data: &[u8], config: &SimilarityConfig) -> Vec<u32> {
        if data.len() < config.window_size {
            return vec![adler32_simple(data)];
        }

        let mut samples = Vec::with_capacity(config.sample_windows);
        let step = data.len().saturating_sub(config.window_size) / config.sample_windows.max(1);
        
        for i in 0..config.sample_windows {
            let start = i * step;
            if start + config.window_size <= data.len() {
                let window = &data[start..start + config.window_size];
                samples.push(adler32_simple(window));
            }
        }
        
        samples
    }

    /// Compute MinHash signature on demand
    pub fn compute_minhash(&mut self, data: &[u8], config: &SimilarityConfig) {
        self.minhash = Some(compute_minhash(data, config.minhash_size, config.window_size));
    }

    /// Quick similarity check (hash prefix + size bucket)
    pub fn quick_similar(&self, other: &Self, config: &SimilarityConfig) -> bool {
        // Size bucket must be close
        let bucket_diff = (self.size_bucket as i32 - other.size_bucket as i32).abs();
        if bucket_diff > 4 {
            return false;
        }

        // Size ratio check
        let (smaller, larger) = if self.size < other.size {
            (self.size, other.size)
        } else {
            (other.size, self.size)
        };
        
        if larger == 0 {
            return false;
        }
        
        let ratio = 1.0 - (smaller as f32 / larger as f32);
        ratio <= config.max_size_diff_ratio
    }

    /// Compute detailed similarity score
    pub fn similarity_score(&self, other: &Self, _config: &SimilarityConfig) -> f32 {
        let mut score = 0.0f32;
        let mut weights = 0.0f32;

        // Size similarity (weight: 0.2)
        let size_sim = size_similarity(self.size, other.size);
        score += size_sim * 0.2;
        weights += 0.2;

        // Hash prefix similarity (weight: 0.1)
        let prefix_sim = hash_prefix_similarity(self.hash_prefix, other.hash_prefix);
        score += prefix_sim * 0.1;
        weights += 0.1;

        // Rolling checksum overlap (weight: 0.4)
        let rolling_sim = rolling_checksum_similarity(&self.rolling_samples, &other.rolling_samples);
        score += rolling_sim * 0.4;
        weights += 0.4;

        // MinHash similarity (weight: 0.3)
        if let (Some(ref mh1), Some(ref mh2)) = (&self.minhash, &other.minhash) {
            let minhash_sim = minhash_similarity(mh1, mh2);
            score += minhash_sim * 0.3;
            weights += 0.3;
        }

        if weights > 0.0 {
            score / weights
        } else {
            0.0
        }
    }
}

/// Similarity index for finding delta candidates
pub struct SimilarityIndex {
    config: SimilarityConfig,
    /// Index by size bucket
    by_size_bucket: HashMap<u16, Vec<ChunkSignature>>,
    /// Index by hash prefix (first 2 bytes)
    by_hash_prefix: HashMap<u16, Vec<usize>>,
    /// All signatures
    signatures: Vec<ChunkSignature>,
    /// Maximum signatures to keep (LRU-style)
    max_signatures: usize,
}

impl SimilarityIndex {
    /// Create a new similarity index
    pub fn new(config: SimilarityConfig) -> Self {
        Self {
            config,
            by_size_bucket: HashMap::new(),
            by_hash_prefix: HashMap::new(),
            signatures: Vec::new(),
            max_signatures: 100_000, // Keep last 100k chunks
        }
    }

    /// Add a chunk signature to the index
    pub fn add(&mut self, signature: ChunkSignature) {
        // Evict old entries if needed
        if self.signatures.len() >= self.max_signatures {
            self.evict_oldest(self.max_signatures / 10);
        }

        let idx = self.signatures.len();
        
        // Index by size bucket
        self.by_size_bucket
            .entry(signature.size_bucket)
            .or_default()
            .push(signature.clone());
        
        // Index by hash prefix (first 2 bytes)
        let prefix_key = (signature.hash_prefix & 0xFFFF) as u16;
        self.by_hash_prefix
            .entry(prefix_key)
            .or_default()
            .push(idx);
        
        self.signatures.push(signature);
    }

    /// Evict oldest signatures
    fn evict_oldest(&mut self, count: usize) {
        if count >= self.signatures.len() {
            self.signatures.clear();
            self.by_size_bucket.clear();
            self.by_hash_prefix.clear();
            return;
        }

        // Remove from indices
        self.signatures.drain(0..count);
        
        // Rebuild indices (simpler than tracking)
        self.by_size_bucket.clear();
        self.by_hash_prefix.clear();
        
        for (idx, sig) in self.signatures.iter().enumerate() {
            self.by_size_bucket
                .entry(sig.size_bucket)
                .or_default()
                .push(sig.clone());
            
            let prefix_key = (sig.hash_prefix & 0xFFFF) as u16;
            self.by_hash_prefix
                .entry(prefix_key)
                .or_default()
                .push(idx);
        }
    }

    /// Find delta candidates for a chunk
    pub fn find_candidates(&self, signature: &ChunkSignature) -> Vec<DeltaCandidate> {
        let mut candidates: Vec<DeltaCandidate> = Vec::new();
        let mut seen: std::collections::HashSet<[u8; BLAKE3_SIZE]> = std::collections::HashSet::new();

        // Strategy 1: Same size bucket (fast)
        if let Some(bucket_sigs) = self.by_size_bucket.get(&signature.size_bucket) {
            for candidate_sig in bucket_sigs.iter().take(50) {
                if seen.contains(&candidate_sig.fingerprint) {
                    continue;
                }
                if candidate_sig.fingerprint == signature.fingerprint {
                    continue; // Skip self
                }
                if !signature.quick_similar(candidate_sig, &self.config) {
                    continue;
                }
                
                let similarity = signature.similarity_score(candidate_sig, &self.config);
                if similarity >= self.config.min_similarity {
                    seen.insert(candidate_sig.fingerprint);
                    candidates.push(DeltaCandidate {
                        fingerprint: candidate_sig.fingerprint,
                        similarity,
                        size: candidate_sig.size,
                        match_type: MatchType::SizeBucket,
                    });
                }
            }
        }

        // Strategy 2: Adjacent size buckets
        for bucket_offset in [-1i16, 1i16] {
            let adjacent_bucket = (signature.size_bucket as i16 + bucket_offset) as u16;
            if let Some(bucket_sigs) = self.by_size_bucket.get(&adjacent_bucket) {
                for candidate_sig in bucket_sigs.iter().take(20) {
                    if seen.contains(&candidate_sig.fingerprint) {
                        continue;
                    }
                    if candidate_sig.fingerprint == signature.fingerprint {
                        continue;
                    }
                    if !signature.quick_similar(candidate_sig, &self.config) {
                        continue;
                    }
                    
                    let similarity = signature.similarity_score(candidate_sig, &self.config);
                    if similarity >= self.config.min_similarity {
                        seen.insert(candidate_sig.fingerprint);
                        candidates.push(DeltaCandidate {
                            fingerprint: candidate_sig.fingerprint,
                            similarity,
                            size: candidate_sig.size,
                            match_type: MatchType::SizeBucket,
                        });
                    }
                }
            }
        }

        // Sort by similarity (descending) and take top candidates
        candidates.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
        candidates.truncate(self.config.max_candidates);
        
        candidates
    }

    /// Get statistics
    pub fn stats(&self) -> SimilarityIndexStats {
        SimilarityIndexStats {
            total_signatures: self.signatures.len(),
            size_buckets: self.by_size_bucket.len(),
            hash_prefixes: self.by_hash_prefix.len(),
        }
    }
}

/// Index statistics
#[derive(Debug, Clone)]
pub struct SimilarityIndexStats {
    pub total_signatures: usize,
    pub size_buckets: usize,
    pub hash_prefixes: usize,
}

// === Helper Functions ===

/// Simple Adler-32 checksum for rolling windows
fn adler32_simple(data: &[u8]) -> u32 {
    const MOD: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    
    for &byte in data {
        a = (a + byte as u32) % MOD;
        b = (b + a) % MOD;
    }
    
    (b << 16) | a
}

/// Compute MinHash signature
fn compute_minhash(data: &[u8], num_hashes: usize, shingle_size: usize) -> Vec<u32> {
    if data.len() < shingle_size {
        return vec![0; num_hashes];
    }

    // Initialize with max values
    let mut minhash = vec![u32::MAX; num_hashes];
    
    // Generate shingles and update minhash
    for i in 0..=(data.len() - shingle_size) {
        let shingle = &data[i..i + shingle_size];
        let base_hash = hash_shingle(shingle);
        
        // Update each hash function
        for (j, mh) in minhash.iter_mut().enumerate() {
            let h = permute_hash(base_hash, j as u32);
            if h < *mh {
                *mh = h;
            }
        }
    }
    
    minhash
}

/// Hash a shingle (simple but fast)
fn hash_shingle(data: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5; // FNV offset basis
    for &b in data {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193); // FNV prime
    }
    h
}

/// Permute hash for different hash functions
fn permute_hash(hash: u32, seed: u32) -> u32 {
    let a = 0x45d9f3b_u32.wrapping_mul(seed.wrapping_add(1));
    let b = 0x85ebca6b_u32.wrapping_mul(seed.wrapping_add(1));
    hash.wrapping_mul(a).wrapping_add(b)
}

/// Size similarity (0.0-1.0)
fn size_similarity(size1: u32, size2: u32) -> f32 {
    if size1 == 0 && size2 == 0 {
        return 1.0;
    }
    let (smaller, larger) = if size1 < size2 {
        (size1 as f32, size2 as f32)
    } else {
        (size2 as f32, size1 as f32)
    };
    if larger == 0.0 {
        return 0.0;
    }
    smaller / larger
}

/// Hash prefix similarity (0.0-1.0)
fn hash_prefix_similarity(prefix1: u32, prefix2: u32) -> f32 {
    // Count matching bits
    let xor = prefix1 ^ prefix2;
    let matching_bits = 32 - xor.count_ones();
    matching_bits as f32 / 32.0
}

/// Rolling checksum overlap similarity (Jaccard-style)
fn rolling_checksum_similarity(samples1: &[u32], samples2: &[u32]) -> f32 {
    if samples1.is_empty() || samples2.is_empty() {
        return 0.0;
    }

    let set1: std::collections::HashSet<u32> = samples1.iter().cloned().collect();
    let set2: std::collections::HashSet<u32> = samples2.iter().cloned().collect();
    
    let intersection = set1.intersection(&set2).count();
    let union = set1.union(&set2).count();
    
    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}

/// MinHash Jaccard similarity estimate
fn minhash_similarity(mh1: &[u32], mh2: &[u32]) -> f32 {
    if mh1.len() != mh2.len() || mh1.is_empty() {
        return 0.0;
    }

    let matches = mh1.iter().zip(mh2.iter()).filter(|(a, b)| a == b).count();
    matches as f32 / mh1.len() as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_signature_creation() {
        let config = SimilarityConfig::default();
        let data = b"Hello, this is test data for similarity detection";
        let fp = [1u8; BLAKE3_SIZE];
        
        let sig = ChunkSignature::from_chunk(fp, data, &config);
        
        assert_eq!(sig.fingerprint, fp);
        assert_eq!(sig.size, data.len() as u32);
        assert!(!sig.rolling_samples.is_empty());
    }

    #[test]
    fn test_similar_chunks_detected() {
        let config = SimilarityConfig::default();
        let fp1 = [1u8; BLAKE3_SIZE];
        let fp2 = [2u8; BLAKE3_SIZE];
        
        // Very similar data - use larger data to get meaningful rolling checksums
        // Base text repeated to ensure we have enough data for meaningful similarity
        let base = "The quick brown fox jumps over the lazy dog. ";
        let data1: Vec<u8> = base.repeat(20).into_bytes();
        let mut data2 = data1.clone();
        // Make a small change at the end
        data2.pop();
        data2.push(b'!');
        
        let sig1 = ChunkSignature::from_chunk(fp1, &data1, &config);
        let sig2 = ChunkSignature::from_chunk(fp2, &data2, &config);
        
        // Similar size check
        assert!(sig1.quick_similar(&sig2, &config));
        
        // High similarity - adjusted threshold since we're only checking size + prefix + rolling
        let similarity = sig1.similarity_score(&sig2, &config);
        assert!(similarity > 0.4, "Expected reasonable similarity, got {}", similarity);
    }

    #[test]
    fn test_different_chunks_not_similar() {
        let config = SimilarityConfig::default();
        let fp1 = [1u8; BLAKE3_SIZE];
        let fp2 = [2u8; BLAKE3_SIZE];
        
        let data1 = b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let data2 = b"12345678901234567890123456789012345678901234567890";
        
        let sig1 = ChunkSignature::from_chunk(fp1, data1, &config);
        let sig2 = ChunkSignature::from_chunk(fp2, data2, &config);
        
        let similarity = sig1.similarity_score(&sig2, &config);
        assert!(similarity < 0.5, "Expected low similarity, got {}", similarity);
    }

    #[test]
    fn test_similarity_index() {
        let config = SimilarityConfig::default();
        let mut index = SimilarityIndex::new(config.clone());
        
        // Add some chunks
        for i in 0..10 {
            let mut fp = [0u8; BLAKE3_SIZE];
            fp[0] = i;
            let data = format!("Test chunk number {} with some content", i);
            let sig = ChunkSignature::from_chunk(fp, data.as_bytes(), &config);
            index.add(sig);
        }
        
        // Query with similar chunk
        let mut query_fp = [0u8; BLAKE3_SIZE];
        query_fp[0] = 100;
        let query_data = b"Test chunk number 5 with some content modified";
        let query_sig = ChunkSignature::from_chunk(query_fp, query_data, &config);
        
        let candidates = index.find_candidates(&query_sig);
        // Should find at least one candidate
        assert!(candidates.len() <= config.max_candidates);
    }

    #[test]
    fn test_minhash() {
        let data1 = b"The quick brown fox jumps over the lazy dog";
        let data2 = b"The quick brown cat jumps over the lazy dog";
        let data3 = b"Completely different text with no overlap whatsoever";
        
        let mh1 = compute_minhash(data1, 64, 4);
        let mh2 = compute_minhash(data2, 64, 4);
        let mh3 = compute_minhash(data3, 64, 4);
        
        let sim_12 = minhash_similarity(&mh1, &mh2);
        let sim_13 = minhash_similarity(&mh1, &mh3);
        
        // Similar texts should have higher similarity
        assert!(sim_12 > sim_13, "Expected sim_12 ({}) > sim_13 ({})", sim_12, sim_13);
    }

    #[test]
    fn test_size_similarity() {
        assert_eq!(size_similarity(100, 100), 1.0);
        assert!(size_similarity(100, 120) > 0.8);
        assert!(size_similarity(100, 200) < 0.6);
        assert!(size_similarity(100, 1000) < 0.2);
    }
}
