//! SPK V1 Fixed Header (64 bytes exactly)
//!
//! The header is designed for instant parsing - fixed size, no compression,
//! all offsets are 64-bit for exabyte scale support.

use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use std::io::{Cursor, Read, Write};

use crate::utils::error::{SpkError, SpkResult};

/// Magic bytes: "SPK1"
pub const MAGIC_BYTES: [u8; 4] = [0x53, 0x50, 0x4B, 0x31];

/// Fixed header size: 64 bytes
pub const HEADER_SIZE: usize = 64;

/// Header flags bitfield
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HeaderFlags(u16);

impl HeaderFlags {
    // V1 Flags
    pub const NONE: u16 = 0x0000;
    pub const MANIFEST_COMPRESSED: u16 = 0x0001;
    pub const MANIFEST_CBOR: u16 = 0x0002;  // 0 = JSON, 1 = CBOR
    
    // V2 Flags
    pub const ENCRYPTED: u16 = 0x0004;
    pub const HAS_RECOVERY: u16 = 0x0008;
    pub const RESUMABLE: u16 = 0x0010;
    
    // V3 Flags
    pub const MULTIPART: u16 = 0x0020;
    pub const HAS_PREVIEW: u16 = 0x0040;
    
    // V4 Flags
    pub const ADAPTIVE_CHUNKS: u16 = 0x0080;
    pub const SMART_CODEC: u16 = 0x0100;
    pub const GLOBAL_DEDUP: u16 = 0x0200;
    
    // V5 Flags
    pub const DISTRIBUTED: u16 = 0x0400;
    pub const VERSIONED: u16 = 0x0800;
    pub const VIRTUAL_FS: u16 = 0x1000;

    pub fn new() -> Self {
        Self(Self::MANIFEST_COMPRESSED)
    }

    pub fn from_bits(bits: u16) -> Self {
        Self(bits)
    }

    pub fn bits(&self) -> u16 {
        self.0
    }

    pub fn set(&mut self, flag: u16) {
        self.0 |= flag;
    }

    pub fn clear(&mut self, flag: u16) {
        self.0 &= !flag;
    }

    pub fn has(&self, flag: u16) -> bool {
        self.0 & flag != 0
    }

    pub fn is_encrypted(&self) -> bool {
        self.has(Self::ENCRYPTED)
    }

    pub fn is_multipart(&self) -> bool {
        self.has(Self::MULTIPART)
    }

    pub fn is_versioned(&self) -> bool {
        self.has(Self::VERSIONED)
    }

    pub fn uses_cbor(&self) -> bool {
        self.has(Self::MANIFEST_CBOR)
    }
}

/// SPK V1 Fixed Header - exactly 64 bytes
/// 
/// Layout:
/// - magic_bytes: [4]  "SPK1"
/// - version: u16
/// - flags: u16
/// - manifest_offset: u64
/// - chunk_table_offset: u64
/// - data_section_offset: u64
/// - footer_offset: u64
/// - total_chunks: u64 (V2+)
/// - total_files: u64 (V2+)
/// - reserved: [8]
#[derive(Debug, Clone)]
pub struct Header {
    /// Magic bytes: "SPK1"
    pub magic: [u8; 4],
    /// Format version (1-5)
    pub version: u16,
    /// Feature flags
    pub flags: HeaderFlags,
    /// Offset to manifest section
    pub manifest_offset: u64,
    /// Offset to chunk table
    pub chunk_table_offset: u64,
    /// Offset to data section
    pub data_section_offset: u64,
    /// Offset to footer
    pub footer_offset: u64,
    /// Total number of chunks (V2+)
    pub total_chunks: u64,
    /// Total number of files (V2+)
    pub total_files: u64,
    /// Reserved for future use
    pub reserved: [u8; 8],
}

impl Header {
    /// Create a new V1 header with default values
    pub fn new() -> Self {
        Self {
            magic: MAGIC_BYTES,
            version: 1,
            flags: HeaderFlags::new(),
            manifest_offset: 0,
            chunk_table_offset: 0,
            data_section_offset: 0,
            footer_offset: 0,
            total_chunks: 0,
            total_files: 0,
            reserved: [0; 8],
        }
    }

    /// Create header with specific version
    pub fn with_version(version: u16) -> Self {
        let mut header = Self::new();
        header.version = version;
        header
    }

