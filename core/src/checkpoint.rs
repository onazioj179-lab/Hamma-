//! Checkpoint and Resume System for 100TB Compression
//!
//! Enables crash recovery and resumable compression jobs.
//! Saves progress every N bytes or N minutes.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Default checkpoint interval (10GB)
pub const DEFAULT_CHECKPOINT_BYTES: u64 = 10 * 1024 * 1024 * 1024;

/// Default checkpoint interval (10 minutes)
pub const DEFAULT_CHECKPOINT_SECONDS: u64 = 600;

/// Compression job state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobState {
    /// Initial scan phase
    Scanning,
    /// Chunking files
    Chunking,
    /// Compressing chunks
    Compressing,
    /// Writing manifest
    Finalizing,
    /// Job complete
    Completed,
    /// Job failed
    Failed,
}

/// Progress metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Progress {
    /// Bytes processed so far
    pub bytes_processed: u64,
    /// Total bytes to process
    pub bytes_total: u64,
    /// Files processed
    pub files_processed: u64,
    /// Total files
    pub files_total: u64,
    /// Chunks created
    pub chunks_created: u64,
    /// Chunks deduplicated
    pub chunks_deduped: u64,
    /// Current compression ratio
    pub compression_ratio: f64,
    /// Current dedup ratio
    pub dedup_ratio: f64,
}

impl Progress {
    /// Calculate completion percentage
    pub fn percent(&self) -> f64 {
        if self.bytes_total == 0 {
            return 0.0;
        }
        (self.bytes_processed as f64 / self.bytes_total as f64) * 100.0
    }

    /// Estimate remaining bytes
    pub fn bytes_remaining(&self) -> u64 {
        self.bytes_total.saturating_sub(self.bytes_processed)
    }
}

/// Checkpoint data saved to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Checkpoint version for compatibility
    pub version: u32,
    /// Job unique identifier
    pub job_id: String,
    /// Timestamp when checkpoint was created
    pub timestamp: u64,
    /// Current job state
    pub state: JobState,
    /// Progress metrics
    pub progress: Progress,
    /// Last successfully processed file path
    pub last_file: Option<String>,
    /// Last chunk fingerprint (hex)
    pub last_chunk: Option<String>,
    /// Set of completed file paths
    pub completed_files: HashSet<String>,
    /// Current volume being written
    pub current_volume: u32,
    /// Current offset in volume
    pub volume_offset: u64,
    /// Dedup store path
    pub dedup_store_path: String,
    /// Dict store path
    pub dict_store_path: String,
    /// Error message if failed
    pub error: Option<String>,
}

impl Checkpoint {
    /// Create a new checkpoint for a fresh job
    pub fn new(job_id: String, total_bytes: u64, total_files: u64) -> Self {
        Self {
            version: 1,
            job_id,
            timestamp: current_unix_time(),
            state: JobState::Scanning,
            progress: Progress {
                bytes_total: total_bytes,
                files_total: total_files,
                ..Default::default()
            },
            last_file: None,
            last_chunk: None,
            completed_files: HashSet::new(),
            current_volume: 0,
            volume_offset: 0,
            dedup_store_path: String::new(),
            dict_store_path: String::new(),
            error: None,
        }
    }

    /// Update timestamp
    pub fn touch(&mut self) {
        self.timestamp = current_unix_time();
    }
}

/// Checkpoint manager for a compression job
pub struct CheckpointManager {
    /// Root directory for checkpoints
    root: PathBuf,
    /// Current checkpoint data
    checkpoint: Checkpoint,
    /// Bytes since last save
    bytes_since_save: u64,
    /// Time of last save
    last_save: Instant,
    /// Checkpoint interval in bytes
    bytes_interval: u64,
    /// Checkpoint interval in time
    time_interval: Duration,
}

