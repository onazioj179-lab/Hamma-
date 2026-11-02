//! Dictionary Training and Management for 100TB Compression
//!
//! Cluster-based dictionary training for improved compression ratios.
//! Dictionaries are trained per file-type cluster and versioned.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Maximum dictionary size (128KB recommended by ZSTD)
pub const MAX_DICT_SIZE: usize = 128 * 1024;

/// Minimum samples needed for training
pub const MIN_TRAINING_SAMPLES: usize = 64;

/// Target sample size for training (100MB)
pub const TARGET_SAMPLE_SIZE: usize = 100 * 1024 * 1024;

/// File cluster for dictionary assignment
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FileCluster {
    /// Log files, text, structured text
    Logs,
    /// JSON, YAML, TOML config files
    Config,
    /// Source code (all languages)
    SourceCode,
    /// CSV, TSV tabular data
    Tabular,
    /// XML, HTML markup
    Markup,
    /// Binary executables
    Binary,
    /// Already compressed (zip, gz, etc) - skip compression
    Compressed,
    /// High-entropy / random data - skip compression
    HighEntropy,
    /// Unknown / mixed
    Generic,
}

impl FileCluster {
    /// Classify file by extension
    pub fn from_extension(ext: &str) -> Self {
        let ext = ext.to_lowercase();
        match ext.as_str() {
            // Logs
            "log" | "out" | "err" => Self::Logs,
            // Config
            "json" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" => Self::Config,
            // Source code
            "rs" | "py" | "js" | "ts" | "java" | "c" | "cpp" | "h" | "hpp" |
            "go" | "rb" | "php" | "swift" | "kt" | "scala" | "cs" | "fs" |
            "lua" | "pl" | "sh" | "bash" | "zsh" | "ps1" | "bat" | "cmd" => Self::SourceCode,
            // Tabular
            "csv" | "tsv" | "parquet" | "arrow" => Self::Tabular,
            // Markup
            "xml" | "html" | "htm" | "xhtml" | "svg" | "xsl" | "xslt" => Self::Markup,
            // Already compressed
            "zip" | "gz" | "bz2" | "xz" | "zst" | "lz4" | "br" | "7z" | "rar" |
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "mp3" | "mp4" | "mkv" |
            "avi" | "mov" | "flac" | "aac" | "ogg" | "webm" => Self::Compressed,
            // Binary
            "exe" | "dll" | "so" | "dylib" | "o" | "a" | "lib" | "bin" => Self::Binary,
            // Generic
            _ => Self::Generic,
        }
    }

    /// Classify by magic bytes (first few bytes of file)
    pub fn from_magic(magic: &[u8]) -> Option<Self> {
        if magic.len() < 4 {
            return None;
        }

        // Check common magic numbers
        match &magic[..4] {
            // Compressed formats
            [0x50, 0x4B, 0x03, 0x04] => Some(Self::Compressed), // ZIP
            [0x1F, 0x8B, _, _] => Some(Self::Compressed),       // GZIP
            [0x42, 0x5A, 0x68, _] => Some(Self::Compressed),    // BZIP2
            [0xFD, 0x37, 0x7A, 0x58] => Some(Self::Compressed), // XZ
            [0x28, 0xB5, 0x2F, 0xFD] => Some(Self::Compressed), // ZSTD
            [0x04, 0x22, 0x4D, 0x18] => Some(Self::Compressed), // LZ4
            // Images (compressed)
            [0xFF, 0xD8, 0xFF, _] => Some(Self::Compressed),    // JPEG
            [0x89, 0x50, 0x4E, 0x47] => Some(Self::Compressed), // PNG
            [0x47, 0x49, 0x46, 0x38] => Some(Self::Compressed), // GIF
            // Binary executables
            [0x7F, 0x45, 0x4C, 0x46] => Some(Self::Binary),     // ELF
            [0x4D, 0x5A, _, _] => Some(Self::Binary),           // PE/MZ
            [0xCF, 0xFA, 0xED, 0xFE] => Some(Self::Binary),     // Mach-O (64-bit)
            [0xFE, 0xED, 0xFA, 0xCE] => Some(Self::Binary),     // Mach-O (32-bit)
            // Text-based (check for printable ASCII)
            _ if magic.iter().all(|&b| b.is_ascii_graphic() || b.is_ascii_whitespace()) => {
                // Check for XML/HTML
                if magic.starts_with(b"<?xml") || magic.starts_with(b"<!DOCTYPE") || 
                   magic.starts_with(b"<html") || magic.starts_with(b"<HTML") {
                    Some(Self::Markup)
                } else if magic.starts_with(b"{") || magic.starts_with(b"[") {
                    Some(Self::Config) // JSON-like
                } else {
                    None // Could be anything text-based
                }
            }
            _ => None,
        }
    }

