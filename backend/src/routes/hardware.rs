//! V14 Heterogeneous Hardware API Routes

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json, Router,
    routing::{get, post},
};
use serde::Deserialize;

use spk_core::heterogeneous::HeterogeneousScheduler;

/// Hardware routes
pub fn hardware_routes() -> Router<crate::AppState> {
    Router::new()
        .route("/api/v14/hardware/list", get(list_hardware))
        .route("/api/v14/hardware/assign", post(assign_workload))
        .route("/api/v14/hardware/profile/:device_id", get(get_profile))
        .route("/api/v14/hardware/stats", get(get_stats))
        .route("/api/v14/hardware/register", post(register_device))
        .route("/api/v14/hardware/unregister/:device_id", post(unregister_device))
}

/// List all hardware
async fn list_hardware(
    State(_state): State<crate::AppState>,
) -> impl IntoResponse {
    let scheduler = HeterogeneousScheduler::default();
    scheduler.init().ok();

    match scheduler.list_devices() {
        Ok(devices) => Json(devices).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to list devices: {}", e),
        ).into_response(),
    }
}

/// Assign workload request
#[derive(Debug, Deserialize)]
pub struct AssignWorkloadRequest {
    pub operation: String,
    pub data: Vec<u8>,
    pub priority: Option<u32>,
    pub preferred_type: Option<String>,
}

/// Assign workload to hardware
async fn assign_workload(
    State(_state): State<crate::AppState>,
    Json(_request): Json<AssignWorkloadRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "workload_id": 1,
        "assigned_device": 0,
        "status": "pending"
    })).into_response()
}

/// Get hardware profile
async fn get_profile(
    State(_state): State<crate::AppState>,
    Path(device_id): Path<u32>,
) -> impl IntoResponse {
    let scheduler = HeterogeneousScheduler::default();
    scheduler.init().ok();

    match scheduler.get_device(device_id) {
        Ok(Some(device)) => Json(device).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            "Device not found",
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get device: {}", e),
        ).into_response(),
    }
}

/// Get scheduler statistics
async fn get_stats(
    State(_state): State<crate::AppState>,
) -> impl IntoResponse {
    let scheduler = HeterogeneousScheduler::default();
    
    match scheduler.stats() {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get stats: {}", e),
        ).into_response(),
    }
}

/// Register device (stub)
async fn register_device(
    State(_state): State<crate::AppState>,
) -> impl IntoResponse {
    Json(serde_json::json!({"status": "registered"})).into_response()
}

/// Unregister device (stub)
async fn unregister_device(
    State(_state): State<crate::AppState>,
    Path(_device_id): Path<u32>,
) -> impl IntoResponse {
    Json(serde_json::json!({"status": "unregistered"})).into_response()
}
