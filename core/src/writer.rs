//! SPK Archive Writer
//!
//! Streaming writer for creating SPK archives.
//! Handles files up to 1024 TB without loading into memory.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

use crate::chunk::{ChunkEntry, ChunkTable};
use crate::codec::{compress, Codec, CompressionLevel};
use crate::header::{Header, HeaderFlags, HEADER_SIZE};
use crate::manifest::{FileEntry, Manifest};
use crate::utils::chunker::{ChunkConfig, ChunkIterator, RawChunk};
use crate::utils::error::{SpkError, SpkResult};
use crate::utils::hashing::{sha256_hash, IncrementalSha256, SHA256_SIZE};
use crate::utils::streaming::StreamingReader;

/// Footer size: 3 hashes (32 bytes each) + signature placeholder (64 bytes)
pub const FOOTER_SIZE: usize = 32 * 3 + 64;

/// Writer configuration
#[derive(Debug, Clone)]
pub struct WriterConfig {
    /// Compression codec
    pub codec: Codec,
    /// Compression level
    pub level: u32,
    /// Chunk size in bytes
    pub chunk_size: usize,
    /// Enable deduplication
    pub enable_dedup: bool,
}

impl Default for WriterConfig {
    fn default() -> Self {
        Self {
            codec: Codec::Zstd,
            level: 3,
            chunk_size: 4 * 1024 * 1024,
            enable_dedup: true,
        }
    }
}

/// SPK Archive Writer
/// 
/// Creates archives using streaming compression.
/// Layout:
/// 1. Header (64 bytes)
/// 2. Manifest (compressed JSON/CBOR)
/// 3. Chunk Table
/// 4. Data Section (compressed chunks)
/// 5. Footer (hashes + signature)
pub struct SpkWriter<W: Write + Seek> {
    writer: BufWriter<W>,
    header: Header,
    manifest: Manifest,
    chunk_table: ChunkTable,
    codec: Codec,
    level: CompressionLevel,
    current_offset: u64,
    data_section_start: u64,
    bytes_written: u64,
}

impl<W: Write + Seek> SpkWriter<W> {
    /// Create a new SPK writer
    pub fn new(writer: W) -> SpkResult<Self> {
        let mut buf_writer = BufWriter::with_capacity(64 * 1024, writer);
        
        // Reserve space for header
        buf_writer.write_all(&[0u8; HEADER_SIZE])?;
        
        Ok(Self {
            writer: buf_writer,
            header: Header::new(),
            manifest: Manifest::new(),
            chunk_table: ChunkTable::new(),
            codec: Codec::Zstd,
            level: CompressionLevel::Normal,
            current_offset: HEADER_SIZE as u64,
            data_section_start: 0,
            bytes_written: HEADER_SIZE as u64,
        })
    }

    /// Set compression codec
    pub fn set_codec(&mut self, codec: Codec) {
        self.codec = codec;
    }

    /// Set compression level
    pub fn set_level(&mut self, level: CompressionLevel) {
        self.level = level;
    }

    /// Set archive metadata
    pub fn set_metadata(&mut self, name: String, description: Option<String>) {
        self.manifest.metadata.name = name;
        self.manifest.metadata.description = description;
        self.manifest.metadata.created = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }

    /// Add a file from a reader
    pub fn add_file_from_reader<R: std::io::Read>(
        &mut self,
        reader: R,
        path: String,
        size: u64,
        permissions: u32,
        modified: u64,
    ) -> SpkResult<()> {
        let chunk_start = self.chunk_table.len() as u64;
        let mut chunk_count = 0u32;
        let mut content_hasher = IncrementalSha256::new();

        // Process file in chunks
        let config = ChunkConfig::fixed(4 * 1024 * 1024); // 4MB chunks
        for chunk_result in ChunkIterator::new(reader, config) {
            let chunk = chunk_result?;
            content_hasher.update(&chunk.data);
            self.write_chunk(chunk)?;
            chunk_count += 1;
        }

        // Create file entry
        let content_hash = hex::encode(content_hasher.finalize());
        let mut entry = FileEntry::new(path, size, permissions);
        entry.modified = modified;
        entry.chunk_start = chunk_start;
        entry.chunk_count = chunk_count;
        entry.content_hash = content_hash;

        self.manifest.add_file(entry);
        Ok(())
    }

