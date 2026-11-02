//! # SPK V17: Simulation-Aware + Scientific Data Modes
//!
//! Optimized for HPC, simulation outputs, and scientific datasets.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::utils::error::{SpkError, SpkResult};

/// V17 version constant
pub const V17_SCIENTIFIC_VERSION: u8 = 17;

// =============================================================================
// MULTI-DIMENSIONAL METADATA
// =============================================================================

/// Multi-dimensional chunk metadata (x,y,z,t)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiDimMetadata {
    /// Spatial dimensions (x, y, z)
    pub spatial: [usize; 3],
    /// Temporal dimension
    pub temporal: usize,
    /// Field name
    pub field: String,
    /// Data type
    pub data_type: ScientificDataType,
    /// Units
    pub units: String,
    /// Grid info
    pub grid_info: Option<GridInfo>,
}

/// Scientific data types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScientificDataType {
    Float32,
    Float64,
    Int32,
    Int64,
    Complex64,
    Complex128,
}

/// Grid information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridInfo {
    pub grid_type: GridType,
    pub dimensions: Vec<usize>,
    pub spacing: Vec<f64>,
    pub origin: Vec<f64>,
}

/// Grid types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GridType {
    Uniform,
    Rectilinear,
    Structured,
    Unstructured,
}

// =============================================================================
// SCIENTIFIC DELTA COMPRESSION
// =============================================================================

/// Scientific delta compressor
pub struct ScientificDelta {
    /// Previous timestep data
    previous: Option<Vec<f64>>,
    /// Tolerance for lossy compression
    tolerance: f64,
}

impl ScientificDelta {
    /// Create new delta compressor
    pub fn new(tolerance: f64) -> Self {
        Self {
            previous: None,
            tolerance,
        }
    }

    /// Compress current timestep against previous
    pub fn compress(&mut self, current: &[f64]) -> SpkResult<DeltaCompressed> {
        if let Some(prev) = &self.previous {
            if prev.len() != current.len() {
                return Err(SpkError::InvalidData("Dimension mismatch".into()));
            }

            let mut deltas = Vec::new();
            let mut significant_indices = Vec::new();
            let base_value = prev[0]; // Extract before reassigning self.previous

            for (i, (&cur, &prv)) in current.iter().zip(prev.iter()).enumerate() {
                let delta = cur - prv;
                if delta.abs() > self.tolerance {
                    deltas.push(delta);
                    significant_indices.push(i);
                }
            }

            self.previous = Some(current.to_vec());

            Ok(DeltaCompressed {
                deltas,
                indices: significant_indices,
                full_size: current.len(),
                base_value,
            })
        } else {
            // First timestep - store full
            self.previous = Some(current.to_vec());
            Ok(DeltaCompressed {
                deltas: current.to_vec(),
                indices: (0..current.len()).collect(),
                full_size: current.len(),
                base_value: 0.0,
            })
        }
    }

    /// Decompress delta data
    pub fn decompress(&self, compressed: &DeltaCompressed) -> SpkResult<Vec<f64>> {
        if let Some(prev) = &self.previous {
            let mut result = prev.clone();
            
            for (&idx, &delta) in compressed.indices.iter().zip(compressed.deltas.iter()) {
                if idx < result.len() {
                    result[idx] += delta;
                }
            }

            Ok(result)
        } else {
            // First timestep
            let mut result = vec![compressed.base_value; compressed.full_size];
            for (&idx, &val) in compressed.indices.iter().zip(compressed.deltas.iter()) {
                if idx < result.len() {
                    result[idx] = val;
                }
            }
            Ok(result)
        }
    }
}

/// Delta-compressed data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaCompressed {
    pub deltas: Vec<f64>,
    pub indices: Vec<usize>,
    pub full_size: usize,
    pub base_value: f64,
}

// =============================================================================
// HPC NODE AWARENESS
// =============================================================================

/// HPC cluster node information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HpcNode {
    pub node_id: u32,
    pub rank: u32,
    pub total_ranks: u32,
    pub local_chunk_ids: Vec<usize>,
}

/// HPC-aware chunk distribution
pub struct HpcDistributor {
    nodes: HashMap<u32, HpcNode>,
    chunk_assignment: HashMap<usize, u32>,
}

impl HpcDistributor {
    /// Create new distributor
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            chunk_assignment: HashMap::new(),
        }
    }

    /// Register HPC node
    pub fn register_node(&mut self, node: HpcNode) {
        self.nodes.insert(node.node_id, node);
    }

    /// Assign chunk to node
    pub fn assign_chunk(&mut self, chunk_id: usize, node_id: u32) -> SpkResult<()> {
        if !self.nodes.contains_key(&node_id) {
            return Err(SpkError::NodeError(format!("Node {} not found", node_id)));
        }

        self.chunk_assignment.insert(chunk_id, node_id);

        if let Some(node) = self.nodes.get_mut(&node_id) {
            node.local_chunk_ids.push(chunk_id);
        }

        Ok(())
    }

    /// Get node for chunk
    pub fn get_node(&self, chunk_id: usize) -> Option<u32> {
        self.chunk_assignment.get(&chunk_id).copied()
    }
}

