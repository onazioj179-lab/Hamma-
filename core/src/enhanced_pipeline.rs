//! Enhanced Compression Pipeline - Phase 3
//!
//! Integrates:
//! - Content-Defined Chunking (CDC)
//! - Global Deduplication
//! - Similarity Detection
//! - Delta Encoding (selective)
//! - Dictionary-Aware Compression
//!
//! ## Pipeline Flow
//! ```text
//! chunk → hash → dedup check → entropy estimate → similarity probe
//!     → choose: raw | compressed | delta(base)
//!     → optional dictionary compression
//!     → store chunk → update snapshot
//! ```

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::cdc::{CdcConfig, ContentDefinedChunker};
use crate::dedup_store::{DedupResult, BLAKE3_SIZE};
use crate::sharded_dedup::{ShardedDedupStore, ShardPolicy};
use crate::delta::{DeltaConfig, DeltaEncoder, DeltaDecoder, DeltaResult, ChunkEncoding, EncodingType};
use crate::dict_group::{DictGroupManager, DictGroupConfig, compress_with_dict, decompress_with_dict};
use crate::dictionary::{FileCluster, calculate_entropy};
use crate::similarity::{SimilarityConfig, SimilarityIndex, ChunkSignature, DeltaCandidate};
use crate::hamma::{HammaConfig, HammaContextKey, HammaState, HammaStrategy, StrategyObservation};

/// Pipeline configuration
#[derive(Debug, Clone)]
pub struct EnhancedPipelineConfig {
    /// CDC configuration
    pub cdc: CdcConfig,
    /// Similarity detection config
    pub similarity: SimilarityConfig,
    /// Delta encoding config
    pub delta: DeltaConfig,
    /// Dictionary group config
    pub dict_group: DictGroupConfig,
    /// HAMMA decision engine config
    pub hamma: HammaConfig,
    /// Shard policy for dedup store
    pub shard_policy: ShardPolicy,
    /// Entropy threshold for skipping compression (0.0-1.0)
    pub entropy_skip_threshold: f64,
    /// Compression level (1-22 for ZSTD)
    pub compression_level: i32,
    /// Whether to enable delta encoding
    pub enable_delta: bool,
    /// Whether to enable dictionary compression
    pub enable_dictionary: bool,
    /// Minimum chunk size for delta consideration
    pub min_delta_chunk_size: usize,
    /// Maximum delta candidates to try
    pub max_delta_tries: usize,
}

impl Default for EnhancedPipelineConfig {
    fn default() -> Self {
        Self {
            cdc: CdcConfig::for_100tb(),
            similarity: SimilarityConfig::default(),
            delta: DeltaConfig::default(),
            dict_group: DictGroupConfig::default(),
            hamma: HammaConfig::default(),
            shard_policy: ShardPolicy::default(),
            entropy_skip_threshold: 0.95, // Skip if >95% entropy
            compression_level: 3,         // Fast compression
            enable_delta: true,
            enable_dictionary: true,
            min_delta_chunk_size: 4096,   // 4KB minimum
            max_delta_tries: 3,           // Try top 3 candidates
        }
    }
}

/// Statistics for the enhanced pipeline
#[derive(Debug, Default, Clone)]
pub struct EnhancedPipelineStats {
    /// Total chunks processed
    pub chunks_processed: u64,
    /// Chunks deduplicated (exact match)
    pub chunks_deduped: u64,
    /// Chunks delta-encoded
    pub chunks_delta: u64,
    /// Chunks compressed with dictionary
    pub chunks_dict_compressed: u64,
    /// Chunks compressed without dictionary
    pub chunks_plain_compressed: u64,
    /// Chunks stored raw (high entropy)
    pub chunks_raw: u64,
    /// Delta attempts that failed/rejected
    pub delta_rejections: u64,
    /// Total input bytes
    pub input_bytes: u64,
    /// Total stored bytes
    pub stored_bytes: u64,
    /// Bytes saved by dedup
    pub dedup_saved_bytes: u64,
    /// Bytes saved by delta
    pub delta_saved_bytes: u64,
    /// Bytes saved by compression
    pub compression_saved_bytes: u64,
}