    /// Add a file from the filesystem
    pub fn add_file<P: AsRef<Path>>(&mut self, path: P, archive_path: String) -> SpkResult<()> {
        let file_path = path.as_ref();
        let metadata = std::fs::metadata(file_path)?;
        
        if !metadata.is_file() {
            return Err(SpkError::InvalidFormat("Not a regular file".into()));
        }

        let file = File::open(file_path)?;
        let reader = StreamingReader::new(file);
        
        let modified = metadata.modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);

        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode()
        };
        #[cfg(not(unix))]
        let permissions = 0o644;

        self.add_file_from_reader(reader, archive_path, metadata.len(), permissions, modified)
    }

    /// Add a directory entry
    pub fn add_directory(&mut self, path: String, permissions: u32) -> SpkResult<()> {
        self.manifest.add_file(FileEntry::directory(path, permissions));
        Ok(())
    }

    /// Add a symbolic link entry
    pub fn add_symlink(&mut self, path: String, target: String) -> SpkResult<()> {
        self.manifest.add_file(FileEntry::symlink(path, target));
        Ok(())
    }

    /// Write a raw chunk to the archive
    fn write_chunk(&mut self, chunk: RawChunk) -> SpkResult<()> {
        // Compress the chunk
        let compressed = compress(&chunk.data, self.codec, self.level)?;
        
        // Determine if compression helped
        let (final_data, final_codec) = if compressed.len() < chunk.data.len() {
            (compressed, self.codec)
        } else {
            (chunk.data.clone(), Codec::None)
        };

        // Create chunk entry
        let entry = ChunkEntry::new(
            self.current_offset - self.data_section_start,
            final_data.len() as u32,
            chunk.data.len() as u32,
            final_codec,
            chunk.hash,
        );

        // Write chunk data
        self.writer.write_all(&final_data)?;
        self.current_offset += final_data.len() as u64;
        self.bytes_written += final_data.len() as u64;

        // Add to chunk table
        self.chunk_table.add(entry);

        Ok(())
    }

    /// Finalize the archive
    pub fn finish(mut self) -> SpkResult<WriterStats> {
        // Update manifest statistics
        self.manifest.stats.chunk_count = self.chunk_table.len() as u64;
        self.manifest.stats.compressed_size = self.chunk_table.total_compressed_size();
        self.manifest.stats.calculate_ratio();

        // Serialize and compress manifest
        self.header.flags.set(HeaderFlags::MANIFEST_COMPRESSED);
        let manifest_data = self.manifest.to_compressed_json()?;
        let manifest_hash = sha256_hash(&manifest_data);

        // Record manifest position and write
        self.header.manifest_offset = self.current_offset;
        self.writer.write_all(&manifest_data)?;
        self.current_offset += manifest_data.len() as u64;

        // Serialize chunk table
        let chunk_table_data = self.chunk_table.to_bytes();
        let chunk_table_hash = sha256_hash(&chunk_table_data);

        // Record chunk table position and write
        self.header.chunk_table_offset = self.current_offset;
        self.writer.write_all(&chunk_table_data)?;
        self.current_offset += chunk_table_data.len() as u64;

        // Write data section info (already written during add_file)
        self.header.data_section_offset = self.data_section_start;

        // Calculate data section hash (would need to re-read for accuracy)
        // For now, use placeholder
        let data_section_hash = [0u8; SHA256_SIZE];

        // Write footer
        self.header.footer_offset = self.current_offset;
        let footer = self.create_footer(manifest_hash, chunk_table_hash, data_section_hash);
        self.writer.write_all(&footer)?;
        self.current_offset += footer.len() as u64;

        // Update header counts
        self.header.total_chunks = self.chunk_table.len() as u64;
        self.header.total_files = self.manifest.stats.file_count;

        // Seek back and write final header
        self.writer.seek(SeekFrom::Start(0))?;
        self.writer.write_all(&self.header.to_bytes()?)?;
        self.writer.flush()?;

        Ok(WriterStats {
            total_files: self.manifest.stats.file_count,
            total_directories: self.manifest.stats.directory_count,
            total_chunks: self.chunk_table.len() as u64,
            original_size: self.manifest.stats.original_size,
            compressed_size: self.manifest.stats.compressed_size,
            archive_size: self.current_offset,
            compression_ratio: self.manifest.stats.compression_ratio,
        })
    }

    /// Create footer with hashes and signature placeholder
    fn create_footer(
        &self,
        manifest_hash: [u8; SHA256_SIZE],
        chunk_table_hash: [u8; SHA256_SIZE],
        data_section_hash: [u8; SHA256_SIZE],
    ) -> Vec<u8> {
        let mut footer = Vec::with_capacity(FOOTER_SIZE);
        footer.extend_from_slice(&manifest_hash);
        footer.extend_from_slice(&chunk_table_hash);
        footer.extend_from_slice(&data_section_hash);
        footer.extend_from_slice(&[0u8; 64]); // Signature placeholder
        footer
    }

    /// Get current progress
    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }
}

