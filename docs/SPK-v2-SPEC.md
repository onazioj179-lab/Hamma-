# SPK v2 Format Specification

**Version:** 2.0.0  
**Date:** December 21, 2025  
**Status:** Final Specification

---

## Overview

SPK v2 is a **content-addressed, sharded, deduplication-aware** archive format designed for 10TB-100TB datasets. Unlike v1's linear offset-based model, v2 uses:

- Content-defined chunks (CDC) with content-based addressing
- Global deduplication via chunk fingerprints
- Dictionary-based compression clusters
- Multiple volume files (shards) instead of monolithic archives
- Resume-capable checkpointing

**Backward Compatibility:** v2 can read v1 archives but v1 cannot read v2.

---

## File Structure

SPK v2 is a **directory**, not a single file:

```
archive.spk/
├── manifest.json          # Logical file tree (JSON, human-readable)
├── chunks.index           # Binary index: hash -> volume location
├── dictionaries/          # Compression dictionaries
│   ├── dict_000.zdict
│   ├── dict_001.zdict
│   └── manifest.json      # Dict metadata
├── volumes/               # Sharded data volumes
│   ├── vol_000.spk       # Max 10GB each
│   ├── vol_001.spk
│   ├── vol_002.spk
│   └── ...
└── checkpoints/           # Resume state (optional, can be deleted after completion)
    ├── checkpoint_<timestamp>.json
    └── ...
```

---

## 1. Manifest (manifest.json)

**Purpose:** Logical file tree and metadata. Human-readable.

**Format:** JSON

**Structure:**
```json
{
  "version": "2.0.0",
  "created": "2025-12-21T10:00:00Z",
  "spk_id": "550e8400-e29b-41d4-a716-446655440000",
  
  "statistics": {
    "total_size_raw": 107374182400,
    "total_size_compressed": 12884901888,
    "compression_ratio": 8.33,
    "dedup_ratio": 6.2,
    "file_count": 8432,
    "chunk_count": 6553600,
    "unique_chunk_count": 1048576
  },
  
  "dictionaries": [
    {
      "id": 0,
      "name": "cluster_logs",
      "version": "v3_20251221",
      "hash": "blake3:a1b2c3d4...",
      "size": 131072,
      "trained_on": "2025-12-21T09:00:00Z"
    }
  ],
  
  "files": [
    {
      "path": "data/logs/app.log",
      "size": 10737418240,
      "modified": "2025-12-20T14:32:00Z",
      "permissions": "0644",
      "chunks": [
        {
          "hash": "blake3:abc123...",
          "offset_in_file": 0,
          "size_raw": 16777216,
          "size_compressed": 2097152,
          "dict_id": 0
        },
        {
          "hash": "blake3:def456...",
          "offset_in_file": 16777216,
          "size_raw": 16777216,
          "size_compressed": 2097152,
          "dict_id": 0
        }
      ]
    }
  ]
}
```

**Fields:**

- `version`: SPK format version (semver)
- `spk_id`: Unique archive identifier (UUID v4)
- `statistics`: Aggregate metrics
- `dictionaries`: List of compression dictionaries used
- `files`: Array of logical files with chunk references

**Design Notes:**
- JSON for human readability and tooling compatibility
- Can be regenerated from chunks.index if lost
- Stored last (atomic write after all data confirmed)

---

## 2. Chunk Index (chunks.index)

**Purpose:** Fast lookup from chunk hash to volume location. Binary format.

**Format:** Custom binary (LMDB database)

**Schema:**
```
Key: BLAKE3 hash (32 bytes)
Value: ChunkLocation {
    volume_id: u32,          // Which volume file
    offset: u64,             // Byte offset in volume
    size_compressed: u32,    // Compressed size
    size_raw: u32,           // Original size
    dict_id: u32,            // Dictionary ID (0xFFFFFFFF if none)
    refcount: u32,           // Number of references
    flags: u16               // Compression flags
}
```

**Why LMDB:**
- Memory-mapped (fast, OS-cached)
- Crash-safe (ACID transactions)
- Handles millions of entries efficiently
- No manual compaction needed

**Operations:**
- Lookup: O(1) by hash
- Insert: O(log n) with transaction
- Update refcount: Atomic increment/decrement

---

## 3. Dictionaries (dictionaries/)

**Purpose:** Store trained compression dictionaries.

### Dictionary Files (dict_XXX.zdict)

**Format:** ZSTD dictionary format (binary)

