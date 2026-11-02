//! Device API routes (V8)

use axum::{
    extract::{Json, State},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Device state
pub struct DeviceState {
    pub profile: DeviceProfileInfo,
    pub thermal_state: String,
    pub power_mode: String,
    pub edge_mode: bool,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            profile: DeviceProfileInfo::detect(),
            thermal_state: "cool".to_string(),
            power_mode: "normal".to_string(),
            edge_mode: false,
        }
    }
}

/// Device profile info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceProfileInfo {
    pub device_type: String,
    pub available_memory_mb: usize,
    pub cpu_cores: usize,
    pub battery_powered: bool,
    pub battery_percent: Option<u8>,
    pub storage_type: String,
    pub network_type: String,
}

impl DeviceProfileInfo {
    pub fn detect() -> Self {
        Self {
            device_type: "desktop".to_string(),
            available_memory_mb: 4096,
            cpu_cores: num_cpus::get(),
            battery_powered: false,
            battery_percent: None,
            storage_type: "ssd".to_string(),
            network_type: "ethernet".to_string(),
        }
    }
}

/// Device capabilities response
#[derive(Serialize)]
pub struct DeviceCapabilities {
    pub profile: DeviceProfileInfo,
    pub recommended_chunk_size: usize,
    pub recommended_threads: usize,
    pub recommended_buffer_size: usize,
    pub supports_gpu: bool,
    pub supports_simd: bool,
    pub max_concurrent_ops: usize,
}

/// Thermal update request
#[derive(Deserialize)]
pub struct ThermalUpdateRequest {
    pub temperature_celsius: Option<f32>,
    pub state: Option<String>, // "cool", "warm", "hot", "critical"
}

/// Power mode request
#[derive(Deserialize)]
pub struct PowerModeRequest {
    pub mode: String, // "performance", "balanced", "power_saver", "ultra_low"
    pub battery_percent: Option<u8>,
}

/// Edge mode request
#[derive(Deserialize)]
pub struct EdgeModeRequest {
    pub enabled: bool,
    pub max_memory_mb: Option<usize>,
    pub stream_mode: Option<bool>,
}

/// Create device router
pub fn device_routes() -> Router<Arc<RwLock<DeviceState>>> {
    Router::new()
        .route("/capabilities", get(get_capabilities))
        .route("/profile", get(get_profile))
        .route("/thermal", post(update_thermal))
        .route("/power", post(set_power_mode))
        .route("/edge", post(set_edge_mode))
        .route("/config", get(get_edge_config))
}

/// Get device capabilities
async fn get_capabilities(
    State(state): State<Arc<RwLock<DeviceState>>>,
) -> Json<DeviceCapabilities> {
    let state = state.read().await;
    let profile = &state.profile;

    let (chunk_size, threads) = match profile.device_type.as_str() {
        "desktop" => (4 * 1024 * 1024, profile.cpu_cores),
        "laptop" => (2 * 1024 * 1024, profile.cpu_cores * 3 / 4),
        "tablet" => (1 * 1024 * 1024, profile.cpu_cores / 2),
        "mobile" => (512 * 1024, 2),
        "embedded" => (128 * 1024, 1),
        _ => (2 * 1024 * 1024, profile.cpu_cores),
    };

    let buffer_size = (profile.available_memory_mb * 1024 * 1024 / 8).min(256 * 1024 * 1024);

    Json(DeviceCapabilities {
        profile: profile.clone(),
        recommended_chunk_size: chunk_size,
        recommended_threads: threads.max(1),
        recommended_buffer_size: buffer_size,
        supports_gpu: profile.device_type == "desktop",
        supports_simd: true, // Most modern devices support SIMD
        max_concurrent_ops: threads.max(1),
    })
}

/// Get device profile
async fn get_profile(
    State(state): State<Arc<RwLock<DeviceState>>>,
) -> Json<DeviceProfileInfo> {
    let state = state.read().await;
    Json(state.profile.clone())
}

/// Update thermal state
async fn update_thermal(
    State(state): State<Arc<RwLock<DeviceState>>>,
    Json(request): Json<ThermalUpdateRequest>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;

    if let Some(temp) = request.temperature_celsius {
        state.thermal_state = if temp >= 75.0 {
            "critical".to_string()
        } else if temp >= 60.0 {
            "hot".to_string()
        } else if temp >= 45.0 {
            "warm".to_string()
        } else {
            "cool".to_string()
        };
    }

    if let Some(thermal_state) = request.state {
        let valid_states = ["cool", "warm", "hot", "critical"];
        if valid_states.contains(&thermal_state.as_str()) {
            state.thermal_state = thermal_state;
        }
    }

    // Calculate throttle factor
    let throttle_factor = match state.thermal_state.as_str() {
        "cool" => 1.0,
        "warm" => 0.8,
        "hot" => 0.5,
        "critical" => 0.2,
        _ => 1.0,
    };

    Json(serde_json::json!({
        "success": true,
        "thermal_state": state.thermal_state,
        "throttle_factor": throttle_factor
    }))
}

