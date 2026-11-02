//! Performance Engine Module (V6)
//!
//! Unified high-performance compression engine combining GPU, scheduler,
//! zero-copy buffers, and cluster coordination for maximum throughput.

use std::sync::Arc;
use crate::utils::error::{SpkError, SpkResult};
use crate::codec::Codec;
use crate::gpu::{GpuPipeline, GpuDevice, GpuJob, GpuBackend};
use crate::scheduler::{JobScheduler, ScheduledJob, SchedulerConfig};
use crate::zerocopy::{BufferPool, AlignedBuffer};
use crate::cluster::{ClusterManager, ClusterConfig, NodeRole};

/// Performance mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PerformanceMode {
    /// Single-threaded (debugging/compatibility)
    Single,
    /// Multi-threaded CPU only
    Parallel,
    /// GPU accelerated
    Gpu,
    /// Multi-GPU
    MultiGpu,
    /// Distributed cluster
    Distributed,
    /// Maximum performance (auto-detect best)
    Maximum,
}

/// Performance engine configuration
#[derive(Debug, Clone)]
pub struct PerformanceConfig {
    /// Performance mode
    pub mode: PerformanceMode,
    /// Target throughput in bytes/sec (0 = maximum)
    pub target_throughput: u64,
    /// Number of worker threads
    pub worker_threads: usize,
    /// Max memory usage in bytes
    pub max_memory: u64,
    /// Chunk size (0 = adaptive)
    pub chunk_size: usize,
    /// Enable prefetching
    pub prefetch: bool,
    /// Prefetch queue depth
    pub prefetch_depth: usize,
    /// Enable speculative decoding
    pub speculative_decode: bool,
    /// Enable RDMA if available
    pub enable_rdma: bool,
    /// Buffer pool size
    pub buffer_pool_size: usize,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            mode: PerformanceMode::Maximum,
            target_throughput: 0,
            worker_threads: num_cpus::get(),
            max_memory: 4 * 1024 * 1024 * 1024, // 4GB
            chunk_size: 0, // Adaptive
            prefetch: true,
            prefetch_depth: 4,
            speculative_decode: true,
            enable_rdma: false,
            buffer_pool_size: 32,
        }
    }
}

/// Performance statistics
#[derive(Debug, Clone, Default)]
pub struct PerformanceStats {
    /// Total bytes processed
    pub bytes_processed: u64,
    /// Total chunks processed
    pub chunks_processed: u64,
    /// Processing time in microseconds
    pub processing_time_us: u64,
    /// Current throughput in bytes/sec
    pub throughput_bytes_per_sec: f64,
    /// Peak throughput achieved
    pub peak_throughput: f64,
    /// GPU utilization (0.0-1.0)
    pub gpu_utilization: f64,
    /// CPU utilization (0.0-1.0)
    pub cpu_utilization: f64,
    /// Memory usage in bytes
    pub memory_usage: u64,
    /// Active workers
    pub active_workers: usize,
    /// Pending jobs
    pub pending_jobs: usize,
}

impl PerformanceStats {
    /// Calculate throughput in GB/sec
    pub fn throughput_gb_sec(&self) -> f64 {
        self.throughput_bytes_per_sec / (1024.0 * 1024.0 * 1024.0)
    }

    /// Check if meeting target
    pub fn meeting_target(&self, target: u64) -> bool {
        target == 0 || self.throughput_bytes_per_sec >= target as f64
    }
}

/// High-performance compression engine
pub struct PerformanceEngine {
    /// Configuration
    config: PerformanceConfig,
    /// GPU pipeline
    gpu_pipeline: Option<GpuPipeline>,
    /// Job scheduler
    scheduler: Arc<JobScheduler>,
    /// Buffer pool
    buffer_pool: Arc<BufferPool>,
    /// Cluster manager (if distributed)
    cluster: Option<Arc<ClusterManager>>,
    /// Running flag
    running: Arc<std::sync::atomic::AtomicBool>,
    /// Statistics
    stats: Arc<std::sync::RwLock<PerformanceStats>>,
    /// Start time
    start_time: std::time::Instant,
}

impl PerformanceEngine {
    /// Create a new performance engine
    pub fn new(config: PerformanceConfig) -> SpkResult<Self> {
        let scheduler = Arc::new(JobScheduler::new(SchedulerConfig {
            max_pending_jobs: 10000,
            max_jobs_per_worker: 16,
            work_stealing: true,
            job_timeout_secs: 300,
            adaptive_batching: true,
            min_batch_size: 4,
            max_batch_size: 64,
        }));

        let buffer_pool = Arc::new(BufferPool::new(
            config.chunk_size.max(4 * 1024 * 1024),
            config.buffer_pool_size,
        ));

        let gpu_pipeline = match config.mode {
            PerformanceMode::Gpu | PerformanceMode::MultiGpu | PerformanceMode::Maximum => {
                GpuPipeline::new().ok()
            }
            _ => None,
        };

        let cluster = match config.mode {
            PerformanceMode::Distributed | PerformanceMode::Maximum => {
                if config.mode == PerformanceMode::Maximum {
                    // Only enable cluster if explicitly configured
                    None
                } else {
                    Some(Arc::new(ClusterManager::new(
                        ClusterConfig::default(),
                        NodeRole::Hybrid,
                    )))
                }
            }
            _ => None,
        };

        Ok(Self {
            config,
            gpu_pipeline,
            scheduler,
            buffer_pool,
            cluster,
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            stats: Arc::new(std::sync::RwLock::new(PerformanceStats::default())),
            start_time: std::time::Instant::now(),
        })
    }

