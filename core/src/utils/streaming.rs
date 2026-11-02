//! Streaming utilities for SPK
//!
//! Provides streaming reader/writer wrappers that handle files larger than memory.
//! Critical for supporting files up to 1024 TB.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write, Seek, SeekFrom};
use std::path::Path;

use super::error::{SpkError, SpkResult};
use super::hashing::IncrementalSha256;

/// Buffer size for streaming operations: 64KB
pub const STREAM_BUFFER_SIZE: usize = 64 * 1024;

/// Large buffer for high-throughput operations: 1MB
pub const LARGE_BUFFER_SIZE: usize = 1024 * 1024;

/// Maximum file size: 1024 TB
pub const MAX_FILE_SIZE: u64 = 1024 * 1024 * 1024 * 1024 * 1024;

/// Streaming reader with progress tracking and hashing
pub struct StreamingReader<R: Read> {
    inner: BufReader<R>,
    bytes_read: u64,
    total_size: Option<u64>,
    hasher: Option<IncrementalSha256>,
}

impl<R: Read> StreamingReader<R> {
    /// Create a new streaming reader
    pub fn new(reader: R) -> Self {
        Self {
            inner: BufReader::with_capacity(STREAM_BUFFER_SIZE, reader),
            bytes_read: 0,
            total_size: None,
            hasher: None,
        }
    }

    /// Create with known total size
    pub fn with_size(reader: R, size: u64) -> Self {
        Self {
            inner: BufReader::with_capacity(STREAM_BUFFER_SIZE, reader),
            bytes_read: 0,
            total_size: Some(size),
            hasher: None,
        }
    }

    /// Enable hash computation during reading
    pub fn with_hashing(mut self) -> Self {
        self.hasher = Some(IncrementalSha256::new());
        self
    }

    /// Get bytes read so far
    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    /// Get progress as percentage (0.0 - 100.0)
    pub fn progress(&self) -> Option<f64> {
        self.total_size.map(|total| {
            if total == 0 {
                100.0
            } else {
                (self.bytes_read as f64 / total as f64) * 100.0
            }
        })
    }

    /// Finalize and get the hash (if hashing was enabled)
    pub fn finalize_hash(self) -> Option<[u8; 32]> {
        self.hasher.map(|h| h.finalize())
    }
}

impl<R: Read> Read for StreamingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.bytes_read += n as u64;
        
        if let Some(ref mut hasher) = self.hasher {
            hasher.update(&buf[..n]);
        }
        
        Ok(n)
    }
}

impl StreamingReader<File> {
    /// Open a file for streaming read
    pub fn open<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let file = File::open(path.as_ref())?;
        let size = file.metadata()?.len();
        
        if size > MAX_FILE_SIZE {
            return Err(SpkError::FileTooLarge {
                size,
                max: MAX_FILE_SIZE,
            });
        }

        Ok(Self::with_size(file, size))
    }
}

/// Streaming writer with progress tracking and hashing
pub struct StreamingWriter<W: Write> {
    inner: BufWriter<W>,
    bytes_written: u64,
    expected_size: Option<u64>,
    hasher: Option<IncrementalSha256>,
}

impl<W: Write> StreamingWriter<W> {
    /// Create a new streaming writer
    pub fn new(writer: W) -> Self {
        Self {
            inner: BufWriter::with_capacity(STREAM_BUFFER_SIZE, writer),
            bytes_written: 0,
            expected_size: None,
            hasher: None,
        }
    }

    /// Create with expected size for progress tracking
    pub fn with_expected_size(writer: W, size: u64) -> Self {
        Self {
            inner: BufWriter::with_capacity(STREAM_BUFFER_SIZE, writer),
            bytes_written: 0,
            expected_size: Some(size),
            hasher: None,
        }
    }

    /// Enable hash computation during writing
    pub fn with_hashing(mut self) -> Self {
        self.hasher = Some(IncrementalSha256::new());
        self
    }

    /// Get bytes written so far
    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    /// Get progress as percentage
    pub fn progress(&self) -> Option<f64> {
        self.expected_size.map(|total| {
            if total == 0 {
                100.0
            } else {
                (self.bytes_written as f64 / total as f64) * 100.0
            }
        })
    }

    /// Flush the buffer
    pub fn flush_buffer(&mut self) -> SpkResult<()> {
        self.inner.flush()?;
        Ok(())
    }

    /// Finalize and get the hash (if hashing was enabled)
    pub fn finalize_hash(self) -> SpkResult<Option<[u8; 32]>> {
        Ok(self.hasher.map(|h| h.finalize()))
    }

