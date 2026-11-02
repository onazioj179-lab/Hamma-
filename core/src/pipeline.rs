//! SPK V4 Compression Pipeline
//!
//! Parallel compression pipeline with multiple stages.


use rayon::prelude::*;

use crate::chunk::ChunkEntry;
use crate::codec::{compress, decompress, Codec, CompressionLevel, SmartCodecSelector};
use crate::types::chunk_structs::{ChunkBatch, ChunkState, PendingChunk};
use crate::utils::chunker::RawChunk;
use crate::utils::error::{SpkError, SpkResult};
use crate::utils::hashing::sha256_hash;

/// Pipeline configuration
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Number of worker threads
    pub workers: usize,
    /// Batch size for processing
    pub batch_size: usize,
    /// Enable smart codec selection
    pub smart_codec: bool,
    /// Default codec
    pub default_codec: Codec,
    /// Compression level
    pub level: CompressionLevel,
    /// Enable parallel compression
    pub parallel: bool,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            workers: num_cpus::get().max(2),
            batch_size: 16,
            smart_codec: false,
            default_codec: Codec::Zstd,
            level: CompressionLevel::Normal,
            parallel: true,
        }
    }
}

impl PipelineConfig {
    /// High-speed config (prioritize speed)
    pub fn fast() -> Self {
        Self {
            workers: num_cpus::get(),
            batch_size: 32,
            smart_codec: false,
            default_codec: Codec::Lz4,
            level: CompressionLevel::Fast,
            parallel: true,
        }
    }

    /// High-ratio config (prioritize compression)
    pub fn best() -> Self {
        Self {
            workers: num_cpus::get().max(2),
            batch_size: 8,
            smart_codec: true,
            default_codec: Codec::Zstd,
            level: CompressionLevel::Best,
            parallel: true,
        }
    }
}

/// Compression pipeline
pub struct CompressionPipeline {
    config: PipelineConfig,
    codec_selector: SmartCodecSelector,
}

impl CompressionPipeline {
    /// Create a new compression pipeline
    pub fn new(config: PipelineConfig) -> Self {
        Self {
            config,
            codec_selector: SmartCodecSelector::default(),
        }
    }

    /// Compress a batch of chunks in parallel
    pub fn compress_batch(&self, batch: &mut ChunkBatch) -> SpkResult<Vec<CompressedChunk>> {
        if !self.config.parallel || batch.chunks.len() <= 1 {
            // Serial processing
            return batch.chunks.iter_mut()
                .map(|chunk| self.compress_single(chunk))
                .collect();
        }

        // Parallel processing with rayon
        let results: Vec<SpkResult<CompressedChunk>> = batch.chunks
            .par_iter_mut()
            .map(|chunk| self.compress_single(chunk))
            .collect();

        results.into_iter().collect()
    }

    /// Compress a single chunk
    fn compress_single(&self, chunk: &mut PendingChunk) -> SpkResult<CompressedChunk> {
        chunk.state = ChunkState::Compressing;

        // Select codec
        let codec = if self.config.smart_codec {
            let selection = self.codec_selector.select(&chunk.data, None);
            selection.codec
        } else {
            self.config.default_codec
        };

        // Compress
        let compressed = compress(&chunk.data, codec, self.config.level)?;

        // Use original if compression didn't help
        let (final_data, final_codec) = if compressed.len() < chunk.data.len() {
            (compressed, codec)
        } else {
            (chunk.data.clone(), Codec::None)
        };

        chunk.compressed_data = Some(final_data.clone());
        chunk.codec = Some(final_codec);
        chunk.state = ChunkState::Compressed;

        Ok(CompressedChunk {
            index: chunk.index,
            uncompressed_size: chunk.data.len() as u32,
            compressed_size: final_data.len() as u32,
            codec: final_codec,
            hash: chunk.hash,
            data: final_data,
        })
    }

    /// Compress raw chunks in parallel
    pub fn compress_chunks(&self, chunks: Vec<RawChunk>) -> SpkResult<Vec<CompressedChunk>> {
        if !self.config.parallel || chunks.len() <= 1 {
            return chunks.into_iter()
                .map(|chunk| self.compress_raw(chunk))
                .collect();
        }

        let results: Vec<SpkResult<CompressedChunk>> = chunks
            .into_par_iter()
            .map(|chunk| self.compress_raw(chunk))
            .collect();

        results.into_iter().collect()
    }

    /// Compress a raw chunk
    fn compress_raw(&self, chunk: RawChunk) -> SpkResult<CompressedChunk> {
        // Select codec
        let codec = if self.config.smart_codec {
            let selection = self.codec_selector.select(&chunk.data, None);
            selection.codec
        } else {
            self.config.default_codec
        };

        // Compress
        let compressed = compress(&chunk.data, codec, self.config.level)?;

        // Use original if compression didn't help
        let (final_data, final_codec) = if compressed.len() < chunk.data.len() {
            (compressed, codec)
        } else {
            (chunk.data.clone(), Codec::None)
        };

        Ok(CompressedChunk {
            index: chunk.index,
            uncompressed_size: chunk.data.len() as u32,
            compressed_size: final_data.len() as u32,
            codec: final_codec,
            hash: chunk.hash,
            data: final_data,
        })
    }
}

/// Result of compressing a chunk
#[derive(Debug, Clone)]
pub struct CompressedChunk {
    pub index: u64,
    pub uncompressed_size: u32,
    pub compressed_size: u32,
    pub codec: Codec,
    pub hash: [u8; 32],
    pub data: Vec<u8>,
}