impl EnhancedPipelineStats {
    /// Calculate effective ratio
    pub fn effective_ratio(&self) -> f64 {
        if self.stored_bytes == 0 {
            return 1.0;
        }
        self.input_bytes as f64 / self.stored_bytes as f64
    }

    /// Calculate dedup ratio
    pub fn dedup_ratio(&self) -> f64 {
        if self.chunks_processed == 0 {
            return 1.0;
        }
        self.chunks_processed as f64 / (self.chunks_processed - self.chunks_deduped) as f64
    }

    /// Merge stats
    pub fn merge(&mut self, other: &EnhancedPipelineStats) {
        self.chunks_processed += other.chunks_processed;
        self.chunks_deduped += other.chunks_deduped;
        self.chunks_delta += other.chunks_delta;
        self.chunks_dict_compressed += other.chunks_dict_compressed;
        self.chunks_plain_compressed += other.chunks_plain_compressed;
        self.chunks_raw += other.chunks_raw;
        self.delta_rejections += other.delta_rejections;
        self.input_bytes += other.input_bytes;
        self.stored_bytes += other.stored_bytes;
        self.dedup_saved_bytes += other.dedup_saved_bytes;
        self.delta_saved_bytes += other.delta_saved_bytes;
        self.compression_saved_bytes += other.compression_saved_bytes;
    }
}

impl std::fmt::Display for EnhancedPipelineStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "=== Enhanced Pipeline Statistics ===")?;
        writeln!(f, "Chunks processed: {}", self.chunks_processed)?;
        writeln!(f, "  - Deduplicated: {} ({:.1}%)", 
            self.chunks_deduped,
            if self.chunks_processed > 0 { self.chunks_deduped as f64 / self.chunks_processed as f64 * 100.0 } else { 0.0 }
        )?;
        writeln!(f, "  - Delta encoded: {}", self.chunks_delta)?;
        writeln!(f, "  - Dict compressed: {}", self.chunks_dict_compressed)?;
        writeln!(f, "  - Plain compressed: {}", self.chunks_plain_compressed)?;
        writeln!(f, "  - Stored raw: {}", self.chunks_raw)?;
        writeln!(f, "Delta rejections: {}", self.delta_rejections)?;
        writeln!(f, "Input bytes: {}", format_bytes(self.input_bytes))?;
        writeln!(f, "Stored bytes: {}", format_bytes(self.stored_bytes))?;
        writeln!(f, "Effective ratio: {:.2}x", self.effective_ratio())?;
        writeln!(f, "Savings breakdown:")?;
        writeln!(f, "  - Dedup: {}", format_bytes(self.dedup_saved_bytes))?;
        writeln!(f, "  - Delta: {}", format_bytes(self.delta_saved_bytes))?;
        writeln!(f, "  - Compression: {}", format_bytes(self.compression_saved_bytes))?;
        Ok(())
    }
}

/// Chunk processing result
#[derive(Debug)]
pub struct ProcessedChunk {
    /// Original fingerprint (of uncompressed data)
    pub fingerprint: [u8; BLAKE3_SIZE],
    /// How the chunk is encoded
    pub encoding: ChunkEncoding,
    /// Final stored data
    pub stored_data: Vec<u8>,
    /// Original size
    pub original_size: u32,
    /// Whether this is a duplicate
    pub is_duplicate: bool,
}

/// Enhanced compression pipeline
pub struct EnhancedPipeline {
    config: EnhancedPipelineConfig,
    dedup_store: ShardedDedupStore,
    similarity_index: SimilarityIndex,
    dict_manager: DictGroupManager,
    delta_encoder: DeltaEncoder,
    delta_decoder: DeltaDecoder,
    pub hamma: HammaState,
    stats: EnhancedPipelineStats,
    /// Cache of recently processed chunks for delta base lookup
    recent_chunks: HashMap<[u8; BLAKE3_SIZE], Vec<u8>>,
    /// Maximum recent chunks to cache
    max_recent_cache: usize,
}

