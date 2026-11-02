//! File service for handling file operations

use std::io::{Cursor, Read, Write, Seek};
use std::path::{Path, PathBuf};

use spk_core::{SpkReader, SpkWriter, SpkResult};

/// File service for compression/decompression operations
pub struct FileService {
    temp_dir: PathBuf,
}

impl FileService {
    /// Create new file service
    pub fn new() -> Self {
        Self {
            temp_dir: std::env::temp_dir().join("spk-backend"),
        }
    }

    /// Create with custom temp directory
    pub fn with_temp_dir<P: AsRef<Path>>(temp_dir: P) -> Self {
        Self {
            temp_dir: temp_dir.as_ref().to_path_buf(),
        }
    }

    /// Ensure temp directory exists
    pub fn ensure_temp_dir(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.temp_dir)
    }

    /// Get temp file path
    pub fn temp_path(&self, name: &str) -> PathBuf {
        self.temp_dir.join(name)
    }

    /// Compress files to SPK (from in-memory data)
    pub fn compress_files<W: Write + Seek>(
        &self,
        writer: W,
        files: &[(String, Vec<u8>)],
    ) -> SpkResult<u64> {
        let mut spk_writer = SpkWriter::new(writer)?;
        
        for (name, data) in files {
            let reader = Cursor::new(data);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            spk_writer.add_file_from_reader(reader, name.clone(), data.len() as u64, 0o644, now)?;
        }

        let stats = spk_writer.finish()?;
        Ok(stats.compressed_size)
    }

    /// Extract all files from SPK (returns data in memory)
    pub fn extract_all<R: Read + Seek>(
        &self,
        reader: R,
    ) -> SpkResult<Vec<(String, Vec<u8>)>> {
        let mut spk_reader = SpkReader::new(reader)?;
        spk_reader.read_manifest()?;
        
        let manifest = spk_reader.get_manifest()
            .ok_or_else(|| spk_core::SpkError::InvalidFormat("Manifest not loaded".into()))?;
        
        let file_paths: Vec<String> = manifest.files.iter()
            .filter(|f| !f.is_directory)
            .map(|f| f.path.clone())
            .collect();
        
        let mut results = Vec::new();
        for path in file_paths {
            let data = spk_reader.extract_file(&path)?;
            results.push((path, data));
        }
        
        Ok(results)
    }

    /// Extract single file from SPK
    pub fn extract_file<R: Read + Seek>(
        &self,
        reader: R,
        path: &str,
    ) -> SpkResult<Vec<u8>> {
        let mut spk_reader = SpkReader::new(reader)?;
        spk_reader.extract_file(path)
    }

    /// Get archive info
    pub fn get_archive_info<R: Read + Seek>(
        &self,
        reader: R,
    ) -> SpkResult<ArchiveInfo> {
        let mut spk_reader = SpkReader::new(reader)?;
        spk_reader.read_manifest()?;
        let manifest = spk_reader.get_manifest()
            .ok_or_else(|| spk_core::SpkError::InvalidFormat("Manifest not loaded".into()))?;

        Ok(ArchiveInfo {
            file_count: manifest.files.len(),
            total_size: manifest.files.iter().map(|f| f.size).sum(),
            files: manifest.files.iter().map(|f| FileInfo {
                path: f.path.clone(),
                size: f.size,
                permissions: f.permissions,
            }).collect(),
        })
    }

    /// Clean up temp files
    pub fn cleanup(&self) -> std::io::Result<()> {
        if self.temp_dir.exists() {
            std::fs::remove_dir_all(&self.temp_dir)?;
        }
        Ok(())
    }
}

impl Default for FileService {
    fn default() -> Self {
        Self::new()
    }
}

/// Archive info
#[derive(Debug, Clone)]
pub struct ArchiveInfo {
    pub file_count: usize,
    pub total_size: u64,
    pub files: Vec<FileInfo>,
}

/// File info
#[derive(Debug, Clone)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub permissions: u32,
}
