//! Compression API routes

use std::io::Cursor;

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use spk_core::{Codec, SpkWriter};

use crate::AppState;

/// Compression request
#[derive(Debug, Deserialize)]
pub struct CompressRequest {
    pub codec: Option<String>,
    pub level: Option<u32>,
    pub chunk_size: Option<usize>,
    pub dedup: Option<bool>,
    pub password: Option<String>,
}

/// Compression response
#[derive(Debug, Serialize)]
pub struct CompressResponse {
    pub id: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub compression_ratio: f64,
    pub file_count: usize,
    pub download_url: String,
}

/// Session info
#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub status: String,
    pub uploaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub file_count: usize,
    pub created_at: String,
}

/// Compress uploaded files
pub async fn compress_files(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<CompressResponse>, (StatusCode, String)> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut options = CompressRequest {
        codec: Some("zstd".into()),
        level: Some(3),
        chunk_size: Some(4 * 1024 * 1024),
        dedup: Some(true),
        password: None,
    };

    // Process multipart form
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Failed to read field: {}", e))
    })? {
        let name = field.name().unwrap_or("").to_string();
        
        match name.as_str() {
            "file" | "files" => {
                let filename = field.file_name().unwrap_or("unnamed").to_string();
                let data = field.bytes().await.map_err(|e| {
                    (StatusCode::BAD_REQUEST, format!("Failed to read file: {}", e))
                })?;
                files.push((filename, data.to_vec()));
            }
            "codec" => {
                let value = field.text().await.unwrap_or_default();
                options.codec = Some(value);
            }
            "level" => {
                let value = field.text().await.unwrap_or_default();
                options.level = value.parse().ok();
            }
            "password" => {
                let value = field.text().await.unwrap_or_default();
                if !value.is_empty() {
                    options.password = Some(value);
                }
            }
            _ => {}
        }
    }

    if files.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No files provided".into()));
    }
    if options.password.is_some() {
        return Err((StatusCode::NOT_IMPLEMENTED, "Password-protected archive creation is not implemented; no archive was created".into()));
    }

    // Calculate original size
    let original_size: u64 = files.iter().map(|(_, d)| d.len() as u64).sum();
    let file_count = files.len();

    // Initialize EnhancedPipeline for HAMMA learning
    let temp_dir = std::env::temp_dir().join(format!("spk-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).ok();
    let pipeline_config = spk_core::EnhancedPipelineConfig::default();
    let mut pipeline = spk_core::EnhancedPipeline::new(&temp_dir, pipeline_config)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Pipeline init failed: {}", e)))?;

    // Process files through enhanced pipeline for learning
    for (filename, data) in &files {
        let cluster = spk_core::FileCluster::from_extension(
            std::path::Path::new(filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
        );
        let _ = pipeline.process_chunk(data, cluster);
    }
    
    // Persist HAMMA state and store pipeline
    pipeline.persist().ok();
    state.storage.set_pipeline(pipeline).await;

    // Get codec for logging (writer handles its own codec selection)
    let _codec_name = options.codec.as_deref().unwrap_or("zstd");

    let mut output = Vec::new();
    {
        let cursor = Cursor::new(&mut output);
        let mut writer = SpkWriter::new(cursor).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create writer: {}", e))
        })?;

        // Set codec if specified
        match options.codec.as_deref() {
            Some("lz4") => writer.set_codec(Codec::Lz4),
            Some("brotli") => writer.set_codec(Codec::Brotli),
            Some("none") => writer.set_codec(Codec::None),
            _ => writer.set_codec(Codec::Zstd),
        }

        for (name, data) in &files {
            let reader = Cursor::new(data);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            writer.add_file_from_reader(reader, name.clone(), data.len() as u64, 0o644, now).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to add file: {}", e))
            })?;
        }

        writer.finish().map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to finish: {}", e))
        })?;
    }

    let compressed_size = output.len() as u64;
    let compression_ratio = if original_size > 0 {
        compressed_size as f64 / original_size as f64
    } else {
        1.0
    };

    // Store compressed file
    let id = Uuid::new_v4().to_string();
    state.storage.store(&id, output).await;

    Ok(Json(CompressResponse {
        id: id.clone(),
        original_size,
        compressed_size,
        compression_ratio,
        file_count,
        download_url: format!("/api/files/{}", id),
    }))
}

/// Stream compression for large files
pub async fn compress_stream(
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // For streaming, we use chunked transfer encoding
    // This is a placeholder - real implementation would use async streams
    compress_files(State(state), multipart).await
}