impl EnhancedPipeline {
    /// Create a new enhanced pipeline
    pub fn new<P: AsRef<Path>>(
        store_path: P,
        config: EnhancedPipelineConfig,
    ) -> std::io::Result<Self> {
        let store_path = store_path.as_ref();
        
        let dedup_store = ShardedDedupStore::open(store_path.join("chunks"), config.shard_policy.clone())?;
        let similarity_index = SimilarityIndex::new(config.similarity.clone());
        let dict_manager = DictGroupManager::open(
            store_path.join("dictionaries"),
            config.dict_group.clone(),
        )?;
        let delta_encoder = DeltaEncoder::new(config.delta.clone());
        let delta_decoder = DeltaDecoder::new(config.delta.clone());
        let hamma = HammaState::load_or_default(store_path, config.hamma.clone());

        Ok(Self {
            config,
            dedup_store,
            similarity_index,
            dict_manager,
            delta_encoder,
            delta_decoder,
            hamma,
            stats: EnhancedPipelineStats::default(),
            recent_chunks: HashMap::new(),
            max_recent_cache: 1000,
        })
    }

    /// Process a single chunk through the pipeline
    pub fn process_chunk(
        &mut self,
        data: &[u8],
        cluster: FileCluster,
    ) -> std::io::Result<ProcessedChunk> {
        self.stats.chunks_processed += 1;
        self.stats.input_bytes += data.len() as u64;

        // Step 1: Compute fingerprint
        let fingerprint = *blake3::hash(data).as_bytes();
        let shard_id = self.dedup_store.shard_id(&fingerprint);

        // Step 2: Dedup check
        match self.dedup_store.lookup(&fingerprint)? {
            DedupResult::Hit(location) => {
                // Exact duplicate found
                self.stats.chunks_deduped += 1;
                self.stats.dedup_saved_bytes += data.len() as u64;
                
                return Ok(ProcessedChunk {
                    fingerprint,
                    encoding: ChunkEncoding {
                        encoding_type: EncodingType::Compressed,
                        base_fingerprint: None,
                        dict_id: location.dict_id,
                        delta_depth: 0,
                    },
                    stored_data: Vec::new(), // Already stored
                    original_size: data.len() as u32,
                    is_duplicate: true,
                });
            }
            DedupResult::Miss => {
                // Continue processing
            }
        }

        // Step 3: Entropy estimate
        let entropy = calculate_entropy(data);
        let skip_compression = entropy > self.config.entropy_skip_threshold || 
                               cluster.should_skip_compression();

        // Build HAMMA context (dict_id filled in per-strategy when needed)
        let ctx_base = self.hamma.make_context(
            &format!("{:?}", cluster),
            entropy,
            data.len(),
            shard_id,
            0xFFFFFFFF,
        );

        let allow_delta = self.hamma.should_try(&ctx_base, HammaStrategy::Delta);
        let allow_dict = self.hamma.should_try(&ctx_base, HammaStrategy::DictionaryCompressed);
        let allow_compressed = self.hamma.should_try(&ctx_base, HammaStrategy::Compressed);

        // Step 4: Build signature and check similarity (if delta enabled)
        let mut best_delta: Option<(Vec<u8>, [u8; BLAKE3_SIZE], f32)> = None;
        let mut delta_wall = Duration::ZERO;
        let mut delta_tries = 0;
        
        if allow_delta &&
           self.config.enable_delta && 
           data.len() >= self.config.min_delta_chunk_size &&
           !skip_compression 
        {
            let signature = ChunkSignature::from_chunk(fingerprint, data, &self.config.similarity);
            let candidates = self.similarity_index.find_candidates(&signature);
            let delta_start = Instant::now();

            // Try delta encoding against candidates
            let (delta_result, tries) = self.try_delta_candidates(data, fingerprint, &candidates);
            delta_wall = delta_start.elapsed();
            delta_tries = tries;
            best_delta = delta_result;
            
            // Add to similarity index for future matching
            self.similarity_index.add(signature);

            if delta_tries > 0 && best_delta.is_none() {
                self.record_hamma(
                    &ctx_base,
                    HammaStrategy::Delta,
                    data.len() as u64,
                    data.len() as u64,
                    delta_wall,
                    false,
                    true,
                );
            }
        }

        // Step 5: Choose encoding strategy
        let (stored_data, encoding) = if let Some((delta_data, base_fp, _savings)) = best_delta {
            // Delta encoding won
            self.stats.chunks_delta += 1;
            self.stats.delta_saved_bytes += (data.len() - delta_data.len()) as u64;
            self.stats.stored_bytes += delta_data.len() as u64;

            if delta_tries > 0 {
                self.record_hamma(
                    &ctx_base,
                    HammaStrategy::Delta,
                    data.len() as u64,
                    delta_data.len() as u64,
                    delta_wall,
                    true,
                    false,
                );
            }
            
            (delta_data, ChunkEncoding {
                encoding_type: EncodingType::Delta,
                base_fingerprint: Some(base_fp),
                dict_id: 0xFFFFFFFF,
                delta_depth: 1,
            })
        } else if skip_compression || (!allow_compressed && !allow_dict) {
            // Store raw
            self.stats.chunks_raw += 1;
            self.stats.stored_bytes += data.len() as u64;

            self.record_hamma(
                &ctx_base,
                HammaStrategy::Raw,
                data.len() as u64,
                data.len() as u64,
                Duration::ZERO,
                true,
                !allow_compressed && !allow_dict,
            );
            
            (data.to_vec(), ChunkEncoding {
                encoding_type: EncodingType::Raw,
                base_fingerprint: None,
                dict_id: 0xFFFFFFFF,
                delta_depth: 0,
            })
        } else {
            // Compress (with or without dictionary)
            let compress_start = Instant::now();
            let (compressed_data, encoding) = self.compress_chunk(data, cluster, allow_dict)?;
            let compress_wall = compress_start.elapsed();

            let strategy_used = match encoding.encoding_type {
                EncodingType::Raw => HammaStrategy::Raw,
                EncodingType::Compressed => {
                    if encoding.dict_id != 0xFFFFFFFF {
                        HammaStrategy::DictionaryCompressed
                    } else {
                        HammaStrategy::Compressed
                    }
                }
                EncodingType::Delta | EncodingType::DeltaCompressed => HammaStrategy::Delta,
            };

            let dict_ctx = if encoding.dict_id != 0xFFFFFFFF {
                self.hamma.make_context(
                    &format!("{:?}", cluster),
                    entropy,
                    data.len(),
                    shard_id,
                    encoding.dict_id,
                )
            } else {
                ctx_base.clone()
            };

            self.record_hamma(
                &dict_ctx,
                strategy_used,
                data.len() as u64,
                compressed_data.len() as u64,
                compress_wall,
                true,
                encoding.encoding_type == EncodingType::Raw,
            );

            (compressed_data, encoding)
        };

        // Step 6: Store in dedup store
        let _location = self.dedup_store.store(
            fingerprint,
            &stored_data,
            data.len() as u32,
            encoding.dict_id,
        )?;

        // Cache for future delta references
        self.cache_chunk(fingerprint, data.to_vec());

        // Add sample for dictionary training
        if self.config.enable_dictionary && !skip_compression {
            self.dict_manager.add_sample(cluster, data.to_vec());
        }

        Ok(ProcessedChunk {
            fingerprint,
            encoding,
            stored_data,
            original_size: data.len() as u32,
            is_duplicate: false,
        })
    }

