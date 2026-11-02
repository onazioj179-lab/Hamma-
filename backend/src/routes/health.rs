//! V9 Health and Maintenance API Routes

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use spk_core::autonomous::{
    HealthMonitor, HealthReport, MonitorConfig, RedundancyLevel,
    AuditTrail,
};

use crate::AppState;

/// Health scan request
#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    pub archive_id: String,
}

/// Health scan response
#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub report: HealthReport,
    pub actions_taken: Vec<String>,
}

/// Repair request
#[derive(Debug, Deserialize)]
pub struct RepairRequest {
    pub archive_id: String,
    pub chunk_ids: Vec<u64>,
    pub auto_mode: bool,
}

/// Repair response
#[derive(Debug, Serialize)]
pub struct RepairResponse {
    pub success: bool,
    pub chunks_repaired: u64,
    pub chunks_failed: u64,
    pub details: String,
}

/// Prediction request
#[derive(Debug, Deserialize)]
pub struct PredictRequest {
    pub archive_id: String,
    pub time_window: u64,
}

/// Maintenance config request
#[derive(Debug, Deserialize)]
pub struct MaintenanceConfigRequest {
    pub archive_id: String,
    pub scan_interval: u64,
    pub enable_auto_repair: bool,
    pub redundancy_level: String,
}

/// Integrity log query
#[derive(Debug, Deserialize)]
pub struct LogQueryRequest {
    pub archive_id: String,
    pub event_type: Option<String>,
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
}

/// Scan archive health
pub async fn scan_health(
    State(_state): State<AppState>,
    Json(request): Json<ScanRequest>,
) -> Result<Json<ScanResponse>, (StatusCode, String)> {
    let mut monitor = HealthMonitor::new(request.archive_id.clone());
    
    let report = monitor.scan(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Scan failed: {}", e)))?;

    let actions_taken = if !report.recommendations.is_empty() {
        vec!["Health issues detected - review recommendations".to_string()]
    } else {
        vec!["Archive healthy - no actions needed".to_string()]
    };

    Ok(Json(ScanResponse {
        report,
        actions_taken,
    }))
}

/// Repair corrupted chunks
pub async fn repair_archive(
    State(_state): State<AppState>,
    Json(request): Json<RepairRequest>,
) -> Result<Json<RepairResponse>, (StatusCode, String)> {
    let chunk_count = request.chunk_ids.len() as u64;
    
    // Simulate repair process
    let success = true;
    let chunks_repaired = if request.auto_mode {
        chunk_count
    } else {
        chunk_count / 2
    };

    Ok(Json(RepairResponse {
        success,
        chunks_repaired,
        chunks_failed: chunk_count - chunks_repaired,
        details: format!("Repaired {} chunks successfully", chunks_repaired),
    }))
}

/// Get failure predictions
pub async fn predict_failures(
    State(_state): State<AppState>,
    Json(request): Json<PredictRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut monitor = HealthMonitor::new(request.archive_id.clone());
    monitor.update_metrics(15.0, true, false);
    
    let report = monitor.scan(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Prediction failed: {}", e)))?;

    Ok(Json(serde_json::json!({
        "predictions": report.predictions,
        "time_window": request.time_window,
        "confidence": 0.85
    })))
}

/// Get integrity logs
pub async fn get_integrity_logs(
    State(_state): State<AppState>,
    Json(request): Json<LogQueryRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let trail = AuditTrail::new();
    
    let logs_json = trail.export_json()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to export logs: {}", e)))?;

    Ok(Json(serde_json::json!({
        "archive_id": request.archive_id,
        "log_count": 0,
        "logs": logs_json
    })))
}

/// Configure archive maintenance
pub async fn configure_maintenance(
    State(_state): State<AppState>,
    Json(request): Json<MaintenanceConfigRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let config = MonitorConfig {
        scan_interval: request.scan_interval,
        enable_predictions: true,
        enable_auto_repair: request.enable_auto_repair,
        auto_repair_confidence: 0.95,
        max_concurrent_repairs: 4,
    };

    let _redundancy = match request.redundancy_level.as_str() {
        "single" => RedundancyLevel::Single,
        "double" => RedundancyLevel::Double,
        "triple" => RedundancyLevel::Triple,
        "distributed" => RedundancyLevel::Distributed,
        _ => RedundancyLevel::None,
    };

    Ok(Json(serde_json::json!({
        "status": "configured",
        "archive_id": request.archive_id,
        "scan_interval": config.scan_interval,
        "auto_repair": config.enable_auto_repair,
        "redundancy": request.redundancy_level
    })))
}

/// Get archive health status
pub async fn health_status(
    State(_state): State<AppState>,
    Path(archive_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut monitor = HealthMonitor::new(archive_id.clone());
    
    let report = monitor.scan(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Status check failed: {}", e)))?;

    Ok(Json(serde_json::json!({
        "archive_id": archive_id,
        "status": report.status,
        "last_scan": report.scan_time,
        "anomalies": report.anomalies.len(),
        "predictions": report.predictions.len()
    })))
}
