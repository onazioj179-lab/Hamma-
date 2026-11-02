//! SPK V2 Encryption Module
//!
//! AES-256-GCM encryption for the DATA SECTION only.
//! Header, manifest, and chunk table remain unencrypted.

#![cfg(feature = "encryption")]

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rand::RngCore;

use crate::utils::error::{SpkError, SpkResult};
use crate::types::EncryptionInfo;

/// AES-256-GCM key size
pub const KEY_SIZE: usize = 32;

/// AES-256-GCM nonce size
pub const NONCE_SIZE: usize = 12;

/// AES-256-GCM tag size
pub const TAG_SIZE: usize = 16;

/// Default Argon2 iterations
pub const DEFAULT_ITERATIONS: u32 = 3;

/// Default Argon2 memory cost (64 MB)
pub const DEFAULT_MEMORY_COST: u32 = 65536;

/// Default Argon2 parallelism
pub const DEFAULT_PARALLELISM: u32 = 4;

/// Encryption context for V2 archives
#[derive(Clone)]
pub struct EncryptionContext {
    cipher: Aes256Gcm,
    info: EncryptionInfo,
}

impl EncryptionContext {
    /// Create a new encryption context from password
    pub fn new(password: &str) -> SpkResult<Self> {
        let mut salt = vec![0u8; 32];
        OsRng.fill_bytes(&mut salt);

        let mut nonce = vec![0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce);

        let key = derive_key(
            password.as_bytes(),
            &salt,
            DEFAULT_ITERATIONS,
            DEFAULT_MEMORY_COST,
            DEFAULT_PARALLELISM,
        )?;

        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| SpkError::EncryptionError(format!("Failed to create cipher: {}", e)))?;

        let info = EncryptionInfo {
            algorithm: "AES-256-GCM".to_string(),
            kdf: "argon2id".to_string(),
            salt,
            nonce,
            iterations: DEFAULT_ITERATIONS,
            memory_cost: DEFAULT_MEMORY_COST,
            parallelism: DEFAULT_PARALLELISM,
        };

        Ok(Self { cipher, info })
    }

    /// Restore encryption context from info and password
    pub fn from_info(password: &str, info: EncryptionInfo) -> SpkResult<Self> {
        let key = derive_key(
            password.as_bytes(),
            &info.salt,
            info.iterations,
            info.memory_cost,
            info.parallelism,
        )?;

        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| SpkError::EncryptionError(format!("Failed to create cipher: {}", e)))?;

        Ok(Self { cipher, info })
    }

    /// Get encryption info for storing in header
    pub fn info(&self) -> &EncryptionInfo {
        &self.info
    }

    /// Encrypt data
    pub fn encrypt(&self, plaintext: &[u8]) -> SpkResult<Vec<u8>> {
        let nonce = Nonce::from_slice(&self.info.nonce);
        
        self.cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| SpkError::EncryptionError(format!("Encryption failed: {}", e)))
    }

    /// Decrypt data
    pub fn decrypt(&self, ciphertext: &[u8]) -> SpkResult<Vec<u8>> {
        let nonce = Nonce::from_slice(&self.info.nonce);
        
        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| SpkError::DecryptionError(format!("Decryption failed: {}", e)))
    }

    /// Encrypt data with unique nonce (for streaming)
    pub fn encrypt_with_nonce(&self, plaintext: &[u8], nonce: &[u8; NONCE_SIZE]) -> SpkResult<Vec<u8>> {
        let nonce = Nonce::from_slice(nonce);
        
        self.cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| SpkError::EncryptionError(format!("Encryption failed: {}", e)))
    }

    /// Decrypt data with specific nonce
    pub fn decrypt_with_nonce(&self, ciphertext: &[u8], nonce: &[u8; NONCE_SIZE]) -> SpkResult<Vec<u8>> {
        let nonce = Nonce::from_slice(nonce);
        
        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| SpkError::DecryptionError(format!("Decryption failed: {}", e)))
    }

    /// Generate a new unique nonce for streaming encryption
    pub fn generate_nonce() -> [u8; NONCE_SIZE] {
        let mut nonce = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce);
        nonce
    }
}

/// Derive key from password using Argon2id
fn derive_key(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    memory_cost: u32,
    parallelism: u32,
) -> SpkResult<[u8; KEY_SIZE]> {
    let params = argon2::Params::new(
        memory_cost,
        iterations,
        parallelism,
        Some(KEY_SIZE),
    ).map_err(|e| SpkError::EncryptionError(format!("Invalid Argon2 params: {}", e)))?;

    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

    let mut key = [0u8; KEY_SIZE];
    argon2
        .hash_password_into(password, salt, &mut key)
        .map_err(|e| SpkError::EncryptionError(format!("Key derivation failed: {}", e)))?;

    Ok(key)
}

/// Chunk encryptor for streaming encryption
pub struct ChunkEncryptor {
    context: EncryptionContext,
    counter: u64,
}

impl ChunkEncryptor {
    /// Create a new chunk encryptor
    pub fn new(context: EncryptionContext) -> Self {
        Self { context, counter: 0 }
    }

    /// Encrypt a chunk with unique nonce derived from counter
    pub fn encrypt_chunk(&mut self, data: &[u8]) -> SpkResult<EncryptedChunk> {
        let nonce = self.derive_chunk_nonce();
        let ciphertext = self.context.encrypt_with_nonce(data, &nonce)?;
        
        self.counter += 1;
        
        Ok(EncryptedChunk {
            nonce,
            ciphertext,
        })
    }

