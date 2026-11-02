//! HAMMA Performance Controller API endpoints

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct HammaStatsResponse {
    pub version: u32,
    pub total_contexts: usize,
    pub contexts: Vec<ContextStats>,
}

#[derive(Debug, Serialize)]
pub struct ContextStats {
    pub file_type: String,
    pub entropy_bucket: u8,
    pub chunk_size_bucket: u32,
    pub shard_id: u16,
    pub dict_id: u32,
    pub strategies: Vec<StrategyStats>,
}

#[derive(Debug, Serialize)]
pub struct StrategyStats {
    pub strategy: String,
    pub samples: u64,
    pub failures: u64,
    pub fallbacks: u64,
    pub mean_speed_mb_s: f64,
    pub mean_gain: f64,
    pub hard_blacklist: bool,
}

#[derive(Debug, Deserialize)]
pub struct HammaConfigUpdate {
    pub min_speed_mb_s: Option<f64>,
    pub min_gain_ratio: Option<f64>,
    pub min_samples_for_gating: Option<u32>,
}

pub fn hamma_routes() -> Router<AppState> {
    Router::new()
        .route("/api/hamma/stats", get(get_hamma_stats))
        .route("/api/hamma/config", get(get_hamma_config))
        .route("/api/hamma/config", post(update_hamma_config))
        .route("/api/hamma/reset", post(reset_hamma_state))
}

async fn get_hamma_stats(
    State(state): State<AppState>,
) -> Result<Json<HammaStatsResponse>, StatusCode> {
    let result = state.storage.with_pipeline(|pipeline| {
        let hamma_state = &pipeline.hamma;
        
        let contexts: Vec<ContextStats> = hamma_state.contexts.iter().map(|(ctx, strategies)| {
            let strategy_stats: Vec<StrategyStats> = strategies.iter().map(|(strat, stats)| {
                StrategyStats {
                    strategy: format!("{:?}", strat),
                    samples: stats.samples,
                    failures: stats.failures,
                    fallbacks: stats.fallbacks,
                    mean_speed_mb_s: stats.mean_speed_mb_s,
                    mean_gain: stats.mean_gain,
                    hard_blacklist: stats.hard_blacklist,
                }
            }).collect();

            ContextStats {
                file_type: ctx.file_type.clone(),
                entropy_bucket: ctx.entropy_bucket,
                chunk_size_bucket: ctx.chunk_size_bucket,
                shard_id: ctx.shard_id,
                dict_id: ctx.dict_id,
                strategies: strategy_stats,
            }
        }).collect();

        HammaStatsResponse {
            version: hamma_state.version,
            total_contexts: contexts.len(),
            contexts,
        }
    }).await;

    result.map(Json).ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

#[derive(Debug, Serialize)]
pub struct HammaConfigResponse {
    pub min_speed_mb_s: f64,
    pub min_gain_ratio: f64,
    pub min_samples_for_gating: u32,
    pub state_file: String,
}

async fn get_hamma_config(
    State(state): State<AppState>,
) -> Result<Json<HammaConfigResponse>, StatusCode> {
    let result = state.storage.with_pipeline(|pipeline| {
        let config = &pipeline.hamma.config;
        HammaConfigResponse {
            min_speed_mb_s: config.min_speed_mb_s,
            min_gain_ratio: config.min_gain_ratio,
            min_samples_for_gating: config.min_samples_for_gating,
            state_file: config.state_file.clone(),
        }
    }).await;

    result.map(Json).ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

async fn update_hamma_config(
    State(_state): State<AppState>,
    Json(_update): Json<HammaConfigUpdate>,
) -> Result<StatusCode, StatusCode> {
    // Config updates require mutable access to pipeline
    // Currently not implemented due to pipeline ownership constraints
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn reset_hamma_state(
    State(_state): State<AppState>,
) -> Result<StatusCode, StatusCode> {
    // State reset requires mutable access to pipeline
    // Currently not implemented due to pipeline ownership constraints
    Err(StatusCode::NOT_IMPLEMENTED)
}