    /// Whether this cluster should skip compression entirely
    pub fn should_skip_compression(&self) -> bool {
        matches!(self, Self::Compressed | Self::HighEntropy)
    }

    /// Get dictionary ID for this cluster
    pub fn dict_id(&self) -> u32 {
        match self {
            Self::Logs => 0,
            Self::Config => 1,
            Self::SourceCode => 2,
            Self::Tabular => 3,
            Self::Markup => 4,
            Self::Binary => 5,
            Self::Compressed => 0xFFFFFFFE, // Special: skip
            Self::HighEntropy => 0xFFFFFFFE, // Special: skip
            Self::Generic => 0xFFFFFFFF,    // No dictionary
        }
    }
}

/// Dictionary metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictMetadata {
    /// Dictionary ID (matches cluster)
    pub id: u32,
    /// Cluster this dictionary is for
    pub cluster: FileCluster,
    /// Version hash (BLAKE3 of dict content)
    pub version_hash: String,
    /// Training timestamp
    pub trained_at: u64,
    /// Number of samples used
    pub sample_count: usize,
    /// Total bytes sampled
    pub sample_bytes: u64,
    /// Average compression ratio achieved
    pub avg_ratio: f64,
}

/// Dictionary store for managing trained dictionaries
pub struct DictStore {
    /// Root directory
    root: PathBuf,
    /// Loaded dictionaries: cluster -> (dict_data, metadata)
    dicts: HashMap<FileCluster, (Vec<u8>, DictMetadata)>,
    /// Training samples collected
    samples: HashMap<FileCluster, Vec<Vec<u8>>>,
}