impl Default for HpcDistributor {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// LOSSLESS FLOAT RECONSTRUCTION
// =============================================================================

/// Lossless floating-point compressor
pub struct LosslessFloatCompressor;

impl LosslessFloatCompressor {
    /// Compress float64 array losslessly
    pub fn compress(data: &[f64]) -> Vec<u8> {
        // Convert to bytes
        let mut bytes = Vec::with_capacity(data.len() * 8);
        for &val in data {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        
        // Apply XOR prediction
        Self::xor_prediction(&bytes)
    }

    /// Decompress to float64 array
    pub fn decompress(compressed: &[u8]) -> SpkResult<Vec<f64>> {
        // Reverse XOR prediction
        let bytes = Self::xor_unprediction(compressed);
        
        // Convert back to floats
        let mut result = Vec::with_capacity(bytes.len() / 8);
        for chunk in bytes.chunks_exact(8) {
            let arr: [u8; 8] = chunk.try_into()
                .map_err(|_| SpkError::InvalidData("Invalid float data".into()))?;
            result.push(f64::from_le_bytes(arr));
        }
        
        Ok(result)
    }

    /// XOR prediction for better compression
    fn xor_prediction(data: &[u8]) -> Vec<u8> {
        if data.is_empty() {
            return Vec::new();
        }

        let mut result = Vec::with_capacity(data.len());
        result.push(data[0]);

        for i in 1..data.len() {
            result.push(data[i] ^ data[i - 1]);
        }

        result
    }

    /// Reverse XOR prediction
    fn xor_unprediction(data: &[u8]) -> Vec<u8> {
        if data.is_empty() {
            return Vec::new();
        }

        let mut result = Vec::with_capacity(data.len());
        result.push(data[0]);

        for i in 1..data.len() {
            result.push(data[i] ^ result[i - 1]);
        }

        result
    }
}

// =============================================================================
// TIMESERIES COMPRESSION
// =============================================================================

/// Ultra-fast timeseries compressor
pub struct TimeseriesCompressor {
    window_size: usize,
}

impl TimeseriesCompressor {
    /// Create new compressor
    pub fn new(window_size: usize) -> Self {
        Self { window_size }
    }

    /// Compress timeseries data
    pub fn compress(&self, data: &[f64]) -> TimeseriesCompressed {
        let mut compressed = Vec::new();
        let mut metadata = Vec::new();

        for window in data.chunks(self.window_size) {
            let min = window.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = window.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let range = max - min;

            metadata.push(WindowMetadata { min, max, range });

            // Quantize to 16-bit
            for &val in window {
                let normalized = if range > 0.0 {
                    ((val - min) / range * 65535.0) as u16
                } else {
                    0u16
                };
                compressed.push(normalized);
            }
        }

        TimeseriesCompressed {
            data: compressed,
            metadata,
            window_size: self.window_size,
        }
    }

    /// Decompress timeseries data
    pub fn decompress(&self, compressed: &TimeseriesCompressed) -> Vec<f64> {
        let mut result = Vec::new();

        for (window_data, meta) in compressed.data.chunks(self.window_size).zip(compressed.metadata.iter()) {
            for &val in window_data {
                let normalized = val as f64 / 65535.0;
                let original = meta.min + normalized * meta.range;
                result.push(original);
            }
        }

        result
    }
}

/// Compressed timeseries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeseriesCompressed {
    data: Vec<u16>,
    metadata: Vec<WindowMetadata>,
    window_size: usize,
}

/// Window metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowMetadata {
    min: f64,
    max: f64,
    range: f64,
}

// =============================================================================
// SCIENTIFIC DATA MANAGER
// =============================================================================

/// Manager for scientific data compression
pub struct ScientificDataManager {
    delta_compressor: ScientificDelta,
    hpc_distributor: HpcDistributor,
}

impl ScientificDataManager {
    /// Create new manager
    pub fn new(tolerance: f64) -> Self {
        Self {
            delta_compressor: ScientificDelta::new(tolerance),
            hpc_distributor: HpcDistributor::new(),
        }
    }

    /// Compress simulation timestep
    pub fn compress_timestep(&mut self, data: &[f64]) -> SpkResult<DeltaCompressed> {
        self.delta_compressor.compress(data)
    }

    /// Decompress timestep
    pub fn decompress_timestep(&self, compressed: &DeltaCompressed) -> SpkResult<Vec<f64>> {
        self.delta_compressor.decompress(compressed)
    }

    /// Get HPC distributor
    pub fn hpc_distributor_mut(&mut self) -> &mut HpcDistributor {
        &mut self.hpc_distributor
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scientific_delta() {
        let mut compressor = ScientificDelta::new(0.01);
        
        let data1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let compressed1 = compressor.compress(&data1).unwrap();
        assert_eq!(compressed1.deltas.len(), data1.len());

        let data2 = vec![1.01, 2.01, 3.01, 4.01, 5.01];
        let compressed2 = compressor.compress(&data2).unwrap();
        assert!(compressed2.deltas.len() <= data2.len());
    }

    #[test]
    fn test_lossless_float() {
        let data = vec![1.234567, 2.345678, 3.456789];
        let compressed = LosslessFloatCompressor::compress(&data);
        let decompressed = LosslessFloatCompressor::decompress(&compressed).unwrap();
        
        assert_eq!(data, decompressed);
    }

    #[test]
    fn test_timeseries() {
        let compressor = TimeseriesCompressor::new(4);
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        
        let compressed = compressor.compress(&data);
        let decompressed = compressor.decompress(&compressed);
        
        assert_eq!(data.len(), decompressed.len());
        for (a, b) in data.iter().zip(decompressed.iter()) {
            assert!((a - b).abs() < 0.01);
        }
    }

    #[test]
    fn test_hpc_distributor() {
        let mut distributor = HpcDistributor::new();
        
        let node = HpcNode {
            node_id: 0,
            rank: 0,
            total_ranks: 4,
            local_chunk_ids: vec![],
        };
        
        distributor.register_node(node);
        distributor.assign_chunk(0, 0).unwrap();
        
        assert_eq!(distributor.get_node(0), Some(0));
    }
}
