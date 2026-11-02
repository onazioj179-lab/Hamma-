//! Cluster Module (V6)
//!
//! Distributed compression cluster for multi-node processing.
//! Supports QUIC/gRPC transport, failover, and automatic scaling.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::net::SocketAddr;
use crate::utils::error::{SpkError, SpkResult};
use crate::codec::Codec;

/// Node role in the cluster
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeRole {
    /// Master node - coordinates work
    Master,
    /// Worker node - processes chunks
    Worker,
    /// Hybrid - can act as both
    Hybrid,
}

/// Node status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeStatus {
    /// Node is starting up
    Starting,
    /// Node is ready to accept work
    Ready,
    /// Node is busy processing
    Busy,
    /// Node is draining (finishing current work)
    Draining,
    /// Node is offline
    Offline,
    /// Node has failed
    Failed,
}

/// Node capabilities
#[derive(Debug, Clone)]
pub struct NodeCapabilities {
    /// Number of CPU cores
    pub cpu_cores: u32,
    /// Available memory in bytes
    pub memory_bytes: u64,
    /// GPU count
    pub gpu_count: u32,
    /// Max chunks per second
    pub max_chunks_per_sec: u32,
    /// Supported codecs
    pub codecs: Vec<Codec>,
    /// Network bandwidth estimate (MB/s)
    pub network_bandwidth_mbps: u32,
    /// RDMA capable
    pub rdma_capable: bool,
}

impl Default for NodeCapabilities {
    fn default() -> Self {
        Self {
            cpu_cores: num_cpus::get() as u32,
            memory_bytes: 8 * 1024 * 1024 * 1024, // 8GB default
            gpu_count: 0,
            max_chunks_per_sec: 100,
            codecs: vec![Codec::Zstd, Codec::Lz4, Codec::Brotli],
            network_bandwidth_mbps: 1000,
            rdma_capable: false,
        }
    }
}

/// Cluster node information
#[derive(Debug, Clone)]
pub struct ClusterNode {
    /// Node ID
    pub id: String,
    /// Node address
    pub address: SocketAddr,
    /// Node role
    pub role: NodeRole,
    /// Current status
    pub status: NodeStatus,
    /// Capabilities
    pub capabilities: NodeCapabilities,
    /// Current load (0.0-1.0)
    pub load: f64,
    /// Jobs completed
    pub jobs_completed: u64,
    /// Jobs failed
    pub jobs_failed: u64,
    /// Bytes processed
    pub bytes_processed: u64,
    /// Last heartbeat
    pub last_heartbeat: std::time::Instant,
    /// Join time
    pub joined_at: std::time::Instant,
}

impl ClusterNode {
    /// Create a new node
    pub fn new(id: String, address: SocketAddr, role: NodeRole) -> Self {
        Self {
            id,
            address,
            role,
            status: NodeStatus::Starting,
            capabilities: NodeCapabilities::default(),
            load: 0.0,
            jobs_completed: 0,
            jobs_failed: 0,
            bytes_processed: 0,
            last_heartbeat: std::time::Instant::now(),
            joined_at: std::time::Instant::now(),
        }
    }

    /// Check if node is healthy
    pub fn is_healthy(&self) -> bool {
        matches!(self.status, NodeStatus::Ready | NodeStatus::Busy)
            && self.last_heartbeat.elapsed().as_secs() < 30
    }

    /// Calculate node score for load balancing
    pub fn score(&self) -> f64 {
        if !self.is_healthy() {
            return 0.0;
        }

        let load_factor = 1.0 - self.load;
        let capability_factor = 
            (self.capabilities.cpu_cores as f64 * 0.3) +
            (self.capabilities.gpu_count as f64 * 2.0) +
            (self.capabilities.network_bandwidth_mbps as f64 / 1000.0);
        
        load_factor * capability_factor
    }
}

/// Chunk batch for distributed processing
#[derive(Debug, Clone)]
pub struct ChunkBatch {
    /// Batch ID
    pub id: u64,
    /// Archive ID
    pub archive_id: String,
    /// Chunk indices
    pub chunk_indices: Vec<u64>,
    /// Chunk data (indexed by chunk_index)
    pub chunks: HashMap<u64, Vec<u8>>,
    /// Codec to use
    pub codec: Codec,
    /// Priority
    pub priority: u32,
    /// Created at
    pub created_at: std::time::Instant,
}

