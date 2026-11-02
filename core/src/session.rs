//! SPK V2 Session Management
//!
//! Resumable compression/decompression sessions for large files.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::utils::error::{SpkError, SpkResult};

/// Session file extension
pub const SESSION_EXTENSION: &str = ".spk_session";

/// Session state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionState {
    /// Session created but not started
    Created,
    /// Currently processing
    InProgress,
    /// Paused by user
    Paused,
    /// Completed successfully
    Completed,
    /// Failed with error
    Failed(String),
    /// Cancelled by user
    Cancelled,
}

impl Default for SessionState {
    fn default() -> Self {
        Self::Created
    }
}

/// Compression session data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionSession {
    /// Unique session ID
    pub id: String,
    /// Session state
    pub state: SessionState,
    /// Source files/directories
    pub sources: Vec<String>,
    /// Output archive path
    pub output: String,
    /// Current progress
    pub progress: SessionProgress,
    /// Session options
    pub options: SessionOptions,
    /// Created timestamp
    pub created: u64,
    /// Last updated timestamp
    pub updated: u64,
    /// Checkpoint data for resume
    pub checkpoint: Option<Checkpoint>,
}

/// Progress tracking
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionProgress {
    /// Total files to process
    pub total_files: u64,
    /// Files processed
    pub files_processed: u64,
    /// Total bytes to process
    pub total_bytes: u64,
    /// Bytes processed
    pub bytes_processed: u64,
    /// Current file being processed
    pub current_file: Option<String>,
    /// Current chunk index
    pub current_chunk: u64,
    /// Total chunks
    pub total_chunks: u64,
    /// Estimated time remaining (seconds)
    pub eta_seconds: Option<u64>,
    /// Processing speed (bytes/sec)
    pub speed_bps: u64,
}

impl SessionProgress {
    pub fn percent_complete(&self) -> f64 {
        if self.total_bytes == 0 {
            return 100.0;
        }
        (self.bytes_processed as f64 / self.total_bytes as f64) * 100.0
    }

    pub fn update_eta(&mut self, elapsed_secs: u64) {
        if self.bytes_processed > 0 && elapsed_secs > 0 {
            self.speed_bps = self.bytes_processed / elapsed_secs;
            if self.speed_bps > 0 {
                let remaining = self.total_bytes.saturating_sub(self.bytes_processed);
                self.eta_seconds = Some(remaining / self.speed_bps);
            }
        }
    }
}

/// Session options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionOptions {
    /// Compression codec
    pub codec: String,
    /// Compression level
    pub level: i32,
    /// Chunk size
    pub chunk_size: usize,
    /// Enable encryption
    pub encrypt: bool,
    /// Enable recovery records
    pub recovery: bool,
    /// Recovery percentage
    pub recovery_percent: u8,
}

impl Default for SessionOptions {
    fn default() -> Self {
        Self {
            codec: "zstd".to_string(),
            level: 3,
            chunk_size: 4 * 1024 * 1024,
            encrypt: false,
            recovery: false,
            recovery_percent: 5,
        }
    }
}

/// Checkpoint for resume capability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// File index when paused
    pub file_index: usize,
    /// Byte offset in current file
    pub byte_offset: u64,
    /// Chunk index
    pub chunk_index: u64,
    /// Archive write offset
    pub archive_offset: u64,
    /// Processed file hashes (for verification)
    pub file_hashes: HashMap<String, String>,
}

impl CompressionSession {
    /// Create a new compression session
    pub fn new(sources: Vec<String>, output: String, options: SessionOptions) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            id: uuid::Uuid::new_v4().to_string(),
            state: SessionState::Created,
            sources,
            output,
            progress: SessionProgress::default(),
            options,
            created: now,
            updated: now,
            checkpoint: None,
        }
    }

    /// Get session file path
    pub fn session_file_path(&self) -> PathBuf {
        PathBuf::from(format!("{}{}", self.output, SESSION_EXTENSION))
    }

    /// Save session to file
    pub fn save(&self) -> SpkResult<()> {
        let path = self.session_file_path();
        let json = serde_json::to_string_pretty(self)?;
        let mut file = File::create(&path)?;
        file.write_all(json.as_bytes())?;
        Ok(())
    }

    /// Load session from file
    pub fn load<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let mut file = File::open(path)?;
        let mut json = String::new();
        file.read_to_string(&mut json)?;
        let session: Self = serde_json::from_str(&json)?;
        Ok(session)
    }

    /// Update session state
    pub fn set_state(&mut self, state: SessionState) {
        self.state = state;
        self.updated = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }

    /// Create checkpoint
    pub fn create_checkpoint(
        &mut self,
        file_index: usize,
        byte_offset: u64,
        chunk_index: u64,
        archive_offset: u64,
    ) {
        self.checkpoint = Some(Checkpoint {
            file_index,
            byte_offset,
            chunk_index,
            archive_offset,
            file_hashes: HashMap::new(),
        });
        self.updated = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }

    /// Check if session can be resumed
    pub fn can_resume(&self) -> bool {
        matches!(self.state, SessionState::Paused | SessionState::InProgress)
            && self.checkpoint.is_some()
    }

    /// Check if session is complete
    pub fn is_complete(&self) -> bool {
        matches!(self.state, SessionState::Completed)
    }

    /// Delete session file
    pub fn cleanup(&self) -> SpkResult<()> {
        let path = self.session_file_path();
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}