impl CheckpointManager {
    /// Create a new checkpoint manager
    pub fn new<P: AsRef<Path>>(
        root: P,
        job_id: String,
        total_bytes: u64,
        total_files: u64,
    ) -> std::io::Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root)?;

        let checkpoint = Checkpoint::new(job_id, total_bytes, total_files);

        Ok(Self {
            root,
            checkpoint,
            bytes_since_save: 0,
            last_save: Instant::now(),
            bytes_interval: DEFAULT_CHECKPOINT_BYTES,
            time_interval: Duration::from_secs(DEFAULT_CHECKPOINT_SECONDS),
        })
    }

    /// Try to load an existing checkpoint for resuming
    pub fn load_latest<P: AsRef<Path>>(root: P) -> std::io::Result<Option<Self>> {
        let root = root.as_ref().to_path_buf();
        
        // Find latest checkpoint file
        let checkpoint_dir = root.join("checkpoints");
        if !checkpoint_dir.exists() {
            return Ok(None);
        }

        let mut latest: Option<(u64, PathBuf)> = None;
        for entry in fs::read_dir(&checkpoint_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                let name = path.file_stem().unwrap().to_string_lossy();
                if let Some(ts_str) = name.strip_prefix("checkpoint_") {
                    if let Ok(ts) = ts_str.parse::<u64>() {
                        match &latest {
                            Some((current_ts, _)) if ts > *current_ts => {
                                latest = Some((ts, path));
                            }
                            None => {
                                latest = Some((ts, path));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        let Some((_, checkpoint_path)) = latest else {
            return Ok(None);
        };

        // Load checkpoint
        let file = File::open(&checkpoint_path)?;
        let reader = BufReader::new(file);
        let checkpoint: Checkpoint = serde_json::from_reader(reader)?;

        // Don't resume completed or failed jobs
        if matches!(checkpoint.state, JobState::Completed | JobState::Failed) {
            return Ok(None);
        }

        Ok(Some(Self {
            root,
            checkpoint,
            bytes_since_save: 0,
            last_save: Instant::now(),
            bytes_interval: DEFAULT_CHECKPOINT_BYTES,
            time_interval: Duration::from_secs(DEFAULT_CHECKPOINT_SECONDS),
        }))
    }

    /// Set checkpoint intervals
    pub fn with_intervals(mut self, bytes: u64, seconds: u64) -> Self {
        self.bytes_interval = bytes;
        self.time_interval = Duration::from_secs(seconds);
        self
    }

    /// Get current checkpoint data
    pub fn checkpoint(&self) -> &Checkpoint {
        &self.checkpoint
    }

    /// Get mutable checkpoint data
    pub fn checkpoint_mut(&mut self) -> &mut Checkpoint {
        &mut self.checkpoint
    }

    /// Update state
    pub fn set_state(&mut self, state: JobState) {
        self.checkpoint.state = state;
    }

    /// Mark a file as completed
    pub fn complete_file(&mut self, path: &str, bytes: u64) {
        self.checkpoint.completed_files.insert(path.to_string());
        self.checkpoint.progress.files_processed += 1;
        self.checkpoint.progress.bytes_processed += bytes;
        self.checkpoint.last_file = Some(path.to_string());
        self.bytes_since_save += bytes;
    }

    /// Record a chunk
    pub fn record_chunk(&mut self, fingerprint: &str, was_deduped: bool) {
        self.checkpoint.progress.chunks_created += 1;
        if was_deduped {
            self.checkpoint.progress.chunks_deduped += 1;
        }
        self.checkpoint.last_chunk = Some(fingerprint.to_string());
    }

    /// Update volume position
    pub fn update_volume(&mut self, volume_id: u32, offset: u64) {
        self.checkpoint.current_volume = volume_id;
        self.checkpoint.volume_offset = offset;
    }

    /// Update compression stats
    pub fn update_ratios(&mut self, compression_ratio: f64, dedup_ratio: f64) {
        self.checkpoint.progress.compression_ratio = compression_ratio;
        self.checkpoint.progress.dedup_ratio = dedup_ratio;
    }

    /// Check if a file was already processed (for resume)
    pub fn is_file_completed(&self, path: &str) -> bool {
        self.checkpoint.completed_files.contains(path)
    }

    /// Check if we should save a checkpoint
    pub fn should_save(&self) -> bool {
        self.bytes_since_save >= self.bytes_interval ||
        self.last_save.elapsed() >= self.time_interval
    }

    /// Save checkpoint to disk
    pub fn save(&mut self) -> std::io::Result<PathBuf> {
        self.checkpoint.touch();
        
        let checkpoint_dir = self.root.join("checkpoints");
        fs::create_dir_all(&checkpoint_dir)?;

        let filename = format!("checkpoint_{}.json", self.checkpoint.timestamp);
        let path = checkpoint_dir.join(&filename);
        let temp_path = checkpoint_dir.join(format!("{}.tmp", filename));

        // Write to temp file first
        {
            let file = File::create(&temp_path)?;
            let writer = BufWriter::new(file);
            serde_json::to_writer_pretty(writer, &self.checkpoint)?;
        }

        // Atomic rename
        fs::rename(&temp_path, &path)?;

        // Reset counters
        self.bytes_since_save = 0;
        self.last_save = Instant::now();

        Ok(path)
    }

    /// Save if needed (based on intervals)
    pub fn maybe_save(&mut self) -> std::io::Result<Option<PathBuf>> {
        if self.should_save() {
            Ok(Some(self.save()?))
        } else {
            Ok(None)
        }
    }

    /// Mark job as completed
    pub fn complete(&mut self) -> std::io::Result<PathBuf> {
        self.checkpoint.state = JobState::Completed;
        self.save()
    }

    /// Mark job as failed
    pub fn fail(&mut self, error: &str) -> std::io::Result<PathBuf> {
        self.checkpoint.state = JobState::Failed;
        self.checkpoint.error = Some(error.to_string());
        self.save()
    }

    /// Clean up old checkpoints, keeping only the latest N
    pub fn cleanup(&self, keep_count: usize) -> std::io::Result<()> {
        let checkpoint_dir = self.root.join("checkpoints");
        if !checkpoint_dir.exists() {
            return Ok(());
        }

        let mut checkpoints: Vec<(u64, PathBuf)> = Vec::new();
        for entry in fs::read_dir(&checkpoint_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                let name = path.file_stem().unwrap().to_string_lossy();
                if let Some(ts_str) = name.strip_prefix("checkpoint_") {
                    if let Ok(ts) = ts_str.parse::<u64>() {
                        checkpoints.push((ts, path));
                    }
                }
            }
        }

        // Sort by timestamp descending
        checkpoints.sort_by(|a, b| b.0.cmp(&a.0));

        // Remove old ones
        for (_, path) in checkpoints.into_iter().skip(keep_count) {
            let _ = fs::remove_file(path);
        }

        Ok(())
    }

    /// Get resume info for display
    pub fn resume_info(&self) -> ResumeInfo {
        let cp = &self.checkpoint;
        ResumeInfo {
            job_id: cp.job_id.clone(),
            state: cp.state,
            percent_complete: cp.progress.percent(),
            files_remaining: cp.progress.files_total - cp.progress.files_processed,
            bytes_remaining: cp.progress.bytes_remaining(),
            last_file: cp.last_file.clone(),
        }
    }
}

/// Information about resumable job
#[derive(Debug, Clone)]
pub struct ResumeInfo {
    pub job_id: String,
    pub state: JobState,
    pub percent_complete: f64,
    pub files_remaining: u64,
    pub bytes_remaining: u64,
    pub last_file: Option<String>,
}

impl std::fmt::Display for ResumeInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Job {} ({:?}): {:.1}% complete, {} files / {} bytes remaining",
            self.job_id,
            self.state,
            self.percent_complete,
            self.files_remaining,
            format_bytes(self.bytes_remaining)
        )
    }
}

