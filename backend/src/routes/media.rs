//! Backend API routes for Media-Safe High-Accuracy Compression Pipeline

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

use crate::AppState;
use spk_core::media::{
    MediaType, MediaCompressionMode, MediaTypeDetector, MediaStructureParser,
    MediaCompressionConfig, compress_media_file, MediaCompressionStats,
    DoubleHash, BoundaryType,
};

// =============================================================================
// STATE
// =============================================================================

#[derive(Clone)]
pub struct MediaState {
    pub compression_history: Arc<RwLock<Vec<MediaCompressionRecord>>>,
}

impl Default for MediaState {
    fn default() -> Self {
        Self {
            compression_history: Arc::new(RwLock::new(Vec::new())),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaCompressionRecord {
    pub id: String,
    pub file_name: String,
    pub media_type: String,
    pub compression_mode: String,
    pub codec: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub compression_ratio: f64,
    pub throughput_gbps: f64,
    pub timestamp: i64,
}

// =============================================================================
// DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct DetectMediaTypeRequest {
    pub file_path: String,
}

#[derive(Debug, Serialize)]
pub struct DetectMediaTypeResponse {
    pub media_type: String,
    pub recommended_codec: String,
    pub compression_mode: String,
    pub recommended_chunk_size: usize,
}

#[derive(Debug, Deserialize)]
pub struct ParseStructureRequest {
    pub file_path: String,
}

#[derive(Debug, Serialize)]
pub struct MediaStructureDto {
    pub media_type: String,
    pub file_size: u64,
    pub num_boundaries: usize,
    pub boundaries: Vec<MediaBoundaryDto>,
}

#[derive(Debug, Serialize)]
pub struct MediaBoundaryDto {
    pub offset: u64,
    pub size: u64,
    pub boundary_type: String,
}

#[derive(Debug, Deserialize)]
pub struct CompressMediaRequest {
    pub input_path: String,
    pub output_path: String,
    pub use_gpu: Option<bool>,
    pub num_threads: Option<usize>,
    pub verify_chunks: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct CompressMediaResponse {
    pub success: bool,
    pub compression_id: String,
    pub stats: MediaStatsDto,
}

#[derive(Debug, Serialize)]
pub struct MediaStatsDto {
    pub media_type: String,
    pub compression_mode: String,
    pub codec: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub compression_ratio: f64,
    pub chunks_processed: u64,
    pub elapsed_secs: f64,
    pub throughput_gbps: f64,
    pub verification_passed: bool,
}

#[derive(Debug, Serialize)]
pub struct CompressionHistoryResponse {
    pub total_compressions: usize,
    pub history: Vec<MediaCompressionRecord>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyFileRequest {
    pub file_path: String,
    pub expected_hash_sha256: String,
    pub expected_hash_crc32c: u32,
}

#[derive(Debug, Serialize)]
pub struct VerifyFileResponse {
    pub verified: bool,
    pub computed_hash_sha256: String,
    pub computed_hash_crc32c: u32,
}

// =============================================================================
// HANDLERS
// =============================================================================

/// POST /media/detect - Detect media type
async fn detect_media_type(
    State(_app_state): State<AppState>,
    Json(req): Json<DetectMediaTypeRequest>,
) -> impl IntoResponse {
    match MediaTypeDetector::detect(&req.file_path) {
        Ok(media_type) => {
            let file_size = std::fs::metadata(&req.file_path)
                .map(|m| m.len())
                .unwrap_or(0);
            
            let response = DetectMediaTypeResponse {
                media_type: format!("{:?}", media_type),
                recommended_codec: format!("{:?}", media_type.recommended_codec()),
                compression_mode: format!("{:?}", media_type.compression_mode()),
                recommended_chunk_size: media_type.chunk_size(file_size),
            };
            
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Detection failed: {}", e)).into_response()
        }
    }
}

/// POST /media/structure - Parse media structure
async fn parse_media_structure(
    State(_app_state): State<AppState>,
    Json(req): Json<ParseStructureRequest>,
) -> impl IntoResponse {
    match MediaStructureParser::parse(&req.file_path) {
        Ok(structure) => {
            let boundaries: Vec<MediaBoundaryDto> = structure
                .boundaries
                .iter()
                .take(100) // Limit to first 100 boundaries for response size
                .map(|b| MediaBoundaryDto {
                    offset: b.offset,
                    size: b.size,
                    boundary_type: format!("{:?}", b.boundary_type),
                })
                .collect();
            
            let response = MediaStructureDto {
                media_type: format!("{:?}", structure.media_type),
                file_size: structure.file_size,
                num_boundaries: structure.boundaries.len(),
                boundaries,
            };
            
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Parsing failed: {}", e)).into_response()
        }
    }
}

/// POST /media/compress - Compress media file
async fn compress_media(
    State(app_state): State<AppState>,
    Json(req): Json<CompressMediaRequest>,
) -> impl IntoResponse {
    let config = MediaCompressionConfig {
        use_gpu: req.use_gpu.unwrap_or(false),
        num_threads: req.num_threads,
        verify_chunks: req.verify_chunks.unwrap_or(true),
    };
    
    match compress_media_file(&req.input_path, &req.output_path, config) {
        Ok(stats) => {
            let compression_id = uuid::Uuid::new_v4().to_string();
            
            // Store in history
            let record = MediaCompressionRecord {
                id: compression_id.clone(),
                file_name: req.input_path.clone(),
                media_type: format!("{:?}", stats.media_type),
                compression_mode: format!("{:?}", stats.compression_mode),
                codec: format!("{:?}", stats.codec),
                original_size: stats.original_size,
                compressed_size: stats.compressed_size,
                compression_ratio: stats.compression_ratio,
                throughput_gbps: stats.throughput_gbps,
                timestamp: chrono::Utc::now().timestamp(),
            };
            
            let media_state = app_state.media.read().unwrap();
            media_state.compression_history.write().unwrap().push(record);
            
            let response = CompressMediaResponse {
                success: true,
                compression_id,
                stats: MediaStatsDto {
                    media_type: format!("{:?}", stats.media_type),
                    compression_mode: format!("{:?}", stats.compression_mode),
                    codec: format!("{:?}", stats.codec),
                    original_size: stats.original_size,
                    compressed_size: stats.compressed_size,
                    compression_ratio: stats.compression_ratio,
                    chunks_processed: stats.chunks_processed,
                    elapsed_secs: stats.elapsed_secs,
                    throughput_gbps: stats.throughput_gbps,
                    verification_passed: stats.verification_passed,
                },
            };
            
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Compression failed: {}", e)).into_response()
        }
    }
}

/// GET /media/history - Get compression history
async fn get_compression_history(
    State(app_state): State<AppState>,
) -> impl IntoResponse {
    let media_state = app_state.media.read().unwrap();
    let history = media_state.compression_history.read().unwrap().clone();
    
    let response = CompressionHistoryResponse {
        total_compressions: history.len(),
        history,
    };
    
    (StatusCode::OK, Json(response)).into_response()
}

/// GET /media/history/:id - Get specific compression record
async fn get_compression_record(
    State(app_state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let media_state = app_state.media.read().unwrap();
    let history = media_state.compression_history.read().unwrap();
    
    match history.iter().find(|r| r.id == id) {
        Some(record) => (StatusCode::OK, Json(record.clone())).into_response(),
        None => (StatusCode::NOT_FOUND, "Record not found".to_string()).into_response(),
    }
}

/// POST /media/verify - Verify file integrity with double hash
async fn verify_file_integrity(
    State(_app_state): State<AppState>,
    Json(req): Json<VerifyFileRequest>,
) -> impl IntoResponse {
    match std::fs::read(&req.file_path) {
        Ok(data) => {
            let double_hash = DoubleHash::compute(&data);
            
            let expected_sha256 = hex::decode(&req.expected_hash_sha256).unwrap_or_default();
            let sha256_match = expected_sha256.len() == 32 && expected_sha256 == double_hash.sha256;
            let crc32c_match = req.expected_hash_crc32c == double_hash.crc32c;
            
            let response = VerifyFileResponse {
                verified: sha256_match && crc32c_match,
                computed_hash_sha256: hex::encode(double_hash.sha256),
                computed_hash_crc32c: double_hash.crc32c,
            };
            
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read file: {}", e)).into_response()
        }
    }
}

/// GET /media/stats - Get media compression statistics
async fn get_media_stats(
    State(app_state): State<AppState>,
) -> impl IntoResponse {
    let media_state = app_state.media.read().unwrap();
    let history = media_state.compression_history.read().unwrap();
    
    let total_compressions = history.len();
    let total_original_size: u64 = history.iter().map(|r| r.original_size).sum();
    let total_compressed_size: u64 = history.iter().map(|r| r.compressed_size).sum();
    let avg_compression_ratio = if total_compressions > 0 {
        history.iter().map(|r| r.compression_ratio).sum::<f64>() / total_compressions as f64
    } else {
        0.0
    };
    let avg_throughput = if total_compressions > 0 {
        history.iter().map(|r| r.throughput_gbps).sum::<f64>() / total_compressions as f64
    } else {
        0.0
    };
    
    let stats = serde_json::json!({
        "total_compressions": total_compressions,
        "total_original_size": total_original_size,
        "total_compressed_size": total_compressed_size,
        "total_space_saved": total_original_size.saturating_sub(total_compressed_size),
        "avg_compression_ratio": avg_compression_ratio,
        "avg_throughput_gbps": avg_throughput,
    });
    
    (StatusCode::OK, Json(stats)).into_response()
}

/// GET /media/types - Get supported media types
async fn get_supported_media_types() -> impl IntoResponse {
    let types = vec![
        "ImagePNG", "ImageTIFF", "ImageEXR", "ImageJPEG", "ImageRAW",
        "VideoMP4", "VideoMKV", "VideoMOV", "VideoAVI",
        "AudioWAV", "AudioFLAC", "AudioMP3", "AudioAAC",
        "Model3D_OBJ", "Model3D_FBX", "Model3D_GLB", "Model3D_GLTF",
        "VFX_EXR_Sequence", "VFX_Alembic", "VFX_OpenVDB",
        "Scientific_HDF5", "Scientific_NetCDF",
    ];
    
    (StatusCode::OK, Json(types)).into_response()
}

// =============================================================================
// ROUTER
// =============================================================================

pub fn media_routes() -> Router<AppState> {
    Router::<AppState>::new()
        .route("/api/media/detect", post(detect_media_type))
        .route("/api/media/structure", post(parse_media_structure))
        .route("/api/media/compress", post(compress_media))
        .route("/api/media/history", get(get_compression_history))
        .route("/api/media/history/:id", get(get_compression_record))
        .route("/api/media/verify", post(verify_file_integrity))
        .route("/api/media/stats", get(get_media_stats))
        .route("/api/media/types", get(get_supported_media_types))
}
