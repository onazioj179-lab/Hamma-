//! V13 Semantic Compression API Routes

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json, Router,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use spk_core::semantic::SemanticAnalyzer;

/// Semantic analyzer state
#[derive(Clone)]
pub struct SemanticState {
    analyzer: Arc<SemanticAnalyzer>,
}

impl Default for SemanticState {
    fn default() -> Self {
        Self {
            analyzer: Arc::new(SemanticAnalyzer::default()),
        }
    }
}

/// Analyze request
#[derive(Debug, Deserialize)]
pub struct AnalyzeRequest {
    pub chunk_id: usize,
    pub data: Vec<u8>,
}

/// Analyze response
#[derive(Debug, Serialize)]
pub struct AnalyzeResponse {
    pub fingerprint: FingerprintDto,
    pub group_id: Option<u64>,
}

/// Fingerprint DTO
#[derive(Debug, Serialize)]
pub struct FingerprintDto {
    pub hash: String,
    pub content_type: String,
    pub language: Option<String>,
    pub tag_count: usize,
    pub feature_count: usize,
}

/// Group request
#[derive(Debug, Deserialize)]
pub struct GroupRequest {
    pub threshold: Option<f32>,
}

/// Group response
#[derive(Debug, Serialize)]
pub struct GroupResponse {
    pub groups: Vec<GroupDto>,
}

/// Group DTO
#[derive(Debug, Serialize)]
pub struct GroupDto {
    pub id: u64,
    pub chunk_count: usize,
    pub cohesion: f32,
}

/// Create semantic routes
pub fn semantic_routes() -> Router<crate::AppState> {
    Router::new()
        .route("/api/v13/semantic/analyze", post(analyze_chunk))
        .route("/api/v13/semantic/fingerprint/:chunk_id", get(get_fingerprint))
        .route("/api/v13/semantic/group", get(get_groups))
        .route("/api/v13/semantic/stats", get(get_stats))
        .route("/api/v13/semantic/similar/:chunk_id", get(find_similar))
        .route("/api/v13/semantic/functions", get(get_function_stats))
}

/// Analyze chunk and create semantic fingerprint
async fn analyze_chunk(
    State(_state): State<crate::AppState>,
    Json(request): Json<AnalyzeRequest>,
) -> impl IntoResponse {
    // In real implementation, get analyzer from AppState
    let analyzer = SemanticAnalyzer::default();

    match analyzer.analyze_chunk(request.chunk_id, &request.data) {
        Ok(fingerprint) => {
            let group_id = analyzer.group_manager()
                .get_group(request.chunk_id)
                .ok()
                .flatten()
                .map(|g| g.id);

            let dto = FingerprintDto {
                hash: hex::encode(&fingerprint.hash),
                content_type: format!("{:?}", fingerprint.content_type),
                language: fingerprint.language.map(|l| format!("{:?}", l)),
                tag_count: fingerprint.tags.len(),
                feature_count: fingerprint.features.len(),
            };

            Json(AnalyzeResponse {
                fingerprint: dto,
                group_id,
            }).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to analyze chunk: {}", e),
        ).into_response(),
    }
}

/// Get fingerprint for chunk
async fn get_fingerprint(
    State(_state): State<crate::AppState>,
    Path(_chunk_id): Path<usize>,
) -> impl IntoResponse {
    // Placeholder - would retrieve from storage
    Json(serde_json::json!({
        "message": "Fingerprint retrieval not yet implemented in storage"
    })).into_response()
}

/// Get all semantic groups
async fn get_groups(
    State(_state): State<crate::AppState>,
) -> impl IntoResponse {
    let analyzer = SemanticAnalyzer::default();

    match analyzer.group_manager().get_all_groups() {
        Ok(groups) => {
            let dtos: Vec<GroupDto> = groups.iter().map(|g| GroupDto {
                id: g.id,
                chunk_count: g.chunk_ids.len(),
                cohesion: g.cohesion,
            }).collect();

            Json(GroupResponse { groups: dtos }).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get groups: {}", e),
        ).into_response(),
    }
}

/// Get semantic statistics
async fn get_stats(
    State(_state): State<crate::AppState>,
) -> impl IntoResponse {
    let analyzer = SemanticAnalyzer::default();

    match analyzer.stats() {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get stats: {}", e),
        ).into_response(),
    }
}

/// Find similar chunks
async fn find_similar(
    State(_state): State<crate::AppState>,
    Path(chunk_id): Path<usize>,
) -> impl IntoResponse {
    let analyzer = SemanticAnalyzer::default();

    // Would need to retrieve fingerprint from storage
    Json(serde_json::json!({
        "chunk_id": chunk_id,
        "similar_chunks": [],
        "message": "Requires fingerprint storage implementation"
    })).into_response()
}

/// Get function deduplication statistics
async fn get_function_stats(
    State(_state): State<crate::AppState>,
) -> impl IntoResponse {
    let analyzer = SemanticAnalyzer::default();

    match analyzer.function_index().stats() {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get function stats: {}", e),
        ).into_response(),
    }
}
