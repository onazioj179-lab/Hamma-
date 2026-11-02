//! SPK Archive Reader
//!
//! Streaming reader for extracting SPK archives.
//! Handles files up to 1024 TB without loading into memory.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use crate::chunk::{ChunkTable, CHUNK_ENTRY_SIZE};
use crate::codec::decompress;
use crate::header::{Header, HeaderFlags, HEADER_SIZE};
use crate::manifest::{FileEntry, Manifest};
use crate::utils::error::{SpkError, SpkResult};
use crate::utils::hashing::sha256_hash;
use crate::utils::streaming::read_exact_vec;

/// Reader configuration
#[derive(Debug, Clone)]
pub struct ReaderConfig {
    /// Verify hashes during extraction
    pub verify_hashes: bool,
    /// Buffer size for reading
    pub buffer_size: usize,
    /// Password for encrypted archives
    pub password: Option<String>,
}

impl Default for ReaderConfig {
    fn default() -> Self {
        Self {
            verify_hashes: true,
            buffer_size: 64 * 1024,
            password: None,
        }
    }
}

/// SPK Archive Reader
///
/// Reads archives using streaming decompression.
pub struct SpkReader<R: Read + Seek> {
    reader: BufReader<R>,
    header: Header,
    manifest: Option<Manifest>,
    chunk_table: Option<ChunkTable>,
}

impl<R: Read + Seek> SpkReader<R> {
    /// Open an archive from a reader
    pub fn new(reader: R) -> SpkResult<Self> {
        let mut buf_reader = BufReader::with_capacity(64 * 1024, reader);

        // Read and parse header
        let mut header_bytes = [0u8; HEADER_SIZE];
        buf_reader.read_exact(&mut header_bytes)?;
        let header = Header::from_bytes(&header_bytes)?;
        header.validate()?;

        Ok(Self {
            reader: buf_reader,
            header,
            manifest: None,
            chunk_table: None,
        })
    }

    /// Get archive header
    pub fn header(&self) -> &Header {
        &self.header
    }

    /// Get format version
    pub fn version(&self) -> u16 {
        self.header.version
    }

    /// Check if archive is encrypted
    pub fn is_encrypted(&self) -> bool {
        self.header.is_encrypted()
    }

    /// Get manifest (must call read_manifest first)
    pub fn get_manifest(&self) -> Option<&Manifest> {
        self.manifest.as_ref()
    }

    /// Load and parse the manifest
    pub fn read_manifest(&mut self) -> SpkResult<&Manifest> {
        if self.manifest.is_some() {
            return Ok(self.manifest.as_ref().unwrap());
        }

        // Seek to manifest
        self.reader.seek(SeekFrom::Start(self.header.manifest_offset))?;

        // Read manifest data (size is chunk_table_offset - manifest_offset)
        let manifest_size = (self.header.chunk_table_offset - self.header.manifest_offset) as usize;
        let manifest_data = read_exact_vec(&mut self.reader, manifest_size)?;

        // Parse manifest based on flags
        let manifest = if self.header.flags.has(HeaderFlags::MANIFEST_COMPRESSED) {
            if self.header.flags.uses_cbor() {
                Manifest::from_compressed_cbor(&manifest_data)?
            } else {
                Manifest::from_compressed_json(&manifest_data)?
            }
        } else if self.header.flags.uses_cbor() {
            Manifest::from_cbor(&manifest_data)?
        } else {
            Manifest::from_json(&manifest_data)?
        };

        self.manifest = Some(manifest);
        Ok(self.manifest.as_ref().unwrap())
    }

    /// Load and parse the chunk table
    pub fn read_chunk_table(&mut self) -> SpkResult<&ChunkTable> {
        if self.chunk_table.is_some() {
            return Ok(self.chunk_table.as_ref().unwrap());
        }

        // Seek to chunk table
        self.reader.seek(SeekFrom::Start(self.header.chunk_table_offset))?;

        // Calculate chunk table size
        let table_size = (self.header.footer_offset - self.header.chunk_table_offset) as usize;
        let chunk_count = table_size / CHUNK_ENTRY_SIZE;

        // Read chunk table data
        let table_data = read_exact_vec(&mut self.reader, table_size)?;
        let chunk_table = ChunkTable::from_bytes(&table_data, chunk_count)?;

        self.chunk_table = Some(chunk_table);
        Ok(self.chunk_table.as_ref().unwrap())
    }

    /// Get file entry by path
    pub fn get_file(&mut self, path: &str) -> SpkResult<Option<&FileEntry>> {
        self.read_manifest()?;
        Ok(self.manifest.as_ref().unwrap().get_file(path))
    }

    /// List all files in the archive
    pub fn list_files(&mut self) -> SpkResult<Vec<&FileEntry>> {
        self.read_manifest()?;
        Ok(self.manifest.as_ref().unwrap().files.iter().collect())
    }

