//! Criterion benchmarks for SPK-Core V25
//!
//! Benchmarks for:
//! - CDC (Content-Defined Chunking) with various normalization levels
//! - Gear hashing (standard and SIMD)
//! - Deduplication store operations
//! - Delta encoding/decoding
//! - Full pipeline throughput

use criterion::{
    black_box, criterion_group, criterion_main, 
    Criterion, BenchmarkId, Throughput,
};
use std::hint::black_box as bb;

use spk_core::{
    CdcConfig, ContentDefinedChunker, GearHasher, NormalizationLevel,
    DedupStore,
    DeltaConfig, DeltaEncoder, DeltaDecoder,
    SimilarityConfig, SimilarityIndex, ChunkSignature,
};

/// Generate test data of specified size
fn generate_data(size: usize, pattern: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(size);
    let mut seed: u64 = pattern as u64 * 0xDEADBEEF;
    for _ in 0..size {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        data.push((seed >> 33) as u8);
    }
    data
}

/// Generate compressible JSON-like data
fn generate_json_data(size: usize) -> Vec<u8> {
    let template = r#"{"id":%d,"name":"item_%d","value":%d}"#;
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

// ==================== CDC Benchmarks ====================

fn bench_cdc_chunking(c: &mut Criterion) {
    let mut group = c.benchmark_group("CDC Chunking");
    
    for size in [64 * 1024, 256 * 1024, 1024 * 1024].iter() {
        let data = generate_data(*size, 42);
        
        group.throughput(Throughput::Bytes(*size as u64));
        
        group.bench_with_input(
            BenchmarkId::new("random", size),
            &data,
            |b, data| {
                b.iter(|| {
                    let config = CdcConfig::default();
                    let mut chunker = ContentDefinedChunker::new(config);
                    black_box(chunker.chunk_data(data))
                })
            },
        );
    }
    
    // JSON data
    let json_data = generate_json_data(256 * 1024);
    group.throughput(Throughput::Bytes(json_data.len() as u64));
    group.bench_function("json_256kb", |b| {
        b.iter(|| {
            let config = CdcConfig::default();
            let mut chunker = ContentDefinedChunker::new(config);
            black_box(chunker.chunk_data(&json_data))
        })
    });
    
    group.finish();
}

fn bench_cdc_normalization(c: &mut Criterion) {
    let mut group = c.benchmark_group("CDC Normalization");
    let data = generate_data(256 * 1024, 42);
    
    group.throughput(Throughput::Bytes(data.len() as u64));
    
    for level in [
        NormalizationLevel::None,
        NormalizationLevel::Level1,
        NormalizationLevel::Level2,
        NormalizationLevel::Level3,
    ] {
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{:?}", level)),
            &data,
            |b, data| {
                b.iter(|| {
                    let mut config = CdcConfig::default();
                    config.normalization = level;
                    let mut chunker = ContentDefinedChunker::new(config);
                    black_box(chunker.chunk_data(data))
                })
            },
        );
    }
    
    group.finish();
}

fn bench_gear_hasher(c: &mut Criterion) {
    let mut group = c.benchmark_group("Gear Hasher");
    
    for size in [4096, 16384, 65536].iter() {
        let data = generate_data(*size, 1);
        
        group.throughput(Throughput::Bytes(*size as u64));
        
        group.bench_with_input(
            BenchmarkId::new("standard", size),
            &data,
            |b, data| {
                b.iter(|| {
                    let mut hasher = GearHasher::new();
                    for byte in data.iter() {
                        hasher.roll(*byte);
                    }
                    black_box(hasher.hash())
                })
            },
        );
    }
    
    group.finish();
}

// ==================== Dedup Store Benchmarks ====================

fn bench_dedup_store(c: &mut Criterion) {
    let mut group = c.benchmark_group("Dedup Store");
    
    // Setup
    let temp = tempfile::tempdir().unwrap();
    let store = DedupStore::new(temp.path()).unwrap();
    
    // Pre-populate with some chunks
    for i in 0..100 {
        let data = generate_data(4096, i);
        let _ = store.store(&data);
    }
    
    // Benchmark store operation (new chunk)
    let new_chunk = generate_data(4096, 255);
    group.throughput(Throughput::Bytes(4096));
    
    group.bench_function("store_new_4kb", |b| {
        b.iter(|| {
            let data = generate_data(4096, bb(rand::random::<u8>()));
            black_box(store.store(&data))
        })
    });
    
    // Benchmark duplicate detection
    let existing = generate_data(4096, 50); // Already stored
    group.bench_function("store_dup_4kb", |b| {
        b.iter(|| {
            black_box(store.store(&existing))
        })
    });
    
    // Benchmark retrieval
    let result = store.store(&new_chunk).unwrap();
    group.bench_function("retrieve_4kb", |b| {
        b.iter(|| {
            black_box(store.retrieve(&result.fingerprint))
        })
    });
    
    group.finish();
}

fn bench_dedup_hash(c: &mut Criterion) {
    let mut group = c.benchmark_group("Dedup Hash (BLAKE3)");
    
    for size in [1024, 4096, 16384, 65536].iter() {
        let data = generate_data(*size, 42);
        
        group.throughput(Throughput::Bytes(*size as u64));
        
        group.bench_with_input(
            BenchmarkId::new("blake3", size),
            &data,
            |b, data| {
                b.iter(|| {
                    black_box(blake3::hash(data))
                })
            },
        );
    }
    
    group.finish();
}

// ==================== Delta Encoding Benchmarks ====================

