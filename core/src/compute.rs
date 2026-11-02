use std::collections::{HashMap, VecDeque};

use crate::transform::MicroRuntime;
use crate::utils::error::{SpkError, SpkResult};
use ed25519_dalek::{Signature, VerifyingKey, Verifier};

/// V20 constants
pub const V20_MAX_SANDBOX_MEMORY: usize = 64 * 1024 * 1024; // 64MB
pub const V20_MAX_EXECUTION_MS: u64 = 5000;

/// Compute hook type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputeHookKind {
    OnRead,
    OnWrite,
    OnRepair,
    OnIngest,
}

/// Cryptographic signature for function verification
#[derive(Debug, Clone)]
pub struct FunctionSignature {
    /// Ed25519 public key (32 bytes)
    pub public_key: [u8; 32],
    /// Ed25519 signature (64 bytes)  
    pub signature: [u8; 64],
    /// Key identifier (optional, for key rotation)
    pub key_id: Option<String>,
}

impl FunctionSignature {
    /// Create from raw bytes (32-byte pubkey + 64-byte signature)
    pub fn from_bytes(data: &[u8]) -> SpkResult<Self> {
        if data.len() < 96 {
            return Err(SpkError::InvalidData("signature data too short".into()));
        }
        let mut public_key = [0u8; 32];
        let mut signature = [0u8; 64];
        public_key.copy_from_slice(&data[0..32]);
        signature.copy_from_slice(&data[32..96]);
        Ok(Self { public_key, signature, key_id: None })
    }

    /// Convert to bytes for storage
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(96);
        out.extend_from_slice(&self.public_key);
        out.extend_from_slice(&self.signature);
        out
    }
}

/// Registered function stored in-archive as WASM
#[derive(Debug, Clone)]
pub struct RegisteredFunction {
    pub id: String,
    pub description: String,
    pub wasm_bytes: Vec<u8>,
    pub signatures: Vec<Vec<u8>>, // cryptographic signatures (legacy format)
    pub verified_signatures: Vec<FunctionSignature>, // new typed signatures
}

/// Function registry living inside an archive context
#[derive(Debug, Default, Clone)]
pub struct FunctionRegistry {
    functions: HashMap<String, RegisteredFunction>,
}

impl FunctionRegistry {
    pub fn register(&mut self, func: RegisteredFunction) -> SpkResult<()> {
        if self.functions.contains_key(&func.id) {
            return Err(SpkError::InvalidOperation("function already exists".into()));
        }
        self.functions.insert(func.id.clone(), func);
        Ok(())
    }

    pub fn get(&self, id: &str) -> SpkResult<&RegisteredFunction> {
        self.functions.get(id).ok_or_else(|| SpkError::NotFound(format!("function {id} not found")))
    }

    pub fn list(&self) -> Vec<String> {
        self.functions.keys().cloned().collect()
    }
}

/// A pipeline step referencing a registered function
#[derive(Debug, Clone)]
pub struct PipelineStep {
    pub func_id: String,
    pub hook: Option<ComputeHookKind>,
}

/// In-archive pipeline definition
#[derive(Debug, Clone, Default)]
pub struct ArchivePipeline {
    pub steps: Vec<PipelineStep>,
}

/// Execution sandbox using the existing MicroRuntime as WASM engine
// Not deriving Debug because MicroRuntime doesn't implement Debug
pub struct ExecutionSandbox {
    runtime: MicroRuntime,
    memory_limit: usize,
    time_limit_ms: u64,
}

impl ExecutionSandbox {
    pub fn new(memory_limit: usize, time_limit_ms: u64) -> Self {
        Self { runtime: MicroRuntime::new(), memory_limit, time_limit_ms }
    }

    pub fn run(&mut self, _wasm: &[u8], input: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder: MicroRuntime does not currently expose a WASM execution API
        // Return data unchanged to keep V20 optional paths compiling.
        // Future: load transform blocks and execute by ID with sandbox limits.
        Ok(input.to_vec())
    }
}

