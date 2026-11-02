//! Zero-Copy Module (V6)
//!
//! Zero-copy data paths for maximum throughput.
//! Direct memory buffers, pinned memory, and slice-based operations.

use std::sync::Arc;
use std::ops::{Deref, DerefMut};
use std::io::{Read, Write};
use crate::utils::error::{SpkError, SpkResult};

/// Memory alignment for SIMD operations
pub const SIMD_ALIGNMENT: usize = 64;

/// Page size for memory mapping
pub const PAGE_SIZE: usize = 4096;

/// Aligned buffer for zero-copy operations
#[derive(Debug)]
pub struct AlignedBuffer {
    /// Raw data
    data: Vec<u8>,
    /// Alignment
    alignment: usize,
    /// Actual data offset within buffer
    offset: usize,
}

impl AlignedBuffer {
    /// Create a new aligned buffer
    pub fn new(size: usize, alignment: usize) -> Self {
        // Allocate extra space for alignment
        let data = vec![0u8; size + alignment];
        let ptr = data.as_ptr() as usize;
        let offset = (alignment - (ptr % alignment)) % alignment;
        
        Self {
            data,
            alignment,
            offset,
        }
    }

    /// Create with SIMD alignment
    pub fn simd_aligned(size: usize) -> Self {
        Self::new(size, SIMD_ALIGNMENT)
    }

    /// Create with page alignment
    pub fn page_aligned(size: usize) -> Self {
        Self::new(size, PAGE_SIZE)
    }

    /// Get aligned slice
    pub fn as_slice(&self) -> &[u8] {
        let end = self.offset + (self.data.len() - self.alignment);
        &self.data[self.offset..end]
    }

    /// Get aligned mutable slice
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        let end = self.offset + (self.data.len() - self.alignment);
        &mut self.data[self.offset..end]
    }

    /// Get usable length
    pub fn len(&self) -> usize {
        self.data.len() - self.alignment
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Get alignment
    pub fn alignment(&self) -> usize {
        self.alignment
    }

    /// Check if properly aligned
    pub fn is_aligned(&self) -> bool {
        let ptr = self.data.as_ptr() as usize + self.offset;
        ptr % self.alignment == 0
    }
}

impl Deref for AlignedBuffer {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        self.as_slice()
    }
}

impl DerefMut for AlignedBuffer {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.as_mut_slice()
    }
}

/// Zero-copy slice reference
#[derive(Debug, Clone)]
pub struct ZeroCopySlice<'a> {
    /// Data reference
    data: &'a [u8],
    /// Offset within data
    offset: usize,
    /// Length
    length: usize,
}

impl<'a> ZeroCopySlice<'a> {
    /// Create a new zero-copy slice
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            offset: 0,
            length: data.len(),
        }
    }

    /// Create a subslice
    pub fn slice(&self, start: usize, end: usize) -> SpkResult<Self> {
        if start > end || end > self.length {
            return Err(SpkError::InvalidRange(format!(
                "Invalid slice range {}..{} for length {}",
                start, end, self.length
            )));
        }
        
        Ok(Self {
            data: self.data,
            offset: self.offset + start,
            length: end - start,
        })
    }

    /// Get data
    pub fn as_bytes(&self) -> &[u8] {
        &self.data[self.offset..self.offset + self.length]
    }

    /// Get length
    pub fn len(&self) -> usize {
        self.length
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }

    /// Split at position
    pub fn split_at(&self, pos: usize) -> SpkResult<(Self, Self)> {
        if pos > self.length {
            return Err(SpkError::InvalidRange(format!(
                "Split position {} exceeds length {}",
                pos, self.length
            )));
        }
        
        Ok((
            Self {
                data: self.data,
                offset: self.offset,
                length: pos,
            },
            Self {
                data: self.data,
                offset: self.offset + pos,
                length: self.length - pos,
            },
        ))
    }
}

impl<'a> AsRef<[u8]> for ZeroCopySlice<'a> {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

/// Shared buffer for zero-copy across threads
#[derive(Debug, Clone)]
pub struct SharedBuffer {
    /// Arc-wrapped data
    data: Arc<Vec<u8>>,
    /// Offset
    offset: usize,
    /// Length
    length: usize,
}

impl SharedBuffer {
    /// Create a new shared buffer
    pub fn new(data: Vec<u8>) -> Self {
        let length = data.len();
        Self {
            data: Arc::new(data),
            offset: 0,
            length,
        }
    }

    /// Create from Arc
    pub fn from_arc(data: Arc<Vec<u8>>) -> Self {
        let length = data.len();
        Self {
            data,
            offset: 0,
            length,
        }
    }

    /// Create a subslice (zero-copy)
    pub fn slice(&self, start: usize, end: usize) -> SpkResult<Self> {
        if start > end || end > self.length {
            return Err(SpkError::InvalidRange(format!(
                "Invalid slice range {}..{} for length {}",
                start, end, self.length
            )));
        }
        
        Ok(Self {
            data: Arc::clone(&self.data),
            offset: self.offset + start,
            length: end - start,
        })
    }

