//! Job Scheduler Module (V6)
//!
//! Intelligent job scheduling for GPU and distributed chunk processing.
//! Handles priority queues, load balancing, and failover.

use std::collections::{BinaryHeap, HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::cmp::Ordering;
use crate::utils::error::{SpkError, SpkResult};
use crate::codec::Codec;
use crate::gpu::{GpuJob, GpuJobStatus};

/// Job priority level
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum JobPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// Schedulable job
#[derive(Debug, Clone)]
pub struct ScheduledJob {
    /// Unique job ID
    pub id: u64,
    /// Chunk index
    pub chunk_index: u64,
    /// Input data
    pub data: Arc<Vec<u8>>,
    /// Codec to use
    pub codec: Codec,
    /// Priority
    pub priority: JobPriority,
    /// Creation timestamp
    pub created_at: std::time::Instant,
    /// Target device (None = auto-assign)
    pub target_device: Option<u32>,
    /// Retry count
    pub retry_count: u32,
    /// Max retries
    pub max_retries: u32,
}

impl ScheduledJob {
    /// Create a new scheduled job
    pub fn new(chunk_index: u64, data: Vec<u8>, codec: Codec) -> Self {
        Self {
            id: rand::random(),
            chunk_index,
            data: Arc::new(data),
            codec,
            priority: JobPriority::Normal,
            created_at: std::time::Instant::now(),
            target_device: None,
            retry_count: 0,
            max_retries: 3,
        }
    }

    /// Set priority
    pub fn with_priority(mut self, priority: JobPriority) -> Self {
        self.priority = priority;
        self
    }

    /// Set target device
    pub fn with_device(mut self, device_id: u32) -> Self {
        self.target_device = Some(device_id);
        self
    }

    /// Convert to GPU job
    pub fn to_gpu_job(&self) -> GpuJob {
        GpuJob {
            id: self.id,
            chunk_index: self.chunk_index,
            input_offset: 0,
            input_size: self.data.len(),
            codec: self.codec,
            priority: self.priority as u32,
            device_id: self.target_device,
            status: GpuJobStatus::Pending,
        }
    }
}

impl Eq for ScheduledJob {}

impl PartialEq for ScheduledJob {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl PartialOrd for ScheduledJob {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ScheduledJob {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher priority first, then older jobs first
        match self.priority.cmp(&other.priority) {
            Ordering::Equal => other.created_at.cmp(&self.created_at),
            other => other,
        }
    }
}

/// Worker status
#[derive(Debug, Clone)]
pub struct WorkerStatus {
    /// Worker ID
    pub id: u32,
    /// Device ID
    pub device_id: u32,
    /// Current job ID (if processing)
    pub current_job: Option<u64>,
    /// Jobs completed
    pub jobs_completed: u64,
    /// Jobs failed
    pub jobs_failed: u64,
    /// Total bytes processed
    pub bytes_processed: u64,
    /// Average processing time in microseconds
    pub avg_processing_time_us: u64,
    /// Is available
    pub available: bool,
    /// Last heartbeat
    pub last_heartbeat: std::time::Instant,
}

impl WorkerStatus {
    /// Create new worker status
    pub fn new(id: u32, device_id: u32) -> Self {
        Self {
            id,
            device_id,
            current_job: None,
            jobs_completed: 0,
            jobs_failed: 0,
            bytes_processed: 0,
            avg_processing_time_us: 0,
            available: true,
            last_heartbeat: std::time::Instant::now(),
        }
    }

    /// Check if worker is healthy
    pub fn is_healthy(&self) -> bool {
        self.available && self.last_heartbeat.elapsed().as_secs() < 30
    }

    /// Calculate worker score for load balancing
    pub fn score(&self) -> f64 {
        if !self.is_healthy() {
            return 0.0;
        }
        
        let processing_factor = if self.avg_processing_time_us > 0 {
            1_000_000.0 / self.avg_processing_time_us as f64
        } else {
            1.0
        };
        
        let busy_factor = if self.current_job.is_some() { 0.5 } else { 1.0 };
        
        processing_factor * busy_factor
    }
}

/// Scheduler configuration
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// Max pending jobs
    pub max_pending_jobs: usize,
    /// Max jobs per worker
    pub max_jobs_per_worker: usize,
    /// Enable work stealing
    pub work_stealing: bool,
    /// Job timeout in seconds
    pub job_timeout_secs: u64,
    /// Enable adaptive batch sizing
    pub adaptive_batching: bool,
    /// Min batch size
    pub min_batch_size: usize,
    /// Max batch size
    pub max_batch_size: usize,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_pending_jobs: 10000,
            max_jobs_per_worker: 16,
            work_stealing: true,
            job_timeout_secs: 300,
            adaptive_batching: true,
            min_batch_size: 4,
            max_batch_size: 64,
        }
    }
}