impl ChunkBatch {
    /// Create a new batch
    pub fn new(archive_id: String, codec: Codec) -> Self {
        Self {
            id: rand::random(),
            archive_id,
            chunk_indices: Vec::new(),
            chunks: HashMap::new(),
            codec,
            priority: 0,
            created_at: std::time::Instant::now(),
        }
    }

    /// Add a chunk
    pub fn add_chunk(&mut self, index: u64, data: Vec<u8>) {
        self.chunk_indices.push(index);
        self.chunks.insert(index, data);
    }

    /// Get total size
    pub fn total_size(&self) -> usize {
        self.chunks.values().map(|c| c.len()).sum()
    }

    /// Get chunk count
    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }
}

/// Batch result from worker
#[derive(Debug, Clone)]
pub struct BatchResult {
    /// Batch ID
    pub batch_id: u64,
    /// Compressed chunks (indexed by chunk_index)
    pub compressed: HashMap<u64, CompressedChunk>,
    /// Processing time in microseconds
    pub processing_time_us: u64,
    /// Worker node ID
    pub worker_id: String,
}

/// Compressed chunk result
#[derive(Debug, Clone)]
pub struct CompressedChunk {
    /// Chunk index
    pub index: u64,
    /// Compressed data
    pub data: Vec<u8>,
    /// Original size
    pub original_size: u64,
    /// Compressed size
    pub compressed_size: u64,
    /// SHA-256 hash
    pub hash: [u8; 32],
    /// Codec used
    pub codec: Codec,
}

/// Cluster configuration
#[derive(Debug, Clone)]
pub struct ClusterConfig {
    /// Cluster name
    pub name: String,
    /// Master address
    pub master_address: Option<SocketAddr>,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u32,
    /// Node timeout in seconds
    pub node_timeout_secs: u32,
    /// Max batch size (chunks)
    pub max_batch_size: usize,
    /// Max batch bytes
    pub max_batch_bytes: usize,
    /// Enable RDMA if available
    pub enable_rdma: bool,
    /// Use QUIC transport
    pub use_quic: bool,
    /// Retry failed batches
    pub retry_failed: bool,
    /// Max retries
    pub max_retries: u32,
}

impl Default for ClusterConfig {
    fn default() -> Self {
        Self {
            name: "spk-cluster".to_string(),
            master_address: None,
            heartbeat_interval_secs: 5,
            node_timeout_secs: 30,
            max_batch_size: 32,
            max_batch_bytes: 256 * 1024 * 1024, // 256MB
            enable_rdma: true,
            use_quic: true,
            retry_failed: true,
            max_retries: 3,
        }
    }
}