**Naming:** `dict_<id>.zdict` where `<id>` is zero-padded 3-digit number.

**Max Size:** 128KB per dictionary (ZSTD recommendation)

### Dictionary Manifest (dictionaries/manifest.json)

```json
{
  "dictionaries": [
    {
      "id": 0,
      "name": "cluster_logs",
      "file": "dict_000.zdict",
      "hash": "blake3:...",
      "size": 131072,
      "cluster_info": {
        "file_patterns": ["*.log", "*.txt"],
        "entropy_range": [3.5, 6.0],
        "sample_size": 524288000
      },
      "training": {
        "method": "zstd_train",
        "samples": 2048,
        "timestamp": "2025-12-21T09:00:00Z"
      },
      "performance": {
        "avg_ratio": 8.2,
        "speed_mbs": 450
      }
    }
  ]
}
```

**Dictionary Selection Logic:**
- HAMMA assigns cluster ID based on file type/entropy
- Compression uses dict_<cluster_id>.zdict
- Missing dict = compress without dictionary

---

## 4. Volumes (volumes/)

**Purpose:** Store actual compressed chunk data in 10GB shards.

### Volume File Format (vol_XXX.spk)

**Binary Structure:**

```
[Volume Header: 4096 bytes]
    Magic:              [8 bytes] "SPK2VOL\0"
    Version:            [4 bytes] uint32 (major << 16 | minor)
    Volume ID:          [4 bytes] uint32
    Chunk Count:        [8 bytes] uint64
    Index Offset:       [8 bytes] uint64 (byte offset to chunk index)
    Flags:              [4 bytes] uint32
    Reserved:           [4060 bytes] zeros (future use)

[Chunk Data Section]
    Chunk 0: [variable size, compressed blob]
    Chunk 1: [variable size, compressed blob]
    ...

[Chunk Index Section]
    Per Chunk Entry [48 bytes]:
        Hash:               [32 bytes] BLAKE3
        Offset:             [8 bytes] uint64 (from start of data section)
        Size Compressed:    [4 bytes] uint32
        Size Raw:           [4 bytes] uint32
        Dict ID:            [4 bytes] uint32 (0xFFFFFFFF if no dict)
        Flags:              [2 bytes] uint16
        Reserved:           [2 bytes] zeros
```

**Flags:**
```
bit 0: Compressed (1) or raw (0)
bit 1: Dictionary used (1) or not (0)
bit 2-15: Reserved
```

**Max Volume Size:** 10GB
- Prevents huge files that are unwieldy to move/replicate
- Allows parallel I/O across volumes
- Failure domain is limited to one volume

**Volume Naming:** `vol_<id>.spk` where `<id>` is zero-padded 3-digit number.

---

## 5. Checkpoints (checkpoints/)

**Purpose:** Enable resume after crash/interruption.

**Format:** JSON

**Structure:**
```json
{
  "timestamp": "2025-12-21T12:34:56Z",
  "state": "compressing",
  "progress": {
    "bytes_processed": 32212254720,
    "bytes_total": 107374182400,
    "percent": 30.0,
    "files_processed": 1543,
    "files_total": 8432
  },
  "last_completed": {
    "file": "data/images/img_9876.jpg",
    "chunk_hash": "blake3:xyz789..."
  },
  "dedup_store": {
    "path": "chunks.index",
    "chunk_count": 2097152,
    "size_bytes": 100663296
  },
  "volumes": {
    "current_volume": 3,
    "volumes_completed": [0, 1, 2],
    "current_offset": 5368709120
  }
}
```

**Checkpoint Frequency:**
- Every 10GB processed OR
- Every 10 minutes OR
- On user signal (SIGUSR1)

**Recovery Process:**
1. Load latest checkpoint
2. Verify dedup store consistency (LMDB has built-in checks)
3. Reopen last volume file
4. Resume from last_completed.file + 1
5. Delete checkpoints after successful completion

---

## Content-Defined Chunking (CDC)

**Algorithm:** Gear hash (rolling hash)

**Parameters:**
```rust
const MIN_CHUNK_SIZE: usize = 4 * 1024 * 1024;   // 4MB
const TARGET_CHUNK_SIZE: usize = 16 * 1024 * 1024; // 16MB
const MAX_CHUNK_SIZE: usize = 64 * 1024 * 1024;  // 64MB
const MASK_BITS: u32 = 18;  // 1/262144 trigger probability
const MASK: u64 = (1 << MASK_BITS) - 1;
const PATTERN: u64 = 0;
```