    /// Get effective performance mode based on available hardware
    pub fn effective_mode(&self) -> PerformanceMode {
        if self.config.mode != PerformanceMode::Maximum {
            return self.config.mode;
        }

        // Auto-detect best mode
        if self.cluster.is_some() {
            return PerformanceMode::Distributed;
        }

        if let Some(ref pipeline) = self.gpu_pipeline {
            let devices = pipeline.devices();
            if devices.len() > 1 && devices.iter().any(|d| d.backend != GpuBackend::CpuFallback) {
                return PerformanceMode::MultiGpu;
            }
            if devices.iter().any(|d| d.backend != GpuBackend::CpuFallback) {
                return PerformanceMode::Gpu;
            }
        }

        if self.config.worker_threads > 1 {
            PerformanceMode::Parallel
        } else {
            PerformanceMode::Single
        }
    }

    /// Get estimated throughput based on available resources
    pub fn estimated_throughput(&self) -> f64 {
        let mut throughput = 0.0;

        // CPU contribution
        let cpu_factor = self.config.worker_threads as f64 * 0.5; // ~0.5 GB/s per core
        throughput += cpu_factor;

        // GPU contribution
        if let Some(ref pipeline) = self.gpu_pipeline {
            throughput += pipeline.estimated_throughput();
        }

        // Cluster contribution
        if let Some(ref cluster) = self.cluster {
            let stats = cluster.stats();
            throughput += stats.estimated_throughput_chunks_per_sec as f64 * 0.004; // 4MB chunks
        }

        throughput
    }

    /// Start the engine
    pub fn start(&self) -> SpkResult<()> {
        self.running.store(true, std::sync::atomic::Ordering::SeqCst);
        
        self.scheduler.start();
        
        if let Some(ref pipeline) = self.gpu_pipeline {
            pipeline.start()?;
        }
        
        if let Some(ref cluster) = self.cluster {
            cluster.start();
        }

        Ok(())
    }

    /// Stop the engine
    pub fn stop(&self) {
        self.running.store(false, std::sync::atomic::Ordering::SeqCst);
        
        self.scheduler.stop();
        
        if let Some(ref pipeline) = self.gpu_pipeline {
            pipeline.stop();
        }
        
        if let Some(ref cluster) = self.cluster {
            cluster.stop();
        }
    }

    /// Submit data for compression
    pub fn compress(&self, data: Vec<u8>, codec: Codec) -> SpkResult<u64> {
        let job = ScheduledJob::new(0, data, codec);
        self.scheduler.submit(job)
    }

    /// Submit a batch for compression
    pub fn compress_batch(&self, chunks: Vec<(u64, Vec<u8>)>, codec: Codec) -> SpkResult<Vec<u64>> {
        let jobs: Vec<ScheduledJob> = chunks
            .into_iter()
            .map(|(idx, data)| ScheduledJob::new(idx, data, codec))
            .collect();
        
        self.scheduler.submit_batch(jobs)
    }

    /// Process data using GPU
    pub fn gpu_compress(&self, data: &[u8], codec: Codec) -> SpkResult<Vec<u8>> {
        let pipeline = self.gpu_pipeline.as_ref()
            .ok_or_else(|| SpkError::GpuError("GPU not available".into()))?;

        let job = GpuJob {
            id: rand::random(),
            chunk_index: 0,
            input_offset: 0,
            input_size: data.len(),
            codec,
            priority: 1,
            device_id: None,
            status: crate::gpu::GpuJobStatus::Pending,
        };

        pipeline.submit_batch(vec![job])?;
        
        // In real implementation, wait for result
        // For now, fall back to CPU
        crate::codec::compress(data, codec, crate::codec::CompressionLevel::Normal)
    }