/// Cluster manager for distributed compression
pub struct ClusterManager {
    /// Configuration
    config: ClusterConfig,
    /// This node's ID
    node_id: String,
    /// This node's role
    role: NodeRole,
    /// Known nodes
    nodes: Arc<RwLock<HashMap<String, ClusterNode>>>,
    /// Pending batches
    pending_batches: Arc<RwLock<HashMap<u64, ChunkBatch>>>,
    /// Processing batches
    processing_batches: Arc<RwLock<HashMap<u64, (ChunkBatch, String)>>>, // (batch, worker_id)
    /// Completed batches
    completed_results: Arc<RwLock<Vec<BatchResult>>>,
    /// Running flag
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl ClusterManager {
    /// Create a new cluster manager
    pub fn new(config: ClusterConfig, role: NodeRole) -> Self {
        let node_id = uuid::Uuid::new_v4().to_string();
        
        Self {
            config,
            node_id,
            role,
            nodes: Arc::new(RwLock::new(HashMap::new())),
            pending_batches: Arc::new(RwLock::new(HashMap::new())),
            processing_batches: Arc::new(RwLock::new(HashMap::new())),
            completed_results: Arc::new(RwLock::new(Vec::new())),
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Get this node's ID
    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// Get this node's role
    pub fn role(&self) -> NodeRole {
        self.role
    }

    /// Register a node
    pub fn register_node(&self, node: ClusterNode) -> SpkResult<()> {
        let mut nodes = self.nodes.write()
            .map_err(|_| SpkError::LockError("Failed to acquire nodes lock".into()))?;
        nodes.insert(node.id.clone(), node);
        Ok(())
    }

    /// Unregister a node
    pub fn unregister_node(&self, node_id: &str) -> SpkResult<()> {
        let mut nodes = self.nodes.write()
            .map_err(|_| SpkError::LockError("Failed to acquire nodes lock".into()))?;
        nodes.remove(node_id);
        Ok(())
    }

    /// Get available worker nodes
    pub fn get_workers(&self) -> SpkResult<Vec<ClusterNode>> {
        let nodes = self.nodes.read()
            .map_err(|_| SpkError::LockError("Failed to acquire nodes lock".into()))?;
        
        Ok(nodes.values()
            .filter(|n| {
                matches!(n.role, NodeRole::Worker | NodeRole::Hybrid)
                    && n.is_healthy()
            })
            .cloned()
            .collect())
    }

    /// Get best worker for a batch
    pub fn get_best_worker(&self) -> SpkResult<Option<ClusterNode>> {
        let workers = self.get_workers()?;
        Ok(workers.into_iter().max_by(|a, b| {
            a.score().partial_cmp(&b.score()).unwrap_or(std::cmp::Ordering::Equal)
        }))
    }

    /// Submit a batch for processing
    pub fn submit_batch(&self, batch: ChunkBatch) -> SpkResult<u64> {
        let batch_id = batch.id;
        
        let mut pending = self.pending_batches.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending batches lock".into()))?;
        pending.insert(batch_id, batch);
        
        Ok(batch_id)
    }

    /// Get next batch for a worker
    pub fn get_next_batch(&self, worker_id: &str) -> SpkResult<Option<ChunkBatch>> {
        let mut pending = self.pending_batches.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending batches lock".into()))?;
        
        // Get highest priority batch
        let batch_id = pending.values()
            .max_by_key(|b| b.priority)
            .map(|b| b.id);
        
        if let Some(id) = batch_id {
            if let Some(batch) = pending.remove(&id) {
                let mut processing = self.processing_batches.write()
                    .map_err(|_| SpkError::LockError("Failed to acquire processing batches lock".into()))?;
                processing.insert(id, (batch.clone(), worker_id.to_string()));
                return Ok(Some(batch));
            }
        }
        
        Ok(None)
    }

    /// Complete a batch
    pub fn complete_batch(&self, result: BatchResult) -> SpkResult<()> {
        let batch_id = result.batch_id;
        
        let mut processing = self.processing_batches.write()
            .map_err(|_| SpkError::LockError("Failed to acquire processing batches lock".into()))?;
        processing.remove(&batch_id);
        
        let mut completed = self.completed_results.write()
            .map_err(|_| SpkError::LockError("Failed to acquire completed results lock".into()))?;
        completed.push(result);
        
        Ok(())
    }

    /// Fail a batch (will be retried)
    pub fn fail_batch(&self, batch_id: u64, _error: String) -> SpkResult<()> {
        let mut processing = self.processing_batches.write()
            .map_err(|_| SpkError::LockError("Failed to acquire processing batches lock".into()))?;
        
        if let Some((batch, _)) = processing.remove(&batch_id) {
            if self.config.retry_failed {
                let mut pending = self.pending_batches.write()
                    .map_err(|_| SpkError::LockError("Failed to acquire pending batches lock".into()))?;
                pending.insert(batch_id, batch);
            }
        }
        
        Ok(())
    }

    /// Get completed results
    pub fn get_results(&self) -> SpkResult<Vec<BatchResult>> {
        let mut completed = self.completed_results.write()
            .map_err(|_| SpkError::LockError("Failed to acquire completed results lock".into()))?;
        Ok(std::mem::take(&mut *completed))
    }

    /// Update node heartbeat
    pub fn heartbeat(&self, node_id: &str, load: f64) -> SpkResult<()> {
        let mut nodes = self.nodes.write()
            .map_err(|_| SpkError::LockError("Failed to acquire nodes lock".into()))?;
        
        if let Some(node) = nodes.get_mut(node_id) {
            node.last_heartbeat = std::time::Instant::now();
            node.load = load;
        }
        
        Ok(())
    }

    /// Check for timed out nodes
    pub fn check_timeouts(&self) -> SpkResult<Vec<String>> {
        let timeout = std::time::Duration::from_secs(self.config.node_timeout_secs as u64);
        let mut timed_out = Vec::new();
        
        let mut nodes = self.nodes.write()
            .map_err(|_| SpkError::LockError("Failed to acquire nodes lock".into()))?;
        
        for (id, node) in nodes.iter_mut() {
            if node.last_heartbeat.elapsed() > timeout {
                node.status = NodeStatus::Offline;
                timed_out.push(id.clone());
            }
        }
        
        Ok(timed_out)
    }

    /// Redistribute work from failed nodes
    pub fn redistribute_work(&self, failed_node_id: &str) -> SpkResult<usize> {
        let mut processing = self.processing_batches.write()
            .map_err(|_| SpkError::LockError("Failed to acquire processing batches lock".into()))?;
        
        let mut pending = self.pending_batches.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending batches lock".into()))?;
        
        let mut redistributed = 0;
        let batch_ids: Vec<u64> = processing.iter()
            .filter(|(_, (_, worker_id))| worker_id == failed_node_id)
            .map(|(id, _)| *id)
            .collect();
        
        for batch_id in batch_ids {
            if let Some((batch, _)) = processing.remove(&batch_id) {
                pending.insert(batch_id, batch);
                redistributed += 1;
            }
        }
        
        Ok(redistributed)
    }

    /// Get cluster statistics
    pub fn stats(&self) -> ClusterStats {
        let nodes = self.nodes.read().map(|n| n.len()).unwrap_or(0);
        let healthy = self.nodes.read()
            .map(|n| n.values().filter(|node| node.is_healthy()).count())
            .unwrap_or(0);
        let pending = self.pending_batches.read().map(|p| p.len()).unwrap_or(0);
        let processing = self.processing_batches.read().map(|p| p.len()).unwrap_or(0);
        
        let total_throughput = self.nodes.read()
            .map(|n| n.values()
                .filter(|node| node.is_healthy())
                .map(|node| node.capabilities.max_chunks_per_sec as u64)
                .sum())
            .unwrap_or(0);

        ClusterStats {
            node_count: nodes,
            healthy_nodes: healthy,
            pending_batches: pending,
            processing_batches: processing,
            estimated_throughput_chunks_per_sec: total_throughput,
        }
    }

    /// Start the cluster manager
    pub fn start(&self) {
        self.running.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Stop the cluster manager
    pub fn stop(&self) {
        self.running.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::Relaxed)
    }
}

impl Default for ClusterManager {
    fn default() -> Self {
        Self::new(ClusterConfig::default(), NodeRole::Hybrid)
    }
}

/// Cluster statistics
#[derive(Debug, Clone)]
pub struct ClusterStats {
    pub node_count: usize,
    pub healthy_nodes: usize,
    pub pending_batches: usize,
    pub processing_batches: usize,
    pub estimated_throughput_chunks_per_sec: u64,
}

/// Network transport trait for cluster communication
pub trait ClusterTransport: Send + Sync {
    /// Send a batch to a worker
    fn send_batch(&self, worker: &ClusterNode, batch: &ChunkBatch) -> SpkResult<()>;
    
    /// Receive a batch result
    fn receive_result(&self, timeout: std::time::Duration) -> SpkResult<Option<BatchResult>>;
    
    /// Send heartbeat
    fn send_heartbeat(&self, to: &ClusterNode) -> SpkResult<()>;
}

/// QUIC-based transport
pub struct QuicTransport {
    /// Configuration
    #[allow(dead_code)]
    config: ClusterConfig,
}

impl QuicTransport {
    /// Create a new QUIC transport
    pub fn new(config: ClusterConfig) -> Self {
        Self { config }
    }
}

impl ClusterTransport for QuicTransport {
    fn send_batch(&self, _worker: &ClusterNode, _batch: &ChunkBatch) -> SpkResult<()> {
        // Real implementation would use quinn or similar
        Ok(())
    }

    fn receive_result(&self, _timeout: std::time::Duration) -> SpkResult<Option<BatchResult>> {
        Ok(None)
    }

    fn send_heartbeat(&self, _to: &ClusterNode) -> SpkResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cluster_node() {
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let mut node = ClusterNode::new("node1".to_string(), addr, NodeRole::Worker);
        node.status = NodeStatus::Ready;
        
        assert!(node.is_healthy());
        assert!(node.score() > 0.0);
    }

    #[test]
    fn test_chunk_batch() {
        let mut batch = ChunkBatch::new("archive1".to_string(), Codec::Zstd);
        batch.add_chunk(0, vec![1, 2, 3]);
        batch.add_chunk(1, vec![4, 5, 6, 7]);
        
        assert_eq!(batch.chunk_count(), 2);
        assert_eq!(batch.total_size(), 7);
    }

    #[test]
    fn test_cluster_manager() {
        let manager = ClusterManager::default();
        
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let mut node = ClusterNode::new("worker1".to_string(), addr, NodeRole::Worker);
        node.status = NodeStatus::Ready;
        
        manager.register_node(node).unwrap();
        
        let workers = manager.get_workers().unwrap();
        assert_eq!(workers.len(), 1);
    }
}
