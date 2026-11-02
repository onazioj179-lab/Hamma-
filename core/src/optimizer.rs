//! Autonomic Optimizer Module (V7)
//!
//! Self-tuning, self-balancing runtime optimization engine.
//! Dynamically adjusts chunking, GPU usage, codec selection, and cluster behavior.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::Instant;
use crate::utils::error::{SpkError, SpkResult};
use crate::codec::Codec;

/// Performance metrics sample
#[derive(Debug, Clone)]
pub struct PerformanceMetrics {
    /// Timestamp
    pub timestamp: Instant,
    /// Throughput in bytes/sec
    pub throughput: f64,
    /// Latency in microseconds
    pub latency_us: u64,
    /// CPU utilization (0.0-1.0)
    pub cpu_utilization: f64,
    /// GPU utilization (0.0-1.0)
    pub gpu_utilization: f64,
    /// Memory usage in bytes
    pub memory_usage: u64,
    /// Network saturation (0.0-1.0)
    pub network_saturation: f64,
    /// Active chunk size
    pub chunk_size: usize,
    /// Active codec
    pub codec: Codec,
    /// Compression ratio achieved
    pub compression_ratio: f64,
}

impl Default for PerformanceMetrics {
    fn default() -> Self {
        Self {
            timestamp: Instant::now(),
            throughput: 0.0,
            latency_us: 0,
            cpu_utilization: 0.0,
            gpu_utilization: 0.0,
            memory_usage: 0,
            network_saturation: 0.0,
            chunk_size: 4 * 1024 * 1024,
            codec: Codec::Zstd,
            compression_ratio: 1.0,
        }
    }
}

/// Optimization target
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptimizationTarget {
    /// Maximize throughput
    Throughput,
    /// Minimize latency
    Latency,
    /// Minimize memory usage
    Memory,
    /// Maximize compression ratio
    Compression,
    /// Balance all factors
    Balanced,
    /// Minimize power consumption
    Power,
}

/// Optimizer configuration
#[derive(Debug, Clone)]
pub struct OptimizerConfig {
    /// Optimization target
    pub target: OptimizationTarget,
    /// Metrics history size
    pub history_size: usize,
    /// Sample interval in milliseconds
    pub sample_interval_ms: u64,
    /// Enable auto-tuning
    pub auto_tune: bool,
    /// Minimum chunk size
    pub min_chunk_size: usize,
    /// Maximum chunk size
    pub max_chunk_size: usize,
    /// GPU utilization target
    pub gpu_target_utilization: f64,
    /// CPU utilization target
    pub cpu_target_utilization: f64,
    /// Learning rate for adjustments
    pub learning_rate: f64,
}

impl Default for OptimizerConfig {
    fn default() -> Self {
        Self {
            target: OptimizationTarget::Balanced,
            history_size: 1000,
            sample_interval_ms: 100,
            auto_tune: true,
            min_chunk_size: 1024 * 1024,        // 1MB
            max_chunk_size: 64 * 1024 * 1024,   // 64MB
            gpu_target_utilization: 0.85,
            cpu_target_utilization: 0.80,
            learning_rate: 0.1,
        }
    }
}

/// Optimization decision
#[derive(Debug, Clone)]
pub struct OptimizationDecision {
    /// Recommended chunk size
    pub chunk_size: usize,
    /// Recommended codec
    pub codec: Codec,
    /// Recommended GPU batch size
    pub gpu_batch_size: usize,
    /// Recommended worker ratio (GPU:CPU)
    pub gpu_cpu_ratio: f64,
    /// Recommended node count
    pub node_count: usize,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
    /// Reasoning
    pub reason: String,
}

/// Optimizer state
#[derive(Debug, Clone)]
pub struct OptimizerState {
    /// Current metrics
    pub current: PerformanceMetrics,
    /// Current decision
    pub decision: OptimizationDecision,
    /// Is optimization active
    pub active: bool,
    /// Last optimization time
    pub last_optimization: Instant,
    /// Optimization count
    pub optimization_count: u64,
    /// Model accuracy estimate
    pub model_accuracy: f64,
}

