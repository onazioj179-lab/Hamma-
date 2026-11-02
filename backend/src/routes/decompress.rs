//! Decompression API routes

use std::io::Cursor;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};

use spk_core::SpkReader;

use crate::AppState;

/// Archive info response
#[derive(Debug, Serialize)]
pub struct ArchiveInfoResponse {
    pub file_count: usize,
    pub total_size: u64,
    pub compressed_size: u64,
    pub compression_ratio: f64,
    pub files: Vec<FileInfoResponse>,
}

/// File info in archive
#[derive(Debug, Serialize)]
pub struct FileInfoResponse {
    pub path: String,
    pub size: u64,
    pub permissions: u32,
    pub created: Option<u64>,
    pub modified: u64,
}

/// Decompress request
#[derive(Debug, Deserialize)]
pub struct DecompressRequest {
    pub id: String,
    pub password: Option<String>,
    pub files: Option<Vec<String>>,
}

/// Extract single file request
#[derive(Debug, Deserialize)]
pub struct ExtractFileRequest {
    pub id: String,
    pub path: String,
    pub password: Option<String>,
}

/// Preview request
#[derive(Debug, Deserialize)]
pub struct PreviewRequest {
    pub id: String,
    pub path: String,
    pub max_bytes: Option<u32>,
}

/// Get archive info
pub async fn get_archive_info(
    State(state): State<AppState>,
    Json(request): Json<DecompressRequest>,
) -> Result<Json<ArchiveInfoResponse>, (StatusCode, String)> {
    let data = state.storage.get(&request.id).await
        .ok_or((StatusCode::NOT_FOUND, "Archive not found".into()))?;

    let compressed_size = data.len() as u64;
    let cursor = Cursor::new(&data);

    let mut reader = SpkReader::new(cursor).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid archive: {}", e))
    })?;

    reader.read_manifest().map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Failed to read manifest: {}", e))
    })?;

    let manifest = reader.get_manifest()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Manifest not loaded".into()))?;
    let total_size: u64 = manifest.files.iter().map(|f| f.size).sum();

    let files: Vec<FileInfoResponse> = manifest.files.iter().map(|f| {
        FileInfoResponse {
            path: f.path.clone(),
            size: f.size,
            permissions: f.permissions,
            created: f.created,
            modified: f.modified,
        }
    }).collect();

    let compression_ratio = if total_size > 0 {
        compressed_size as f64 / total_size as f64
    } else {
        1.0
    };

    Ok(Json(ArchiveInfoResponse {
        file_count: manifest.files.len(),
        total_size,
        compressed_size,
        compression_ratio,
        files,
    }))
}

/// Decompress archive (returns all files)
pub async fn decompress_archive(
    State(state): State<AppState>,
    Json(request): Json<DecompressRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let data = state.storage.get(&request.id).await
        .ok_or((StatusCode::NOT_FOUND, "Archive not found".into()))?;

    let cursor = Cursor::new(&data);
    let mut reader = SpkReader::new(cursor).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid archive: {}", e))
    })?;

    reader.read_manifest().map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Failed to read manifest: {}", e))
    })?;

    let manifest = reader.get_manifest()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Manifest not loaded".into()))?;
    
    // Collect file paths first
    let file_paths: Vec<String> = manifest.files.iter()
        .filter(|f| !f.is_directory)
        .map(|f| f.path.clone())
        .collect();

    // Store extracted files
    let mut extracted: Vec<serde_json::Value> = Vec::new();
    
    for path in file_paths {
        let file_data = reader.extract_file(&path).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Extraction failed for {}: {}", path, e))
        })?;
        
        let file_id = uuid::Uuid::new_v4().to_string();
        state.storage.store(&file_id, file_data.clone()).await;
        
        extracted.push(serde_json::json!({
            "id": file_id,
            "path": path,
            "size": file_data.len(),
            "download_url": format!("/api/files/{}", file_id)
        }));
    }

    Ok(Json(serde_json::json!({
        "status": "success",
        "file_count": extracted.len(),
        "files": extracted
    })))
}

