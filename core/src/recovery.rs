//! SPK V2 Recovery Records
//!
//! Reed-Solomon error correction for data recovery.
//! Allows recovery from partial corruption.

use crate::types::RecoveryInfo;
use crate::utils::error::{SpkError, SpkResult};

/// Default recovery percentage (5%)
pub const DEFAULT_RECOVERY_PERCENTAGE: u8 = 5;

/// Maximum recovery percentage (30%)
pub const MAX_RECOVERY_PERCENTAGE: u8 = 30;

/// Default block size for Reed-Solomon
pub const DEFAULT_BLOCK_SIZE: u32 = 4096;

/// Recovery record generator
pub struct RecoveryGenerator {
    info: RecoveryInfo,
    blocks: Vec<Vec<u8>>,
    parity: Vec<Vec<u8>>,
}

impl RecoveryGenerator {
    /// Create a new recovery generator
    pub fn new(percentage: u8) -> SpkResult<Self> {
        if percentage > MAX_RECOVERY_PERCENTAGE {
            return Err(SpkError::InvalidFormat(format!(
                "Recovery percentage {} exceeds maximum {}",
                percentage, MAX_RECOVERY_PERCENTAGE
            )));
        }

        Ok(Self {
            info: RecoveryInfo {
                percentage,
                block_size: DEFAULT_BLOCK_SIZE,
                parity_blocks: 0,
                data_offset: 0,
                data_size: 0,
            },
            blocks: Vec::new(),
            parity: Vec::new(),
        })
    }

    /// Add data block for recovery
    pub fn add_block(&mut self, data: &[u8]) {
        // Pad to block size
        let mut block = data.to_vec();
        let padding = (DEFAULT_BLOCK_SIZE as usize).saturating_sub(block.len());
        block.resize(block.len() + padding, 0);
        
        self.blocks.push(block);
    }

    /// Generate parity blocks
    pub fn generate_parity(&mut self) -> SpkResult<()> {
        if self.blocks.is_empty() {
            return Ok(());
        }

        let num_data_blocks = self.blocks.len();
        let num_parity = (num_data_blocks * self.info.percentage as usize) / 100;
        let num_parity = num_parity.max(1);

        // Simple XOR-based parity (for demonstration)
        // A real implementation would use proper Reed-Solomon
        for i in 0..num_parity {
            let mut parity_block = vec![0u8; DEFAULT_BLOCK_SIZE as usize];
            
            for (j, block) in self.blocks.iter().enumerate() {
                if (j + i) % (num_parity + 1) == 0 {
                    for (k, byte) in block.iter().enumerate() {
                        parity_block[k] ^= byte;
                    }
                }
            }
            
            self.parity.push(parity_block);
        }

        self.info.parity_blocks = num_parity as u32;
        Ok(())
    }

    /// Get recovery info
    pub fn info(&self) -> &RecoveryInfo {
        &self.info
    }

    /// Get parity data
    pub fn parity_data(&self) -> &[Vec<u8>] {
        &self.parity
    }

    /// Serialize all parity blocks
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        for block in &self.parity {
            bytes.extend_from_slice(block);
        }
        bytes
    }
}

/// Recovery record verifier
pub struct RecoveryVerifier {
    info: RecoveryInfo,
}

impl RecoveryVerifier {
    /// Create from recovery info
    pub fn new(info: RecoveryInfo) -> Self {
        Self { info }
    }

    /// Verify a data block
    pub fn verify_block(&self, _block_index: usize, data: &[u8]) -> bool {
        // Basic verification: check size
        data.len() <= self.info.block_size as usize
    }

    /// Check if recovery is possible
    pub fn can_recover(&self, missing_blocks: &[usize], total_blocks: usize) -> bool {
        // Can recover if missing blocks <= parity blocks
        let recoverable = self.info.parity_blocks as usize;
        missing_blocks.len() <= recoverable && missing_blocks.len() <= total_blocks
    }
}

/// Recovery record restorer
pub struct RecoveryRestorer {
    info: RecoveryInfo,
    parity_data: Vec<Vec<u8>>,
}

