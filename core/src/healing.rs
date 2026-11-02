//! Auto-Healing Cluster Module (V7)
//!
//! Self-healing distributed cluster with predictive failure detection,
//! automatic node demotion, and zero-downtime reconfiguration.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use crate::utils::error::{SpkError, SpkResult};

/// Node health state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeHealth {
    /// Node is performing well
    Healthy,
    /// Node is degraded but functional
    Degraded,
    /// Node is at risk of failure
    AtRisk,
    /// Node has failed
    Failed,
    /// Node is recovering
    Recovering,
}

/// Node performance history
#[derive(Debug, Clone)]
pub struct NodePerformanceHistory {
    /// Node ID
    pub node_id: String,
    /// Throughput samples (bytes/sec)
    pub throughput_samples: Vec<f64>,
    /// Latency samples (microseconds)
    pub latency_samples: Vec<u64>,
    /// Error counts
    pub error_count: u64,
    /// Timeout counts
    pub timeout_count: u64,
    /// Last performance score
    pub performance_score: f64,
    /// Trend direction (-1, 0, 1)
    pub trend: i8,
}

impl NodePerformanceHistory {
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            throughput_samples: Vec::with_capacity(100),
            latency_samples: Vec::with_capacity(100),
            error_count: 0,
            timeout_count: 0,
            performance_score: 1.0,
            trend: 0,
        }
    }

    /// Record a performance sample
    pub fn record(&mut self, throughput: f64, latency: u64) {
        if self.throughput_samples.len() >= 100 {
            self.throughput_samples.remove(0);
        }
        if self.latency_samples.len() >= 100 {
            self.latency_samples.remove(0);
        }

        self.throughput_samples.push(throughput);
        self.latency_samples.push(latency);
        self.update_score();
    }

    /// Record an error
    pub fn record_error(&mut self) {
        self.error_count += 1;
        self.update_score();
    }

    /// Record a timeout
    pub fn record_timeout(&mut self) {
        self.timeout_count += 1;
        self.update_score();
    }

    /// Update performance score
    fn update_score(&mut self) {
        let avg_throughput = if self.throughput_samples.is_empty() {
            0.0
        } else {
            self.throughput_samples.iter().sum::<f64>() / self.throughput_samples.len() as f64
        };

        let avg_latency = if self.latency_samples.is_empty() {
            0.0
        } else {
            self.latency_samples.iter().sum::<u64>() as f64 / self.latency_samples.len() as f64
        };

        // Normalize scores
        let throughput_score = (avg_throughput / 1_000_000_000.0).min(1.0); // Normalize to GB/s
        let latency_score = 1.0 - (avg_latency as f64 / 1_000_000.0).min(1.0); // Lower is better
        let error_penalty = (self.error_count as f64 * 0.05).min(0.5);
        let timeout_penalty = (self.timeout_count as f64 * 0.1).min(0.5);

        let old_score = self.performance_score;
        self.performance_score = ((throughput_score + latency_score) / 2.0 - error_penalty - timeout_penalty).max(0.0);

        // Calculate trend
        if self.performance_score > old_score + 0.05 {
            self.trend = 1;
        } else if self.performance_score < old_score - 0.05 {
            self.trend = -1;
        } else {
            self.trend = 0;
        }
    }

    /// Get health assessment
    pub fn assess_health(&self) -> NodeHealth {
        if self.performance_score > 0.8 && self.trend >= 0 {
            NodeHealth::Healthy
        } else if self.performance_score > 0.5 {
            if self.trend < 0 {
                NodeHealth::AtRisk
            } else {
                NodeHealth::Degraded
            }
        } else if self.performance_score > 0.2 {
            NodeHealth::AtRisk
        } else {
            NodeHealth::Failed
        }
    }
}

/// Healing action
#[derive(Debug, Clone)]
pub enum HealingAction {
    /// No action needed
    None,
    /// Reduce load on node
    ReduceLoad { node_id: String, factor: f64 },
    /// Demote node to lower priority
    DemoteNode { node_id: String },
    /// Remove node from cluster
    RemoveNode { node_id: String },
    /// Redistribute work from node
    RedistributeWork { node_id: String, target_nodes: Vec<String> },
    /// Restart node
    RestartNode { node_id: String },
    /// Scale up cluster
    ScaleUp { additional_nodes: usize },
    /// Scale down cluster
    ScaleDown { remove_count: usize },
}

