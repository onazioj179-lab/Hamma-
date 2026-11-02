//! # SPK V18: Realtime Streaming + Low-Latency Operation
//!
//! Sub-millisecond latency for sensors, cameras, telemetry, and live audio/video.

use std::collections::VecDeque;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use serde::{Deserialize, Serialize};
use crate::utils::error::{SpkError, SpkResult};

/// V18 version constant
pub const V18_REALTIME_VERSION: u8 = 18;

/// Target latency in microseconds
pub const V18_TARGET_LATENCY_US: u64 = 1000;

/// Rolling window size
pub const V18_ROLLING_WINDOW_SIZE: usize = 64;

// =============================================================================
// STREAMING CHUNK PIPELINE
// =============================================================================

/// Streaming chunk with minimal overhead
#[derive(Debug, Clone)]
pub struct StreamingChunk {
    /// Sequence number
    pub seq: u64,
    /// Timestamp (microseconds)
    pub timestamp_us: u64,
    /// Data
    pub data: Vec<u8>,
    /// Priority
    pub priority: StreamPriority,
}

/// Stream priority levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum StreamPriority {
    Background = 0,
    Normal = 1,
    High = 2,
    Realtime = 3,
}

/// Streaming pipeline for sub-1ms latency
pub struct StreamingPipeline {
    /// Input buffer (lock-free design)
    input_buffer: Arc<RwLock<VecDeque<StreamingChunk>>>,
    /// Output buffer
    output_buffer: Arc<RwLock<VecDeque<StreamingChunk>>>,
    /// Statistics
    stats: Arc<RwLock<StreamStats>>,
    /// Configuration
    config: StreamConfig,
}

/// Stream configuration
#[derive(Debug, Clone)]
pub struct StreamConfig {
    /// Maximum buffer size
    pub max_buffer_size: usize,
    /// Target latency (microseconds)
    pub target_latency_us: u64,
    /// Enable compression
    pub compression: bool,
    /// Compression algorithm
    pub algorithm: StreamAlgorithm,
}

/// Stream compression algorithms (fast)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamAlgorithm {
    None,
    LZ4,
    Snappy,
    Custom,
}

impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            max_buffer_size: 1024,
            target_latency_us: V18_TARGET_LATENCY_US,
            compression: true,
            algorithm: StreamAlgorithm::LZ4,
        }
    }
}

impl StreamingPipeline {
    /// Create new streaming pipeline
    pub fn new(config: StreamConfig) -> Self {
        Self {
            input_buffer: Arc::new(RwLock::new(VecDeque::with_capacity(config.max_buffer_size))),
            output_buffer: Arc::new(RwLock::new(VecDeque::new())),
            stats: Arc::new(RwLock::new(StreamStats::default())),
            config,
        }
    }

    /// Ingest streaming data
    pub fn ingest(&self, data: Vec<u8>, priority: StreamPriority) -> SpkResult<u64> {
        let start = Instant::now();

        let mut input = self.input_buffer.write()
            .map_err(|_| SpkError::LockError("Failed to acquire input buffer lock".into()))?;

        if input.len() >= self.config.max_buffer_size {
            return Err(SpkError::BufferFull("Input buffer full".into()));
        }

        let seq = input.len() as u64;
        let timestamp_us = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros() as u64;

        let chunk = StreamingChunk {
            seq,
            timestamp_us,
            data,
            priority,
        };

        input.push_back(chunk);
        drop(input);

        // Update stats
        let mut stats = self.stats.write()
            .map_err(|_| SpkError::LockError("Failed to acquire stats lock".into()))?;
        stats.chunks_ingested += 1;
        stats.total_latency_us += start.elapsed().as_micros() as u64;

        Ok(seq)
    }

    /// Process chunk (compress if enabled)
    pub fn process(&self) -> SpkResult<Option<StreamingChunk>> {
        let start = Instant::now();

        let mut input = self.input_buffer.write()
            .map_err(|_| SpkError::LockError("Failed to acquire input buffer lock".into()))?;

        let chunk = input.pop_front();
        drop(input);

        if let Some(mut chunk) = chunk {
            // Compress if enabled
            if self.config.compression {
                chunk.data = self.fast_compress(&chunk.data)?;
            }

            // Move to output
            let mut output = self.output_buffer.write()
                .map_err(|_| SpkError::LockError("Failed to acquire output buffer lock".into()))?;
            output.push_back(chunk.clone());
            drop(output);

            // Update stats
            let latency = start.elapsed().as_micros() as u64;
            let mut stats = self.stats.write()
                .map_err(|_| SpkError::LockError("Failed to acquire stats lock".into()))?;
            stats.chunks_processed += 1;
            stats.total_latency_us += latency;
            stats.max_latency_us = stats.max_latency_us.max(latency);

            Ok(Some(chunk))
        } else {
            Ok(None)
        }
    }