fn bench_delta_encoding(c: &mut Criterion) {
    let mut group = c.benchmark_group("Delta Encoding");
    
    let config = DeltaConfig::default();
    let encoder = DeltaEncoder::new(config.clone());
    let decoder = DeltaDecoder::new(config);
    
    // Similar data (best case for delta)
    let base = generate_json_data(16384);
    let mut modified = base.clone();
    for i in (0..modified.len()).step_by(100) {
        if i < modified.len() {
            modified[i] = modified[i].wrapping_add(1);
        }
    }
    
    group.throughput(Throughput::Bytes(base.len() as u64));
    
    group.bench_function("encode_similar_16kb", |b| {
        b.iter(|| {
            black_box(encoder.encode(&base, &modified))
        })
    });
    
    // Encode once for decode benchmark
    let delta = encoder.encode(&base, &modified).unwrap();
    
    group.bench_function("decode_16kb", |b| {
        b.iter(|| {
            black_box(decoder.decode(&base, &delta.delta_data))
        })
    });
    
    // Dissimilar data (worst case for delta)
    let different = generate_data(16384, 99);
    group.bench_function("encode_dissimilar_16kb", |b| {
        b.iter(|| {
            black_box(encoder.encode(&base, &different))
        })
    });
    
    group.finish();
}

// ==================== Similarity Index Benchmarks ====================

fn bench_similarity_index(c: &mut Criterion) {
    let mut group = c.benchmark_group("Similarity Index");
    
    let config = SimilarityConfig::default();
    
    // Build index with chunks
    let mut index = SimilarityIndex::new(config.clone());
    let mut signatures = Vec::new();
    
    for i in 0..1000 {
        let data = generate_data(4096, i as u8);
        let fp = blake3::hash(&data);
        let sig = ChunkSignature::compute(&data, fp.as_bytes().try_into().unwrap());
        signatures.push(sig.clone());
        index.add(sig);
    }
    
    // Benchmark signature computation
    let test_data = generate_data(4096, 123);
    group.throughput(Throughput::Bytes(4096));
    
    group.bench_function("compute_signature_4kb", |b| {
        b.iter(|| {
            let fp = blake3::hash(&test_data);
            black_box(ChunkSignature::compute(&test_data, fp.as_bytes().try_into().unwrap()))
        })
    });
    
    // Benchmark candidate lookup
    let query_sig = &signatures[500];
    group.bench_function("find_candidates_1k_index", |b| {
        b.iter(|| {
            black_box(index.find_candidates(query_sig))
        })
    });
    
    // Benchmark add to index
    let new_data = generate_data(4096, 254);
    let new_fp = blake3::hash(&new_data);
    let new_sig = ChunkSignature::compute(&new_data, new_fp.as_bytes().try_into().unwrap());
    
    group.bench_function("add_to_index", |b| {
        b.iter(|| {
            let mut idx = SimilarityIndex::new(config.clone());
            black_box(idx.add(new_sig.clone()))
        })
    });
    
    group.finish();
}

// ==================== Compression Benchmarks ====================

fn bench_compression(c: &mut Criterion) {
    let mut group = c.benchmark_group("Compression");
    
    let json_data = generate_json_data(64 * 1024);
    let random_data = generate_data(64 * 1024, 42);
    
    group.throughput(Throughput::Bytes(64 * 1024));
    
    // ZSTD compression at different levels
    for level in [1, 3, 9] {
        group.bench_with_input(
            BenchmarkId::new("zstd_json", level),
            &json_data,
            |b, data| {
                b.iter(|| {
                    black_box(zstd::encode_all(data.as_slice(), level))
                })
            },
        );
    }
    
    // Random data (incompressible)
    group.bench_function("zstd_random_l3", |b| {
        b.iter(|| {
            black_box(zstd::encode_all(random_data.as_slice(), 3))
        })
    });
    
    // Decompression
    let compressed = zstd::encode_all(json_data.as_slice(), 3).unwrap();
    group.bench_function("zstd_decompress", |b| {
        b.iter(|| {
            black_box(zstd::decode_all(compressed.as_slice()))
        })
    });
    
    group.finish();
}

// ==================== Full Pipeline Benchmarks ====================

fn bench_pipeline_throughput(c: &mut Criterion) {
    let mut group = c.benchmark_group("Pipeline Throughput");
    group.sample_size(10); // Fewer samples for slow benchmarks
    
    for size_kb in [64, 256, 1024].iter() {
        let size = size_kb * 1024;
        let data = generate_json_data(size);
        
        group.throughput(Throughput::Bytes(size as u64));
        
        group.bench_with_input(
            BenchmarkId::new("json", format!("{}kb", size_kb)),
            &data,
            |b, data| {
                b.iter_with_setup(
                    || {
                        let temp = tempfile::tempdir().unwrap();
                        let config = spk_core::EnhancedPipelineConfig::default();
                        spk_core::EnhancedPipeline::new(temp.path(), config).unwrap()
                    },
                    |mut pipeline| {
                        black_box(pipeline.process_data(data))
                    },
                )
            },
        );
    }
    
    group.finish();
}

// ==================== Group Definitions ====================

criterion_group!(
    benches,
    bench_cdc_chunking,
    bench_cdc_normalization,
    bench_gear_hasher,
    bench_dedup_store,
    bench_dedup_hash,
    bench_delta_encoding,
    bench_similarity_index,
    bench_compression,
    bench_pipeline_throughput,
);

criterion_main!(benches);