/// Autonomic optimizer engine
pub struct AutonomicOptimizer {
    /// Configuration
    config: OptimizerConfig,
    /// Metrics history
    history: Arc<RwLock<VecDeque<PerformanceMetrics>>>,
    /// Current state
    state: Arc<RwLock<OptimizerState>>,
    /// Performance model
    model: Arc<RwLock<PerformanceModel>>,
    /// Running flag
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl AutonomicOptimizer {
    /// Create a new optimizer
    pub fn new(config: OptimizerConfig) -> Self {
        let initial_decision = OptimizationDecision {
            chunk_size: 4 * 1024 * 1024,
            codec: Codec::Zstd,
            gpu_batch_size: 16,
            gpu_cpu_ratio: 0.7,
            node_count: 1,
            confidence: 0.5,
            reason: "Initial default configuration".to_string(),
        };

        let state = OptimizerState {
            current: PerformanceMetrics::default(),
            decision: initial_decision,
            active: false,
            last_optimization: Instant::now(),
            optimization_count: 0,
            model_accuracy: 0.5,
        };

        Self {
            config,
            history: Arc::new(RwLock::new(VecDeque::with_capacity(1000))),
            state: Arc::new(RwLock::new(state)),
            model: Arc::new(RwLock::new(PerformanceModel::new())),
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Record a metrics sample
    pub fn record_metrics(&self, metrics: PerformanceMetrics) -> SpkResult<()> {
        let mut history = self.history.write()
            .map_err(|_| SpkError::LockError("Failed to acquire history lock".into()))?;
        
        if history.len() >= self.config.history_size {
            history.pop_front();
        }
        history.push_back(metrics.clone());

        // Update current state
        let mut state = self.state.write()
            .map_err(|_| SpkError::LockError("Failed to acquire state lock".into()))?;
        state.current = metrics;

        Ok(())
    }

    /// Run optimization cycle
    pub fn optimize(&self) -> SpkResult<OptimizationDecision> {
        let history = self.history.read()
            .map_err(|_| SpkError::LockError("Failed to acquire history lock".into()))?;
        
        if history.len() < 10 {
            // Not enough data
            let state = self.state.read()
                .map_err(|_| SpkError::LockError("Failed to acquire state lock".into()))?;
            return Ok(state.decision.clone());
        }

        // Calculate averages
        let avg_throughput: f64 = history.iter().map(|m| m.throughput).sum::<f64>() / history.len() as f64;
        let avg_cpu: f64 = history.iter().map(|m| m.cpu_utilization).sum::<f64>() / history.len() as f64;
        let avg_gpu: f64 = history.iter().map(|m| m.gpu_utilization).sum::<f64>() / history.len() as f64;
        let avg_latency: f64 = history.iter().map(|m| m.latency_us as f64).sum::<f64>() / history.len() as f64;

        let current_chunk_size = history.back().map(|m| m.chunk_size).unwrap_or(4 * 1024 * 1024);

        // Make optimization decisions
        let mut decision = OptimizationDecision {
            chunk_size: current_chunk_size,
            codec: Codec::Zstd,
            gpu_batch_size: 16,
            gpu_cpu_ratio: 0.7,
            node_count: 1,
            confidence: 0.7,
            reason: String::new(),
        };

        let mut reasons = Vec::new();

        // Chunk size optimization
        if avg_gpu < 0.5 && avg_cpu < 0.5 {
            // Underutilized - increase chunk size
            decision.chunk_size = (current_chunk_size * 2).min(self.config.max_chunk_size);
            reasons.push("Increased chunk size due to low utilization");
        } else if avg_latency > 100_000.0 {
            // High latency - decrease chunk size
            decision.chunk_size = (current_chunk_size / 2).max(self.config.min_chunk_size);
            reasons.push("Decreased chunk size due to high latency");
        }

        // GPU/CPU ratio optimization
        if avg_gpu > self.config.gpu_target_utilization && avg_cpu < 0.5 {
            decision.gpu_cpu_ratio = (decision.gpu_cpu_ratio - 0.1).max(0.3);
            reasons.push("Shifted work to CPU due to GPU saturation");
        } else if avg_cpu > self.config.cpu_target_utilization && avg_gpu < 0.5 {
            decision.gpu_cpu_ratio = (decision.gpu_cpu_ratio + 0.1).min(0.9);
            reasons.push("Shifted work to GPU due to CPU saturation");
        }

        // GPU batch size optimization
        if avg_gpu < 0.7 {
            decision.gpu_batch_size = (decision.gpu_batch_size + 4).min(64);
            reasons.push("Increased GPU batch size");
        } else if avg_gpu > 0.95 {
            decision.gpu_batch_size = (decision.gpu_batch_size - 2).max(4);
            reasons.push("Decreased GPU batch size to prevent overload");
        }

        // Codec selection based on compression ratio and throughput
        let avg_ratio: f64 = history.iter().map(|m| m.compression_ratio).sum::<f64>() / history.len() as f64;
        
        decision.codec = match self.config.target {
            OptimizationTarget::Compression => {
                if avg_ratio < 0.5 { Codec::Zstd } else { Codec::Brotli }
            }
            OptimizationTarget::Throughput => Codec::Lz4,
            OptimizationTarget::Latency => Codec::Lz4,
            _ => Codec::Zstd,
        };

        decision.reason = reasons.join("; ");
        if decision.reason.is_empty() {
            decision.reason = "No changes needed".to_string();
        }

        // Update state
        let mut state = self.state.write()
            .map_err(|_| SpkError::LockError("Failed to acquire state lock".into()))?;
        state.decision = decision.clone();
        state.last_optimization = Instant::now();
        state.optimization_count += 1;

        // Update model with feedback
        drop(state);
        self.update_model(avg_throughput, avg_latency)?;

        Ok(decision)
    }

    /// Update the performance model
    fn update_model(&self, throughput: f64, latency: f64) -> SpkResult<()> {
        let mut model = self.model.write()
            .map_err(|_| SpkError::LockError("Failed to acquire model lock".into()))?;
        
        model.record_observation(throughput, latency);
        
        if model.observations.len() >= 100 {
            model.retrain();
        }

        Ok(())
    }

    /// Get current state
    pub fn state(&self) -> SpkResult<OptimizerState> {
        let state = self.state.read()
            .map_err(|_| SpkError::LockError("Failed to acquire state lock".into()))?;
        Ok(state.clone())
    }

    /// Get current decision
    pub fn current_decision(&self) -> SpkResult<OptimizationDecision> {
        let state = self.state.read()
            .map_err(|_| SpkError::LockError("Failed to acquire state lock".into()))?;
        Ok(state.decision.clone())
    }

    /// Force retrain the model
    pub fn retrain_model(&self) -> SpkResult<()> {
        let mut model = self.model.write()
            .map_err(|_| SpkError::LockError("Failed to acquire model lock".into()))?;
        model.retrain();
        Ok(())
    }

    /// Start the optimizer
    pub fn start(&self) {
        self.running.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut state) = self.state.write() {
            state.active = true;
        }
    }

    /// Stop the optimizer
    pub fn stop(&self) {
        self.running.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut state) = self.state.write() {
            state.active = false;
        }
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Get optimization statistics
    pub fn stats(&self) -> OptimizerStats {
        let state = self.state.read().ok();
        let history_len = self.history.read().map(|h| h.len()).unwrap_or(0);
        let model_trained = self.model.read().map(|m| m.trained).unwrap_or(false);

        OptimizerStats {
            active: state.as_ref().map(|s| s.active).unwrap_or(false),
            optimization_count: state.as_ref().map(|s| s.optimization_count).unwrap_or(0),
            history_samples: history_len,
            model_trained,
            model_accuracy: state.as_ref().map(|s| s.model_accuracy).unwrap_or(0.0),
        }
    }
}

impl Default for AutonomicOptimizer {
    fn default() -> Self {
        Self::new(OptimizerConfig::default())
    }
}

/// Optimizer statistics
#[derive(Debug, Clone)]
pub struct OptimizerStats {
    pub active: bool,
    pub optimization_count: u64,
    pub history_samples: usize,
    pub model_trained: bool,
    pub model_accuracy: f64,
}

/// Simple embedded performance model (no external dependencies)
pub struct PerformanceModel {
    /// Observations: (chunk_size, codec_id, throughput, latency)
    observations: Vec<(usize, u8, f64, f64)>,
    /// Chunk size weights
    chunk_weights: HashMap<usize, f64>,
    /// Codec weights
    codec_weights: HashMap<u8, f64>,
    /// Is trained
    trained: bool,
    /// Training count
    train_count: u32,
}

impl PerformanceModel {
    /// Create a new model
    pub fn new() -> Self {
        Self {
            observations: Vec::new(),
            chunk_weights: HashMap::new(),
            codec_weights: HashMap::new(),
            trained: false,
            train_count: 0,
        }
    }

    /// Record an observation
    pub fn record_observation(&mut self, throughput: f64, latency: f64) {
        // Simplified - in real impl would include chunk_size and codec
        self.observations.push((4 * 1024 * 1024, 0, throughput, latency));
        
        if self.observations.len() > 10000 {
            self.observations.remove(0);
        }
    }

    /// Retrain the model
    pub fn retrain(&mut self) {
        if self.observations.len() < 50 {
            return;
        }

        // Simple weight calculation based on throughput
        self.chunk_weights.clear();
        self.codec_weights.clear();

        let mut chunk_perf: HashMap<usize, Vec<f64>> = HashMap::new();
        let mut codec_perf: HashMap<u8, Vec<f64>> = HashMap::new();

        for (chunk_size, codec, throughput, _) in &self.observations {
            chunk_perf.entry(*chunk_size).or_default().push(*throughput);
            codec_perf.entry(*codec).or_default().push(*throughput);
        }

        for (chunk_size, perfs) in chunk_perf {
            let avg = perfs.iter().sum::<f64>() / perfs.len() as f64;
            self.chunk_weights.insert(chunk_size, avg);
        }

        for (codec, perfs) in codec_perf {
            let avg = perfs.iter().sum::<f64>() / perfs.len() as f64;
            self.codec_weights.insert(codec, avg);
        }

        self.trained = true;
        self.train_count += 1;
    }

    /// Predict optimal chunk size
    pub fn predict_chunk_size(&self) -> Option<usize> {
        self.chunk_weights.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| *k)
    }

    /// Predict optimal codec
    pub fn predict_codec(&self) -> Option<Codec> {
        self.codec_weights.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| match k {
                0 => Codec::Zstd,
                1 => Codec::Lz4,
                2 => Codec::Brotli,
                _ => Codec::None,
            })
    }

