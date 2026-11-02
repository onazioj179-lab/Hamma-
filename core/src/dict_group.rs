//! Dictionary Groups - Advanced Dictionary Management
//!
//! Extends the base dictionary system with:
//! - Rolling dictionary updates
//! - Dictionary versioning
//! - Usage-based retraining triggers
//! - Fallback handling for missing dictionaries

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::dictionary::{FileCluster, MAX_DICT_SIZE, MIN_TRAINING_SAMPLES};
use crate::dedup_store::BLAKE3_SIZE;

/// Dictionary group version
pub const DICT_GROUP_VERSION: u32 = 1;

/// Default retrain threshold (after N new samples)
pub const DEFAULT_RETRAIN_THRESHOLD: usize = 10_000;

/// Maximum samples to keep for retraining
pub const MAX_SAMPLES_RETAINED: usize = 100_000;

/// Dictionary group configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictGroupConfig {
    /// Retrain after this many new samples
    pub retrain_threshold: usize,
    /// Maximum samples to retain per group
    pub max_samples: usize,
    /// Minimum compression improvement to accept new dictionary (%)
    pub min_improvement: f32,
    /// Whether to auto-retrain
    pub auto_retrain: bool,
    /// Dictionary size limit
    pub max_dict_size: usize,
}

impl Default for DictGroupConfig {
    fn default() -> Self {
        Self {
            retrain_threshold: DEFAULT_RETRAIN_THRESHOLD,
            max_samples: MAX_SAMPLES_RETAINED,
            min_improvement: 2.0, // 2% minimum improvement
            auto_retrain: true,
            max_dict_size: MAX_DICT_SIZE,
        }
    }
}

/// Versioned dictionary with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionedDict {
    /// Unique dictionary ID
    pub id: u32,
    /// Version number (incrementing)
    pub version: u32,
    /// Content hash (BLAKE3)
    pub content_hash: [u8; BLAKE3_SIZE],
    /// Cluster this dictionary serves
    pub cluster: FileCluster,
    /// Training timestamp
    pub created_at: u64,
    /// Number of samples used in training
    pub sample_count: usize,
    /// Total training data size
    pub training_bytes: u64,
    /// Measured compression ratio
    pub measured_ratio: f64,
    /// Whether this is the active dictionary
    pub is_active: bool,
}

/// Sample buffer for incremental training
#[derive(Debug, Default)]
pub struct SampleBuffer {
    /// Collected samples
    samples: Vec<Vec<u8>>,
    /// Total bytes collected
    total_bytes: usize,
    /// Sample count since last train
    samples_since_train: usize,
}

impl SampleBuffer {
    /// Add a sample
    pub fn add(&mut self, data: Vec<u8>) {
        self.total_bytes += data.len();
        self.samples_since_train += 1;
        self.samples.push(data);
    }

    /// Check if ready to train
    pub fn ready_to_train(&self, threshold: usize) -> bool {
        self.samples_since_train >= threshold && self.samples.len() >= MIN_TRAINING_SAMPLES
    }

    /// Get samples for training
    pub fn get_samples(&self) -> &[Vec<u8>] {
        &self.samples
    }

    /// Reset sample counter (after training)
    pub fn reset_counter(&mut self) {
        self.samples_since_train = 0;
    }

    /// Prune old samples to stay under limit
    pub fn prune(&mut self, max_samples: usize) {
        if self.samples.len() > max_samples {
            let remove_count = self.samples.len() - max_samples;
            let removed: Vec<_> = self.samples.drain(0..remove_count).collect();
            self.total_bytes -= removed.iter().map(|s| s.len()).sum::<usize>();
        }
    }

    /// Get statistics
    pub fn stats(&self) -> (usize, usize, usize) {
        (self.samples.len(), self.total_bytes, self.samples_since_train)
    }
}

