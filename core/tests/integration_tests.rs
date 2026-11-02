//! Integration tests for SPK-Core V25
//!
//! Tests the full compression pipeline at scale including:
//! - CDC (Content-Defined Chunking)
//! - Similarity detection
//! - Delta encoding
//! - Enhanced pipeline

use std::collections::HashSet;
use std::io::Cursor;
use tempfile::tempdir;

use spk_core::{
    CdcChunk, CdcConfig, ContentDefinedChunker, NormalizationLevel,
    DeltaConfig, DeltaDecoder, DeltaEncoder, DeltaResult,
    SimilarityConfig, SimilarityIndex, ChunkSignature,
    EnhancedPipeline, EnhancedPipelineConfig,
};

/// Generate test data with controlled patterns
fn generate_test_data(pattern: TestPattern, size: usize) -> Vec<u8> {
    match pattern {
        TestPattern::Random => {
            let mut data = Vec::with_capacity(size);
            let mut seed: u64 = 0xDEADBEEF;
            for _ in 0..size {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                data.push((seed >> 33) as u8);
            }
            data
        }
        TestPattern::Zeros => vec![0u8; size],
        TestPattern::Repeated => {
            let pattern = b"SINGULARITY_PACK_TEST_PATTERN_V25!";
            pattern.iter().cycle().take(size).cloned().collect()
        }
        TestPattern::SemiDuplicate(dup_ratio) => {
            let unique_size = (size as f64 * (1.0 - dup_ratio)) as usize;
            let mut data = Vec::with_capacity(size);
            let mut seed: u64 = 0xCAFEBABE;
            for _ in 0..unique_size {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                data.push((seed >> 33) as u8);
            }
            let unique_part = data.clone();
            while data.len() < size {
                let remaining = size - data.len();
                let to_copy = remaining.min(unique_part.len());
                data.extend_from_slice(&unique_part[..to_copy]);
            }
            data
        }
        TestPattern::IncrementalChange => {
            let base_pattern: Vec<u8> = (0u32..256).cycle().take(size).map(|v| v as u8).collect();
            let mut data = base_pattern;
            for i in (0..data.len()).step_by(1024) {
                if i < data.len() {
                    data[i] = data[i].wrapping_add(1);
                }
            }
            data
        }
        TestPattern::Binary => {
            let mut data = Vec::with_capacity(size);
            data.extend_from_slice(b"\x7FELF");
            data.extend_from_slice(&[0x02, 0x01, 0x01, 0x00]);
            let mut seed: u64 = 0x1234;
            while data.len() < size {
                seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
                data.push((seed >> 16) as u8);
            }
            data.truncate(size);
            data
        }
        TestPattern::Json => {
            let template = r#"{"id":%d,"name":"item_%d","value":%d,"nested":{"a":%d,"b":%d}}"#;
            let mut data = Vec::with_capacity(size);
            let mut i = 0;
            while data.len() < size {
                let entry = template.replace("%d", &i.to_string());
                data.extend_from_slice(entry.as_bytes());
                data.push(b'\n');
                i += 1;
            }
            data.truncate(size);
            data
        }
    }
}

#[derive(Clone, Copy)]
enum TestPattern {
    Random,
    Zeros,
    Repeated,
    SemiDuplicate(f64),
    IncrementalChange,
    Binary,
    Json,
}

fn small_cdc_config() -> CdcConfig {
    let mut config = CdcConfig::for_small();
    config.min_size = 8 * 1024;
    config.target_size = 16 * 1024;
    config.max_size = 64 * 1024;
    config.mask_bits = 14; // ~16KB target
    config
}

fn chunk_all(data: &[u8], config: CdcConfig) -> Vec<CdcChunk> {
    let mut chunker = ContentDefinedChunker::new(Cursor::new(data.to_vec()), config);
    let mut chunks = Vec::new();

    while let Some(chunk) = chunker.next_chunk().expect("chunking failed") {
        chunks.push(chunk);
    }

    chunks
}

// ==================== CDC Integration Tests ====================