    /// Predict throughput for given configuration
    pub fn predict_throughput(&self, chunk_size: usize, codec: u8) -> f64 {
        let chunk_factor = self.chunk_weights.get(&chunk_size).copied().unwrap_or(1.0);
        let codec_factor = self.codec_weights.get(&codec).copied().unwrap_or(1.0);
        (chunk_factor + codec_factor) / 2.0
    }
}

impl Default for PerformanceModel {
    fn default() -> Self {
        Self::new()
    }
}

/// Adaptive codec pipeline that can switch codecs mid-file
pub struct AdaptiveCodecPipeline {
    /// Current codec
    current_codec: Codec,
    /// Chunk codec history
    chunk_codecs: Vec<(u64, Codec)>,
    /// Data type detector
    type_detector: DataTypeDetector,
    /// Enable per-chunk codec switching
    per_chunk_switching: bool,
}

impl AdaptiveCodecPipeline {
    /// Create a new adaptive pipeline
    pub fn new() -> Self {
        Self {
            current_codec: Codec::Zstd,
            chunk_codecs: Vec::new(),
            type_detector: DataTypeDetector::new(),
            per_chunk_switching: true,
        }
    }

    /// Select codec for a chunk based on data analysis
    pub fn select_codec_for_chunk(&mut self, chunk_index: u64, data: &[u8]) -> Codec {
        let data_type = self.type_detector.detect(data);
        
        let codec = match data_type {
            DataType::Text => Codec::Zstd,
            DataType::Json => Codec::Brotli,
            DataType::Binary => Codec::Zstd,
            DataType::CompressedMedia => Codec::None, // Already compressed
            DataType::HighEntropy => Codec::None,     // Won't compress well
            DataType::Unknown => self.current_codec,
        };

        if self.per_chunk_switching {
            self.chunk_codecs.push((chunk_index, codec));
        }

        codec
    }

