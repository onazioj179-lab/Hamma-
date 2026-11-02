//! SPK V3 Multi-part Archives
//!
//! Support for splitting archives into multiple parts (.001, .002, etc.)

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::types::MultipartSplitInfo;
use crate::utils::error::{SpkError, SpkResult};

/// Default part size: 100 MB
pub const DEFAULT_PART_SIZE: u64 = 100 * 1024 * 1024;

/// Maximum part size: 4 GB (FAT32 compatibility)
pub const MAX_PART_SIZE: u64 = 4 * 1024 * 1024 * 1024;

/// Multi-part archive writer
pub struct MultipartWriter {
    base_path: PathBuf,
    info: MultipartSplitInfo,
    current_part: u32,
    current_writer: Option<BufWriter<File>>,
    current_part_size: u64,
}

impl MultipartWriter {
    /// Create a new multi-part writer
    pub fn new<P: AsRef<Path>>(base_path: P, part_size: u64) -> SpkResult<Self> {
        let part_size = part_size.min(MAX_PART_SIZE);
        let base_path = base_path.as_ref().to_path_buf();
        
        Ok(Self {
            base_path,
            info: MultipartSplitInfo::new(part_size),
            current_part: 0,
            current_writer: None,
            current_part_size: 0,
        })
    }

    /// Get archive ID
    pub fn archive_id(&self) -> &str {
        &self.info.archive_id
    }

    /// Get current part number
    pub fn current_part(&self) -> u32 {
        self.current_part
    }

    /// Get total parts
    pub fn total_parts(&self) -> u32 {
        self.info.total_parts
    }

    /// Get path for a specific part
    fn part_path(&self, part: u32) -> PathBuf {
        let ext = format!(".{:03}", part);
        let mut path = self.base_path.clone();
        let file_name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archive")
            .to_string();
        path.set_file_name(format!("{}{}", file_name, ext));
        path
    }

    /// Open next part for writing
    fn open_next_part(&mut self) -> SpkResult<()> {
        // Close current part
        if let Some(writer) = self.current_writer.take() {
            writer.into_inner()
                .map_err(|e| SpkError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    e.to_string(),
                )))?;
        }

        self.current_part += 1;
        self.info.total_parts = self.current_part;
        
        let path = self.part_path(self.current_part);
        let file = File::create(&path)?;
        self.current_writer = Some(BufWriter::with_capacity(64 * 1024, file));
        self.current_part_size = 0;

        Ok(())
    }

    /// Write data, splitting across parts as needed
    pub fn write(&mut self, data: &[u8]) -> SpkResult<()> {
        // Open first part if needed
        if self.current_writer.is_none() {
            self.open_next_part()?;
        }

        let mut remaining = data;
        while !remaining.is_empty() {
            let space_in_part = self.info.part_size.saturating_sub(self.current_part_size);
            
            if space_in_part == 0 {
                self.open_next_part()?;
                continue;
            }

            let write_size = (remaining.len() as u64).min(space_in_part) as usize;
            
            if let Some(ref mut writer) = self.current_writer {
                writer.write_all(&remaining[..write_size])?;
                self.current_part_size += write_size as u64;
                remaining = &remaining[write_size..];
            }
        }

        Ok(())
    }

    /// Finalize all parts
    pub fn finish(mut self) -> SpkResult<MultipartInfo> {
        if let Some(writer) = self.current_writer.take() {
            writer.into_inner()
                .map_err(|e| SpkError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    e.to_string(),
                )))?;
        }

        Ok(MultipartInfo {
            base_path: self.base_path,
            archive_id: self.info.archive_id,
            total_parts: self.info.total_parts,
            part_size: self.info.part_size,
        })
    }
}

/// Multi-part archive reader
pub struct MultipartReader {
    base_path: PathBuf,
    info: MultipartInfo,
    current_part: u32,
    current_reader: Option<BufReader<File>>,
    current_position: u64,
}