    /// Derive nonce for current chunk (counter mode)
    fn derive_chunk_nonce(&self) -> [u8; NONCE_SIZE] {
        let mut nonce = [0u8; NONCE_SIZE];
        // Use base nonce XORed with counter
        nonce[..8].copy_from_slice(&self.context.info.nonce[..8]);
        let counter_bytes = self.counter.to_le_bytes();
        for i in 0..8 {
            nonce[i] ^= counter_bytes[i];
        }
        nonce
    }
}

/// Chunk decryptor for streaming decryption
pub struct ChunkDecryptor {
    context: EncryptionContext,
}

impl ChunkDecryptor {
    /// Create a new chunk decryptor
    pub fn new(context: EncryptionContext) -> Self {
        Self { context }
    }

    /// Decrypt a chunk
    pub fn decrypt_chunk(&self, chunk: &EncryptedChunk) -> SpkResult<Vec<u8>> {
        self.context.decrypt_with_nonce(&chunk.ciphertext, &chunk.nonce)
    }
}

/// Encrypted chunk with nonce
#[derive(Debug, Clone)]
pub struct EncryptedChunk {
    pub nonce: [u8; NONCE_SIZE],
    pub ciphertext: Vec<u8>,
}

impl EncryptedChunk {
    /// Serialize to bytes (nonce + ciphertext)
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(NONCE_SIZE + self.ciphertext.len());
        bytes.extend_from_slice(&self.nonce);
        bytes.extend_from_slice(&self.ciphertext);
        bytes
    }

    /// Parse from bytes
    pub fn from_bytes(data: &[u8]) -> SpkResult<Self> {
        if data.len() < NONCE_SIZE {
            return Err(SpkError::DecryptionError("Encrypted chunk too small".into()));
        }

        let mut nonce = [0u8; NONCE_SIZE];
        nonce.copy_from_slice(&data[..NONCE_SIZE]);
        let ciphertext = data[NONCE_SIZE..].to_vec();

        Ok(Self { nonce, ciphertext })
    }

    /// Get total size
    pub fn size(&self) -> usize {
        NONCE_SIZE + self.ciphertext.len()
    }
}

/// Password strength validator
pub fn validate_password(password: &str) -> PasswordStrength {
    let len = password.len();
    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    let score = (len >= 8) as u32
        + (len >= 12) as u32
        + (len >= 16) as u32
        + has_upper as u32
        + has_lower as u32
        + has_digit as u32
        + has_special as u32;

    match score {
        0..=1 => PasswordStrength::Weak,
        2..=3 => PasswordStrength::Fair,
        4..=5 => PasswordStrength::Strong,
        _ => PasswordStrength::VeryStrong,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordStrength {
    Weak,
    Fair,
    Strong,
    VeryStrong,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let ctx = EncryptionContext::new("test_password_123").unwrap();
        let plaintext = b"Hello, World!";
        
        let ciphertext = ctx.encrypt(plaintext).unwrap();
        let decrypted = ctx.decrypt(&ciphertext).unwrap();
        
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_encryption_context_restore() {
        let password = "test_password_123";
        let ctx1 = EncryptionContext::new(password).unwrap();
        let info = ctx1.info().clone();
        
        let plaintext = b"Test data for encryption";
        let ciphertext = ctx1.encrypt(plaintext).unwrap();
        
        let ctx2 = EncryptionContext::from_info(password, info).unwrap();
        let decrypted = ctx2.decrypt(&ciphertext).unwrap();
        
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_chunk_encryption() {
        let ctx = EncryptionContext::new("chunk_password").unwrap();
        let mut encryptor = ChunkEncryptor::new(ctx.clone());
        let decryptor = ChunkDecryptor::new(ctx);
        
        let chunks = vec![
            b"First chunk data".to_vec(),
            b"Second chunk data".to_vec(),
            b"Third chunk data".to_vec(),
        ];
        
        let encrypted: Vec<_> = chunks.iter()
            .map(|c| encryptor.encrypt_chunk(c).unwrap())
            .collect();
        
        for (original, encrypted) in chunks.iter().zip(encrypted.iter()) {
            let decrypted = decryptor.decrypt_chunk(encrypted).unwrap();
            assert_eq!(original.as_slice(), decrypted.as_slice());
        }
    }

    #[test]
    fn test_password_strength() {
        assert_eq!(validate_password("123"), PasswordStrength::Weak);
        assert_eq!(validate_password("password"), PasswordStrength::Fair);
        assert_eq!(validate_password("Password123"), PasswordStrength::Strong);
        assert_eq!(validate_password("P@ssw0rd123!XYZ"), PasswordStrength::VeryStrong);
    }

    #[test]
    fn test_encrypted_chunk_serialization() {
        let chunk = EncryptedChunk {
            nonce: [1u8; NONCE_SIZE],
            ciphertext: vec![2, 3, 4, 5],
        };
        
        let bytes = chunk.to_bytes();
        let parsed = EncryptedChunk::from_bytes(&bytes).unwrap();
        
        assert_eq!(chunk.nonce, parsed.nonce);
        assert_eq!(chunk.ciphertext, parsed.ciphertext);
    }
}