impl DictStore {
    /// Open or create a dictionary store
    pub fn open<P: AsRef<Path>>(root: P) -> std::io::Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root)?;

        let mut store = Self {
            root,
            dicts: HashMap::new(),
            samples: HashMap::new(),
        };

        store.load_all_dicts()?;
        Ok(store)
    }

    /// Load all dictionaries from disk
    fn load_all_dicts(&mut self) -> std::io::Result<()> {
        let manifest_path = self.root.join("manifest.json");
        if !manifest_path.exists() {
            return Ok(());
        }

        let file = File::open(&manifest_path)?;
        let reader = BufReader::new(file);
        let manifests: Vec<DictMetadata> = serde_json::from_reader(reader)
            .unwrap_or_default();

        for meta in manifests {
            let dict_path = self.root.join(format!("dict_{:03}.zdict", meta.id));
            if dict_path.exists() {
                let mut file = File::open(&dict_path)?;
                let mut dict_data = Vec::new();
                file.read_to_end(&mut dict_data)?;
                self.dicts.insert(meta.cluster, (dict_data, meta));
            }
        }

        Ok(())
    }

    /// Get dictionary for a cluster
    pub fn get(&self, cluster: FileCluster) -> Option<&[u8]> {
        self.dicts.get(&cluster).map(|(data, _)| data.as_slice())
    }

    /// Get dictionary by ID
    pub fn get_by_id(&self, dict_id: u32) -> Option<&[u8]> {
        for (cluster, (data, _)) in &self.dicts {
            if cluster.dict_id() == dict_id {
                return Some(data.as_slice());
            }
        }
        None
    }

    /// Add a training sample for a cluster
    pub fn add_sample(&mut self, cluster: FileCluster, sample: Vec<u8>) {
        if cluster.should_skip_compression() {
            return;
        }

        let samples = self.samples.entry(cluster).or_insert_with(Vec::new);
        
        // Limit sample size
        let current_size: usize = samples.iter().map(|s| s.len()).sum();
        if current_size < TARGET_SAMPLE_SIZE {
            samples.push(sample);
        }
    }

    /// Check if cluster has enough samples for training
    pub fn can_train(&self, cluster: FileCluster) -> bool {
        if let Some(samples) = self.samples.get(&cluster) {
            samples.len() >= MIN_TRAINING_SAMPLES
        } else {
            false
        }
    }

    /// Train dictionary for a cluster
    pub fn train(&mut self, cluster: FileCluster) -> std::io::Result<Option<DictMetadata>> {
        if cluster.should_skip_compression() {
            return Ok(None);
        }

        let samples = match self.samples.get(&cluster) {
            Some(s) if s.len() >= MIN_TRAINING_SAMPLES => s,
            _ => return Ok(None),
        };

        // Flatten samples for ZSTD training
        let sample_sizes: Vec<usize> = samples.iter().map(|s| s.len()).collect();
        let flat_samples: Vec<u8> = samples.iter().flat_map(|s| s.iter().copied()).collect();
        let total_bytes = flat_samples.len();

        // Train using ZSTD
        let dict_data = zstd::dict::from_continuous(&flat_samples, &sample_sizes, MAX_DICT_SIZE)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

        // Calculate version hash
        let version_hash = hex::encode(&blake3::hash(&dict_data).as_bytes()[..16]);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let metadata = DictMetadata {
            id: cluster.dict_id(),
            cluster,
            version_hash,
            trained_at: now,
            sample_count: samples.len(),
            sample_bytes: total_bytes as u64,
            avg_ratio: 0.0, // Will be updated after testing
        };

        // Save dictionary
        let dict_path = self.root.join(format!("dict_{:03}.zdict", metadata.id));
        let mut file = File::create(&dict_path)?;
        file.write_all(&dict_data)?;

        // Update in-memory state
        self.dicts.insert(cluster, (dict_data, metadata.clone()));

        // Save manifest
        self.save_manifest()?;

        // Clear samples
        self.samples.remove(&cluster);

        Ok(Some(metadata))
    }

    /// Train all clusters that have enough samples
    pub fn train_all(&mut self) -> std::io::Result<Vec<DictMetadata>> {
        let clusters: Vec<FileCluster> = self.samples.keys().copied().collect();
        let mut results = Vec::new();

        for cluster in clusters {
            if self.can_train(cluster) {
                if let Some(meta) = self.train(cluster)? {
                    results.push(meta);
                }
            }
        }

        Ok(results)
    }

    /// Save manifest to disk
    fn save_manifest(&self) -> std::io::Result<()> {
        let manifest_path = self.root.join("manifest.json");
        let manifests: Vec<&DictMetadata> = self.dicts.values().map(|(_, m)| m).collect();
        
        let file = File::create(&manifest_path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, &manifests)?;
        
        Ok(())
    }

    /// Get all loaded dictionaries
    pub fn list(&self) -> Vec<&DictMetadata> {
        self.dicts.values().map(|(_, m)| m).collect()
    }

    /// Clear training samples
    pub fn clear_samples(&mut self) {
        self.samples.clear();
    }
}

/// Classify a file and extract a sample for dictionary training
pub fn classify_and_sample<P: AsRef<Path>>(
    path: P,
    max_sample_size: usize,
) -> std::io::Result<(FileCluster, Option<Vec<u8>>)> {
    let path = path.as_ref();
    
    // Get extension-based classification
    let ext_cluster = path
        .extension()
        .and_then(|e| e.to_str())
        .map(FileCluster::from_extension)
        .unwrap_or(FileCluster::Generic);

    // Read file header for magic-based classification
    let mut file = File::open(path)?;
    let mut header = vec![0u8; 512.min(max_sample_size)];
    let header_len = file.read(&mut header)?;
    header.truncate(header_len);

    // Magic bytes override extension
    let cluster = FileCluster::from_magic(&header)
        .unwrap_or(ext_cluster);

    // Check entropy for high-entropy detection
    if !cluster.should_skip_compression() {
        let entropy = calculate_entropy(&header);
        if entropy > 7.5 {
            return Ok((FileCluster::HighEntropy, None));
        }
    }

    // Read sample for training
    if cluster.should_skip_compression() {
        return Ok((cluster, None));
    }

    // Read up to max_sample_size
    let metadata = fs::metadata(path)?;
    let sample_size = (metadata.len() as usize).min(max_sample_size);
    
    let mut sample = vec![0u8; sample_size];
    use std::io::Seek;
    file.seek(std::io::SeekFrom::Start(0))?;
    file.read_exact(&mut sample)?;

    Ok((cluster, Some(sample)))
}

