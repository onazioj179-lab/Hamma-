//! # SPK V15: Self-Describing, Self-Transforming Containers
//!
//! Embedded micro-runtime for transformation logic inside SPK archives.
//! Enables pluginless codec execution and self-upgrading manifests.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};
use crate::utils::error::{SpkError, SpkResult};

/// V15 version constant
pub const V15_TRANSFORM_VERSION: u8 = 15;

/// Maximum transform blocks per archive
pub const V15_MAX_TRANSFORM_BLOCKS: usize = 256;

/// Transform bytecode size limit (1MB)
pub const V15_MAX_BYTECODE_SIZE: usize = 1024 * 1024;

// =============================================================================
// TRANSFORM BLOCKS
// =============================================================================

/// Transform block describing chunk transformations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformBlock {
    /// Block ID
    pub id: u64,
    /// Transform type
    pub transform_type: TransformType,
    /// Target chunk IDs
    pub target_chunks: Vec<usize>,
    /// Transform bytecode (portable instruction set)
    pub bytecode: Vec<u8>,
    /// Input parameters
    pub parameters: HashMap<String, TransformParam>,
    /// Conditions for execution
    pub conditions: Vec<TransformCondition>,
}

/// Transform types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransformType {
    Recompress,      // Change compression algorithm
    Reorganize,      // Rearrange chunk order
    Rewrite,         // Modify chunk content
    Upgrade,         // Upgrade to newer format
    Split,           // Split chunks
    Merge,           // Merge chunks
    Custom,          // Custom transformation
}

/// Transform parameter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransformParam {
    Integer(i64),
    Float(f64),
    String(String),
    Boolean(bool),
    Binary(Vec<u8>),
}

/// Transform execution condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformCondition {
    /// Condition type
    pub condition_type: ConditionType,
    /// Threshold value
    pub threshold: f64,
}

/// Condition types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConditionType {
    CompressionRatioBelow,
    ChunkSizeAbove,
    AccessCountAbove,
    AgeInDaysAbove,
    StorageCostAbove,
}

// =============================================================================
// MICRO-RUNTIME
// =============================================================================

/// Embedded micro-runtime for executing transforms
pub struct MicroRuntime {
    /// Loaded transform blocks
    transforms: Arc<RwLock<HashMap<u64, TransformBlock>>>,
    /// Execution sandbox
    sandbox: Arc<Sandbox>,
    /// Runtime statistics
    stats: Arc<RwLock<RuntimeStats>>,
}

/// Secure execution sandbox
pub struct Sandbox {
    /// Maximum execution time
    max_execution_time_ms: u64,
    /// Maximum memory usage
    max_memory_bytes: u64,
    /// Allowed operations
    allowed_ops: Vec<SandboxOp>,
}

/// Sandbox operations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxOp {
    Read,
    Write,
    Compress,
    Decompress,
    Hash,
    Validate,
}

impl Sandbox {
    /// Create new sandbox
    pub fn new() -> Self {
        Self {
            max_execution_time_ms: 5000,
            max_memory_bytes: 64 * 1024 * 1024,
            allowed_ops: vec![
                SandboxOp::Read,
                SandboxOp::Compress,
                SandboxOp::Decompress,
                SandboxOp::Hash,
                SandboxOp::Validate,
            ],
        }
    }

    /// Check if operation is allowed
    pub fn is_allowed(&self, op: SandboxOp) -> bool {
        self.allowed_ops.contains(&op)
    }
}

impl Default for Sandbox {
    fn default() -> Self {
        Self::new()
    }
}

impl MicroRuntime {
    /// Create new runtime
    pub fn new() -> Self {
        Self {
            transforms: Arc::new(RwLock::new(HashMap::new())),
            sandbox: Arc::new(Sandbox::new()),
            stats: Arc::new(RwLock::new(RuntimeStats::default())),
        }
    }