/// Job scheduler for GPU and distributed processing
pub struct JobScheduler {
    /// Configuration
    config: SchedulerConfig,
    /// Priority queue of pending jobs
    pending_jobs: Arc<RwLock<BinaryHeap<ScheduledJob>>>,
    /// Jobs currently being processed
    processing_jobs: Arc<RwLock<HashMap<u64, ScheduledJob>>>,
    /// Completed job IDs
    completed_jobs: Arc<RwLock<VecDeque<u64>>>,
    /// Failed job IDs with error
    failed_jobs: Arc<RwLock<HashMap<u64, String>>>,
    /// Worker statuses
    workers: Arc<RwLock<HashMap<u32, WorkerStatus>>>,
    /// Running flag
    running: Arc<std::sync::atomic::AtomicBool>,
    /// Total jobs submitted
    total_submitted: std::sync::atomic::AtomicU64,
    /// Total jobs completed
    total_completed: std::sync::atomic::AtomicU64,
}

impl JobScheduler {
    /// Create a new job scheduler
    pub fn new(config: SchedulerConfig) -> Self {
        Self {
            config,
            pending_jobs: Arc::new(RwLock::new(BinaryHeap::new())),
            processing_jobs: Arc::new(RwLock::new(HashMap::new())),
            completed_jobs: Arc::new(RwLock::new(VecDeque::with_capacity(1000))),
            failed_jobs: Arc::new(RwLock::new(HashMap::new())),
            workers: Arc::new(RwLock::new(HashMap::new())),
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            total_submitted: std::sync::atomic::AtomicU64::new(0),
            total_completed: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Register a worker
    pub fn register_worker(&self, worker_id: u32, device_id: u32) -> SpkResult<()> {
        let mut workers = self.workers.write()
            .map_err(|_| SpkError::LockError("Failed to acquire workers lock".into()))?;
        workers.insert(worker_id, WorkerStatus::new(worker_id, device_id));
        Ok(())
    }

    /// Unregister a worker
    pub fn unregister_worker(&self, worker_id: u32) -> SpkResult<()> {
        let mut workers = self.workers.write()
            .map_err(|_| SpkError::LockError("Failed to acquire workers lock".into()))?;
        workers.remove(&worker_id);
        Ok(())
    }

    /// Submit a job
    pub fn submit(&self, job: ScheduledJob) -> SpkResult<u64> {
        let job_id = job.id;
        
        let mut pending = self.pending_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending jobs lock".into()))?;
        
        if pending.len() >= self.config.max_pending_jobs {
            return Err(SpkError::QueueFull("Job queue is full".into()));
        }
        
        pending.push(job);
        self.total_submitted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        
        Ok(job_id)
    }

    /// Submit multiple jobs
    pub fn submit_batch(&self, jobs: Vec<ScheduledJob>) -> SpkResult<Vec<u64>> {
        let mut pending = self.pending_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending jobs lock".into()))?;
        
        if pending.len() + jobs.len() > self.config.max_pending_jobs {
            return Err(SpkError::QueueFull("Job queue would overflow".into()));
        }
        
        let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();
        for job in jobs {
            pending.push(job);
        }
        
        self.total_submitted.fetch_add(ids.len() as u64, std::sync::atomic::Ordering::Relaxed);
        
        Ok(ids)
    }

    /// Get next job for a worker
    pub fn get_next_job(&self, worker_id: u32) -> SpkResult<Option<ScheduledJob>> {
        // Update worker heartbeat
        {
            let mut workers = self.workers.write()
                .map_err(|_| SpkError::LockError("Failed to acquire workers lock".into()))?;
            if let Some(worker) = workers.get_mut(&worker_id) {
                worker.last_heartbeat = std::time::Instant::now();
            }
        }

        let mut pending = self.pending_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending jobs lock".into()))?;
        
        if let Some(job) = pending.pop() {
            let mut processing = self.processing_jobs.write()
                .map_err(|_| SpkError::LockError("Failed to acquire processing jobs lock".into()))?;
            processing.insert(job.id, job.clone());
            
            // Update worker status
            let mut workers = self.workers.write()
                .map_err(|_| SpkError::LockError("Failed to acquire workers lock".into()))?;
            if let Some(worker) = workers.get_mut(&worker_id) {
                worker.current_job = Some(job.id);
            }
            
            Ok(Some(job))
        } else {
            Ok(None)
        }
    }

    /// Get a batch of jobs for a worker
    pub fn get_job_batch(&self, worker_id: u32, max_jobs: usize) -> SpkResult<Vec<ScheduledJob>> {
        let batch_size = if self.config.adaptive_batching {
            max_jobs.max(self.calculate_optimal_batch_size(worker_id)).min(self.config.max_batch_size)
        } else {
            max_jobs.min(self.config.max_batch_size)
        };

        let mut jobs = Vec::with_capacity(batch_size);
        
        let mut pending = self.pending_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending jobs lock".into()))?;
        
        let mut processing = self.processing_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire processing jobs lock".into()))?;
        
        while jobs.len() < batch_size {
            if let Some(job) = pending.pop() {
                processing.insert(job.id, job.clone());
                jobs.push(job);
            } else {
                break;
            }
        }

        Ok(jobs)
    }

    /// Calculate optimal batch size based on worker performance
    fn calculate_optimal_batch_size(&self, worker_id: u32) -> usize {
        let workers = match self.workers.read() {
            Ok(w) => w,
            Err(_) => return self.config.min_batch_size,
        };
        
        if let Some(worker) = workers.get(&worker_id) {
            // Base batch size on processing speed
            let speed_factor = if worker.avg_processing_time_us > 0 {
                (1_000_000.0 / worker.avg_processing_time_us as f64).sqrt()
            } else {
                1.0
            };
            
            let batch_size = (self.config.min_batch_size as f64 * speed_factor) as usize;
            batch_size.clamp(self.config.min_batch_size, self.config.max_batch_size)
        } else {
            self.config.min_batch_size
        }
    }

    /// Complete a job
    pub fn complete_job(&self, job_id: u64, worker_id: u32, processing_time_us: u64, bytes_processed: u64) -> SpkResult<()> {
        let mut processing = self.processing_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire processing jobs lock".into()))?;
        processing.remove(&job_id);

        let mut completed = self.completed_jobs.write()
            .map_err(|_| SpkError::LockError("Failed to acquire completed jobs lock".into()))?;
        
        // Keep only last 1000 completed job IDs
        if completed.len() >= 1000 {
            completed.pop_front();
        }
        completed.push_back(job_id);

        // Update worker stats
        let mut workers = self.workers.write()
            .map_err(|_| SpkError::LockError("Failed to acquire workers lock".into()))?;
        if let Some(worker) = workers.get_mut(&worker_id) {
            worker.current_job = None;
            worker.jobs_completed += 1;
            worker.bytes_processed += bytes_processed;
            
            // Update running average
            let n = worker.jobs_completed;
            worker.avg_processing_time_us = 
                ((worker.avg_processing_time_us as u128 * (n - 1) as u128 + processing_time_us as u128) / n as u128) as u64;
        }

        self.total_completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    /// Fail a job
    pub fn fail_job(&self, job_id: u64, worker_id: u32, error: String) -> SpkResult<()> {
        let job = {
            let mut processing = self.processing_jobs.write()
                .map_err(|_| SpkError::LockError("Failed to acquire processing jobs lock".into()))?;
            processing.remove(&job_id)
        };

        if let Some(mut job) = job {
            job.retry_count += 1;
            
            if job.retry_count < job.max_retries {
                // Requeue for retry
                let mut pending = self.pending_jobs.write()
                    .map_err(|_| SpkError::LockError("Failed to acquire pending jobs lock".into()))?;
                pending.push(job);
            } else {
                // Permanent failure
                let mut failed = self.failed_jobs.write()
                    .map_err(|_| SpkError::LockError("Failed to acquire failed jobs lock".into()))?;
                failed.insert(job_id, error);
            }
        }

        // Update worker stats
        let mut workers = self.workers.write()
            .map_err(|_| SpkError::LockError("Failed to acquire workers lock".into()))?;
        if let Some(worker) = workers.get_mut(&worker_id) {
            worker.current_job = None;
            worker.jobs_failed += 1;
        }

        Ok(())
    }

    /// Get scheduler statistics
    pub fn stats(&self) -> SchedulerStats {
        let pending_count = self.pending_jobs.read()
            .map(|p| p.len())
            .unwrap_or(0);
        
        let processing_count = self.processing_jobs.read()
            .map(|p| p.len())
            .unwrap_or(0);
        
        let failed_count = self.failed_jobs.read()
            .map(|f| f.len())
            .unwrap_or(0);
        
        let worker_count = self.workers.read()
            .map(|w| w.len())
            .unwrap_or(0);
        
        let healthy_workers = self.workers.read()
            .map(|w| w.values().filter(|ws| ws.is_healthy()).count())
            .unwrap_or(0);

        SchedulerStats {
            pending_jobs: pending_count,
            processing_jobs: processing_count,
            completed_jobs: self.total_completed.load(std::sync::atomic::Ordering::Relaxed),
            failed_jobs: failed_count,
            total_submitted: self.total_submitted.load(std::sync::atomic::Ordering::Relaxed),
            worker_count,
            healthy_workers,
        }
    }

    /// Check for timed out jobs
    pub fn check_timeouts(&self) -> SpkResult<Vec<u64>> {
        let timeout = std::time::Duration::from_secs(self.config.job_timeout_secs);
        let mut timed_out = Vec::new();

        let processing = self.processing_jobs.read()
            .map_err(|_| SpkError::LockError("Failed to acquire processing jobs lock".into()))?;
        
        for (id, job) in processing.iter() {
            if job.created_at.elapsed() > timeout {
                timed_out.push(*id);
            }
        }

        drop(processing);

        // Fail timed out jobs
        for id in &timed_out {
            self.fail_job(*id, 0, "Job timed out".to_string())?;
        }

        Ok(timed_out)
    }

    /// Start the scheduler
    pub fn start(&self) {
        self.running.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Stop the scheduler
    pub fn stop(&self) {
        self.running.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// Check if scheduler is running
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::Relaxed)
    }
}

impl Default for JobScheduler {
    fn default() -> Self {
        Self::new(SchedulerConfig::default())
    }
}

/// Scheduler statistics
#[derive(Debug, Clone)]
pub struct SchedulerStats {
    pub pending_jobs: usize,
    pub processing_jobs: usize,
    pub completed_jobs: u64,
    pub failed_jobs: usize,
    pub total_submitted: u64,
    pub worker_count: usize,
    pub healthy_workers: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_scheduling() {
        let scheduler = JobScheduler::default();
        scheduler.register_worker(1, 0).unwrap();
        
        let job = ScheduledJob::new(0, vec![1, 2, 3], Codec::Zstd);
        let job_id = scheduler.submit(job).unwrap();
        
        let fetched = scheduler.get_next_job(1).unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().id, job_id);
    }

    #[test]
    fn test_job_priority() {
        let scheduler = JobScheduler::default();
        scheduler.register_worker(1, 0).unwrap();
        
        let low = ScheduledJob::new(0, vec![1], Codec::Zstd).with_priority(JobPriority::Low);
        let high = ScheduledJob::new(1, vec![2], Codec::Zstd).with_priority(JobPriority::High);
        
        scheduler.submit(low).unwrap();
        scheduler.submit(high).unwrap();
        
        // High priority should come first
        let first = scheduler.get_next_job(1).unwrap().unwrap();
        assert_eq!(first.chunk_index, 1);
    }

    #[test]
    fn test_batch_jobs() {
        let scheduler = JobScheduler::default();
        scheduler.register_worker(1, 0).unwrap();
        
        let jobs: Vec<_> = (0..10)
            .map(|i| ScheduledJob::new(i, vec![i as u8], Codec::Zstd))
            .collect();
        
        scheduler.submit_batch(jobs).unwrap();
        
        let batch = scheduler.get_job_batch(1, 5).unwrap();
        assert_eq!(batch.len(), 5);
    }
}