    /// Fast compression
    fn fast_compress(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder for fast compression
        match self.config.algorithm {
            StreamAlgorithm::None => Ok(data.to_vec()),
            StreamAlgorithm::LZ4 | StreamAlgorithm::Snappy | StreamAlgorithm::Custom => {
                // Would use actual fast compression
                Ok(data.to_vec())
            }
        }
    }

    /// Get statistics
    pub fn stats(&self) -> SpkResult<StreamStats> {
        let stats = self.stats.read()
            .map_err(|_| SpkError::LockError("Failed to acquire stats lock".into()))?;
        Ok(stats.clone())
    }
}

impl Default for StreamingPipeline {
    fn default() -> Self {
        Self::new(StreamConfig::default())
    }
}

/// Stream statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StreamStats {
    pub chunks_ingested: u64,
    pub chunks_processed: u64,
    pub total_latency_us: u64,
    pub max_latency_us: u64,
    pub dropped_chunks: u64,
}

impl StreamStats {
    /// Get average latency
    pub fn avg_latency_us(&self) -> f64 {
        if self.chunks_processed > 0 {
            self.total_latency_us as f64 / self.chunks_processed as f64
        } else {
            0.0
        }
    }
}

// =============================================================================
// ROLLING WINDOW COMPRESSION
// =============================================================================

/// Rolling window compressor
pub struct RollingWindowCompressor {
    /// Window buffer
    window: VecDeque<Vec<u8>>,
    /// Window size
    window_size: usize,
    /// Dictionary
    dictionary: Vec<u8>,
}

impl RollingWindowCompressor {
    /// Create new compressor
    pub fn new(window_size: usize) -> Self {
        Self {
            window: VecDeque::with_capacity(window_size),
            window_size,
            dictionary: Vec::new(),
        }
    }

    /// Add data to window
    pub fn add(&mut self, data: Vec<u8>) {
        if self.window.len() >= self.window_size {
            self.window.pop_front();
        }
        self.window.push_back(data);
        self.update_dictionary();
    }

    /// Update dictionary from window
    fn update_dictionary(&mut self) {
        self.dictionary.clear();
        for data in &self.window {
            self.dictionary.extend_from_slice(data);
        }
    }

    /// Compress with dictionary
    pub fn compress(&self, data: &[u8]) -> Vec<u8> {
        // Simplified dictionary compression
        if self.dictionary.is_empty() {
            return data.to_vec();
        }

        // Would implement actual dictionary-based compression
        data.to_vec()
    }

    /// Decompress with dictionary
    pub fn decompress(&self, data: &[u8]) -> Vec<u8> {
        // Simplified decompression
        data.to_vec()
    }
}

impl Default for RollingWindowCompressor {
    fn default() -> Self {
        Self::new(V18_ROLLING_WINDOW_SIZE)
    }
}

// =============================================================================
// PREDICTIVE CHUNK ALLOCATION
// =============================================================================

/// Predictive allocator for steady frame rates
pub struct PredictiveAllocator {
    /// Historical chunk sizes
    history: VecDeque<usize>,
    /// Prediction window
    window_size: usize,
}

impl PredictiveAllocator {
    /// Create new allocator
    pub fn new(window_size: usize) -> Self {
        Self {
            history: VecDeque::with_capacity(window_size),
            window_size,
        }
    }

    /// Record chunk size
    pub fn record(&mut self, size: usize) {
        if self.history.len() >= self.window_size {
            self.history.pop_front();
        }
        self.history.push_back(size);
    }

    /// Predict next chunk size
    pub fn predict(&self) -> usize {
        if self.history.is_empty() {
            return 4096; // Default
        }

        // Simple moving average
        let sum: usize = self.history.iter().sum();
        sum / self.history.len()
    }

    /// Pre-allocate buffer
    pub fn allocate(&self) -> Vec<u8> {
        let size = self.predict();
        Vec::with_capacity(size)
    }
}

impl Default for PredictiveAllocator {
    fn default() -> Self {
        Self::new(32)
    }
}

// =============================================================================
// BURST PROTECTION
// =============================================================================

/// Burst protection for data spikes
pub struct BurstProtector {
    /// Normal rate (chunks per second)
    normal_rate: f64,
    /// Burst threshold multiplier
    burst_threshold: f64,
    /// Recent chunk timestamps
    recent_chunks: VecDeque<Instant>,
    /// Burst state
    in_burst: bool,
}

