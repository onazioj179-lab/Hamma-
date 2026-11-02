//! Sharded Deduplication Store
//!
//! Wrapper around `DedupStore` to support deterministic shard placement.
//!
//! - Shard assignment: hash-based on fingerprint (lower 16 bits).
//! - Append-only per shard, no cross-shard locking.
//! - Backward compatible: shard_id=0 behaves like legacy single store.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::dedup_store::{DedupResult, DedupStore, ChunkLocation, BLAKE3_SIZE};

/// Shard policy configuration
#[derive(Debug, Clone)]
pub struct ShardPolicy {
    /// Total shards (power-of-two recommended)
    pub shard_count: u16,
}

impl Default for ShardPolicy {
    fn default() -> Self {
        Self { shard_count: 16 }
    }
}

/// Sharded deduplication store
pub struct ShardedDedupStore {
    root: PathBuf,
    policy: ShardPolicy,
    shards: HashMap<u16, DedupStore>,
}

impl ShardedDedupStore {
    /// Open sharded store under a root path. Shards are created lazily.
    pub fn open<P: AsRef<Path>>(root: P, policy: ShardPolicy) -> std::io::Result<Self> {
        let root = root.as_ref().to_path_buf();
        std::fs::create_dir_all(&root)?;
        Ok(Self { root, policy, shards: HashMap::new() })
    }

    /// Determine shard for a fingerprint
    fn shard_for(&self, fingerprint: &[u8; BLAKE3_SIZE]) -> u16 {
        let hi = u16::from_be_bytes([fingerprint[0], fingerprint[1]]);
        if self.policy.shard_count == 0 { 0 } else { hi % self.policy.shard_count }
    }

    /// Public helper to compute shard id
    pub fn shard_id(&self, fingerprint: &[u8; BLAKE3_SIZE]) -> u16 {
        self.shard_for(fingerprint)
    }

    /// Get or open shard store
    fn shard_store(&mut self, shard_id: u16) -> std::io::Result<&mut DedupStore> {
        if !self.shards.contains_key(&shard_id) {
            let shard_path = self.root.join(format!("shard_{:02}", shard_id));
            let store = DedupStore::open_with_shard(shard_path, shard_id)?;
            self.shards.insert(shard_id, store);
        }
        Ok(self.shards.get_mut(&shard_id).unwrap())
    }

    /// Lookup chunk
    pub fn lookup(&mut self, fingerprint: &[u8; BLAKE3_SIZE]) -> std::io::Result<DedupResult> {
        let shard_id = self.shard_for(fingerprint);
        let store = self.shard_store(shard_id)?;
        Ok(store.lookup(fingerprint))
    }

    /// Store chunk in its shard
    pub fn store(&mut self, fingerprint: [u8; BLAKE3_SIZE], data: &[u8], raw_size: u32, dict_id: u32) -> std::io::Result<ChunkLocation> {
        let shard_id = self.shard_for(&fingerprint);
        let store = self.shard_store(shard_id)?;
        store.store(fingerprint, data, raw_size, dict_id)
    }

    /// Add reference in shard
    pub fn add_reference(&mut self, fingerprint: &[u8; BLAKE3_SIZE], raw_size: u32) -> std::io::Result<()> {
        let shard_id = self.shard_for(fingerprint);
        let store = self.shard_store(shard_id)?;
        store.add_reference(fingerprint, raw_size);
        Ok(())
    }

    /// Fetch chunk bytes
    pub fn fetch_chunk(&mut self, fingerprint: &[u8; BLAKE3_SIZE]) -> std::io::Result<Option<Vec<u8>>> {
        let shard_id = self.shard_for(fingerprint);
        let store = self.shard_store(shard_id)?;
        store.fetch_chunk(fingerprint)
    }

    /// Persist all shards
    pub fn persist(&mut self) -> std::io::Result<()> {
        for store in self.shards.values_mut() {
            store.persist()?;
        }
        Ok(())
    }

    /// Get shard count
    pub fn shard_count(&self) -> u16 {
        self.policy.shard_count
    }
}

impl Drop for ShardedDedupStore {
    fn drop(&mut self) {
        let _ = self.persist();
    }
}