**Chunking Logic:**
```rust
fn chunk_stream(input: &mut Read) -> Vec<ChunkBoundary> {
    let mut boundaries = vec![];
    let mut hasher = GearHasher::new();
    let mut pos = 0;
    let mut last_boundary = 0;
    
    for byte in input.bytes() {
        let b = byte?;
        hasher.roll(b);
        pos += 1;
        
        let is_boundary = (hasher.hash & MASK) == PATTERN;
        let min_reached = (pos - last_boundary) >= MIN_CHUNK_SIZE;
        let max_reached = (pos - last_boundary) >= MAX_CHUNK_SIZE;
        
        if (is_boundary && min_reached) || max_reached {
            boundaries.push(ChunkBoundary {
                offset: last_boundary,
                size: pos - last_boundary
            });
            last_boundary = pos;
        }
    }
    
    // Final chunk
    if pos > last_boundary {
        boundaries.push(ChunkBoundary {
            offset: last_boundary,
            size: pos - last_boundary
        });
    }
    
    boundaries
}
```

**Why These Parameters:**
- 4MB min: Avoid excessive overhead (dedup index, I/O)
- 16MB target: Balance between dedup granularity and throughput
- 64MB max: Prevent pathological cases (e.g., huge runs of zeros)
- Mask bits 18: ~262K trigger rate = ~16MB average

---

## Fingerprinting

**Hash Algorithm:** BLAKE3

**Why BLAKE3:**
- 5x faster than SHA-256
- Collision-resistant (256-bit output)
- Designed for content addressing
- Hardware-accelerated on modern CPUs

**Usage:**
```rust
use blake3::hash;

let chunk_data: &[u8] = ...;
let fingerprint = hash(chunk_data);  // 32 bytes
```

**Collision Probability:** 
- At 10^15 chunks (1 exabyte at 1MB/chunk): ~10^-39 (negligible)
- Astronomically unlikely to matter in practice

---

## Compression Strategy

**Default Codec:** ZSTD

**Compression Levels:**
- **Fast mode:** ZSTD level 3 (no dict)
- **Balanced mode:** ZSTD level 10 (with dict)
- **Max mode:** ZSTD level 19 (with dict, slow)

**Dictionary Assignment:**
```rust
fn compress_chunk(chunk: &[u8], cluster_id: u32, dicts: &DictStore) -> Vec<u8> {
    let dict = dicts.get(cluster_id);
    match dict {
        Some(d) => zstd::compress_with_dict(chunk, d, LEVEL),
        None => zstd::compress(chunk, LEVEL)
    }
}
```

**When to Skip Compression:**
- Entropy > 7.5 bits/byte (near-random)
- Already compressed format (detected by magic bytes)
- Chunk < 1MB and trial compression has negative gain

---

## Deduplication Model

**Dedup Scope:** Global across all files in archive.

**Dedup Check:**
```rust
fn should_compress(chunk_hash: &[u8], dedup_store: &mut DedupStore) -> bool {
    match dedup_store.lookup(chunk_hash) {
        Some(location) => {
            dedup_store.increment_refcount(chunk_hash);
            false  // Already exists, skip compression
        },
        None => {
            true  // New chunk, compress and store
        }
    }
}
```

**Refcounting:**
- Increment on each reference
- Decrement on file deletion
- Garbage collect when refcount=0

**Dedup Granularity:** Chunk-level (not byte-level, too expensive).

---

## Extraction Process

**Step 1:** Load manifest.json

**Step 2:** For each file to extract:
```rust
for chunk_ref in file.chunks {
    // Lookup chunk location
    let location = chunks_index.lookup(&chunk_ref.hash)?;
    
    // Open volume file
    let volume = volumes.open(location.volume_id)?;
    
    // Seek and read compressed chunk
    volume.seek(location.offset)?;
    let compressed = volume.read(location.size_compressed)?;
    
    // Decompress
    let dict = if location.dict_id != 0xFFFFFFFF {
        Some(dicts.load(location.dict_id)?)
    } else {
        None
    };
    let raw = zstd::decompress_with_dict(&compressed, dict)?;
    
    // Verify hash
    assert_eq!(blake3::hash(&raw), chunk_ref.hash);
    
    // Write to output
    output.write_all(&raw)?;
}
```

**Parallel Extraction:**
- Multiple files can be extracted concurrently
- Each file's chunks are processed in order
- Volumes can be read in parallel (different file handles)

---

## Integrity Verification