/// Set power mode
async fn set_power_mode(
    State(state): State<Arc<RwLock<DeviceState>>>,
    Json(request): Json<PowerModeRequest>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;

    let valid_modes = ["performance", "balanced", "power_saver", "ultra_low"];
    if !valid_modes.contains(&request.mode.as_str()) {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("Invalid power mode. Valid modes: {:?}", valid_modes)
        }));
    }

    state.power_mode = request.mode.clone();

    if let Some(percent) = request.battery_percent {
        state.profile.battery_percent = Some(percent);
        
        // Auto-switch to power saver if battery low
        if percent < 20 && state.power_mode != "ultra_low" {
            state.power_mode = "power_saver".to_string();
        }
    }

    let config = match state.power_mode.as_str() {
        "performance" => serde_json::json!({
            "max_threads": state.profile.cpu_cores,
            "gpu_enabled": true,
            "chunk_size": 4 * 1024 * 1024
        }),
        "balanced" => serde_json::json!({
            "max_threads": state.profile.cpu_cores * 3 / 4,
            "gpu_enabled": false,
            "chunk_size": 2 * 1024 * 1024
        }),
        "power_saver" => serde_json::json!({
            "max_threads": state.profile.cpu_cores / 2,
            "gpu_enabled": false,
            "chunk_size": 1 * 1024 * 1024
        }),
        "ultra_low" => serde_json::json!({
            "max_threads": 1,
            "gpu_enabled": false,
            "chunk_size": 256 * 1024
        }),
        _ => serde_json::json!({}),
    };

    Json(serde_json::json!({
        "success": true,
        "power_mode": state.power_mode,
        "config": config
    }))
}

/// Set edge mode
async fn set_edge_mode(
    State(state): State<Arc<RwLock<DeviceState>>>,
    Json(request): Json<EdgeModeRequest>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;
    state.edge_mode = request.enabled;

    let edge_config = if request.enabled {
        let max_memory = request.max_memory_mb.unwrap_or(64) * 1024 * 1024;
        let chunk_size = if max_memory < 128 * 1024 * 1024 {
            128 * 1024 // 128KB for very constrained
        } else {
            512 * 1024 // 512KB for edge
        };

        serde_json::json!({
            "enabled": true,
            "max_memory": max_memory,
            "chunk_size": chunk_size,
            "stream_mode": request.stream_mode.unwrap_or(true),
            "threads": 1,
            "codec": "lz4"
        })
    } else {
        serde_json::json!({
            "enabled": false
        })
    };

    Json(serde_json::json!({
        "success": true,
        "edge_mode": state.edge_mode,
        "config": edge_config
    }))
}

/// Edge configuration response
#[derive(Serialize)]
pub struct EdgeConfiguration {
    pub enabled: bool,
    pub max_memory: usize,
    pub chunk_size: usize,
    pub buffer_size: usize,
    pub threads: usize,
    pub stream_mode: bool,
    pub codec: String,
}

/// Get edge configuration
async fn get_edge_config(
    State(state): State<Arc<RwLock<DeviceState>>>,
) -> Json<EdgeConfiguration> {
    let state = state.read().await;

    let (max_memory, chunk_size, stream_mode) = if state.edge_mode {
        (64 * 1024 * 1024, 128 * 1024, true)
    } else {
        let profile = &state.profile;
        let mem = profile.available_memory_mb * 1024 * 1024 / 4;
        let chunk = match profile.device_type.as_str() {
            "mobile" => 512 * 1024,
            "embedded" => 128 * 1024,
            _ => 4 * 1024 * 1024,
        };
        (mem, chunk, false)
    };

    Json(EdgeConfiguration {
        enabled: state.edge_mode,
        max_memory,
        chunk_size,
        buffer_size: chunk_size * 4,
        threads: if state.edge_mode { 1 } else { state.profile.cpu_cores },
        stream_mode,
        codec: if state.edge_mode { "lz4".to_string() } else { "zstd".to_string() },
    })
}