impl MultipartReader {
    /// Open a multi-part archive
    pub fn open<P: AsRef<Path>>(base_path: P) -> SpkResult<Self> {
        let base_path = base_path.as_ref().to_path_buf();
        
        // Discover parts
        let info = Self::discover_parts(&base_path)?;
        
        Ok(Self {
            base_path,
            info,
            current_part: 0,
            current_reader: None,
            current_position: 0,
        })
    }

    /// Discover all parts of an archive
    fn discover_parts(base_path: &Path) -> SpkResult<MultipartInfo> {
        let file_name = base_path.file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| SpkError::PartMissing("Invalid base path".into()))?;

        let parent = base_path.parent().unwrap_or(Path::new("."));
        let mut parts = Vec::new();

        // Look for numbered parts
        for i in 1..=9999 {
            let part_path = parent.join(format!("{}.{:03}", file_name, i));
            if part_path.exists() {
                parts.push(i);
            } else {
                break;
            }
        }

        if parts.is_empty() {
            return Err(SpkError::PartMissing("No archive parts found".into()));
        }

        // Verify parts are sequential
        for (i, &part) in parts.iter().enumerate() {
            if part != (i + 1) as u32 {
                return Err(SpkError::InvalidPartSequence {
                    expected: (i + 1) as u32,
                    actual: part,
                });
            }
        }

        // Get part size from first part
        let first_part = parent.join(format!("{}.001", file_name));
        let part_size = std::fs::metadata(&first_part)?.len();

        Ok(MultipartInfo {
            base_path: base_path.to_path_buf(),
            archive_id: String::new(), // Would read from header
            total_parts: parts.len() as u32,
            part_size,
        })
    }

    /// Get path for a specific part
    fn part_path(&self, part: u32) -> PathBuf {
        let file_name = self.base_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archive");
        
        let parent = self.base_path.parent().unwrap_or(Path::new("."));
        parent.join(format!("{}.{:03}", file_name, part))
    }

    /// Open a specific part
    fn open_part(&mut self, part: u32) -> SpkResult<()> {
        if part < 1 || part > self.info.total_parts {
            return Err(SpkError::PartMissing(format!("Part {} not available", part)));
        }

        let path = self.part_path(part);
        let file = File::open(&path)?;
        self.current_reader = Some(BufReader::with_capacity(64 * 1024, file));
        self.current_part = part;
        
        Ok(())
    }

    /// Get total parts
    pub fn total_parts(&self) -> u32 {
        self.info.total_parts
    }

    /// Get archive info
    pub fn info(&self) -> &MultipartInfo {
        &self.info
    }

    /// Calculate total archive size
    pub fn total_size(&self) -> SpkResult<u64> {
        let mut total = 0u64;
        for part in 1..=self.info.total_parts {
            let path = self.part_path(part);
            total += std::fs::metadata(&path)?.len();
        }
        Ok(total)
    }

    /// Verify all parts are present and readable
    pub fn verify_parts(&self) -> SpkResult<Vec<PartStatus>> {
        let mut statuses = Vec::new();
        
        for part in 1..=self.info.total_parts {
            let path = self.part_path(part);
            let status = if path.exists() {
                match File::open(&path) {
                    Ok(file) => {
                        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                        PartStatus::Present { part, size }
                    }
                    Err(e) => PartStatus::Error { part, error: e.to_string() },
                }
            } else {
                PartStatus::Missing { part }
            };
            statuses.push(status);
        }
        
        Ok(statuses)
    }
}

impl Read for MultipartReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // Open first part if needed
        if self.current_reader.is_none() {
            self.open_part(1).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            })?;
        }

        let mut total_read = 0;
        while total_read < buf.len() {
            if let Some(ref mut reader) = self.current_reader {
                let n = reader.read(&mut buf[total_read..])?;
                if n == 0 {
                    // End of current part, try next
                    if self.current_part < self.info.total_parts {
                        self.open_part(self.current_part + 1).map_err(|e| {
                            std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                        })?;
                        continue;
                    } else {
                        break; // End of archive
                    }
                }
                total_read += n;
                self.current_position += n as u64;
            } else {
                break;
            }
        }

        Ok(total_read)
    }
}