impl CompressedChunk {
    /// Convert to chunk entry
    pub fn to_entry(&self, offset: u64) -> ChunkEntry {
        ChunkEntry::new(
            offset,
            self.compressed_size,
            self.uncompressed_size,
            self.codec,
            self.hash,
        )
    }

    /// Get compression ratio
    pub fn ratio(&self) -> f64 {
        if self.uncompressed_size == 0 {
            1.0
        } else {
            self.compressed_size as f64 / self.uncompressed_size as f64
        }
    }
}

/// Decompression pipeline
pub struct DecompressionPipeline {
    config: PipelineConfig,
}

impl DecompressionPipeline {
    /// Create a new decompression pipeline
    pub fn new(config: PipelineConfig) -> Self {
        Self { config }
    }

    /// Decompress a batch of compressed chunks in parallel
    pub fn decompress_batch(&self, chunks: &[(ChunkEntry, Vec<u8>)]) -> SpkResult<Vec<Vec<u8>>> {
        if !self.config.parallel || chunks.len() <= 1 {
            return chunks.iter()
                .map(|(entry, data)| self.decompress_single(entry, data))
                .collect();
        }

        let results: Vec<SpkResult<Vec<u8>>> = chunks
            .par_iter()
            .map(|(entry, data)| self.decompress_single(entry, data))
            .collect();

        results.into_iter().collect()
    }

    /// Decompress a single chunk
    fn decompress_single(&self, entry: &ChunkEntry, data: &[u8]) -> SpkResult<Vec<u8>> {
        let decompressed = decompress(data, entry.codec, Some(entry.uncompressed_size as usize))?;

        // Verify hash
        let hash = sha256_hash(&decompressed);
        if hash != entry.hash {
            return Err(SpkError::hash_mismatch(&entry.hash, &hash));
        }

        Ok(decompressed)
    }
}

/// Pipeline statistics
#[derive(Debug, Clone, Default)]
pub struct PipelineStats {
    pub chunks_processed: u64,
    pub bytes_input: u64,
    pub bytes_output: u64,
    pub processing_time_ms: u64,
    pub codec_usage: std::collections::HashMap<Codec, u64>,
}

impl PipelineStats {
    pub fn ratio(&self) -> f64 {
        if self.bytes_input == 0 {
            1.0
        } else {
            self.bytes_output as f64 / self.bytes_input as f64
        }
    }

    pub fn throughput_mbps(&self) -> f64 {
        if self.processing_time_ms == 0 {
            0.0
        } else {
            (self.bytes_input as f64 / 1_000_000.0) / (self.processing_time_ms as f64 / 1000.0)
        }
    }
}

/// GPU acceleration stub (placeholder for V4)
pub mod gpu {
    use super::*;

    /// Check if GPU acceleration is available
    pub fn is_available() -> bool {
        // Would check for CUDA/OpenCL/Metal support
        false
    }

    /// Get GPU info
    pub fn gpu_info() -> Option<GpuInfo> {
        None
    }

    /// GPU information
    #[derive(Debug, Clone)]
    pub struct GpuInfo {
        pub name: String,
        pub memory_mb: u64,
        pub compute_units: u32,
    }

    /// GPU-accelerated compression (stub)
    pub fn compress_gpu(_data: &[u8], _codec: Codec) -> SpkResult<Vec<u8>> {
        Err(SpkError::GpuError("GPU acceleration not available".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compression_pipeline() {
        let pipeline = CompressionPipeline::new(PipelineConfig::default());
        
        let chunks: Vec<RawChunk> = (0..4)
            .map(|i| RawChunk::new(i, vec![i as u8; 10000], 0))
            .collect();
        
        let compressed = pipeline.compress_chunks(chunks).unwrap();
        
        assert_eq!(compressed.len(), 4);
        for chunk in &compressed {
            assert!(chunk.compressed_size <= chunk.uncompressed_size as u32);
        }
    }

    #[test]
    fn test_decompression_pipeline() {
        let comp_pipeline = CompressionPipeline::new(PipelineConfig::default());
        let decomp_pipeline = DecompressionPipeline::new(PipelineConfig::default());
        
        // Create and compress
        let original = vec![42u8; 10000];
        let raw_chunk = RawChunk::new(0, original.clone(), 0);
        let compressed = comp_pipeline.compress_raw(raw_chunk).unwrap();
        
        // Create entry and decompress
        let entry = compressed.to_entry(0);
        let decompressed = decomp_pipeline.decompress_single(&entry, &compressed.data).unwrap();
        
        assert_eq!(original, decompressed);
    }

    #[test]
    fn test_pipeline_stats() {
        let mut stats = PipelineStats {
            chunks_processed: 100,
            bytes_input: 1_000_000,
            bytes_output: 500_000,
            processing_time_ms: 1000,
            ..Default::default()
        };
        
        assert!((stats.ratio() - 0.5).abs() < 0.001);
        assert!((stats.throughput_mbps() - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_smart_codec_selection() {
        let pipeline = CompressionPipeline::new(PipelineConfig {
            smart_codec: true,
            ..Default::default()
        });
        
        // Text data
        let text_data: Vec<u8> = b"Hello World! ".repeat(1000).to_vec();
        let raw_chunk = RawChunk::new(0, text_data, 0);
        let compressed = pipeline.compress_raw(raw_chunk).unwrap();
        
        // Should compress well
        assert!(compressed.ratio() < 0.5);
    }
}