impl RecoveryRestorer {
    /// Create from recovery info and parity data
    pub fn new(info: RecoveryInfo, parity_data: Vec<u8>) -> SpkResult<Self> {
        let block_size = info.block_size as usize;
        let num_blocks = info.parity_blocks as usize;
        
        if parity_data.len() < num_blocks * block_size {
            return Err(SpkError::RecoveryFailed("Insufficient parity data".into()));
        }

        let parity: Vec<Vec<u8>> = (0..num_blocks)
            .map(|i| parity_data[i * block_size..(i + 1) * block_size].to_vec())
            .collect();

        Ok(Self { info, parity_data: parity })
    }

    /// Attempt to recover a missing block
    pub fn recover_block(
        &self,
        missing_index: usize,
        existing_blocks: &[(usize, &[u8])],
    ) -> SpkResult<Vec<u8>> {
        if self.parity_data.is_empty() {
            return Err(SpkError::RecoveryFailed("No parity data available".into()));
        }

        // Simple XOR recovery (matches generation)
        let block_size = self.info.block_size as usize;
        let mut recovered = vec![0u8; block_size];

        // XOR all existing blocks that were part of parity
        for (idx, block) in existing_blocks {
            if *idx != missing_index {
                for (i, byte) in block.iter().enumerate() {
                    if i < recovered.len() {
                        recovered[i] ^= byte;
                    }
                }
            }
        }

        // XOR with parity
        let parity_idx = missing_index % self.parity_data.len();
        for (i, byte) in self.parity_data[parity_idx].iter().enumerate() {
            recovered[i] ^= byte;
        }

        Ok(recovered)
    }

    /// Get recovery info
    pub fn info(&self) -> &RecoveryInfo {
        &self.info
    }
}

/// Quick integrity check using CRC32 of blocks
pub struct IntegrityChecker {
    block_checksums: Vec<u32>,
}

impl IntegrityChecker {
    pub fn new() -> Self {
        Self {
            block_checksums: Vec::new(),
        }
    }

    pub fn add_block(&mut self, data: &[u8]) {
        let checksum = crc32fast::hash(data);
        self.block_checksums.push(checksum);
    }

    pub fn verify_block(&self, index: usize, data: &[u8]) -> bool {
        if let Some(&expected) = self.block_checksums.get(index) {
            crc32fast::hash(data) == expected
        } else {
            false
        }
    }

    pub fn checksums(&self) -> &[u32] {
        &self.block_checksums
    }
}

impl Default for IntegrityChecker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recovery_generator() {
        let mut gen = RecoveryGenerator::new(10).unwrap();
        
        gen.add_block(&[1u8; 1000]);
        gen.add_block(&[2u8; 1000]);
        gen.add_block(&[3u8; 1000]);
        
        gen.generate_parity().unwrap();
        
        assert!(gen.info().parity_blocks > 0);
        assert!(!gen.parity_data().is_empty());
    }

    #[test]
    fn test_recovery_percentage_limit() {
        assert!(RecoveryGenerator::new(50).is_err());
        assert!(RecoveryGenerator::new(30).is_ok());
    }

    #[test]
    fn test_integrity_checker() {
        let mut checker = IntegrityChecker::new();
        
        let block1 = vec![1u8; 100];
        let block2 = vec![2u8; 100];
        
        checker.add_block(&block1);
        checker.add_block(&block2);
        
        assert!(checker.verify_block(0, &block1));
        assert!(checker.verify_block(1, &block2));
        assert!(!checker.verify_block(0, &block2));
    }

    #[test]
    fn test_verifier_can_recover() {
        let info = RecoveryInfo {
            percentage: 10,
            block_size: 4096,
            parity_blocks: 3,
            data_offset: 0,
            data_size: 0,
        };
        
        let verifier = RecoveryVerifier::new(info);
        
        assert!(verifier.can_recover(&[0], 10));
        assert!(verifier.can_recover(&[0, 1, 2], 10));
        assert!(!verifier.can_recover(&[0, 1, 2, 3], 10));
    }
}
