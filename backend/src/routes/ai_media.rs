//! REST API Routes for AI-Assisted Lossless Media Intelligence (V22)

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use spk_core::ai_media::{
    AIStructureAnalyzer, AIChunkOptimizer, DuplicateStructureDetector,
    AICompressionRouter, PredictiveReadAhead, MediaSegmentType, StructuralAnalysis,
    CompressionRoute, DuplicateRegion,
};
use std::sync::Arc;

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AnalyzeRequest {
    pub data: Vec<u8>,
    pub offset: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct AnalyzeResponse {
    pub segment_type: String,
    pub entropy_score: f32,
    pub temporal_similarity: f32,
    pub spatial_coherence: f32,
    pub optimal_chunk_size: usize,
    pub recommended_codec: String,
    pub dedup_candidate: bool,
    pub partition_boundary: bool,
}

#[derive(Debug, Deserialize)]
pub struct OptimizeChunksRequest {
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct OptimizeChunksResponse {
    pub boundaries: Vec<usize>,
    pub chunk_count: usize,
    pub avg_chunk_size: usize,
}

#[derive(Debug, Deserialize)]
pub struct FindDuplicatesRequest {
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct FindDuplicatesResponse {
    pub duplicates: Vec<DuplicateInfo>,
    pub total_duplicates: usize,
    pub bytes_saved: usize,
}

#[derive(Debug, Serialize)]
pub struct DuplicateInfo {
    pub positions: Vec<usize>,
    pub size: usize,
    pub occurrences: usize,
}

#[derive(Debug, Deserialize)]
pub struct RouteCompressionRequest {
    pub data: Vec<u8>,
    pub offset: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct RouteCompressionResponse {
    pub codec: String,
    pub chunk_size: usize,
    pub parallel: bool,
    pub gpu_accelerate: bool,
    pub dedup_first: bool,
}

#[derive(Debug, Deserialize)]
pub struct PredictReadAheadRequest {
    pub current_chunk: usize,
    pub access_history: Option<Vec<Vec<usize>>>,
}

#[derive(Debug, Serialize)]
pub struct PredictReadAheadResponse {
    pub predicted_chunks: Vec<usize>,
    pub confidence: f32,
}

#[derive(Debug, Serialize)]
pub struct AIMediaStatsResponse {
    pub analyzer_cache_size: usize,
    pub readahead_history_size: usize,
    pub duplicates_found: usize,
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/// Analyze media structure with AI
pub async fn analyze_structure(
    Json(req): Json<AnalyzeRequest>,
) -> Result<Json<AnalyzeResponse>, StatusCode> {
    let analyzer = AIStructureAnalyzer::new();
    let offset = req.offset.unwrap_or(0);
    
    match analyzer.analyze(&req.data, offset) {
        Ok(analysis) => {
            let response = AnalyzeResponse {
                segment_type: format!("{:?}", analysis.segment_type),
                entropy_score: analysis.entropy_score,
                temporal_similarity: analysis.temporal_similarity,
                spatial_coherence: analysis.spatial_coherence,
                optimal_chunk_size: analysis.optimal_chunk_size,
                recommended_codec: format!("{:?}", analysis.recommended_codec),
                dedup_candidate: analysis.dedup_candidate,
                partition_boundary: analysis.partition_boundary,
            };
            Ok(Json(response))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Compute optimal chunk boundaries
pub async fn optimize_chunks(
    Json(req): Json<OptimizeChunksRequest>,
) -> Result<Json<OptimizeChunksResponse>, StatusCode> {
    let optimizer = AIChunkOptimizer::new();
    
    match optimizer.compute_chunk_boundaries(&req.data) {
        Ok(boundaries) => {
            let chunk_count = boundaries.len().saturating_sub(1);
            let avg_chunk_size = if chunk_count > 0 {
                req.data.len() / chunk_count
            } else {
                0
            };
            
            let response = OptimizeChunksResponse {
                boundaries,
                chunk_count,
                avg_chunk_size,
            };
            Ok(Json(response))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Find duplicate structures
pub async fn find_duplicates(
    Json(req): Json<FindDuplicatesRequest>,
) -> Result<Json<FindDuplicatesResponse>, StatusCode> {
    let detector = DuplicateStructureDetector::new();
    
    match detector.find_duplicates(&req.data) {
        Ok(duplicates) => {
            let mut total_duplicates = 0;
            let mut bytes_saved = 0;
            
            let duplicate_infos: Vec<DuplicateInfo> = duplicates
                .into_iter()
                .map(|dup| {
                    let occurrences = dup.positions.len();
                    total_duplicates += occurrences.saturating_sub(1);
                    bytes_saved += dup.size * occurrences.saturating_sub(1);
                    
                    DuplicateInfo {
                        positions: dup.positions,
                        size: dup.size,
                        occurrences,
                    }
                })
                .collect();
            
            let response = FindDuplicatesResponse {
                duplicates: duplicate_infos,
                total_duplicates,
                bytes_saved,
            };
            Ok(Json(response))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Route compression strategy
pub async fn route_compression(
    Json(req): Json<RouteCompressionRequest>,
) -> Result<Json<RouteCompressionResponse>, StatusCode> {
    let router = AICompressionRouter::new();
    let offset = req.offset.unwrap_or(0);
    
    match router.route_chunk(&req.data, offset) {
        Ok(route) => {
            let response = RouteCompressionResponse {
                codec: format!("{:?}", route.codec),
                chunk_size: route.chunk_size,
                parallel: route.parallel,
                gpu_accelerate: route.gpu_accelerate,
                dedup_first: route.dedup_first,
            };
            Ok(Json(response))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Predict read-ahead chunks
pub async fn predict_readahead(
    Json(req): Json<PredictReadAheadRequest>,
) -> Result<Json<PredictReadAheadResponse>, StatusCode> {
    let predictor = PredictiveReadAhead::new();
    
    // Record history if provided
    if let Some(history) = req.access_history {
        for pattern in history {
            if let Err(_) = predictor.record_access(pattern) {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
    
    match predictor.predict_next(req.current_chunk) {
        Ok(predictions) => {
            let confidence = if predictions.is_empty() {
                0.0
            } else {
                0.8 // High confidence if we have predictions
            };
            
            let response = PredictReadAheadResponse {
                predicted_chunks: predictions,
                confidence,
            };
            Ok(Json(response))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Get AI media intelligence stats
pub async fn get_ai_stats() -> Result<Json<AIMediaStatsResponse>, StatusCode> {
    let response = AIMediaStatsResponse {
        analyzer_cache_size: 0, // Would need shared state to track
        readahead_history_size: 0,
        duplicates_found: 0,
    };
    Ok(Json(response))
}

/// Clear all AI caches
pub async fn clear_ai_caches() -> Result<impl IntoResponse, StatusCode> {
    let analyzer = AIStructureAnalyzer::new();
    let detector = DuplicateStructureDetector::new();
    let predictor = PredictiveReadAhead::new();
    
    analyzer.clear_cache().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    detector.clear_cache().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    predictor.clear_history().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok((StatusCode::OK, "All AI caches cleared"))
}