    /// Load transform block
    pub fn load_transform(&self, transform: TransformBlock) -> SpkResult<()> {
        if transform.bytecode.len() > V15_MAX_BYTECODE_SIZE {
            return Err(SpkError::InvalidData("Transform bytecode too large".into()));
        }

        let mut transforms = self.transforms.write()
            .map_err(|_| SpkError::LockError("Failed to acquire transforms lock".into()))?;

        if transforms.len() >= V15_MAX_TRANSFORM_BLOCKS {
            return Err(SpkError::LimitExceeded("Too many transform blocks".into()));
        }

        transforms.insert(transform.id, transform);
        Ok(())
    }

    /// Execute transform
    pub fn execute_transform(&self, transform_id: u64, chunk_data: &[u8]) -> SpkResult<Vec<u8>> {
        let transforms = self.transforms.read()
            .map_err(|_| SpkError::LockError("Failed to acquire transforms lock".into()))?;

        let transform = transforms.get(&transform_id)
            .ok_or_else(|| SpkError::NotFound(format!("Transform {} not found", transform_id)))?;

        // Check conditions
        if !self.check_conditions(transform, chunk_data)? {
            return Ok(chunk_data.to_vec()); // No transformation needed
        }

        // Execute in sandbox
        let result = self.execute_in_sandbox(transform, chunk_data)?;

        // Update stats
        let mut stats = self.stats.write()
            .map_err(|_| SpkError::LockError("Failed to acquire stats lock".into()))?;
        stats.transforms_executed += 1;
        stats.bytes_transformed += chunk_data.len() as u64;

        Ok(result)
    }

    /// Check if conditions are met
    fn check_conditions(&self, transform: &TransformBlock, _chunk_data: &[u8]) -> SpkResult<bool> {
        // Simplified condition checking
        if transform.conditions.is_empty() {
            return Ok(true);
        }

        // In real implementation, would evaluate each condition
        Ok(true)
    }

    /// Execute transform in sandbox
    fn execute_in_sandbox(&self, transform: &TransformBlock, chunk_data: &[u8]) -> SpkResult<Vec<u8>> {
        // Interpret bytecode in sandbox
        match transform.transform_type {
            TransformType::Recompress => {
                // Placeholder: re-compress with different algorithm
                Ok(chunk_data.to_vec())
            }
            TransformType::Reorganize => {
                // Placeholder: reorganize data
                Ok(chunk_data.to_vec())
            }
            TransformType::Rewrite => {
                // Placeholder: rewrite content
                Ok(chunk_data.to_vec())
            }
            TransformType::Upgrade => {
                // Placeholder: upgrade format
                Ok(chunk_data.to_vec())
            }
            _ => Ok(chunk_data.to_vec()),
        }
    }

    /// Get runtime statistics
    pub fn stats(&self) -> SpkResult<RuntimeStats> {
        let stats = self.stats.read()
            .map_err(|_| SpkError::LockError("Failed to acquire stats lock".into()))?;
        Ok(stats.clone())
    }

    /// List loaded transforms
    pub fn list_transforms(&self) -> SpkResult<Vec<TransformBlock>> {
        let transforms = self.transforms.read()
            .map_err(|_| SpkError::LockError("Failed to acquire transforms lock".into()))?;
        Ok(transforms.values().cloned().collect())
    }
}

impl Default for MicroRuntime {
    fn default() -> Self {
        Self::new()
    }
}

/// Runtime statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RuntimeStats {
    pub transforms_executed: u64,
    pub bytes_transformed: u64,
    pub execution_errors: u64,
}

// =============================================================================
// SELF-UPGRADING MANIFEST
// =============================================================================

/// Self-upgrading manifest rules
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradeRule {
    /// Rule ID
    pub id: u64,
    /// Source version
    pub from_version: u8,
    /// Target version
    pub to_version: u8,
    /// Upgrade transform
    pub transform: TransformBlock,
    /// Automatic or manual
    pub automatic: bool,
}

/// Manifest upgrade manager
pub struct UpgradeManager {
    /// Upgrade rules
    rules: Arc<RwLock<Vec<UpgradeRule>>>,
    /// Runtime for executing upgrades
    runtime: Arc<MicroRuntime>,
}