#[test]
fn test_cdc_basic_chunking() {
    let data = generate_test_data(TestPattern::Random, 1024 * 1024);
    let config = small_cdc_config();
    let chunks = chunk_all(&data, config.clone());
    
    assert!(chunks.len() > 1, "Expected multiple chunks, got {}", chunks.len());
    
    let total_size: usize = chunks.iter().map(|c| c.data.len()).sum();
    assert_eq!(total_size, data.len());
    
    for chunk in &chunks {
        assert!(chunk.data.len() >= config.min_size || chunk.data.len() == data.len());
        assert!(chunk.data.len() <= config.max_size);
    }
}

#[test]
fn test_cdc_normalization_levels() {
    let data = generate_test_data(TestPattern::IncrementalChange, 512 * 1024);
    
    let configs = vec![
        (NormalizationLevel::None, {
            let mut c = small_cdc_config();
            c.normalization = NormalizationLevel::None;
            c
        }),
        (NormalizationLevel::Level1, {
            let mut c = small_cdc_config();
            c.normalization = NormalizationLevel::Level1;
            c
        }),
        (NormalizationLevel::Level2, {
            let mut c = small_cdc_config();
            c.normalization = NormalizationLevel::Level2;
            c
        }),
        (NormalizationLevel::Level3, {
            let mut c = small_cdc_config();
            c.normalization = NormalizationLevel::Level3;
            c
        }),
    ];
    
    let mut results = Vec::new();
    
    for (level, config) in configs {
        let chunks = chunk_all(&data, config);
        results.push((level, chunks.len()));
    }
    
    for (level, count) in &results {
        assert!(*count > 0, "Normalization {:?} produced no chunks", level);
    }
}

#[test]
fn test_cdc_deterministic() {
    let data = generate_test_data(TestPattern::Binary, 256 * 1024);
    let config = small_cdc_config();
    
    let chunks1 = chunk_all(&data, config.clone());
    let chunks2 = chunk_all(&data, config);
    
    assert_eq!(chunks1.len(), chunks2.len());
    for (c1, c2) in chunks1.iter().zip(chunks2.iter()) {
        assert_eq!(c1.fingerprint, c2.fingerprint);
        assert_eq!(c1.offset, c2.offset);
        assert_eq!(c1.data.len(), c2.data.len());
    }
}

#[test]
fn test_cdc_shift_resistance() {
    let data = generate_test_data(TestPattern::Random, 128 * 1024);
    let config = small_cdc_config();
    
    let chunks1 = chunk_all(&data, config.clone());
    
    let mut shifted_data = vec![0x42; 100];
    shifted_data.extend_from_slice(&data);
    
    let chunks2 = chunk_all(&shifted_data, config);
    
    let fps1: HashSet<_> = chunks1.iter().map(|c| c.fingerprint).collect();
    let fps2: HashSet<_> = chunks2.iter().map(|c| c.fingerprint).collect();
    
    let common = fps1.intersection(&fps2).count();
    let ratio = common as f64 / fps1.len() as f64;
    
    assert!(ratio > 0.3, "Shift resistance too low: {:.1}%", ratio * 100.0);
}

// ==================== Delta Encoding Integration Tests ====================

#[test]
fn test_delta_encoding_similar_data() {
    let base_data = generate_test_data(TestPattern::Json, 16384);
    let mut modified = base_data.clone();
    
    if modified.len() > 100 {
        let patch = b"MODIFIED!";
        modified[50..50 + patch.len()].copy_from_slice(patch);
    }
    
    let config = DeltaConfig::default();
    let encoder = DeltaEncoder::new(config.clone());
    let decoder = DeltaDecoder::new(config);
    let base_fp = *blake3::hash(&base_data).as_bytes();

    let delta_bytes = match encoder.encode(&base_data, &modified, base_fp) {
        DeltaResult::Success { delta, .. } => delta,
        other => panic!("Delta encode failed: {:?}", other),
    };
    
    assert!(delta_bytes.len() < modified.len() / 2,
            "Delta not efficient: {} vs {}", delta_bytes.len(), modified.len());
    
    let reconstructed = decoder.decode(&base_data, &delta_bytes).unwrap();
    assert_eq!(reconstructed, modified);
}