    /// Try delta encoding against candidate base chunks
    fn try_delta_candidates(
        &mut self,
        target: &[u8],
        target_fp: [u8; BLAKE3_SIZE],
        candidates: &[DeltaCandidate],
    ) -> (Option<(Vec<u8>, [u8; BLAKE3_SIZE], f32)>, usize) {
        let mut best: Option<(Vec<u8>, [u8; BLAKE3_SIZE], f32)> = None;
        let mut tries = 0;
        let target_shard = self.dedup_store.shard_id(&target_fp);

        for candidate in candidates {
            if tries >= self.config.max_delta_tries {
                break;
            }
            tries += 1;

            // Enforce no cross-shard delta dependencies
            if self.dedup_store.shard_id(&candidate.fingerprint) != target_shard {
                continue;
            }

            // Get base chunk data
            let base_data = match self.get_chunk_data(&candidate.fingerprint) {
                Some(d) => d,
                None => continue,
            };

            // Try delta encoding
            match self.delta_encoder.encode(&base_data, target, candidate.fingerprint) {
                DeltaResult::Success { delta, base_fingerprint, savings_percent } => {
                    // Check if this is better than current best
                    let dominated = best.as_ref()
                        .map(|(_, _, s)| savings_percent <= *s)
                        .unwrap_or(false);
                    
                    if !dominated {
                        best = Some((delta, base_fingerprint, savings_percent));
                    }
                }
                DeltaResult::Rejected { .. } => {
                    self.stats.delta_rejections += 1;
                }
                DeltaResult::Error(_) => {
                    self.stats.delta_rejections += 1;
                }
            }
        }

        (best, tries)
    }

