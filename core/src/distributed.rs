//! SPK V5 Distributed Compression
//!
//! Split compression workload across multiple machines.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::chunk::ChunkEntry;
use crate::types::header_structs::{DistributedInfo, WorkerAssignment, WorkerStatus};
use crate::utils::error::{SpkError, SpkResult};

/// Distributed compression job
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributedJob {
    /// Unique job ID
    pub id: String,
    /// Job state
    pub state: JobState,
    /// Total chunks to process
    pub total_chunks: u64,
    /// Processed chunks
    pub processed_chunks: u64,
    /// Worker assignments
    pub workers: Vec<WorkerInfo>,
    /// Created timestamp
    pub created: u64,
    /// Updated timestamp
    pub updated: u64,
    /// Target archive ID
    pub archive_id: String,
    /// Manifest data (compressed)
    pub manifest_data: Vec<u8>,
}

/// Job state
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum JobState {
    Created,
    Assigning,
    Processing,
    Merging,
    Completed,
    Failed,
    Cancelled,
}

impl Default for JobState {
    fn default() -> Self {
        Self::Created
    }
}

/// Worker information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerInfo {
    pub id: String,
    pub address: String,
    pub status: WorkerStatus,
    pub chunk_start: u64,
    pub chunk_count: u64,
    pub chunks_completed: u64,
    pub last_heartbeat: u64,
    pub error: Option<String>,
}

impl DistributedJob {
    /// Create a new distributed job
    pub fn new(total_chunks: u64, archive_id: String) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            id: uuid::Uuid::new_v4().to_string(),
            state: JobState::Created,
            total_chunks,
            processed_chunks: 0,
            workers: Vec::new(),
            created: now,
            updated: now,
            archive_id,
            manifest_data: Vec::new(),
        }
    }

    /// Assign chunks to workers
    pub fn assign_workers(&mut self, worker_addresses: &[String]) {
        let chunks_per_worker = (self.total_chunks / worker_addresses.len() as u64).max(1);
        let mut current_chunk = 0u64;

        for (i, address) in worker_addresses.iter().enumerate() {
            let chunk_count = if i == worker_addresses.len() - 1 {
                self.total_chunks - current_chunk
            } else {
                chunks_per_worker
            };

            self.workers.push(WorkerInfo {
                id: format!("worker-{}", i),
                address: address.clone(),
                status: WorkerStatus::Pending,
                chunk_start: current_chunk,
                chunk_count,
                chunks_completed: 0,
                last_heartbeat: 0,
                error: None,
            });

            current_chunk += chunk_count;
        }

        self.state = JobState::Assigning;
    }

    /// Update worker status
    pub fn update_worker(&mut self, worker_id: &str, status: WorkerStatus, chunks_completed: u64) {
        if let Some(worker) = self.workers.iter_mut().find(|w| w.id == worker_id) {
            worker.status = status;
            worker.chunks_completed = chunks_completed;
            worker.last_heartbeat = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
        }
        self.update_progress();
    }

    /// Update overall progress
    fn update_progress(&mut self) {
        self.processed_chunks = self.workers.iter().map(|w| w.chunks_completed).sum();
        self.updated = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Update state
        if self.workers.iter().all(|w| w.status == WorkerStatus::Completed) {
            self.state = JobState::Merging;
        } else if self.workers.iter().any(|w| w.status == WorkerStatus::Failed) {
            self.state = JobState::Failed;
        } else if self.workers.iter().any(|w| w.status == WorkerStatus::InProgress) {
            self.state = JobState::Processing;
        }
    }

    /// Get progress percentage
    pub fn progress(&self) -> f64 {
        if self.total_chunks == 0 {
            100.0
        } else {
            (self.processed_chunks as f64 / self.total_chunks as f64) * 100.0
        }
    }

    /// Check for timed out workers
    pub fn check_timeouts(&mut self, timeout_secs: u64) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        for worker in &mut self.workers {
            if worker.status == WorkerStatus::InProgress 
                && worker.last_heartbeat > 0 
                && now - worker.last_heartbeat > timeout_secs 
            {
                worker.status = WorkerStatus::Failed;
                worker.error = Some("Worker timed out".to_string());
            }
        }
    }

    /// Convert to distributed info for header
    pub fn to_distributed_info(&self) -> DistributedInfo {
        DistributedInfo {
            worker_count: self.workers.len() as u32,
            coordinator_id: self.id.clone(),
            job_id: self.id.clone(),
            assignments: self.workers.iter().map(|w| WorkerAssignment {
                worker_id: w.id.clone(),
                chunk_start: w.chunk_start,
                chunk_count: w.chunk_count,
                status: w.status.clone(),
            }).collect(),
        }
    }
}

/// Coordinator for distributed compression
pub struct Coordinator {
    /// Active jobs
    jobs: Arc<RwLock<HashMap<String, DistributedJob>>>,
    /// Available workers
    workers: Arc<RwLock<Vec<String>>>,
}

impl Coordinator {
    /// Create a new coordinator
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            workers: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register a worker
    pub async fn register_worker(&self, address: String) {
        let mut workers = self.workers.write().await;
        if !workers.contains(&address) {
            workers.push(address);
        }
    }

    /// Unregister a worker
    pub async fn unregister_worker(&self, address: &str) {
        let mut workers = self.workers.write().await;
        workers.retain(|w| w != address);
    }