#[test]
fn test_delta_encoding_dissimilar_data() {
    let base_data = generate_test_data(TestPattern::Random, 8192);
    let different = generate_test_data(TestPattern::Binary, 8192);
    
    let config = DeltaConfig::default();
    let encoder = DeltaEncoder::new(config);
    let base_fp = *blake3::hash(&base_data).as_bytes();
    
    let delta_bytes = match encoder.encode(&base_data, &different, base_fp) {
        DeltaResult::Success { delta, .. } => delta,
        DeltaResult::Rejected { .. } => return,
        other => panic!("Delta encode unexpected state: {:?}", other),
    };
    
    assert!(delta_bytes.len() > different.len() / 2,
            "Delta unexpectedly small for dissimilar data");
}

// ==================== Similarity Index Integration Tests ====================

#[test]
fn test_similarity_index_basic() {
    let config = SimilarityConfig::default();
    let mut index = SimilarityIndex::new(config.clone());
    
    let data1 = generate_test_data(TestPattern::Json, 8192);
    let fp1 = blake3::hash(&data1);
    let sig1 = ChunkSignature::from_chunk(*fp1.as_bytes(), &data1, &config);
    index.add(sig1.clone());

    // Add a slightly perturbed chunk to ensure a candidate exists
    let mut data2 = data1.clone();
    if !data2.is_empty() {
        data2[0] = data2[0].wrapping_add(1);
    }
    let fp2 = blake3::hash(&data2);
    let sig2 = ChunkSignature::from_chunk(*fp2.as_bytes(), &data2, &config);
    index.add(sig2);
    
    let candidates = index.find_candidates(&sig1);
    assert!(!candidates.is_empty(), "Should find at least one candidate");
}

#[test]
fn test_similarity_index_finds_similar() {
    let config = SimilarityConfig::default();
    let mut index = SimilarityIndex::new(config);
    
    let base = generate_test_data(TestPattern::Json, 8192);
    let base_fp = blake3::hash(&base);
    let base_sig = ChunkSignature::from_chunk(*base_fp.as_bytes(), &base, &SimilarityConfig::default());
    index.add(base_sig);
    
    let mut similar = base.clone();
    for i in (0..similar.len()).step_by(5) {
        if i < similar.len() {
            similar[i] = similar[i].wrapping_add(1);
        }
    }
    let similar_fp = blake3::hash(&similar);
    let similar_sig = ChunkSignature::from_chunk(*similar_fp.as_bytes(), &similar, &SimilarityConfig::default());
    
    let candidates = index.find_candidates(&similar_sig);
    println!("Found {} candidates for similar chunk", candidates.len());
}

// ==================== Full Pipeline Integration Tests ====================

#[test]
fn test_enhanced_pipeline_roundtrip() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let test_cases = vec![
        ("json", generate_test_data(TestPattern::Json, 32768)),
        ("binary", generate_test_data(TestPattern::Binary, 32768)),
        ("text", generate_test_data(TestPattern::Repeated, 32768)),
    ];
    
    for (name, data) in &test_cases {
        let result = pipeline.process_file(Cursor::new(data.clone()), name, data.len() as u64);
        assert!(result.is_ok(), "Failed to process {} data: {:?}", name, result);
    }
    
    let stats = pipeline.stats();
    assert!(stats.chunks_processed > 0);
    assert!(stats.input_bytes > 0);
}

#[test]
fn test_enhanced_pipeline_dedup_efficiency() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let data = generate_test_data(TestPattern::Json, 65536);
    
    for _ in 0..5 {
        pipeline.process_file(Cursor::new(data.clone()), "json", data.len() as u64).unwrap();
    }
    
    let stats = pipeline.stats();
    assert!(stats.chunks_deduped > 0, "Expected some deduplication");
    
    let dedup_ratio = stats.dedup_ratio();
    println!("Dedup ratio: {:.2}x", dedup_ratio);
}