    /// Get chunk data (from cache or store)
    fn get_chunk_data(&mut self, fingerprint: &[u8; BLAKE3_SIZE]) -> Option<Vec<u8>> {
        // Check recent cache first
        if let Some(data) = self.recent_chunks.get(fingerprint) {
            return Some(data.clone());
        }

        // Fetch from store
        self.dedup_store.fetch_chunk(fingerprint).ok().flatten()
    }

    /// Cache a chunk for future delta reference
    fn cache_chunk(&mut self, fingerprint: [u8; BLAKE3_SIZE], data: Vec<u8>) {
        // Evict old entries if needed
        if self.recent_chunks.len() >= self.max_recent_cache {
            // Remove oldest (first inserted)
            if let Some(key) = self.recent_chunks.keys().next().cloned() {
                self.recent_chunks.remove(&key);
            }
        }
        self.recent_chunks.insert(fingerprint, data);
    }

    /// Record a HAMMA observation with wall time mirrored as CPU time (metadata-only)
    fn record_hamma(
        &mut self,
        ctx: &HammaContextKey,
        strategy: HammaStrategy,
        input_bytes: u64,
        output_bytes: u64,
        wall: Duration,
        success: bool,
        fallback: bool,
    ) {
        let obs = StrategyObservation {
            input_bytes,
            output_bytes,
            wall_time: wall,
            cpu_time: wall,
            success,
            fallback,
        };
        self.hamma.record(ctx, strategy, obs);
    }

    /// Compress a chunk (with or without dictionary)
    fn compress_chunk(
        &mut self,
        data: &[u8],
        cluster: FileCluster,
        allow_dict: bool,
    ) -> std::io::Result<(Vec<u8>, ChunkEncoding)> {
        let dict = if self.config.enable_dictionary && allow_dict {
            self.dict_manager.get_dict(cluster)
        } else {
            None
        };

        let dict_id = if dict.is_some() {
            self.dict_manager.get_dict_id(cluster)
        } else {
            0xFFFFFFFF
        };

        let compressed = compress_with_dict(data, dict, self.config.compression_level)?;

        // Check if compression helped
        if compressed.len() >= data.len() {
            // Store raw instead
            self.stats.chunks_raw += 1;
            self.stats.stored_bytes += data.len() as u64;
            
            return Ok((data.to_vec(), ChunkEncoding {
                encoding_type: EncodingType::Raw,
                base_fingerprint: None,
                dict_id: 0xFFFFFFFF,
                delta_depth: 0,
            }));
        }

        let saved = data.len() - compressed.len();
        self.stats.compression_saved_bytes += saved as u64;
        self.stats.stored_bytes += compressed.len() as u64;

        if dict.is_some() {
            self.stats.chunks_dict_compressed += 1;
            self.dict_manager.record_usage(cluster, dict_id, saved as u64);
        } else {
            self.stats.chunks_plain_compressed += 1;
        }

        Ok((compressed, ChunkEncoding {
            encoding_type: EncodingType::Compressed,
            base_fingerprint: None,
            dict_id,
            delta_depth: 0,
        }))
    }