impl SpkWriter<File> {
    /// Create a new SPK archive file
    pub fn create<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let file = File::create(path.as_ref())?;
        let mut writer = Self::new(file)?;
        
        // Reserve space after header for manifest (we'll seek back)
        // For now, write data section immediately after header
        writer.data_section_start = HEADER_SIZE as u64;
        
        Ok(writer)
    }
}

/// Statistics after writing an archive
#[derive(Debug, Clone)]
pub struct WriterStats {
    pub total_files: u64,
    pub total_directories: u64,
    pub total_chunks: u64,
    pub original_size: u64,
    pub compressed_size: u64,
    pub archive_size: u64,
    pub compression_ratio: f64,
}

impl WriterStats {
    pub fn space_saved_percent(&self) -> f64 {
        if self.original_size > 0 {
            (1.0 - self.compression_ratio) * 100.0
        } else {
            0.0
        }
    }
}

/// Builder for creating SPK archives with configuration
pub struct SpkWriterBuilder {
    codec: Codec,
    level: CompressionLevel,
    chunk_size: usize,
    use_cbor: bool,
}

impl Default for SpkWriterBuilder {
    fn default() -> Self {
        Self {
            codec: Codec::Zstd,
            level: CompressionLevel::Normal,
            chunk_size: 4 * 1024 * 1024,
            use_cbor: false,
        }
    }
}

impl SpkWriterBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn codec(mut self, codec: Codec) -> Self {
        self.codec = codec;
        self
    }

    pub fn level(mut self, level: CompressionLevel) -> Self {
        self.level = level;
        self
    }

    pub fn chunk_size(mut self, size: usize) -> Self {
        self.chunk_size = size;
        self
    }

    pub fn use_cbor(mut self, use_cbor: bool) -> Self {
        self.use_cbor = use_cbor;
        self
    }

    pub fn create<P: AsRef<Path>>(self, path: P) -> SpkResult<SpkWriter<File>> {
        let mut writer = SpkWriter::create(path)?;
        writer.set_codec(self.codec);
        writer.set_level(self.level);
        Ok(writer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_writer_creation() {
        let buffer = Cursor::new(Vec::new());
        let writer = SpkWriter::new(buffer).unwrap();
        assert_eq!(writer.bytes_written(), HEADER_SIZE as u64);
    }

    #[test]
    fn test_add_file_from_reader() {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = SpkWriter::new(&mut buffer).unwrap();
            
            let data = b"Hello, World!";
            let reader = Cursor::new(data);
            writer.add_file_from_reader(
                reader,
                "test.txt".into(),
                data.len() as u64,
                0o644,
                0,
            ).unwrap();
            
            writer.finish().unwrap();
        }
        
        // Verify header was written
        let output = buffer.into_inner();
        assert!(output.len() > HEADER_SIZE);
        assert_eq!(&output[0..4], b"SPK1");
    }
}