    /// Read a chunk by index
    pub fn read_chunk(&mut self, index: usize) -> SpkResult<Vec<u8>> {
        self.read_chunk_table()?;
        
        let entry = self.chunk_table.as_ref().unwrap()
            .get(index)
            .ok_or_else(|| SpkError::ChunkNotFound(format!("Chunk {} not found", index)))?
            .clone();

        // Seek to chunk in data section
        let chunk_offset = self.header.data_section_offset + entry.offset;
        self.reader.seek(SeekFrom::Start(chunk_offset))?;

        // Read compressed data
        let compressed = read_exact_vec(&mut self.reader, entry.compressed_size as usize)?;

        // Decompress
        let decompressed = decompress(
            &compressed,
            entry.codec,
            Some(entry.uncompressed_size as usize),
        )?;

        // Verify hash
        let hash = sha256_hash(&decompressed);
        if hash != entry.hash {
            return Err(SpkError::hash_mismatch(&entry.hash, &hash));
        }

        Ok(decompressed)
    }

    /// Read chunks for a file entry
    pub fn read_file_chunks(&mut self, entry: &FileEntry) -> SpkResult<Vec<Vec<u8>>> {
        let mut chunks = Vec::with_capacity(entry.chunk_count as usize);
        
        for i in 0..entry.chunk_count {
            let chunk = self.read_chunk((entry.chunk_start + i as u64) as usize)?;
            chunks.push(chunk);
        }

        Ok(chunks)
    }

    /// Extract a file by path
    pub fn extract_file(&mut self, path: &str) -> SpkResult<Vec<u8>> {
        // Get file entry
        self.read_manifest()?;
        let entry = self.manifest.as_ref().unwrap()
            .get_file(path)
            .ok_or_else(|| SpkError::InvalidManifest(format!("File not found: {}", path)))?
            .clone();

        if entry.is_directory {
            return Err(SpkError::InvalidFormat("Cannot extract directory as file".into()));
        }

        // Read and concatenate all chunks
        let mut data = Vec::with_capacity(entry.size as usize);
        for i in 0..entry.chunk_count {
            let chunk = self.read_chunk((entry.chunk_start + i as u64) as usize)?;
            data.extend_from_slice(&chunk);
        }

        // Truncate to exact size (last chunk may have padding)
        data.truncate(entry.size as usize);

        // Verify file hash
        let hash = hex::encode(sha256_hash(&data));
        if hash != entry.content_hash {
            return Err(SpkError::HashMismatch {
                expected: entry.content_hash.clone(),
                actual: hash,
            });
        }

        Ok(data)
    }

    /// Extract a file to disk
    pub fn extract_file_to<P: AsRef<Path>>(&mut self, path: &str, output: P) -> SpkResult<u64> {
        use std::io::Write;

        // Get file entry
        self.read_manifest()?;
        let entry = self.manifest.as_ref().unwrap()
            .get_file(path)
            .ok_or_else(|| SpkError::InvalidManifest(format!("File not found: {}", path)))?
            .clone();

        if entry.is_directory {
            std::fs::create_dir_all(output.as_ref())?;
            return Ok(0);
        }

        // Create parent directories
        if let Some(parent) = output.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Create output file
        let mut output_file = File::create(output.as_ref())?;
        let mut bytes_written = 0u64;
        let mut hasher = crate::utils::hashing::IncrementalSha256::new();

        // Write chunks
        for i in 0..entry.chunk_count {
            let chunk = self.read_chunk((entry.chunk_start + i as u64) as usize)?;
            
            // Handle last chunk truncation
            let write_size = if i == entry.chunk_count - 1 {
                let remaining = entry.size - bytes_written;
                remaining.min(chunk.len() as u64) as usize
            } else {
                chunk.len()
            };

            output_file.write_all(&chunk[..write_size])?;
            hasher.update(&chunk[..write_size]);
            bytes_written += write_size as u64;
        }

        // Verify hash
        let hash = hex::encode(hasher.finalize());
        if hash != entry.content_hash {
            // Remove corrupted file
            std::fs::remove_file(output.as_ref()).ok();
            return Err(SpkError::HashMismatch {
                expected: entry.content_hash,
                actual: hash,
            });
        }

        // Set file permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                output.as_ref(),
                std::fs::Permissions::from_mode(entry.permissions),
            )?;
        }

        Ok(bytes_written)
    }

    /// Extract all files to a directory
    pub fn extract_all<P: AsRef<Path>>(&mut self, output_dir: P) -> SpkResult<ExtractionStats> {
        let output_dir = output_dir.as_ref();
        std::fs::create_dir_all(output_dir)?;

        self.read_manifest()?;
        let files: Vec<FileEntry> = self.manifest.as_ref().unwrap().files.clone();

        let mut stats = ExtractionStats::default();

        for entry in files {
            let output_path = output_dir.join(&entry.path);

            if entry.is_directory {
                std::fs::create_dir_all(&output_path)?;
                stats.directories += 1;
            } else if entry.is_symlink {
                #[cfg(unix)]
                if let Some(target) = &entry.symlink_target {
                    std::os::unix::fs::symlink(target, &output_path)?;
                }
                stats.symlinks += 1;
            } else {
                let bytes = self.extract_file_to(&entry.path, &output_path)?;
                stats.files += 1;
                stats.bytes_extracted += bytes;
            }
        }

        Ok(stats)
    }

    /// Verify archive integrity without extracting
    pub fn verify(&mut self) -> SpkResult<VerificationResult> {
        self.read_manifest()?;
        self.read_chunk_table()?;

        let mut result = VerificationResult {
            valid: true,
            chunks_verified: 0,
            chunks_failed: 0,
            errors: Vec::new(),
        };

        let chunk_count = self.chunk_table.as_ref().unwrap().len();

        for i in 0..chunk_count {
            match self.verify_chunk(i) {
                Ok(true) => result.chunks_verified += 1,
                Ok(false) => {
                    result.chunks_failed += 1;
                    result.valid = false;
                    result.errors.push(format!("Chunk {} hash mismatch", i));
                }
                Err(e) => {
                    result.chunks_failed += 1;
                    result.valid = false;
                    result.errors.push(format!("Chunk {} error: {}", i, e));
                }
            }
        }

        Ok(result)
    }

    /// Verify a single chunk
    fn verify_chunk(&mut self, index: usize) -> SpkResult<bool> {
        let entry = self.chunk_table.as_ref().unwrap()
            .get(index)
            .ok_or_else(|| SpkError::ChunkNotFound(format!("Chunk {} not found", index)))?
            .clone();

        // Seek to chunk
        let chunk_offset = self.header.data_section_offset + entry.offset;
        self.reader.seek(SeekFrom::Start(chunk_offset))?;

        // Read compressed data
        let compressed = read_exact_vec(&mut self.reader, entry.compressed_size as usize)?;

        // Decompress
        let decompressed = decompress(
            &compressed,
            entry.codec,
            Some(entry.uncompressed_size as usize),
        )?;

        // Verify hash
        let hash = sha256_hash(&decompressed);
        Ok(hash == entry.hash)
    }

    /// Get archive statistics
    pub fn stats(&mut self) -> SpkResult<&crate::manifest::CompressionStats> {
        self.read_manifest()?;
        Ok(&self.manifest.as_ref().unwrap().stats)
    }
}