/// Format bytes for human readability
pub fn format_bytes(bytes: u64) -> String {
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
        format!("{} bytes", bytes)
    }
}

/// Get current Unix timestamp
fn current_unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Estimate time remaining based on progress
pub fn estimate_eta(progress: &Progress, elapsed_seconds: u64) -> Option<Duration> {
    if progress.bytes_processed == 0 || elapsed_seconds == 0 {
        return None;
    }

    let bytes_per_second = progress.bytes_processed as f64 / elapsed_seconds as f64;
    if bytes_per_second <= 0.0 {
        return None;
    }

    let remaining_bytes = progress.bytes_remaining();
    let remaining_seconds = (remaining_bytes as f64 / bytes_per_second) as u64;

    Some(Duration::from_secs(remaining_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_checkpoint_new() {
        let cp = Checkpoint::new("test-job".to_string(), 1_000_000, 100);
        assert_eq!(cp.job_id, "test-job");
        assert_eq!(cp.state, JobState::Scanning);
        assert_eq!(cp.progress.bytes_total, 1_000_000);
    }

    #[test]
    fn test_checkpoint_manager_create() {
        let temp = TempDir::new().unwrap();
        let mgr = CheckpointManager::new(
            temp.path(),
            "test-job".to_string(),
            1_000_000,
            100,
        ).unwrap();

        assert_eq!(mgr.checkpoint().job_id, "test-job");
    }

    #[test]
    fn test_checkpoint_save_load() {
        let temp = TempDir::new().unwrap();
        
        // Create and save
        {
            let mut mgr = CheckpointManager::new(
                temp.path(),
                "test-job".to_string(),
                1_000_000,
                100,
            ).unwrap();
            mgr.complete_file("/path/to/file.txt", 50_000);
            mgr.set_state(JobState::Compressing);
            mgr.save().unwrap();
        }

        // Load and verify
        {
            let mgr = CheckpointManager::load_latest(temp.path())
                .unwrap()
                .expect("Should load checkpoint");
            
            assert_eq!(mgr.checkpoint().state, JobState::Compressing);
            assert!(mgr.is_file_completed("/path/to/file.txt"));
            assert_eq!(mgr.checkpoint().progress.bytes_processed, 50_000);
        }
    }

    #[test]
    fn test_progress_percent() {
        let mut progress = Progress::default();
        progress.bytes_total = 1000;
        progress.bytes_processed = 250;
        
        assert!((progress.percent() - 25.0).abs() < 0.001);
    }

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 bytes");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.00 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024), "1.00 GB");
        assert_eq!(format_bytes(1024u64 * 1024 * 1024 * 1024), "1.00 TB");
    }

    #[test]
    fn test_estimate_eta() {
        let progress = Progress {
            bytes_processed: 50_000_000_000, // 50GB done
            bytes_total: 100_000_000_000,    // 100GB total
            ..Default::default()
        };
        
        let eta = estimate_eta(&progress, 3600); // 1 hour elapsed
        assert!(eta.is_some());
        
        // Should estimate roughly 1 hour remaining
        let eta_secs = eta.unwrap().as_secs();
        assert!(eta_secs > 3000 && eta_secs < 4000);
    }
}