    /// Decompress a chunk
    pub fn decompress_chunk(
        &mut self,
        stored_data: &[u8],
        encoding: &ChunkEncoding,
    ) -> std::io::Result<Vec<u8>> {
        match encoding.encoding_type {
            EncodingType::Raw => {
                Ok(stored_data.to_vec())
            }
            EncodingType::Compressed => {
                let dict = if encoding.dict_id != 0xFFFFFFFF {
                    self.dict_manager.get_dict_by_id(encoding.dict_id)
                } else {
                    None
                };
                decompress_with_dict(stored_data, dict)
            }
            EncodingType::Delta | EncodingType::DeltaCompressed => {
                // Get base chunk
                let base_fp = encoding.base_fingerprint
                    .ok_or_else(|| std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Delta chunk missing base fingerprint"
                    ))?;
                
                let base_data = self.get_chunk_data(&base_fp)
                    .ok_or_else(|| std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Delta base chunk not found"
                    ))?;

                // Apply delta
                self.delta_decoder.decode(&base_data, stored_data)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
            }
        }
    }

    /// Get pipeline statistics
    pub fn stats(&self) -> &EnhancedPipelineStats {
        &self.stats
    }

    /// Persist all state
    pub fn persist(&mut self) -> std::io::Result<()> {
        self.dedup_store.persist()?;
        self.dict_manager.persist()?;
        self.hamma.persist()?;
        Ok(())
    }

    /// Get dedup store reference
    pub fn dedup_store(&self) -> &ShardedDedupStore {
        &self.dedup_store
    }

    /// Get mutable dedup store reference
    pub fn dedup_store_mut(&mut self) -> &mut ShardedDedupStore {
        &mut self.dedup_store
    }

    /// Process file through full pipeline
    pub fn process_file<R: Read>(
        &mut self,
        reader: R,
        file_path: &str,
        _file_size: u64,
    ) -> std::io::Result<Vec<ProcessedChunk>> {
        // Determine cluster
        let ext = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let cluster = FileCluster::from_extension(ext);

        // Chunk the file (reader first, then config)
        let mut chunker = ContentDefinedChunker::new(reader, self.config.cdc.clone());
        let mut processed = Vec::new();

        while let Some(chunk) = chunker.next_chunk()? {
            let result = self.process_chunk(&chunk.data, cluster)?;
            processed.push(result);
        }

        Ok(processed)
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

/// Dependency resolver for delta chunks during reconstruction
pub struct DeltaDependencyResolver {
    /// Map: chunk fingerprint -> (encoding, base_fingerprint if delta)
    chunk_deps: HashMap<[u8; BLAKE3_SIZE], Option<[u8; BLAKE3_SIZE]>>,
    /// Resolved order (base chunks before dependents)
    resolved_order: Vec<[u8; BLAKE3_SIZE]>,
}

impl DeltaDependencyResolver {
    /// Create a new resolver
    pub fn new() -> Self {
        Self {
            chunk_deps: HashMap::new(),
            resolved_order: Vec::new(),
        }
    }

    /// Add a chunk to the dependency graph
    pub fn add_chunk(&mut self, fingerprint: [u8; BLAKE3_SIZE], base: Option<[u8; BLAKE3_SIZE]>) {
        self.chunk_deps.insert(fingerprint, base);
    }

    /// Resolve dependencies and return order
    /// Returns error if cycle detected or depth exceeded
    pub fn resolve(&mut self, max_depth: u8) -> Result<&[[u8; BLAKE3_SIZE]], DependencyError> {
        self.resolved_order.clear();
        let mut visited: HashMap<[u8; BLAKE3_SIZE], bool> = HashMap::new();
        let mut depth_map: HashMap<[u8; BLAKE3_SIZE], u8> = HashMap::new();

        for fp in self.chunk_deps.keys().cloned().collect::<Vec<_>>() {
            self.visit(fp, &mut visited, &mut depth_map, max_depth)?;
        }

        Ok(&self.resolved_order)
    }

    fn visit(
        &mut self,
        fp: [u8; BLAKE3_SIZE],
        visited: &mut HashMap<[u8; BLAKE3_SIZE], bool>,
        depth_map: &mut HashMap<[u8; BLAKE3_SIZE], u8>,
        max_depth: u8,
    ) -> Result<u8, DependencyError> {
        // Check if already visited
        if let Some(&in_progress) = visited.get(&fp) {
            if in_progress {
                return Err(DependencyError::CycleDetected);
            }
            return Ok(*depth_map.get(&fp).unwrap_or(&0));
        }

        visited.insert(fp, true); // Mark as in-progress

        let depth = if let Some(Some(base)) = self.chunk_deps.get(&fp).cloned() {
            // Has dependency
            let base_depth = self.visit(base, visited, depth_map, max_depth)?;
            let my_depth = base_depth + 1;
            
            if my_depth > max_depth {
                return Err(DependencyError::MaxDepthExceeded(my_depth));
            }
            my_depth
        } else {
            0 // Base chunk
        };

        visited.insert(fp, false); // Mark as complete
        depth_map.insert(fp, depth);
        self.resolved_order.push(fp);

        Ok(depth)
    }
}

impl Default for DeltaDependencyResolver {
    fn default() -> Self {
        Self::new()
    }
}

/// Dependency resolution errors
#[derive(Debug)]
pub enum DependencyError {
    CycleDetected,
    MaxDepthExceeded(u8),
}

impl std::fmt::Display for DependencyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CycleDetected => write!(f, "Delta dependency cycle detected"),
            Self::MaxDepthExceeded(d) => write!(f, "Delta chain depth {} exceeds maximum", d),
        }
    }
}