/// Auto-healing cluster configuration
#[derive(Debug, Clone)]
pub struct AutoHealingConfig {
    /// Health check interval in seconds
    pub health_check_interval_secs: u64,
    /// Degradation threshold
    pub degradation_threshold: f64,
    /// Failure threshold
    pub failure_threshold: f64,
    /// Auto-remove failed nodes
    pub auto_remove_failed: bool,
    /// Auto-scale enabled
    pub auto_scale: bool,
    /// Minimum healthy nodes
    pub min_healthy_nodes: usize,
    /// Maximum nodes
    pub max_nodes: usize,
    /// Prediction window (samples)
    pub prediction_window: usize,
}

impl Default for AutoHealingConfig {
    fn default() -> Self {
        Self {
            health_check_interval_secs: 5,
            degradation_threshold: 0.7,
            failure_threshold: 0.3,
            auto_remove_failed: true,
            auto_scale: true,
            min_healthy_nodes: 1,
            max_nodes: 100,
            prediction_window: 20,
        }
    }
}

/// Auto-healing cluster manager
pub struct AutoHealingCluster {
    /// Configuration
    config: AutoHealingConfig,
    /// Node performance histories
    histories: Arc<RwLock<HashMap<String, NodePerformanceHistory>>>,
    /// Node health states
    health_states: Arc<RwLock<HashMap<String, NodeHealth>>>,
    /// Pending healing actions
    pending_actions: Arc<RwLock<Vec<HealingAction>>>,
    /// Action history
    action_history: Arc<RwLock<Vec<(Instant, HealingAction)>>>,
    /// Running flag
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl AutoHealingCluster {
    /// Create a new auto-healing cluster
    pub fn new(config: AutoHealingConfig) -> Self {
        Self {
            config,
            histories: Arc::new(RwLock::new(HashMap::new())),
            health_states: Arc::new(RwLock::new(HashMap::new())),
            pending_actions: Arc::new(RwLock::new(Vec::new())),
            action_history: Arc::new(RwLock::new(Vec::new())),
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Register a node
    pub fn register_node(&self, node_id: &str) -> SpkResult<()> {
        let mut histories = self.histories.write()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        histories.insert(node_id.to_string(), NodePerformanceHistory::new(node_id.to_string()));

        let mut states = self.health_states.write()
            .map_err(|_| SpkError::LockError("Failed to acquire health states lock".into()))?;
        states.insert(node_id.to_string(), NodeHealth::Healthy);

        Ok(())
    }

    /// Unregister a node
    pub fn unregister_node(&self, node_id: &str) -> SpkResult<()> {
        let mut histories = self.histories.write()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        histories.remove(node_id);

        let mut states = self.health_states.write()
            .map_err(|_| SpkError::LockError("Failed to acquire health states lock".into()))?;
        states.remove(node_id);

        Ok(())
    }

    /// Record node metrics
    pub fn record_metrics(&self, node_id: &str, throughput: f64, latency: u64) -> SpkResult<()> {
        let mut histories = self.histories.write()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        
        if let Some(history) = histories.get_mut(node_id) {
            history.record(throughput, latency);
            
            // Update health state
            let health = history.assess_health();
            drop(histories);
            
            let mut states = self.health_states.write()
                .map_err(|_| SpkError::LockError("Failed to acquire health states lock".into()))?;
            states.insert(node_id.to_string(), health);
        }

        Ok(())
    }

    /// Record node error
    pub fn record_error(&self, node_id: &str) -> SpkResult<()> {
        let mut histories = self.histories.write()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        
        if let Some(history) = histories.get_mut(node_id) {
            history.record_error();
        }

        Ok(())
    }

    /// Record node timeout
    pub fn record_timeout(&self, node_id: &str) -> SpkResult<()> {
        let mut histories = self.histories.write()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        
        if let Some(history) = histories.get_mut(node_id) {
            history.record_timeout();
        }

        Ok(())
    }

    /// Perform health check and generate healing actions
    pub fn health_check(&self) -> SpkResult<Vec<HealingAction>> {
        let histories = self.histories.read()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        
        let mut actions = Vec::new();
        let mut healthy_count = 0;
        let mut failed_nodes = Vec::new();
        let mut at_risk_nodes = Vec::new();

        for (node_id, history) in histories.iter() {
            let health = history.assess_health();
            
            match health {
                NodeHealth::Healthy => healthy_count += 1,
                NodeHealth::Degraded => {
                    actions.push(HealingAction::ReduceLoad {
                        node_id: node_id.clone(),
                        factor: 0.7,
                    });
                }
                NodeHealth::AtRisk => {
                    at_risk_nodes.push(node_id.clone());
                    actions.push(HealingAction::DemoteNode {
                        node_id: node_id.clone(),
                    });
                }
                NodeHealth::Failed => {
                    failed_nodes.push(node_id.clone());
                    if self.config.auto_remove_failed {
                        actions.push(HealingAction::RemoveNode {
                            node_id: node_id.clone(),
                        });
                    }
                }
                NodeHealth::Recovering => {
                    // No action, wait for recovery
                }
            }
        }

        // Redistribute work from failed nodes
        if !failed_nodes.is_empty() && healthy_count > 0 {
            let healthy_nodes: Vec<String> = histories.iter()
                .filter(|(_, h)| h.assess_health() == NodeHealth::Healthy)
                .map(|(id, _)| id.clone())
                .collect();

            for failed_id in &failed_nodes {
                actions.push(HealingAction::RedistributeWork {
                    node_id: failed_id.clone(),
                    target_nodes: healthy_nodes.clone(),
                });
            }
        }

        // Auto-scale if needed
        if self.config.auto_scale {
            if healthy_count < self.config.min_healthy_nodes {
                let needed = self.config.min_healthy_nodes - healthy_count;
                actions.push(HealingAction::ScaleUp {
                    additional_nodes: needed,
                });
            } else if healthy_count > self.config.max_nodes {
                let excess = healthy_count - self.config.max_nodes;
                actions.push(HealingAction::ScaleDown {
                    remove_count: excess,
                });
            }
        }

        // Store pending actions
        let mut pending = self.pending_actions.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending actions lock".into()))?;
        *pending = actions.clone();

        Ok(actions)
    }

    /// Execute a healing action
    pub fn execute_action(&self, action: &HealingAction) -> SpkResult<()> {
        // Record action in history
        let mut history = self.action_history.write()
            .map_err(|_| SpkError::LockError("Failed to acquire action history lock".into()))?;
        history.push((Instant::now(), action.clone()));

        // Keep only last 1000 actions
        if history.len() > 1000 {
            history.remove(0);
        }

        // Execute action (in real impl, would coordinate with cluster manager)
        match action {
            HealingAction::RemoveNode { node_id } => {
                self.unregister_node(node_id)?;
            }
            HealingAction::DemoteNode { node_id } => {
                // Update health state to recovering
                let mut states = self.health_states.write()
                    .map_err(|_| SpkError::LockError("Failed to acquire health states lock".into()))?;
                states.insert(node_id.clone(), NodeHealth::Recovering);
            }
            _ => {
                // Other actions would be implemented by cluster coordinator
            }
        }

        Ok(())
    }

    /// Predict node failures
    pub fn predict_failures(&self) -> SpkResult<Vec<String>> {
        let histories = self.histories.read()
            .map_err(|_| SpkError::LockError("Failed to acquire histories lock".into()))?;
        
        let mut at_risk = Vec::new();

        for (node_id, history) in histories.iter() {
            // Check for declining trend
            if history.trend < 0 && history.performance_score < 0.6 {
                at_risk.push(node_id.clone());
            }
            
            // Check for high error rate
            if history.error_count > 10 || history.timeout_count > 5 {
                if !at_risk.contains(node_id) {
                    at_risk.push(node_id.clone());
                }
            }
        }

        Ok(at_risk)
    }

    /// Get node health
    pub fn get_node_health(&self, node_id: &str) -> SpkResult<Option<NodeHealth>> {
        let states = self.health_states.read()
            .map_err(|_| SpkError::LockError("Failed to acquire health states lock".into()))?;
        Ok(states.get(node_id).copied())
    }

    /// Get all node health states
    pub fn get_all_health(&self) -> SpkResult<HashMap<String, NodeHealth>> {
        let states = self.health_states.read()
            .map_err(|_| SpkError::LockError("Failed to acquire health states lock".into()))?;
        Ok(states.clone())
    }

    /// Get cluster statistics
    pub fn stats(&self) -> ClusterHealthStats {
        let states = self.health_states.read().ok();
        let histories = self.histories.read().ok();

        let (healthy, degraded, at_risk, failed) = states
            .map(|s| {
                let mut h = 0;
                let mut d = 0;
                let mut r = 0;
                let mut f = 0;
                for health in s.values() {
                    match health {
                        NodeHealth::Healthy => h += 1,
                        NodeHealth::Degraded => d += 1,
                        NodeHealth::AtRisk | NodeHealth::Recovering => r += 1,
                        NodeHealth::Failed => f += 1,
                    }
                }
                (h, d, r, f)
            })
            .unwrap_or((0, 0, 0, 0));

        let avg_score = histories
            .map(|h| {
                if h.is_empty() {
                    0.0
                } else {
                    h.values().map(|ph| ph.performance_score).sum::<f64>() / h.len() as f64
                }
            })
            .unwrap_or(0.0);

        ClusterHealthStats {
            total_nodes: healthy + degraded + at_risk + failed,
            healthy_nodes: healthy,
            degraded_nodes: degraded,
            at_risk_nodes: at_risk,
            failed_nodes: failed,
            average_performance_score: avg_score,
        }
    }

    /// Start the auto-healing monitor
    pub fn start(&self) {
        self.running.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Stop the auto-healing monitor
    pub fn stop(&self) {
        self.running.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::Relaxed)
    }
}

impl Default for AutoHealingCluster {
    fn default() -> Self {
        Self::new(AutoHealingConfig::default())
    }
}

/// Cluster health statistics
#[derive(Debug, Clone)]
pub struct ClusterHealthStats {
    pub total_nodes: usize,
    pub healthy_nodes: usize,
    pub degraded_nodes: usize,
    pub at_risk_nodes: usize,
    pub failed_nodes: usize,
    pub average_performance_score: f64,
}

/// Dynamic reconfiguration manager
pub struct DynamicReconfiguration {
    /// Current chunk size
    current_chunk_size: Arc<std::sync::atomic::AtomicUsize>,
    /// Active GPU count
    active_gpus: Arc<std::sync::atomic::AtomicUsize>,
    /// Active node count
    active_nodes: Arc<std::sync::atomic::AtomicUsize>,
    /// Reconfiguration in progress
    reconfiguring: Arc<std::sync::atomic::AtomicBool>,
}

impl DynamicReconfiguration {
    /// Create new reconfiguration manager
    pub fn new() -> Self {
        Self {
            current_chunk_size: Arc::new(std::sync::atomic::AtomicUsize::new(4 * 1024 * 1024)),
            active_gpus: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            active_nodes: Arc::new(std::sync::atomic::AtomicUsize::new(1)),
            reconfiguring: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Change chunk size without restart
    pub fn set_chunk_size(&self, size: usize) -> SpkResult<()> {
        if self.reconfiguring.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(SpkError::Internal("Reconfiguration already in progress".into()));
        }

        self.reconfiguring.store(true, std::sync::atomic::Ordering::SeqCst);
        self.current_chunk_size.store(size, std::sync::atomic::Ordering::SeqCst);
        self.reconfiguring.store(false, std::sync::atomic::Ordering::SeqCst);

        Ok(())
    }

    /// Get current chunk size
    pub fn chunk_size(&self) -> usize {
        self.current_chunk_size.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Add GPU
    pub fn add_gpu(&self) -> usize {
        self.active_gpus.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
    }

    /// Remove GPU
    pub fn remove_gpu(&self) -> usize {
        let current = self.active_gpus.load(std::sync::atomic::Ordering::Relaxed);
        if current > 0 {
            self.active_gpus.fetch_sub(1, std::sync::atomic::Ordering::SeqCst) - 1
        } else {
            0
        }
    }

    /// Get GPU count
    pub fn gpu_count(&self) -> usize {
        self.active_gpus.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Scale nodes
    pub fn scale_nodes(&self, count: usize) {
        self.active_nodes.store(count, std::sync::atomic::Ordering::SeqCst);
    }

    /// Get node count
    pub fn node_count(&self) -> usize {
        self.active_nodes.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Check if reconfiguring
    pub fn is_reconfiguring(&self) -> bool {
        self.reconfiguring.load(std::sync::atomic::Ordering::Relaxed)
    }
}

impl Default for DynamicReconfiguration {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_performance_history() {
        let mut history = NodePerformanceHistory::new("node1".to_string());
        
        for i in 0..50 {
            history.record(1_000_000_000.0 - i as f64 * 10_000_000.0, 1000 + i);
        }

        assert!(history.performance_score > 0.0);
    }

    #[test]
    fn test_auto_healing_cluster() {
        let cluster = AutoHealingCluster::default();
        cluster.register_node("node1").unwrap();
        cluster.register_node("node2").unwrap();

        cluster.record_metrics("node1", 1_000_000_000.0, 1000).unwrap();
        cluster.record_metrics("node2", 100_000.0, 100000).unwrap(); // Poor performance

        let actions = cluster.health_check().unwrap();
        assert!(!actions.is_empty());
    }

    #[test]
    fn test_dynamic_reconfiguration() {
        let reconfig = DynamicReconfiguration::new();
        
        reconfig.set_chunk_size(8 * 1024 * 1024).unwrap();
        assert_eq!(reconfig.chunk_size(), 8 * 1024 * 1024);

        assert_eq!(reconfig.add_gpu(), 1);
        assert_eq!(reconfig.add_gpu(), 2);
        assert_eq!(reconfig.gpu_count(), 2);
    }
}
