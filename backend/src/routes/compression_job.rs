//! Large-scale compression job management
//! Handles 100TB → 1GB compression with dedup, progress tracking, and sharing

use axum::{
    extract::{Path, State, Json, Multipart},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::AppState;

/// Compression job state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionJob {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub status: JobStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    
    // Size tracking
    pub original_size: u64,
    pub compressed_size: u64,
    pub processed_bytes: u64,
    
    // Progress
    pub progress: f32,
    pub chunks_total: u64,
    pub chunks_processed: u64,
    pub chunks_deduped: u64,
    
    // Performance
    pub compression_ratio: f32,
    pub dedup_ratio: f32,
    pub throughput_mbps: f32,
    pub eta_seconds: Option<u64>,
    
    // Output
    pub output_file: Option<String>,
    pub checksum: Option<String>,
    
    // Sharing
    pub shared_with: Vec<String>,
    pub share_token: Option<String>,
    pub is_public: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Processing,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// Create job request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobRequest {
    pub name: String,
    pub user_id: String,
    pub total_size: u64,
}

/// Create job response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobResponse {
    pub job_id: String,
    pub upload_url: String,
}

/// Share file request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareJobRequest {
    pub recipient_user_id: Option<String>,
    pub is_public: bool,
}

/// Share file response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareJobResponse {
    pub share_token: String,
    pub share_url: String,
}

/// Job manager state
pub struct JobManager {
    jobs: Mutex<HashMap<String, CompressionJob>>,
}

impl JobManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
    
    pub fn create_job(&self, user_id: String, name: String, total_size: u64) -> CompressionJob {
        let job_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        
        let job = CompressionJob {
            id: job_id.clone(),
            user_id,
            name,
            status: JobStatus::Pending,
            created_at: now,
            updated_at: now,
            completed_at: None,
            original_size: total_size,
            compressed_size: 0,
            processed_bytes: 0,
            progress: 0.0,
            chunks_total: 0,
            chunks_processed: 0,
            chunks_deduped: 0,
            compression_ratio: 1.0,
            dedup_ratio: 1.0,
            throughput_mbps: 0.0,
            eta_seconds: None,
            output_file: None,
            checksum: None,
            shared_with: Vec::new(),
            share_token: None,
            is_public: false,
        };
        
        self.jobs.lock().unwrap().insert(job_id.clone(), job.clone());
        job
    }
    
    pub fn get_job(&self, job_id: &str) -> Option<CompressionJob> {
        self.jobs.lock().unwrap().get(job_id).cloned()
    }
    
    pub fn update_job<F>(&self, job_id: &str, updater: F) -> Option<CompressionJob> 
    where
        F: FnOnce(&mut CompressionJob)
    {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(job_id) {
            updater(job);
            job.updated_at = Utc::now();
            Some(job.clone())
        } else {
            None
        }
    }
    
    pub fn list_user_jobs(&self, user_id: &str) -> Vec<CompressionJob> {
        self.jobs.lock().unwrap()
            .values()
            .filter(|job| job.user_id == user_id)
            .cloned()
            .collect()
    }
    
    pub fn share_job(&self, job_id: &str, recipient: Option<String>, is_public: bool) -> Option<String> {
        let share_token = Uuid::new_v4().to_string();
        
        self.update_job(job_id, |job| {
            job.share_token = Some(share_token.clone());
            job.is_public = is_public;
            if let Some(user) = recipient {
                if !job.shared_with.contains(&user) {
                    job.shared_with.push(user);
                }
            }
        })?;
        
        Some(share_token)
    }
}

/// Create a new compression job
pub async fn create_job(
    State(state): State<AppState>,
    Json(req): Json<CreateJobRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    let job = job_manager.create_job(req.user_id, req.name, req.total_size);
    
    let response = CreateJobResponse {
        job_id: job.id.clone(),
        upload_url: format!("/api/compression/jobs/{}/upload", job.id),
    };
    
    Ok(Json(response))
}

/// Get job status
pub async fn get_job_status(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    match job_manager.get_job(&job_id) {
        Some(job) => Ok(Json(job)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// List user's jobs
pub async fn list_jobs(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    let jobs = job_manager.list_user_jobs(&user_id);
    Ok(Json(jobs))
}

/// Upload file chunk for compression
pub async fn upload_chunk(
    State(_state): State<AppState>,
    Path(_job_id): Path<String>,
    _multipart: Multipart,
) -> Result<StatusCode, StatusCode> {
    // The previous placeholder discarded uploaded bytes and reported progress.
    // Refuse uploads until durable compression/output storage is implemented.
    Err(StatusCode::NOT_IMPLEMENTED)
}

/// Share a compressed file with another user
pub async fn share_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Json(req): Json<ShareJobRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    match job_manager.share_job(&job_id, req.recipient_user_id, req.is_public) {
        Some(token) => {
            let response = ShareJobResponse {
                share_token: token.clone(),
                share_url: format!("/api/compression/shared/{}", token),
            };
            Ok(Json(response))
        }
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Download shared file
pub async fn download_shared(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    // Find job by share token
    let jobs = job_manager.jobs.lock().unwrap();
    let job = jobs.values().find(|j| {
        j.share_token.as_ref() == Some(&token) && 
        (j.is_public || !j.shared_with.is_empty())
    });
    
    match job {
        Some(job) if job.status == JobStatus::Completed => {
            // No output stream is implemented for this prototype.
            Err::<StatusCode, StatusCode>(StatusCode::NOT_IMPLEMENTED)
        }
        Some(_) => Err(StatusCode::NOT_FOUND),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Pause a running job
pub async fn pause_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    match job_manager.update_job(&job_id, |job| {
        if job.status == JobStatus::Processing {
            job.status = JobStatus::Paused;
        }
    }) {
        Some(job) => Ok(Json(job)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Resume a paused job
pub async fn resume_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    match job_manager.update_job(&job_id, |job| {
        if job.status == JobStatus::Paused {
            job.status = JobStatus::Processing;
        }
    }) {
        Some(job) => Ok(Json(job)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Cancel a job
pub async fn cancel_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let job_manager = get_or_create_job_manager(&state);
    
    match job_manager.update_job(&job_id, |job| {
        if job.status != JobStatus::Completed {
            job.status = JobStatus::Cancelled;
        }
    }) {
        Some(job) => Ok(Json(job)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

// Helper to get or create job manager from AppState
fn get_or_create_job_manager(state: &AppState) -> Arc<JobManager> {
    // TODO: Store in AppState properly
    // For now, create a new one each time (will be replaced with proper state management)
    Arc::new(JobManager::new())
}