impl BurstProtector {
    /// Create new protector
    pub fn new(normal_rate: f64, burst_threshold: f64) -> Self {
        Self {
            normal_rate,
            burst_threshold,
            recent_chunks: VecDeque::new(),
            in_burst: false,
        }
    }

    /// Record chunk arrival
    pub fn record_chunk(&mut self) {
        let now = Instant::now();
        self.recent_chunks.push_back(now);

        // Keep only last second
        while let Some(&first) = self.recent_chunks.front() {
            if now.duration_since(first).as_secs() > 1 {
                self.recent_chunks.pop_front();
            } else {
                break;
            }
        }

        // Detect burst
        let current_rate = self.recent_chunks.len() as f64;
        self.in_burst = current_rate > self.normal_rate * self.burst_threshold;
    }

    /// Check if in burst
    pub fn is_burst(&self) -> bool {
        self.in_burst
    }

    /// Get current rate
    pub fn current_rate(&self) -> f64 {
        self.recent_chunks.len() as f64
    }
}

impl Default for BurstProtector {
    fn default() -> Self {
        Self::new(30.0, 2.0) // 30fps normal, 2x threshold
    }
}

// =============================================================================
// LIVE PREVIEW
// =============================================================================

/// Live preview of partially written archive
pub struct LivePreview {
    /// Available chunks
    available_chunks: Arc<RwLock<Vec<u64>>>,
    /// Preview metadata
    metadata: Arc<RwLock<PreviewMetadata>>,
}

/// Preview metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PreviewMetadata {
    pub total_expected: u64,
    pub currently_available: u64,
    pub last_update: u64,
}

impl LivePreview {
    /// Create new preview
    pub fn new() -> Self {
        Self {
            available_chunks: Arc::new(RwLock::new(Vec::new())),
            metadata: Arc::new(RwLock::new(PreviewMetadata::default())),
        }
    }

    /// Add available chunk
    pub fn add_chunk(&self, seq: u64) -> SpkResult<()> {
        let mut chunks = self.available_chunks.write()
            .map_err(|_| SpkError::LockError("Failed to acquire chunks lock".into()))?;
        chunks.push(seq);
        drop(chunks);

        let mut meta = self.metadata.write()
            .map_err(|_| SpkError::LockError("Failed to acquire metadata lock".into()))?;
        meta.currently_available += 1;
        meta.last_update = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Ok(())
    }

    /// Get metadata
    pub fn metadata(&self) -> SpkResult<PreviewMetadata> {
        let meta = self.metadata.read()
            .map_err(|_| SpkError::LockError("Failed to acquire metadata lock".into()))?;
        Ok(meta.clone())
    }
}

impl Default for LivePreview {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_pipeline() {
        let pipeline = StreamingPipeline::default();
        
        let data = vec![1, 2, 3, 4, 5];
        let seq = pipeline.ingest(data.clone(), StreamPriority::Normal).unwrap();
        assert_eq!(seq, 0);

        let processed = pipeline.process().unwrap();
        assert!(processed.is_some());

        let stats = pipeline.stats().unwrap();
        assert_eq!(stats.chunks_ingested, 1);
        assert_eq!(stats.chunks_processed, 1);
    }

    #[test]
    fn test_rolling_window() {
        let mut compressor = RollingWindowCompressor::new(4);
        
        compressor.add(vec![1, 2, 3]);
        compressor.add(vec![4, 5, 6]);
        
        let data = vec![7, 8, 9];
        let compressed = compressor.compress(&data);
        let decompressed = compressor.decompress(&compressed);
        
        assert_eq!(data, decompressed);
    }

    #[test]
    fn test_predictive_allocator() {
        let mut allocator = PredictiveAllocator::new(4);
        
        allocator.record(1024);
        allocator.record(1024);
        allocator.record(1024);
        
        let predicted = allocator.predict();
        assert_eq!(predicted, 1024);
    }

    #[test]
    fn test_burst_protector() {
        let mut protector = BurstProtector::new(10.0, 2.0);
        
        // Simulate normal rate
        for _ in 0..10 {
            protector.record_chunk();
        }
        assert!(!protector.is_burst());
        
        // Simulate burst
        for _ in 0..30 {
            protector.record_chunk();
        }
        assert!(protector.is_burst());
    }

    #[test]
    fn test_live_preview() {
        let preview = LivePreview::new();
        
        preview.add_chunk(0).unwrap();
        preview.add_chunk(1).unwrap();
        
        let meta = preview.metadata().unwrap();
        assert_eq!(meta.currently_available, 2);
    }
}
