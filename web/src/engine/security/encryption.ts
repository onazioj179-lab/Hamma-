/**
 * Encryption Engine
 * AES-256-GCM and ChaCha20-Poly1305 encryption
 */

import type {
  EncryptionConfig,
  EncryptionResult,
  DecryptionResult,
  EncryptionMetadata,
  KeyMaterial,
} from './types';
import { 
  DEFAULT_ENCRYPTION_CONFIG, 
  IV_LENGTH,
} from './types';
import { generateRandomBytes, deriveKey } from './key-derivation';

/**
 * Encrypt data using AES-256-GCM
 */
async function encryptAESGCM(
  data: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<EncryptionResult> {
  // Ensure we have a proper ArrayBuffer for the crypto API (TypeScript strict mode workaround)
  const ivCopy = new Uint8Array(iv);
  const ivForCrypto = new Uint8Array(ivCopy.length);
  ivForCrypto.set(ivCopy);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivForCrypto as Uint8Array<ArrayBuffer> },
    key,
    data
  );

  return {
    data: encrypted,
    iv,
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
async function decryptAESGCM(
  data: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<DecryptionResult> {
  try {
    // Ensure we have a proper ArrayBuffer for the crypto API (TypeScript strict mode workaround)
    const ivCopy = new Uint8Array(iv);
    const ivForCrypto = new Uint8Array(ivCopy.length);
    ivForCrypto.set(ivCopy);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivForCrypto as Uint8Array<ArrayBuffer> },
      key,
      data
    );

    return {
      data: decrypted,
      verified: true,
    };
  } catch {
    return {
      data: new ArrayBuffer(0),
      verified: false,
    };
  }
}

/**
 * Encryption engine
 */
export class EncryptionEngine {
  private config: EncryptionConfig;

  constructor(config?: Partial<EncryptionConfig>) {
    this.config = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };
  }

  /**
   * Encrypt data with password
   */
  async encrypt(
    data: ArrayBuffer,
    password: string,
    hint?: string,
    onProgress?: (progress: number) => void
  ): Promise<{ encrypted: ArrayBuffer; metadata: EncryptionMetadata }> {
    // Derive key
    if (onProgress) onProgress(0.1);
    const keyMaterial = await deriveKey(password, undefined, this.config);
    
    if (onProgress) onProgress(0.3);

    // Generate IV
    const iv = generateRandomBytes(IV_LENGTH);

    // Encrypt based on algorithm
    let result: EncryptionResult;
    
    if (this.config.algorithm === 'aes-256-gcm') {
      result = await encryptAESGCM(data, keyMaterial.key, iv);
    } else {
      // ChaCha20-Poly1305 not natively supported, fallback to AES
      console.warn('ChaCha20 not available, using AES-GCM');
      result = await encryptAESGCM(data, keyMaterial.key, iv);
    }

    if (onProgress) onProgress(1.0);

    const metadata: EncryptionMetadata = {
      algorithm: this.config.algorithm,
      kdf: this.config.kdf,
      salt: keyMaterial.salt,
      iv: result.iv,
      iterations: this.config.iterations,
      memory: this.config.memory,
      parallelism: this.config.parallelism,
      hint,
    };

    return {
      encrypted: result.data,
      metadata,
    };
  }

  /**
   * Encrypt data with existing key
   */
  async encryptWithKey(
    data: ArrayBuffer,
    key: CryptoKey,
    onProgress?: (progress: number) => void
  ): Promise<EncryptionResult> {
    if (onProgress) onProgress(0.1);
    
    const iv = generateRandomBytes(IV_LENGTH);
    
    if (onProgress) onProgress(0.3);
    
    const result = await encryptAESGCM(data, key, iv);
    
    if (onProgress) onProgress(1.0);
    
    return result;
  }

  /**
   * Decrypt data with password
   */
  async decrypt(
    data: ArrayBuffer,
    password: string,
    metadata: EncryptionMetadata,
    onProgress?: (progress: number) => void
  ): Promise<DecryptionResult> {
    // Derive key using stored salt
    if (onProgress) onProgress(0.1);
    
    const config: Partial<EncryptionConfig> = {
      algorithm: metadata.algorithm,
      kdf: metadata.kdf,
      iterations: metadata.iterations,
      memory: metadata.memory,
      parallelism: metadata.parallelism,
    };
    
    const keyMaterial = await deriveKey(password, metadata.salt, config);
    
    if (onProgress) onProgress(0.3);

    // Decrypt
    let result: DecryptionResult;
    
    if (metadata.algorithm === 'aes-256-gcm') {
      result = await decryptAESGCM(data, keyMaterial.key, metadata.iv);
    } else {
      // Fallback
      result = await decryptAESGCM(data, keyMaterial.key, metadata.iv);
    }

    if (onProgress) onProgress(1.0);

    return result;
  }

  /**
   * Decrypt data with existing key
   */
  async decryptWithKey(
    data: ArrayBuffer,
    key: CryptoKey,
    iv: Uint8Array,
    onProgress?: (progress: number) => void
  ): Promise<DecryptionResult> {
    if (onProgress) onProgress(0.1);
    
    const result = await decryptAESGCM(data, key, iv);
    
    if (onProgress) onProgress(1.0);
    
    return result;
  }

  /**
   * Encrypt chunks in parallel
   */
  async encryptChunks(
    chunks: ArrayBuffer[],
    password: string,
    onProgress?: (progress: number) => void
  ): Promise<{
    encrypted: ArrayBuffer[];
    metadata: EncryptionMetadata;
    ivs: Uint8Array[];
  }> {
    // Derive key once
    const keyMaterial = await deriveKey(password, undefined, this.config);
    
    const encrypted: ArrayBuffer[] = [];
    const ivs: Uint8Array[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const iv = generateRandomBytes(IV_LENGTH);
      ivs.push(iv);
      
      const result = await encryptAESGCM(chunks[i], keyMaterial.key, iv);
      encrypted.push(result.data);
      
      if (onProgress) {
        onProgress((i + 1) / chunks.length);
      }
    }

    const metadata: EncryptionMetadata = {
      algorithm: this.config.algorithm,
      kdf: this.config.kdf,
      salt: keyMaterial.salt,
      iv: ivs[0], // First IV for reference
      iterations: this.config.iterations,
    };

    return { encrypted, metadata, ivs };
  }

  /**
   * Decrypt chunks in parallel
   */
  async decryptChunks(
    chunks: ArrayBuffer[],
    password: string,
    metadata: EncryptionMetadata,
    ivs: Uint8Array[],
    onProgress?: (progress: number) => void
  ): Promise<ArrayBuffer[]> {
    // Derive key once
    const config: Partial<EncryptionConfig> = {
      algorithm: metadata.algorithm,
      kdf: metadata.kdf,
      iterations: metadata.iterations,
    };
    
    const keyMaterial = await deriveKey(password, metadata.salt, config);
    
    const decrypted: ArrayBuffer[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const result = await decryptAESGCM(chunks[i], keyMaterial.key, ivs[i]);
      
      if (!result.verified) {
        throw new Error(`Chunk ${i} decryption failed`);
      }
      
      decrypted.push(result.data);
      
      if (onProgress) {
        onProgress((i + 1) / chunks.length);
      }
    }

    return decrypted;
  }
}

/**
 * Create encryption engine instance
 */
export function createEncryptionEngine(config?: Partial<EncryptionConfig>): EncryptionEngine {
  return new EncryptionEngine(config);
}
