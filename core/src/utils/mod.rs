//! Utils module for SPK Core
//!
//! Contains error handling, hashing, chunking, and streaming utilities.

pub mod error;
pub mod hashing;
pub mod chunker;
pub mod streaming;

pub use error::{SpkError, SpkResult};
pub use hashing::{sha256_hash, sha256_hash_reader, crc32_checksum, blake3_hash};
pub use chunker::{ChunkIterator, ChunkConfig};
pub use streaming::{StreamingReader, StreamingWriter};