    /// Get codec used for a chunk
    pub fn get_chunk_codec(&self, chunk_index: u64) -> Option<Codec> {
        self.chunk_codecs.iter()
            .find(|(idx, _)| *idx == chunk_index)
            .map(|(_, codec)| *codec)
    }

    /// Enable/disable per-chunk switching
    pub fn set_per_chunk_switching(&mut self, enabled: bool) {
        self.per_chunk_switching = enabled;
    }
}

impl Default for AdaptiveCodecPipeline {
    fn default() -> Self {
        Self::new()
    }
}

/// Detected data type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataType {
    Text,
    Json,
    Binary,
    CompressedMedia,
    HighEntropy,
    Unknown,
}

/// Data type detector
pub struct DataTypeDetector {
    /// Detection threshold
    entropy_threshold: f64,
}

impl DataTypeDetector {
    /// Create a new detector
    pub fn new() -> Self {
        Self {
            entropy_threshold: 7.5,
        }
    }

    /// Detect data type from sample
    pub fn detect(&self, data: &[u8]) -> DataType {
        if data.is_empty() {
            return DataType::Unknown;
        }

        // Check for common magic bytes
        if data.len() >= 4 {
            let magic = &data[0..4];
            
            // JPEG
            if magic[0] == 0xFF && magic[1] == 0xD8 {
                return DataType::CompressedMedia;
            }
            // PNG
            if magic == [0x89, 0x50, 0x4E, 0x47] {
                return DataType::CompressedMedia;
            }
            // ZIP/GZIP
            if magic[0..2] == [0x50, 0x4B] || magic[0..2] == [0x1F, 0x8B] {
                return DataType::CompressedMedia;
            }
        }

        // Check if text
        let text_chars = data.iter().filter(|&&b| {
            b.is_ascii_alphanumeric() || b.is_ascii_whitespace() || b.is_ascii_punctuation()
        }).count();
        
        let text_ratio = text_chars as f64 / data.len() as f64;
        
        if text_ratio > 0.9 {
            // Check for JSON
            let sample = std::str::from_utf8(&data[..data.len().min(1000)]).unwrap_or("");
            if sample.trim_start().starts_with('{') || sample.trim_start().starts_with('[') {
                return DataType::Json;
            }
            return DataType::Text;
        }

        // Check entropy
        let entropy = self.calculate_entropy(data);
        if entropy > self.entropy_threshold {
            return DataType::HighEntropy;
        }

        DataType::Binary
    }