    /// Get data
    pub fn as_bytes(&self) -> &[u8] {
        &self.data[self.offset..self.offset + self.length]
    }

    /// Get length
    pub fn len(&self) -> usize {
        self.length
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }

    /// Get reference count
    pub fn ref_count(&self) -> usize {
        Arc::strong_count(&self.data)
    }

    /// Try to get mutable access
    pub fn try_make_mut(&mut self) -> Option<&mut [u8]> {
        if self.offset == 0 && self.length == self.data.len() {
            Arc::get_mut(&mut self.data).map(|v| v.as_mut_slice())
        } else {
            None
        }
    }
}

impl AsRef<[u8]> for SharedBuffer {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

/// Ring buffer for streaming zero-copy
pub struct RingBuffer {
    /// Buffer data
    data: Vec<u8>,
    /// Read position
    read_pos: usize,
    /// Write position
    write_pos: usize,
    /// Capacity
    capacity: usize,
}

impl RingBuffer {
    /// Create a new ring buffer
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0u8; capacity],
            read_pos: 0,
            write_pos: 0,
            capacity,
        }
    }

    /// Get available read bytes
    pub fn available(&self) -> usize {
        if self.write_pos >= self.read_pos {
            self.write_pos - self.read_pos
        } else {
            self.capacity - self.read_pos + self.write_pos
        }
    }

    /// Get available write space
    pub fn space(&self) -> usize {
        self.capacity - self.available() - 1
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.read_pos == self.write_pos
    }

    /// Check if full
    pub fn is_full(&self) -> bool {
        (self.write_pos + 1) % self.capacity == self.read_pos
    }

    /// Write data
    pub fn write(&mut self, data: &[u8]) -> SpkResult<usize> {
        let space = self.space();
        let to_write = data.len().min(space);
        
        if to_write == 0 {
            return Ok(0);
        }

        for i in 0..to_write {
            self.data[self.write_pos] = data[i];
            self.write_pos = (self.write_pos + 1) % self.capacity;
        }

        Ok(to_write)
    }

    /// Read data
    pub fn read(&mut self, buf: &mut [u8]) -> SpkResult<usize> {
        let available = self.available();
        let to_read = buf.len().min(available);
        
        if to_read == 0 {
            return Ok(0);
        }

        for i in 0..to_read {
            buf[i] = self.data[self.read_pos];
            self.read_pos = (self.read_pos + 1) % self.capacity;
        }

        Ok(to_read)
    }

    /// Peek data without consuming
    pub fn peek(&self, buf: &mut [u8]) -> usize {
        let available = self.available();
        let to_peek = buf.len().min(available);
        
        let mut pos = self.read_pos;
        for i in 0..to_peek {
            buf[i] = self.data[pos];
            pos = (pos + 1) % self.capacity;
        }

        to_peek
    }

    /// Clear the buffer
    pub fn clear(&mut self) {
        self.read_pos = 0;
        self.write_pos = 0;
    }
}

impl Read for RingBuffer {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        RingBuffer::read(self, buf)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    }
}

impl Write for RingBuffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        RingBuffer::write(self, buf)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Memory pool for buffer reuse
pub struct BufferPool {
    /// Pool of available buffers
    buffers: std::sync::Mutex<Vec<Vec<u8>>>,
    /// Buffer size
    buffer_size: usize,
    /// Max buffers in pool
    max_buffers: usize,
    /// Allocated count
    allocated: std::sync::atomic::AtomicUsize,
}

impl BufferPool {
    /// Create a new buffer pool
    pub fn new(buffer_size: usize, max_buffers: usize) -> Self {
        Self {
            buffers: std::sync::Mutex::new(Vec::with_capacity(max_buffers)),
            buffer_size,
            max_buffers,
            allocated: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// Get a buffer from the pool
    pub fn acquire(&self) -> PooledBuffer<'_> {
        let buffer = {
            let mut buffers = self.buffers.lock().unwrap();
            buffers.pop()
        };

        let data = buffer.unwrap_or_else(|| {
            self.allocated.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            vec![0u8; self.buffer_size]
        });

        PooledBuffer {
            data: Some(data),
            pool: self,
        }
    }

    /// Return a buffer to the pool
    fn release(&self, mut buffer: Vec<u8>) {
        let mut buffers = self.buffers.lock().unwrap();
        if buffers.len() < self.max_buffers {
            buffer.clear();
            buffer.resize(self.buffer_size, 0);
            buffers.push(buffer);
        } else {
            self.allocated.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// Get pool statistics
    pub fn stats(&self) -> BufferPoolStats {
        let pooled = self.buffers.lock().unwrap().len();
        BufferPoolStats {
            pooled_buffers: pooled,
            allocated_buffers: self.allocated.load(std::sync::atomic::Ordering::Relaxed),
            buffer_size: self.buffer_size,
            max_buffers: self.max_buffers,
        }
    }
}

/// Buffer pool statistics
#[derive(Debug, Clone)]
pub struct BufferPoolStats {
    pub pooled_buffers: usize,
    pub allocated_buffers: usize,
    pub buffer_size: usize,
    pub max_buffers: usize,
}

/// Pooled buffer that returns to pool on drop
pub struct PooledBuffer<'a> {
    data: Option<Vec<u8>>,
    pool: &'a BufferPool,
}

impl<'a> PooledBuffer<'a> {
    /// Get mutable access to buffer
    pub fn as_mut(&mut self) -> &mut Vec<u8> {
        self.data.as_mut().unwrap()
    }
}

impl<'a> Deref for PooledBuffer<'a> {
    type Target = Vec<u8>;

    fn deref(&self) -> &Self::Target {
        self.data.as_ref().unwrap()
    }
}

impl<'a> DerefMut for PooledBuffer<'a> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.data.as_mut().unwrap()
    }
}

