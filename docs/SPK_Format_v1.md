# SPK Format Specification v1.0

## Overview

The Singularity Pack (SPK) format is an enterprise-grade lossless compression archive format designed to handle files from kilobytes to 1024+ terabytes efficiently.

## Design Goals

- **Streaming**: Process files without loading entire archives into memory
- **Scalability**: Support files up to 1024 TB and beyond
- **Deduplication**: SHA-256 based chunk deduplication
- **Encryption**: AES-256-GCM with Argon2id key derivation
- **Partial Extraction**: Extract individual files without decompressing entire archive
- **Resumable**: Pause and resume compression/decompression operations
- **Multi-codec**: Support for zstd, lz4, brotli codecs

## File Structure

```
┌─────────────────────────────────────┐
│ Header (64 bytes, fixed)            │
├─────────────────────────────────────┤
│ Manifest (zstd-compressed JSON)     │
├─────────────────────────────────────┤
│ Chunk Table (49 bytes per entry)    │
├─────────────────────────────────────┤
│ Data Section (compressed chunks)    │
├─────────────────────────────────────┤
│ Footer (optional, recovery records) │
└─────────────────────────────────────┘
```

## Header Format (64 bytes)

| Offset | Size | Field              | Description                    |
|--------|------|--------------------|--------------------------------|
| 0      | 4    | magic              | "SPK1" (0x53504B31)            |
| 4      | 2    | version            | Format version (u16 LE)        |
| 6      | 2    | flags              | Feature flags (u16 LE)         |
| 8      | 8    | manifest_offset    | Offset to manifest (u64 LE)    |
| 16     | 8    | chunk_table_offset | Offset to chunk table (u64 LE) |
| 24     | 8    | data_section_offset| Offset to data section (u64 LE)|
| 32     | 8    | footer_offset      | Offset to footer (u64 LE)      |
| 40     | 24   | reserved           | Reserved for future use        |

### Header Flags

| Bit | Name              | Description                        |
|-----|-------------------|------------------------------------|
| 0   | ENCRYPTED         | Data section is encrypted          |
| 1   | HAS_RECOVERY      | Footer contains recovery records   |
| 2   | MULTIPART         | Archive is split across files      |
| 3   | VERSIONED         | Archive contains version history   |
| 4   | CBOR_MANIFEST     | Manifest is CBOR instead of JSON   |
| 5-15| reserved          | Reserved for future use            |

## Manifest Format

The manifest is a zstd-compressed JSON document (or CBOR if flag set):

```json
{
  "created": 1700000000,
  "creator": "spk-core 1.0.0",
  "comment": "Optional archive comment",
  "files": [
    {
      "path": "folder/file.txt",
      "size": 12345,
      "mode": 420,
      "created": 1700000000,
      "modified": 1700000000,
      "chunk_start": 0,
      "chunk_count": 3,
      "hash": "sha256hex..."
    }
  ],
  "metadata": {
    "total_files": 100,
    "total_size": 1234567890,
    "dedup_savings": 123456
  }
}
```

## Chunk Table Format

Each chunk entry is exactly 49 bytes:

| Offset | Size | Field           | Description                    |
|--------|------|-----------------|--------------------------------|
| 0      | 8    | offset          | Offset in data section (u64)   |
| 8      | 4    | compressed_size | Size after compression (u32)   |
| 12     | 4    | original_size   | Size before compression (u32)  |
| 16     | 1    | codec           | Compression codec (u8)         |
| 17     | 32   | hash            | SHA-256 hash of original data  |

### Codec Values

| Value | Codec   | Description                |
|-------|---------|----------------------------|
| 0x00  | None    | Stored (no compression)    |
| 0x01  | Zstd    | Zstandard compression      |
| 0x02  | Lz4     | LZ4 compression            |
| 0x03  | Brotli  | Brotli compression         |

## Data Section

The data section contains compressed chunks in sequence. Each chunk is independently compressed and can be:
- Read in parallel
- Extracted without decompressing other chunks
- Verified independently using its SHA-256 hash

## Encryption (V2)

When encryption is enabled (flag bit 0):

1. **Key Derivation**: Argon2id with:
   - Memory: 64 MB
   - Iterations: 3
   - Parallelism: 4
   - Salt: 32 bytes (stored in extended header)

2. **Encryption**: AES-256-GCM
   - Nonce: 12 bytes per chunk
   - Tag: 16 bytes per chunk
   - Only the DATA SECTION is encrypted (header/manifest remain readable)

## Chunking Strategy

### V1: Fixed Chunking
- Default chunk size: 4 MB
- Minimum: 1 MB
- Maximum: 16 MB

### V4: Adaptive Chunking
- Content-defined chunking using Gear hash
- Target: 4 MB average
- Range: 1-16 MB
- Better deduplication across similar files

## Deduplication

Chunks are deduplicated using SHA-256 hashes:
1. Compute hash of uncompressed chunk
2. Check if hash exists in dedup index
3. If exists, reference existing chunk
4. If new, compress and store chunk

## Multipart Archives (V3)

Large archives can be split into multiple files:
- Naming: `archive.spk.001`, `archive.spk.002`, etc.
- Each part has minimal header pointing to main archive
- Chunk table entries include part number

## Version History (V5)

Versioned archives store delta history:
- Each version references base chunks
- New/modified chunks stored as deltas
- Support for version checkout and diff

## Error Recovery (V2)

Optional Reed-Solomon error correction:
- Configurable redundancy (1-30%)
- Stored in footer section
- Can recover from partial data loss

## Streaming Protocol

For files > 2GB, streaming mode is used:
1. Write header with placeholder offsets
2. Stream chunks to data section
3. Build chunk table in memory
4. Write chunk table
5. Write manifest
6. Update header offsets

## Size Limits

| Item              | Limit        |
|-------------------|--------------|
| Archive size      | 1024 TB      |
| Single file       | 1024 TB      |
| Chunk size        | 16 MB        |
| Path length       | 65535 bytes  |
| File count        | 2^64         |
| Chunk count       | 2^64         |

## Compatibility

- Forward compatible: Unknown flags ignored
- Backward compatible: V1 readers can read basic structure
- Version field indicates required feature support