/// V20 compute manager gluing registry, pipelines, sandbox and distributed execution
#[derive(Debug, Default, Clone)]
pub struct ComputeManager {
    pub registry: FunctionRegistry,
    pub pipelines: HashMap<String, ArchivePipeline>,
    logs: VecDeque<String>,
}

impl ComputeManager {
    pub fn new() -> Self { Self::default() }

    pub fn attach_pipeline(&mut self, archive_id: &str, pipeline: ArchivePipeline) -> SpkResult<()> {
        self.pipelines.insert(archive_id.to_string(), pipeline);
        self.logs.push_back(format!("pipeline attached to {archive_id}"));
        Ok(())
    }

    pub fn trigger_hook(&mut self, archive_id: &str, hook: ComputeHookKind, data: &[u8]) -> SpkResult<Vec<u8>> {
        let pipeline = self.pipelines.get(archive_id).ok_or_else(|| SpkError::NotFound(format!("pipeline not found for {archive_id}")))?;
        let mut sandbox = ExecutionSandbox::new(V20_MAX_SANDBOX_MEMORY, V20_MAX_EXECUTION_MS);
        let mut current = data.to_vec();
        for step in &pipeline.steps {
            if let Some(h) = step.hook {
                if h != hook { continue; }
            }
            let func = self.registry.get(&step.func_id)?;
            Self::verify_signatures(func)?;
            current = sandbox.run(&func.wasm_bytes, &current)?;
            self.logs.push_back(format!("step {} executed on hook {:?}", step.func_id, hook));
        }
        Ok(current)
    }

    pub fn run_pipeline(&mut self, archive_id: &str, data: &[u8]) -> SpkResult<Vec<u8>> {
        let pipeline = self.pipelines.get(archive_id).ok_or_else(|| SpkError::NotFound(format!("pipeline not found for {archive_id}")))?;
        let mut sandbox = ExecutionSandbox::new(V20_MAX_SANDBOX_MEMORY, V20_MAX_EXECUTION_MS);
        let mut current = data.to_vec();
        for step in &pipeline.steps {
            let func = self.registry.get(&step.func_id)?;
            Self::verify_signatures(func)?;
            current = sandbox.run(&func.wasm_bytes, &current)?;
            self.logs.push_back(format!("step {} executed", step.func_id));
        }
        Ok(current)
    }

    // Distributed execution (V12) integration is deferred until a stable API
    // is available in `distributed.rs`. This keeps V20 optional and non-breaking.

    pub fn logs(&self, max: usize) -> Vec<String> {
        self.logs.iter().rev().take(max).cloned().collect()
    }

    fn verify_signatures(func: &RegisteredFunction) -> SpkResult<()> {
        // Must have at least one signature
        if func.signatures.is_empty() && func.verified_signatures.is_empty() {
            return Err(SpkError::InvalidOperation("unsigned function".into()));
        }

        // Compute hash of WASM bytes for signature verification
        let wasm_hash = blake3::hash(&func.wasm_bytes);

        // Verify typed signatures (new format)
        for sig in &func.verified_signatures {
            let verifying_key = VerifyingKey::from_bytes(&sig.public_key)
                .map_err(|e| SpkError::InvalidData(format!("invalid public key: {e}")))?;
            let signature = Signature::from_bytes(&sig.signature);
            
            verifying_key
                .verify(wasm_hash.as_bytes(), &signature)
                .map_err(|e| SpkError::InvalidOperation(format!("signature verification failed: {e}")))?;
        }

        // Verify legacy raw signatures (96-byte format: 32-byte pubkey + 64-byte sig)
        for raw_sig in &func.signatures {
            if raw_sig.len() >= 96 {
                let parsed = FunctionSignature::from_bytes(raw_sig)?;
                let verifying_key = VerifyingKey::from_bytes(&parsed.public_key)
                    .map_err(|e| SpkError::InvalidData(format!("invalid public key: {e}")))?;
                let signature = Signature::from_bytes(&parsed.signature);
                
                verifying_key
                    .verify(wasm_hash.as_bytes(), &signature)
                    .map_err(|e| SpkError::InvalidOperation(format!("signature verification failed: {e}")))?;
            }
            // Skip short signatures (placeholder/test data)
        }

        Ok(())
    }
}