impl Seek for MultipartReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let new_pos = match pos {
            SeekFrom::Start(p) => p,
            SeekFrom::Current(p) => (self.current_position as i64 + p) as u64,
            SeekFrom::End(_) => {
                // Would need to calculate total size
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "SeekFrom::End not supported for multipart",
                ));
            }
        };

        // Calculate which part contains this position
        let part = (new_pos / self.info.part_size) as u32 + 1;
        let offset_in_part = new_pos % self.info.part_size;

        if part != self.current_part {
            self.open_part(part).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            })?;
        }

        if let Some(ref mut reader) = self.current_reader {
            reader.seek(SeekFrom::Start(offset_in_part))?;
        }

        self.current_position = new_pos;
        Ok(new_pos)
    }
}

/// Information about a multi-part archive
#[derive(Debug, Clone)]
pub struct MultipartInfo {
    pub base_path: PathBuf,
    pub archive_id: String,
    pub total_parts: u32,
    pub part_size: u64,
}

/// Status of an individual part
#[derive(Debug, Clone)]
pub enum PartStatus {
    Present { part: u32, size: u64 },
    Missing { part: u32 },
    Error { part: u32, error: String },
}

impl PartStatus {
    pub fn is_ok(&self) -> bool {
        matches!(self, PartStatus::Present { .. })
    }
}

/// Split an existing archive into multiple parts
pub fn split_archive<P: AsRef<Path>>(source: P, output_base: P, part_size: u64) -> SpkResult<MultipartInfo> {
    let mut input = File::open(source.as_ref())?;
    let _total_size = input.metadata()?.len();
    
    let mut writer = MultipartWriter::new(output_base, part_size)?;
    let mut buffer = vec![0u8; 64 * 1024];
    
    loop {
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        writer.write(&buffer[..n])?;
    }
    
    writer.finish()
}

/// Join multiple parts into a single archive
pub fn join_archive<P: AsRef<Path>>(base_path: P, output: P) -> SpkResult<u64> {
    let mut reader = MultipartReader::open(base_path)?;
    let mut output_file = File::create(output)?;
    
    let mut buffer = vec![0u8; 64 * 1024];
    let mut total = 0u64;
    
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        output_file.write_all(&buffer[..n])?;
        total += n as u64;
    }
    
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_multipart_writer() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("test.spk");
        
        let mut writer = MultipartWriter::new(&base, 100).unwrap();
        
        // Write 250 bytes (should create 3 parts)
        writer.write(&[0u8; 100]).unwrap();
        writer.write(&[1u8; 100]).unwrap();
        writer.write(&[2u8; 50]).unwrap();
        
        let info = writer.finish().unwrap();
        assert_eq!(info.total_parts, 3);
    }

    #[test]
    fn test_multipart_roundtrip() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("test.spk");
        
        let test_data: Vec<u8> = (0..500).map(|i| (i % 256) as u8).collect();
        
        // Write
        {
            let mut writer = MultipartWriter::new(&base, 100).unwrap();
            writer.write(&test_data).unwrap();
            writer.finish().unwrap();
        }
        
        // Read back
        let mut reader = MultipartReader::open(&base).unwrap();
        let mut result = Vec::new();
        reader.read_to_end(&mut result).unwrap();
        
        assert_eq!(test_data, result);
    }

    #[test]
    fn test_part_status() {
        let status = PartStatus::Present { part: 1, size: 1000 };
        assert!(status.is_ok());
        
        let status = PartStatus::Missing { part: 2 };
        assert!(!status.is_ok());
    }
}
