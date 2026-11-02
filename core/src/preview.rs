//! SPK V3 Preview Mode
//!
//! Generate previews for files without full extraction.

use std::io::{Read, Seek};

use crate::manifest::FileEntry;
use crate::reader::SpkReader;
use crate::types::manifest_structs::{PreviewMetadata, PreviewType};
use crate::utils::error::{SpkError, SpkResult};

/// Maximum preview size for text files
pub const TEXT_PREVIEW_SIZE: usize = 4096;

/// Maximum thumbnail dimension
pub const THUMBNAIL_MAX_DIM: u32 = 256;

/// Preview generator
pub struct PreviewGenerator<R: Read + Seek> {
    reader: SpkReader<R>,
}

impl<R: Read + Seek> PreviewGenerator<R> {
    /// Create a new preview generator
    pub fn new(reader: SpkReader<R>) -> Self {
        Self { reader }
    }

    /// Generate preview for a file
    pub fn generate_preview(&mut self, path: &str) -> SpkResult<PreviewMetadata> {
        // Get file entry
        let entry = self.reader.get_file(path)?
            .ok_or_else(|| SpkError::PreviewNotAvailable(format!("File not found: {}", path)))?
            .clone();

        // Determine preview type based on extension/content
        let mime_type = guess_mime_type(&entry.path);
        let preview_type = determine_preview_type(&mime_type);

        match preview_type {
            PreviewType::TextPreview => self.generate_text_preview(&entry, &mime_type),
            PreviewType::Thumbnail => self.generate_thumbnail_preview(&entry, &mime_type),
            PreviewType::Icon => self.generate_icon_preview(&entry, &mime_type),
            PreviewType::None => Ok(PreviewMetadata {
                mime_type,
                preview_data: Vec::new(),
                preview_type: PreviewType::None,
                dimensions: None,
            }),
        }
    }

    /// Generate text preview (first N bytes)
    fn generate_text_preview(&mut self, entry: &FileEntry, mime_type: &str) -> SpkResult<PreviewMetadata> {
        // Read only the first chunk (or less)
        let preview_size = entry.size.min(TEXT_PREVIEW_SIZE as u64) as usize;
        
        if entry.chunk_count == 0 {
            return Ok(PreviewMetadata {
                mime_type: mime_type.to_string(),
                preview_data: Vec::new(),
                preview_type: PreviewType::TextPreview,
                dimensions: None,
            });
        }

        // Read first chunk
        let first_chunk = self.reader.read_chunk(entry.chunk_start as usize)?;
        let preview_data = first_chunk[..preview_size.min(first_chunk.len())].to_vec();

        // Try to decode as UTF-8
        let preview_data = if let Ok(text) = String::from_utf8(preview_data.clone()) {
            text.into_bytes()
        } else {
            // Binary content, show hex preview
            preview_data.iter()
                .take(256)
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(" ")
                .into_bytes()
        };

        Ok(PreviewMetadata {
            mime_type: mime_type.to_string(),
            preview_data,
            preview_type: PreviewType::TextPreview,
            dimensions: None,
        })
    }

    /// Generate thumbnail preview (stub - would need image processing)
    fn generate_thumbnail_preview(&mut self, entry: &FileEntry, mime_type: &str) -> SpkResult<PreviewMetadata> {
        // For actual implementation, would extract and resize image
        // For now, just return file header bytes
        
        if entry.chunk_count == 0 {
            return Ok(PreviewMetadata {
                mime_type: mime_type.to_string(),
                preview_data: Vec::new(),
                preview_type: PreviewType::Thumbnail,
                dimensions: None,
            });
        }

        let first_chunk = self.reader.read_chunk(entry.chunk_start as usize)?;
        
        // Return first 1KB as preview data (would be actual thumbnail in real impl)
        let preview_data = first_chunk[..1024.min(first_chunk.len())].to_vec();

        Ok(PreviewMetadata {
            mime_type: mime_type.to_string(),
            preview_data,
            preview_type: PreviewType::Thumbnail,
            dimensions: Some((THUMBNAIL_MAX_DIM, THUMBNAIL_MAX_DIM)),
        })
    }

    /// Generate icon preview based on file type
    fn generate_icon_preview(&mut self, entry: &FileEntry, mime_type: &str) -> SpkResult<PreviewMetadata> {
        // Return icon identifier based on file type
        let icon_id = match mime_type.split('/').next() {
            Some("text") => "icon-text",
            Some("image") => "icon-image",
            Some("video") => "icon-video",
            Some("audio") => "icon-audio",
            Some("application") => {
                if mime_type.contains("zip") || mime_type.contains("archive") {
                    "icon-archive"
                } else if mime_type.contains("pdf") {
                    "icon-pdf"
                } else {
                    "icon-binary"
                }
            }
            _ => if entry.is_directory { "icon-folder" } else { "icon-file" },
        };

        Ok(PreviewMetadata {
            mime_type: mime_type.to_string(),
            preview_data: icon_id.as_bytes().to_vec(),
            preview_type: PreviewType::Icon,
            dimensions: None,
        })
    }