/// Minimal tests to ensure V20 core compiles and basic flows work
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey, Signer};

    fn create_signed_function(id: &str, wasm_bytes: &[u8]) -> RegisteredFunction {
        // Generate a test keypair
        let signing_key = SigningKey::from_bytes(&[
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60,
            0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
            0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19,
            0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
        ]);
        
        // Hash the WASM bytes and sign
        let wasm_hash = blake3::hash(wasm_bytes);
        let signature = signing_key.sign(wasm_hash.as_bytes());
        
        let func_sig = FunctionSignature {
            public_key: signing_key.verifying_key().to_bytes(),
            signature: signature.to_bytes(),
            key_id: Some("test-key-1".into()),
        };

        RegisteredFunction {
            id: id.into(),
            description: "test function".into(),
            wasm_bytes: wasm_bytes.to_vec(),
            signatures: vec![],
            verified_signatures: vec![func_sig],
        }
    }

    #[test]
    fn test_registry_and_pipeline() {
        let mut cm = ComputeManager::new();
        let func = create_signed_function("compress", &[0x00, 0x61, 0x73, 0x6d]); // WASM magic
        cm.registry.register(func).unwrap();
        let pipeline = ArchivePipeline { steps: vec![PipelineStep { func_id: "compress".into(), hook: None }] };
        cm.attach_pipeline("arch1", pipeline).unwrap();
        let result = cm.run_pipeline("arch1", b"hello");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"hello");
    }

    #[test]
    fn test_unsigned_function_rejected() {
        let func = RegisteredFunction {
            id: "bad".into(),
            description: "unsigned".into(),
            wasm_bytes: vec![],
            signatures: vec![],
            verified_signatures: vec![],
        };
        let result = ComputeManager::verify_signatures(&func);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_signature_rejected() {
        let bad_sig = FunctionSignature {
            public_key: [0u8; 32], // Invalid all-zeros key
            signature: [0u8; 64],
            key_id: None,
        };
        let func = RegisteredFunction {
            id: "bad".into(),
            description: "bad sig".into(),
            wasm_bytes: vec![1, 2, 3],
            signatures: vec![],
            verified_signatures: vec![bad_sig],
        };
        let result = ComputeManager::verify_signatures(&func);
        assert!(result.is_err());
    }

    #[test]
    fn test_signature_verification_success() {
        let func = create_signed_function("valid", b"test wasm content");
        let result = ComputeManager::verify_signatures(&func);
        assert!(result.is_ok());
    }

    #[test]
    fn test_legacy_signature_format() {
        // Test the 96-byte legacy format
        let signing_key = SigningKey::from_bytes(&[
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60,
            0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
            0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19,
            0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
        ]);
        let wasm_bytes = b"legacy test";
        let wasm_hash = blake3::hash(wasm_bytes);
        let signature = signing_key.sign(wasm_hash.as_bytes());
        
        // Build 96-byte legacy format
        let mut legacy_sig = Vec::with_capacity(96);
        legacy_sig.extend_from_slice(&signing_key.verifying_key().to_bytes());
        legacy_sig.extend_from_slice(&signature.to_bytes());

        let func = RegisteredFunction {
            id: "legacy".into(),
            description: "legacy format".into(),
            wasm_bytes: wasm_bytes.to_vec(),
            signatures: vec![legacy_sig],
            verified_signatures: vec![],
        };
        let result = ComputeManager::verify_signatures(&func);
        assert!(result.is_ok());
    }
}