    /// Calculate Shannon entropy
    fn calculate_entropy(&self, data: &[u8]) -> f64 {
        let mut freq = [0u64; 256];
        for &byte in data {
            freq[byte as usize] += 1;
        }

        let len = data.len() as f64;
        freq.iter()
            .filter(|&&f| f > 0)
            .map(|&f| {
                let p = f as f64 / len;
                -p * p.log2()
            })
            .sum()
    }
}

impl Default for DataTypeDetector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_optimizer_creation() {
        let optimizer = AutonomicOptimizer::default();
        assert!(!optimizer.is_running());
    }

    #[test]
    fn test_record_metrics() {
        let optimizer = AutonomicOptimizer::default();
        let metrics = PerformanceMetrics::default();
        optimizer.record_metrics(metrics).unwrap();
        
        let state = optimizer.state().unwrap();
        assert!(!state.active);
    }

    #[test]
    fn test_data_type_detection() {
        let detector = DataTypeDetector::new();
        
        let text = b"Hello, this is plain text content.";
        assert_eq!(detector.detect(text), DataType::Text);
        
        let json = b"{\"key\": \"value\", \"number\": 42}";
        assert_eq!(detector.detect(json), DataType::Json);
    }

    #[test]
    fn test_performance_model() {
        let mut model = PerformanceModel::new();
        
        for i in 0..100 {
            model.record_observation(1000.0 + i as f64, 100.0);
        }
        
        model.retrain();
        assert!(model.trained);
    }
}