impl SpkReader<File> {
    /// Open an archive file
    pub fn open<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let file = File::open(path.as_ref())?;
        Self::new(file)
    }
}

/// Extraction statistics
#[derive(Debug, Clone, Default)]
pub struct ExtractionStats {
    pub files: u64,
    pub directories: u64,
    pub symlinks: u64,
    pub bytes_extracted: u64,
}

/// Verification result
#[derive(Debug, Clone)]
pub struct VerificationResult {
    pub valid: bool,
    pub chunks_verified: u64,
    pub chunks_failed: u64,
    pub errors: Vec<String>,
}

/// Iterator over files in an archive
pub struct FileIterator<'a, R: Read + Seek> {
    reader: &'a mut SpkReader<R>,
    index: usize,
    count: usize,
}

impl<'a, R: Read + Seek> FileIterator<'a, R> {
    pub fn new(reader: &'a mut SpkReader<R>) -> SpkResult<Self> {
        reader.read_manifest()?;
        let count = reader.manifest.as_ref().unwrap().files.len();
        Ok(Self {
            reader,
            index: 0,
            count,
        })
    }
}

impl<'a, R: Read + Seek> Iterator for FileIterator<'a, R> {
    type Item = &'a FileEntry;

    fn next(&mut self) -> Option<Self::Item> {
        if self.index >= self.count {
            return None;
        }
        
        // SAFETY: This is a workaround for lifetime issues
        // The manifest is kept alive as long as the reader exists
        let entry = unsafe {
            let manifest = self.reader.manifest.as_ref().unwrap();
            let entry_ptr = &manifest.files[self.index] as *const FileEntry;
            &*entry_ptr
        };
        
        self.index += 1;
        Some(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::writer::SpkWriter;
    use std::io::Cursor;

    fn create_test_archive() -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = SpkWriter::new(&mut buffer).unwrap();
            writer.set_metadata("Test Archive".into(), Some("For testing".into()));
            
            let data = b"Hello, World! This is test content.";
            writer.add_file_from_reader(
                Cursor::new(data),
                "test.txt".into(),
                data.len() as u64,
                0o644,
                0,
            ).unwrap();
            
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn test_reader_open() {
        let archive = create_test_archive();
        let reader = SpkReader::new(Cursor::new(archive)).unwrap();
        assert_eq!(reader.version(), 1);
    }

    #[test]
    fn test_read_manifest() {
        let archive = create_test_archive();
        let mut reader = SpkReader::new(Cursor::new(archive)).unwrap();
        let manifest = reader.read_manifest().unwrap();
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].path, "test.txt");
    }

    #[test]
    fn test_extract_file() {
        let archive = create_test_archive();
        let mut reader = SpkReader::new(Cursor::new(archive)).unwrap();
        let data = reader.extract_file("test.txt").unwrap();
        assert_eq!(data, b"Hello, World! This is test content.");
    }

    #[test]
    fn test_verify() {
        let archive = create_test_archive();
        let mut reader = SpkReader::new(Cursor::new(archive)).unwrap();
        let result = reader.verify().unwrap();
        assert!(result.valid);
        assert_eq!(result.chunks_failed, 0);
    }
}