    /// Get inner writer (consumes self)
    pub fn into_inner(self) -> SpkResult<W> {
        self.inner.into_inner().map_err(|e| {
            SpkError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })
    }
}

impl<W: Write> Write for StreamingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.bytes_written += n as u64;
        
        if let Some(ref mut hasher) = self.hasher {
            hasher.update(&buf[..n]);
        }
        
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl StreamingWriter<File> {
    /// Create a new file for streaming write
    pub fn create<P: AsRef<Path>>(path: P) -> SpkResult<Self> {
        let file = File::create(path.as_ref())?;
        Ok(Self::new(file))
    }
}

/// Copy data between reader and writer with progress tracking
pub fn stream_copy<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    size: Option<u64>,
    mut progress_callback: Option<impl FnMut(u64, Option<u64>)>,
) -> SpkResult<u64> {
    let mut buffer = vec![0u8; LARGE_BUFFER_SIZE];
    let mut total_copied = 0u64;

    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }

        writer.write_all(&buffer[..bytes_read])?;
        total_copied += bytes_read as u64;

        if let Some(ref mut callback) = progress_callback {
            callback(total_copied, size);
        }
    }

    writer.flush()?;
    Ok(total_copied)
}

/// Read exactly n bytes from a reader
pub fn read_exact_vec<R: Read>(reader: &mut R, size: usize) -> SpkResult<Vec<u8>> {
    let mut buffer = vec![0u8; size];
    reader.read_exact(&mut buffer)?;
    Ok(buffer)
}

/// Seekable streaming reader
pub struct SeekableReader<R: Read + Seek> {
    inner: R,
    size: u64,
    position: u64,
}

impl<R: Read + Seek> SeekableReader<R> {
    pub fn new(mut reader: R) -> SpkResult<Self> {
        let size = reader.seek(SeekFrom::End(0))?;
        reader.seek(SeekFrom::Start(0))?;
        
        Ok(Self {
            inner: reader,
            size,
            position: 0,
        })
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    pub fn seek_to(&mut self, pos: u64) -> SpkResult<()> {
        self.inner.seek(SeekFrom::Start(pos))?;
        self.position = pos;
        Ok(())
    }

    pub fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> SpkResult<usize> {
        self.seek_to(offset)?;
        let n = self.inner.read(buf)?;
        self.position += n as u64;
        Ok(n)
    }
}

impl<R: Read + Seek> Read for SeekableReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.position += n as u64;
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for SeekableReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let new_pos = self.inner.seek(pos)?;
        self.position = new_pos;
        Ok(new_pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_streaming_reader_progress() {
        let data = vec![0u8; 1000];
        let mut reader = StreamingReader::with_size(Cursor::new(data), 1000);
        
        let mut buf = [0u8; 500];
        reader.read(&mut buf).unwrap();
        
        assert_eq!(reader.bytes_read(), 500);
        assert!((reader.progress().unwrap() - 50.0).abs() < 0.01);
    }

    #[test]
    fn test_streaming_writer_progress() {
        let mut writer = StreamingWriter::with_expected_size(Vec::new(), 1000);
        
        writer.write_all(&[0u8; 250]).unwrap();
        
        assert_eq!(writer.bytes_written(), 250);
        assert!((writer.progress().unwrap() - 25.0).abs() < 0.01);
    }

    #[test]
    fn test_streaming_with_hashing() {
        let data = b"hello world";
        let mut reader = StreamingReader::new(Cursor::new(data)).with_hashing();
        
        let mut buf = Vec::new();
        reader.read_to_end(&mut buf).unwrap();
        
        let hash = reader.finalize_hash().unwrap();
        
        // Verify hash matches direct computation
        use crate::utils::hashing::sha256_hash;
        assert_eq!(hash, sha256_hash(data));
    }

    #[test]
    fn test_stream_copy() {
        let input = vec![1u8; 10000];
        let mut reader = Cursor::new(&input);
        let mut writer = Vec::new();
        
        let copied = stream_copy(&mut reader, &mut writer, Some(10000), None::<fn(u64, Option<u64>)>).unwrap();
        
        assert_eq!(copied, 10000);
        assert_eq!(input, writer);
    }

    #[test]
    fn test_seekable_reader() {
        let data = b"hello world seekable";
        let cursor = Cursor::new(data.to_vec());
        
        let mut reader = SeekableReader::new(cursor).unwrap();
        assert_eq!(reader.size(), data.len() as u64);
        
        let mut buf = [0u8; 5];
        reader.read_at(6, &mut buf).unwrap();
        assert_eq!(&buf, b"world");
    }
}
