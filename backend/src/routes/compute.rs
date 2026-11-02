use axum::{routing::{get, post}, Router, Json};
use axum::extract::State;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose};

use crate::AppState;
use spk_core::{
    ComputeManager, RegisteredFunction, ArchivePipeline,
    PipelineStep, ComputeHookKind
};

#[derive(Clone)]
pub struct ComputeState {
    pub manager: ComputeManager,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub id: String,
    pub description: String,
    pub wasm_base64: String,
    pub signatures: Vec<String>,
}

#[derive(Deserialize)]
pub struct RunRequest {
    pub archive_id: String,
    pub func_id: String,
    pub data_base64: String,
}

#[derive(Deserialize)]
pub struct PipelineRequest {
    pub archive_id: String,
    pub steps: Vec<PipelineStepDto>,
}

#[derive(Deserialize, Serialize)]
pub struct PipelineStepDto {
    pub func_id: String,
    pub hook: Option<String>,
}

#[derive(Serialize)]
pub struct RunResponse {
    pub result_base64: String,
}

pub fn compute_routes() -> Router<AppState> {
    Router::new()
        .route("/compute/register", post(register))
        .route("/compute/run", post(run))
        .route("/compute/pipeline", post(pipeline))
        .route("/compute/sandbox", get(sandbox_info))
        .route("/compute/logs", get(get_logs))
}

async fn register(State(state): State<AppState>, Json(req): Json<RegisterRequest>) -> Json<Result<String, String>> {
    let wasm_bytes = match general_purpose::STANDARD.decode(req.wasm_base64) {
        Ok(b) => b,
        Err(e) => return Json(Err(format!("invalid wasm_base64: {e}")))
    };
    let signatures: Vec<Vec<u8>> = req.signatures.into_iter().filter_map(|s| general_purpose::STANDARD.decode(s).ok()).collect();
    let func = RegisteredFunction { 
        id: req.id, 
        description: req.description, 
        wasm_bytes, 
        signatures,
        verified_signatures: vec![],
    };
    let mut mgr = state.compute.write().unwrap();
    match mgr.manager.registry.register(func) {
        Ok(()) => Json(Ok("registered".into())),
        Err(e) => Json(Err(e.to_string()))
    }
}

async fn run(State(state): State<AppState>, Json(req): Json<RunRequest>) -> Json<Result<RunResponse, String>> {
    let data = match general_purpose::STANDARD.decode(req.data_base64) {
        Ok(b) => b,
        Err(e) => return Json(Err(format!("invalid data_base64: {e}")))
    };
    let mut mgr = state.compute.write().unwrap();
    match mgr.manager.trigger_hook(&req.archive_id, ComputeHookKind::OnIngest, &data) {
        Ok(out) => Json(Ok(RunResponse { result_base64: general_purpose::STANDARD.encode(out) })),
        Err(e) => Json(Err(e.to_string()))
    }
}

async fn pipeline(State(state): State<AppState>, Json(req): Json<PipelineRequest>) -> Json<Result<String, String>> {
    let steps: Vec<PipelineStep> = req.steps.into_iter().map(|s| PipelineStep {
        func_id: s.func_id,
        hook: s.hook.and_then(|h| match h.as_str() {
            "read" => Some(ComputeHookKind::OnRead),
            "write" => Some(ComputeHookKind::OnWrite),
            "repair" => Some(ComputeHookKind::OnRepair),
            "ingest" => Some(ComputeHookKind::OnIngest),
            _ => None,
        })
    }).collect();
    let mut mgr = state.compute.write().unwrap();
    match mgr.manager.attach_pipeline(&req.archive_id, ArchivePipeline { steps }) {
        Ok(()) => Json(Ok("pipeline attached".into())),
        Err(e) => Json(Err(e.to_string()))
    }
}

async fn sandbox_info(State(state): State<AppState>) -> Json<Result<String, String>> {
    let mgr = state.compute.read().unwrap();
    Json(Ok(format!("sandbox limits: mem={} time_ms={} functions={}", spk_core::V20_MAX_SANDBOX_MEMORY, spk_core::V20_MAX_EXECUTION_MS, mgr.manager.registry.list().len())))
}

async fn get_logs(State(state): State<AppState>) -> Json<Result<Vec<String>, String>> {
    let mgr = state.compute.read().unwrap();
    Json(Ok(mgr.manager.logs(100)))
}