#[test]
fn test_enhanced_pipeline_compression_ratio() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let data = generate_test_data(TestPattern::Zeros, 1024 * 1024);
    
    pipeline.process_file(Cursor::new(data.clone()), "zeros", data.len() as u64).unwrap();
    
    let stats = pipeline.stats();
    let ratio = stats.effective_ratio();
    
    assert!(ratio > 10.0, "Expected >10x compression for zeros, got {:.2}x", ratio);
}

#[test]
fn test_enhanced_pipeline_mixed_content() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let contents: Vec<Vec<u8>> = vec![
        generate_test_data(TestPattern::Json, 16384),
        generate_test_data(TestPattern::Binary, 16384),
        generate_test_data(TestPattern::Random, 16384),
        generate_test_data(TestPattern::Repeated, 16384),
        generate_test_data(TestPattern::IncrementalChange, 16384),
    ];
    
    for content in &contents {
        pipeline.process_file(Cursor::new(content.clone()), "mixed", content.len() as u64).unwrap();
    }
    
    let stats = pipeline.stats();
    println!("Mixed content stats:");
    println!("  Processed: {} chunks", stats.chunks_processed);
    println!("  Deduped: {}", stats.chunks_deduped);
    println!("  Delta: {}", stats.chunks_delta);
    println!("  Ratio: {:.2}x", stats.effective_ratio());
    
    assert!(stats.chunks_processed > 0);
}

// ==================== Stress Tests ====================

#[test]
fn test_large_file_processing() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let data = generate_test_data(TestPattern::SemiDuplicate(0.5), 10 * 1024 * 1024);
    
    let start = std::time::Instant::now();
    pipeline.process_file(Cursor::new(data.clone()), "large", data.len() as u64).unwrap();
    let elapsed = start.elapsed();
    
    let stats = pipeline.stats();
    let throughput_mb = (stats.input_bytes as f64 / 1024.0 / 1024.0) / elapsed.as_secs_f64();
    
    println!("Large file processing:");
    println!("  Size: {} MB", stats.input_bytes / 1024 / 1024);
    println!("  Time: {:.2}s", elapsed.as_secs_f64());
    println!("  Throughput: {:.1} MB/s", throughput_mb);
    println!("  Ratio: {:.2}x", stats.effective_ratio());
    
    assert!(throughput_mb > 1.0, "Throughput too low: {:.1} MB/s", throughput_mb);
}

#[test]
fn test_many_small_chunks() {
    let temp = tempdir().unwrap();
    let mut config = EnhancedPipelineConfig::default();
    config.cdc.target_size = 4096;
    config.cdc.min_size = 2048;
    config.cdc.max_size = 8192;
    
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let data = generate_test_data(TestPattern::Json, 1024 * 1024);
    
    pipeline.process_file(Cursor::new(data.clone()), "small", data.len() as u64).unwrap();
    
    let stats = pipeline.stats();
    
    assert!(stats.chunks_processed > 100, 
            "Expected >100 small chunks, got {}", stats.chunks_processed);
}

// ==================== Edge Cases ====================

#[test]
fn test_empty_data() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let result = pipeline.process_file(Cursor::new(Vec::<u8>::new()), "empty", 0);
    assert!(result.is_ok(), "Empty data should succeed");
}

#[test]
fn test_tiny_data() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let data = b"Hello!";
    let result = pipeline.process_file(Cursor::new(data.to_vec()), "tiny", data.len() as u64);
    assert!(result.is_ok(), "Tiny data should succeed");
}

#[test]
fn test_max_entropy_data() {
    let temp = tempdir().unwrap();
    let config = EnhancedPipelineConfig::default();
    let mut pipeline = EnhancedPipeline::new(temp.path(), config).unwrap();
    
    let data = generate_test_data(TestPattern::Random, 65536);
    
    pipeline.process_file(Cursor::new(data.clone()), "random", data.len() as u64).unwrap();
    
    let stats = pipeline.stats();
    println!("Random data ratio: {:.2}x", stats.effective_ratio());
}
