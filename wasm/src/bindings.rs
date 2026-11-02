//! WASM Bindings for SPK Operations
//!
//! High-level JavaScript API for compression and decompression.

use std::io::Cursor;
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, Reflect, Uint8Array};
use serde::{Deserialize, Serialize};

// Re-export core types
use spk_core::{
    Codec,
    SpkWriter, SpkReader,
};

/// Compression options from JavaScript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressOptions {
    /// Compression codec: "zstd", "lz4", "brotli", "none"
    pub codec: String,
    /// Compression level (1-22 for zstd, 1-12 for lz4/brotli)
    pub level: u32,
    /// Chunk size in bytes
    pub chunk_size: usize,
    /// Enable deduplication
    pub dedup: bool,
    /// Password for encryption (optional)
    pub password: Option<String>,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            codec: "zstd".to_string(),
            level: 3,
            chunk_size: 4 * 1024 * 1024, // 4MB
            dedup: true,
            password: None,
        }
    }
}

/// Decompression options from JavaScript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecompressOptions {
    /// Password for decryption (if encrypted)
    pub password: Option<String>,
    /// Files to extract (empty = all)
    pub files: Vec<String>,
    /// Verify integrity after extraction
    pub verify: bool,
}

impl Default for DecompressOptions {
    fn default() -> Self {
        Self {
            password: None,
            files: Vec::new(),
            verify: true,
        }
    }
}

/// Progress callback type
pub type ProgressCallback = js_sys::Function;

/// File entry for JavaScript
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct JsFileEntry {
    name: String,
    data: Vec<u8>,
}