    /// Parse header from bytes (exactly 64 bytes)
    pub fn from_bytes(data: &[u8]) -> SpkResult<Self> {
        if data.len() < HEADER_SIZE {
            return Err(SpkError::InvalidHeader(format!(
                "Header too small: {} bytes, expected {}",
                data.len(),
                HEADER_SIZE
            )));
        }

        let mut cursor = Cursor::new(data);

        // Read magic bytes
        let mut magic = [0u8; 4];
        cursor.read_exact(&mut magic)?;
        
        if magic != MAGIC_BYTES {
            return Err(SpkError::InvalidHeader(format!(
                "Invalid magic bytes: {:?}, expected {:?}",
                magic, MAGIC_BYTES
            )));
        }

        // Read fields
        let version = cursor.read_u16::<LittleEndian>()?;
        let flags = HeaderFlags::from_bits(cursor.read_u16::<LittleEndian>()?);
        let manifest_offset = cursor.read_u64::<LittleEndian>()?;
        let chunk_table_offset = cursor.read_u64::<LittleEndian>()?;
        let data_section_offset = cursor.read_u64::<LittleEndian>()?;
        let footer_offset = cursor.read_u64::<LittleEndian>()?;
        let total_chunks = cursor.read_u64::<LittleEndian>()?;
        let total_files = cursor.read_u64::<LittleEndian>()?;
        
        let mut reserved = [0u8; 8];
        cursor.read_exact(&mut reserved)?;

        Ok(Self {
            magic,
            version,
            flags,
            manifest_offset,
            chunk_table_offset,
            data_section_offset,
            footer_offset,
            total_chunks,
            total_files,
            reserved,
        })
    }

    /// Serialize header to exactly 64 bytes
    pub fn to_bytes(&self) -> SpkResult<[u8; HEADER_SIZE]> {
        let mut buffer = [0u8; HEADER_SIZE];
        let mut cursor = Cursor::new(&mut buffer[..]);

        cursor.write_all(&self.magic)?;
        cursor.write_u16::<LittleEndian>(self.version)?;
        cursor.write_u16::<LittleEndian>(self.flags.bits())?;
        cursor.write_u64::<LittleEndian>(self.manifest_offset)?;
        cursor.write_u64::<LittleEndian>(self.chunk_table_offset)?;
        cursor.write_u64::<LittleEndian>(self.data_section_offset)?;
        cursor.write_u64::<LittleEndian>(self.footer_offset)?;
        cursor.write_u64::<LittleEndian>(self.total_chunks)?;
        cursor.write_u64::<LittleEndian>(self.total_files)?;
        cursor.write_all(&self.reserved)?;

        Ok(buffer)
    }

    /// Validate header integrity
    pub fn validate(&self) -> SpkResult<()> {
        if self.magic != MAGIC_BYTES {
            return Err(SpkError::InvalidHeader("Invalid magic bytes".into()));
        }

        if self.version == 0 || self.version > 5 {
            return Err(SpkError::InvalidHeader(format!(
                "Unsupported version: {}",
                self.version
            )));
        }

        // Validate offsets are in correct order
        if self.manifest_offset > 0 && self.manifest_offset < HEADER_SIZE as u64 {
            return Err(SpkError::InvalidHeader(
                "Manifest offset overlaps header".into()
            ));
        }

        Ok(())
    }

    /// Check if this archive uses encryption
    pub fn is_encrypted(&self) -> bool {
        self.flags.is_encrypted()
    }

    /// Check if this is a multipart archive
    pub fn is_multipart(&self) -> bool {
        self.flags.is_multipart()
    }

    /// Get the version as a string
    pub fn version_string(&self) -> String {
        format!("V{}", self.version)
    }
}

impl Default for Header {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_header_size() {
        let header = Header::new();
        let bytes = header.to_bytes().unwrap();
        assert_eq!(bytes.len(), 64);
    }

    #[test]
    fn test_header_roundtrip() {
        let mut header = Header::new();
        header.version = 2;
        header.flags.set(HeaderFlags::ENCRYPTED);
        header.manifest_offset = 1024;
        header.chunk_table_offset = 2048;
        header.data_section_offset = 4096;
        header.footer_offset = 8192;
        header.total_chunks = 100;
        header.total_files = 50;

        let bytes = header.to_bytes().unwrap();
        let parsed = Header::from_bytes(&bytes).unwrap();

        assert_eq!(parsed.magic, MAGIC_BYTES);
        assert_eq!(parsed.version, 2);
        assert!(parsed.flags.is_encrypted());
        assert_eq!(parsed.manifest_offset, 1024);
        assert_eq!(parsed.total_chunks, 100);
    }

    #[test]
    fn test_invalid_magic() {
        let mut bytes = [0u8; 64];
        bytes[0..4].copy_from_slice(b"XXXX");
        
        let result = Header::from_bytes(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn test_header_flags() {
        let mut flags = HeaderFlags::new();
        assert!(flags.has(HeaderFlags::MANIFEST_COMPRESSED));
        
        flags.set(HeaderFlags::ENCRYPTED);
        assert!(flags.is_encrypted());
        
        flags.clear(HeaderFlags::ENCRYPTED);
        assert!(!flags.is_encrypted());
    }
}
