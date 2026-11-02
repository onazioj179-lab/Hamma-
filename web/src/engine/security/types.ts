/**
 * Security Layer Types
 * Encryption, signatures, and secure archives
 */

// Encryption algorithm options
export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305';

// Key derivation function options
export type KeyDerivationFunction = 'pbkdf2' | 'argon2';

// Encryption configuration
export interface EncryptionConfig {
  algorithm: EncryptionAlgorithm;
  kdf: KeyDerivationFunction;
  iterations: number; // For PBKDF2
  memory?: number; // For Argon2 (KB)
  parallelism?: number; // For Argon2
}

// Default configuration
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  kdf: 'pbkdf2',
  iterations: 100000,
};

// Encryption metadata
export interface EncryptionMetadata {
  algorithm: EncryptionAlgorithm;
  kdf: KeyDerivationFunction;
  salt: Uint8Array;
  iv: Uint8Array;
  iterations?: number;
  memory?: number;
  parallelism?: number;
  hint?: string; // Optional password hint
}

// Encrypted archive footer
export interface SecureFooter {
  version: number;
  encryption: EncryptionMetadata;
  manifestHash: string;
  manifestSize: number;
  integrityTable: IntegrityEntry[];
  signature?: ArchiveSignature;
}

// Integrity entry for chunk verification
export interface IntegrityEntry {
  chunkId: string;
  offset: number;
  size: number;
  hash: string;
  encrypted: boolean;
}

// Archive signature
export interface ArchiveSignature {
  algorithm: 'ecdsa-p256' | 'ed25519';
  publicKey: string;
  signature: string;
  signedAt: number;
  signedBy?: string;
}

// Key material (never stored)
export interface KeyMaterial {
  key: CryptoKey;
  salt: Uint8Array;
  exportable: boolean;
}

// Encryption result
export interface EncryptionResult {
  data: ArrayBuffer;
  iv: Uint8Array;
  tag?: Uint8Array; // Auth tag for GCM
}

// Decryption result
export interface DecryptionResult {
  data: ArrayBuffer;
  verified: boolean;
}

// Signing key pair
export interface SigningKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  exportedPublicKey: string;
}

// Verification result
export interface VerificationResult {
  valid: boolean;
  signedAt?: number;
  signedBy?: string;
  error?: string;
}

// Security callbacks
export interface SecurityCallbacks {
  onPasswordRequired: () => Promise<string>;
  onKeyDeriving: (progress: number) => void;
  onEncrypting: (progress: number) => void;
  onDecrypting: (progress: number) => void;
  onVerifying: (progress: number) => void;
}

// Security state
export interface SecurityState {
  encrypted: boolean;
  signed: boolean;
  verified: boolean;
  algorithm?: EncryptionAlgorithm;
  hasPassword: boolean;
}

// Secure archive options
export interface SecureArchiveOptions {
  encrypt: boolean;
  password?: string;
  passwordHint?: string;
  sign: boolean;
  signingKey?: CryptoKey;
  config?: Partial<EncryptionConfig>;
}

// Constants
export const SALT_LENGTH = 32;
export const IV_LENGTH = 12; // For GCM
export const TAG_LENGTH = 16; // For GCM auth tag
export const KEY_LENGTH = 32; // 256 bits