/// Create compression session
pub async fn create_session(
    State(state): State<AppState>,
    Json(request): Json<CompressRequest>,
) -> Result<Json<SessionInfo>, (StatusCode, String)> {
    if request.password.is_some() {
        return Err((StatusCode::NOT_IMPLEMENTED, "Password-protected sessions are not implemented".into()));
    }
    let id = Uuid::new_v4().to_string();
    
    state.storage.create_session(&id).await;
    
    Ok(Json(SessionInfo {
        id: id.clone(),
        status: "created".into(),
        uploaded_bytes: 0,
        total_bytes: None,
        file_count: 0,
        created_at: chrono::Utc::now().to_rfc3339(),
    }))
}

/// Upload chunk to session
pub async fn upload_chunk(
    State(state): State<AppState>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Verify session exists
    if !state.storage.session_exists(&id).await {
        return Err((StatusCode::NOT_FOUND, "Session not found".into()));
    }

    let mut bytes_uploaded = 0u64;
    
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Failed to read field: {}", e))
    })? {
        if field.name() == Some("chunk") {
            let data = field.bytes().await.map_err(|e| {
                (StatusCode::BAD_REQUEST, format!("Failed to read chunk: {}", e))
            })?;
            
            let chunk_len = data.len() as u64;
            if !state.storage.append_to_session(&id, data.to_vec()).await {
                return Err((StatusCode::CONFLICT, "Session is paused or no longer active".into()));
            }
            bytes_uploaded += chunk_len;
        }
    }

    Ok(Json(serde_json::json!({
        "bytes_uploaded": bytes_uploaded,
        "status": "ok"
    })))
}

/// Finalize compression session
pub async fn finalize_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CompressResponse>, (StatusCode, String)> {
    if !state.storage.session_exists(&id).await {
        return Err((StatusCode::NOT_FOUND, "Session not found".into()));
    }

    let session_data = state.storage.get_session_data(&id).await
        .ok_or((StatusCode::NOT_FOUND, "Session data not found".into()))?;

    let original_size = session_data.len() as u64;
    let mut output = Vec::new();
    {
        let mut writer = SpkWriter::new(Cursor::new(&mut output)).map_err(|error| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create session archive: {}", error))
        })?;
        writer.add_file_from_reader(Cursor::new(&session_data), "session.bin".into(), original_size, 0o644, 0)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to archive session: {}", error)))?;
        writer.finish().map_err(|error| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to finish session archive: {}", error))
        })?;
    }
    let compressed_size = output.len() as u64;

    state.storage.store(&id, output).await;
    state.storage.delete_session(&id).await;

    Ok(Json(CompressResponse {
        id: id.clone(),
        original_size,
        compressed_size,
        compression_ratio: if original_size == 0 { 1.0 } else { compressed_size as f64 / original_size as f64 },
        file_count: 1,
        download_url: format!("/api/files/{}", id),
    }))
}

/// Get session status
pub async fn session_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SessionInfo>, (StatusCode, String)> {
    if !state.storage.session_exists(&id).await {
        return Err((StatusCode::NOT_FOUND, "Session not found".into()));
    }

    let info = state.storage.get_session_info(&id).await
        .ok_or((StatusCode::NOT_FOUND, "Session info not found".into()))?;

    Ok(Json(info))
}

/// Pause session
pub async fn pause_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !state.storage.session_exists(&id).await {
        return Err((StatusCode::NOT_FOUND, "Session not found".into()));
    }

    state.storage.pause_session(&id).await;

    Ok(Json(serde_json::json!({
        "status": "paused"
    })))
}

/// Resume session
pub async fn resume_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !state.storage.session_exists(&id).await {
        return Err((StatusCode::NOT_FOUND, "Session not found".into()));
    }

    state.storage.resume_session(&id).await;

    Ok(Json(serde_json::json!({
        "status": "active"
    })))
}

/// Upload single file
pub async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Failed to read field: {}", e))
    })? {
        if field.name() == Some("file") {
            let filename = field.file_name().unwrap_or("unnamed").to_string();
            let data = field.bytes().await.map_err(|e| {
                (StatusCode::BAD_REQUEST, format!("Failed to read file: {}", e))
            })?;
            
            let id = Uuid::new_v4().to_string();
            state.storage.store(&id, data.to_vec()).await;
            
            return Ok(Json(serde_json::json!({
                "id": id,
                "filename": filename,
                "size": data.len()
            })));
        }
    }

    Err((StatusCode::BAD_REQUEST, "No file provided".into()))
}
