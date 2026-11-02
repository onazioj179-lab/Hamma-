//! 100TB Scale Pipeline Orchestrator
//!
//! Coordinates CDC, dedup, dictionary compression, and checkpointing
//! for massive scale compression jobs (10TB-100TB+).

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::cdc::{chunk_file, CdcConfig};
use crate::checkpoint::{CheckpointManager, JobState};
use crate::dedup_store::DedupStore;
use crate::dictionary::{DictStore, FileCluster};

/// Large-scale pipeline configuration
#[derive(Debug, Clone)]
pub struct MassivePipelineConfig {
    /// CDC configuration
    pub cdc: CdcConfig,
    /// Enable dictionary compression
    pub use_dictionaries: bool,
    /// Dictionary training sample size
    pub dict_sample_size: usize,
    /// Compression level (1-22 for zstd)
    pub compression_level: i32,
    /// Skip files above this entropy (7.5 = high entropy)
    pub entropy_skip_threshold: f64,
}

impl Default for MassivePipelineConfig {
    fn default() -> Self {
        Self {
            cdc: CdcConfig::for_100tb(),
            use_dictionaries: true,
            dict_sample_size: 100 * 1024 * 1024, // 100MB
            compression_level: 19,
            entropy_skip_threshold: 7.5,
        }
    }
}

/// Result of compression pipeline
#[derive(Debug, Clone, Default)]
pub struct MassivePipelineResult {
    /// Total input size
    pub input_bytes: u64,
    /// Total output size  
    pub output_bytes: u64,
    /// Number of chunks created
    pub total_chunks: u64,
    /// Number of unique chunks (after dedup)
    pub unique_chunks: u64,
    /// Deduplication ratio
    pub dedup_ratio: f64,
    /// Compression ratio
    pub compression_ratio: f64,
    /// Overall ratio (input / output)
    pub overall_ratio: f64,
    /// Processing time in seconds
    pub duration_secs: f64,
    /// Throughput in MB/s
    pub throughput_mbps: f64,
    /// Files processed
    pub files_processed: u64,
    /// Files skipped (high entropy)
    pub files_skipped: u64,
}

/// File scanner for input discovery
pub struct FileScanner {
    /// Files to process
    pub files: Vec<PathBuf>,
    /// Total size
    pub total_bytes: u64,
    /// Files by cluster
    pub clusters: HashMap<FileCluster, Vec<PathBuf>>,
}

impl FileScanner {
    /// Scan directory for files
    pub fn scan<P: AsRef<Path>>(root: P) -> std::io::Result<Self> {
        let mut files = Vec::new();
        let mut total_bytes = 0u64;
        let mut clusters: HashMap<FileCluster, Vec<PathBuf>> = HashMap::new();

        Self::scan_recursive(root.as_ref(), &mut files)?;

        for path in &files {
            if let Ok(meta) = fs::metadata(path) {
                total_bytes += meta.len();
                let cluster = Self::classify_file(path);
                clusters.entry(cluster).or_default().push(path.clone());
            }
        }

        Ok(Self { files, total_bytes, clusters })
    }

    fn scan_recursive(path: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
        if path.is_file() {
            files.push(path.to_path_buf());
        } else if path.is_dir() {
            for entry in fs::read_dir(path)? {
                Self::scan_recursive(&entry?.path(), files)?;
            }
        }
        Ok(())
    }

    /// Classify file by extension
    pub fn classify_file(path: &Path) -> FileCluster {
        path.extension()
            .and_then(|e| e.to_str())
            .map(FileCluster::from_extension)
            .unwrap_or(FileCluster::Generic)
    }
}

/// Main massive-scale compression pipeline
pub struct MassivePipeline {
    config: MassivePipelineConfig,
    output_path: PathBuf,
    dedup_store: DedupStore,
    dict_store: DictStore,
    checkpoint_mgr: CheckpointManager,
    cancelled: Arc<AtomicBool>,
}