    /// Create a new distributed job
    pub async fn create_job(&self, total_chunks: u64, archive_id: String) -> SpkResult<String> {
        let workers = self.workers.read().await;
        if workers.is_empty() {
            return Err(SpkError::DistributedError("No workers available".into()));
        }

        let mut job = DistributedJob::new(total_chunks, archive_id);
        job.assign_workers(&workers);
        
        let job_id = job.id.clone();
        
        let mut jobs = self.jobs.write().await;
        jobs.insert(job_id.clone(), job);
        
        Ok(job_id)
    }

    /// Get job status
    pub async fn get_job(&self, job_id: &str) -> Option<DistributedJob> {
        let jobs = self.jobs.read().await;
        jobs.get(job_id).cloned()
    }

    /// Update worker progress
    pub async fn report_progress(
        &self,
        job_id: &str,
        worker_id: &str,
        status: WorkerStatus,
        chunks_completed: u64,
    ) -> SpkResult<()> {
        let mut jobs = self.jobs.write().await;
        let job = jobs.get_mut(job_id)
            .ok_or_else(|| SpkError::DistributedError(format!("Job not found: {}", job_id)))?;
        
        job.update_worker(worker_id, status, chunks_completed);
        Ok(())
    }

    /// Cancel a job
    pub async fn cancel_job(&self, job_id: &str) -> SpkResult<()> {
        let mut jobs = self.jobs.write().await;
        let job = jobs.get_mut(job_id)
            .ok_or_else(|| SpkError::DistributedError(format!("Job not found: {}", job_id)))?;
        
        job.state = JobState::Cancelled;
        Ok(())
    }

    /// Get all jobs
    pub async fn list_jobs(&self) -> Vec<DistributedJob> {
        let jobs = self.jobs.read().await;
        jobs.values().cloned().collect()
    }
}

impl Default for Coordinator {
    fn default() -> Self {
        Self::new()
    }
}

/// Worker node for distributed compression
pub struct Worker {
    pub id: String,
    pub address: String,
    coordinator_address: String,
}

impl Worker {
    /// Create a new worker
    pub fn new(address: String, coordinator: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            address,
            coordinator_address: coordinator,
        }
    }

    /// Process assigned chunks (stub)
    pub async fn process_assignment(&self, _assignment: &WorkerAssignment) -> SpkResult<WorkerResult> {
        // Would:
        // 1. Fetch source data from coordinator
        // 2. Compress assigned chunk range
        // 3. Upload compressed chunks
        // 4. Report progress
        
        Ok(WorkerResult {
            worker_id: self.id.clone(),
            chunks_processed: 0,
            compressed_data: Vec::new(),
            chunk_entries: Vec::new(),
        })
    }
}

/// Result from a worker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerResult {
    pub worker_id: String,
    pub chunks_processed: u64,
    pub compressed_data: Vec<u8>,
    pub chunk_entries: Vec<ChunkEntry>,
}

/// Merge results from all workers
pub fn merge_results(results: Vec<WorkerResult>) -> SpkResult<MergedResult> {
    let mut chunk_entries = Vec::new();
    let mut compressed_data = Vec::new();
    let mut current_offset = 0u64;

    // Sort by original chunk order (would need additional info)
    for result in results {
        for mut entry in result.chunk_entries {
            entry.offset = current_offset;
            current_offset += entry.compressed_size as u64;
            chunk_entries.push(entry);
        }
        compressed_data.extend(result.compressed_data);
    }

    Ok(MergedResult {
        chunk_entries,
        compressed_data,
    })
}

/// Merged result from all workers
#[derive(Debug)]
pub struct MergedResult {
    pub chunk_entries: Vec<ChunkEntry>,
    pub compressed_data: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_distributed_job_creation() {
        let job = DistributedJob::new(100, "archive-123".into());
        assert_eq!(job.state, JobState::Created);
        assert_eq!(job.total_chunks, 100);
    }

    #[test]
    fn test_worker_assignment() {
        let mut job = DistributedJob::new(100, "archive-123".into());
        job.assign_workers(&[
            "worker1:8080".into(),
            "worker2:8080".into(),
            "worker3:8080".into(),
        ]);

        assert_eq!(job.workers.len(), 3);
        
        // Verify all chunks are assigned
        let total_assigned: u64 = job.workers.iter().map(|w| w.chunk_count).sum();
        assert_eq!(total_assigned, 100);
    }

    #[test]
    fn test_progress_tracking() {
        let mut job = DistributedJob::new(100, "archive-123".into());
        job.assign_workers(&["worker1:8080".into(), "worker2:8080".into()]);

        job.update_worker("worker-0", WorkerStatus::InProgress, 25);
        assert_eq!(job.processed_chunks, 25);
        assert_eq!(job.state, JobState::Processing);

        job.update_worker("worker-0", WorkerStatus::Completed, 50);
        job.update_worker("worker-1", WorkerStatus::Completed, 50);
        assert_eq!(job.processed_chunks, 100);
        assert_eq!(job.state, JobState::Merging);
    }

    #[tokio::test]
    async fn test_coordinator() {
        let coordinator = Coordinator::new();
        
        coordinator.register_worker("worker1:8080".into()).await;
        coordinator.register_worker("worker2:8080".into()).await;

        let job_id = coordinator.create_job(100, "archive-123".into()).await.unwrap();
        
        let job = coordinator.get_job(&job_id).await.unwrap();
        assert_eq!(job.workers.len(), 2);
    }
}