/// Decompression session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecompressionSession {
    /// Unique session ID
    pub id: String,
    /// Session state
    pub state: SessionState,
    /// Source archive path
    pub archive: String,
    /// Output directory
    pub output_dir: String,
    /// Files to extract (empty = all)
    pub files_to_extract: Vec<String>,
    /// Progress
    pub progress: SessionProgress,
    /// Created timestamp
    pub created: u64,
    /// Updated timestamp
    pub updated: u64,
    /// Checkpoint
    pub checkpoint: Option<DecompressCheckpoint>,
}

/// Decompression checkpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecompressCheckpoint {
    /// Current file index
    pub file_index: usize,
    /// Current chunk index
    pub chunk_index: u64,
    /// Bytes written to current file
    pub bytes_written: u64,
}

impl DecompressionSession {
    pub fn new(archive: String, output_dir: String) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            id: uuid::Uuid::new_v4().to_string(),
            state: SessionState::Created,
            archive,
            output_dir,
            files_to_extract: Vec::new(),
            progress: SessionProgress::default(),
            created: now,
            updated: now,
            checkpoint: None,
        }
    }

    pub fn with_files(mut self, files: Vec<String>) -> Self {
        self.files_to_extract = files;
        self
    }

    pub fn session_file_path(&self) -> PathBuf {
        PathBuf::from(format!("{}.decompress{}", self.archive, SESSION_EXTENSION))
    }

    pub fn save(&self) -> SpkResult<()> {
        let path = self.session_file_path();
        let json = serde_json::to_string_pretty(self)?;
        let mut file = File::create(&path)?;
        file.write_all(json.as_bytes())?;
        Ok(())
    }

    pub fn load<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let mut file = File::open(path)?;
        let mut json = String::new();
        file.read_to_string(&mut json)?;
        Ok(serde_json::from_str(&json)?)
    }

    pub fn can_resume(&self) -> bool {
        matches!(self.state, SessionState::Paused | SessionState::InProgress)
            && self.checkpoint.is_some()
    }
}

/// Session manager for tracking multiple sessions
pub struct SessionManager {
    sessions_dir: PathBuf,
}

impl SessionManager {
    pub fn new<P: AsRef<Path>>(sessions_dir: P) -> SpkResult<Self> {
        let path = sessions_dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&path)?;
        Ok(Self { sessions_dir: path })
    }

    /// List all active sessions
    pub fn list_sessions(&self) -> SpkResult<Vec<CompressionSession>> {
        let mut sessions = Vec::new();
        
        for entry in std::fs::read_dir(&self.sessions_dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.extension().map_or(false, |e| e == "spk_session") {
                if let Ok(session) = CompressionSession::load(&path) {
                    sessions.push(session);
                }
            }
        }
        
        Ok(sessions)
    }

    /// Find session by ID
    pub fn find_session(&self, id: &str) -> SpkResult<Option<CompressionSession>> {
        for session in self.list_sessions()? {
            if session.id == id {
                return Ok(Some(session));
            }
        }
        Ok(None)
    }

    /// Clean up completed/failed sessions
    pub fn cleanup_finished(&self) -> SpkResult<u32> {
        let mut cleaned = 0;
        
        for session in self.list_sessions()? {
            if matches!(session.state, SessionState::Completed | SessionState::Cancelled | SessionState::Failed(_)) {
                session.cleanup()?;
                cleaned += 1;
            }
        }
        
        Ok(cleaned)
    }

    /// Resume a paused session
    pub fn resume_session(&self, id: &str) -> SpkResult<CompressionSession> {
        let session = self.find_session(id)?
            .ok_or_else(|| SpkError::SessionError(format!("Session not found: {}", id)))?;
        
        if !session.can_resume() {
            return Err(SpkError::SessionError("Session cannot be resumed".into()));
        }
        
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_session_creation() {
        let session = CompressionSession::new(
            vec!["file1.txt".into()],
            "output.spk".into(),
            SessionOptions::default(),
        );
        
        assert!(!session.id.is_empty());
        assert_eq!(session.state, SessionState::Created);
    }

    #[test]
    fn test_session_save_load() {
        let dir = tempdir().unwrap();
        let output = dir.path().join("test.spk").to_string_lossy().to_string();
        
        let session = CompressionSession::new(
            vec!["file1.txt".into()],
            output,
            SessionOptions::default(),
        );
        
        session.save().unwrap();
        
        let loaded = CompressionSession::load(session.session_file_path()).unwrap();
        assert_eq!(session.id, loaded.id);
    }

    #[test]
    fn test_progress_calculation() {
        let mut progress = SessionProgress {
            total_bytes: 1000,
            bytes_processed: 500,
            ..Default::default()
        };
        
        assert!((progress.percent_complete() - 50.0).abs() < 0.01);
        
        progress.update_eta(10);
        assert!(progress.speed_bps > 0);
    }

    #[test]
    fn test_checkpoint() {
        let mut session = CompressionSession::new(
            vec!["file1.txt".into()],
            "output.spk".into(),
            SessionOptions::default(),
        );
        
        session.set_state(SessionState::Paused);
        session.create_checkpoint(5, 1000, 10, 50000);
        
        assert!(session.can_resume());
        assert!(session.checkpoint.is_some());
        
        let checkpoint = session.checkpoint.unwrap();
        assert_eq!(checkpoint.file_index, 5);
        assert_eq!(checkpoint.byte_offset, 1000);
    }
}