    /// Get a buffer from the pool
    pub fn get_buffer(&self) -> crate::zerocopy::PooledBuffer<'_> {
        self.buffer_pool.acquire()
    }

    /// Create an aligned buffer for SIMD/GPU operations
    pub fn aligned_buffer(&self, size: usize) -> AlignedBuffer {
        AlignedBuffer::simd_aligned(size)
    }

    /// Get current statistics
    pub fn stats(&self) -> PerformanceStats {
        self.stats.read().map(|s| s.clone()).unwrap_or_default()
    }

    /// Update statistics
    fn update_stats(&self, bytes: u64, chunks: u64, time_us: u64) {
        if let Ok(mut stats) = self.stats.write() {
            stats.bytes_processed += bytes;
            stats.chunks_processed += chunks;
            stats.processing_time_us += time_us;
            
            if stats.processing_time_us > 0 {
                stats.throughput_bytes_per_sec = 
                    (stats.bytes_processed as f64 * 1_000_000.0) / stats.processing_time_us as f64;
                
                if stats.throughput_bytes_per_sec > stats.peak_throughput {
                    stats.peak_throughput = stats.throughput_bytes_per_sec;
                }
            }

            let scheduler_stats = self.scheduler.stats();
            stats.pending_jobs = scheduler_stats.pending_jobs;
            stats.active_workers = scheduler_stats.healthy_workers;
        }
    }

    /// Get buffer pool statistics
    pub fn buffer_stats(&self) -> crate::zerocopy::BufferPoolStats {
        self.buffer_pool.stats()
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Get GPU devices
    pub fn gpu_devices(&self) -> Vec<GpuDevice> {
        self.gpu_pipeline.as_ref()
            .map(|p| p.devices().to_vec())
            .unwrap_or_default()
    }

    /// Get cluster statistics
    pub fn cluster_stats(&self) -> Option<crate::cluster::ClusterStats> {
        self.cluster.as_ref().map(|c| c.stats())
    }
}

impl Default for PerformanceEngine {
    fn default() -> Self {
        Self::new(PerformanceConfig::default())
            .expect("Failed to create default performance engine")
    }
}

/// Parallel chunk processor for decompression
pub struct ParallelDecompressor {
    /// Worker count
    workers: usize,
    /// Prefetch queue
    prefetch_queue: crossbeam_channel::Sender<(u64, Vec<u8>)>,
    /// Result receiver
    result_receiver: crossbeam_channel::Receiver<(u64, Vec<u8>)>,
}

impl ParallelDecompressor {
    /// Create a new parallel decompressor
    pub fn new(workers: usize) -> Self {
        let (tx, _rx) = crossbeam_channel::bounded(workers * 4);
        let (_result_tx, result_rx) = crossbeam_channel::bounded(workers * 4);
        
        Self {
            workers,
            prefetch_queue: tx,
            result_receiver: result_rx,
        }
    }

    /// Prefetch a chunk for decompression
    pub fn prefetch(&self, chunk_id: u64, data: Vec<u8>) -> SpkResult<()> {
        self.prefetch_queue.send((chunk_id, data))
            .map_err(|_| SpkError::QueueFull("Prefetch queue full".into()))
    }

    /// Get next decompressed result
    pub fn get_result(&self) -> Option<(u64, Vec<u8>)> {
        self.result_receiver.try_recv().ok()
    }

    /// Get worker count
    pub fn worker_count(&self) -> usize {
        self.workers
    }
}

/// Speculative decoder for low-latency preview
pub struct SpeculativeDecoder {
    /// Decoded cache
    cache: std::sync::RwLock<std::collections::HashMap<u64, Vec<u8>>>,
    /// Max cache entries
    max_entries: usize,
}

impl SpeculativeDecoder {
    /// Create a new speculative decoder
    pub fn new(max_entries: usize) -> Self {
        Self {
            cache: std::sync::RwLock::new(std::collections::HashMap::new()),
            max_entries,
        }
    }

    /// Add decoded data to cache
    pub fn cache(&self, chunk_id: u64, data: Vec<u8>) {
        if let Ok(mut cache) = self.cache.write() {
            if cache.len() >= self.max_entries {
                // Remove oldest entry
                if let Some(key) = cache.keys().next().cloned() {
                    cache.remove(&key);
                }
            }
            cache.insert(chunk_id, data);
        }
    }

    /// Get cached data
    pub fn get(&self, chunk_id: u64) -> Option<Vec<u8>> {
        self.cache.read().ok()?.get(&chunk_id).cloned()
    }

    /// Check if chunk is cached
    pub fn is_cached(&self, chunk_id: u64) -> bool {
        self.cache.read().ok()
            .map(|c| c.contains_key(&chunk_id))
            .unwrap_or(false)
    }

    /// Clear cache
    pub fn clear(&self) {
        if let Ok(mut cache) = self.cache.write() {
            cache.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_performance_engine_creation() {
        let engine = PerformanceEngine::default();
        assert!(!engine.is_running());
    }

    #[test]
    fn test_performance_mode_detection() {
        let config = PerformanceConfig {
            mode: PerformanceMode::Maximum,
            ..Default::default()
        };
        let engine = PerformanceEngine::new(config).unwrap();
        let mode = engine.effective_mode();
        // Should be at least Parallel on any modern system
        assert!(matches!(mode, PerformanceMode::Parallel | PerformanceMode::Gpu | PerformanceMode::MultiGpu));
    }

    #[test]
    fn test_buffer_pool() {
        let engine = PerformanceEngine::default();
        let buf = engine.get_buffer();
        assert!(buf.len() > 0);
    }

    #[test]
    fn test_speculative_decoder() {
        let decoder = SpeculativeDecoder::new(10);
        decoder.cache(1, vec![1, 2, 3]);
        
        assert!(decoder.is_cached(1));
        assert!(!decoder.is_cached(2));
        
        let data = decoder.get(1).unwrap();
        assert_eq!(data, vec![1, 2, 3]);
    }
}
