//! SPK V3 Partial Extraction
//!
//! Extract specific files or directories without decompressing entire archive.

use std::collections::HashSet;
use std::fs::{self};
use std::path::{Path, PathBuf};

use crate::manifest::{FileEntry, Manifest};
use crate::reader::SpkReader;
use crate::types::manifest_structs::{ExtractionRequest, ExtractionResult, ExtractionError};
use crate::utils::error::{SpkError, SpkResult};

/// Partial extraction handler
pub struct PartialExtractor<R: std::io::Read + std::io::Seek> {
    reader: SpkReader<R>,
    request: ExtractionRequest,
}

impl<R: std::io::Read + std::io::Seek> PartialExtractor<R> {
    /// Create a new partial extractor
    pub fn new(reader: SpkReader<R>, request: ExtractionRequest) -> Self {
        Self { reader, request }
    }

    /// Execute the extraction
    pub fn extract(&mut self) -> SpkResult<ExtractionResult> {
        let start = std::time::Instant::now();
        let mut result = ExtractionResult {
            extracted: Vec::new(),
            failed: Vec::new(),
            bytes_extracted: 0,
            duration_ms: 0,
        };

        // Resolve files to extract
        let files_to_extract = self.resolve_files()?;

        // Create output directory
        fs::create_dir_all(&self.request.output_dir)?;

        // Extract each file
        for entry in files_to_extract {
            match self.extract_entry(&entry) {
                Ok(bytes) => {
                    result.extracted.push(entry.path.clone());
                    result.bytes_extracted += bytes;
                }
                Err(e) => {
                    if self.request.skip_on_error {
                        result.failed.push(ExtractionError {
                            path: entry.path.clone(),
                            error: e.to_string(),
                        });
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        result.duration_ms = start.elapsed().as_millis() as u64;
        Ok(result)
    }

    /// Resolve file patterns to actual file entries
    fn resolve_files(&mut self) -> SpkResult<Vec<FileEntry>> {
        let manifest = self.reader.read_manifest()?;
        let mut to_extract = Vec::new();
        let mut seen = HashSet::new();

        for pattern in &self.request.files {
            if pattern.contains('*') || pattern.contains('?') {
                // Glob pattern
                for entry in &manifest.files {
                    if glob_match(pattern, &entry.path) && !seen.contains(&entry.path) {
                        seen.insert(entry.path.clone());
                        to_extract.push(entry.clone());
                    }
                }
            } else if pattern.ends_with("/**") {
                // Directory recursive
                let dir_prefix = &pattern[..pattern.len() - 3];
                for entry in &manifest.files {
                    if (entry.path.starts_with(dir_prefix) || entry.path == dir_prefix.trim_end_matches('/'))
                        && !seen.contains(&entry.path)
                    {
                        seen.insert(entry.path.clone());
                        to_extract.push(entry.clone());
                    }
                }
            } else {
                // Exact path
                if let Some(entry) = manifest.get_file(pattern) {
                    if !seen.contains(&entry.path) {
                        seen.insert(entry.path.clone());
                        to_extract.push(entry.clone());
                    }
                }
            }
        }

        Ok(to_extract)
    }

    /// Extract a single entry
    fn extract_entry(&mut self, entry: &FileEntry) -> SpkResult<u64> {
        let output_path = if self.request.preserve_structure {
            PathBuf::from(&self.request.output_dir).join(&entry.path)
        } else {
            PathBuf::from(&self.request.output_dir).join(
                Path::new(&entry.path)
                    .file_name()
                    .unwrap_or_default(),
            )
        };

        // Check if exists
        if output_path.exists() && !self.request.overwrite {
            return Err(SpkError::ExtractionError(format!(
                "File exists: {}",
                output_path.display()
            )));
        }

        if entry.is_directory {
            fs::create_dir_all(&output_path)?;
            return Ok(0);
        }

        if entry.is_symlink {
            #[cfg(unix)]
            if let Some(target) = &entry.symlink_target {
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                std::os::unix::fs::symlink(target, &output_path)?;
            }
            return Ok(0);
        }

        // Create parent directories
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Extract file content
        self.reader.extract_file_to(&entry.path, &output_path)
    }
}

/// Simple glob pattern matching
fn glob_match(pattern: &str, text: &str) -> bool {
    let mut pattern_chars = pattern.chars().peekable();
    let mut text_chars = text.chars().peekable();

    while let Some(p) = pattern_chars.next() {
        match p {
            '*' => {
                // Handle ** for recursive
                if pattern_chars.peek() == Some(&'*') {
                    pattern_chars.next();
                    // Match any number of path segments
                    let remaining: String = pattern_chars.collect();
                    if remaining.is_empty() {
                        return true;
                    }
                    let remaining = remaining.trim_start_matches('/');
                    for i in 0..=text.len() {
                        if glob_match(remaining, &text[i..]) {
                            return true;
                        }
                    }
                    return false;
                }
                // Match any characters except /
                let next_pattern: String = pattern_chars.collect();
                if next_pattern.is_empty() {
                    // * at end matches rest (but not across /)
                    return !text_chars.any(|c| c == '/');
                }
                while text_chars.peek().is_some() {
                    let remaining: String = text_chars.clone().collect();
                    if glob_match(&next_pattern, &remaining) {
                        return true;
                    }
                    if text_chars.next() == Some('/') {
                        break;
                    }
                }
                return false;
            }
            '?' => {
                // Match single character except /
                match text_chars.next() {
                    Some('/') | None => return false,
                    _ => continue,
                }
            }
            c => {
                // Exact match
                if text_chars.next() != Some(c) {
                    return false;
                }
            }
        }
    }

    text_chars.peek().is_none()
}

/// Extraction filter for UI
#[derive(Debug, Clone)]
pub struct ExtractionFilter {
    /// Include patterns
    pub include: Vec<String>,
    /// Exclude patterns
    pub exclude: Vec<String>,
    /// Minimum file size
    pub min_size: Option<u64>,
    /// Maximum file size
    pub max_size: Option<u64>,
    /// File extensions to include
    pub extensions: Vec<String>,
}

impl Default for ExtractionFilter {
    fn default() -> Self {
        Self {
            include: Vec::new(),
            exclude: Vec::new(),
            min_size: None,
            max_size: None,
            extensions: Vec::new(),
        }
    }
}

impl ExtractionFilter {
    /// Check if a file entry matches the filter
    pub fn matches(&self, entry: &FileEntry) -> bool {
        // Check exclude patterns first
        for pattern in &self.exclude {
            if glob_match(pattern, &entry.path) {
                return false;
            }
        }

        // Check include patterns
        if !self.include.is_empty() {
            let mut included = false;
            for pattern in &self.include {
                if glob_match(pattern, &entry.path) {
                    included = true;
                    break;
                }
            }
            if !included {
                return false;
            }
        }

        // Check size limits
        if let Some(min) = self.min_size {
            if entry.size < min {
                return false;
            }
        }
        if let Some(max) = self.max_size {
            if entry.size > max {
                return false;
            }
        }

        // Check extensions
        if !self.extensions.is_empty() {
            let ext = Path::new(&entry.path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());
            
            if let Some(ext) = ext {
                if !self.extensions.iter().any(|e| e.to_lowercase() == ext) {
                    return false;
                }
            } else {
                return false;
            }
        }

        true
    }

    /// Apply filter to manifest and return matching entries
    pub fn apply<'a>(&self, manifest: &'a Manifest) -> Vec<&'a FileEntry> {
        manifest.files.iter().filter(|e| self.matches(e)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match_star() {
        assert!(glob_match("*.txt", "file.txt"));
        assert!(glob_match("*.txt", "test.txt"));
        assert!(!glob_match("*.txt", "file.rs"));
        assert!(!glob_match("*.txt", "dir/file.txt"));
    }

    #[test]
    fn test_glob_match_double_star() {
        assert!(glob_match("**/*.txt", "file.txt"));
        assert!(glob_match("**/*.txt", "dir/file.txt"));
        assert!(glob_match("**/*.txt", "a/b/c/file.txt"));
        assert!(!glob_match("**/*.txt", "file.rs"));
    }

    #[test]
    fn test_glob_match_question() {
        assert!(glob_match("file?.txt", "file1.txt"));
        assert!(glob_match("file?.txt", "fileA.txt"));
        assert!(!glob_match("file?.txt", "file12.txt"));
    }

    #[test]
    fn test_extraction_filter() {
        let filter = ExtractionFilter {
            include: vec!["*.txt".into()],
            exclude: vec!["secret*".into()],
            min_size: Some(100),
            max_size: Some(10000),
            extensions: vec![],
        };

        let entry1 = FileEntry::new("test.txt".into(), 500, 0o644);
        let entry2 = FileEntry::new("test.rs".into(), 500, 0o644);
        let entry3 = FileEntry::new("secret.txt".into(), 500, 0o644);
        let entry4 = FileEntry::new("small.txt".into(), 50, 0o644);

        assert!(filter.matches(&entry1));
        assert!(!filter.matches(&entry2)); // Wrong extension
        assert!(!filter.matches(&entry3)); // Excluded
        assert!(!filter.matches(&entry4)); // Too small
    }
}