#[wasm_bindgen]
impl JsFileEntry {
    #[wasm_bindgen(constructor)]
    pub fn new(name: String, data: Uint8Array) -> Self {
        Self {
            name,
            data: data.to_vec(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Uint8Array {
        Uint8Array::from(&self.data[..])
    }

    #[wasm_bindgen(getter)]
    pub fn size(&self) -> usize {
        self.data.len()
    }
}

/// SPK Compressor for WASM
#[wasm_bindgen]
pub struct SpkCompressor {
    config: CompressOptions,
    files: Vec<JsFileEntry>,
}

#[wasm_bindgen]
impl SpkCompressor {
    /// Create new compressor with default options
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            config: CompressOptions::default(),
            files: Vec::new(),
        }
    }

    /// Create compressor with options
    #[wasm_bindgen(js_name = withOptions)]
    pub fn with_options(options: JsValue) -> Result<SpkCompressor, JsValue> {
        let config: CompressOptions = serde_wasm_bindgen::from_value(options)
            .map_err(|e| JsValue::from_str(&format!("Invalid options: {}", e)))?;
        
        Ok(Self {
            config,
            files: Vec::new(),
        })
    }

    /// Set compression codec
    #[wasm_bindgen(js_name = setCodec)]
    pub fn set_codec(&mut self, codec: &str) {
        self.config.codec = codec.to_string();
    }

    /// Set compression level
    #[wasm_bindgen(js_name = setLevel)]
    pub fn set_level(&mut self, level: u32) {
        self.config.level = level;
    }

    /// Enable/disable deduplication
    #[wasm_bindgen(js_name = setDedup)]
    pub fn set_dedup(&mut self, enabled: bool) {
        self.config.dedup = enabled;
    }

    /// Set encryption password
    #[wasm_bindgen(js_name = setPassword)]
    pub fn set_password(&mut self, password: &str) {
        self.config.password = Some(password.to_string());
    }

    /// Add file to archive
    #[wasm_bindgen(js_name = addFile)]
    pub fn add_file(&mut self, name: &str, data: Uint8Array) {
        self.files.push(JsFileEntry {
            name: name.to_string(),
            data: data.to_vec(),
        });
    }

    /// Get number of files added
    #[wasm_bindgen(js_name = fileCount)]
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    /// Compress all added files
    #[wasm_bindgen]
    pub fn compress(&self) -> Result<Uint8Array, JsValue> {
        let mut output = Vec::new();

        let codec = match self.config.codec.as_str() {
            "zstd" => Codec::Zstd,
            "lz4" => Codec::Lz4,
            "brotli" => Codec::Brotli,
            "none" => Codec::None,
            _ => Codec::Zstd,
        };

        {
            let cursor = Cursor::new(&mut output);
            let mut writer = SpkWriter::new(cursor)
                .map_err(|e| JsValue::from_str(&format!("Failed to create writer: {}", e)))?;

            writer.set_codec(codec);

            for file in &self.files {
                let data_cursor = Cursor::new(&file.data);
                let modified = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                    
                writer.add_file_from_reader(
                    data_cursor,
                    file.name.clone(),
                    file.data.len() as u64,
                    0o644,
                    modified
                ).map_err(|e| JsValue::from_str(&format!("Failed to add file: {}", e)))?;
            }

            writer.finish()
                .map_err(|e| JsValue::from_str(&format!("Failed to finish: {}", e)))?;
        }

        Ok(Uint8Array::from(&output[..]))
    }

    /// Compress with progress callback
    #[wasm_bindgen(js_name = compressWithProgress)]
    pub fn compress_with_progress(&self, callback: &ProgressCallback) -> Result<Uint8Array, JsValue> {
        let total_size: usize = self.files.iter().map(|f| f.data.len()).sum();
        let mut processed = 0usize;

        let mut output = Vec::new();

        let codec = match self.config.codec.as_str() {
            "zstd" => Codec::Zstd,
            "lz4" => Codec::Lz4,
            "brotli" => Codec::Brotli,
            "none" => Codec::None,
            _ => Codec::Zstd,
        };

        {
            let cursor = Cursor::new(&mut output);
            let mut writer = SpkWriter::new(cursor)
                .map_err(|e| JsValue::from_str(&format!("Failed to create writer: {}", e)))?;

            writer.set_codec(codec);

            for file in &self.files {
                let data_cursor = Cursor::new(&file.data);
                let modified = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                    
                writer.add_file_from_reader(
                    data_cursor,
                    file.name.clone(),
                    file.data.len() as u64,
                    0o644,
                    modified
                ).map_err(|e| JsValue::from_str(&format!("Failed to add file: {}", e)))?;
                
                processed += file.data.len();
                let progress = (processed as f64 / total_size as f64) * 100.0;
                
                let this = JsValue::null();
                let _ = callback.call2(&this, &JsValue::from(progress), &JsValue::from(&file.name));
            }

            writer.finish()
                .map_err(|e| JsValue::from_str(&format!("Failed to finish: {}", e)))?;
        }

        Ok(Uint8Array::from(&output[..]))
    }

    /// Clear all files
    pub fn clear(&mut self) {
        self.files.clear();
    }
}

impl Default for SpkCompressor {
    fn default() -> Self {
        Self::new()
    }
}

/// SPK Decompressor for WASM
#[wasm_bindgen]
pub struct SpkDecompressor {
    config: DecompressOptions,
}

#[wasm_bindgen]
impl SpkDecompressor {
    /// Create new decompressor
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            config: DecompressOptions::default(),
        }
    }

    /// Create with options
    #[wasm_bindgen(js_name = withOptions)]
    pub fn with_options(options: JsValue) -> Result<SpkDecompressor, JsValue> {
        let config: DecompressOptions = serde_wasm_bindgen::from_value(options)
            .map_err(|e| JsValue::from_str(&format!("Invalid options: {}", e)))?;
        
        Ok(Self { config })
    }

    /// Set decryption password
    #[wasm_bindgen(js_name = setPassword)]
    pub fn set_password(&mut self, password: &str) {
        self.config.password = Some(password.to_string());
    }

    /// Get archive info without extracting
    #[wasm_bindgen(js_name = getInfo)]
    pub fn get_info(&self, data: Uint8Array) -> Result<JsValue, JsValue> {
        let bytes = data.to_vec();
        let cursor = Cursor::new(&bytes);

        let mut reader = SpkReader::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to open archive: {}", e)))?;

        let manifest = reader.read_manifest()
            .map_err(|e| JsValue::from_str(&format!("Failed to read manifest: {}", e)))?;
        let info = ArchiveInfo {
            file_count: manifest.files.len(),
            total_size: manifest.files.iter().map(|f| f.size).sum(),
            compressed_size: bytes.len() as u64,
            files: manifest.files.iter().map(|f| FileInfo {
                path: f.path.clone(),
                size: f.size,
                permissions: f.permissions,
            }).collect(),
        };

        serde_wasm_bindgen::to_value(&info)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// List files in archive
    #[wasm_bindgen(js_name = listFiles)]
    pub fn list_files(&self, data: Uint8Array) -> Result<Array, JsValue> {
        let bytes = data.to_vec();
        let cursor = Cursor::new(&bytes);

        let mut reader = SpkReader::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to open archive: {}", e)))?;

        let manifest = reader.read_manifest()
            .map_err(|e| JsValue::from_str(&format!("Failed to read manifest: {}", e)))?;
        let arr = Array::new();
        
        for file in &manifest.files {
            arr.push(&JsValue::from(&file.path));
        }

        Ok(arr)
    }

    /// Extract all files
    #[wasm_bindgen]
    pub fn decompress(&self, data: Uint8Array) -> Result<Array, JsValue> {
        let bytes = data.to_vec();
        let cursor = Cursor::new(&bytes);

        let mut reader = SpkReader::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to open archive: {}", e)))?;

        // Read manifest to get file list
        let manifest = reader.read_manifest()
            .map_err(|e| JsValue::from_str(&format!("Failed to read manifest: {}", e)))?;
        let file_paths: Vec<String> = manifest.files.iter().map(|f| f.path.clone()).collect();

        let arr = Array::new();
        for path in file_paths {
            let file_data = reader.extract_file(&path)
                .map_err(|e| JsValue::from_str(&format!("Extraction failed: {}", e)))?;
            let obj = Object::new();
            Reflect::set(&obj, &"path".into(), &JsValue::from(&path))?;
            Reflect::set(&obj, &"data".into(), &Uint8Array::from(&file_data[..]))?;
            arr.push(&obj);
        }

        Ok(arr)
    }

    /// Extract single file
    #[wasm_bindgen(js_name = extractFile)]
    pub fn extract_file(&self, data: Uint8Array, path: &str) -> Result<Uint8Array, JsValue> {
        let bytes = data.to_vec();
        let cursor = Cursor::new(&bytes);

        let mut reader = SpkReader::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to open archive: {}", e)))?;

        let file_data = reader.extract_file(path)
            .map_err(|e| JsValue::from_str(&format!("Extraction failed: {}", e)))?;

        Ok(Uint8Array::from(&file_data[..]))
    }

    /// Extract with progress callback
    #[wasm_bindgen(js_name = decompressWithProgress)]
    pub fn decompress_with_progress(&self, data: Uint8Array, callback: &ProgressCallback) -> Result<Array, JsValue> {
        let bytes = data.to_vec();
        let cursor = Cursor::new(&bytes);

        let mut reader = SpkReader::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to open archive: {}", e)))?;

        let manifest = reader.read_manifest()
            .map_err(|e| JsValue::from_str(&format!("Failed to read manifest: {}", e)))?;
        let file_entries: Vec<_> = manifest.files.iter().cloned().collect();
        let total_files = file_entries.len();

        let arr = Array::new();
        
        for (idx, file_entry) in file_entries.iter().enumerate() {
            let file_data = reader.extract_file(&file_entry.path)
                .map_err(|e| JsValue::from_str(&format!("Extraction failed: {}", e)))?;

            let obj = Object::new();
            Reflect::set(&obj, &"path".into(), &JsValue::from(&file_entry.path))?;
            Reflect::set(&obj, &"data".into(), &Uint8Array::from(&file_data[..]))?;
            arr.push(&obj);

            let progress = ((idx + 1) as f64 / total_files as f64) * 100.0;
            let this = JsValue::null();
            let _ = callback.call2(&this, &JsValue::from(progress), &JsValue::from(&file_entry.path));
        }

        Ok(arr)
    }

    /// Get preview of file (for V3)
    #[wasm_bindgen(js_name = previewFile)]
    pub fn preview_file(&self, data: Uint8Array, path: &str, max_bytes: u32) -> Result<Uint8Array, JsValue> {
        let bytes = data.to_vec();
        let cursor = Cursor::new(&bytes);

        let mut reader = SpkReader::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("Failed to open archive: {}", e)))?;

        // Get file info to determine chunk range
        let manifest = reader.read_manifest()
            .map_err(|e| JsValue::from_str(&format!("Failed to read manifest: {}", e)))?;
        let file_entry = manifest.files.iter()
            .find(|f| f.path == path)
            .ok_or_else(|| JsValue::from_str(&format!("File not found: {}", path)))?
            .clone();

        // For preview, we read only the first chunk
        let chunk_data = reader.read_chunk(file_entry.chunk_start as usize)
            .map_err(|e| JsValue::from_str(&format!("Failed to read chunk: {}", e)))?;

        let preview_data = if chunk_data.len() > max_bytes as usize {
            &chunk_data[..max_bytes as usize]
        } else {
            &chunk_data[..]
        };

        Ok(Uint8Array::from(preview_data))
    }
}

