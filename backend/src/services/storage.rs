//! Storage service for temporary file storage

use std::collections::HashMap;

use tokio::sync::RwLock;

use crate::routes::compress::SessionInfo;

/// In-memory storage for files and sessions
pub struct StorageService {
    /// File storage (id -> data)
    files: RwLock<HashMap<String, Vec<u8>>>,
    /// Session storage (id -> session data)
    sessions: RwLock<HashMap<String, SessionData>>,
    /// Pipeline instance (for HAMMA access)
    pipeline: RwLock<Option<spk_core::EnhancedPipeline>>,
}

/// Session data
#[derive(Debug, Clone)]
pub struct SessionData {
    pub id: String,
    pub status: SessionStatus,
    pub data: Vec<u8>,
    pub file_count: usize,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Session status
#[derive(Debug, Clone, PartialEq)]
pub enum SessionStatus {
    Active,
    Paused,
    Completed,
    Failed,
}

impl StorageService {
    /// Create new storage service
    pub fn new() -> Self {
        Self {
            files: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            pipeline: RwLock::new(None),
        }
    }

    /// Get pipeline reference (for HAMMA stats)
    /// Returns None if no pipeline has been initialized yet
    pub async fn has_pipeline(&self) -> bool {
        let pipeline = self.pipeline.read().await;
        pipeline.is_some()
    }
    
    /// Get pipeline stats without taking ownership
    pub async fn with_pipeline<F, R>(&self, f: F) -> Option<R>
    where
        F: FnOnce(&spk_core::EnhancedPipeline) -> R,
    {
        let pipeline = self.pipeline.read().await;
        pipeline.as_ref().map(f)
    }

    /// Set pipeline instance
    pub async fn set_pipeline(&self, p: spk_core::EnhancedPipeline) {
        let mut pipeline = self.pipeline.write().await;
        *pipeline = Some(p);
    }

    /// Store file data
    pub async fn store(&self, id: &str, data: Vec<u8>) {
        let mut files = self.files.write().await;
        files.insert(id.to_string(), data);
    }

    /// Get file data
    pub async fn get(&self, id: &str) -> Option<Vec<u8>> {
        let files = self.files.read().await;
        files.get(id).cloned()
    }

    /// Delete file
    pub async fn delete(&self, id: &str) -> bool {
        let mut files = self.files.write().await;
        files.remove(id).is_some()
    }

    /// Check if file exists
    pub async fn exists(&self, id: &str) -> bool {
        let files = self.files.read().await;
        files.contains_key(id)
    }

    /// Create new session
    pub async fn create_session(&self, id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.insert(id.to_string(), SessionData {
            id: id.to_string(),
            status: SessionStatus::Active,
            data: Vec::new(),
            file_count: 0,
            created_at: chrono::Utc::now(),
        });
    }

    /// Check if session exists
    pub async fn session_exists(&self, id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions.contains_key(id)
    }

    /// Append data to session
    pub async fn append_to_session(&self, id: &str, data: Vec<u8>) -> bool {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            if session.status != SessionStatus::Active { return false; }
            session.data.extend(data);
            return true;
        }
        false
    }

    /// Get session data
    pub async fn get_session_data(&self, id: &str) -> Option<Vec<u8>> {
        let sessions = self.sessions.read().await;
        sessions.get(id).map(|s| s.data.clone())
    }

    /// Get session info
    pub async fn get_session_info(&self, id: &str) -> Option<SessionInfo> {
        let sessions = self.sessions.read().await;
        sessions.get(id).map(|s| SessionInfo {
            id: s.id.clone(),
            status: match s.status {
                SessionStatus::Active => "active".to_string(),
                SessionStatus::Paused => "paused".to_string(),
                SessionStatus::Completed => "completed".to_string(),
                SessionStatus::Failed => "failed".to_string(),
            },
            uploaded_bytes: s.data.len() as u64,
            total_bytes: None,
            file_count: s.file_count,
            created_at: s.created_at.to_rfc3339(),
        })
    }

    /// Delete session
    pub async fn delete_session(&self, id: &str) -> bool {
        let mut sessions = self.sessions.write().await;
        sessions.remove(id).is_some()
    }

    /// Pause session
    pub async fn pause_session(&self, id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.status = SessionStatus::Paused;
        }
    }

    /// Resume session
    pub async fn resume_session(&self, id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.status = SessionStatus::Active;
        }
    }

    /// Get storage stats
    pub async fn stats(&self) -> StorageStats {
        let files = self.files.read().await;
        let sessions = self.sessions.read().await;

        let total_file_size: usize = files.values().map(|d| d.len()).sum();
        let total_session_size: usize = sessions.values().map(|s| s.data.len()).sum();

        StorageStats {
            file_count: files.len(),
            session_count: sessions.len(),
            total_file_size: total_file_size as u64,
            total_session_size: total_session_size as u64,
        }
    }

    /// Clear all data (for testing)
    pub async fn clear(&self) {
        let mut files = self.files.write().await;
        let mut sessions = self.sessions.write().await;
        files.clear();
        sessions.clear();
    }
}

impl Default for StorageService {
    fn default() -> Self {
        Self::new()
    }
}

/// Storage statistics
#[derive(Debug, Clone)]
pub struct StorageStats {
    pub file_count: usize,
    pub session_count: usize,
    pub total_file_size: u64,
    pub total_session_size: u64,
}
