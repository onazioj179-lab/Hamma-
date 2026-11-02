//! Compatibility fixes for streaming_engine and media modules
//! 
//! This file documents all the API changes needed to align with existing SPK core structures

use crate::utils::error::SpkError;

// SpkError API:
// [OK] SpkError::Io(io::Error) - from io::Error automatically via #[from]
// [OK] SpkError::CompressionError(String)
// [OK] SpkError::DecompressionError(String)
// [OK] SpkError::Serialization(String)
// [X] SpkError::IoError - DOES NOT EXIST, use SpkError::Io
// [X] SpkError::UnsupportedCodec - DOES NOT EXIST, use SpkError::InvalidFormat or SpkError::CompressionError

// Header API:
// [OK] header.flags.set(HeaderFlags::MANIFEST_COMPRESSED)
// [X] header.set_flag() - DOES NOT EXIST
// [X] HeaderFlags::COMPRESSED - DOES NOT EXIST, use HeaderFlags::MANIFEST_COMPRESSED
// [OK] header.total_chunks: u64
// [OK] header.manifest_offset: u64
// [OK] header.chunk_table_offset: u64
// [X] header.chunk_count - DOES NOT EXIST, use header.total_chunks
// [X] header.manifest_size - DOES NOT EXIST (not stored in fixed header)
// [X] header.chunk_table_size - DOES NOT EXIST (not stored in fixed header)
// [X] header.original_size - DOES NOT EXIST (not stored in fixed header)
// [OK] header.to_bytes() -> SpkResult<[u8; 64]>

// ChunkEntry API:
// [OK] compressed_size: u32
// [OK] uncompressed_size: u32
// [OK] offset: u64
// [OK] hash: [u8; 32]
// [OK] codec: Codec
// [X] original_size - DOES NOT EXIST, use uncompressed_size

// ChunkTable API:
// [OK] ChunkTable { entries: Vec<ChunkEntry> }
// Note: ChunkTable needs #[derive(Serialize, Deserialize)] for bincode

// Manifest API:
// [OK] manifest.add_file(FileEntry { ... })
// [X] manifest.add_file(name, size, chunks) - DOES NOT EXIST
// FileEntry needs: path, size, chunk_start, chunk_count

// Codec API:
// [OK] Codec::Zstd
// [OK] Codec::Lz4
// [OK] Codec::Brotli
// [OK] Codec::None

// CompressionLevel API:
// [OK] CompressionLevel::Fast
// [X] CompressionLevel::Default - DOES NOT EXIST
// [OK] CompressionLevel::Best
// Note: Use CompressionLevel::default() for default level