impl Default for SpkDecompressor {
    fn default() -> Self {
        Self::new()
    }
}

/// Archive info for JavaScript
#[derive(Serialize, Deserialize)]
pub struct ArchiveInfo {
    pub file_count: usize,
    pub total_size: u64,
    pub compressed_size: u64,
    pub files: Vec<FileInfo>,
}

/// File info for JavaScript
#[derive(Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub permissions: u32,
}

/// Stream processor for large files
#[wasm_bindgen]
pub struct StreamProcessor {
    chunk_size: usize,
}

#[wasm_bindgen]
impl StreamProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(chunk_size: usize) -> Self {
        Self { chunk_size }
    }

    /// Process a chunk (compress)
    #[wasm_bindgen(js_name = compressChunk)]
    pub fn compress_chunk(&self, data: Uint8Array, codec: &str, level: u32) -> Result<Uint8Array, JsValue> {
        let bytes = data.to_vec();
        
        let codec_type = match codec {
            "zstd" => Codec::Zstd,
            "lz4" => Codec::Lz4,
            "brotli" => Codec::Brotli,
            _ => Codec::None,
        };

        let compression_level = match level {
            0..=3 => spk_core::CompressionLevel::Fast,
            4..=6 => spk_core::CompressionLevel::Normal,
            7..=9 => spk_core::CompressionLevel::Best,
            _ => spk_core::CompressionLevel::Best,
        };

        let compressed = spk_core::codec::compress(&bytes, codec_type, compression_level)
            .map_err(|e| JsValue::from_str(&format!("Compression failed: {}", e)))?;

        Ok(Uint8Array::from(&compressed[..]))
    }

    /// Process a chunk (decompress)
    #[wasm_bindgen(js_name = decompressChunk)]
    pub fn decompress_chunk(&self, data: Uint8Array, codec: &str) -> Result<Uint8Array, JsValue> {
        let bytes = data.to_vec();
        
        let codec_type = match codec {
            "zstd" => Codec::Zstd,
            "lz4" => Codec::Lz4,
            "brotli" => Codec::Brotli,
            _ => Codec::None,
        };

        let decompressed = spk_core::codec::decompress(&bytes, codec_type, None)
            .map_err(|e| JsValue::from_str(&format!("Decompression failed: {}", e)))?;

        Ok(Uint8Array::from(&decompressed[..]))
    }
}

// Utility functions

use spk_core::utils::hashing::{sha256_hash, crc32_checksum};

/// Convert bytes to hex string
fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Calculate SHA-256 hash
#[wasm_bindgen(js_name = sha256)]
pub fn sha256(data: Uint8Array) -> String {
    let bytes = data.to_vec();
    let hash = sha256_hash(&bytes);
    bytes_to_hex(&hash)
}

/// Calculate CRC32 hash
#[wasm_bindgen]
pub fn crc32(data: Uint8Array) -> u32 {
    let bytes = data.to_vec();
    crc32_checksum(&bytes)
}

/// Format file size
#[wasm_bindgen(js_name = formatSize)]
pub fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compress_options_default() {
        let opts = CompressOptions::default();
        assert_eq!(opts.codec, "zstd");
        assert_eq!(opts.level, 3);
        assert!(opts.dedup);
    }
}
