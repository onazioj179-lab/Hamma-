//! AI Media routes module helper

use axum::{
    routing::{get, post},
    Router,
};

use super::ai_media;
use crate::AppState;

/// Create AI media routes
pub fn ai_media_routes() -> Router<AppState> {
    Router::new()
        .route("/api/v22/ai/analyze", post(ai_media::analyze_structure))
        .route("/api/v22/ai/optimize-chunks", post(ai_media::optimize_chunks))
        .route("/api/v22/ai/find-duplicates", post(ai_media::find_duplicates))
        .route("/api/v22/ai/route-compression", post(ai_media::route_compression))
        .route("/api/v22/ai/predict-readahead", post(ai_media::predict_readahead))
        .route("/api/v22/ai/stats", get(ai_media::get_ai_stats))
        .route("/api/v22/ai/clear-caches", post(ai_media::clear_ai_caches))
}