/// Calculate Shannon entropy (bits per byte)
pub fn calculate_entropy(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }

    let mut freq = [0u64; 256];
    for &byte in data {
        freq[byte as usize] += 1;
    }

    let len = data.len() as f64;
    let mut entropy = 0.0;

    for &count in &freq {
        if count > 0 {
            let p = count as f64 / len;
            entropy -= p * p.log2();
        }
    }

    entropy
}

/// Compression decision based on analysis
#[derive(Debug, Clone)]
pub struct CompressionDecision {
    /// Assigned cluster
    pub cluster: FileCluster,
    /// Dictionary ID to use (0xFFFFFFFF for none)
    pub dict_id: u32,
    /// Whether to skip compression entirely
    pub skip_compression: bool,
    /// Recommended chunk size
    pub chunk_size_hint: usize,
    /// Entropy estimate (bits per byte)
    pub entropy: f64,
}

impl CompressionDecision {
    /// Make a decision based on file analysis
    pub fn analyze(cluster: FileCluster, entropy: f64, _file_size: u64) -> Self {
        let skip = cluster.should_skip_compression() || entropy > 7.5;
        
        // Chunk size based on entropy
        let chunk_size_hint = if entropy < 4.0 {
            64 * 1024 * 1024 // 64MB for highly redundant
        } else if entropy < 6.0 {
            16 * 1024 * 1024 // 16MB balanced
        } else {
            4 * 1024 * 1024  // 4MB for less redundant
        };

        Self {
            cluster,
            dict_id: if skip { 0xFFFFFFFE } else { cluster.dict_id() },
            skip_compression: skip,
            chunk_size_hint,
            entropy,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_cluster_from_extension() {
        assert_eq!(FileCluster::from_extension("log"), FileCluster::Logs);
        assert_eq!(FileCluster::from_extension("json"), FileCluster::Config);
        assert_eq!(FileCluster::from_extension("rs"), FileCluster::SourceCode);
        assert_eq!(FileCluster::from_extension("csv"), FileCluster::Tabular);
        assert_eq!(FileCluster::from_extension("zip"), FileCluster::Compressed);
    }

    #[test]
    fn test_cluster_skip_compression() {
        assert!(FileCluster::Compressed.should_skip_compression());
        assert!(FileCluster::HighEntropy.should_skip_compression());
        assert!(!FileCluster::Logs.should_skip_compression());
        assert!(!FileCluster::SourceCode.should_skip_compression());
    }

    #[test]
    fn test_entropy_calculation() {
        // Uniform distribution = max entropy (8 bits)
        let uniform: Vec<u8> = (0..=255).collect();
        let entropy = calculate_entropy(&uniform);
        assert!((entropy - 8.0).abs() < 0.01);

        // Single byte repeated = 0 entropy
        let single = vec![0x42u8; 1000];
        let entropy = calculate_entropy(&single);
        assert!(entropy < 0.01);
    }

    #[test]
    fn test_dict_store_open() {
        let temp = TempDir::new().unwrap();
        let store = DictStore::open(temp.path()).unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn test_add_sample() {
        let temp = TempDir::new().unwrap();
        let mut store = DictStore::open(temp.path()).unwrap();
        
        for i in 0..MIN_TRAINING_SAMPLES {
            store.add_sample(FileCluster::Logs, vec![0x41u8; 1000 + i]);
        }
        
        assert!(store.can_train(FileCluster::Logs));
        assert!(!store.can_train(FileCluster::Config));
    }

    #[test]
    fn test_magic_detection() {
        // ZIP magic
        assert_eq!(
            FileCluster::from_magic(&[0x50, 0x4B, 0x03, 0x04]),
            Some(FileCluster::Compressed)
        );
        
        // ELF magic
        assert_eq!(
            FileCluster::from_magic(&[0x7F, 0x45, 0x4C, 0x46]),
            Some(FileCluster::Binary)
        );

        // JPEG magic
        assert_eq!(
            FileCluster::from_magic(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(FileCluster::Compressed)
        );
    }

    #[test]
    fn test_compression_decision() {
        let decision = CompressionDecision::analyze(FileCluster::Logs, 5.0, 1_000_000);
        assert!(!decision.skip_compression);
        assert_eq!(decision.dict_id, FileCluster::Logs.dict_id());

        let decision = CompressionDecision::analyze(FileCluster::Compressed, 7.9, 1_000_000);
        assert!(decision.skip_compression);
    }
}