**Three Levels:**

1. **Chunk-level:** BLAKE3 hash per chunk (always verified on read)
2. **Volume-level:** Optional SHA-256 of entire volume (for transport)
3. **Archive-level:** Manifest hash covers entire logical structure

**Verification Command:**
```bash
spk verify archive.spk
```

**Steps:**
1. Load manifest
2. For each chunk reference:
   - Read compressed chunk from volume
   - Decompress
   - Verify BLAKE3 hash matches
3. Report any mismatches

**Incremental Verify:** Verify only chunks accessed since last verify (via access log).

---

## Backward Compatibility

**v2 Reading v1:**
- Detect v1 by magic number
- Convert offset-based chunks to hash-based (hash on the fly)
- No dictionary support (v1 didn't have it)
- Extract normally

**v1 Reading v2:**
- Not supported (format is fundamentally different)
- Error message: "SPK v2 format requires spk v2.0+ to extract"

---

## Migration from v1 to v2

**Tool:** `spk migrate`

**Process:**
1. Open v1 archive
2. Extract to temp (decompress all)
3. Re-chunk with CDC
4. Dedup and compress with dicts
5. Write v2 archive
6. Verify integrity

**Time:** ~2x the size of original archive (read + write + rechunk).

**Alternative:** Leave v1 as-is, v2 for new archives.

---

## Performance Characteristics

**Compression Throughput:**
- Single-threaded: 200-500 MB/s (depends on data type)
- Multi-threaded: 2-8 GB/s (64-core system)

**Dedup Lookup:**
- Index in memory: <1μs per lookup
- Index on SSD: <100μs per lookup

**Extraction Throughput:**
- Sequential: 1-3 GB/s (limited by decompression)
- Random access: 100-500 MB/s (depends on seek patterns)

**Memory Usage:**
- Dedup index: ~40 bytes/chunk (6M chunks = 240MB)
- Dictionaries: ~100MB total (all loaded)
- Chunk buffers: 16MB × threads

---

## File Format Summary Table

| Component | Format | Size | Purpose |
|-----------|--------|------|---------|
| manifest.json | JSON | 10-100MB | Logical file tree |
| chunks.index | LMDB | 40B/chunk | Hash → location map |
| dict_XXX.zdict | ZSTD dict | 128KB each | Compression dictionaries |
| vol_XXX.spk | Binary | 10GB max | Compressed chunk blobs |
| checkpoint.json | JSON | 1-10KB | Resume state |

---

## Implementation Notes

**Multi-threading:**
- Chunking: 16-32 threads (I/O bound)
- Compression: All cores (CPU bound)
- Extraction: 4-8 threads (balanced)

**I/O Optimization:**
- Use `mmap` for large reads
- Batch writes to volumes (64MB buffer)
- Pre-allocate volume files (avoid fragmentation)

**Error Handling:**
- Transactional writes (atomic renames)
- Verify after write (hash check)
- Retry on transient errors (network, disk)

**Monitoring:**
- JSON progress output (for scripting)
- Metrics: bytes/sec, chunks/sec, dedup hit rate
- ETA calculation (rolling average)

---

## Security Considerations

**Not Encrypted by Default:**
- SPK v2 does not include built-in encryption
- Use external encryption (LUKS, dm-crypt, EncFS) if needed
- Rationale: Encryption is orthogonal to compression

**Hash Collisions:**
- BLAKE3 is collision-resistant
- Probability of collision is negligible
- If collision detected, store chunk anyway with alternate ID

**Malicious Archives:**
- Decompression bombs: Limited by MAX_CHUNK_SIZE (64MB)
- Path traversal: Sanitize file paths during extraction
- Symlink attacks: Extract to temp, then move

---

## Future Extensions (Not in v2.0)

**Possible v2.1+ Features:**
- Delta encoding (store diffs between similar chunks)
- Erasure coding (for redundancy)
- Remote backends (S3, Azure, etc.)
- Encryption layer (AES-256-GCM per volume)
- Compression algorithm plugins

**Not Planned:**
- Neural compression (too slow, marginal gains)
- Browser support (not feasible at scale)
- Real-time streaming (batch is the only realistic mode)

---

## Conclusion

SPK v2 is a production-ready format for 10TB-100TB archives. It prioritizes:
- Deduplication (biggest wins)
- Dictionary compression (2-3x additional gain)
- Failure tolerance (checkpoints, sharding)
- Scalability (constant memory, linear time)

It does NOT promise magic, only engineering.