    /// Get file info without extracting
    pub fn get_file_info(&mut self, path: &str) -> SpkResult<FileInfo> {
        let entry = self.reader.get_file(path)?
            .ok_or_else(|| SpkError::PreviewNotAvailable(format!("File not found: {}", path)))?
            .clone();

        let mime = guess_mime_type(&entry.path);
        let compressed_size = self.calculate_compressed_size(&entry)?;
        
        Ok(FileInfo {
            path: entry.path,
            size: entry.size,
            compressed_size,
            modified: entry.modified,
            permissions: entry.permissions,
            is_directory: entry.is_directory,
            is_symlink: entry.is_symlink,
            mime_type: mime,
            content_hash: entry.content_hash,
        })
    }

    /// Calculate compressed size for a file
    fn calculate_compressed_size(&mut self, entry: &FileEntry) -> SpkResult<u64> {
        self.reader.read_chunk_table()?;
        
        let mut total = 0u64;
        for i in 0..entry.chunk_count {
            if let Some(chunk) = self.reader.read_chunk_table()?.get((entry.chunk_start + i as u64) as usize) {
                total += chunk.compressed_size as u64;
            }
        }
        
        Ok(total)
    }

    /// List files matching a pattern
    pub fn find_files(&mut self, pattern: &str) -> SpkResult<Vec<FileInfo>> {
        let manifest = self.reader.read_manifest()?;
        let mut results = Vec::new();

        for entry in &manifest.files {
            if pattern_matches(pattern, &entry.path) {
                results.push(FileInfo {
                    path: entry.path.clone(),
                    size: entry.size,
                    compressed_size: 0, // Would calculate if needed
                    modified: entry.modified,
                    permissions: entry.permissions,
                    is_directory: entry.is_directory,
                    is_symlink: entry.is_symlink,
                    mime_type: guess_mime_type(&entry.path),
                    content_hash: entry.content_hash.clone(),
                });
            }
        }

        Ok(results)
    }
}

/// File information for preview
#[derive(Debug, Clone)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub compressed_size: u64,
    pub modified: u64,
    pub permissions: u32,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub mime_type: String,
    pub content_hash: String,
}

impl FileInfo {
    pub fn compression_ratio(&self) -> f64 {
        if self.size == 0 {
            1.0
        } else {
            self.compressed_size as f64 / self.size as f64
        }
    }
}

/// Guess MIME type from file path
fn guess_mime_type(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    
    match ext.as_str() {
        // Text
        "txt" => "text/plain",
        "md" => "text/markdown",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "text/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "yaml" | "yml" => "text/yaml",
        
        // Code
        "rs" => "text/x-rust",
        "py" => "text/x-python",
        "java" => "text/x-java",
        "c" | "h" => "text/x-c",
        "cpp" | "hpp" | "cc" => "text/x-c++",
        "ts" => "text/typescript",
        "go" => "text/x-go",
        
        // Images
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        
        // Audio/Video
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        
        // Archives
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "bz2" => "application/x-bzip2",
        "xz" => "application/x-xz",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/x-rar-compressed",
        "spk" => "application/x-spk",
        
        // Documents
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        
        // Binary
        "exe" => "application/x-msdownload",
        "dll" => "application/x-msdownload",
        "so" => "application/x-sharedlib",
        "bin" => "application/octet-stream",
        
        _ => "application/octet-stream",
    }.to_string()
}

/// Determine preview type based on MIME type
fn determine_preview_type(mime_type: &str) -> PreviewType {
    if mime_type.starts_with("text/") || mime_type == "application/json" 
        || mime_type == "application/xml" || mime_type == "text/yaml" {
        PreviewType::TextPreview
    } else if mime_type.starts_with("image/") {
        PreviewType::Thumbnail
    } else {
        PreviewType::Icon
    }
}

/// Simple pattern matching (case-insensitive)
fn pattern_matches(pattern: &str, text: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let text = text.to_lowercase();
    
    if pattern.is_empty() {
        return true;
    }
    
    if !pattern.contains('*') && !pattern.contains('?') {
        return text.contains(&pattern);
    }
    
    // Simple glob-like matching
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut pos = 0;
    
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        
        if let Some(idx) = text[pos..].find(part) {
            if i == 0 && idx != 0 && !pattern.starts_with('*') {
                return false;
            }
            pos += idx + part.len();
        } else {
            return false;
        }
    }
    
    if !pattern.ends_with('*') && pos != text.len() {
        return false;
    }
    
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_guess_mime_type() {
        assert_eq!(guess_mime_type("test.txt"), "text/plain");
        assert_eq!(guess_mime_type("test.rs"), "text/x-rust");
        assert_eq!(guess_mime_type("image.png"), "image/png");
        assert_eq!(guess_mime_type("video.mp4"), "video/mp4");
        assert_eq!(guess_mime_type("archive.zip"), "application/zip");
        assert_eq!(guess_mime_type("unknown"), "application/octet-stream");
    }

    #[test]
    fn test_determine_preview_type() {
        assert_eq!(determine_preview_type("text/plain"), PreviewType::TextPreview);
        assert_eq!(determine_preview_type("application/json"), PreviewType::TextPreview);
        assert_eq!(determine_preview_type("image/png"), PreviewType::Thumbnail);
        assert_eq!(determine_preview_type("video/mp4"), PreviewType::Icon);
    }

    #[test]
    fn test_pattern_matches() {
        assert!(pattern_matches("test", "test.txt"));
        assert!(pattern_matches("*.txt", "test.txt"));
        assert!(pattern_matches("test*", "test.txt"));
        assert!(pattern_matches("*est*", "test.txt"));
        assert!(!pattern_matches("foo", "test.txt"));
    }
}