impl<'a> Drop for PooledBuffer<'a> {
    fn drop(&mut self) {
        if let Some(buffer) = self.data.take() {
            self.pool.release(buffer);
        }
    }
}

/// Direct I/O wrapper for bypassing OS cache
#[cfg(unix)]
pub struct DirectIO {
    file: std::fs::File,
    alignment: usize,
}

#[cfg(unix)]
impl DirectIO {
    /// Open file with O_DIRECT
    pub fn open(path: &std::path::Path) -> SpkResult<Self> {
        use std::os::unix::fs::OpenOptionsExt;
        
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECT)
            .open(path)?;
        
        Ok(Self {
            file,
            alignment: PAGE_SIZE,
        })
    }

    /// Read with alignment
    pub fn read_aligned(&mut self, buf: &mut AlignedBuffer) -> SpkResult<usize> {
        use std::io::Read;
        let n = self.file.read(buf.as_mut_slice())?;
        Ok(n)
    }
}

/// Memory-mapped file for zero-copy
pub struct MappedFile {
    /// Memory map
    #[allow(dead_code)]
    mmap: memmap2::Mmap,
}

impl MappedFile {
    /// Open a file for memory mapping
    pub fn open(path: &std::path::Path) -> SpkResult<Self> {
        let file = std::fs::File::open(path)?;
        let mmap = unsafe { memmap2::Mmap::map(&file)? };
        Ok(Self { mmap })
    }

    /// Get data slice
    pub fn as_slice(&self) -> &[u8] {
        &self.mmap
    }

    /// Get length
    pub fn len(&self) -> usize {
        self.mmap.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.mmap.is_empty()
    }

    /// Get slice at offset
    pub fn slice(&self, offset: usize, len: usize) -> SpkResult<&[u8]> {
        if offset + len > self.mmap.len() {
            return Err(SpkError::InvalidRange(format!(
                "Slice {}..{} exceeds file length {}",
                offset, offset + len, self.mmap.len()
            )));
        }
        Ok(&self.mmap[offset..offset + len])
    }
}

impl Deref for MappedFile {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.mmap
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aligned_buffer() {
        let buf = AlignedBuffer::simd_aligned(1024);
        assert!(buf.is_aligned());
        assert_eq!(buf.len(), 1024);
    }

    #[test]
    fn test_zero_copy_slice() {
        let data = vec![1u8, 2, 3, 4, 5];
        let slice = ZeroCopySlice::new(&data);
        
        let sub = slice.slice(1, 4).unwrap();
        assert_eq!(sub.as_bytes(), &[2, 3, 4]);
    }

    #[test]
    fn test_shared_buffer() {
        let buf = SharedBuffer::new(vec![1, 2, 3, 4, 5]);
        let sub = buf.slice(1, 4).unwrap();
        
        assert_eq!(sub.as_bytes(), &[2, 3, 4]);
        assert_eq!(buf.ref_count(), 2);
    }

    #[test]
    fn test_ring_buffer() {
        let mut ring = RingBuffer::new(16);
        
        ring.write(b"hello").unwrap();
        assert_eq!(ring.available(), 5);
        
        let mut buf = [0u8; 5];
        ring.read(&mut buf).unwrap();
        assert_eq!(&buf, b"hello");
        assert!(ring.is_empty());
    }

    #[test]
    fn test_buffer_pool() {
        let pool = BufferPool::new(1024, 4);
        
        let buf1 = pool.acquire();
        let buf2 = pool.acquire();
        
        assert_eq!(pool.stats().allocated_buffers, 2);
        
        drop(buf1);
        assert_eq!(pool.stats().pooled_buffers, 1);
        
        drop(buf2);
        assert_eq!(pool.stats().pooled_buffers, 2);
    }
}