/// Extract single file from archive
pub async fn extract_single_file(
    State(state): State<AppState>,
    Json(request): Json<ExtractFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let data = state.storage.get(&request.id).await
        .ok_or((StatusCode::NOT_FOUND, "Archive not found".into()))?;

    let cursor = Cursor::new(&data);
    let mut reader = SpkReader::new(cursor).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid archive: {}", e))
    })?;

    let file_data = reader.extract_file(&request.path).map_err(|e| {
        (StatusCode::NOT_FOUND, format!("File not found: {}", e))
    })?;

    let file_id = uuid::Uuid::new_v4().to_string();
    let file_size = file_data.len();
    state.storage.store(&file_id, file_data).await;

    Ok(Json(serde_json::json!({
        "id": file_id,
        "path": request.path,
        "size": file_size,
        "download_url": format!("/api/files/{}", file_id)
    })))
}

/// Preview file content
pub async fn preview_file(
    State(state): State<AppState>,
    Json(request): Json<PreviewRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let data = state.storage.get(&request.id).await
        .ok_or((StatusCode::NOT_FOUND, "Archive not found".into()))?;

    let cursor = Cursor::new(&data);
    let mut reader = SpkReader::new(cursor).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid archive: {}", e))
    })?;

    reader.read_manifest().map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Failed to read manifest: {}", e))
    })?;

    // Get file info
    let manifest = reader.get_manifest()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Manifest not loaded".into()))?;
    let file_entry = manifest.files.iter()
        .find(|f| f.path == request.path)
        .ok_or((StatusCode::NOT_FOUND, "File not found in archive".into()))?
        .clone();

    // Read first chunk for preview
    let chunk_data = reader.read_chunk(file_entry.chunk_start as usize).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read chunk: {}", e))
    })?;

    let max_bytes = request.max_bytes.unwrap_or(4096) as usize;
    let preview_data = if chunk_data.len() > max_bytes {
        &chunk_data[..max_bytes]
    } else {
        &chunk_data[..]
    };

    // Determine content type
    let content_type = guess_content_type(&request.path);
    
    // Try to convert to text if it looks like text
    let preview = if content_type.starts_with("text/") || is_likely_text(preview_data) {
        serde_json::json!({
            "type": "text",
            "content": String::from_utf8_lossy(preview_data),
            "size": file_entry.size,
            "truncated": chunk_data.len() > max_bytes
        })
    } else {
        serde_json::json!({
            "type": "binary",
            "content": base64::encode(preview_data),
            "size": file_entry.size,
            "truncated": chunk_data.len() > max_bytes,
            "content_type": content_type
        })
    };

    Ok(Json(preview))
}

/// Download file
pub async fn download_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let data = state.storage.get(&id).await
        .ok_or((StatusCode::NOT_FOUND, "File not found".into()))?;

    let response = Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", id))
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(response)
}

/// Guess content type from file extension
fn guess_content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext.to_lowercase().as_str() {
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// Check if data looks like text
fn is_likely_text(data: &[u8]) -> bool {
    if data.is_empty() {
        return true;
    }
    
    // Check for BOM
    if data.starts_with(&[0xEF, 0xBB, 0xBF]) // UTF-8
        || data.starts_with(&[0xFF, 0xFE])    // UTF-16 LE
        || data.starts_with(&[0xFE, 0xFF])    // UTF-16 BE
    {
        return true;
    }

    // Check if most bytes are printable ASCII or common text bytes
    let text_chars = data.iter().filter(|&&b| {
        b == b'\n' || b == b'\r' || b == b'\t' || (b >= 0x20 && b < 0x7F)
    }).count();

    text_chars as f64 / data.len() as f64 > 0.85
}

// Base64 encoding helper
mod base64 {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn encode(data: &[u8]) -> String {
        let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
        
        for chunk in data.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
            let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
            
            let n = (b0 << 16) | (b1 << 8) | b2;
            
            result.push(CHARS[(n >> 18) as usize & 0x3F] as char);
            result.push(CHARS[(n >> 12) as usize & 0x3F] as char);
            
            if chunk.len() > 1 {
                result.push(CHARS[(n >> 6) as usize & 0x3F] as char);
            } else {
                result.push('=');
            }
            
            if chunk.len() > 2 {
                result.push(CHARS[n as usize & 0x3F] as char);
            } else {
                result.push('=');
            }
        }
        
        result
    }
}