impl MassivePipeline {
    /// Create a new pipeline
    pub fn new<P: AsRef<Path>>(
        output_path: P,
        config: MassivePipelineConfig,
        job_id: String,
        total_bytes: u64,
        total_files: u64,
    ) -> std::io::Result<Self> {
        let output_path = output_path.as_ref().to_path_buf();
        fs::create_dir_all(&output_path)?;

        let dedup_store = DedupStore::open(output_path.join("dedup"))?;
        let dict_store = DictStore::open(output_path.join("dictionaries"))?;
        let checkpoint_mgr = CheckpointManager::new(&output_path, job_id, total_bytes, total_files)?;

        Ok(Self {
            config,
            output_path,
            dedup_store,
            dict_store,
            checkpoint_mgr,
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Try to resume an existing job
    pub fn resume<P: AsRef<Path>>(output_path: P, config: MassivePipelineConfig) -> std::io::Result<Option<Self>> {
        let output_path = output_path.as_ref().to_path_buf();

        let Some(checkpoint_mgr) = CheckpointManager::load_latest(&output_path)? else {
            return Ok(None);
        };

        let dedup_store = DedupStore::open(output_path.join("dedup"))?;
        let dict_store = DictStore::open(output_path.join("dictionaries"))?;

        Ok(Some(Self {
            config,
            output_path,
            dedup_store,
            dict_store,
            checkpoint_mgr,
            cancelled: Arc::new(AtomicBool::new(false)),
        }))
    }

    /// Cancel the pipeline
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Run the compression pipeline
    pub fn run(&mut self, scanner: &FileScanner) -> std::io::Result<MassivePipelineResult> {
        let start = Instant::now();
        let mut result = MassivePipelineResult {
            input_bytes: scanner.total_bytes,
            ..Default::default()
        };

        // Phase 1: Collect training samples
        if self.config.use_dictionaries {
            self.checkpoint_mgr.set_state(JobState::Scanning);
            self.collect_training_samples(scanner)?;
            self.dict_store.train_all()?;
        }

        // Phase 2: Process files  
        self.checkpoint_mgr.set_state(JobState::Chunking);
        
        for file_path in &scanner.files {
            if self.is_cancelled() {
                return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Cancelled"));
            }

            let file_str = file_path.to_string_lossy().to_string();
            if self.checkpoint_mgr.is_file_completed(&file_str) {
                continue;
            }

            match self.process_file(file_path) {
                Ok((chunks, unique)) => {
                    result.total_chunks += chunks;
                    result.unique_chunks += unique;
                    result.files_processed += 1;
                    let size = fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
                    self.checkpoint_mgr.complete_file(&file_str, size);
                }
                Err(e) => {
                    eprintln!("Error processing {}: {}", file_path.display(), e);
                    result.files_skipped += 1;
                }
            }

            self.checkpoint_mgr.maybe_save()?;
        }

        // Phase 3: Finalize
        self.checkpoint_mgr.set_state(JobState::Finalizing);
        self.dedup_store.persist()?;

        // Calculate stats
        let stats = self.dedup_store.stats();
        result.output_bytes = stats.compressed_bytes;
        result.dedup_ratio = stats.dedup_ratio();
        result.compression_ratio = stats.compression_ratio();
        result.overall_ratio = stats.effective_ratio();
        result.duration_secs = start.elapsed().as_secs_f64();
        result.throughput_mbps = (result.input_bytes as f64 / 1_048_576.0) / result.duration_secs.max(0.001);

        self.checkpoint_mgr.complete()?;
        Ok(result)
    }

    /// Collect training samples for dictionary training
    fn collect_training_samples(&mut self, scanner: &FileScanner) -> std::io::Result<()> {
        for (cluster, files) in &scanner.clusters {
            if cluster.should_skip_compression() || files.len() < 64 {
                continue;
            }

            let mut total_size = 0usize;
            for path in files.iter().take(1000) {
                if total_size >= self.config.dict_sample_size {
                    break;
                }
                
                if let Ok(mut file) = File::open(path) {
                    let mut sample = vec![0u8; 64 * 1024];
                    if let Ok(n) = file.read(&mut sample) {
                        if n > 0 {
                            sample.truncate(n);
                            total_size += n;
                            self.dict_store.add_sample(*cluster, sample);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Process a single file
    fn process_file(&mut self, path: &Path) -> std::io::Result<(u64, u64)> {
        let file = File::open(path)?;
        let reader = BufReader::with_capacity(8 * 1024 * 1024, file);
        
        // CDC chunk the file
        let chunks = chunk_file(reader, self.config.cdc)?;
        
        let cluster = FileScanner::classify_file(path);
        let dict_id = cluster.dict_id();
        let compression_level = self.config.compression_level;
        
        // Get dictionary if available
        let dict = self.dict_store.get(cluster).map(|d| d.to_vec());

        // Process chunks through dedup store
        let compress_fn = move |data: &[u8]| -> std::io::Result<Vec<u8>> {
            let compressed = if let Some(ref dict_data) = dict {
                // Use streaming encoder with dictionary
                use std::io::Cursor;
                let mut encoder = zstd::stream::Encoder::with_dictionary(
                    Vec::new(), 
                    compression_level, 
                    dict_data
                ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                std::io::copy(&mut Cursor::new(data), &mut encoder)?;
                encoder.finish().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
            } else {
                zstd::encode_all(std::io::Cursor::new(data), compression_level)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
            };
            
            if compressed.len() < data.len() {
                Ok(compressed)
            } else {
                let mut result = vec![0x00];
                result.extend_from_slice(data);
                Ok(result)
            }
        };

        let total = chunks.len() as u64;
        let refs = self.dedup_store.process_chunks(chunks, compress_fn, dict_id)?;
        
        // Count unique (those that were actually stored)
        let unique = refs.iter().filter(|r| r.location.refcount == 1).count() as u64;

        Ok((total, unique))
    }

    /// Get dedup store stats
    pub fn stats(&self) -> &crate::dedup_store::DedupStoreStats {
        self.dedup_store.stats()
    }
}

impl std::fmt::Display for MassivePipelineResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "=== 100TB Pipeline Results ===")?;
        writeln!(f, "Input:        {}", crate::checkpoint::format_bytes(self.input_bytes))?;
        writeln!(f, "Output:       {}", crate::checkpoint::format_bytes(self.output_bytes))?;
        writeln!(f, "Files:        {} processed, {} skipped", self.files_processed, self.files_skipped)?;
        writeln!(f, "Chunks:       {} total, {} unique", self.total_chunks, self.unique_chunks)?;
        writeln!(f, "Dedup:        {:.2}x", self.dedup_ratio)?;
        writeln!(f, "Compression:  {:.2}x", self.compression_ratio)?;
        writeln!(f, "Overall:      {:.2}x reduction", self.overall_ratio)?;
        writeln!(f, "Time:         {:.1}s", self.duration_secs)?;
        writeln!(f, "Throughput:   {:.1} MB/s", self.throughput_mbps)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_scanner_classify() {
        assert_eq!(FileScanner::classify_file(Path::new("test.log")), FileCluster::Logs);
        assert_eq!(FileScanner::classify_file(Path::new("config.json")), FileCluster::Config);
        assert_eq!(FileScanner::classify_file(Path::new("main.rs")), FileCluster::SourceCode);
    }

    #[test]
    fn test_pipeline_config() {
        let config = MassivePipelineConfig::default();
        assert!(config.use_dictionaries);
        assert_eq!(config.compression_level, 19);
    }
}