/// Dictionary group manager
pub struct DictGroupManager {
    /// Configuration
    config: DictGroupConfig,
    /// Root directory
    root: PathBuf,
    /// Active dictionaries: cluster -> dict data
    active_dicts: HashMap<FileCluster, Vec<u8>>,
    /// Dictionary metadata: cluster -> versioned info
    dict_metadata: HashMap<FileCluster, VersionedDict>,
    /// Sample buffers per cluster
    sample_buffers: HashMap<FileCluster, SampleBuffer>,
    /// Dictionary history (for rollback)
    dict_history: Vec<VersionedDict>,
    /// Usage statistics: (cluster, dict_id) -> (uses, total_saved_bytes)
    usage_stats: HashMap<(FileCluster, u32), (u64, u64)>,
}

impl DictGroupManager {
    /// Open or create dictionary group manager
    pub fn open<P: AsRef<Path>>(root: P, config: DictGroupConfig) -> std::io::Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root)?;
        fs::create_dir_all(root.join("active"))?;
        fs::create_dir_all(root.join("archive"))?;

        let mut manager = Self {
            config,
            root,
            active_dicts: HashMap::new(),
            dict_metadata: HashMap::new(),
            sample_buffers: HashMap::new(),
            dict_history: Vec::new(),
            usage_stats: HashMap::new(),
        };

        manager.load_state()?;
        Ok(manager)
    }

    /// Load persisted state
    fn load_state(&mut self) -> std::io::Result<()> {
        // Load metadata
        let meta_path = self.root.join("metadata.json");
        if meta_path.exists() {
            let file = File::open(&meta_path)?;
            let reader = BufReader::new(file);
            if let Ok(metadata) = serde_json::from_reader::<_, Vec<VersionedDict>>(reader) {
                for meta in metadata {
                    if meta.is_active {
                        self.dict_metadata.insert(meta.cluster, meta);
                    } else {
                        self.dict_history.push(meta);
                    }
                }
            }
        }

        // Load active dictionaries
        for (cluster, meta) in &self.dict_metadata {
            let dict_path = self.root.join("active").join(format!("dict_{:03}_v{:03}.zdict", meta.id, meta.version));
            if dict_path.exists() {
                let mut file = File::open(&dict_path)?;
                let mut data = Vec::new();
                file.read_to_end(&mut data)?;
                self.active_dicts.insert(*cluster, data);
            }
        }

        // Load usage stats
        let stats_path = self.root.join("usage_stats.json");
        if stats_path.exists() {
            let file = File::open(&stats_path)?;
            let reader = BufReader::new(file);
            if let Ok(stats) = serde_json::from_reader::<_, HashMap<String, (u64, u64)>>(reader) {
                for (key, value) in stats {
                    if let Some((cluster_str, id_str)) = key.split_once(':') {
                        if let (Ok(cluster_id), Ok(dict_id)) = (cluster_str.parse::<u32>(), id_str.parse::<u32>()) {
                            let cluster = cluster_from_id(cluster_id);
                            self.usage_stats.insert((cluster, dict_id), value);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Persist state to disk
    pub fn persist(&self) -> std::io::Result<()> {
        // Save metadata
        let meta_path = self.root.join("metadata.json");
        let mut all_meta: Vec<&VersionedDict> = self.dict_metadata.values().collect();
        all_meta.extend(self.dict_history.iter());
        
        let file = File::create(&meta_path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, &all_meta)?;

        // Save usage stats
        let stats_path = self.root.join("usage_stats.json");
        let stats_map: HashMap<String, (u64, u64)> = self.usage_stats
            .iter()
            .map(|((cluster, id), v)| (format!("{}:{}", cluster.dict_id(), id), *v))
            .collect();
        
        let file = File::create(&stats_path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, &stats_map)?;

        Ok(())
    }

    /// Get active dictionary for a cluster
    pub fn get_dict(&self, cluster: FileCluster) -> Option<&[u8]> {
        self.active_dicts.get(&cluster).map(|v| v.as_slice())
    }

    /// Get dictionary ID for a cluster
    pub fn get_dict_id(&self, cluster: FileCluster) -> u32 {
        self.dict_metadata.get(&cluster)
            .map(|m| m.id)
            .unwrap_or(0xFFFFFFFF)
    }

    /// Add a sample for future training
    pub fn add_sample(&mut self, cluster: FileCluster, data: Vec<u8>) {
        let buffer = self.sample_buffers.entry(cluster).or_default();
        buffer.add(data);
        buffer.prune(self.config.max_samples);

        // Check if we should retrain
        if self.config.auto_retrain && buffer.ready_to_train(self.config.retrain_threshold) {
            let _ = self.train_dict(cluster);
        }
    }

    /// Train or retrain dictionary for a cluster
    pub fn train_dict(&mut self, cluster: FileCluster) -> std::io::Result<Option<u32>> {
        let buffer = match self.sample_buffers.get(&cluster) {
            Some(b) if b.samples.len() >= MIN_TRAINING_SAMPLES => b,
            _ => return Ok(None),
        };

        // Collect samples into flat buffer with sizes
        let samples: Vec<&[u8]> = buffer.get_samples().iter().map(|v| v.as_slice()).collect();
        
        // Train dictionary using ZSTD
        let dict_data = match train_dictionary(&samples, self.config.max_dict_size) {
            Ok(d) => d,
            Err(_) => return Ok(None),
        };

        // Compute content hash
        let content_hash = *blake3::hash(&dict_data).as_bytes();

        // Get next version
        let (id, version) = self.dict_metadata.get(&cluster)
            .map(|m| (m.id, m.version + 1))
            .unwrap_or((cluster.dict_id(), 1));

        // Test compression improvement
        let new_ratio = test_dict_ratio(&samples, &dict_data);
        let old_ratio = self.dict_metadata.get(&cluster)
            .map(|m| m.measured_ratio)
            .unwrap_or(1.0);

        let improvement = (new_ratio / old_ratio - 1.0) * 100.0;
        if improvement < self.config.min_improvement as f64 && version > 1 {
            // Not enough improvement, skip update
            return Ok(None);
        }

        // Archive old dictionary
        if let Some(old_meta) = self.dict_metadata.get_mut(&cluster) {
            old_meta.is_active = false;
            self.dict_history.push(old_meta.clone());
        }

        // Create new metadata
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let (sample_count, training_bytes, _) = buffer.stats();
        let metadata = VersionedDict {
            id,
            version,
            content_hash,
            cluster,
            created_at: now,
            sample_count,
            training_bytes: training_bytes as u64,
            measured_ratio: new_ratio,
            is_active: true,
        };

        // Save dictionary file
        let dict_path = self.root.join("active").join(format!("dict_{:03}_v{:03}.zdict", id, version));
        let mut file = File::create(&dict_path)?;
        file.write_all(&dict_data)?;

        // Update state
        self.active_dicts.insert(cluster, dict_data);
        self.dict_metadata.insert(cluster, metadata);
        
        // Reset sample counter
        if let Some(buffer) = self.sample_buffers.get_mut(&cluster) {
            buffer.reset_counter();
        }

        self.persist()?;
        Ok(Some(id))
    }

    /// Record dictionary usage
    pub fn record_usage(&mut self, cluster: FileCluster, dict_id: u32, saved_bytes: u64) {
        let entry = self.usage_stats.entry((cluster, dict_id)).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += saved_bytes;
    }

    /// Get dictionary by ID (for reconstruction)
    pub fn get_dict_by_id(&self, dict_id: u32) -> Option<&[u8]> {
        // First check active dicts
        for (cluster, meta) in &self.dict_metadata {
            if meta.id == dict_id {
                return self.active_dicts.get(cluster).map(|v| v.as_slice());
            }
        }
        None
    }

    /// Check if dictionary exists
    pub fn has_dict(&self, cluster: FileCluster) -> bool {
        self.active_dicts.contains_key(&cluster)
    }

    /// Get all active dictionary IDs
    pub fn active_dict_ids(&self) -> Vec<u32> {
        self.dict_metadata.values().map(|m| m.id).collect()
    }

    /// Get statistics
    pub fn stats(&self) -> DictGroupStats {
        let total_samples: usize = self.sample_buffers.values()
            .map(|b| b.stats().0)
            .sum();
        let total_bytes: usize = self.sample_buffers.values()
            .map(|b| b.stats().1)
            .sum();
        
        DictGroupStats {
            active_dicts: self.active_dicts.len(),
            archived_dicts: self.dict_history.len(),
            total_samples,
            total_sample_bytes: total_bytes,
            clusters_with_dicts: self.dict_metadata.keys().cloned().collect(),
        }
    }

    /// Rollback to previous dictionary version
    pub fn rollback(&mut self, cluster: FileCluster) -> std::io::Result<bool> {
        // Find most recent archived version for this cluster
        let archived = self.dict_history.iter()
            .filter(|m| m.cluster == cluster)
            .max_by_key(|m| m.version);

        if let Some(archived_meta) = archived.cloned() {
            // Load archived dictionary
            let dict_path = self.root.join("archive")
                .join(format!("dict_{:03}_v{:03}.zdict", archived_meta.id, archived_meta.version));
            
            if dict_path.exists() {
                let mut file = File::open(&dict_path)?;
                let mut data = Vec::new();
                file.read_to_end(&mut data)?;

                // Archive current
                if let Some(current) = self.dict_metadata.get_mut(&cluster) {
                    current.is_active = false;
                    self.dict_history.push(current.clone());
                }

                // Restore archived
                let mut restored = archived_meta;
                restored.is_active = true;
                self.active_dicts.insert(cluster, data);
                self.dict_metadata.insert(cluster, restored);

                self.persist()?;
                return Ok(true);
            }
        }

        Ok(false)
    }
}

/// Dictionary group statistics
#[derive(Debug, Clone)]
pub struct DictGroupStats {
    pub active_dicts: usize,
    pub archived_dicts: usize,
    pub total_samples: usize,
    pub total_sample_bytes: usize,
    pub clusters_with_dicts: Vec<FileCluster>,
}

/// Train a ZSTD dictionary from samples
fn train_dictionary(samples: &[&[u8]], max_size: usize) -> Result<Vec<u8>, &'static str> {
    if samples.is_empty() {
        return Err("No samples provided");
    }

    // Flatten samples for ZSTD training
    let sample_sizes: Vec<usize> = samples.iter().map(|s| s.len()).collect();
    let flat_samples: Vec<u8> = samples.iter().flat_map(|s| s.iter().copied()).collect();

    // Use ZSTD dictionary training (from_continuous is the correct API)
    match zstd::dict::from_continuous(&flat_samples, &sample_sizes, max_size) {
        Ok(dict) => Ok(dict),
        Err(_) => Err("Dictionary training failed"),
    }
}

/// Test compression ratio with dictionary
fn test_dict_ratio(samples: &[&[u8]], dict: &[u8]) -> f64 {
    let mut total_raw = 0usize;
    let mut total_compressed = 0usize;
    
    // Test on subset of samples
    let test_samples: Vec<_> = samples.iter().take(100).collect();
    
    for sample in test_samples {
        total_raw += sample.len();
        
        // Compress with dictionary
        let compressed = zstd::bulk::Compressor::with_dictionary(3, dict)
            .ok()
            .and_then(|mut comp| comp.compress(sample).ok())
            .unwrap_or_else(|| {
                // Fallback: compress without dict
                zstd::bulk::compress(sample, 3).unwrap_or_default()
            });
        total_compressed += compressed.len();
    }

    if total_compressed > 0 {
        total_raw as f64 / total_compressed as f64
    } else {
        1.0
    }
}

/// Convert cluster ID back to FileCluster
fn cluster_from_id(id: u32) -> FileCluster {
    match id {
        0 => FileCluster::Logs,
        1 => FileCluster::Config,
        2 => FileCluster::SourceCode,
        3 => FileCluster::Tabular,
        4 => FileCluster::Markup,
        5 => FileCluster::Binary,
        0xFFFFFFFE => FileCluster::Compressed,
        _ => FileCluster::Generic,
    }
}

/// Compress with optional dictionary
pub fn compress_with_dict(data: &[u8], dict: Option<&[u8]>, level: i32) -> std::io::Result<Vec<u8>> {
    match dict {
        Some(d) => {
            zstd::bulk::Compressor::with_dictionary(level, d)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
                .compress(data)
                .or_else(|_| zstd::bulk::compress(data, level))
        }
        None => zstd::bulk::compress(data, level),
    }
}

/// Decompress with optional dictionary (fallback if dict missing)
pub fn decompress_with_dict(data: &[u8], dict: Option<&[u8]>) -> std::io::Result<Vec<u8>> {
    match dict {
        Some(d) => {
            zstd::bulk::Decompressor::with_dictionary(d)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
                .decompress(data, 64 * 1024 * 1024)
                .or_else(|_| {
                    // Fallback: try without dictionary
                    zstd::decode_all(data)
                })
        }
        None => zstd::decode_all(data),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_sample_buffer() {
        let mut buffer = SampleBuffer::default();
        
        buffer.add(b"sample 1".to_vec());
        buffer.add(b"sample 2".to_vec());
        
        let (count, bytes, since_train) = buffer.stats();
        assert_eq!(count, 2);
        assert_eq!(bytes, 16);
        assert_eq!(since_train, 2);
        
        buffer.reset_counter();
        let (_, _, since_train) = buffer.stats();
        assert_eq!(since_train, 0);
    }

    #[test]
    fn test_dict_group_manager_open() {
        let dir = tempdir().unwrap();
        let config = DictGroupConfig::default();
        
        let manager = DictGroupManager::open(dir.path(), config).unwrap();
        let stats = manager.stats();
        
        assert_eq!(stats.active_dicts, 0);
        assert_eq!(stats.total_samples, 0);
    }

    #[test]
    fn test_add_samples() {
        let dir = tempdir().unwrap();
        let mut config = DictGroupConfig::default();
        config.auto_retrain = false; // Disable auto-retrain for test
        
        let mut manager = DictGroupManager::open(dir.path(), config).unwrap();
        
        // Add samples
        for i in 0..100 {
            manager.add_sample(FileCluster::SourceCode, format!("sample code {}", i).into_bytes());
        }
        
        let stats = manager.stats();
        assert_eq!(stats.total_samples, 100);
    }

    #[test]
    fn test_compress_decompress_with_dict() {
        // Test without dictionary
        let data = b"Hello, this is test data for compression";
        let compressed = compress_with_dict(data, None, 3).unwrap();
        let decompressed = decompress_with_dict(&compressed, None).unwrap();
        assert_eq!(decompressed, data);
    }

    #[test]
    fn test_versioned_dict_serialization() {
        let dict = VersionedDict {
            id: 1,
            version: 1,
            content_hash: [0u8; BLAKE3_SIZE],
            cluster: FileCluster::SourceCode,
            created_at: 1234567890,
            sample_count: 100,
            training_bytes: 50000,
            measured_ratio: 2.5,
            is_active: true,
        };
        
        let json = serde_json::to_string(&dict).unwrap();
        let parsed: VersionedDict = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.id, dict.id);
        assert_eq!(parsed.version, dict.version);
        assert_eq!(parsed.cluster, dict.cluster);
    }

    #[test]
    fn test_prune_samples() {
        let mut buffer = SampleBuffer::default();
        
        for i in 0..200 {
            buffer.add(format!("sample {}", i).into_bytes());
        }
        
        buffer.prune(100);
        let (count, _, _) = buffer.stats();
        assert_eq!(count, 100);
    }
}