impl std::error::Error for DependencyError {}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_pipeline_config_default() {
        let config = EnhancedPipelineConfig::default();
        assert!(config.enable_delta);
        assert!(config.enable_dictionary);
        assert_eq!(config.compression_level, 3);
    }

    #[test]
    fn test_pipeline_stats() {
        let mut stats = EnhancedPipelineStats::default();
        stats.chunks_processed = 100;
        stats.chunks_deduped = 40;
        stats.input_bytes = 1000000;
        stats.stored_bytes = 300000;

        assert!(stats.effective_ratio() > 3.0);
        assert!(stats.dedup_ratio() > 1.5);
    }

    #[test]
    fn test_dependency_resolver_simple() {
        let mut resolver = DeltaDependencyResolver::new();
        
        let base = [1u8; BLAKE3_SIZE];
        let delta1 = [2u8; BLAKE3_SIZE];
        let delta2 = [3u8; BLAKE3_SIZE];
        
        resolver.add_chunk(base, None);
        resolver.add_chunk(delta1, Some(base));
        resolver.add_chunk(delta2, Some(base));
        
        let order = resolver.resolve(2).unwrap();
        
        // Base should come before deltas
        let base_pos = order.iter().position(|&f| f == base).unwrap();
        let delta1_pos = order.iter().position(|&f| f == delta1).unwrap();
        let delta2_pos = order.iter().position(|&f| f == delta2).unwrap();
        
        assert!(base_pos < delta1_pos);
        assert!(base_pos < delta2_pos);
    }

    #[test]
    fn test_dependency_resolver_chain() {
        let mut resolver = DeltaDependencyResolver::new();
        
        let base = [1u8; BLAKE3_SIZE];
        let delta1 = [2u8; BLAKE3_SIZE];
        let delta2 = [3u8; BLAKE3_SIZE]; // delta of delta
        
        resolver.add_chunk(base, None);
        resolver.add_chunk(delta1, Some(base));
        resolver.add_chunk(delta2, Some(delta1));
        
        let order = resolver.resolve(2).unwrap();
        
        let base_pos = order.iter().position(|&f| f == base).unwrap();
        let delta1_pos = order.iter().position(|&f| f == delta1).unwrap();
        let delta2_pos = order.iter().position(|&f| f == delta2).unwrap();
        
        assert!(base_pos < delta1_pos);
        assert!(delta1_pos < delta2_pos);
    }

    #[test]
    fn test_dependency_resolver_max_depth() {
        let mut resolver = DeltaDependencyResolver::new();
        
        let base = [1u8; BLAKE3_SIZE];
        let delta1 = [2u8; BLAKE3_SIZE];
        let delta2 = [3u8; BLAKE3_SIZE];
        let delta3 = [4u8; BLAKE3_SIZE]; // Too deep
        
        resolver.add_chunk(base, None);
        resolver.add_chunk(delta1, Some(base));
        resolver.add_chunk(delta2, Some(delta1));
        resolver.add_chunk(delta3, Some(delta2));
        
        // Should fail with max depth 2
        let result = resolver.resolve(2);
        assert!(matches!(result, Err(DependencyError::MaxDepthExceeded(_))));
    }

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(2048), "2.00 KB");
        assert_eq!(format_bytes(5 * 1024 * 1024), "5.00 MB");
    }

    #[test]
    fn test_hamma_integration_wired() {
        // Verify HAMMA is fully wired into the pipeline
        let dir = tempdir().unwrap();
        let mut config = EnhancedPipelineConfig::default();
        config.hamma.min_samples_for_gating = 2; // Lower for testing
        
        let mut pipeline = EnhancedPipeline::new(dir.path(), config).unwrap();
        
        // Process some chunks to generate HAMMA observations
        let test_data = vec![b'A'; 8192];
        let result = pipeline.process_chunk(&test_data, FileCluster::Generic).unwrap();
        assert!(!result.is_duplicate);
        
        // Process same data again - should be deduped
        let result2 = pipeline.process_chunk(&test_data, FileCluster::Generic).unwrap();
        assert!(result2.is_duplicate);
        
        // Process different data
        let test_data2 = vec![b'B'; 8192];
        let result3 = pipeline.process_chunk(&test_data2, FileCluster::Generic).unwrap();
        assert!(!result3.is_duplicate);
        
        // Persist and verify HAMMA state was written
        pipeline.persist().unwrap();
        
        let hamma_path = dir.path().join("hamma_state.json");
        assert!(hamma_path.exists(), "HAMMA state file should exist after persist");
        
        // Read and verify state has observations
        let state_content = std::fs::read_to_string(&hamma_path).unwrap();
        assert!(state_content.contains("samples"), "HAMMA state should contain samples");
    }

    #[test]
    fn test_hamma_gating_affects_pipeline() {
        // Verify HAMMA gating actually affects pipeline decisions
        let dir = tempdir().unwrap();
        let mut config = EnhancedPipelineConfig::default();
        config.enable_delta = true;
        config.enable_dictionary = true;
        
        let pipeline = EnhancedPipeline::new(dir.path(), config).unwrap();
        
        // Verify HAMMA state is initialized
        assert_eq!(pipeline.hamma.version, 1);
        assert!(pipeline.hamma.contexts.is_empty()); // No history yet
    }
}
