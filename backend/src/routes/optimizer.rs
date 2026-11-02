//! Optimizer API routes (V7)

use axum::{
    extract::{Json, State},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Application state for optimizer
pub struct OptimizerState {
    pub target: String,
    pub auto_tune: bool,
    pub learning_rate: f64,
    pub metrics_history: Vec<MetricsSample>,
}

impl Default for OptimizerState {
    fn default() -> Self {
        Self {
            target: "balanced".to_string(),
            auto_tune: true,
            learning_rate: 0.1,
            metrics_history: Vec::new(),
        }
    }
}

/// Performance metrics sample
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSample {
    pub timestamp_ms: u64,
    pub throughput: f64,
    pub latency_us: u64,
    pub cpu_utilization: f64,
    pub gpu_utilization: f64,
    pub memory_usage: u64,
    pub compression_ratio: f64,
}

/// Optimizer status response
#[derive(Serialize)]
pub struct OptimizerStatus {
    pub target: String,
    pub auto_tune: bool,
    pub learning_rate: f64,
    pub samples_collected: usize,
    pub current_parameters: CurrentParameters,
}

/// Current optimizer parameters
#[derive(Serialize)]
pub struct CurrentParameters {
    pub chunk_size: usize,
    pub codec: String,
    pub threads: usize,
    pub gpu_enabled: bool,
    pub gpu_workers: usize,
}

/// Set target request
#[derive(Deserialize)]
pub struct SetTargetRequest {
    pub target: String, // "throughput", "latency", "memory", "compression", "balanced", "power"
}

/// Tune parameters request
#[derive(Deserialize)]
pub struct TuneRequest {
    pub learning_rate: Option<f64>,
    pub auto_tune: Option<bool>,
}

/// Retrain request
#[derive(Deserialize)]
pub struct RetrainRequest {
    pub clear_history: bool,
}

/// Create optimizer router
pub fn optimizer_routes() -> Router<Arc<RwLock<OptimizerState>>> {
    Router::new()
        .route("/status", get(get_status))
        .route("/target", post(set_target))
        .route("/tune", post(tune_parameters))
        .route("/retrain", post(retrain))
        .route("/metrics", post(record_metrics))
        .route("/recommend", get(get_recommendations))
}

/// Get optimizer status
async fn get_status(
    State(state): State<Arc<RwLock<OptimizerState>>>,
) -> Json<OptimizerStatus> {
    let state = state.read().await;
    
    Json(OptimizerStatus {
        target: state.target.clone(),
        auto_tune: state.auto_tune,
        learning_rate: state.learning_rate,
        samples_collected: state.metrics_history.len(),
        current_parameters: CurrentParameters {
            chunk_size: 4 * 1024 * 1024,
            codec: "zstd".to_string(),
            threads: num_cpus::get(),
            gpu_enabled: false,
            gpu_workers: 0,
        },
    })
}

/// Set optimization target
async fn set_target(
    State(state): State<Arc<RwLock<OptimizerState>>>,
    Json(request): Json<SetTargetRequest>,
) -> Json<serde_json::Value> {
    let valid_targets = ["throughput", "latency", "memory", "compression", "balanced", "power"];
    
    if !valid_targets.contains(&request.target.as_str()) {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("Invalid target. Valid targets: {:?}", valid_targets)
        }));
    }

    let mut state = state.write().await;
    state.target = request.target.clone();

    Json(serde_json::json!({
        "success": true,
        "target": request.target
    }))
}

/// Tune optimizer parameters
async fn tune_parameters(
    State(state): State<Arc<RwLock<OptimizerState>>>,
    Json(request): Json<TuneRequest>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;

    if let Some(rate) = request.learning_rate {
        if rate > 0.0 && rate <= 1.0 {
            state.learning_rate = rate;
        }
    }

    if let Some(auto) = request.auto_tune {
        state.auto_tune = auto;
    }

    Json(serde_json::json!({
        "success": true,
        "learning_rate": state.learning_rate,
        "auto_tune": state.auto_tune
    }))
}

/// Retrain optimizer
async fn retrain(
    State(state): State<Arc<RwLock<OptimizerState>>>,
    Json(request): Json<RetrainRequest>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;

    if request.clear_history {
        state.metrics_history.clear();
    }

    // In real impl, would trigger retraining of ML model
    Json(serde_json::json!({
        "success": true,
        "message": "Retraining initiated",
        "history_cleared": request.clear_history
    }))
}

/// Record metrics sample
async fn record_metrics(
    State(state): State<Arc<RwLock<OptimizerState>>>,
    Json(metrics): Json<MetricsSample>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;
    
    state.metrics_history.push(metrics);
    
    // Keep only last 10000 samples
    if state.metrics_history.len() > 10000 {
        state.metrics_history.remove(0);
    }

    Json(serde_json::json!({
        "success": true,
        "samples_count": state.metrics_history.len()
    }))
}

/// Get parameter recommendations
#[derive(Serialize)]
pub struct Recommendations {
    pub chunk_size: usize,
    pub codec: String,
    pub threads: usize,
    pub gpu_enabled: bool,
    pub confidence: f64,
    pub reasoning: String,
}

async fn get_recommendations(
    State(state): State<Arc<RwLock<OptimizerState>>>,
) -> Json<Recommendations> {
    let state = state.read().await;
    
    // Simple heuristic-based recommendations
    let (chunk_size, codec, gpu) = match state.target.as_str() {
        "throughput" => (8 * 1024 * 1024, "lz4", true),
        "latency" => (1 * 1024 * 1024, "lz4", true),
        "memory" => (2 * 1024 * 1024, "zstd", false),
        "compression" => (4 * 1024 * 1024, "zstd", false),
        "power" => (2 * 1024 * 1024, "lz4", false),
        _ => (4 * 1024 * 1024, "zstd", false),
    };

    let confidence = if state.metrics_history.len() > 100 {
        0.9
    } else if state.metrics_history.len() > 10 {
        0.7
    } else {
        0.5
    };

    Json(Recommendations {
        chunk_size,
        codec: codec.to_string(),
        threads: num_cpus::get(),
        gpu_enabled: gpu,
        confidence,
        reasoning: format!(
            "Optimized for {} target with {} historical samples",
            state.target,
            state.metrics_history.len()
        ),
    })
}