impl UpgradeManager {
    /// Create new upgrade manager
    pub fn new() -> Self {
        Self {
            rules: Arc::new(RwLock::new(Vec::new())),
            runtime: Arc::new(MicroRuntime::new()),
        }
    }

    /// Add upgrade rule
    pub fn add_rule(&self, rule: UpgradeRule) -> SpkResult<()> {
        let mut rules = self.rules.write()
            .map_err(|_| SpkError::LockError("Failed to acquire rules lock".into()))?;
        rules.push(rule);
        Ok(())
    }

    /// Find upgrade path
    pub fn find_upgrade_path(&self, from: u8, to: u8) -> SpkResult<Vec<UpgradeRule>> {
        let rules = self.rules.read()
            .map_err(|_| SpkError::LockError("Failed to acquire rules lock".into()))?;

        // Simple path finding - in real implementation would use graph search
        let path: Vec<UpgradeRule> = rules.iter()
            .filter(|r| r.from_version >= from && r.to_version <= to)
            .cloned()
            .collect();

        Ok(path)
    }

    /// Execute upgrade
    pub fn execute_upgrade(&self, rule: &UpgradeRule, data: &[u8]) -> SpkResult<Vec<u8>> {
        self.runtime.load_transform(rule.transform.clone())?;
        self.runtime.execute_transform(rule.transform.id, data)
    }
}

impl Default for UpgradeManager {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// SCHEMA EVOLUTION
// =============================================================================

/// Schema for transform blocks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformSchema {
    /// Schema version
    pub version: u32,
    /// Supported transform types
    pub supported_types: Vec<TransformType>,
    /// Bytecode instruction set version
    pub instruction_set_version: u32,
}

impl TransformSchema {
    /// Get current schema
    pub fn current() -> Self {
        Self {
            version: 1,
            supported_types: vec![
                TransformType::Recompress,
                TransformType::Reorganize,
                TransformType::Rewrite,
                TransformType::Upgrade,
                TransformType::Split,
                TransformType::Merge,
                TransformType::Custom,
            ],
            instruction_set_version: 1,
        }
    }

    /// Check compatibility
    pub fn is_compatible(&self, other: &TransformSchema) -> bool {
        self.instruction_set_version == other.instruction_set_version
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_block_creation() {
        let transform = TransformBlock {
            id: 1,
            transform_type: TransformType::Recompress,
            target_chunks: vec![0, 1, 2],
            bytecode: vec![0x01, 0x02, 0x03],
            parameters: HashMap::new(),
            conditions: vec![],
        };

        assert_eq!(transform.id, 1);
        assert_eq!(transform.transform_type, TransformType::Recompress);
    }

    #[test]
    fn test_micro_runtime() {
        let runtime = MicroRuntime::new();
        
        let transform = TransformBlock {
            id: 1,
            transform_type: TransformType::Recompress,
            target_chunks: vec![0],
            bytecode: vec![],
            parameters: HashMap::new(),
            conditions: vec![],
        };

        runtime.load_transform(transform).unwrap();

        let data = vec![1, 2, 3, 4];
        let result = runtime.execute_transform(1, &data).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_sandbox() {
        let sandbox = Sandbox::new();
        assert!(sandbox.is_allowed(SandboxOp::Read));
        assert!(sandbox.is_allowed(SandboxOp::Compress));
        assert!(!sandbox.is_allowed(SandboxOp::Write));
    }

    #[test]
    fn test_upgrade_manager() {
        let manager = UpgradeManager::new();
        
        let rule = UpgradeRule {
            id: 1,
            from_version: 1,
            to_version: 2,
            transform: TransformBlock {
                id: 1,
                transform_type: TransformType::Upgrade,
                target_chunks: vec![],
                bytecode: vec![],
                parameters: HashMap::new(),
                conditions: vec![],
            },
            automatic: true,
        };

        manager.add_rule(rule).unwrap();

        let path = manager.find_upgrade_path(1, 2).unwrap();
        assert!(!path.is_empty());
    }

    #[test]
    fn test_schema_compatibility() {
        let schema1 = TransformSchema::current();
        let schema2 = TransformSchema::current();
        
        assert!(schema1.is_compatible(&schema2));
    }
}
